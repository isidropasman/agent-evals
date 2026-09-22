import { defaultProviders, type Providers } from "@/engine/runner";
import { CopilotProvider } from "@/engine/provider";
import { CodexProvider } from "./codex-provider";
import { resolveKey } from "./keys";
import { getSubscriptionConnection } from "./subscription-store";

export type ProviderResolution =
  | { ok: true; value: Providers }
  | { ok: false; error: "subscription_unavailable" };

export async function resolveEvaluationProviders(input: {
  workspaceId?: string;
  subscriptionConnectionId?: string;
  runId?: string;
}): Promise<ProviderResolution> {
  if (!input.subscriptionConnectionId) {
    return {
      ok: true,
      value: defaultProviders(resolveKey("anthropic") ?? undefined, resolveKey("openai") ?? undefined),
    };
  }
  if (!input.workspaceId) return { ok: false, error: "subscription_unavailable" };
  const connection = await getSubscriptionConnection(input.workspaceId, input.subscriptionConnectionId);
  if (!connection.ok || !connection.value || connection.value.status !== "connected"
    || (connection.value.authMode !== "codex_local" && !connection.value.accessToken)
    || (connection.value.expiresAt !== null && connection.value.expiresAt <= Date.now())) {
    return { ok: false, error: "subscription_unavailable" };
  }
  if (connection.value.provider === "codex" && connection.value.authMode === "codex_local") {
    const codex = new CodexProvider({
      workspaceId: input.workspaceId,
      connectionId: connection.value.id,
      runId: input.runId,
    });
    return {
      ok: true,
      value: {
        profiler: codex,
        scenarioGen: codex,
        userSim: codex,
        toolMocker: codex,
        judge: codex,
        fixer: codex,
        judgeModel: process.env.GAUNTLET_CODEX_MODEL?.trim() || "gpt-5",
      },
    };
  }
  const options = {
    token: connection.value.accessToken,
    workspaceId: input.workspaceId,
    connectionId: connection.value.id,
    runId: input.runId,
  };
  const copilot = new CopilotProvider(options);
  return {
    ok: true,
    value: {
      profiler: copilot,
      scenarioGen: copilot,
      userSim: copilot,
      toolMocker: copilot,
      judge: copilot,
      fixer: copilot,
      judgeModel: process.env.GAUNTLET_COPILOT_JUDGE_MODEL?.trim() || "gpt-5",
    },
  };
}
