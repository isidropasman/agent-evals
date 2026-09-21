import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/shared-store", () => ({
  sharedListCasesResult: vi.fn(),
}));

import { enqueueGate } from "@/server/durable-gates";
import { sharedListCasesResult } from "@/server/shared-store";

const originalEnvironment = {
  databaseUrl: process.env.DATABASE_URL,
  postgresUrl: process.env.POSTGRES_URL,
  storage: process.env.GAUNTLET_STORAGE,
  eventKey: process.env.INNGEST_EVENT_KEY,
  signingKey: process.env.INNGEST_SIGNING_KEY,
};

afterEach(() => {
  restore("DATABASE_URL", originalEnvironment.databaseUrl);
  restore("POSTGRES_URL", originalEnvironment.postgresUrl);
  restore("GAUNTLET_STORAGE", originalEnvironment.storage);
  restore("INNGEST_EVENT_KEY", originalEnvironment.eventKey);
  restore("INNGEST_SIGNING_KEY", originalEnvironment.signingKey);
});

describe("durable gates", () => {
  it("fails closed before creating a gate when Inngest credentials are missing", async () => {
    process.env.DATABASE_URL = "postgres://unreachable.test/gauntlet";
    delete process.env.POSTGRES_URL;
    delete process.env.GAUNTLET_STORAGE;
    delete process.env.INNGEST_EVENT_KEY;
    delete process.env.INNGEST_SIGNING_KEY;

    await expect(enqueueGate("workspace_local", { version: "test" })).resolves.toEqual({
      ok: false,
      error: "queue_unavailable",
      message: "durable queue unavailable",
    });
  });

  it("fails closed when Postgres cannot list cases", async () => {
    process.env.DATABASE_URL = "postgres://unreachable.test/gauntlet";
    delete process.env.POSTGRES_URL;
    delete process.env.GAUNTLET_STORAGE;
    process.env.INNGEST_EVENT_KEY = "event-key";
    process.env.INNGEST_SIGNING_KEY = "signing-key";
    vi.mocked(sharedListCasesResult).mockResolvedValue({ ok: false, error: "database unavailable" });

    await expect(enqueueGate("workspace_local", { version: "test" })).resolves.toEqual({
      ok: false,
      error: "queue_unavailable",
      message: "durable queue unavailable",
    });
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
