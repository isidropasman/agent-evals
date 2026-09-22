import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("production dashboard auth", () => {
  it("fails closed when dashboard credentials are missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = middleware(new NextRequest("http://localhost/dashboard"));
    expect(response.status).toBe(503);
  });

  it("accepts browser Basic Auth and leaves API-key surfaces independent", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GAUNTLET_DASHBOARD_USER", "operator");
    vi.stubEnv("GAUNTLET_DASHBOARD_PASSWORD", "correct horse");
    const credentials = Buffer.from("operator:correct horse").toString("base64");
    const dashboard = middleware(new NextRequest("http://localhost/dashboard", {
      headers: { authorization: `Basic ${credentials}` },
    }));
    expect(dashboard.status).toBe(200);
    const api = middleware(new NextRequest("http://localhost/api/v1/cases"));
    expect(api.status).toBe(200);
  });

  it("rejects wrong browser credentials", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GAUNTLET_DASHBOARD_USER", "operator");
    vi.stubEnv("GAUNTLET_DASHBOARD_PASSWORD", "correct horse");
    const credentials = Buffer.from("operator:wrong").toString("base64");
    const response = middleware(new NextRequest("http://localhost/dashboard", {
      headers: { authorization: `Basic ${credentials}` },
    }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Basic");
  });
});
