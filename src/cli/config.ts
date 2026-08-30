import { readFileSync } from "node:fs";
import path from "node:path";
import type { AgentConnection } from "../engine/connector";
import type {
  EngineResult,
  EvalMode,
  ScenarioCategory,
  ToolDefinition,
} from "../engine/types";

export interface GauntletConfig {
  agentName: string;
  clientName?: string;
  /** "conversational" (chat/voice) or "task" (document/transform agents).
   * Omit to let Gauntlet's profiler read the system prompt and decide. */
  mode?: EvalMode;
  /** Path (relative to the config file) to read the agent's system prompt from. */
  systemPromptFile?: string;
  /** Inline system prompt — takes precedence over systemPromptFile. */
  systemPrompt?: string;
  /** Tools the agent can call (OpenAI tools[] shape) — inline, takes
   * precedence over toolsFile. Optional: only needed if the agent uses
   * tools; Gauntlet mocks their results. */
  tools?: ToolDefinition[];
  /** Path (relative to the config file) to a JSON file with a tools[] array. */
  toolsFile?: string;
  endpointUrl: string;
  protocol?: "openai" | "coval";
  auth?: {
    type: "none" | "bearer" | "header";
    token?: string;
    headerName?: string;
  };
  agentFamily?: "anthropic" | "openai" | "unknown";
  /** Optional command to launch the agent before testing (e.g. "npm run dev"). */
  startCommand?: string;
  /** GET path polled until the agent is up (e.g. "/health"). Defaults to probing the endpoint. */
  readyPath?: string;
  /** Seconds to wait for readiness before giving up. */
  startupTimeoutSec?: number;
  scenarioCount?: number;
  k?: number;
  /** CI gate: run fails (exit 1) if the score/category rates fall below these. */
  gate?: {
    minScore?: number;
    minCategoryRate?: number;
  };
}

export interface ResolvedRun {
  agentName: string;
  clientName: string | null;
  /** undefined = let the engine's profiler infer the mode from the prompt. */
  mode: EvalMode | undefined;
  systemPrompt: string;
  tools: ToolDefinition[];
  connection: AgentConnection;
  agentFamily: "anthropic" | "openai" | "unknown";
  startCommand: string | null;
  readyPath: string | null;
  startupTimeoutSec: number;
  scenarioCount: number;
  k: number;
  gate: { minScore: number; minCategoryRate: number };
}

export const CONFIG_FILENAME = "gauntlet.config.json";

export function configTemplate(): string {
  const tpl: GauntletConfig = {
    agentName: "Mi agente",
    // mode: "conversational" | "task" — omitido a propósito: Gauntlet lee el
    // system prompt y decide. Fijalo solo si querés forzar uno de los dos.
    // tools: [{name, description, parameters?}] o toolsFile: "./tools.json" —
    // solo si tu agente llama herramientas; Gauntlet simula sus resultados.
    systemPromptFile: "./prompt.txt",
    endpointUrl: "http://localhost:8080/v1/chat/completions",
    protocol: "openai",
    auth: { type: "none" },
    agentFamily: "unknown",
    startCommand: "npm run dev",
    readyPath: "/health",
    startupTimeoutSec: 60,
    scenarioCount: 50,
    k: 4,
    gate: { minScore: 0.9, minCategoryRate: 0.8 },
  };
  return JSON.stringify(tpl, null, 2) + "\n";
}

export function loadConfig(configPath: string): EngineResult<ResolvedRun> {
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    return err(`No se encontró ${configPath}. Corré \`gauntlet init\` para crearlo.`);
  }

  let cfg: GauntletConfig;
  try {
    cfg = JSON.parse(raw) as GauntletConfig;
  } catch {
    return err(`${configPath} no es JSON válido.`);
  }

  if (!cfg.agentName?.trim()) return err("Falta `agentName` en el config.");
  if (!cfg.endpointUrl?.trim()) return err("Falta `endpointUrl` en el config.");

  // Resolve the system prompt: inline wins, else read the file relative to the config.
  let systemPrompt = cfg.systemPrompt?.trim() ?? "";
  if (!systemPrompt) {
    if (!cfg.systemPromptFile?.trim()) {
      return err("Definí `systemPrompt` o `systemPromptFile` en el config.");
    }
    const promptPath = path.resolve(path.dirname(configPath), cfg.systemPromptFile);
    try {
      systemPrompt = readFileSync(promptPath, "utf8").trim();
    } catch {
      return err(`No se pudo leer el system prompt en ${promptPath}.`);
    }
    if (!systemPrompt) return err(`El archivo ${promptPath} está vacío.`);
  }

  // Tools are entirely optional — most agents don't have any. Inline wins
  // over toolsFile, same precedence as systemPrompt/systemPromptFile.
  let tools: ToolDefinition[] = cfg.tools ?? [];
  if (tools.length === 0 && cfg.toolsFile?.trim()) {
    const toolsPath = path.resolve(path.dirname(configPath), cfg.toolsFile);
    let raw: string;
    try {
      raw = readFileSync(toolsPath, "utf8");
    } catch {
      return err(`No se pudo leer \`toolsFile\` en ${toolsPath}.`);
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      tools = parsed as ToolDefinition[];
    } catch {
      return err(`${toolsPath} debe ser un array JSON de {name, description, parameters?}.`);
    }
  }

  const connection: AgentConnection = {
    endpointUrl: cfg.endpointUrl.trim(),
    protocol: cfg.protocol ?? "openai",
    authType: cfg.auth?.type ?? "none",
    authToken: cfg.auth?.token,
    authHeaderName: cfg.auth?.headerName,
  };

  return {
    ok: true,
    value: {
      agentName: cfg.agentName.trim(),
      clientName: cfg.clientName?.trim() || null,
      mode: cfg.mode,
      systemPrompt,
      tools,
      connection,
      agentFamily: cfg.agentFamily ?? "unknown",
      startCommand: cfg.startCommand?.trim() || null,
      readyPath: cfg.readyPath?.trim() || null,
      startupTimeoutSec: cfg.startupTimeoutSec ?? 60,
      scenarioCount: cfg.scenarioCount ?? 50,
      k: cfg.k ?? 4,
      gate: {
        minScore: cfg.gate?.minScore ?? 0.9,
        minCategoryRate: cfg.gate?.minCategoryRate ?? 0.8,
      },
    },
  };
}

/** Build the engine RunConfig overrides from a resolved run (scenario mix + k). */
export function runConfigFrom(run: ResolvedRun): {
  scenarioCount: number;
  mix: Record<ScenarioCategory, number>;
  k: number;
} {
  const total = run.scenarioCount;
  const happy = Math.max(1, Math.round(total * 0.4));
  const edge = Math.max(1, Math.round(total * 0.3));
  const adversarial = Math.max(1, total - happy - edge);
  return {
    scenarioCount: total,
    mix: { happy_path: happy, edge_case: edge, adversarial },
    k: run.k,
  };
}

function err(message: string): EngineResult<never> {
  return { ok: false, error: { kind: "config_error", message } };
}
