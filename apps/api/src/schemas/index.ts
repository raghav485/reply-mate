import type {
  ActionMode,
  AccountAccessState,
  AccountPlan,
  AccountSummary,
  BillingPortalRequest,
  BillingSummary,
  ComposerMode,
  CloudProviderKind,
  ComposerSnapshot,
  ContextScope,
  CostMode,
  DeviceAuthCompleteRequest,
  DeviceAuthPollRequest,
  DeviceAuthStartRequest,
  EmailAuthRequest,
  EmailAuthVerifyRequest,
  EvidenceMode,
  EvidenceSummary,
  GenerateDraftRequest,
  GenerateDraftResponse,
  LocalProviderKind,
  ModelMode,
  ProviderCredentialDeleteRequest,
  ProviderCredentialUpsertRequest,
  ProviderConfig,
  SettingsValidationRequest,
  SiteId,
  SubscriptionState,
  TonePreset,
  TranscriptionResponse,
  CheckoutSessionRequest,
} from "@replymate/contracts";
import { TELEMETRY_EVENT_NAMES } from "@replymate/contracts";
import { ValidationError } from "../core/errors.js";

export type SettingsValidateBody = SettingsValidationRequest;
export type ProviderCredentialUpsertBody = ProviderCredentialUpsertRequest;
export type ProviderCredentialDeleteBody = ProviderCredentialDeleteRequest;

export type EmailAuthRequestBody = EmailAuthRequest;
export type EmailAuthVerifyBody = EmailAuthVerifyRequest;
export type DeviceAuthStartBody = DeviceAuthStartRequest;
export type DeviceAuthPollBody = DeviceAuthPollRequest;
export type DeviceAuthCompleteBody = DeviceAuthCompleteRequest;
export type CheckoutSessionBody = CheckoutSessionRequest;
export type BillingPortalBody = BillingPortalRequest;

export type EvidenceIngestBody = {
  sessionId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  mode: EvidenceMode;
  mentionInReply: boolean;
  fileData: Buffer;
};

export type VoiceTranscribeBody = {
  audioBase64: string;
  mimeType?: string;
  languageHint?: string;
  costMode: CostMode;
};

export type MetricsBody = {
  name: string;
  payload?: Record<string, unknown>;
};

const ALLOWED_SITE_IDS: ReadonlySet<SiteId> = new Set([
  "slack_web",
  "gmail_web",
  "generic_web",
]);

const ALLOWED_EVIDENCE_MODES: ReadonlySet<EvidenceMode> = new Set([
  "context_only",
  "intended_attachment",
]);

const ALLOWED_ACTION_MODES: ReadonlySet<ActionMode> = new Set([
  "improve_current_draft",
  "draft_from_context",
  "reply_from_scratch",
  "make_shorter",
  "make_more_professional",
  "make_more_empathetic",
]);

const ALLOWED_TONE_PRESETS: ReadonlySet<TonePreset> = new Set([
  "concise",
  "friendly",
  "professional",
  "empathetic",
  "confident",
]);

const ALLOWED_COST_MODES: ReadonlySet<CostMode> = new Set([
  "local_only",
  "hybrid_low_cost",
  "cloud_quality",
]);

const ALLOWED_CONTEXT_SCOPES: ReadonlySet<ContextScope> = new Set([
  "thread",
  "channel",
  "page",
  "mixed",
  "none",
]);

const ALLOWED_ACCOUNT_PLANS: ReadonlySet<AccountPlan> = new Set([
  "beta",
  "starter",
  "pro",
  "enterprise",
]);

const ALLOWED_SUBSCRIPTION_STATES: ReadonlySet<SubscriptionState> = new Set([
  "inactive",
  "beta",
  "trialing",
  "active",
  "past_due",
  "canceled",
]);

const ALLOWED_ACCOUNT_ACCESS_STATES: ReadonlySet<AccountAccessState> = new Set([
  "inactive",
  "beta",
  "trialing",
  "active",
  "past_due",
  "canceled",
]);

const ALLOWED_MODEL_MODES: ReadonlySet<ModelMode> = new Set([
  "local_models",
  "byok_api",
]);

const ALLOWED_LOCAL_PROVIDER_KINDS: ReadonlySet<LocalProviderKind> = new Set([
  "ollama",
  "openai_compatible_local",
]);

