import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "../rateLimit.js";

describe("InMemoryRateLimiter", () => {
  it("allows requests within the window and blocks after the limit", () => {
    const limiter = new InMemoryRateLimiter(2, 1_000);
    const now = 100_000;

    const first = limiter.check("k", now);
    const second = limiter.check("k", now + 10);
    const third = limiter.check("k", now + 20);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets after the window", () => {
    const limiter = new InMemoryRateLimiter(1, 1_000);
    const now = 200_000;

    expect(limiter.check("key", now).allowed).toBe(true);
    expect(limiter.check("key", now + 10).allowed).toBe(false);
    expect(limiter.check("key", now + 1_100).allowed).toBe(true);
  });
});
