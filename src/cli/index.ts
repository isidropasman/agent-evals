import { existsSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defaultProviders, runEval } from "../engine/runner";
import type { RunProgress } from "../engine/types";
import {
  CONFIG_FILENAME,
  configTemplate,
  loadConfig,
  runConfigFrom,
} from "./config";
import { killProcessTree, spawnAgent, waitForReady } from "./launch";
import { passesGate, renderReport } from "./report";
import { createGauntletClient } from "../sdk/client";
import { parseTraceEnvelope } from "../server/http-input";
import { parseGateArgs } from "./gate";
import { migrateSqliteToShared } from "../server/migrate";
import { createSharedWorkspaceKey, getSharedDefaultWorkspace } from "../server/shared-workspace-store";

const USAGE = `
gauntlet — pre-production agent evals

  gauntlet init            crea ${CONFIG_FILENAME} en el directorio actual
  gauntlet run [--config <path>]
                           corre los evals contra el agente del config
                           sale 0 si pasa el gate, 1 si no, 2 en error
  gauntlet key [--name <name>] [--base-url <url>]
                           crea una API key para el workspace local
  gauntlet ingest --file <path> --api-key <key> [--base-url <url>]
                           envía una traza al dashboard
  gauntlet replay --case-id <id> --api-key <key> [--subscription-id <id>] [--base-url <url>]
                           reejecuta un caso de regresión y devuelve su veredicto
  gauntlet gate [--case-id <id> ...] [--suite-id <id>] [--version <version>] [--concurrency <n>] [--subscription-id <id>]
                           corre el gate multi-caso y compara contra la versión anterior
                           --output <path> guarda el reporte JSON para CI
  gauntlet migrate [--from <sqlite-path>]
                           migra datos locales a Postgres de forma reanudable
  gauntlet bootstrap [--name <name>]
                           crea la primera API key owner en Postgres
  gauntlet codex-connect --api-key <key> [--base-url <url>]
                           conecta la sesión local de Codex al workspace

  --config <path>          ruta al config (default: ./${CONFIG_FILENAME})
  -h, --help               esta ayuda
`;

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];

  if (!cmd || cmd === "-h" || cmd === "--help") {
    process.stdout.write(USAGE);
    return cmd ? 0 : 1;
  }

  if (cmd === "init") return cmdInit();
  if (cmd === "run") return cmdRun(argv.slice(1));
  if (cmd === "key") return cmdKey(argv.slice(1));
  if (cmd === "ingest") return cmdIngest(argv.slice(1));
  if (cmd === "replay") return cmdReplay(argv.slice(1));
  if (cmd === "gate") return cmdGate(argv.slice(1));
  if (cmd === "migrate") return cmdMigrate(argv.slice(1));
  if (cmd === "bootstrap") return cmdBootstrap(argv.slice(1));
  if (cmd === "codex-connect") return cmdCodexConnect(argv.slice(1));

  process.stderr.write(`Comando desconocido: ${cmd}\n${USAGE}`);
  return 1;
}

async function loadLocalEnv(): Promise<void> {
  const { loadEnvConfig } = await import("@next/env");
  loadEnvConfig(process.cwd());
}

async function cmdMigrate(args: string[]): Promise<number> {
  await loadLocalEnv();
  const result = await migrateSqliteToShared(flag(args, "--from") ? path.resolve(process.cwd(), flag(args, "--from")!) : undefined);
  if (!result.ok) { process.stderr.write(`✕ ${result.error}\n`); return 2; }
  process.stdout.write(`✓ Migración completada desde ${result.value.source}\n${JSON.stringify(result.value.tables)} · ${result.value.skipped} filas omitidas\n`);
  return 0;
}

async function cmdBootstrap(args: string[]): Promise<number> {
  await loadLocalEnv();
  const workspace = await getSharedDefaultWorkspace();
  const result = await createSharedWorkspaceKey(workspace.id, flag(args, "--name") ?? "initial owner key", "owner");
  if (!result.ok) { process.stderr.write(`✕ ${result.error}\n`); return 2; }
  process.stdout.write(`✓ Owner key creada (${result.value.prefix}). Guardala ahora, no se vuelve a mostrar.\n${result.value.token}\n`);
  return 0;
}