const ALLOWED_CLOUD_PROVIDER_KINDS: ReadonlySet<CloudProviderKind> = new Set([
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "openai_compatible_custom",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(
  record: Record<string, unknown>,
  key: string,
  options: { required?: boolean; allowEmpty?: boolean } = {}
): string | undefined {
  const raw = record[key];
  if (raw === undefined || raw === null) {
    if (options.required) {
      throw new ValidationError(`Missing required string field: ${key}`);
    }
    return undefined;
  }

  if (typeof raw !== "string") {
    throw new ValidationError(`Invalid string field: ${key}`);
  }

  if (!options.allowEmpty && raw.trim().length === 0) {
    if (options.required) {
      throw new ValidationError(`String field cannot be empty: ${key}`);
    }
  }

  return raw;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const raw = record[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new ValidationError(`Invalid numeric field: ${key}`);
  }
  return raw;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  const raw = record[key];
  if (typeof raw !== "boolean") {
    throw new ValidationError(`Invalid boolean field: ${key}`);
  }
  return raw;
}

function readArray(record: Record<string, unknown>, key: string): unknown[] {
  const raw = record[key];
  if (!Array.isArray(raw)) {
    throw new ValidationError(`Invalid array field: ${key}`);
  }
  return raw;
}

function readBuffer(record: Record<string, unknown>, key: string): Buffer {
  const raw = record[key];
  if (!Buffer.isBuffer(raw)) {
    throw new ValidationError(`Invalid binary field: ${key}`);
  }
  return raw;
}

function readOptionalStringArray(record: Record<string, unknown>, key: string): string[] {
  const raw = record[key];
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
    throw new ValidationError(`Invalid string array field: ${key}`);
  }
  return raw as string[];
}

function parseCaptureDebugSnapshot(
  input: unknown
): NonNullable<ComposerSnapshot["captureDebug"]> | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (!isRecord(input)) {
    throw new ValidationError("Snapshot captureDebug must be an object.");
  }

  const allowedDropReasons = new Set([
    "hidden",
    "offscreen",
    "after_composer",
    "outside_active_lane",
    "duplicate",
    "empty_text",
    "noise_text",
    "system_or_ack",
    "chrome_only",
    "metadata_only",
    "unsupported_shape",
  ]);
  const allowedCaptureKinds = new Set([
    "generic_primary",
    "gmail_new_compose",
    "search_like",
    "chat_like",
    "document_like",
    "task_detail_like",
    "generic_unknown",
  ]);
  const allowedLimitedReasons = new Set([
    "only_chrome_found",
    "only_autocomplete_found",
    "only_empty_fields_found",
    "no_semantic_lane_content",
    "none",
  ]);

  const adapterId = readString(input, "adapterId", { required: true });
  if (!adapterId || !["slack", "gmail", "generic"].includes(adapterId)) {
    throw new ValidationError("Snapshot captureDebug.adapterId is invalid.");
  }

  const composerModeRaw = readString(input, "composerMode", {
    required: false,
    allowEmpty: true,
  });
  const composerMode =
    composerModeRaw && ["thread", "channel", "generic", "email"].includes(composerModeRaw)
      ? (composerModeRaw as ComposerMode)
      : undefined;

  const contextScopeRaw =
    readString(input, "contextScope", { required: true }) || "none";
  if (!ALLOWED_CONTEXT_SCOPES.has(contextScopeRaw as ContextScope)) {
    throw new ValidationError("Snapshot captureDebug.contextScope is invalid.");
  }

  const sourceCountsRaw = input.sourceCounts;
  if (!isRecord(sourceCountsRaw)) {
    throw new ValidationError("Snapshot captureDebug.sourceCounts is invalid.");
  }

  const sourceCounts: NonNullable<ComposerSnapshot["captureDebug"]>["sourceCounts"] = {
    visible_thread: 0,
    visible_channel: 0,
    visible_page: 0,
    visible_email_thread: 0,
    quoted_email: 0,
    generic_dom: 0,
  };

  for (const key of Object.keys(sourceCounts) as Array<keyof typeof sourceCounts>) {
    const value = sourceCountsRaw[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new ValidationError(`Snapshot captureDebug.sourceCounts.${key} is invalid.`);
    }
    sourceCounts[key] = value;
  }

  const summaryRaw = input.summary;
  if (!isRecord(summaryRaw)) {
    throw new ValidationError("Snapshot captureDebug.summary is invalid.");
  }

  const dropReasonsRaw = readArray(input, "dropReasons");
  const dropReasons = dropReasonsRaw.map((item, index) => {
    if (!isRecord(item)) {
      throw new ValidationError(`Snapshot captureDebug.dropReasons[${index}] is invalid.`);
    }
    const reason = readString(item, "reason", { required: true });
    if (!reason || !allowedDropReasons.has(reason)) {
      throw new ValidationError(`Snapshot captureDebug.dropReasons[${index}].reason is invalid.`);
    }
    const count = readNumber(item, "count");
    if (count < 0) {
      throw new ValidationError(`Snapshot captureDebug.dropReasons[${index}].count is invalid.`);
    }
    return {
      reason: reason as NonNullable<ComposerSnapshot["captureDebug"]>["dropReasons"][number]["reason"],
      count,
    };
  });

  const captureKindRaw = readString(input, "captureKind", {
    required: false,
    allowEmpty: true,
  });
  const limitedReasonRaw = readString(input, "limitedReason", {
    required: false,
    allowEmpty: true,
  });

  return {
    capturedAt: readString(input, "capturedAt", { required: true })!,
    adapterId: adapterId as NonNullable<ComposerSnapshot["captureDebug"]>["adapterId"],
    composerMode,
    contextScope: contextScopeRaw as ContextScope,
    extractionConfidence: readNumber(input, "extractionConfidence"),
    visibleContextCount: readNumber(input, "visibleContextCount"),
    sourceCounts,
    truncated: readBoolean(input, "truncated"),
    warnings: readOptionalStringArray(input, "warnings"),
    summary: {
      examinedCandidates: readNumber(summaryRaw, "examinedCandidates"),
      keptCandidates: readNumber(summaryRaw, "keptCandidates"),
      droppedCandidates: readNumber(summaryRaw, "droppedCandidates"),
    },
    dropReasons,
    captureKind:
      captureKindRaw && allowedCaptureKinds.has(captureKindRaw)
        ? (captureKindRaw as NonNullable<ComposerSnapshot["captureDebug"]>["captureKind"])
        : undefined,
    limitedReason:
      limitedReasonRaw && allowedLimitedReasons.has(limitedReasonRaw)
        ? (limitedReasonRaw as NonNullable<ComposerSnapshot["captureDebug"]>["limitedReason"])
        : undefined,
  };
}

