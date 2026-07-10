import type { AgentConnection } from "@/engine/connector";
import { defaultProviders, RunAbortedError, runEval } from "@/engine/runner";
import type { EvalMode, RunConfig } from "@/engine/types";
import { completeRun, createRun, failRun, updateProgress } from "./db";

export interface StartRunInput {
  agentName: string;
  clientName: string | null;
  connection: AgentConnection;
  agentSystemPrompt: string;
  agentFamily: "anthropic" | "openai" | "unknown";
  mode: EvalMode;
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
    agentName: input.agentName,
    clientName: input.clientName,
    endpointUrl: input.connection.endpointUrl,
    createdAt: Date.now(),
  });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const providers = defaultProviders(apiKey);
  const controller = new AbortController();
  controllers.set(id, controller);

  void runEval(
    {
      connection: input.connection,
      agentSystemPrompt: input.agentSystemPrompt,
      agentFamily: input.agentFamily,
      mode: input.mode,
      config: input.config,
      signal: controller.signal,
      onProgress: (p) => updateProgress(id, p),
    },
    providers,
  )
    .then((result) => {
      if (result.ok) {
        completeRun(id, result.value);
      } else {
        failRun(id, `${result.error.kind}: ${result.error.message}`);
      }
    })
    .catch((err: unknown) => {
      if (err instanceof RunAbortedError) {
        failRun(id, "Cancelado por el usuario");
      } else {
        failRun(id, err instanceof Error ? err.message : String(err));
      }
    })
    .finally(() => {
      controllers.delete(id);
    });
}
