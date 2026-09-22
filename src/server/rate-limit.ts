import { queryShared } from "./shared-db";

const localBuckets = new Map<string, { count: number; expiresAt: number }>();

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}
export async function checkRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitResult> {
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) {
    const result = await queryShared<{ count: unknown; expires_at: unknown }>(
      `INSERT INTO rate_limit_buckets (bucket_key, window_started_at, count, expires_at)
       VALUES ($1, $2, 1, $3)
       ON CONFLICT (bucket_key) DO UPDATE SET
         window_started_at = CASE WHEN rate_limit_buckets.expires_at <= $4 THEN $2 ELSE rate_limit_buckets.window_started_at END,
         count = CASE WHEN rate_limit_buckets.expires_at <= $4 THEN 1 ELSE rate_limit_buckets.count + 1 END,
         expires_at = CASE WHEN rate_limit_buckets.expires_at <= $4 THEN $3 ELSE rate_limit_buckets.expires_at END
       RETURNING count, expires_at`,
      [key, now, now + windowMs, now],
    );
    const row = result.ok ? result.rows[0] : undefined;
    const count = typeof row?.count === "number" ? row.count : Number(row?.count ?? limit + 1);
    const resetAt = typeof row?.expires_at === "number" ? row.expires_at : Number(row?.expires_at ?? now + windowMs);
    return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), resetAt };
  }
  const existing = localBuckets.get(key);
  const bucket = existing && existing.expiresAt > now ? existing : { count: 0, expiresAt: now + windowMs };
  bucket.count += 1;
  localBuckets.set(key, bucket);
  return { allowed: bucket.count <= limit, limit, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.expiresAt };
}

export function rateLimitKey(request: Request, scope: string, subject: string | null): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `${scope}:${subject ?? forwarded ?? "anonymous"}`;
}
