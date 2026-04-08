import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../core/errors.js";

function normalizeHostname(value: string | undefined): string {
  return (value || "").replace(/^::ffff:/, "").toLowerCase();
}

function isLoopbackHost(hostname: string | undefined): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

export function isLoopbackRequest(req: Request): boolean {
  const ip = normalizeHostname(req.ip);
  const forwarded = normalizeHostname(
    typeof req.headers["x-forwarded-for"] === "string"
      ? req.headers["x-forwarded-for"].split(",")[0]?.trim()
      : undefined
  );
  const hostHeader = typeof req.headers.host === "string" ? req.headers.host.split(":")[0] : "";
  return isLoopbackHost(ip) || isLoopbackHost(forwarded) || isLoopbackHost(hostHeader);
}

function readBearerToken(req: Request): string {
  const header = req.header("authorization") || "";
  return header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

export function createSensitiveEndpointMiddleware(options: {
  getRuntimeToken(): string;
  getConfiguredApiToken(): string;
}) {
  return function requireSensitiveEndpointAccess(
    req: Request,
    _res: Response,
    next: NextFunction
  ): void {
    const bearerToken = readBearerToken(req);
    if (
      bearerToken &&
      (bearerToken === options.getRuntimeToken() ||
        bearerToken === options.getConfiguredApiToken())
    ) {
      next();
      return;
    }

    const devHeader = req.header("x-replymate-dev-sensitive") === "1";
    const devAllowed = process.env.REPLYMATE_ENABLE_DEV_SENSITIVE_HTTP !== "0";
    if (devAllowed && devHeader && isLoopbackRequest(req)) {
      next();
      return;
    }

    next(
      new ApiError({
        message: "ReplyMate sensitive local runtime access is restricted to the native bridge.",
        errorCode: "UNAUTHORIZED",
        statusCode: 401,
      })
    );
  };
}
