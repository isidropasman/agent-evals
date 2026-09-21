import type { AgentConnection } from "@/engine/connector";
import { defaultProviders, RunAbortedError, runEval } from "@/engine/runner";
import type { EvalMode, RunConfig, ToolDefinition } from "@/engine/types";
import { completeRun, createRun, failRun, getRun, markRunRunning, updateProgress } from "./db";
import { startBoundedBatch } from "./batch";
import { resolveKey } from "./keys";
import { sharedDatabaseEnabled } from "./shared-db";
import { sharedCompleteRun, sharedFailRun, sharedInsertRun, sharedIsRunCancellationRequested, sharedMarkRunRunning, sharedUpdateRunProgress } from "./shared-store";

export interface StartRunInput {
  workspaceId?: string;
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

const controllers = new Map<string, AbortController>();

export function cancelRun(id: string): boolean {
  const ctrl = controllers.get(id);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

/** Fire-and-forget: kick off an eval run in-process and persist progress. */
export function startRun(id: string, input: StartRunInput): void {
  void startRunAsync(id, input);
}

export async function startRunAsync(id: string, input: StartRunInput): Promise<boolean> {
  const inserted = await insertRun(id, input, "running");
  if (!inserted) return false;
  void executeRun(id, input);
  return true;
}

export interface BatchRunTask {
  id: string;
  input: StartRunInput;
}

export function startBatchRun(tasks: readonly BatchRunTask[]): void {
  void startBatchRunAsync(tasks);
}

export async function startBatchRunAsync(tasks: readonly BatchRunTask[]): Promise<boolean> {
  for (const [index, task] of tasks.entries()) {
    if (!await insertRun(task.id, task.input, "queued", Date.now() + index)) return false;
  }
  void startBoundedBatch(tasks, 2, async (task) => {
    if (await markRun(task.id, task.input.workspaceId)) {
      await executeRun(task.id, task.input);
    } else if (sharedDatabaseEnabled() && task.input.workspaceId) {
      await sharedFailRun(task.input.workspaceId, task.id, "Cancelado por el usuario");
    }
  }).catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    for (const task of tasks) {
      if (sharedDatabaseEnabled() && task.input.workspaceId) await sharedFailRun(task.input.workspaceId, task.id, message);
      else if (getRun(task.id)?.status === "queued") failRun(task.id, message);
    }
  });
  return true;
}

async function executeRun(id: string, input: StartRunInput): Promise<void> {

  const providers = defaultProviders(
    resolveKey("anthropic") ?? undefined,
    resolveKey("openai") ?? undefined,
  );
  const controller = new AbortController();
  controllers.set(id, controller);
  const cancellationPoller = sharedDatabaseEnabled() && input.workspaceId
    ? setInterval(() => {
        void sharedIsRunCancellationRequested(input.workspaceId as string, id).then((requested) => {
          if (requested) controller.abort();
        });
      }, 1000)
    : null;
  cancellationPoller?.unref();

  try {
    if (sharedDatabaseEnabled() && input.workspaceId && await sharedIsRunCancellationRequested(input.workspaceId, id)) controller.abort();
    const result = await runEval(
      {
        connection: input.connection,
        agentSystemPrompt: input.agentSystemPrompt,
        agentFamily: input.agentFamily,
        mode: input.mode,
        tools: input.tools,
        config: input.config,
        signal: controller.signal,
        onProgress: (p) => { void updateRunProgress(id, input.workspaceId, p); },
      },
      providers,
    );
    if (result.ok) {
      const completed = await completeRunForWorkspace(id, input.workspaceId, result.value);
      if (!completed && sharedDatabaseEnabled() && input.workspaceId) await sharedFailRun(input.workspaceId, id, "Cancelado por el usuario");
    } else {
      await failRunForWorkspace(id, input.workspaceId, `run failed (${result.error.kind})`);
    }
  } catch (err: unknown) {
    if (err instanceof RunAbortedError) {
      await failRunForWorkspace(id, input.workspaceId, "Cancelado por el usuario");
    } else {
      await failRunForWorkspace(id, input.workspaceId, "run failed (unexpected error)");
    }
  } finally {
    if (cancellationPoller) clearInterval(cancellationPoller);
    controllers.delete(id);
  }
}

async function insertRun(id: string, input: StartRunInput, status: "queued" | "running", createdAt = Date.now()): Promise<boolean> {
  if (sharedDatabaseEnabled() && input.workspaceId) {
    return sharedInsertRun({ id, workspaceId: input.workspaceId, agentId: input.agentId, agentName: input.agentName, clientName: input.clientName, endpointUrl: input.connection.endpointUrl, createdAt, status });
  }
  createRun({ id, workspaceId: input.workspaceId, agentId: input.agentId, agentName: input.agentName, clientName: input.clientName, endpointUrl: input.connection.endpointUrl, createdAt, status });
  return true;
}

async function markRun(id: string, workspaceId: string | undefined): Promise<boolean> {
  if (sharedDatabaseEnabled() && workspaceId) return sharedMarkRunRunning(workspaceId, id);
  markRunRunning(id);
  return true;
}

async function updateRunProgress(id: string, workspaceId: string | undefined, progress: Parameters<typeof updateProgress>[1]): Promise<void> {
  if (sharedDatabaseEnabled() && workspaceId) { await sharedUpdateRunProgress(workspaceId, id, progress); return; }
  updateProgress(id, progress);
}

async function completeRunForWorkspace(id: string, workspaceId: string | undefined, report: Parameters<typeof completeRun>[1]): Promise<boolean> {
  if (sharedDatabaseEnabled() && workspaceId) return sharedCompleteRun(workspaceId, id, report);
  completeRun(id, report);
  return true;
}

async function failRunForWorkspace(id: string, workspaceId: string | undefined, error: string): Promise<void> {
  if (sharedDatabaseEnabled() && workspaceId) { await sharedFailRun(workspaceId, id, error); return; }
  failRun(id, error);
}