function parseEvidenceSummary(input: unknown): EvidenceSummary {
  if (!isRecord(input)) {
    throw new ValidationError("Evidence summary must be an object.");
  }

  const mode = readString(input, "mode", { required: true });
  if (!mode || !ALLOWED_EVIDENCE_MODES.has(mode as EvidenceMode)) {
    throw new ValidationError("Invalid evidence mode.");
  }

  const confidence = readString(input, "confidence", { required: true });
  if (!["high", "medium", "low"].includes(confidence || "")) {
    throw new ValidationError("Invalid evidence confidence.");
  }

  const warnings = readOptionalStringArray(input, "warnings");

  return {
    evidenceId: readString(input, "evidenceId", { required: true })!,
    name: readString(input, "name", { required: true })!,
    mode: mode as EvidenceMode,
    mentionInReply: readBoolean(input, "mentionInReply"),
    summaryText: readString(input, "summaryText", { required: true })!,
    parserMode:
      readString(input, "parserMode", { required: true }) as EvidenceSummary["parserMode"],
    confidence: confidence as EvidenceSummary["confidence"],
    warnings,
    truncated: readBoolean(input, "truncated"),
    summaryCharCount: readNumber(input, "summaryCharCount"),
    sourcePageCount:
      typeof input.sourcePageCount === "number" && Number.isFinite(input.sourcePageCount)
        ? input.sourcePageCount
        : undefined,
    extractedTextChars:
      typeof input.extractedTextChars === "number" && Number.isFinite(input.extractedTextChars)
        ? input.extractedTextChars
        : undefined,
  };
}

function parseComposerSnapshot(input: unknown): ComposerSnapshot {
  if (!isRecord(input)) {
    throw new ValidationError("Snapshot must be an object.");
  }

  const metadataRaw = input.metadata;
  if (!isRecord(metadataRaw)) {
    throw new ValidationError("Snapshot metadata must be an object.");
  }

  const siteId = readString(metadataRaw, "siteId", { required: true });
  if (!siteId || !ALLOWED_SITE_IDS.has(siteId as SiteId)) {
    throw new ValidationError("Invalid snapshot metadata.siteId.");
  }

  const visibleContextRaw = readArray(input, "visibleContext");
  const visibleContext = visibleContextRaw.map((item, index) => {
    if (!isRecord(item)) {
      throw new ValidationError(`Snapshot visibleContext[${index}] must be an object.`);
    }

    const source = readString(item, "source", { required: true });
    if (
      !source ||
      ![
        "visible_thread",
        "visible_channel",
        "visible_page",
        "visible_email_thread",
        "quoted_email",
        "generic_dom",
      ].includes(source)
    ) {
      throw new ValidationError(`Invalid visibleContext[${index}].source.`);
    }

    const roleValue = readString(item, "role", { required: false, allowEmpty: true });
    const role =
      roleValue && ["customer", "agent", "unknown"].includes(roleValue)
        ? (roleValue as "customer" | "agent" | "unknown")
        : undefined;

    return {
      id: readString(item, "id", { required: true })!,
      author: readString(item, "author", { required: false, allowEmpty: true }),
      role,
      text: readString(item, "text", { required: true })!,
      source: source as
        | "visible_thread"
        | "visible_channel"
        | "visible_page"
        | "visible_email_thread"
        | "quoted_email"
        | "generic_dom",
    };
  });

  const contextScopeRaw =
    readString(input, "contextScope", { required: false, allowEmpty: true }) || "none";
  if (!ALLOWED_CONTEXT_SCOPES.has(contextScopeRaw as ContextScope)) {
    throw new ValidationError("Invalid snapshot contextScope.");
  }

  const composerModeRaw = readString(input, "composerMode", {
    required: false,
    allowEmpty: true,
  });
  const composerMode =
    composerModeRaw &&
    ["thread", "channel", "generic", "email"].includes(composerModeRaw)
      ? (composerModeRaw as ComposerMode)
      : undefined;

  return {
    draftText: readString(input, "draftText", { required: true, allowEmpty: true }) || "",
    visibleContext,
    contextScope: contextScopeRaw as ContextScope,
    workspaceKey: readString(input, "workspaceKey", { required: true })!,
    composerMode,
    metadata: {
      siteId: siteId as SiteId,
      url: readString(metadataRaw, "url", { required: true })!,
      title: readString(metadataRaw, "title", { required: false, allowEmpty: true }),
      channelName: readString(metadataRaw, "channelName", { required: false, allowEmpty: true }),
      threadTitle: readString(metadataRaw, "threadTitle", { required: false, allowEmpty: true }),
      customerName: readString(metadataRaw, "customerName", { required: false, allowEmpty: true }),
      senderName: readString(metadataRaw, "senderName", { required: false, allowEmpty: true }),
    },
    extractionConfidence: readNumber(input, "extractionConfidence"),
    warnings: readOptionalStringArray(input, "warnings"),
    pageUrlAtCapture: readString(input, "pageUrlAtCapture", { required: true })!,
    viewFingerprint: readString(input, "viewFingerprint", { required: true })!,
    composerFingerprint: readString(input, "composerFingerprint", { required: true })!,
    sessionVersion: readNumber(input, "sessionVersion"),
    captureDebug: parseCaptureDebugSnapshot(input.captureDebug),
  };
}

