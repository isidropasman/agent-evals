import { spawn, type ChildProcess } from "node:child_process";
import { probeAgent, type AgentConnection } from "../engine/connector";
import type { EngineResult } from "../engine/types";

export interface LaunchedAgent {
  stop: () => void;
}

/** Spawn the user's start command in its own process group so we can tear down
 * the whole tree (dev servers fork children). Output is inherited so the user
 * sees their agent's logs. */
export function spawnAgent(command: string): ChildProcess {
  return spawn(command, {
    shell: true,
    detached: true,
    stdio: "inherit",
  });
}

export function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    // Negative pid → the whole process group.
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
}

/** Poll until the agent answers. Uses readyPath (a GET) if given, else a full
 * probe of the eval endpoint. Returns once ready or after the timeout. */
export async function waitForReady(
  connection: AgentConnection,
  readyPath: string | null,
  timeoutSec: number,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<EngineResult<void>> {
  const deadline = Date.now() + timeoutSec * 1000;
  const readyUrl = readyPath ? new URL(readyPath, connection.endpointUrl).toString() : null;

  let lastError = "sin respuesta";
  while (Date.now() < deadline) {
    if (readyUrl) {
      try {
        const res = await fetch(readyUrl, { signal: AbortSignal.timeout(5000) });
        if (res.ok) return { ok: true, value: undefined };
        lastError = `HTTP ${res.status} en ${readyPath}`;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    } else {
      const probe = await probeAgent(connection);
      if (probe.ok) return { ok: true, value: undefined };
      lastError = probe.error.message;
    }
    await sleep(1000);
  }
  return {
    ok: false,
    error: {
      kind: "connector_unreachable",
      message: `El agente no estuvo listo en ${timeoutSec}s (último error: ${lastError})`,
    },
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
