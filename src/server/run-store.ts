import type { AgentConnection } from "@/engine/connector";
import { defaultProviders, RunAbortedError, runEval } from "@/engine/runner";
import type { EvalMode, RunConfig, ToolDefinition } from "@/engine/types";
import { completeRun, createRun, failRun, getRun, markRunRunning, updateProgress } from "./db";
import { startBoundedBatch } from "./batch";
import { resolveKey } from "./keys";

export interface StartRunInput {
  agentId?: string;
  agentName: string;
  clientName: string | null;
  connection: AgentConnection;
  agentSystemPrompt: string;
  agentFamily: "anthropic" | "openai" | "unknown";
  /** Force a mode; omit to let the profiler infer it from the system prompt. */
  mode?: EvalMode;
  /** Tools the agent can call, if any — Gauntlet mocks their results. */
  tools?: ToolDefinition[];
  config?: Partial<RunConfig>;
}

// In-process registry so a cancel request can abort a fire-and-forget run.
// ponytail: process-local — a multi-instance deploy needs a shared signal
// (e.g. a DB flag the runner polls). Fine for single-instance.
const controllers = new Map<string, AbortController>();

export function cancelRun(id: string): boolean {
  const ctrl = controllers.get(id);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

/** Fire-and-forget: kick off an eval run in-process and persist progress to SQLite. */
export function startRun(id: string, input: StartRunInput): void {
  createRun({
    id,
    agentId: input.agentId,
    agentName: input.agentName,
    clientName: input.clientName,
    endpointUrl: input.connection.endpointUrl,
    createdAt: Date.now(),
  });

  void executeRun(id, input);
}

export interface BatchRunTask {
  id: string;
  input: StartRunInput;
}

export function startBatchRun(tasks: readonly BatchRunTask[]): void {
  for (const [index, task] of tasks.entries()) {
    createRun({
      id: task.id,
      agentId: task.input.agentId,
      agentName: task.input.agentName,
      clientName: task.input.clientName,
      endpointUrl: task.input.connection.endpointUrl,
      createdAt: Date.now() + index,
      status: "queued",
    });
  }

  void startBoundedBatch(tasks, 2, async (task) => {
    markRunRunning(task.id);
    await executeRun(task.id, task.input);
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    for (const task of tasks) {
      if (getRun(task.id)?.status === "queued") failRun(task.id, message);
    }
  });
}

async function executeRun(id: string, input: StartRunInput): Promise<void> {

  const providers = defaultProviders(
    resolveKey("anthropic") ?? undefined,
    resolveKey("openai") ?? undefined,
  );
  const controller = new AbortController();
  controllers.set(id, controller);

  try {
    const result = await runEval(
      {
        connection: input.connection,
        agentSystemPrompt: input.agentSystemPrompt,
        agentFamily: input.agentFamily,
        mode: input.mode,
        tools: input.tools,
        config: input.config,
        signal: controller.signal,
        onProgress: (p) => updateProgress(id, p),
      },
      providers,
    );
    if (result.ok) {
      completeRun(id, result.value);
    } else {
      failRun(id, `${result.error.kind}: ${result.error.message}`);
    }
  } catch (err: unknown) {
    if (err instanceof RunAbortedError) {
      failRun(id, "Cancelado por el usuario");
    } else {
      failRun(id, err instanceof Error ? err.message : String(err));
    }
  } finally {
    controllers.delete(id);
  }
}
