import type { RunReport, ScenarioCategory } from "../engine/types";
import type { ResolvedRun } from "./config";

const CAT_LABEL: Record<ScenarioCategory, string> = {
  happy_path: "Happy path ",
  edge_case: "Edge cases ",
  adversarial: "Adversarial",
};

// ANSI colors — plain strings, no dependency.
const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[38;5;149m",
  red: "\x1b[38;5;203m",
  amber: "\x1b[38;5;215m",
};

/** Simple greedy word-wrap so the profile summary doesn't run off a narrow
 * terminal — joined with a newline + indent matching the caller's prefix. */
function wrap(text: string, width: number): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && (current + " " + word).length > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.join("\n  ");
}

function bar(rate: number, width = 20): string {
  const filled = Math.round(rate * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function rateColor(rate: number, floor: number): string {
  if (rate >= floor) return c.green;
  if (rate >= floor * 0.6) return c.amber;
  return c.red;
}

/** Whether the run clears the CI gate. */
export function passesGate(report: RunReport, run: ResolvedRun): boolean {
  if (report.score < run.gate.minScore) return false;
  return report.categories.every(
    (cat) => cat.total === 0 || cat.rate >= run.gate.minCategoryRate,
  );
}

export function renderReport(report: RunReport, run: ResolvedRun): string {
  const lines: string[] = [];
  const passed = passesGate(report, run);
  const scorePct = Math.round(report.score * 100);
  const verdictColor = passed ? c.green : c.red;

  lines.push("");
  lines.push(`${c.bold}  GAUNTLET${c.reset}${c.dim} · ${run.agentName}${c.reset}`);
  lines.push(`  ${c.dim}${"─".repeat(48)}${c.reset}`);

  const profile = report.profile;
  const modeLabel = profile.mode === "task" ? "Procesamiento" : "Conversacional";
  const isFallback = profile.capabilities.length === 0;
  lines.push(
    `  ${c.dim}Entendido como:${c.reset} ${c.bold}${modeLabel}${c.reset} ${c.dim}(confianza: ${profile.modeConfidence})${c.reset}`,
  );
  if (!isFallback) {
    lines.push(`  ${c.dim}${wrap(profile.summary, 78)}${c.reset}`);
    if (profile.toolsDetected.length > 0) {
      lines.push(`  ${c.dim}Tools detectadas: ${profile.toolsDetected.join(", ")}${c.reset}`);
    }
  } else {
    lines.push(`  ${c.amber}⚠ ${profile.modeRationale}${c.reset}`);
  }
  lines.push("");

  lines.push(
    `  ${verdictColor}${c.bold}${scorePct}/100${c.reset}  ${verdictColor}${passed ? "PASA EL GATE" : "NO PASA"}${c.reset}` +
      `   ${c.dim}${report.totals.passed}/${report.totals.scenarios} escenarios · ${report.totals.conversations} conversaciones · pass^${run.k}${c.reset}`,
  );
  lines.push("");

  for (const cat of report.categories) {
    const col = rateColor(cat.rate, run.gate.minCategoryRate);
    lines.push(
      `  ${CAT_LABEL[cat.category]}  ${col}${bar(cat.rate)}${c.reset}  ${col}${String(Math.round(cat.rate * 100)).padStart(3)}%${c.reset}  ${c.dim}(${cat.passed}/${cat.total})${c.reset}`,
    );
  }
  lines.push("");

  if (report.judgeFamilyDisclaimer) {
    lines.push(`  ${c.amber}⚠ ${report.judgeFamilyDisclaimer}${c.reset}`);
    lines.push("");
  }

  const failed = report.scenarioResults.filter((r) => !r.passK);
  if (failed.length > 0) {
    lines.push(`  ${c.bold}Escenarios fallidos${c.reset} ${c.dim}(${failed.length})${c.reset}`);
    for (const r of failed.slice(0, 12)) {
      const failedAttempt = r.attempts.find((a) => !a.verdict.pass) ?? r.attempts[0];
      const reason = failedAttempt?.verdict.failedCriteria.join(", ") || "—";
      lines.push(
        `    ${c.red}✕${c.reset} ${c.dim}${r.scenario.id.padEnd(16)}${c.reset} ${r.scenario.title}`,
      );
      lines.push(`      ${c.dim}${reason}${c.reset}`);
    }
    if (failed.length > 12) {
      lines.push(`    ${c.dim}… y ${failed.length - 12} más (ver gauntlet-report.json)${c.reset}`);
    }
    lines.push("");
  }

  if (report.fixes.length > 0) {
    lines.push(`  ${c.bold}Fixes sugeridos${c.reset} ${c.dim}(${report.fixes.length})${c.reset}`);
    for (const fix of report.fixes) {
      lines.push(`    ${c.amber}▸${c.reset} ${fix.problem}`);
    }
    lines.push(`    ${c.dim}Diffs completos en gauntlet-report.json${c.reset}`);
    lines.push("");
  }

  return lines.join("\n");
}
