import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import type {
  AccountPreferences,
  AuthMode,
  DraftingProviderStatus,
  EvidenceSummary,
  GenerateDraftRequest,
  GenerateDraftResponse,
  ParserProviderStatus,
  TranscriptionResponse,
} from "@replymate/contracts";
import { ApiError, ProviderError, ValidationError, isApiError } from "./core/errors.js";
import {
  findInviteByCredentials,
  issueHostedBetaSession,
  refreshHostedSession as refreshHostedSessionToken,
  readAccountFromSessionToken,
  revokeSessionFromAccessToken,
  resolveDeploymentMode,
} from "./core/authSession.js";
import { BillingService } from "./billing/BillingService.js";
import { EntitlementService } from "./billing/EntitlementService.js";
import {
  getStripeBillingIntegrationReadiness,
  mapMissingBillingEnvFieldsToNames,
} from "./billing/readiness.js";
import { StripeBillingService } from "./billing/StripeBillingService.js";
import { selectGenerationPath, selectRemoteTranscriptionPath } from "./core/costPolicy.js";
import { StructuredLogger } from "./core/logger.js";
import { ConsoleEmailDeliveryAdapter } from "./auth/ConsoleEmailDeliveryAdapter.js";
import { DeviceAuthService } from "./auth/DeviceAuthService.js";
import { MagicLinkAuthService } from "./auth/MagicLinkAuthService.js";
import { loadLocalEnv } from "./bootstrap/loadEnv.js";
import { loadOrCreateLocalRuntimeToken } from "./native/runtimeAuth.js";
import { createSensitiveEndpointMiddleware } from "./native/sensitiveHttp.js";
import { parseMultipartFormData } from "./core/multipart.js";
import {
  InMemoryRateLimiter,
  createRateLimitMiddleware,
  resolveClientKey,
} from "./core/rateLimit.js";
import { withRetry } from "./core/retry.js";
import { createProviderRuntime } from "./providers/index.js";
import {
  buildProviderCredentialStatusResponse,
  getProviderCredentialStore,
  hydrateProviderConfigSecrets,
} from "./providers/providerCredentialStore.js";
import { resolveDraftingProviderSelection } from "./providers/requestScopedProviderConfig.js";
import { createBillingRepository, createHostedStateRepository } from "./persistence/index.js";
import {
  assertDatabaseConnection,
  assertDatabaseSchemaUpToDate,
  closeSharedDatabasePool,
} from "./persistence/db.js";
import {
  assertBillingSummary,
  assertEvidenceSummary,
  assertGenerateDraftResponse,
  assertTranscriptionResponse,
  parseBillingPortalRequest,
  parseCheckoutSessionRequest,
  parseDeviceAuthCompleteRequest,
  parseDeviceAuthPollRequest,
  parseDeviceAuthStartRequest,
  parseEmailAuthRequest,
  parseEmailAuthVerifyRequest,
  parseEvidenceIngestBody,
  parseEvidenceJobId,
  parseGenerateDraftRequest,
  parseMetricsBody,
  parseProviderCredentialDeleteRequest,
  parseProviderCredentialUpsertRequest,
  parseSettingsValidateBody,
  parseVoiceTranscribeBody,
  type EvidenceIngestBody,
} from "./schemas/index.js";
import { HostedAccountService } from "./services/HostedAccountService.js";
import { HostedEvidenceService } from "./services/HostedEvidenceService.js";

const app = express();
loadLocalEnv();
const PORT = Number(process.env.PORT || 3000);
const SERVER_VERSION = "0.3.0";
const logger = new StructuredLogger("replymate-api");
const providers = createProviderRuntime();
const providerCredentialStore = getProviderCredentialStore();
const hostedStateRepository = createHostedStateRepository();
const billingRepository = createBillingRepository();
const hostedAccountService = new HostedAccountService(hostedStateRepository);
const hostedEvidenceService = new HostedEvidenceService(
  hostedStateRepository,
  providers.storage
);
const entitlementService = new EntitlementService(billingRepository);
const stripeBillingService = new StripeBillingService();
const billingService = new BillingService(
  billingRepository,
  hostedStateRepository,
  entitlementService,
  stripeBillingService
);
const magicLinkAuthService = new MagicLinkAuthService(
  hostedStateRepository,
  billingRepository,
  new ConsoleEmailDeliveryAdapter(logger)
);
const deviceAuthService = new DeviceAuthService(billingRepository, hostedStateRepository);
const configuredApiToken = process.env.REPLYMATE_API_TOKEN?.trim() || "";
let localRuntimeToken = "";
const deploymentMode = resolveDeploymentMode();
const authMode: AuthMode = configuredApiToken ? "required" : "optional";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const MAX_SUMMARY_CHARS_PER_FILE = 1200;
const MAX_COMBINED_EVIDENCE_SUMMARY_CHARS = 3000;
const DRAFTING_PROVIDER_STATUS_TTL_MS = 30_000;

const SUPPORTED_EVIDENCE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
]);

const voiceLimiter = new InMemoryRateLimiter(30, 60_000);
const evidenceLimiter = new InMemoryRateLimiter(20, 60_000);
const generateLimiter = new InMemoryRateLimiter(20, 60_000);
const metricsLimiter = new InMemoryRateLimiter(120, 60_000);

const maintenanceTimer = setInterval(() => {
  voiceLimiter.sweep();
  evidenceLimiter.sweep();
  generateLimiter.sweep();
  metricsLimiter.sweep();
}, 60_000);
maintenanceTimer.unref();
const requireSensitiveEndpointAccess = createSensitiveEndpointMiddleware({
  getRuntimeToken: () => localRuntimeToken,
  getConfiguredApiToken: () => configuredApiToken,
});

