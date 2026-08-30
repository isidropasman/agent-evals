import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentConnection } from "../src/engine/connector";
import { defaultProviders, runEval } from "../src/engine/runner";
import { MODELS } from "../src/engine/provider";
import type { RunConfig } from "../src/engine/types";
import { countFalseAlarms, gradeDefect, manualProbe, staticReview } from "./baseline";
import { FIXTURES, type Fixture } from "./fixtures";
import { mockProviders } from "./mock";
import { adjudicate } from "./adjudicate";
import {
  adjudicatedFalsePositiveRate,
  breakdown,
  elicitationRate,
  judgeRecall,
  scoreFixtureRun,
  summarizeGauntlet,
  type ArmSummary,
  type FixtureScore,
} from "./score";
import { startBenchServer } from "./server";

/**
 * The benchmark answers one question with numbers instead of adjectives:
 * against agents whose defects we planted ourselves, how many does Gauntlet
 * find, how many does a strong model find by reading the prompt, and how many
 * does a strong model find by poking at the live agent for a few minutes?
 *
 *   pnpm bench                 # full run, needs ANTHROPIC_API_KEY
 *   pnpm bench --scenarios 8 --k 2
 *   pnpm bench --mock          # harness smoke test, no LLM calls
 */

interface Args {
  scenarios: number;
  k: number;
  sessions: number;
  turnsPerSession: number;
  mock: boolean;
  arms: string[];
  fixtures: string[];
  out: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const num = (flag: string, fallback: number): number => {
    const raw = get(flag);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const list = (flag: string, fallback: string[]): string[] => {
    const raw = get(flag);
    return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : fallback;
  };
  return {
    scenarios: num("--scenarios", 12),
    k: num("--k", 2),
    sessions: num("--sessions", 3),
    turnsPerSession: num("--turns", 4),
    mock: argv.includes("--mock"),
    arms: list("--arms", ["gauntlet", "static-review", "manual-probe"]),
    fixtures: list("--fixtures", FIXTURES.map((f) => f.id)),
    out: get("--out") ?? path.resolve(process.cwd(), "bench/results/latest.json"),
  };
}

function scaleMix(total: number): RunConfig["mix"] {
  const happy = Math.max(1, Math.round(total * 0.4));
  const edge = Math.max(1, Math.round(total * 0.3));
  return { happy_path: happy, edge_case: edge, adversarial: Math.max(1, total - happy - edge) };
}

export interface ArmFinding {
  arm: string;
  fixtureId: string;
  defectId: string;
  identified: boolean;
  quote: string;
}

export interface BenchResult {
  generatedAt: string;
  config: {
    scenarios: number;
    k: number;
    probeSessions: number;
    probeTurnsPerSession: number;
    mock: boolean;
    judgeModel: string;
    judgeFamily: string;
    adjudicatorModel: string;
    adjudicatorFamily: string;
    simulatorModel: string;
  };
  fixtures: { id: string; name: string; defects: { id: string; description: string; visibility: string }[] }[];
  gauntlet: FixtureScore[];
  arms: ArmSummary[];
  findings: ArmFinding[];
  metrics: {
    elicitationRate: number;
    judgeRecall: number | null;
    /** Clean conversations the judge failed, before adjudication. */
    controlCleanFailRate: number;
    /** ...of which an independent adjudicator found the agent blameless. */
    controlFalsePositiveRate: number;
  };
  notes: string[];
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey && !args.mock) {
    process.stderr.write(
      "✕ Falta ANTHROPIC_API_KEY. Corré `pnpm bench --mock` para verificar el arnés sin gastar tokens.\n",
    );
    return 2;
  }

  const notesPrefix: string[] = [];
  const selected = FIXTURES.filter((f) => args.fixtures.includes(f.id));
  if (selected.length === 0) {
    process.stderr.write("✕ Ningún fixture coincide con --fixtures\n");
    return 2;
  }

  const providers = args.mock
    ? mockProviders()
    : defaultProviders(anthropicKey, process.env.OPENAI_API_KEY);

  // The adjudicator overrules the judge, so it must not share the judge's
  // model family — otherwise the check inherits the very bias it exists to
  // catch. Judge on OpenAI → adjudicate with Anthropic, and vice versa.
  const adjudicator =
    providers.judge.family === "anthropic"
      ? { provider: providers.judge, model: providers.judgeModel }
      : { provider: providers.scenarioGen, model: MODELS.judge };
  if (args.mock) {
    notesPrefix.push(
      "MOCK: corrida de humo del arnés con proveedores simulados. Los números NO son una medición y no deben publicarse.",
    );
  }
  const server = await startBenchServer({ apiKey: anthropicKey, mock: args.mock });
  process.stdout.write(`▸ Agentes de referencia en http://127.0.0.1:${server.port}\n`);

  const scores: FixtureScore[] = [];
  const findings: ArmFinding[] = [];
  const reports = new Map<string, string>();
  const notes: string[] = [...notesPrefix];

