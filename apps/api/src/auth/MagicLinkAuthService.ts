import { createHash, randomUUID } from "node:crypto";
import type {
  EmailAuthRequestResponse,
  EmailAuthVerifyResponse,
} from "@replymate/contracts";
import { deriveAccountId, issueHostedSessionForAccount, normalizeEmail, resolveDeploymentMode } from "../core/authSession.js";
import { ApiError } from "../core/errors.js";
import type { HostedStateRepository } from "../persistence/HostedStateRepository.js";
import type { BillingRepository } from "../persistence/BillingRepository.js";
import type { EmailDeliveryAdapter } from "./EmailDeliveryAdapter.js";

const DEFAULT_MAGIC_LINK_TTL_MINUTES = 15;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function resolveMagicLinkTtlMinutes(): number {
  const raw = Number(process.env.REPLYMATE_MAGIC_LINK_TTL_MINUTES || DEFAULT_MAGIC_LINK_TTL_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAGIC_LINK_TTL_MINUTES;
}

function resolveWebAppBaseUrl(): string {
  return (
    process.env.REPLYMATE_WEB_APP_BASE_URL?.trim() ||
    (resolveDeploymentMode() === "hosted_public"
      ? "https://app.replymate.app"
      : "http://localhost:5173")
  ).replace(/\/+$/, "");
}

export class MagicLinkAuthService {
  constructor(
    private readonly hostedStateRepository: HostedStateRepository,
    private readonly billingRepository: BillingRepository,
    private readonly emailDelivery: EmailDeliveryAdapter
  ) {}

  async requestMagicLink(input: { email: string }): Promise<EmailAuthRequestResponse> {
    const email = normalizeEmail(input.email);
    const rawToken = `ml_${randomUUID().replace(/-/g, "")}`;
    const now = Date.now();
    const expiresAt = new Date(now + resolveMagicLinkTtlMinutes() * 60 * 1000).toISOString();
    await this.billingRepository.createMagicLink({
      magicLinkId: `magic_${randomUUID().replace(/-/g, "")}`,
      email,
      tokenHash: hashToken(rawToken),
      expiresAt,
      createdAt: new Date(now).toISOString(),
    });

    await this.emailDelivery.sendMagicLink({
      email,
      verificationUrl: `${resolveWebAppBaseUrl()}/login?token=${encodeURIComponent(rawToken)}`,
      expiresAt,
    });

    return {
      apiVersion: "v1",
      deploymentMode: resolveDeploymentMode(),
      accepted: true,
    };
  }

  async verifyMagicLink(input: {
    token: string;
    userAgent?: string;
  }): Promise<EmailAuthVerifyResponse> {
    const record = await this.billingRepository.getMagicLinkByTokenHash(hashToken(input.token.trim()));
    if (!record || record.consumedAt || Date.parse(record.expiresAt) <= Date.now()) {
      throw new ApiError({
        message: "This ReplyMate login link is invalid or expired.",
        errorCode: "UNAUTHORIZED",
        statusCode: 401,
      });
    }

    await this.billingRepository.consumeMagicLink(record.magicLinkId, new Date().toISOString());

    const existingAccount = await this.hostedStateRepository.findAccountByEmail(record.email);
    const account =
      existingAccount ||
      (await this.hostedStateRepository.upsertAccount({
        accountId: deriveAccountId(record.email),
        email: record.email,
        plan: "starter",
        subscriptionState: "inactive",
        betaAccess: false,
      }));

    return issueHostedSessionForAccount({
      account,
      repository: this.hostedStateRepository,
      userAgent: input.userAgent,
    });
  }
}
