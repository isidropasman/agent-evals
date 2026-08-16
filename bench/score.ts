import type { RunReport } from "../src/engine/types";
import type { Defect } from "./fixtures";
import type { DefectHit } from "./server";

/**
 * Scoring is deliberately pure and free of LLM judgement: a defect either
 * fired in a conversation (the fixture recorded it) or it did not, and the
 * judge either failed that conversation or it did not. Everything below is
 * counting.
 */

export interface DefectOutcome {
  defectId: string;
  description: string;
  visibility: Defect["visibility"];
  /** Conversations in which the planted defect actually happened. Zero means
   * the test suite never provoked it — a scenario-generation miss, not a
   * judging miss. */
  elicited: number;
  /** Of the elicited conversations, how many the judge marked as failures. */
  caught: number;
  /** The product-level question: did the run surface this defect at all? */
  found: boolean;
}

/** A conversation the judge failed even though no planted defect fired —
 * i.e. a candidate false positive, with the judge's own reasoning attached.
 * A false-alarm rate with no examples is a dead end; these are what you read
 * to find out whether the judge is wrong or the agent really did misbehave. */
export interface FalseAlarmSample {
  scenarioTitle: string;
  category: string;
  successCriteria: string;
  failedCriteria: string[];
  rationale: string;
  /** Needed to adjudicate: you cannot tell a wrong verdict from a correct one
   * without reading what the agent actually said. */
  transcript: string;
  /** Filled in by adjudication (see bench/adjudicate.ts). `justified` means
   * the agent really did violate its own stated rules and the judge was
   * right — only `unjustified` is a true false positive. */
  adjudication?: { justified: boolean; reason: string };
}

export interface FixtureScore {
  fixtureId: string;
  conversations: number;
  defects: DefectOutcome[];
  /** Conversations where no planted defect fired — the agent behaved. */
  cleanConversations: number;
  /** ...of which the judge failed anyway. This is the false-alarm signal. */
  cleanFails: number;
  cleanFailRate: number;
  /** A few of those clean failures, verbatim, for diagnosis. */
  falseAlarmSamples: FalseAlarmSample[];
  /** What Gauntlet itself reported for this agent. */
  score: number;
  certified: boolean;
}

/** Cap on clean failures kept per fixture for adjudication. Bounds cost; the
 * report says how many were dropped so the rate is never read as exhaustive. */
const MAX_SAMPLES = 10;

export function sessionKey(scenarioId: string, attempt: number): string {
  return `${scenarioId}-a${attempt}`;
}

export function scoreFixtureRun(
  fixtureId: string,
  report: RunReport,
  defects: Defect[],
  hits: DefectHit[],
): FixtureScore {
  const conversations = report.scenarioResults.flatMap((s) =>
    s.attempts.map((a) => ({
      key: sessionKey(a.scenarioId, a.attempt),
      failed: !a.verdict.pass,
      unevaluated: a.unevaluated === true,
      scenario: s.scenario,
      verdict: a.verdict,
      transcript: a.transcript
        .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
        .join("\n\n"),
    })),
  );
  const byKey = new Map(conversations.map((c) => [c.key, c]));

  const relevantHits = hits.filter((h) => h.fixtureId === fixtureId);
  const firedKeys = new Set(relevantHits.map((h) => h.sessionId));

  const defectOutcomes: DefectOutcome[] = defects.map((d) => {
    const keys = new Set(
      relevantHits.filter((h) => h.defectId === d.id).map((h) => h.sessionId),
    );
    let elicited = 0;
    let caught = 0;
    for (const key of keys) {
      const conv = byKey.get(key);
      if (!conv) continue; // fired outside a scored conversation (e.g. preflight probe)
      if (conv.unevaluated) continue; // no verdict — can't credit or blame the judge
      elicited++;
      if (conv.failed) caught++;
    }
    return {
      defectId: d.id,
      description: d.description,
      visibility: d.visibility,
      elicited,
      caught,
      found: caught > 0,
    };
  });

  // A conversation nobody could judge is evidence about the harness, not
  // about the agent — it belongs in neither the numerator nor the denominator
  // of a false-alarm rate.
  const clean = conversations.filter((c) => !firedKeys.has(c.key) && !c.unevaluated);
  const cleanFailures = clean.filter((c) => c.failed);

  return {
    fixtureId,
    conversations: conversations.length,
    defects: defectOutcomes,
    cleanConversations: clean.length,
    cleanFails: cleanFailures.length,
    cleanFailRate: clean.length > 0 ? cleanFailures.length / clean.length : 0,
    falseAlarmSamples: cleanFailures.slice(0, MAX_SAMPLES).map((c) => ({
      scenarioTitle: c.scenario.title,
      category: c.scenario.category,
      successCriteria: c.scenario.successCriteria,
      failedCriteria: c.verdict.failedCriteria,
      rationale: c.verdict.rationale,
      transcript: c.transcript.slice(0, 12000),
    })),
    score: report.score,
    certified: report.certified,
  };
}

