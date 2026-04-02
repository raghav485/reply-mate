import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  AccountPlan,
  AccountSummary,
  BetaSessionResponse,
  DeploymentMode,
  HostedSession,
  RefreshSessionResponse,
} from "@replymate/contracts";
import type { HostedStateRepository } from "../persistence/HostedStateRepository.js";
import { ApiError } from "./errors.js";

export type InviteRecord = {
  email: string;
  inviteCode: string;
  plan: AccountPlan;
  displayName?: string;
};

type AccessTokenPayload = {
  kind: "access";
  sessionId: string;
  accountId: string;
  exp: number;
};

type RefreshTokenPayload = {
  kind: "refresh";
  sessionId: string;
  tokenId: string;
  exp: number;
};

const DEFAULT_ACCESS_TTL_SECONDS = 60 * 60;
const DEFAULT_REFRESH_TTL_DAYS = 30;

function toBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function deriveAccountId(email: string): string {
  return `acct_${createHmac("sha256", "replymate-account").update(email).digest("hex").slice(0, 16)}`;
}

function signPayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function parseInviteRecord(raw: string): InviteRecord | null {
  const [emailRaw, inviteCodeRaw, planRaw, displayNameRaw] = raw.split(":");
  const email = normalizeEmail(emailRaw || "");
  const inviteCode = (inviteCodeRaw || "").trim();
  const plan = (planRaw || "beta").trim();
  if (!email || !inviteCode) {
    return null;
  }
  if (!["beta", "starter", "pro", "enterprise"].includes(plan)) {
    return null;
  }
  return {
    email,
    inviteCode,
    plan: plan as AccountPlan,
    displayName: displayNameRaw?.trim() || undefined,
  };
}

