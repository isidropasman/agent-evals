import { existsSync, writeFileSync } from "node:fs";
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

const USAGE = `
gauntlet — pre-production agent evals

  gauntlet init            crea ${CONFIG_FILENAME} en el directorio actual
  gauntlet run [--config <path>]
                           corre los evals contra el agente del config
                           sale 0 si pasa el gate, 1 si no, 2 en error

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

  process.stderr.write(`Comando desconocido: ${cmd}\n${USAGE}`);
  return 1;
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
