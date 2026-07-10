import { lookup } from "node:dns/promises";
import net from "node:net";
import type { EngineResult } from "./types";

/**
 * Loopback/private/link-local agents are allowed only in dev or behind an
 * explicit opt-in — a black-box tester that POSTs to arbitrary user-supplied
 * URLs is an SSRF primitive otherwise (cloud metadata at 169.254.169.254,
 * internal services on 10/8, etc.).
 */
function localAllowed(): boolean {
  return (
    process.env.GAUNTLET_ALLOW_LOCAL_AGENTS === "1" ||
    process.env.NODE_ENV !== "production"
  );
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const b = Number(p);
    if (!Number.isInteger(b) || b < 0 || b > 255) return null;
    n = n * 256 + b;
  }
  return n >>> 0;
}

// "always" = never reachable regardless of the local-agents flag (cloud
// metadata, link-local, unspecified, reserved). "local" = loopback + private
// LAN, reachable only when local agents are explicitly allowed.
type IpClass = "public" | "local" | "always";

function classifyIpv4(ip: string): IpClass {
  const n = ipv4ToInt(ip);
  if (n === null) return "always"; // unparseable → treat as blocked
  const inRange = (base: string, bits: number) => {
    const b = ipv4ToInt(base);
    if (b === null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  };
  // Always blocked — no flag opens these. 169.254/16 covers cloud metadata.
  if (
    inRange("0.0.0.0", 8) ||
    inRange("169.254.0.0", 16) ||
    inRange("192.0.0.0", 24) ||
    inRange("198.18.0.0", 15) ||
    inRange("240.0.0.0", 4)
  ) {
    return "always";
  }
  // Loopback + private LAN — reachable only behind the local-agents flag.
  if (
    inRange("10.0.0.0", 8) ||
    inRange("100.64.0.0", 10) ||
    inRange("127.0.0.0", 8) ||
    inRange("172.16.0.0", 12) ||
    inRange("192.168.0.0", 16)
  ) {
    return "local";
  }
  return "public";
}

function classifyIpv6(ip: string): IpClass {
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped?.[1]) return classifyIpv4(mapped[1]);
  if (lower === "::") return "always"; // unspecified
  if (
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb")
  ) {
    return "always"; // fe80::/10 link-local
  }
  if (lower === "::1") return "local"; // loopback
  const firstByte = parseInt(lower.split(":")[0] || "0", 16);
  if ((firstByte & 0xfe00) === 0xfc00) return "local"; // fc00::/7 unique-local
  return "public";
}

function classifyIp(ip: string): IpClass {
  return net.isIPv4(ip) ? classifyIpv4(ip) : classifyIpv6(ip);
}

/**
 * Parse + validate a user-supplied agent endpoint. Enforces scheme, resolves
 * the hostname, and rejects any address that lands in a private/loopback/
 * link-local range (unless local agents are explicitly allowed).
 *
 * ponytail: validate-then-fetch has a DNS-rebinding TOCTOU gap. Full fix is a
 * pinned-IP connect (undici Agent with a custom `connect`/`lookup`). Re-check
 * here + in the connector is the current ceiling; upgrade if you serve
 * untrusted multi-tenant traffic.
 */
export async function assertAllowedUrl(
  rawUrl: string,
): Promise<EngineResult<URL>> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      ok: false,
      error: { kind: "config_error", message: "URL inválida" },
    };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return {
      ok: false,
      error: { kind: "config_error", message: "El endpoint debe ser http(s)" },
    };
  }
  if (url.protocol === "http:" && !localAllowed()) {
    return {
      ok: false,
      error: {
        kind: "config_error",
        message: "En producción el endpoint debe ser HTTPS",
      },
    };
  }

  const allowLocal = localAllowed();
  const host = url.hostname;

  // Resolve every A/AAAA record and reject if any is in a blocked range.
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return {
      ok: false,
      error: {
        kind: "connector_unreachable",
        message: `No se pudo resolver ${host}`,
      },
    };
  }
  if (addresses.length === 0) {
    return {
      ok: false,
      error: { kind: "config_error", message: `Sin registros A/AAAA para ${host}` },
    };
  }

  for (const { address } of addresses) {
    const cls = classifyIp(address);
    if (cls === "always") {
      return {
        ok: false,
        error: {
          kind: "config_error",
          message: `El endpoint resuelve a una dirección reservada/metadata (${address}) y está bloqueado`,
        },
      };
    }
    if (cls === "local" && !allowLocal) {
      return {
        ok: false,
        error: {
          kind: "config_error",
          message: `El endpoint resuelve a una dirección privada/loopback (${address}) y está bloqueado`,
        },
      };
    }
  }

  return { ok: true, value: url };
}