async function cmdKey(args: string[]): Promise<number> {
  const baseUrl = flag(args, "--base-url") ?? process.env.GAUNTLET_URL ?? "http://localhost:3000";
  const name = flag(args, "--name") ?? "local agent SDK";
  const client = createGauntletClient({
    baseUrl,
    apiKey: flag(args, "--api-key") ?? process.env.GAUNTLET_API_KEY ?? "",
  });
  const result = await client.createKey(name);
  if (!result.ok) {
    process.stderr.write(`✕ ${result.error.message}\n`);
    return 2;
  }
  process.stdout.write(`✓ API key creada (${result.value.prefix}). Guardala ahora, no se vuelve a mostrar.\n${result.value.token}\n`);
  return 0;
}

async function cmdCodexConnect(args: string[]): Promise<number> {
  const apiKey = flag(args, "--api-key") ?? process.env.GAUNTLET_API_KEY;
  if (!apiKey) {
    process.stderr.write("✕ codex-connect requiere --api-key (o GAUNTLET_API_KEY).\n");
    return 2;
  }
  const client = createGauntletClient({
    baseUrl: flag(args, "--base-url") ?? process.env.GAUNTLET_URL ?? "http://localhost:3000",
    apiKey,
  });
  const result = await client.connectCodex();
  if (!result.ok) {
    process.stderr.write(`✕ ${result.error.message}\n`);
    return 2;
  }
  process.stdout.write(`✓ Codex conectado · ${result.value.connection.displayName} · ${result.value.connection.accountLogin}\n`);
  return 0;
}

async function cmdIngest(args: string[]): Promise<number> {
  const file = flag(args, "--file");
  const apiKey = flag(args, "--api-key") ?? process.env.GAUNTLET_API_KEY;
  if (!file || !apiKey) {
    process.stderr.write("✕ ingest requiere --file y --api-key (o GAUNTLET_API_KEY).\n");
    return 2;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path.resolve(process.cwd(), file), "utf8")) as unknown;
  } catch {
    process.stderr.write(`✕ No se pudo leer JSON desde ${file}.\n`);
    return 2;
  }
  const parsed = parseTraceEnvelope(raw);
  if (!parsed.ok) {
    process.stderr.write(`✕ ${parsed.error}\n`);
    return 2;
  }
  const client = createGauntletClient({
    baseUrl: flag(args, "--base-url") ?? process.env.GAUNTLET_URL ?? "http://localhost:3000",
    apiKey,
  });
  const result = await client.ingestTrace(parsed.value);
  if (!result.ok) {
    process.stderr.write(`✕ ${result.error.message}\n`);
    return 2;
  }
  process.stdout.write(`✓ Trace ${result.value.traceId} ${result.value.inserted ? "ingested" : "already existed"}.\n`);
  return 0;
}

async function cmdReplay(args: string[]): Promise<number> {
  const caseId = flag(args, "--case-id");
  const apiKey = flag(args, "--api-key") ?? process.env.GAUNTLET_API_KEY;
  const subscriptionId = flag(args, "--subscription-id") ?? process.env.GAUNTLET_SUBSCRIPTION_ID;
  if ((args.includes("--subscription-id") && !subscriptionId) || !caseId || !apiKey) {
    process.stderr.write("✕ replay requiere --case-id, --api-key (o GAUNTLET_API_KEY).\n");
    return 2;
  }
  const client = createGauntletClient({
    baseUrl: flag(args, "--base-url") ?? process.env.GAUNTLET_URL ?? "http://localhost:3000",
    apiKey,
  });
  const result = await client.replayCase(caseId, { subscriptionConnectionId: flag(args, "--subscription-id") ?? process.env.GAUNTLET_SUBSCRIPTION_ID });
  if (!result.ok) {
    process.stderr.write(`✕ ${result.error.message}\n`);
    return 2;
  }
  process.stdout.write(`${result.value.replay.passed ? "✓" : "✕"} ${result.value.case.name} · ${result.value.replay.passed ? "pass" : "fail"} · ${result.value.replay.latencyMs}ms\n`);
  return result.value.replay.passed ? 0 : 1;
}

async function cmdGate(args: string[]): Promise<number> {
  const parsed = parseGateArgs(args);
  if (!parsed.ok) {
    writeGateReport(flag(args, "--output"), { status: "error", error: parsed.error });
    process.stderr.write(`✕ ${parsed.error}\n`);
    return 2;
  }
  const result = await createGauntletClient({
    baseUrl: parsed.value.baseUrl,
    apiKey: parsed.value.apiKey,
  }).runGate({
    caseIds: parsed.value.caseIds,
    suiteId: parsed.value.suiteId,
    version: parsed.value.version,
    concurrency: parsed.value.concurrency,
    subscriptionConnectionId: parsed.value.subscriptionConnectionId,
  });
  if (!result.ok) {
    writeGateReport(parsed.value.output, { status: "error", error: result.error.message });
    process.stderr.write(`✕ ${result.error.message}\n`);
    return 2;
  }
  const output = parsed.value.output;
  if (output && !writeGateReport(output, result.value)) return 2;
  process.stdout.write(`${result.value.status === "pass" ? "✓" : "✕"} gate ${result.value.status} · ${result.value.passed}/${result.value.total} pass · ${result.value.regressions} regresiones` +
    `${result.value.baselineVersion ? ` · baseline ${result.value.baselineVersion}` : " · sin baseline"}\n`);
  return result.value.status === "pass" ? 0 : result.value.status === "error" ? 2 : 1;
}