export function parseSettingsValidateBody(input: unknown): SettingsValidateBody {
  if (input === undefined || input === null) {
    return {};
  }

  if (!isRecord(input)) {
    throw new ValidationError("Settings validation payload must be an object.");
  }

  return {
    client: readString(input, "client", { required: false, allowEmpty: true }),
    providerConfig: parseProviderConfig(input.providerConfig),
  };
}

function parseProviderConfig(input: unknown): ProviderConfig | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }
  if (!isRecord(input)) {
    throw new ValidationError("Provider configuration must be an object.");
  }

  const mode = readString(input, "mode", { required: true });
  if (!mode || !ALLOWED_MODEL_MODES.has(mode as ModelMode)) {
    throw new ValidationError("Provider configuration mode is invalid.");
  }

  const local = isRecord(input.local) ? input.local : {};
  const localKind = readString(local, "kind", { required: true });
  if (!localKind || !ALLOWED_LOCAL_PROVIDER_KINDS.has(localKind as LocalProviderKind)) {
    throw new ValidationError("Local provider kind is invalid.");
  }

  const cloud = isRecord(input.cloud) ? input.cloud : {};
  const cloudKind = readString(cloud, "kind", { required: true });
  if (!cloudKind || !ALLOWED_CLOUD_PROVIDER_KINDS.has(cloudKind as CloudProviderKind)) {
    throw new ValidationError("Cloud provider kind is invalid.");
  }

  return {
    mode: mode as ModelMode,
    local: {
      kind: localKind as LocalProviderKind,
      baseUrl: readString(local, "baseUrl", { required: false, allowEmpty: true }) || "",
      modelName: readString(local, "modelName", { required: false, allowEmpty: true }) || "",
      apiKey: readString(local, "apiKey", { required: false, allowEmpty: true }) || "",
      hasStoredApiKey:
        typeof local.hasStoredApiKey === "boolean" ? local.hasStoredApiKey : false,
    },
    cloud: {
      kind: cloudKind as CloudProviderKind,
      baseUrl: readString(cloud, "baseUrl", { required: false, allowEmpty: true }) || "",
      modelName: readString(cloud, "modelName", { required: false, allowEmpty: true }) || "",
      apiKey: readString(cloud, "apiKey", { required: false, allowEmpty: true }) || "",
      hasStoredApiKey:
        typeof cloud.hasStoredApiKey === "boolean" ? cloud.hasStoredApiKey : false,
    },
  };
}

function parseProviderCredentialRef(
  input: unknown
): ProviderCredentialDeleteRequest {
  if (!isRecord(input)) {
    throw new ValidationError("Provider credential payload must be an object.");
  }

  const target = readString(input, "target", { required: true });
  if (!target || (target !== "local" && target !== "cloud")) {
    throw new ValidationError("Provider credential target is invalid.");
  }

  const kind = readString(input, "kind", { required: true });
  if (!kind) {
    throw new ValidationError("Provider credential kind is required.");
  }
  if (
    (target === "local" &&
      !ALLOWED_LOCAL_PROVIDER_KINDS.has(kind as LocalProviderKind)) ||
    (target === "cloud" &&
      !ALLOWED_CLOUD_PROVIDER_KINDS.has(kind as CloudProviderKind))
  ) {
    throw new ValidationError("Provider credential kind is invalid.");
  }

  return {
    target,
    kind: kind as ProviderCredentialDeleteRequest["kind"],
  };
}

export function parseProviderCredentialDeleteRequest(
  input: unknown
): ProviderCredentialDeleteBody {
  return parseProviderCredentialRef(input);
}

export function parseProviderCredentialUpsertRequest(
  input: unknown
): ProviderCredentialUpsertBody {
  const ref = parseProviderCredentialRef(input);
  if (!isRecord(input)) {
    throw new ValidationError("Provider credential payload must be an object.");
  }

  const apiKey = readString(input, "apiKey", { required: true })?.trim();
  if (!apiKey) {
    throw new ValidationError("Provider credential apiKey is required.");
  }

  return {
    ...ref,
    apiKey,
  };
}

export function parseEmailAuthRequest(input: unknown): EmailAuthRequestBody {
  if (!isRecord(input)) {
    throw new ValidationError("Email auth request must be an object.");
  }

  const email = readString(input, "email", { required: true })?.trim().toLowerCase();
  if (!email) {
    throw new ValidationError("Email auth request email is required.");
  }

  return { email };
}

export function parseEmailAuthVerifyRequest(input: unknown): EmailAuthVerifyBody {
  if (!isRecord(input)) {
    throw new ValidationError("Email auth verify request must be an object.");
  }

  const token = readString(input, "token", { required: true })?.trim();
  if (!token) {
    throw new ValidationError("Email auth verify token is required.");
  }

  return { token };
}

export function parseDeviceAuthStartRequest(input: unknown): DeviceAuthStartBody {
  if (input === undefined || input === null) {
    return {};
  }
  if (!isRecord(input)) {
    throw new ValidationError("Device auth start request must be an object.");
  }

  const client = readString(input, "client", { allowEmpty: false });
  return client ? { client } : {};
}

