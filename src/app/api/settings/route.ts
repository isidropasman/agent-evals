import { NextResponse } from "next/server";
import { keyStatus, storeKey, type KeyProvider } from "@/server/keys";

export const runtime = "nodejs";

const PROVIDERS: KeyProvider[] = ["anthropic", "openai"];

/** Never returns a key — only whether one exists, where it came from, and a
 * masked preview good enough to recognise it. */
export function GET() {
  return NextResponse.json({
    anthropic: keyStatus("anthropic"),
    openai: keyStatus("openai"),
  });
}

interface SaveBody {
  provider?: string;
  /** Empty string or null clears the stored key. */
  apiKey?: string | null;
}

export async function POST(req: Request) {
  let body: SaveBody;
  try {
    body = (await req.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const provider = PROVIDERS.find((p) => p === body.provider);
  if (!provider) {
    return NextResponse.json(
      { error: `provider debe ser uno de: ${PROVIDERS.join(", ")}` },
      { status: 400 },
    );
  }

  const raw = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (raw.length === 0) {
    storeKey(provider, null);
    return NextResponse.json({ [provider]: keyStatus(provider) });
  }

  // Cheap shape check so a pasted-wrong value fails here instead of 200 LLM
  // calls later. Deliberately loose — key formats change.
  if (raw.length < 20 || /\s/.test(raw)) {
    return NextResponse.json(
      { error: "Eso no parece una API key válida (muy corta o con espacios)." },
      { status: 400 },
    );
  }

  storeKey(provider, raw);
  return NextResponse.json({ [provider]: keyStatus(provider) });
}
