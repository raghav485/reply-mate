// =============================================================================
// Logger — Structured console logger
// =============================================================================

import type { Logger as ILogger } from "@replymate/contracts";

function formatLogMessage(prefix: string, message: string, data?: Record<string, unknown>): string {
  if (!data || Object.keys(data).length === 0) {
    return `[${prefix}] ${message}`;
  }

  try {
    return `[${prefix}] ${message} ${JSON.stringify(data)}`;
  } catch {
    return `[${prefix}] ${message}`;
  }
}

export class ConsoleLogger implements ILogger {
  private prefix: string;

  constructor(prefix = "ReplyMate") {
    this.prefix = prefix;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    console.debug(formatLogMessage(this.prefix, message, data));
  }

  info(message: string, data?: Record<string, unknown>): void {
    console.info(formatLogMessage(this.prefix, message, data));
  }

  warn(message: string, data?: Record<string, unknown>): void {
    console.warn(formatLogMessage(this.prefix, message, data));
  }

  error(message: string, data?: Record<string, unknown>): void {
    console.error(formatLogMessage(this.prefix, message, data));
  }
}
