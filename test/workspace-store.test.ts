import { describe, expect, it } from "vitest";
import {
  createWorkspaceKey,
  getDefaultWorkspace,
  resolveWorkspaceKey,
} from "@/server/workspace-store";

describe("workspace credentials", () => {
  it("creates and resolves a default workspace key without storing raw material", () => {
    const workspace = getDefaultWorkspace();
    const created = createWorkspaceKey(workspace.id, "test key");

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.token).toMatch(/^gk_[a-f0-9]{10}_[A-Za-z0-9_-]+$/);
    expect(created.value.prefix).not.toBe(created.value.token);
    expect(resolveWorkspaceKey(created.value.token)?.id).toBe(workspace.id);
    expect(resolveWorkspaceKey(`Bearer ${created.value.token}`)?.id).toBe(workspace.id);
  });

  it("rejects unknown and altered credentials", () => {
    const workspace = getDefaultWorkspace();
    const created = createWorkspaceKey(workspace.id, "another test key");

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(resolveWorkspaceKey(null)).toBeNull();
    expect(resolveWorkspaceKey("gk_unknown_secret")).toBeNull();
    expect(resolveWorkspaceKey(`${created.value.token}x`)).toBeNull();
  });

  it("returns a typed error for an unknown workspace", () => {
    expect(createWorkspaceKey("missing-workspace", "invalid")).toEqual({
      ok: false,
      error: "workspace_not_found",
    });
  });
});
