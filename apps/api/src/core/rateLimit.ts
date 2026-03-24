import type { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

type Bucket = {
  count: number;
  windowStartMs: number;
};

export class InMemoryRateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  check(key: string, nowMs = Date.now()): RateLimitResult {
    const existing = this.buckets.get(key);

    if (!existing || nowMs - existing.windowStartMs >= this.windowMs) {
      this.buckets.set(key, { count: 1, windowStartMs: nowMs });
      return {
        allowed: true,
        limit: this.limit,
        remaining: Math.max(0, this.limit - 1),
        retryAfterSeconds: Math.ceil(this.windowMs / 1000),
      };
    }

    existing.count += 1;
    const remaining = Math.max(0, this.limit - existing.count);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.windowStartMs + this.windowMs - nowMs) / 1000)
    );

    return {
      allowed: existing.count <= this.limit,
      limit: this.limit,
      remaining,
      retryAfterSeconds,
    };
  }

  sweep(nowMs = Date.now()): void {
    for (const [key, bucket] of this.buckets.entries()) {
      if (nowMs - bucket.windowStartMs >= this.windowMs) {
        this.buckets.delete(key);
      }
    }
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

export function resolveClientKey(req: Request): string {
  const authHeader = req.header("authorization") || "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch?.[1]) {
    return `token:${hashToken(bearerMatch[1])}`;
  }

  const ip = req.ip || req.socket.remoteAddress || "unknown";
  return `ip:${ip}`;
}

export function createRateLimitMiddleware(options: {
  limiter: InMemoryRateLimiter;
  scope: string;
}): (req: Request, res: Response, next: NextFunction) => void {
  const { limiter, scope } = options;

  return (req, res, next) => {
    const key = `${scope}:${resolveClientKey(req)}`;
    const result = limiter.check(key);

    res.setHeader("X-RateLimit-Limit", String(result.limit));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));

    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      res.status(429).json({
        apiVersion: "v1",
        errorCode: "RATE_LIMITED",
        message: "Too many requests. Please wait and retry.",
      });
      return;
    }

    next();
  };
}
