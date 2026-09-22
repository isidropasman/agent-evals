import { NextResponse } from "next/server";
import { principalFromRequest } from "@/server/auth";
import { can } from "@/server/rbac";
import { disconnectSubscription } from "@/server/subscription-store";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const principal = await principalFromRequest(request);
  if (!principal) return NextResponse.json({ error: "workspace authentication required" }, { status: 401 });
  if (!can(principal.role, "admin")) return NextResponse.json({ error: "insufficient role" }, { status: 403 });
  const { id } = await context.params;
  const disconnected = await disconnectSubscription(principal.workspace.id, id);
  return disconnected ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "suscripción no encontrada" }, { status: 404 });
}
