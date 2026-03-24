import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import type {
  AuthMode,
  DraftingProviderStatus,
  EvidenceJobStatus,
  EvidenceSummary,
  GenerateDraftRequest,
  GenerateDraftResponse,
  ParserProviderStatus,
  TranscriptionResponse,
} from "@replymate/contracts";
import { ApiError, ProviderError, ValidationError, isApiError } from "./core/errors.js";
import { selectGenerationPath, selectRemoteTranscriptionPath } from "./core/costPolicy.js";
import { StructuredLogger } from "./core/logger.js";
import { loadLocalEnv } from "./bootstrap/loadEnv.js";
import { parseMultipartFormData } from "./core/multipart.js";
import {
  InMemoryRateLimiter,
  createRateLimitMiddleware,
  resolveClientKey,
} from "./core/rateLimit.js";
import { withRetry } from "./core/retry.js";
import { createProviderRuntime } from "./providers/index.js";
import {
  assertEvidenceSummary,
  assertGenerateDraftResponse,
  assertTranscriptionResponse,
  parseEvidenceIngestBody,
  parseEvidenceJobId,
  parseGenerateDraftRequest,
  parseMetricsBody,
  parseSettingsValidateBody,
  parseVoiceTranscribeBody,
  type EvidenceIngestBody,
} from "./schemas/index.js";

const app = express();
loadLocalEnv();
const PORT = Number(process.env.PORT || 3000);
const SERVER_VERSION = "0.3.0";
const logger = new StructuredLogger("replymate-api");
const providers = createProviderRuntime();
const configuredApiToken = process.env.REPLYMATE_API_TOKEN?.trim() || "";
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

const evidenceJobs = new Map<string, EvidenceJobStatus>();

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

async function getDraftingProviderStatus(forceRefresh = false): Promise<DraftingProviderStatus> {
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
    origin: [/^chrome-extension:\/\//, "http://localhost:5173"],
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
  if (req.method === "OPTIONS" || req.path === "/v1/health") {
    next();
    return;
  }

  if (!configuredApiToken) {
    next();
    return;
  }

  const authHeader = req.header("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || match[1].trim() !== configuredApiToken) {
    next(
      new ApiError({
        message: "Unauthorized. Check your API token in settings.",
        errorCode: "UNAUTHORIZED",
        statusCode: 401,
      })
    );
    return;
  }

  next();
});

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
  asyncRoute(async (req, res) => {
    parseSettingsValidateBody(req.body);
    const draftingProvider = await getDraftingProviderStatus(true);
    const parserProvider = await getParserProviderStatus(true);
    const warnings = [
      ...(authMode === "optional"
        ? ["Server auth is optional; no bearer token is currently enforced."]
        : []),
      ...(draftingProvider.warning ? [draftingProvider.warning] : []),
      ...(parserProvider.warning ? [parserProvider.warning] : []),
      ...(providers.parser.runtimeType === "drafting_runtime"
        ? ["Dedicated parser model recommended for best OCR quality: minicpm-v."]
        : []),
    ];

    res.json({
      valid: draftingProvider.ready,
      warnings,
      apiVersion: "v1",
      serverVersion: SERVER_VERSION,
      authMode,
      draftingProvider,
      parserProvider,
    });
  })
);

app.post(
  "/v1/evidence/ingest",
  createRateLimitMiddleware({ limiter: evidenceLimiter, scope: "evidence_ingest" }),
  express.raw({
    type: (req) => Boolean(req.headers["content-type"]?.startsWith("multipart/form-data")),
    limit: "50mb",
  }),
  asyncRoute(async (req, res) => {
    const requestId = getRequestId(req);
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

    if (shouldProcessEvidenceAsync(body, mimeType)) {
      const jobId = `job_${randomUUID()}`;
      evidenceJobs.set(jobId, { jobId, state: "processing" });

      setTimeout(() => {
        void (async () => {
          try {
            const summary = await summarizeEvidence(body, mimeType, requestId);
            evidenceJobs.set(jobId, {
              jobId,
              state: "ready",
              result: summary,
            });
          } catch (error) {
            logger.error("evidence_job_failed", {
              requestId,
              jobId,
              error: error instanceof Error ? error.message : String(error),
            });
            evidenceJobs.set(jobId, {
              jobId,
              state: "failed",
              errorCode: "EVIDENCE_PARSE_FAILED",
            });
          }
        })();
      }, 900);

      res.json({
        apiVersion: "v1",
        mode: "async",
        job: {
          jobId,
          state: "processing",
        },
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
  asyncRoute(async (req, res) => {
    const jobId = parseEvidenceJobId(req.params);
    const job = evidenceJobs.get(jobId);

    if (!job) {
      throw new ApiError({
        message: "Evidence job not found.",
        errorCode: "EVIDENCE_PARSE_FAILED",
        statusCode: 404,
      });
    }

    res.json({
      apiVersion: "v1",
      job,
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
  createRateLimitMiddleware({ limiter: generateLimiter, scope: "generate" }),
  asyncRoute(async (req, res) => {
    const startedAt = Date.now();
    const payload = parseGenerateDraftRequest(req.body);
    const normalizedPayload: GenerateDraftRequest = {
      ...payload,
      evidence: capEvidenceSummaries(payload.evidence),
    };
    const draftingProviderStatus = await getDraftingProviderStatus();
    const preflightMs = Date.now() - startedAt;

    const selectedPath = selectGenerationPath({
      costMode: normalizedPayload.costMode,
      hasLocalModelGeneration:
        Boolean(providers.drafting.provider) && draftingProviderStatus.ready,
      hasCloudGeneration: Boolean(providers.llm.cloud),
    });

    if (selectedPath === "blocked") {
      throw new ApiError({
        message:
          normalizedPayload.actionMode === "improve_current_draft"
            ? "Improve Draft requires an available real drafting model. No heuristic or static fallback is used for this mode."
            : draftingProviderStatus.warning ||
          "No usable drafting provider is ready for the selected cost mode.",
        errorCode: "DRAFT_PROVIDER_UNAVAILABLE",
        statusCode: 503,
      });
    }

    const provider =
      selectedPath === "cloud"
        ? providers.llm.cloud
        : providers.drafting.provider;

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

app.listen(PORT, () => {
  logger.info("server_started", {
    port: PORT,
    apiVersion: "v1",
    version: SERVER_VERSION,
    authMode,
  });
});
