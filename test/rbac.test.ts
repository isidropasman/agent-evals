import { describe, expect, it } from "vitest";
import { can, isWorkspaceRole } from "@/server/rbac";

describe("workspace RBAC", () => {
  it("enforces ordered least privilege", () => {
    expect(can("viewer", "viewer")).toBe(true);
    expect(can("viewer", "developer")).toBe(false);
    expect(can("developer", "viewer")).toBe(true);
    expect(can("admin", "developer")).toBe(true);
    expect(can("developer", "admin")).toBe(false);
  });

  it("accepts only persisted roles", () => {
    expect(isWorkspaceRole("owner")).toBe(true);
    expect(isWorkspaceRole("root")).toBe(false);
    expect(isWorkspaceRole(null)).toBe(false);
  });
});