export function parseDeviceAuthPollRequest(input: unknown): DeviceAuthPollBody {
  if (!isRecord(input)) {
    throw new ValidationError("Device auth poll request must be an object.");
  }

  const deviceCode = readString(input, "deviceCode", { required: true })?.trim();
  if (!deviceCode) {
    throw new ValidationError("Device auth poll request deviceCode is required.");
  }

  return { deviceCode };
}

export function parseDeviceAuthCompleteRequest(input: unknown): DeviceAuthCompleteBody {
  if (!isRecord(input)) {
    throw new ValidationError("Device auth complete request must be an object.");
  }

  const userCode = readString(input, "userCode", { required: true })?.trim().toUpperCase();
  if (!userCode) {
    throw new ValidationError("Device auth complete request userCode is required.");
  }

  return { userCode };
}

export function parseCheckoutSessionRequest(input: unknown): CheckoutSessionBody {
  if (input === undefined || input === null) {
    return {};
  }
  if (!isRecord(input)) {
    throw new ValidationError("Checkout request must be an object.");
  }

  const successUrl = readString(input, "successUrl");
  const cancelUrl = readString(input, "cancelUrl");
  return {
    ...(successUrl ? { successUrl } : {}),
    ...(cancelUrl ? { cancelUrl } : {}),
  };
}

export function parseBillingPortalRequest(input: unknown): BillingPortalBody {
  if (input === undefined || input === null) {
    return {};
  }
  if (!isRecord(input)) {
    throw new ValidationError("Billing portal request must be an object.");
  }

  const returnUrl = readString(input, "returnUrl");
  return returnUrl ? { returnUrl } : {};
}

function parseAccountSummary(input: unknown): AccountSummary {
  if (!isRecord(input)) {
    throw new ValidationError("Account summary is invalid.");
  }

  const accountId = readString(input, "accountId", { required: true });
  const email = readString(input, "email", { required: true });
  const plan = readString(input, "plan", { required: true });
  const subscriptionState = readString(input, "subscriptionState", { required: true });
  const betaAccess = readBoolean(input, "betaAccess");

  if (
    !accountId ||
    !email ||
    !plan ||
    !ALLOWED_ACCOUNT_PLANS.has(plan as AccountPlan) ||
    !subscriptionState ||
    !ALLOWED_SUBSCRIPTION_STATES.has(subscriptionState as SubscriptionState)
  ) {
    throw new ValidationError("Account summary fields are invalid.");
  }

  return {
    accountId,
    email,
    plan: plan as AccountPlan,
    subscriptionState: subscriptionState as SubscriptionState,
    betaAccess,
    displayName: readString(input, "displayName"),
  };
}

export function assertBillingSummary(input: unknown): asserts input is BillingSummary {
  if (!isRecord(input)) {
    throw new ValidationError("Billing summary is invalid.");
  }

  parseAccountSummary(input.account);

  if (!isRecord(input.entitlement)) {
    throw new ValidationError("Billing summary entitlement is invalid.");
  }
  const accessState = readString(input.entitlement, "accessState", { required: true });
  if (!accessState || !ALLOWED_ACCOUNT_ACCESS_STATES.has(accessState as AccountAccessState)) {
    throw new ValidationError("Billing summary accessState is invalid.");
  }
  readBoolean(input.entitlement, "canGenerate");
  readBoolean(input.entitlement, "canUseEvidence");
  readBoolean(input.entitlement, "requiresUpgrade");
  readString(input.entitlement, "message", { required: true });

  if (input.subscription !== null && input.subscription !== undefined) {
    if (!isRecord(input.subscription)) {
      throw new ValidationError("Billing summary subscription is invalid.");
    }
    const provider = readString(input.subscription, "provider", { required: true });
    const status = readString(input.subscription, "status", { required: true });
    if (provider !== "stripe") {
      throw new ValidationError("Billing summary subscription provider is invalid.");
    }
    if (!status || !ALLOWED_SUBSCRIPTION_STATES.has(status as SubscriptionState)) {
      throw new ValidationError("Billing summary subscription status is invalid.");
    }
    readString(input.subscription, "customerId", { allowEmpty: false });
    readString(input.subscription, "subscriptionId", { allowEmpty: false });
    readString(input.subscription, "priceId", { allowEmpty: false });
  }

  const plan = readString(input, "plan", { required: true });
  if (!plan || !ALLOWED_ACCOUNT_PLANS.has(plan as AccountPlan)) {
    throw new ValidationError("Billing summary plan is invalid.");
  }

  readString(input, "apiVersion", { required: true });
  const deploymentMode = readString(input, "deploymentMode", { required: true });
  if (!deploymentMode || !["local", "hosted_beta", "hosted_public"].includes(deploymentMode)) {
    throw new ValidationError("Billing summary deploymentMode is invalid.");
  }

  if (input.trialEndsAt !== undefined) {
    readString(input, "trialEndsAt", { required: true });
  }
  if (input.currentPeriodEndsAt !== undefined) {
    readString(input, "currentPeriodEndsAt", { required: true });
  }

  readBoolean(input, "cancelAtPeriodEnd");
  readBoolean(input, "billingPortalAvailable");

  if (!isRecord(input.billingReadiness)) {
    throw new ValidationError("Billing summary billingReadiness is invalid.");
  }
  const readinessStatus = readString(input.billingReadiness, "status", { required: true });
  if (!readinessStatus || !["configured", "partial", "unconfigured"].includes(readinessStatus)) {
    throw new ValidationError("Billing summary billingReadiness.status is invalid.");
  }
  readBoolean(input.billingReadiness, "checkoutAvailable");
  if (input.billingReadiness.message !== undefined) {
    readString(input.billingReadiness, "message", { required: true });
  }
}