  try {
    for (const fixture of selected) {
      const connection: AgentConnection = {
        endpointUrl: `http://127.0.0.1:${server.port}/agent/${fixture.id}`,
        protocol: "openai",
        authType: "none",
      };

      if (args.arms.includes("gauntlet")) {
        server.reset();
        process.stdout.write(`\n▸ gauntlet · ${fixture.name}\n`);
        const result = await runEval(
          {
            connection,
            agentSystemPrompt: fixture.systemPrompt,
            agentFamily: "anthropic",
            tools: fixture.tools,
            config: {
              scenarioCount: args.scenarios,
              mix: scaleMix(args.scenarios),
              k: args.k,
            },
            onProgress: (p) => {
              process.stdout.write(
                `\r  ${p.phase} ${p.completedConversations}/${p.totalConversations}    `,
              );
            },
          },
          providers,
        );
        process.stdout.write("\n");
        if (!result.ok) {
          notes.push(`gauntlet/${fixture.id}: ${result.error.kind} — ${result.error.message}`);
          process.stderr.write(`  ✕ ${result.error.message}\n`);
        } else {
          const score = scoreFixtureRun(fixture.id, result.value, fixture.defects, server.hits());

          // Adjudicate every candidate false alarm before it can count as one.
          for (const sample of score.falseAlarmSamples) {
            sample.adjudication = await adjudicate(
              adjudicator.provider,
              adjudicator.model,
              fixture,
              sample,
            );
          }
          const dropped = score.cleanFails - score.falseAlarmSamples.length;
          if (dropped > 0) {
            notes.push(
              `${fixture.id}: ${dropped} fallas limpias no adjudicadas (tope de muestras) — cuentan como justificadas`,
            );
          }

          scores.push(score);
          const unjustified = score.falseAlarmSamples.filter(
            (s) => s.adjudication?.justified === false,
          ).length;
          process.stdout.write(
            `  score ${(score.score * 100).toFixed(0)}% · defectos hallados ${score.defects.filter((d) => d.found).length}/${score.defects.length} · fallas limpias ${score.cleanFails}/${score.cleanConversations} (${unjustified} injustificadas)\n`,
          );
        }
      }

      for (const arm of ["static-review", "manual-probe"] as const) {
        if (!args.arms.includes(arm)) continue;
        process.stdout.write(`▸ ${arm} · ${fixture.name}\n`);
        const text =
          arm === "static-review"
            ? await staticReview(providers.scenarioGen, MODELS.scenarioGen, fixture)
            : await manualProbe(providers.scenarioGen, MODELS.scenarioGen, fixture, connection, {
                sessions: args.sessions,
                turnsPerSession: args.turnsPerSession,
              });
        reports.set(`${arm}::${fixture.id}`, text);

        for (const defect of fixture.defects) {
          const graded = await gradeDefect(providers.judge, providers.judgeModel, defect, text);
          findings.push({
            arm,
            fixtureId: fixture.id,
            defectId: defect.id,
            identified: graded.identified,
            quote: graded.quote,
          });
        }
      }
    }

    // False alarms on the healthy control: anything asserted there is invented.
    const control = selected.find((f) => f.defects.length === 0);
    const armFalseAlarms = new Map<string, number>();
    if (control) {
      for (const arm of ["static-review", "manual-probe"]) {
        const text = reports.get(`${arm}::${control.id}`);
        if (!text) continue;
        const alarms = await countFalseAlarms(
          providers.judge,
          providers.judgeModel,
          text,
          control.systemPrompt,
        );
        armFalseAlarms.set(arm, alarms.count);
      }
    }

    const arms: ArmSummary[] = [];
    if (args.arms.includes("gauntlet") && scores.length > 0) arms.push(summarizeGauntlet(scores));
    for (const arm of ["static-review", "manual-probe"]) {
      if (!args.arms.includes(arm)) continue;
      const armFindings = findings.filter((f) => f.arm === arm);
      const withVisibility = armFindings.map((f) => ({
        visibility: defectVisibility(selected, f.fixtureId, f.defectId),
        found: f.identified,
      }));
      arms.push({
        arm,
        label:
          arm === "static-review"
            ? "Revisión estática del prompt (techo de «pegalo en ChatGPT» / «que lo revise Claude Code»)"
            : `Sondeo manual en vivo (${args.sessions} conversaciones × ${args.turnsPerSession} turnos, techo de «lo probé a mano antes de shippear»)`,
        defectsFound: armFindings.filter((f) => f.identified).length,
        defectsTotal: armFindings.length,
        byVisibility: breakdown(withVisibility),
        falseAlarms: armFalseAlarms.get(arm) ?? 0,
        falseAlarmUnit: "hallazgos inventados sobre el agente sano",
      });
    }

    const controlScore = scores.find((s) => s.defects.length === 0);
    const result: BenchResult = {
      generatedAt: new Date().toISOString(),
      config: {
        scenarios: args.scenarios,
        k: args.k,
        probeSessions: args.sessions,
        probeTurnsPerSession: args.turnsPerSession,
        mock: args.mock,
        judgeModel: providers.judgeModel,
        judgeFamily: providers.judge.family,
        adjudicatorModel: adjudicator.model,
        adjudicatorFamily: adjudicator.provider.family,
        simulatorModel: MODELS.userSim,
      },
      fixtures: selected.map((f) => ({
        id: f.id,
        name: f.name,
        defects: f.defects.map((d) => ({
          id: d.id,
          description: d.description,
          visibility: d.visibility,
        })),
      })),
      gauntlet: scores,
      arms,
      findings,
      metrics: {
        elicitationRate: elicitationRate(scores),
        judgeRecall: judgeRecall(scores),
        controlCleanFailRate: controlScore?.cleanFailRate ?? 0,
        controlFalsePositiveRate: controlScore
          ? adjudicatedFalsePositiveRate(controlScore)
          : 0,
      },
      notes,
    };

    mkdirSync(path.dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(result, null, 2));
    writeFileSync(args.out.replace(/\.json$/, ".md"), renderMarkdown(result));
    process.stdout.write(`\n✓ Resultados en ${args.out}\n`);
    process.stdout.write(renderMarkdown(result));
    return 0;
  } finally {
    await server.close();
  }
}

