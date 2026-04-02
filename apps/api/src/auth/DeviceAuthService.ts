import { randomUUID } from "node:crypto";
import type {
  DeviceAuthCompleteResponse,
  DeviceAuthPollResponse,
  DeviceAuthStartResponse,
} from "@replymate/contracts";
import { issueHostedSessionForAccount, resolveDeploymentMode } from "../core/authSession.js";
import { ApiError } from "../core/errors.js";
import type { BillingRepository } from "../persistence/BillingRepository.js";
import type { HostedStateRepository } from "../persistence/HostedStateRepository.js";

const DEFAULT_DEVICE_AUTH_TTL_SECONDS = 10 * 60;
const DEFAULT_DEVICE_POLL_INTERVAL_MS = 2_000;

function resolveDeviceAuthTtlSeconds(): number {
  const raw = Number(process.env.REPLYMATE_DEVICE_AUTH_TTL_SECONDS || DEFAULT_DEVICE_AUTH_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DEVICE_AUTH_TTL_SECONDS;
}

function resolveDevicePollIntervalMs(): number {
  const raw = Number(process.env.REPLYMATE_DEVICE_AUTH_POLL_INTERVAL_MS || DEFAULT_DEVICE_POLL_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DEVICE_POLL_INTERVAL_MS;
}

function resolveWebAppBaseUrl(): string {
  return (
    process.env.REPLYMATE_WEB_APP_BASE_URL?.trim() ||
    (resolveDeploymentMode() === "hosted_public"
      ? "https://app.replymate.app"
      : "http://localhost:5173")
  ).replace(/\/+$/, "");
}

function createUserCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const chars = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export class DeviceAuthService {
  constructor(
    private readonly billingRepository: BillingRepository,
    private readonly hostedStateRepository: HostedStateRepository
  ) {}

  async start(input: { client?: string }): Promise<DeviceAuthStartResponse> {
    const now = Date.now();
    const expiresAt = new Date(now + resolveDeviceAuthTtlSeconds() * 1000).toISOString();
    const deviceCode = `dev_${randomUUID().replace(/-/g, "")}`;
    const userCode = createUserCode();
    await this.billingRepository.createDeviceAuth({
      deviceCode,
      userCode,
      client: input.client,
      expiresAt,
      createdAt: new Date(now).toISOString(),
    });

    return {
      apiVersion: "v1",
      deploymentMode: resolveDeploymentMode(),
      deviceCode,
      userCode,
      verificationUrl: `${resolveWebAppBaseUrl()}/login?code=${encodeURIComponent(userCode)}`,
      expiresAt,
      pollIntervalMs: resolveDevicePollIntervalMs(),
    };
  }

  async complete(input: {
    userCode: string;
    accountId: string;
  }): Promise<DeviceAuthCompleteResponse> {
    const current = await this.billingRepository.getDeviceAuthByUserCode(input.userCode.trim().toUpperCase());
    if (!current || current.consumedAt || current.deniedAt || Date.parse(current.expiresAt) <= Date.now()) {
      throw new ApiError({
        message: "ReplyMate device sign-in code is invalid or expired.",
        errorCode: "UNAUTHORIZED",
        statusCode: 401,
      });
    }

    await this.billingRepository.approveDeviceAuth({
      userCode: current.userCode,
      accountId: input.accountId,
      approvedAt: new Date().toISOString(),
    });

    return {
      apiVersion: "v1",
      deploymentMode: resolveDeploymentMode(),
      completed: true,
    };
  }

  async poll(input: {
    deviceCode: string;
    userAgent?: string;
  }): Promise<DeviceAuthPollResponse> {
    const current = await this.billingRepository.getDeviceAuthByDeviceCode(input.deviceCode.trim());
    if (!current) {
      throw new ApiError({
        message: "ReplyMate device sign-in session was not found.",
        errorCode: "UNAUTHORIZED",
        statusCode: 404,
      });
    }

    if (current.deniedAt) {
      return {
        apiVersion: "v1",
        deploymentMode: resolveDeploymentMode(),
        status: "denied",
        pollIntervalMs: resolveDevicePollIntervalMs(),
      };
    }

    if (Date.parse(current.expiresAt) <= Date.now()) {
      return {
        apiVersion: "v1",
        deploymentMode: resolveDeploymentMode(),
        status: "expired",
        pollIntervalMs: resolveDevicePollIntervalMs(),
      };
    }

    if (!current.accountId) {
      return {
        apiVersion: "v1",
        deploymentMode: resolveDeploymentMode(),
        status: "pending",
        pollIntervalMs: resolveDevicePollIntervalMs(),
      };
    }

    const account = await this.hostedStateRepository.getAccount(current.accountId);
    if (!account) {
      throw new ApiError({
        message: "ReplyMate account for this device sign-in could not be found.",
        errorCode: "UNAUTHORIZED",
        statusCode: 401,
      });
    }

    const session = await issueHostedSessionForAccount({
      account,
      repository: this.hostedStateRepository,
      userAgent: input.userAgent,
    });
    await this.billingRepository.consumeDeviceAuth(current.deviceCode, new Date().toISOString());

    return {
      apiVersion: "v1",
      deploymentMode: resolveDeploymentMode(),
      status: "approved",
      pollIntervalMs: resolveDevicePollIntervalMs(),
      session: session.session,
    };
  }
}