export function parseEvidenceIngestBody(input: unknown): EvidenceIngestBody {
  if (!isRecord(input)) {
    throw new ValidationError("Evidence ingest payload must be an object.");
  }

  const mode = readString(input, "mode", { required: true });
  if (!mode || !ALLOWED_EVIDENCE_MODES.has(mode as EvidenceMode)) {
    throw new ValidationError("Invalid evidence mode.", "EVIDENCE_PARSE_FAILED");
  }

  return {
    sessionId: readString(input, "sessionId", { required: true })!,
    fileName: readString(input, "fileName", { required: true })!,
    mimeType:
      readString(input, "mimeType", { required: false, allowEmpty: true }) ||
      "application/octet-stream",
    sizeBytes: readNumber(input, "sizeBytes"),
    mode: mode as EvidenceMode,
    mentionInReply: readBoolean(input, "mentionInReply"),
    fileData: readBuffer(input, "fileData"),
  };
}

export function parseVoiceTranscribeBody(input: unknown): VoiceTranscribeBody {
  if (!isRecord(input)) {
    throw new ValidationError("Voice transcription payload must be an object.");
  }

  const costMode = readString(input, "costMode", { required: true });
  if (!costMode || !ALLOWED_COST_MODES.has(costMode as CostMode)) {
    throw new ValidationError("Invalid costMode.");
  }

  return {
    audioBase64: readString(input, "audioBase64", { required: true })!,
    mimeType: readString(input, "mimeType", { required: false, allowEmpty: true }),
    languageHint: readString(input, "languageHint", { required: false, allowEmpty: true }),
    costMode: costMode as CostMode,
  };
}

export function parseGenerateDraftRequest(input: unknown): GenerateDraftRequest {
  if (!isRecord(input)) {
    throw new ValidationError("Generate payload must be an object.");
  }

  const siteId = readString(input, "siteId", { required: true });
  if (!siteId || !ALLOWED_SITE_IDS.has(siteId as SiteId)) {
    throw new ValidationError("Invalid siteId.");
  }

  const actionMode = readString(input, "actionMode", { required: true });
  if (!actionMode || !ALLOWED_ACTION_MODES.has(actionMode as ActionMode)) {
    throw new ValidationError("Invalid actionMode.");
  }

  const tonePreset = readString(input, "tonePreset", { required: true });
  if (!tonePreset || !ALLOWED_TONE_PRESETS.has(tonePreset as TonePreset)) {
    throw new ValidationError("Invalid tonePreset.");
  }

  const costMode = readString(input, "costMode", { required: true });
  if (!costMode || !ALLOWED_COST_MODES.has(costMode as CostMode)) {
    throw new ValidationError("Invalid costMode.");
  }

  const evidenceRaw = readArray(input, "evidence");
  const evidence = evidenceRaw.map((item) => parseEvidenceSummary(item));

  return {
    sessionId: readString(input, "sessionId", { required: true })!,
    sessionVersion: readNumber(input, "sessionVersion"),
    siteId: siteId as SiteId,
    actionMode: actionMode as ActionMode,
    tonePreset: tonePreset as TonePreset,
    draftInput: readString(input, "draftInput", { required: true, allowEmpty: true }) || "",
    instructionInput: readString(input, "instructionInput", {
      required: false,
      allowEmpty: true,
    }),
    contextEnabled: readBoolean(input, "contextEnabled"),
    snapshot: parseComposerSnapshot(input.snapshot),
    evidence,
    usedVoiceInput: readBoolean(input, "usedVoiceInput"),
    costMode: costMode as CostMode,
    providerConfig: parseProviderConfig(input.providerConfig),
  };
}

export function parseMetricsBody(input: unknown): MetricsBody {
  if (!isRecord(input)) {
    throw new ValidationError("Metrics payload must be an object.");
  }

  const name = readString(input, "name", { required: true });
  if (!name || !TELEMETRY_EVENT_NAMES.includes(name as typeof TELEMETRY_EVENT_NAMES[number])) {
    throw new ValidationError("Metrics event name is required.");
  }

  const payload = input.payload;
  if (payload !== undefined && !isRecord(payload)) {
    throw new ValidationError("Metrics payload must be an object when provided.");
  }

  return {
    name,
    payload: payload as Record<string, unknown> | undefined,
  };
}

export function parseEvidenceJobId(input: unknown): string {
  if (!isRecord(input)) {
    throw new ValidationError("Route params are missing.", "EVIDENCE_PARSE_FAILED");
  }

  const jobId = readString(input, "jobId", { required: true });
  if (!jobId) {
    throw new ValidationError("Missing jobId route param.", "EVIDENCE_PARSE_FAILED");
  }

  return jobId;
}

