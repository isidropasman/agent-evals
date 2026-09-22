import { NextResponse } from "next/server";
import { disconnectSubscription } from "@/server/subscription-store";
import { subscriptionWorkspaceId } from "@/server/subscription-workspace";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const disconnected = await disconnectSubscription(await subscriptionWorkspaceId(), id);
  return disconnected
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "suscripción no encontrada" }, { status: 404 });
}
