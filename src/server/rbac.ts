export type WorkspaceRole = "owner" | "admin" | "developer" | "viewer";

const roleRank: Record<WorkspaceRole, number> = {
  viewer: 10,
  developer: 20,
  admin: 30,
  owner: 40,
};

export function can(role: WorkspaceRole, required: WorkspaceRole): boolean {
  return roleRank[role] >= roleRank[required];
}
export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return value === "owner" || value === "admin" || value === "developer" || value === "viewer";
}
