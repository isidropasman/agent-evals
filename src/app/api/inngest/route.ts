import { serve } from "inngest/next";
import { gateWorker } from "@/server/gate-worker";
import { inngest } from "@/server/durable-gates";

export const runtime = "nodejs";
export const { GET, POST, PUT } = serve({ client: inngest, functions: [gateWorker] });