export function assertTranscriptionResponse(input: unknown): asserts input is TranscriptionResponse {
  if (!isRecord(input)) {
    throw new ValidationError("Invalid transcription response.", "VOICE_TRANSCRIPTION_FAILED");
  }

  if (typeof input.transcript !== "string" || input.transcript.trim().length === 0) {
    throw new ValidationError("Transcription response transcript is invalid.", "VOICE_TRANSCRIPTION_FAILED");
  }

  if (typeof input.confidence !== "number" || !Number.isFinite(input.confidence)) {
    throw new ValidationError("Transcription response confidence is invalid.", "VOICE_TRANSCRIPTION_FAILED");
  }
}

export function assertGenerateDraftResponse(input: unknown): asserts input is GenerateDraftResponse {
  if (!isRecord(input)) {
    throw new ValidationError("Invalid generate response.", "INVALID_MODEL_OUTPUT");
  }

  if (typeof input.apiVersion !== "string") {
    throw new ValidationError("Generate response apiVersion is invalid.", "INVALID_MODEL_OUTPUT");
  }

  if (typeof input.requestId !== "string" || input.requestId.length === 0) {
    throw new ValidationError("Generate response requestId is invalid.", "INVALID_MODEL_OUTPUT");
  }

  const drafts = input.drafts;
  if (!Array.isArray(drafts) || drafts.length !== 2) {
    throw new ValidationError("Generate response must include exactly 2 drafts.", "INVALID_MODEL_OUTPUT");
  }

  for (const draft of drafts) {
    if (!isRecord(draft)) {
      throw new ValidationError("Draft variant is invalid.", "INVALID_MODEL_OUTPUT");
    }

    if (
      typeof draft.id !== "string" ||
      typeof draft.label !== "string" ||
      typeof draft.text !== "string" ||
      (draft.role !== "primary" && draft.role !== "alternate")
    ) {
      throw new ValidationError("Draft variant fields are invalid.", "INVALID_MODEL_OUTPUT");
    }

    if (!Array.isArray(draft.styleNotes) || draft.styleNotes.some((item) => typeof item !== "string")) {
      throw new ValidationError("Draft styleNotes are invalid.", "INVALID_MODEL_OUTPUT");
    }

    if (
      draft.variantKind !== undefined &&
      ![
        "cleaned_draft",
        "context_reply",
        "default_primary",
        "default_alternate",
      ].includes(String(draft.variantKind))
    ) {
      throw new ValidationError("Draft variantKind is invalid.", "INVALID_MODEL_OUTPUT");
    }
  }

  if (!isRecord(input.inputSummary)) {
    throw new ValidationError("Generate response inputSummary is invalid.", "INVALID_MODEL_OUTPUT");
  }

  if (
    typeof input.inputSummary.contextItemsUsed !== "number" ||
    !Number.isFinite(input.inputSummary.contextItemsUsed)
  ) {
    throw new ValidationError("Generate response contextItemsUsed is invalid.", "INVALID_MODEL_OUTPUT");
  }

  if (
    typeof input.inputSummary.contextScopeUsed !== "string" ||
    !ALLOWED_CONTEXT_SCOPES.has(input.inputSummary.contextScopeUsed as ContextScope)
  ) {
    throw new ValidationError("Generate response contextScopeUsed is invalid.", "INVALID_MODEL_OUTPUT");
  }

  if (
    typeof input.inputSummary.providerPath !== "string" ||
    !["local_model", "cloud"].includes(input.inputSummary.providerPath)
  ) {
    throw new ValidationError("Generate response providerPath is invalid.", "INVALID_MODEL_OUTPUT");
  }

  if (
    !Array.isArray(input.inputSummary.entityCorrectionsApplied) ||
    input.inputSummary.entityCorrectionsApplied.some((item) => {
      if (!isRecord(item)) return true;
      return (
        typeof item.from !== "string" ||
        typeof item.to !== "string" ||
        !["context", "metadata", "evidence"].includes(String(item.source || ""))
      );
    })
  ) {
    throw new ValidationError(
      "Generate response entityCorrectionsApplied is invalid.",
      "INVALID_MODEL_OUTPUT"
    );
  }

  if (input.debug !== undefined) {
    if (!isRecord(input.debug)) {
      throw new ValidationError("Generate response debug is invalid.", "INVALID_MODEL_OUTPUT");
    }

    if (!isRecord(input.debug.selection)) {
      throw new ValidationError(
        "Generate response debug.selection is invalid.",
        "INVALID_MODEL_OUTPUT"
      );
    }

    const responseTarget = input.debug.selection.responseTarget;
    if (responseTarget !== undefined) {
      if (!isRecord(responseTarget)) {
        throw new ValidationError(
          "Generate response debug.selection.responseTarget is invalid.",
          "INVALID_MODEL_OUTPUT"
        );
      }
      if (
        typeof responseTarget.textPreview !== "string" ||
        typeof responseTarget.reason !== "string"
      ) {
        throw new ValidationError(
          "Generate response debug.selection.responseTarget fields are invalid.",
          "INVALID_MODEL_OUTPUT"
        );
      }
      if (
        responseTarget.role !== undefined &&
        !["customer", "agent", "unknown"].includes(String(responseTarget.role))
      ) {
        throw new ValidationError(
          "Generate response debug.selection.responseTarget.role is invalid.",
          "INVALID_MODEL_OUTPUT"
        );
      }
    }

    if (
      typeof input.debug.selection.currentMessageFallbackUsed !== "boolean" ||
      typeof input.debug.selection.supportTurnCount !== "number" ||
      !Number.isFinite(input.debug.selection.supportTurnCount)
    ) {
      throw new ValidationError(
        "Generate response debug.selection fields are invalid.",
        "INVALID_MODEL_OUTPUT"
      );
    }

    if (!Array.isArray(input.debug.supportingFacts)) {
      throw new ValidationError(
        "Generate response debug.supportingFacts is invalid.",
        "INVALID_MODEL_OUTPUT"
      );
    }
    for (const item of input.debug.supportingFacts) {
      if (
        !isRecord(item) ||
        typeof item.kind !== "string" ||
        ![
          "request_frame",
          "explicit_fact",
          "resolved_reference",
          "supporting_detail",
          "allowed_uncertainty",
        ].includes(item.kind) ||
        typeof item.textPreview !== "string" ||
        typeof item.relevance !== "number" ||
        !Number.isFinite(item.relevance)
      ) {
        throw new ValidationError(
          "Generate response debug.supportingFacts items are invalid.",
          "INVALID_MODEL_OUTPUT"
        );
      }
    }

    if (!Array.isArray(input.debug.excludedTurns)) {
      throw new ValidationError(
        "Generate response debug.excludedTurns is invalid.",
        "INVALID_MODEL_OUTPUT"
      );
    }
    for (const item of input.debug.excludedTurns) {
      if (
        !isRecord(item) ||
        typeof item.kind !== "string" ||
        !["confirmed_answer", "hypothesis", "action_request", "question", "ack", "other"].includes(
          item.kind
        ) ||
        typeof item.textPreview !== "string"
      ) {
        throw new ValidationError(
          "Generate response debug.excludedTurns items are invalid.",
          "INVALID_MODEL_OUTPUT"
        );
      }
    }

    if (!isRecord(input.debug.cleanup)) {
      throw new ValidationError(
        "Generate response debug.cleanup is invalid.",
        "INVALID_MODEL_OUTPUT"
      );
    }
    if (
      !["model"].includes(String(input.debug.cleanup.winner)) ||
      typeof input.debug.cleanup.selectedQualityScore !== "number" ||
      !Number.isFinite(input.debug.cleanup.selectedQualityScore) ||
      !Array.isArray(input.debug.cleanup.suspiciousTokens) ||
      input.debug.cleanup.suspiciousTokens.some((item: unknown) => typeof item !== "string")
    ) {
      throw new ValidationError(
        "Generate response debug.cleanup fields are invalid.",
        "INVALID_MODEL_OUTPUT"
      );
    }
    if (
      input.debug.cleanup.modelQualityScore !== undefined &&
      (typeof input.debug.cleanup.modelQualityScore !== "number" ||
        !Number.isFinite(input.debug.cleanup.modelQualityScore))
    ) {
      throw new ValidationError(
        "Generate response debug.cleanup.modelQualityScore is invalid.",
        "INVALID_MODEL_OUTPUT"
      );
    }

    if (!isRecord(input.debug.contextReply)) {
      throw new ValidationError(
        "Generate response debug.contextReply is invalid.",
        "INVALID_MODEL_OUTPUT"
      );
    }
    if (
      !["model", "cleaned_draft_reuse"].includes(String(input.debug.contextReply.winner)) ||
      typeof input.debug.contextReply.usedFallback !== "boolean" ||
      !["grounded", "current_message_only", "limited"].includes(
        String(input.debug.contextReply.coverage)
      )
    ) {
      throw new ValidationError(
        "Generate response debug.contextReply fields are invalid.",
        "INVALID_MODEL_OUTPUT"
      );
    }
    if (
      input.debug.contextReply.qualityScore !== undefined &&
      (typeof input.debug.contextReply.qualityScore !== "number" ||
        !Number.isFinite(input.debug.contextReply.qualityScore))
    ) {
      throw new ValidationError(
        "Generate response debug.contextReply.qualityScore is invalid.",
        "INVALID_MODEL_OUTPUT"
      );
    }

    if (!isRecord(input.debug.provider)) {
      throw new ValidationError(
        "Generate response debug.provider is invalid.",
        "INVALID_MODEL_OUTPUT"
      );
    }
    if (
      !["ollama", "generic_local_chat_api"].includes(
        String(input.debug.provider.runtime)
      ) ||
      typeof input.debug.provider.usedRetryPass !== "boolean"
    ) {
      throw new ValidationError(
        "Generate response debug.provider fields are invalid.",
        "INVALID_MODEL_OUTPUT"
      );
    }
  }

  if (!isRecord(input.timings)) {
    throw new ValidationError("Generate response timings are invalid.", "INVALID_MODEL_OUTPUT");
  }

  for (const key of ["preflightMs", "providerMs", "totalMs"] as const) {
    if (typeof input.timings[key] !== "number" || !Number.isFinite(input.timings[key])) {
      throw new ValidationError(`Generate response ${key} is invalid.`, "INVALID_MODEL_OUTPUT");
    }
  }

  if (typeof input.timings.usedRetryPass !== "boolean") {
    throw new ValidationError(
      "Generate response usedRetryPass is invalid.",
      "INVALID_MODEL_OUTPUT"
    );
  }
}

export function assertEvidenceSummary(input: unknown): asserts input is EvidenceSummary {
  parseEvidenceSummary(input);
}