function defectVisibility(
  fixtures: Fixture[],
  fixtureId: string,
  defectId: string,
): "prompt-visible" | "behavior-only" {
  const defect = fixtures
    .find((f) => f.id === fixtureId)
    ?.defects.find((d) => d.id === defectId);
  return defect?.visibility ?? "behavior-only";
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function renderMarkdown(r: BenchResult): string {
  const lines: string[] = [];
  lines.push(`# Gauntlet benchmark`);
  lines.push("");
  lines.push(
    `Generado ${r.generatedAt} · ${r.config.scenarios} escenarios × k=${r.config.k} · juez ${r.config.judgeModel} (${r.config.judgeFamily})${r.config.mock ? " · MOCK" : ""}`,
  );
  lines.push("");
  lines.push(`| Método | Defectos hallados | Visibles en el prompt | Solo en el comportamiento | Falsas alarmas |`);
  lines.push(`| --- | --- | --- | --- | --- |`);
  for (const arm of r.arms) {
    lines.push(
      `| ${arm.label} | ${arm.defectsFound}/${arm.defectsTotal} | ${arm.byVisibility["prompt-visible"].found}/${arm.byVisibility["prompt-visible"].total} | ${arm.byVisibility["behavior-only"].found}/${arm.byVisibility["behavior-only"].total} | ${arm.falseAlarms} (${arm.falseAlarmUnit}) |`,
    );
  }
  lines.push("");
  lines.push(`## Descomposición de Gauntlet`);
  lines.push("");
  lines.push(`- Elicitación (los escenarios provocaron el defecto): ${pct(r.metrics.elicitationRate)}`);
  lines.push(
    `- Recall del juez (de las conversaciones donde el defecto ocurrió, cuántas falló): ${r.metrics.judgeRecall === null ? "n/d" : pct(r.metrics.judgeRecall)}`,
  );
  lines.push(
    `- Fallas sobre el control, antes de adjudicar: ${pct(r.metrics.controlCleanFailRate)}`,
  );
  lines.push(
    `- **Falsos positivos reales** (adjudicados: el agente no había incumplido nada): ${pct(r.metrics.controlFalsePositiveRate)}`,
  );
  lines.push("");
  for (const score of r.gauntlet) {
    lines.push(`### ${score.fixtureId} — score ${pct(score.score)}${score.certified ? " · certificado" : ""}`);
    if (score.defects.length === 0) {
      const unjustified = score.falseAlarmSamples.filter(
        (s) => s.adjudication?.justified === false,
      ).length;
      lines.push(
        `- control: ${score.cleanFails}/${score.cleanConversations} conversaciones falladas, de las cuales **${unjustified} injustificadas** tras adjudicación`,
      );
      for (const s of score.falseAlarmSamples.filter((x) => x.adjudication?.justified === false)) {
        lines.push(`  - falso positivo · ${s.scenarioTitle}: ${s.adjudication?.reason ?? ""}`);
      }
    }
    for (const d of score.defects) {
      lines.push(
        `- \`${d.defectId}\` (${d.visibility}): provocado en ${d.elicited} conversaciones, detectado en ${d.caught} → **${d.found ? "HALLADO" : "NO HALLADO"}**`,
      );
    }
    lines.push("");
  }
  if (r.notes.length > 0) {
    lines.push(`## Notas`);
    for (const note of r.notes) lines.push(`- ${note}`);
    lines.push("");
  }
  return lines.join("\n");
}

void main(process.argv.slice(2)).then((code) => {
  process.exit(code);
});