let draftingProviderStatusCache: {
  status: DraftingProviderStatus;
  expiresAt: number;
} | null = null;
let parserProviderStatusCache: {
  status: ParserProviderStatus;
  expiresAt: number;
} | null = null;

type RequestWithContext = Request & {
  requestId?: string;
  account?: {
    accountId: string;
    email: string;
    plan: "beta" | "starter" | "pro" | "enterprise";
    subscriptionState: "inactive" | "beta" | "trialing" | "active" | "past_due" | "canceled";
    betaAccess: boolean;
    displayName?: string;
  };
  authKind?: "anonymous" | "api_token" | "session";
  sessionId?: string;
};

function inferMimeFromName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".md")) return "text/markdown";
  return "application/octet-stream";
}

function normalizeEvidenceMimeType(fileName: string, mimeType: string): string {
  const normalized = mimeType.toLowerCase().trim();
  if (!normalized || normalized === "application/octet-stream") {
    return inferMimeFromName(fileName);
  }
  if (normalized === "image/jpg") {
    return "image/jpeg";
  }
  return normalized;
}

function normalizeVoiceMimeType(raw: string | undefined): string {
  const normalized = raw?.toLowerCase().trim() || "";
  if (!normalized) return "audio/webm";
  return normalized;
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function maxSizeForEvidenceMimeType(mimeType: string): number {
  return isImageMimeType(mimeType) ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
}

function estimateParseTimeMs(sizeBytes: number, mimeType: string): number {
  if (mimeType === "application/pdf" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return Math.round((sizeBytes / 1024 / 1024) * 1800);
  }
  if (mimeType.startsWith("image/")) {
    return Math.round((sizeBytes / 1024 / 1024) * 900);
  }
  return Math.round((sizeBytes / 1024 / 1024) * 1200);
}

function shouldProcessEvidenceAsync(body: EvidenceIngestBody, mimeType: string): boolean {
  if (mimeType === "text/plain" || mimeType === "text/markdown") {
    return false;
  }

  if (
    mimeType.startsWith("image/") ||
    mimeType === "application/pdf" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return true;
  }

  return estimateParseTimeMs(body.sizeBytes, mimeType) > 3_000;
}

function isSupportedVoiceMimeType(mimeType: string): boolean {
  return mimeType.startsWith("audio/") || mimeType === "video/webm";
}

function decodeBase64Buffer(payload: string, label: string): Buffer {
  try {
    const out = Buffer.from(payload, "base64");
    if (out.byteLength <= 0) {
      throw new ValidationError(`${label} payload is empty.`);
    }
    return out;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError(`Invalid base64 ${label} payload.`);
  }
}

function getRequestId(req: Request): string {
  const requestId = (req as RequestWithContext).requestId;
  return requestId || "unknown";
}

function getRequestAccount(req: Request): RequestWithContext["account"] | undefined {
  return (req as RequestWithContext).account;
}

function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

function capEvidenceSummaries(evidence: EvidenceSummary[]): EvidenceSummary[] {
  let total = 0;
  const output: EvidenceSummary[] = [];

  for (const item of evidence) {
    if (total >= MAX_COMBINED_EVIDENCE_SUMMARY_CHARS) break;

    const cappedPerFile = item.summaryText.slice(0, MAX_SUMMARY_CHARS_PER_FILE);
    const remaining = MAX_COMBINED_EVIDENCE_SUMMARY_CHARS - total;
    const cappedCombined = cappedPerFile.slice(0, remaining);
    if (!cappedCombined) continue;

    output.push({
      ...item,
      summaryText: cappedCombined,
      summaryCharCount: cappedCombined.length,
      truncated:
        item.truncated ||
        cappedPerFile.length < item.summaryText.length ||
        cappedCombined.length < cappedPerFile.length,
      warnings:
        cappedCombined.length < item.summaryText.length
          ? [...item.warnings, "Evidence summary truncated to fit limits."]
          : item.warnings,
    });

    total += cappedCombined.length;
  }

  return output;
}

function invalidateDraftingProviderStatusCache(): void {
  draftingProviderStatusCache = null;
}

function invalidateParserProviderStatusCache(): void {
  parserProviderStatusCache = null;
}

function shouldInvalidateDraftingStatus(error: unknown): boolean {
  if (!isApiError(error)) {
    return false;
  }

  if (error.errorCode === "DRAFT_PROVIDER_UNAVAILABLE" || error.errorCode === "GENERATION_TIMEOUT") {
    return true;
  }

  return (
    error.errorCode === "GENERATION_FAILED" &&
    /runtime request failed|timed out|fetch failed|econnrefused|network/i.test(error.message)
  );
}

async function getDraftingProviderStatus(
  forceRefresh = false,
  providerSelection?: ReturnType<typeof resolveDraftingProviderSelection>
): Promise<DraftingProviderStatus> {
  if (providerSelection && providerSelection.mode !== "environment") {
    if (!providerSelection.provider) {
      return {
        runtimeType: providerSelection.runtimeType,
        ready: false,
        warning: "No drafting provider is configured for the selected mode.",
      };
    }

    const providerStatus = await providerSelection.provider.checkHealth();
    return {
      ...providerStatus,
      runtimeType: providerSelection.runtimeType,
    };
  }

  if (
    !forceRefresh &&
    draftingProviderStatusCache &&
    draftingProviderStatusCache.expiresAt > Date.now()
  ) {
    return draftingProviderStatusCache.status;
  }

  let status: DraftingProviderStatus;
  if (!providers.drafting.provider) {
    status = {
      runtimeType: providers.drafting.runtimeType,
      ready: false,
      warning: "No drafting provider is configured.",
      recommendedModelName: "qwen3:8b",
      setupHint: "Recommended for M4 / 16GB: qwen3:8b for writing.",
    };
  } else {
    const providerStatus = await providers.drafting.provider.checkHealth();
    status = {
      ...providerStatus,
      runtimeType: providers.drafting.runtimeType,
    };
  }

  draftingProviderStatusCache = {
    status,
    expiresAt: Date.now() + DRAFTING_PROVIDER_STATUS_TTL_MS,
  };
  return status;
}

async function getCloudGenerationAvailable(): Promise<boolean> {
  if (!providers.llm.cloud) {
    return false;
  }

  try {
    const status = await providers.llm.cloud.checkHealth();
    return status.ready;
  } catch {
    return false;
  }
}

function shouldInvalidateParserStatus(error: unknown): boolean {
  if (!isApiError(error)) {
    return false;
  }

  return (
    error.errorCode === "EVIDENCE_PARSE_FAILED" &&
    /runtime request failed|timed out|fetch failed|econnrefused|network|vision parser returned an empty response/i.test(
      error.message
    )
  );
}

async function getParserProviderStatus(forceRefresh = false): Promise<ParserProviderStatus> {
  if (
    !forceRefresh &&
    parserProviderStatusCache &&
    parserProviderStatusCache.expiresAt > Date.now()
  ) {
    return parserProviderStatusCache.status;
  }

  let status: ParserProviderStatus;
  if (providers.parser.runtimeType === "metadata_local") {
    status = await providers.parser.metadataFallback.checkHealth();
  } else if (!providers.parser.provider) {
    status = {
      runtimeType: providers.parser.runtimeType,
      ready: false,
      imageOcrAvailable: false,
      warning:
        providers.parser.runtimeType === "drafting_runtime"
          ? "Drafting runtime does not provide a local vision parser; using metadata-only summaries."
          : "No parser runtime is configured for image OCR.",
      fallbackMode: providers.parser.allowMetadataFallback ? "metadata_local" : "none",
      recommendedModelName: "minicpm-v",
      setupHint: "Recommended OCR model for M4 / 16GB: minicpm-v.",
    };
  } else {
    status = await providers.parser.provider.checkHealth();
  }

  if (providers.parser.runtimeType === "drafting_runtime") {
    status = {
      ...status,
      warning: status.ready && status.imageOcrAvailable
        ? status.warning
        : status.warning ||
          "Parser is reusing the drafting runtime. Dedicated OCR model recommended: minicpm-v.",
      recommendedModelName: status.recommendedModelName || "minicpm-v",
      setupHint:
        status.setupHint ||
        "Dedicated parser model recommended for M4 / 16GB: minicpm-v.",
    };
  }

  parserProviderStatusCache = {
    status,
    expiresAt: Date.now() + DRAFTING_PROVIDER_STATUS_TTL_MS,
  };
  return status;
}

async function summarizeEvidence(
  body: EvidenceIngestBody,
  mimeType: string,
  requestId: string
): Promise<EvidenceSummary> {
  const parserInput = {
    fileData: body.fileData,
    fileName: body.fileName,
    mimeType,
  };
  const parserStatus = isImageMimeType(mimeType)
    ? await getParserProviderStatus()
    : null;

  let parserResult: EvidenceSummary;
  let fallbackWarning: string | undefined;

  const useMetadataFallback = async (warning?: string): Promise<EvidenceSummary> => {
    const result = await withRetry({
      attempts: 2,
      operationName: "parser.metadataFallback",
      logger,
      run: () => providers.parser.metadataFallback.summarizeFile(parserInput),
    });

    if (warning) {
      result.warnings = [
        warning,
        ...result.warnings.filter(
          (item) =>
            item !== "Image OCR is not configured; using metadata-only summary." &&
            item !== "Visual content extraction is limited in local MVP parser mode."
        ),
      ];
    }

    return result;
  };

  if (!isImageMimeType(mimeType)) {
    parserResult = await useMetadataFallback();
  } else if (
    parserStatus?.ready &&
    parserStatus.imageOcrAvailable &&
    providers.parser.provider
  ) {
    try {
      parserResult = await withRetry({
        attempts: 2,
        operationName: "parser.imageOcr",
        logger,
        run: () => providers.parser.provider!.summarizeFile(parserInput),
      });
    } catch (error) {
      if (!providers.parser.allowMetadataFallback || !shouldInvalidateParserStatus(error)) {
        throw error;
      }

      invalidateParserProviderStatusCache();
      fallbackWarning =
        error instanceof Error
          ? `${error.message} Falling back to metadata-only image summary.`
          : "Image OCR failed. Falling back to metadata-only image summary.";
      parserResult = await useMetadataFallback(fallbackWarning);
    }
  } else if (providers.parser.allowMetadataFallback) {
    parserResult = await useMetadataFallback(
      parserStatus?.warning || "Image OCR is not configured; using metadata-only summary."
    );
  } else {
    throw new ApiError({
      message:
        parserStatus?.warning ||
        "Image OCR is unavailable and metadata fallback is disabled.",
      errorCode: "EVIDENCE_PARSE_FAILED",
      statusCode: 503,
    });
  }

  const summary: EvidenceSummary = {
    ...parserResult,
    name: body.fileName,
    mode: body.mode,
    mentionInReply: body.mentionInReply,
  };

  assertEvidenceSummary(summary);

  logger.info("evidence_summary_ready", {
    requestId,
    name: body.fileName,
    mimeType,
    confidence: summary.confidence,
    truncated: summary.truncated,
  });

  return summary;
}

function resolveEvidenceJobAccountId(req: Request): string {
  const account = getRequestAccount(req);
  if (account) {
    return account.accountId;
  }
  return deploymentMode === "local" ? "local_anonymous" : "";
}

function scheduleEvidenceJobProcessing(jobId: string, requestId: string): void {
  const timer = setTimeout(() => {
    void hostedEvidenceService
      .processJob(jobId, async (input) =>
        summarizeEvidence(
          {
            sessionId: `persisted:${jobId}`,
            fileData: input.fileData,
            fileName: input.fileName,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            mode: input.mode,
            mentionInReply: input.mentionInReply,
          },
          input.mimeType,
          requestId
        )
      )
      .catch((error: unknown) => {
        logger.error("evidence_job_failed", {
          requestId,
          jobId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, 900);
  timer.unref();
}

function buildEvidenceIngestBody(req: Request): EvidenceIngestBody {
  const contentType = req.headers["content-type"];
  if (!contentType?.startsWith("multipart/form-data")) {
    throw new ValidationError("Evidence ingest requires multipart/form-data.");
  }

  if (!Buffer.isBuffer(req.body)) {
    throw new ValidationError("Evidence ingest payload is missing multipart body.");
  }

  const parsed = parseMultipartFormData(contentType, req.body);
  if (!parsed.file) {
    throw new ValidationError("Evidence ingest payload is missing a file.");
  }

  return parseEvidenceIngestBody({
    sessionId: parsed.fields.sessionId,
    fileName: parsed.file.fileName,
    mimeType: parsed.file.mimeType,
    sizeBytes: parsed.file.data.byteLength,
    mode: parsed.fields.mode,
    mentionInReply: parsed.fields.mentionInReply === "true",
    fileData: parsed.file.data,
  });
}

app.use(
  cors({
    origin: [/^chrome-extension:\/\//],
  })
);

app.use((req, res, next) => {
  const requestId = randomUUID();
  (req as RequestWithContext).requestId = requestId;
  res.setHeader("x-request-id", requestId);

  const startedAt = Date.now();
  logger.info("request_started", {
    requestId,
    method: req.method,
    route: req.path,
    clientKey: resolveClientKey(req),
  });

  res.on("finish", () => {
    logger.info("request_completed", {
      requestId,
      method: req.method,
      route: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
});

app.use((req, _res, next) => {
  void (async () => {
  const request = req as RequestWithContext;
  request.authKind = "anonymous";

  if (
    req.method === "OPTIONS" ||
    req.path === "/v1/health" ||
    req.path === "/v1/settings/validate" ||
    req.path === "/v1/auth/beta-login" ||
    req.path === "/v1/auth/refresh" ||
    req.path === "/v1/auth/email/request" ||
    req.path === "/v1/auth/email/verify" ||
    req.path === "/v1/auth/device/start" ||
    req.path === "/v1/auth/device/poll" ||
    req.path === "/v1/billing/webhook"
  ) {
    next();
    return;
  }

  const authHeader = req.header("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim() || "";

  if (deploymentMode === "local" && token && configuredApiToken && token === configuredApiToken) {
    request.authKind = "api_token";
    next();
    return;
  }

  if (token) {
    const session = await readAccountFromSessionToken({
      token,
      repository: hostedStateRepository,
    });
    if (session) {
      request.authKind = "session";
      request.account = session.account;
      request.sessionId = session.sessionId;
      next();
      return;
    }
  }

  if (authMode === "optional") {
    next();
    return;
  }

  if (!token) {
    throw new ApiError({
      message:
        deploymentMode === "local"
          ? "Unauthorized. Check your API token in settings."
          : "Unauthorized. Check your ReplyMate session in settings.",
      errorCode: "UNAUTHORIZED",
      statusCode: 401,
    });
  }

  throw new ApiError({
    message:
      deploymentMode === "local"
        ? "Unauthorized. Check your ReplyMate session or API token in settings."
        : "Unauthorized. Check your ReplyMate session in settings.",
    errorCode: "UNAUTHORIZED",
    statusCode: 401,
  });
  })().catch(next);
});

app.post(
  "/v1/billing/webhook",
  express.raw({ type: "application/json", limit: "2mb" }),
  asyncRoute(async (req, res) => {
    const signatureHeader = req.header("stripe-signature") || "";
    if (!signatureHeader) {
      throw new ValidationError("Stripe webhook signature is required.", "BILLING_UNAVAILABLE");
    }
    if (!Buffer.isBuffer(req.body)) {
      throw new ValidationError("Stripe webhook payload must be raw JSON.", "BILLING_UNAVAILABLE");
    }

    const event = stripeBillingService.verifyWebhook({
      rawBody: req.body,
      signatureHeader,
    });
    await billingService.handleWebhook(event);
    res.json({ apiVersion: "v1", received: true });
  })
);

app.use(express.json({ limit: "50mb" }));

app.get("/v1/health", (_req, res) => {
  res.json({
    status: "ok",
    version: SERVER_VERSION,
    apiVersion: "v1",
    timestamp: new Date().toISOString(),
  });
});

app.post(
  "/v1/settings/validate",
  requireSensitiveEndpointAccess,
  asyncRoute(async (req, res) => {
    const body = parseSettingsValidateBody(req.body);
    const resolvedProviderConfig = await hydrateProviderConfigSecrets(
      body.providerConfig,
      providerCredentialStore
    );
    const providerSelection = resolveDraftingProviderSelection(
      providers,
      resolvedProviderConfig
    );
    const draftingProvider = await getDraftingProviderStatus(true, providerSelection);
    const parserProvider = await getParserProviderStatus(true);
    const cloudGenerationAvailable =
      providerSelection.providerPath === "cloud"
        ? draftingProvider.ready
        : await getCloudGenerationAvailable();
    const validateAuthHeader = req.header("authorization") || "";
    const validateToken = validateAuthHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
    const account =
      getRequestAccount(req) ||
      (validateToken &&
      !(deploymentMode === "local" && validateToken === configuredApiToken)
        ? (
            await readAccountFromSessionToken({
              token: validateToken,
              repository: hostedStateRepository,
            })
          )?.account
        : undefined);
    const warnings = [
      ...(authMode === "optional"
        ? ["Server auth is optional; no bearer token is currently enforced."]
        : ["Server auth requires an API token when one is configured."]
      ),
      ...(body.providerConfig?.mode === "byok_api"
        ? [
            "ReplyMate will use your own provider account directly. Evidence OCR and voice remain local-first unless separately configured.",
          ]
        : []),
      ...(body.providerConfig?.mode === "local_models"
        ? ["ReplyMate will use your configured local runtime for drafting."]
        : []),
      ...(draftingProvider.warning ? [draftingProvider.warning] : []),
      ...(parserProvider.warning ? [parserProvider.warning] : []),
      ...(providers.parser.runtimeType === "drafting_runtime"
        ? ["Dedicated parser model recommended for best OCR quality: minicpm-v."]
        : []),
    ];

    res.json({
      valid: draftingProvider.ready || cloudGenerationAvailable,
      warnings,
      apiVersion: "v1",
      serverVersion: SERVER_VERSION,
      deploymentMode,
      cloudGenerationAvailable,
      authMode,
      account,
      draftingProvider,
      parserProvider,
    });
  })
);

app.get(
  "/v1/settings/provider-credentials",
  requireSensitiveEndpointAccess,
  asyncRoute(async (_req, res) => {
    res.json(await buildProviderCredentialStatusResponse(providerCredentialStore));
  })
);

app.put(
  "/v1/settings/provider-credentials",
  requireSensitiveEndpointAccess,
  asyncRoute(async (req, res) => {
    const body = parseProviderCredentialUpsertRequest(req.body);
    await providerCredentialStore.writeCredential(body);
    res.json(await buildProviderCredentialStatusResponse(providerCredentialStore));
  })
);

app.delete(
  "/v1/settings/provider-credentials",
  requireSensitiveEndpointAccess,
  asyncRoute(async (req, res) => {
    const body = parseProviderCredentialDeleteRequest(req.body);
    await providerCredentialStore.deleteCredential(body);
    res.json(await buildProviderCredentialStatusResponse(providerCredentialStore));
  })
);

app.post(
  "/v1/auth/beta-login",
  asyncRoute(async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const inviteCode = typeof body?.inviteCode === "string" ? body.inviteCode.trim() : "";

    if (deploymentMode === "local") {
      throw new ApiError({
        message: "Hosted beta login is unavailable in local deployment mode.",
        errorCode: "UNAUTHORIZED",
        statusCode: 400,
      });
    }
    if (!email || !inviteCode) {
      throw new ValidationError("Email and invite code are required.");
    }

    const invite = findInviteByCredentials({ email, inviteCode });
    if (!invite) {
      throw new ApiError({
        message: "Invite code was not accepted for this email.",
        errorCode: "UNAUTHORIZED",
        statusCode: 401,
      });
    }

    res.json(
      await issueHostedBetaSession({
        invite,
        repository: hostedStateRepository,
        userAgent: req.header("user-agent") || undefined,
      })
    );
  })
);

app.post(
  "/v1/auth/email/request",
  createRateLimitMiddleware({ limiter: generateLimiter, scope: "email_auth_request" }),
  asyncRoute(async (req, res) => {
    const body = parseEmailAuthRequest(req.body);
    res.json(await magicLinkAuthService.requestMagicLink(body));
  })
);

app.post(
  "/v1/auth/email/verify",
  asyncRoute(async (req, res) => {
    const body = parseEmailAuthVerifyRequest(req.body);
    res.json(
      await magicLinkAuthService.verifyMagicLink({
        token: body.token,
        userAgent: req.header("user-agent") || undefined,
      })
    );
  })
);

app.post(
  "/v1/auth/device/start",
  asyncRoute(async (req, res) => {
    const body = parseDeviceAuthStartRequest(req.body);
    res.json(await deviceAuthService.start(body));
  })
);

app.post(
  "/v1/auth/device/poll",
  asyncRoute(async (req, res) => {
    const body = parseDeviceAuthPollRequest(req.body);
    res.json(
      await deviceAuthService.poll({
        deviceCode: body.deviceCode,
        userAgent: req.header("user-agent") || undefined,
      })
    );
  })
);

app.post(
  "/v1/auth/device/complete",
  asyncRoute(async (req, res) => {
    const account = getRequestAccount(req);
    if (!account) {
      throw new ApiError({
        message: "ReplyMate session is required.",
        errorCode: "UNAUTHORIZED",
        statusCode: 401,
      });
    }

    const body = parseDeviceAuthCompleteRequest(req.body);
    res.json(
      await deviceAuthService.complete({
        userCode: body.userCode,
        accountId: account.accountId,
      })
    );
  })
);

app.post(
  "/v1/auth/refresh",
  asyncRoute(async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const refreshToken =
      typeof body?.refreshToken === "string" ? body.refreshToken.trim() : "";
    if (!refreshToken) {
      throw new ValidationError("Refresh token is required.");
    }

    res.json(
      await refreshHostedSessionToken({
        refreshToken,
        repository: hostedStateRepository,
      })
    );
  })
);

app.post(
  "/v1/auth/logout",
  asyncRoute(async (req, res) => {
    const authHeader = req.header("authorization") || "";
    const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
    if (!token) {
      throw new ApiError({
        message: "ReplyMate session is required.",
        errorCode: "UNAUTHORIZED",
        statusCode: 401,
      });
    }

    await revokeSessionFromAccessToken({
      token,
      repository: hostedStateRepository,
    });

    res.json({
      apiVersion: "v1",
      revoked: true,
    });
  })
);

app.get(
  "/v1/billing/summary",
  asyncRoute(async (req, res) => {
    const account = getRequestAccount(req);
    if (!account) {
      throw new ApiError({
        message: "ReplyMate session is required.",
        errorCode: "UNAUTHORIZED",
        statusCode: 401,
      });
    }

    const summary = await billingService.getSummary(account);
    assertBillingSummary(summary);
    res.json(summary);
  })
);

app.post(
  "/v1/billing/checkout",
  asyncRoute(async (req, res) => {
    const account = getRequestAccount(req);
    if (!account) {
      throw new ApiError({
        message: "ReplyMate session is required.",
        errorCode: "UNAUTHORIZED",
        statusCode: 401,
      });
    }

    const body = parseCheckoutSessionRequest(req.body);
    res.json(
      await billingService.createCheckoutSession({
        account,
        successUrl: body.successUrl,
        cancelUrl: body.cancelUrl,
      })
    );
  })
);

app.post(
  "/v1/billing/portal",
  asyncRoute(async (req, res) => {
    const account = getRequestAccount(req);
    if (!account) {
      throw new ApiError({
        message: "ReplyMate session is required.",
        errorCode: "UNAUTHORIZED",
        statusCode: 401,
      });
    }

    const body = parseBillingPortalRequest(req.body);
    res.json(
      await billingService.createBillingPortal({
        account,
        returnUrl: body.returnUrl,
      })
    );
  })
);

app.get(
  "/v1/me",
  asyncRoute(async (req, res) => {
    const account = getRequestAccount(req);
    if (!account) {
      throw new ApiError({
        message: "ReplyMate session is required.",
        errorCode: "UNAUTHORIZED",
        statusCode: 401,
      });
    }

    res.json({
      apiVersion: "v1",
      deploymentMode,
      cloudGenerationAvailable: await getCloudGenerationAvailable(),
      account,
    });
  })
);

app.get(
  "/v1/me/preferences",
  asyncRoute(async (req, res) => {
    const account = getRequestAccount(req);
    if (!account) {
      throw new ApiError({
        message: "ReplyMate session is required.",
        errorCode: "UNAUTHORIZED",
        statusCode: 401,
      });
    }

    res.json({
      apiVersion: "v1",
      deploymentMode,
      preferences: await hostedAccountService.getPreferences(account.accountId),
    });
  })
);

app.put(
  "/v1/me/preferences",
  asyncRoute(async (req, res) => {
    const account = getRequestAccount(req);
    if (!account) {
      throw new ApiError({
        message: "ReplyMate session is required.",
        errorCode: "UNAUTHORIZED",
        statusCode: 401,
      });
    }

    const body = req.body as Partial<AccountPreferences> | undefined;
    const defaultTonePreset =
      body?.defaultTonePreset === "concise" ||
      body?.defaultTonePreset === "friendly" ||
      body?.defaultTonePreset === "professional" ||
      body?.defaultTonePreset === "empathetic" ||
      body?.defaultTonePreset === "confident"
        ? body.defaultTonePreset
        : null;
    const defaultCostMode =
      body?.defaultCostMode === "local_only" ||
      body?.defaultCostMode === "hybrid_low_cost" ||
      body?.defaultCostMode === "cloud_quality"
        ? body.defaultCostMode
        : null;
    if (!defaultTonePreset || !defaultCostMode) {
      throw new ValidationError("Account preferences payload is invalid.");
    }

    res.json({
      apiVersion: "v1",
      deploymentMode,
      preferences: await hostedAccountService.savePreferences(account.accountId, {
        defaultTonePreset,
        defaultCostMode,
      }),
    });
  })
);

app.get(
  "/v1/me/generations",
  asyncRoute(async (req, res) => {
    const account = getRequestAccount(req);
    if (!account) {
      throw new ApiError({
        message: "ReplyMate session is required.",
        errorCode: "UNAUTHORIZED",
        statusCode: 401,
      });
    }

    res.json({
      apiVersion: "v1",
      deploymentMode,
      generations: await hostedAccountService.listGenerationRecords(account.accountId),
    });
  })
);

app.post(
  "/v1/evidence/ingest",
  requireSensitiveEndpointAccess,
  createRateLimitMiddleware({ limiter: evidenceLimiter, scope: "evidence_ingest" }),
  express.raw({
    type: (req) => Boolean(req.headers["content-type"]?.startsWith("multipart/form-data")),
    limit: "50mb",
  }),
  asyncRoute(async (req, res) => {
    const requestId = getRequestId(req);
    const accountId = resolveEvidenceJobAccountId(req);
    const body = buildEvidenceIngestBody(req);
    const mimeType = normalizeEvidenceMimeType(body.fileName, body.mimeType);

    if (!SUPPORTED_EVIDENCE_MIME_TYPES.has(mimeType)) {
      throw new ValidationError(`Unsupported file type: ${mimeType}`, "UNSUPPORTED_FILE_TYPE");
    }

    const maxBytes = maxSizeForEvidenceMimeType(mimeType);
    if (body.sizeBytes > maxBytes) {
      throw new ValidationError(
        `File exceeds max allowed size for ${mimeType}`,
        "FILE_TOO_LARGE"
      );
    }

    if (shouldProcessEvidenceAsync(body, mimeType) && accountId) {
      const job = await hostedEvidenceService.createAsyncJob({
        accountId,
        fileName: body.fileName,
        mimeType,
        sizeBytes: body.sizeBytes,
        mode: body.mode,
        mentionInReply: body.mentionInReply,
        fileData: body.fileData,
      });
      scheduleEvidenceJobProcessing(job.jobId, requestId);

      res.json({
        apiVersion: "v1",
        mode: "async",
        job,
      });
      return;
    }

    const summary = await summarizeEvidence(body, mimeType, requestId);
    res.json({
      apiVersion: "v1",
      mode: "sync",
      result: summary,
    });
  })
);

app.get(
  "/v1/evidence/jobs/:jobId",
  requireSensitiveEndpointAccess,
  asyncRoute(async (req, res) => {
    const jobId = parseEvidenceJobId(req.params);
    const account = getRequestAccount(req);
    const job =
      deploymentMode === "local" && !account
        ? await hostedStateRepository.getEvidenceJob(jobId)
        : account
          ? await hostedEvidenceService.getJobForAccount(jobId, account.accountId)
          : null;

    if (!job) {
      throw new ApiError({
        message: "Evidence job not found.",
        errorCode: "EVIDENCE_PARSE_FAILED",
        statusCode: 404,
      });
    }

    res.json({
      apiVersion: "v1",
      job:
        "storageKey" in job
          ? {
              jobId: job.jobId,
              state: job.state,
              result: job.result,
              errorCode: job.errorCode,
            }
          : job,
    });
  })
);

app.post(
  "/v1/voice/transcribe",
  createRateLimitMiddleware({ limiter: voiceLimiter, scope: "voice_transcribe" }),
  asyncRoute(async (req, res) => {
    const requestId = getRequestId(req);
    const body = parseVoiceTranscribeBody(req.body);
    const mimeType = normalizeVoiceMimeType(body.mimeType);

    const selectedPath = selectRemoteTranscriptionPath({
      costMode: body.costMode,
      hasRemoteTranscription: true,
    });
    if (selectedPath === "blocked") {
      throw new ApiError({
        message: "Remote transcription is blocked by the current cost mode.",
        errorCode: "COST_MODE_BLOCKED",
        statusCode: 400,
      });
    }

    if (!isSupportedVoiceMimeType(mimeType)) {
      throw new ValidationError(`Unsupported audio mime type: ${mimeType}`, "UNSUPPORTED_FILE_TYPE");
    }

    const audioBuffer = decodeBase64Buffer(body.audioBase64, "audio");
    if (audioBuffer.byteLength > MAX_AUDIO_BYTES) {
      throw new ValidationError("Audio payload exceeds max allowed size.", "FILE_TOO_LARGE");
    }

    const tempKey = `voice/${randomUUID()}`;

    await withRetry({
      attempts: 2,
      operationName: "storage.putTempObject",
      logger,
      run: async () => {
        await providers.storage.putTempObject({
          key: tempKey,
          data: audioBuffer,
          mimeType,
          ttlSeconds: 180,
        });
      },
    });

    let transcription: TranscriptionResponse;
    try {
      transcription = await withRetry({
        attempts: 2,
        operationName: "transcription.transcribeAudio",
        logger,
        run: () =>
          providers.transcription.remote.transcribeAudio({
            audioBlob: new Blob([Uint8Array.from(audioBuffer)], { type: mimeType }),
            mimeType,
            languageHint: body.languageHint,
          }),
      });
    } finally {
      await providers.storage.deleteTempObject(tempKey).catch((error: unknown) => {
        logger.warn("temp_object_delete_failed", {
          requestId,
          key: tempKey,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    assertTranscriptionResponse(transcription);
    res.json({
      apiVersion: "v1",
      transcript: transcription.transcript,
      confidence: transcription.confidence,
    });
  })
);

app.post(
  "/v1/generate",
  requireSensitiveEndpointAccess,
  createRateLimitMiddleware({ limiter: generateLimiter, scope: "generate" }),
  asyncRoute(async (req, res) => {
    const startedAt = Date.now();
    const account = getRequestAccount(req);
    const payload = parseGenerateDraftRequest(req.body);
    const normalizedPayload: GenerateDraftRequest = {
      ...payload,
      evidence: capEvidenceSummaries(payload.evidence),
      providerConfig: await hydrateProviderConfigSecrets(
        payload.providerConfig,
        providerCredentialStore
      ),
    };
    const providerSelection = resolveDraftingProviderSelection(
      providers,
      normalizedPayload.providerConfig
    );
    const draftingProviderStatus = await getDraftingProviderStatus(
      false,
      providerSelection
    );
    const cloudGenerationAvailable =
      providerSelection.mode === "environment"
        ? await getCloudGenerationAvailable()
        : providerSelection.providerPath === "cloud" && draftingProviderStatus.ready;
    const preflightMs = Date.now() - startedAt;

    const selectedPath =
      providerSelection.mode === "environment"
        ? selectGenerationPath({
            costMode: normalizedPayload.costMode,
            hasLocalModelGeneration:
              Boolean(providers.drafting.provider) && draftingProviderStatus.ready,
            hasCloudGeneration: cloudGenerationAvailable,
          })
        : draftingProviderStatus.ready
          ? providerSelection.providerPath
          : "blocked";

    if (selectedPath === "blocked") {
      throw new ApiError({
        message:
          normalizedPayload.actionMode === "improve_current_draft"
            ? "Improve Draft requires an available real drafting model. No heuristic or static fallback is used for this mode."
            : draftingProviderStatus.warning ||
              "No usable drafting provider is ready for the selected mode.",
        errorCode: "DRAFT_PROVIDER_UNAVAILABLE",
        statusCode: 503,
      });
    }

    const provider =
      providerSelection.mode === "environment"
        ? selectedPath === "cloud"
          ? providers.llm.cloud
          : providers.drafting.provider
        : providerSelection.provider;

    if (!provider) {
      throw new ApiError({
        message:
          normalizedPayload.actionMode === "improve_current_draft"
            ? "Improve Draft requires an available real drafting model. No heuristic or static fallback is used for this mode."
            : "No drafting provider instance is available.",
        errorCode: "DRAFT_PROVIDER_UNAVAILABLE",
        statusCode: 503,
      });
    }

    const providerStartedAt = Date.now();
    let response: GenerateDraftResponse;
    try {
      response = await withRetry({
        attempts: 2,
        operationName: "llm.generateDrafts",
        logger,
        run: () => provider.generateDrafts(normalizedPayload),
      });
    } catch (error) {
      if (shouldInvalidateDraftingStatus(error)) {
        invalidateDraftingProviderStatusCache();
      }
      throw error;
    }
    const providerMs = Date.now() - providerStartedAt;

    assertGenerateDraftResponse(response);

    const finalResponse: GenerateDraftResponse = {
      ...response,
      apiVersion: "v1",
      warnings: response.warnings,
      inputSummary: {
        ...response.inputSummary,
        providerPath: selectedPath,
      },
      timings: {
        preflightMs,
        providerMs,
        totalMs: Date.now() - startedAt,
        usedRetryPass: response.timings.usedRetryPass,
      },
    };

    if (deploymentMode !== "local" && account) {
      await hostedAccountService.recordGeneration({
        accountId: account.accountId,
        requestId: finalResponse.requestId,
        request: normalizedPayload,
        response: finalResponse,
      });
    }

    res.json(finalResponse);
  })
);

app.post(
  "/v1/metrics",
  createRateLimitMiddleware({ limiter: metricsLimiter, scope: "metrics" }),
  asyncRoute(async (req, res) => {
    const requestId = getRequestId(req);
    const body = parseMetricsBody(req.body);

    logger.info("metric_received", {
      requestId,
      name: body.name,
      payload: body.payload || {},
    });

    res.json({
      apiVersion: "v1",
      accepted: true,
    });
  })
);

app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  const requestId = getRequestId(req);

  if (error instanceof SyntaxError && "body" in error) {
    logger.warn("request_json_parse_error", {
      requestId,
      route: req.path,
      method: req.method,
      error: error.message,
    });

    res.status(400).json({
      apiVersion: "v1",
      errorCode: "CONTRACT_VERSION_MISMATCH",
      message: "Invalid JSON payload.",
    });
    return;
  }

  if (isApiError(error)) {
    logger.warn("request_failed", {
      requestId,
      route: req.path,
      method: req.method,
      statusCode: error.statusCode,
      errorCode: error.errorCode,
      retryable: error.retryable,
      error: error.message,
      details: error.details,
    });

    res.status(error.statusCode).json({
      apiVersion: "v1",
      errorCode: error.errorCode,
      message: error.message,
    });
    return;
  }

  logger.error("request_unhandled_error", {
    requestId,
    route: req.path,
    method: req.method,
    error: error instanceof Error ? error.message : String(error),
  });

  const fallback = new ProviderError({
    message: "Unexpected backend error.",
    errorCode: "GENERATION_FAILED",
    statusCode: 500,
    retryable: false,
  });

  res.status(fallback.statusCode).json({
    apiVersion: "v1",
    errorCode: fallback.errorCode,
    message: fallback.message,
  });
});

async function verifyHostedStartup(): Promise<void> {
  if (deploymentMode === "local") {
    return;
  }

  await assertDatabaseConnection();
  await assertDatabaseSchemaUpToDate();
}

async function resumeHostedEvidenceJobs(): Promise<void> {
  await hostedEvidenceService.resumeIncompleteJobs(async (input) =>
    summarizeEvidence(
      {
        sessionId: "persisted:resume",
        fileData: input.fileData,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        mode: input.mode,
        mentionInReply: input.mentionInReply,
      },
      input.mimeType,
      "resume"
    )
  );
}

async function startServer(): Promise<void> {
  await verifyHostedStartup();
  localRuntimeToken = await loadOrCreateLocalRuntimeToken();
  const billingReadiness = getStripeBillingIntegrationReadiness();
  const credentialStorageStatus = providerCredentialStore.getStatus();

  app.listen(PORT, "127.0.0.1", () => {
    logger.info("server_started", {
      port: PORT,
      host: "127.0.0.1",
      apiVersion: "v1",
      version: SERVER_VERSION,
      authMode,
      providerCredentialStorageBackend: credentialStorageStatus.backend,
      providerCredentialStorageSupported: credentialStorageStatus.supported,
      billingReadinessStatus: billingReadiness.status,
      billingCheckoutAvailable: billingReadiness.checkoutAvailable,
      billingWebhookVerificationAvailable: billingReadiness.webhookVerificationAvailable,
    });
    if (!credentialStorageStatus.supported) {
      logger.warn("provider_credential_storage_unavailable", {
        backend: credentialStorageStatus.backend,
        message: credentialStorageStatus.message,
      });
    }
    if (deploymentMode !== "local" && billingReadiness.status !== "configured") {
      logger.warn("billing_readiness_partial", {
        deploymentMode,
        billingReadinessStatus: billingReadiness.status,
        missingBillingEnvVars: mapMissingBillingEnvFieldsToNames(
          billingReadiness.missingFields
        ),
        message: billingReadiness.summary.message,
      });
    }
  });

  void resumeHostedEvidenceJobs().catch((error: unknown) => {
    logger.error("hosted_resume_jobs_failed", {
      deploymentMode,
      error: error instanceof Error ? error.message : String(error),
      hint:
        deploymentMode === "local"
          ? undefined
          : "Hosted startup could not resume persisted evidence jobs. Check Postgres, storage, and migrations.",
    });
  });
}

void startServer().catch(async (error: unknown) => {
  logger.error("server_startup_failed", {
    deploymentMode,
    error: error instanceof Error ? error.message : String(error),
    hint:
      deploymentMode === "local"
        ? undefined
        : "Hosted ReplyMate startup requires a reachable Postgres database, completed migrations, and configured storage.",
  });
  await closeSharedDatabasePool().catch(() => undefined);
  process.exit(1);
});
