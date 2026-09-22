export type McpRequestId = string | number | null;

export interface McpRequest {
  jsonrpc: "2.0";
  id?: McpRequestId;
  method: string;
  params?: unknown;
}

export interface McpResponse {
  jsonrpc: "2.0";
  id: McpRequestId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const MCP_TOOLS: readonly McpTool[] = [
  {
    name: "list_agents",
    description: "Lista los agentes y su última señal en el workspace actual.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "register_agent",
    description: "Registra un agente black-box u observado en el workspace actual.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        externalId: { type: "string" },
        endpointUrl: { type: "string" },
        systemPrompt: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_subscriptions",
    description: "Lista las suscripciones conectadas sin exponer credenciales.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "connect_codex",
    description: "Conecta la sesión local de Codex con suscripción ChatGPT al workspace.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "run_suite",
    description: "Lanza una suite reproducible contra un agente black-box.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" },
        suite: { type: "string", enum: ["balanced", "safety", "reliability", "tools"] },
        scenarioCount: { type: "number", enum: [10, 50] },
        k: { type: "number", enum: [1, 4] },
        subscriptionConnectionId: { type: "string" },
      },
      required: ["agentId"],
    },
  },
  {
    name: "get_run",
    description: "Consulta el estado y el resultado resumido de un run.",
    inputSchema: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] },
  },
  {
    name: "get_trace",
    description: "Consulta la señal observada y assertions de una traza.",
    inputSchema: {
      type: "object",
      properties: { agentId: { type: "string" }, traceId: { type: "string" } },
      required: ["agentId", "traceId"],
    },
  },
  {
    name: "list_cases",
    description: "Lista los casos de regresión promovidos desde traces observadas.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "promote_trace",
    description: "Convierte una trace redacted con assertion en un caso reproducible.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" },
        traceId: { type: "string" },
        name: { type: "string" },
      },
      required: ["agentId", "traceId"],
    },
  },
  {
    name: "replay_case",
    description: "Reejecuta un caso de regresión contra su agente y persiste el veredicto.",
    inputSchema: { type: "object", properties: { caseId: { type: "string" }, subscriptionConnectionId: { type: "string" } }, required: ["caseId"] },
  },
  {
    name: "run_gate",
    description: "Ejecuta múltiples casos de regresión con baseline de versión y devuelve el gate.",
    inputSchema: {
      type: "object",
      properties: {
        caseIds: { type: "array", items: { type: "string" } },
        suiteId: { type: "string" },
        version: { type: "string" },
        concurrency: { type: "number", minimum: 1, maximum: 8 },
        subscriptionConnectionId: { type: "string" },
      },
    },
  },
  {
    name: "list_datasets",
    description: "Lista las versiones inmutables de datasets del workspace.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_dataset",
    description: "Crea o reutiliza una versión de dataset con checksum reproducible.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, version: { type: "string" }, items: { type: "array" } },
      required: ["name", "version", "items"],
    },
  },
];

export function isMcpRequest(value: unknown): value is McpRequest {
  if (!isRecord(value)) return false;
  return value.jsonrpc === "2.0" && typeof value.method === "string" && isRequestId(value.id);
}

function isRequestId(value: unknown): value is McpRequestId | undefined {
  return value === undefined || value === null || typeof value === "string" || typeof value === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