function writeGateReport(output: string | undefined, value: unknown): boolean {
  if (!output) return true;
  try {
    writeFileSync(path.resolve(process.cwd(), output), JSON.stringify(value, null, 2) + "\n");
    return true;
  } catch (error: unknown) {
    process.stderr.write(`✕ No se pudo escribir ${output}: ${error instanceof Error ? error.message : String(error)}\n`);
    return false;
  }
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  return value?.trim() || undefined;
}

function cmdInit(): number {
  const target = path.resolve(process.cwd(), CONFIG_FILENAME);
  if (existsSync(target)) {
    process.stderr.write(`Ya existe ${CONFIG_FILENAME}. Borralo si querés regenerarlo.\n`);
    return 1;
  }
  writeFileSync(target, configTemplate());
  process.stdout.write(
    `✓ Creado ${CONFIG_FILENAME}.\n` +
      `  Editá endpointUrl, systemPromptFile y startCommand, después corré \`gauntlet run\`.\n`,
  );
  return 0;
}

function parseConfigPath(args: string[]): string {
  const i = args.indexOf("--config");
  if (i >= 0 && args[i + 1]) return path.resolve(process.cwd(), args[i + 1]!);
  return path.resolve(process.cwd(), CONFIG_FILENAME);
}

async function cmdRun(args: string[]): Promise<number> {
  const configPath = parseConfigPath(args);
  const loaded = loadConfig(configPath);
  if (!loaded.ok) {
    process.stderr.write(`✕ ${loaded.error.message}\n`);
    return 2;
  }
  const run = loaded.value;

  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write(
      "✕ Falta ANTHROPIC_API_KEY. El motor la necesita para generar escenarios y evaluar.\n",
    );
    return 2;
  }

  // Optionally launch the agent, then make sure it's up before spending LLM calls.
  const child = run.startCommand ? spawnAgent(run.startCommand) : null;
  if (child) process.stdout.write(`▸ Levantando el agente: ${run.startCommand}\n`);

  try {
    process.stdout.write("▸ Esperando a que el agente responda…\n");
    const ready = await waitForReady(
      run.connection,
      run.readyPath,
      run.startupTimeoutSec,
    );
    if (!ready.ok) {
      process.stderr.write(`✕ ${ready.error.message}\n`);
      return 2;
    }
    process.stdout.write("✓ Agente listo. Corriendo evals…\n");

    const rc = runConfigFrom(run);
    const result = await runEval(
      {
        connection: run.connection,
        agentSystemPrompt: run.systemPrompt,
        agentFamily: run.agentFamily,
        mode: run.mode,
        tools: run.tools,
        config: rc,
        onProgress: progressLine,
      },
      defaultProviders(process.env.ANTHROPIC_API_KEY),
    );

    process.stdout.write("\n");
    if (!result.ok) {
      process.stderr.write(`✕ ${result.error.kind}: ${result.error.message}\n`);
      return 2;
    }

    const report = result.value;
    const reportPath = path.resolve(process.cwd(), "gauntlet-report.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    process.stdout.write(renderReport(report, run));
    process.stdout.write(`  Reporte completo: ${reportPath}\n\n`);

    return passesGate(report, run) ? 0 : 1;
  } finally {
    if (child) {
      process.stdout.write("▸ Bajando el agente…\n");
      killProcessTree(child);
    }
  }
}

let lastPhase = "";
function progressLine(p: RunProgress): void {
  // Keep the terminal quiet: one line per phase transition + a running counter.
  if (p.phase !== lastPhase) {
    lastPhase = p.phase;
    process.stdout.write(`\n  ${p.phase}… `);
  }
  if (p.totalConversations > 0) {
    process.stdout.write(
      `\r  ${p.phase}… ${p.completedConversations}/${p.totalConversations}   `,
    );
  }
}

void main(process.argv.slice(2)).then((code) => {
  process.exit(code);
});