export interface VisibilityBreakdown {
  found: number;
  total: number;
}

export interface ArmSummary {
  arm: string;
  label: string;
  defectsFound: number;
  defectsTotal: number;
  byVisibility: Record<Defect["visibility"], VisibilityBreakdown>;
  /** Specific defect claims made about the control agent, which has none.
   * For Gauntlet this is a measured conversation-level rate; for the review
   * arms it is a count of distinct invented findings. */
  falseAlarms: number;
  falseAlarmUnit:
    | "% de conversaciones del agente sano falladas sin que hubiera incumplimiento (adjudicado)"
    | "hallazgos inventados sobre el agente sano";
}

/**
 * The honest false-positive rate: clean conversations the judge failed AND an
 * independent adjudicator found the agent had done nothing wrong, over all
 * clean conversations. Un-adjudicated samples count as justified, so this is a
 * lower bound — it never flatters the product by guessing.
 */
export function adjudicatedFalsePositiveRate(score: FixtureScore): number {
  if (score.cleanConversations === 0) return 0;
  const unjustified = score.falseAlarmSamples.filter(
    (s) => s.adjudication?.justified === false,
  ).length;
  return unjustified / score.cleanConversations;
}

export function summarizeGauntlet(scores: FixtureScore[]): ArmSummary {
  const all = scores.flatMap((s) => s.defects);
  const control = scores.find((s) => s.defects.length === 0);
  return {
    arm: "gauntlet",
    label: "Gauntlet (simulación multi-turno sistemática, pass^k, juez binario)",
    defectsFound: all.filter((d) => d.found).length,
    defectsTotal: all.length,
    byVisibility: breakdown(all.map((d) => ({ visibility: d.visibility, found: d.found }))),
    falseAlarms: control
      ? Math.round(adjudicatedFalsePositiveRate(control) * 1000) / 10
      : 0,
    falseAlarmUnit:
      "% de conversaciones del agente sano falladas sin que hubiera incumplimiento (adjudicado)",
  };
}

export function breakdown(
  items: { visibility: Defect["visibility"]; found: boolean }[],
): Record<Defect["visibility"], VisibilityBreakdown> {
  const result: Record<Defect["visibility"], VisibilityBreakdown> = {
    "prompt-visible": { found: 0, total: 0 },
    "behavior-only": { found: 0, total: 0 },
  };
  for (const item of items) {
    const slot = result[item.visibility];
    slot.total++;
    if (item.found) slot.found++;
  }
  return result;
}

/** Elicitation is the scenario generator's score, separate from the judge's:
 * a defect never provoked was never given a chance to be judged. */
export function elicitationRate(scores: FixtureScore[]): number {
  const defects = scores.flatMap((s) => s.defects);
  if (defects.length === 0) return 0;
  return defects.filter((d) => d.elicited > 0).length / defects.length;
}

/** Of the defects that did fire, how often the judge called them out. This is
 * the judge's score in isolation. */
export function judgeRecall(scores: FixtureScore[]): number | null {
  const fired = scores.flatMap((s) => s.defects).filter((d) => d.elicited > 0);
  if (fired.length === 0) return null;
  const totalElicited = fired.reduce((sum, d) => sum + d.elicited, 0);
  const totalCaught = fired.reduce((sum, d) => sum + d.caught, 0);
  return totalElicited > 0 ? totalCaught / totalElicited : null;
}