function encodeToken(payload: AccessTokenPayload | RefreshTokenPayload, secret: string): string {
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${signPayload(encodedPayload, secret)}`;
}

function decodeToken(
  token: string,
  secret: string
): AccessTokenPayload | RefreshTokenPayload | null {
  const [encodedPayload, encodedSignature] = token.split(".");
  if (!encodedPayload || !encodedSignature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload, secret);
  const signatureBuffer = Buffer.from(encodedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(encodedPayload).toString("utf8")) as
      | Partial<AccessTokenPayload>
      | Partial<RefreshTokenPayload>;
    if (
      typeof parsed.kind !== "string" ||
      typeof parsed.sessionId !== "string" ||
      typeof parsed.exp !== "number" ||
      parsed.exp <= Date.now()
    ) {
      return null;
    }

    if (parsed.kind === "access" && typeof parsed.accountId === "string") {
      return {
        kind: "access",
        sessionId: parsed.sessionId,
        accountId: parsed.accountId,
        exp: parsed.exp,
      };
    }

    if (parsed.kind === "refresh" && typeof parsed.tokenId === "string") {
      return {
        kind: "refresh",
        sessionId: parsed.sessionId,
        tokenId: parsed.tokenId,
        exp: parsed.exp,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function resolveSessionAccessTtlSeconds(): number {
  const raw = Number(process.env.REPLYMATE_SESSION_ACCESS_TTL_SECONDS || DEFAULT_ACCESS_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ACCESS_TTL_SECONDS;
}

function resolveSessionRefreshTtlDays(): number {
  const raw = Number(process.env.REPLYMATE_SESSION_REFRESH_TTL_DAYS || DEFAULT_REFRESH_TTL_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_REFRESH_TTL_DAYS;
}

function buildHostedSession(input: {
  account: AccountSummary;
  accessToken: string;
  refreshToken: string;
  accessExpiresAtMs: number;
  refreshExpiresAtMs: number;
}): HostedSession {
  return {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    accessExpiresAt: new Date(input.accessExpiresAtMs).toISOString(),
    refreshExpiresAt: new Date(input.refreshExpiresAtMs).toISOString(),
    account: input.account,
  };
}

export function resolveDeploymentMode(): DeploymentMode {
  const raw = process.env.REPLYMATE_DEPLOYMENT_MODE?.trim();
  if (raw === "hosted_beta" || raw === "hosted_public") {
    return raw;
  }
  return "local";
}

export function resolveSessionSecret(): string {
  return (
    process.env.REPLYMATE_AUTH_SESSION_SECRET?.trim() ||
    process.env.REPLYMATE_API_TOKEN?.trim() ||
    ""
  );
}

export function parseBetaInvites(raw = process.env.REPLYMATE_BETA_INVITES?.trim() || ""): InviteRecord[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(parseInviteRecord)
    .filter((item): item is InviteRecord => Boolean(item));
}

export function findInviteByCredentials(input: {
  email: string;
  inviteCode: string;
  invites?: InviteRecord[];
}): InviteRecord | null {
  const email = normalizeEmail(input.email);
  const inviteCode = input.inviteCode.trim();
  return (
    (input.invites || parseBetaInvites()).find(
      (invite) => invite.email === email && invite.inviteCode === inviteCode
    ) || null
  );
}

export async function issueHostedBetaSession(input: {
  invite: InviteRecord;
  repository: HostedStateRepository;
  userAgent?: string;
  nowMs?: number;
}): Promise<BetaSessionResponse> {
  const secret = resolveSessionSecret();
  if (!secret) {
    throw new ApiError({
      message: "Hosted session auth is not configured.",
      errorCode: "DRAFT_PROVIDER_UNAVAILABLE",
      statusCode: 503,
    });
  }

  const nowMs = input.nowMs ?? Date.now();
  const accessExpiresAtMs = nowMs + resolveSessionAccessTtlSeconds() * 1000;
  const refreshExpiresAtMs =
    nowMs + resolveSessionRefreshTtlDays() * 24 * 60 * 60 * 1000;
  const account = await input.repository.upsertAccount({
    accountId: deriveAccountId(input.invite.email),
    email: input.invite.email,
    plan: input.invite.plan,
    subscriptionState: input.invite.plan === "beta" ? "beta" : "active",
    betaAccess: true,
    displayName: input.invite.displayName,
  });

  const sessionId = `sess_${randomUUID().replace(/-/g, "")}`;
  const refreshToken = encodeToken(
    {
      kind: "refresh",
      sessionId,
      tokenId: randomUUID(),
      exp: refreshExpiresAtMs,
    },
    secret
  );
  await input.repository.createSession({
    sessionId,
    accountId: account.accountId,
    refreshTokenHash: hashToken(refreshToken),
    refreshExpiresAt: new Date(refreshExpiresAtMs).toISOString(),
    createdAt: new Date(nowMs).toISOString(),
    userAgent: input.userAgent,
  });

  const accessToken = encodeToken(
    {
      kind: "access",
      sessionId,
      accountId: account.accountId,
      exp: accessExpiresAtMs,
    },
    secret
  );

  return {
    apiVersion: "v1",
    deploymentMode: resolveDeploymentMode(),
    session: buildHostedSession({
      account,
      accessToken,
      refreshToken,
      accessExpiresAtMs,
      refreshExpiresAtMs,
    }),
  };
}

export async function issueHostedSessionForAccount(input: {
  account: AccountSummary;
  repository: HostedStateRepository;
  userAgent?: string;
  nowMs?: number;
}): Promise<{ apiVersion: string; deploymentMode: DeploymentMode; session: HostedSession }> {
  const secret = resolveSessionSecret();
  if (!secret) {
    throw new ApiError({
      message: "Hosted session auth is not configured.",
      errorCode: "DRAFT_PROVIDER_UNAVAILABLE",
      statusCode: 503,
    });
  }

  const nowMs = input.nowMs ?? Date.now();
  const accessExpiresAtMs = nowMs + resolveSessionAccessTtlSeconds() * 1000;
  const refreshExpiresAtMs =
    nowMs + resolveSessionRefreshTtlDays() * 24 * 60 * 60 * 1000;
  const sessionId = `sess_${randomUUID().replace(/-/g, "")}`;
  const refreshToken = encodeToken(
    {
      kind: "refresh",
      sessionId,
      tokenId: randomUUID(),
      exp: refreshExpiresAtMs,
    },
    secret
  );

  await input.repository.createSession({
    sessionId,
    accountId: input.account.accountId,
    refreshTokenHash: hashToken(refreshToken),
    refreshExpiresAt: new Date(refreshExpiresAtMs).toISOString(),
    createdAt: new Date(nowMs).toISOString(),
    userAgent: input.userAgent,
  });

  const accessToken = encodeToken(
    {
      kind: "access",
      sessionId,
      accountId: input.account.accountId,
      exp: accessExpiresAtMs,
    },
    secret
  );

  return {
    apiVersion: "v1",
    deploymentMode: resolveDeploymentMode(),
    session: buildHostedSession({
      account: input.account,
      accessToken,
      refreshToken,
      accessExpiresAtMs,
      refreshExpiresAtMs,
    }),
  };
}

export async function refreshHostedSession(input: {
  refreshToken: string;
  repository: HostedStateRepository;
}): Promise<RefreshSessionResponse> {
  const secret = resolveSessionSecret();
  if (!secret) {
    throw new ApiError({
      message: "Hosted session auth is not configured.",
      errorCode: "DRAFT_PROVIDER_UNAVAILABLE",
      statusCode: 503,
    });
  }

  const payload = decodeToken(input.refreshToken, secret);
  if (!payload || payload.kind !== "refresh") {
    throw new ApiError({
      message: "Refresh token is invalid or expired.",
      errorCode: "UNAUTHORIZED",
      statusCode: 401,
    });
  }

  const session = await input.repository.getSessionByRefreshTokenHash(hashToken(input.refreshToken));
  if (
    !session ||
    session.sessionId !== payload.sessionId ||
    session.revokedAt ||
    Date.parse(session.refreshExpiresAt) <= Date.now()
  ) {
    throw new ApiError({
      message: "Refresh token is invalid or expired.",
      errorCode: "UNAUTHORIZED",
      statusCode: 401,
    });
  }

  const account = await input.repository.getAccount(session.accountId);
  if (!account) {
    throw new ApiError({
      message: "ReplyMate account not found for this session.",
      errorCode: "UNAUTHORIZED",
      statusCode: 401,
    });
  }

  const accessExpiresAtMs = Date.now() + resolveSessionAccessTtlSeconds() * 1000;
  const accessToken = encodeToken(
    {
      kind: "access",
      sessionId: session.sessionId,
      accountId: session.accountId,
      exp: accessExpiresAtMs,
    },
    secret
  );
  await input.repository.touchSession(session.sessionId);

  return {
    apiVersion: "v1",
    deploymentMode: resolveDeploymentMode(),
    session: buildHostedSession({
      account,
      accessToken,
      refreshToken: input.refreshToken,
      accessExpiresAtMs,
      refreshExpiresAtMs: Date.parse(session.refreshExpiresAt),
    }),
  };
}

export async function readAccountFromSessionToken(input: {
  token: string;
  repository: HostedStateRepository;
}): Promise<{ account: AccountSummary; sessionId: string } | null> {
  const secret = resolveSessionSecret();
  if (!secret) {
    return null;
  }

  const payload = decodeToken(input.token, secret);
  if (!payload || payload.kind !== "access") {
    return null;
  }

  const session = await input.repository.getSession(payload.sessionId);
  if (!session || session.revokedAt) {
    return null;
  }

  const account = await input.repository.getAccount(payload.accountId);
  if (!account) {
    return null;
  }

  await input.repository.touchSession(session.sessionId);
  return {
    account,
    sessionId: session.sessionId,
  };
}

export async function revokeSessionFromAccessToken(input: {
  token: string;
  repository: HostedStateRepository;
}): Promise<void> {
  const secret = resolveSessionSecret();
  if (!secret) {
    return;
  }

  const payload = decodeToken(input.token, secret);
  if (!payload || payload.kind !== "access") {
    return;
  }

  await input.repository.revokeSession(payload.sessionId, new Date().toISOString());
}
