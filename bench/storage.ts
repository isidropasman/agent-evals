import { loadEnvConfig } from "@next/env";
import { queryShared, sharedDatabaseEnabled } from "../src/server/shared-db";

loadEnvConfig(process.cwd());

async function main(): Promise<number> {
  if (!sharedDatabaseEnabled()) {
    process.stderr.write("DATABASE_URL is required for the shared storage benchmark\n");
    return 2;
  }

  const samples: number[] = [];
  for (let index = 0; index < 20; index += 1) {
    const started = performance.now();
    const result = await queryShared("SELECT 1 AS ok");
    if (!result.ok) {
      process.stderr.write(`${result.error}\n`);
      return 2;
    }
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  const p50 = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  process.stdout.write(JSON.stringify({ provider: "neon-postgres-http", samples: samples.length, p50Ms: Number(p50.toFixed(2)), p95Ms: Number(p95.toFixed(2)), maxMs: Number(Math.max(...samples).toFixed(2)) }, null, 2) + "\n");
  return 0;
}

void main().then((code) => {
  process.exitCode = code;
});

function percentile(values: number[], quantile: number): number {
  const index = Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1);
  return values[index] ?? 0;
}
