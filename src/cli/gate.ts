export interface GateCliOptions {
  apiKey: string;
  baseUrl: string;
  caseIds?: string[];
  suiteId?: string;
  version?: string;
  concurrency?: number;
  subscriptionConnectionId?: string;
  output?: string;
}

export type ParseGateArgsResult =
  | { ok: true; value: GateCliOptions }
  | { ok: false; error: string };

interface GateEnv {
  GAUNTLET_API_KEY?: string;
  GAUNTLET_URL?: string;
  GAUNTLET_SUBSCRIPTION_ID?: string;
  GITHUB_SHA?: string;
}

export function parseGateArgs(args: string[], env: GateEnv = process.env as unknown as GateEnv): ParseGateArgsResult {
  for (const name of ["--api-key", "--base-url", "--case-id", "--suite-id", "--version", "--concurrency", "--subscription-id", "--output"]) {
    if (hasMissingValue(args, name)) return { ok: false, error: `${name} requiere un valor.` };
  }
  const apiKey = flag(args, "--api-key") ?? env.GAUNTLET_API_KEY;
  if (!apiKey) return { ok: false, error: "gate requiere --api-key (o GAUNTLET_API_KEY)." };
  const concurrencyText = flag(args, "--concurrency");
  const concurrency = concurrencyText === undefined ? undefined : Number(concurrencyText);
  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)) {
    return { ok: false, error: "--concurrency debe ser un entero entre 1 y 8." };
  }
  const caseIds = flags(args, "--case-id");
  const suiteId = flag(args, "--suite-id");
  if (args.includes("--suite-id") && !suiteId) return { ok: false, error: "--suite-id requiere un valor." };
  if (args.includes("--case-id") && caseIds.length === 0) return { ok: false, error: "--case-id requiere un valor." };
  const version = flag(args, "--version") ?? env.GITHUB_SHA ?? undefined;
  if (args.includes("--version") && !version) return { ok: false, error: "--version requiere un valor." };
  const output = flag(args, "--output");
  if (args.includes("--output") && !output) return { ok: false, error: "--output requiere un valor." };
  const subscriptionConnectionId = flag(args, "--subscription-id") ?? env.GAUNTLET_SUBSCRIPTION_ID;
  return {
    ok: true,
    value: {
      apiKey,
      baseUrl: flag(args, "--base-url") ?? env.GAUNTLET_URL ?? "http://localhost:3000",
      caseIds: caseIds.length ? caseIds : undefined,
      suiteId,
      version,
      concurrency,
      subscriptionConnectionId,
      output,
    },
  };
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  if (value?.startsWith("--")) return undefined;
  return value?.trim() || undefined;
}

function hasMissingValue(args: string[], name: string): boolean {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && (!args[index + 1] || args[index + 1]?.startsWith("--"))) return true;
  }
  return false;
}

function flags(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    const value = args[index + 1]?.trim();
    if (value) values.push(value);
  }
  return values;
}
