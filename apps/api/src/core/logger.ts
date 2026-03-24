export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = {
  requestId?: string;
  route?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  key?: string;
  attempt?: number;
  [key: string]: unknown;
};

export class StructuredLogger {
  constructor(private service: string) {}

  debug(message: string, fields: LogFields = {}): void {
    this.log("debug", message, fields);
  }

  info(message: string, fields: LogFields = {}): void {
    this.log("info", message, fields);
  }

  warn(message: string, fields: LogFields = {}): void {
    this.log("warn", message, fields);
  }

  error(message: string, fields: LogFields = {}): void {
    this.log("error", message, fields);
  }

  private log(level: LogLevel, message: string, fields: LogFields): void {
    const record = {
      ts: new Date().toISOString(),
      level,
      service: this.service,
      message,
      ...fields,
    };

    const line = JSON.stringify(record);
    if (level === "error" || level === "warn") {
      console.error(line);
      return;
    }

    console.log(line);
  }
}
