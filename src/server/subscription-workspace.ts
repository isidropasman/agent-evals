import { getSharedDefaultWorkspace } from "./shared-workspace-store";
import { sharedDatabaseEnabled } from "./shared-db";
import { getDefaultWorkspace } from "./workspace-store";

export async function subscriptionWorkspaceId(): Promise<string> {
  return sharedDatabaseEnabled() ? (await getSharedDefaultWorkspace()).id : getDefaultWorkspace().id;
}
