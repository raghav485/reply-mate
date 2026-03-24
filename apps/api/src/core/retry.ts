import { ApiError } from "./errors.js";
import type { StructuredLogger } from "./logger.js";

function isTransientError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.retryable;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("tempor") ||
    message.includes("econnreset") ||
    message.includes("ehostunreach") ||
    message.includes("network") ||
    message.includes("503") ||
    message.includes("502")
  );
}

export async function withRetry<T>(options: {
  attempts: number;
  operationName: string;
  logger: StructuredLogger;
  run: () => Promise<T>;
}): Promise<T> {
  const attempts = Math.max(1, options.attempts);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await options.run();
    } catch (error) {
      lastError = error;
      const retryable = isTransientError(error);

      options.logger.warn("retry_attempt_failed", {
        operation: options.operationName,
        attempt,
        attempts,
        retryable,
        error: error instanceof Error ? error.message : String(error),
      });

      if (!retryable || attempt >= attempts) {
        throw error;
      }

      const backoffMs = 150 * attempt;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError;
}
