import { describe, expect, it } from "vitest";
import { GET as metrics } from "@/app/api/metrics/route";
import { POST as createKey } from "@/app/api/v1/keys/route";

describe("metrics route", () => {
  it("requires a workspace key and returns aggregate metrics only", async () => {
    expect((await metrics(new Request("http://localhost/api/metrics"))).status).toBe(401);
    const keyResponse = await createKey(new Request("http://localhost/api/v1/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: `metrics-${Date.now()}` }) }));
    const body = (await keyResponse.json()) as { key: { token: string } };
    const response = await metrics(new Request("http://localhost/api/metrics", { headers: { authorization: `Bearer ${body.key.token}` } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ traces: expect.any(Object), evaluation: expect.any(Object), queue: expect.any(Object) });
  });
});
