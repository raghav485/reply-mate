// =============================================================================
// Domain Types — TRD §6.2
// =============================================================================

import type { FeatureFlagKey } from "../flags/index.js";

/** Identifies a supported website. */
export type SiteId = "slack_web" | "gmail_web" | "generic_web";

/** Identifies an extension runtime surface. */
export type RuntimeSurface = "background" | "sidepanel" | "options";

/** Identifies a feature module. */
export type FeatureId =
  | "drafting"
  | "evidence"
  | "voice"
  | "settings"
  | "telemetry";

/** Identifies a site adapter. */
export type AdapterId = "slack" | "gmail" | "generic";

/** Identifies a provider adapter category. */
export type ProviderId = "llm" | "transcription" | "storage" | "parser";

/** How an evidence file is used in generation. */
export type EvidenceMode = "context_only" | "intended_attachment";

/** Whether a site adapter supports file attachment. */
export type AttachCapability = "none" | "manual_only" | "helper_available";

/** Cost mode governing provider selection. */
export type CostMode = "local_only" | "hybrid_low_cost" | "cloud_quality";

/** Drafting runtime families supported by the backend. */
export type DraftingRuntimeType =
  | "ollama"
  | "generic_local_chat_api"
  | "openai_compatible"
  | "anthropic"
  | "gemini";

/** Parser runtime families supported by the backend. */
export type ParserRuntimeType =
  | "drafting_runtime"
  | "metadata_local"
  | "ollama"
  | "generic_local_chat_api";

/** Metadata fallback mode for evidence parsing. */
export type ParserFallbackMode = "none" | "metadata_local";

/** High-level scope of captured conversation context. */
export type ContextScope = "thread" | "channel" | "page" | "mixed" | "none";

/** High-level composer mode used for capture and restore semantics. */
export type ComposerMode = "thread" | "channel" | "generic" | "email";

// =============================================================================
// Capability Model — TRD §6.3
// =============================================================================

export type CapabilityMap = {
  drafting: boolean;
  evidence: boolean;
  voice: boolean;
  telemetry: boolean;
  attachHelper: AttachCapability;
};

// =============================================================================
// Data Models — TRD §15.1: Composer Snapshot
// =============================================================================

export type MessageContextItem = {
  id: string;
  author?: string;
  role?: "customer" | "agent" | "unknown";
  text: string;
  source:
    | "visible_thread"
    | "visible_channel"
    | "visible_page"
    | "visible_email_thread"
    | "quoted_email"
    | "generic_dom";
};

export type CaptureDropReason = {
  reason:
    | "hidden"
    | "offscreen"
    | "after_composer"
    | "outside_active_lane"
    | "duplicate"
    | "empty_text"
    | "noise_text"
    | "system_or_ack"
    | "chrome_only"
    | "metadata_only"
    | "unsupported_shape";
  count: number;
};

export type CaptureDebugSnapshot = {
  capturedAt: string;
  adapterId: AdapterId;
  composerMode?: ComposerMode;
  contextScope: ContextScope;
  extractionConfidence: number;
  visibleContextCount: number;
  sourceCounts: Record<MessageContextItem["source"], number>;
  truncated: boolean;
  warnings: string[];
  summary: {
    examinedCandidates: number;
    keptCandidates: number;
    droppedCandidates: number;
  };
  dropReasons: CaptureDropReason[];
  captureKind?:
    | "generic_primary"
    | "gmail_new_compose"
    | "search_like"
    | "chat_like"
    | "document_like"
    | "task_detail_like"
    | "generic_unknown";
  limitedReason?:
    | "only_chrome_found"
    | "only_autocomplete_found"
    | "only_empty_fields_found"
    | "no_semantic_lane_content"
    | "none";
};

export type PageMetadata = {
  siteId: SiteId;
  url: string;
  title?: string;
  channelName?: string;
  threadTitle?: string;
  customerName?: string;
  senderName?: string;
};

export type ComposerSnapshot = {
  draftText: string;
  visibleContext: MessageContextItem[];
  contextScope: ContextScope;
  workspaceKey: string;
  composerMode?: ComposerMode;
  metadata: PageMetadata;
  extractionConfidence: number;
  warnings: string[];
  pageUrlAtCapture: string;
  viewFingerprint: string;
  composerFingerprint: string;
  sessionVersion: number;
  captureDebug?: CaptureDebugSnapshot;
};

// =============================================================================
// Session Model — TRD §9
// =============================================================================

export type ComposerSession = {
  sessionId: string;
  tabId: number;
  siteId: SiteId;
  adapterId: AdapterId;
  capabilityMap: CapabilityMap;
  snapshot: ComposerSnapshot | null;
  warnings: string[];
  updatedAt: string;
};

export type GenerateDraftTimings = {
  preflightMs: number;
  providerMs: number;
  totalMs: number;
  usedRetryPass: boolean;
};

// =============================================================================
// Evidence Types — TRD §15.2
// =============================================================================

export type EvidenceItem = {
  localId: string;
  evidenceId?: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  source: "picker" | "drag_drop" | "paste";
  mode: EvidenceMode;
  mentionInReply: boolean;
  uploadState: "local_only" | "uploading" | "uploaded" | "failed";
  parseState: "pending" | "processing" | "ready" | "failed";
  previewUrl?: string;
  error?: string;
};

export type EvidenceSummary = {
  evidenceId: string;
  name: string;
  mode: EvidenceMode;
  mentionInReply: boolean;
  summaryText: string;
  parserMode: "image_ocr" | "docx_text" | "pdf_text" | "metadata_fallback";
  confidence: "high" | "medium" | "low";
  warnings: string[];
  truncated: boolean;
  summaryCharCount: number;
  sourcePageCount?: number;
  extractedTextChars?: number;
};

export type EvidenceJobState = "queued" | "processing" | "ready" | "failed";

export type EvidenceJobStatus = {
  jobId: string;
  state: EvidenceJobState;
  result?: EvidenceSummary;
  errorCode?: string;
};

// =============================================================================
// Voice Types — TRD §15.3
// =============================================================================

export type VoiceState =
  | { status: "idle" }
  | { status: "requesting_permission" }
  | {
      status: "recording";
      target: "draft" | "instructions";
      startedAt: string;
      mode: "local" | "cloud";
    }
  | {
      status: "transcribing";
      target: "draft" | "instructions";
      mode: "local" | "cloud";
    }
  | { status: "error"; message: string };

// =============================================================================
// Generation Types — TRD §21.3 / §21.4
// =============================================================================

export type ActionMode =
  | "improve_current_draft"
  | "draft_from_context"
  | "reply_from_scratch"
  | "make_shorter"
  | "make_more_professional"
  | "make_more_empathetic";

export type TonePreset =
  | "concise"
  | "friendly"
  | "professional"
  | "empathetic"
  | "confident";

// =============================================================================
// Settings Types
// =============================================================================

export type AuthMode = "optional" | "required";
export type ExtensionEnvironment = "development" | "beta" | "production";
export type DeploymentMode = "local" | "hosted_beta" | "hosted_public";
export type ModelMode = "local_models" | "byok_api";
export type LocalProviderKind = "ollama" | "openai_compatible_local";
export type CloudProviderKind =
  | "openai"
  | "anthropic"
  | "gemini"
  | "openrouter"
  | "openai_compatible_custom";
export type AccountPlan = "beta" | "starter" | "pro" | "enterprise";
export type SubscriptionState =
  | "inactive"
  | "beta"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled";

export type AccountSummary = {
  accountId: string;
  email: string;
  plan: AccountPlan;
  subscriptionState: SubscriptionState;
  betaAccess: boolean;
  displayName?: string;
};

export type AccountAccessState =
  | "inactive"
  | "beta"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled";

export type HostedSession = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  account: AccountSummary;
};

export type AccountPreferences = {
  defaultTonePreset: TonePreset;
  defaultCostMode: CostMode;
};

export type EntitlementSummary = {
  accessState: AccountAccessState;
  canGenerate: boolean;
  canUseEvidence: boolean;
  requiresUpgrade: boolean;
  message: string;
};

export type BillingSubscriptionSummary = {
  provider: "stripe";
  status: SubscriptionState;
  customerId?: string;
  subscriptionId?: string;
  priceId?: string;
};

export type BillingReadinessSummary = {
  status: "configured" | "partial" | "unconfigured";
  checkoutAvailable: boolean;
  message?: string;
};

export type BillingSummary = {
  apiVersion: string;
  deploymentMode: DeploymentMode;
  account: AccountSummary;
  entitlement: EntitlementSummary;
  subscription: BillingSubscriptionSummary | null;
  plan: AccountPlan;
  trialEndsAt?: string;
  currentPeriodEndsAt?: string;
  cancelAtPeriodEnd: boolean;
  billingPortalAvailable: boolean;
  billingReadiness: BillingReadinessSummary;
};

export type LocalProviderConfig = {
  kind: LocalProviderKind;
  baseUrl: string;
  modelName: string;
  apiKey: string;
  hasStoredApiKey: boolean;
};

export type CloudProviderConfig = {
  kind: CloudProviderKind;
  baseUrl: string;
  modelName: string;
  apiKey: string;
  hasStoredApiKey: boolean;
};

export type ProviderConfig = {
  mode: ModelMode;
  local: LocalProviderConfig;
  cloud: CloudProviderConfig;
};

export type BackendSettings = {
  baseUrl: string;
  token: string;
  validationWarnings: string[];
  lastValidatedAt?: string;
};

export type ProviderCredentialTarget = "local" | "cloud";

export type ProviderCredentialStorageBackend =
  | "macos_keychain"
  | "memory"
  | "unsupported";

export type ProviderCredentialRef = {
  target: ProviderCredentialTarget;
  kind: LocalProviderKind | CloudProviderKind;
};

export type ProviderCredentialUpsertRequest = ProviderCredentialRef & {
  apiKey: string;
};

export type ProviderCredentialDeleteRequest = ProviderCredentialRef;

export type ProviderCredentialState = ProviderCredentialRef & {
  hasStoredApiKey: boolean;
};

export type ProviderCredentialStatusResponse = {
  apiVersion: string;
  storage: {
    backend: ProviderCredentialStorageBackend;
    supported: boolean;
    message?: string;
  };
  credentials: ProviderCredentialState[];
};

export type UserPreferences = {
  defaultTonePreset: TonePreset;
  defaultCostMode: CostMode;
  telemetryEnabled: boolean;
  debugMode: boolean;
  allowHybridVoiceFallback: boolean;
};

export type AppSettings = {
  backend: BackendSettings;
  provider: ProviderConfig;
  preferences: UserPreferences;
  featureFlags: Record<FeatureFlagKey, boolean>;
};

export type SettingsValidationRequest = {
  client?: string;
  providerConfig?: ProviderConfig;
};

export type SettingsValidationResponse = {
  valid: boolean;
  warnings: string[];
  apiVersion: string;
  serverVersion: string;
  deploymentMode: DeploymentMode;
  cloudGenerationAvailable: boolean;
  authMode: AuthMode;
  account?: AccountSummary;
  draftingProvider: DraftingProviderStatus;
  parserProvider: ParserProviderStatus;
};

export type BetaSessionRequest = {
  email: string;
  inviteCode: string;
};

export type BetaSessionResponse = {
  apiVersion: string;
  deploymentMode: DeploymentMode;
  session: HostedSession;
};

export type AccountProfileResponse = {
  apiVersion: string;
  deploymentMode: DeploymentMode;
  cloudGenerationAvailable: boolean;
  account: AccountSummary;
};

export type RefreshSessionRequest = {
  refreshToken: string;
};

export type RefreshSessionResponse = {
  apiVersion: string;
  deploymentMode: DeploymentMode;
  session: HostedSession;
};

export type EmailAuthRequest = {
  email: string;
};

export type EmailAuthRequestResponse = {
  apiVersion: string;
  deploymentMode: DeploymentMode;
  accepted: true;
};

export type EmailAuthVerifyRequest = {
  token: string;
};

export type EmailAuthVerifyResponse = {
  apiVersion: string;
  deploymentMode: DeploymentMode;
  session: HostedSession;
};

export type DeviceAuthStartRequest = {
  client?: string;
};

export type DeviceAuthStartResponse = {
  apiVersion: string;
  deploymentMode: DeploymentMode;
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: string;
  pollIntervalMs: number;
};

export type DeviceAuthPollRequest = {
  deviceCode: string;
};

export type DeviceAuthPollResponse = {
  apiVersion: string;
  deploymentMode: DeploymentMode;
  status: "pending" | "approved" | "expired" | "denied";
  pollIntervalMs: number;
  session?: HostedSession;
};

export type DeviceAuthCompleteRequest = {
  userCode: string;
};

export type DeviceAuthCompleteResponse = {
  apiVersion: string;
  deploymentMode: DeploymentMode;
  completed: true;
};

export type CheckoutSessionRequest = {
  successUrl?: string;
  cancelUrl?: string;
};

export type CheckoutSessionResponse = {
  apiVersion: string;
  deploymentMode: DeploymentMode;
  url: string;
};

export type BillingPortalRequest = {
  returnUrl?: string;
};

export type BillingPortalResponse = {
  apiVersion: string;
  deploymentMode: DeploymentMode;
  url: string;
};

export type AccountPreferencesResponse = {
  apiVersion: string;
  deploymentMode: DeploymentMode;
  preferences: AccountPreferences;
};

export type GenerationRecordSummary = {
  generationId: string;
  requestId: string;
  createdAt: string;
  siteId: SiteId;
  actionMode: ActionMode;
  tonePreset: TonePreset;
  providerPath: "local_model" | "cloud";
  warningCount: number;
  usedVoiceInput: boolean;
  contextScopeUsed: ContextScope;
  evidenceIdsUsed: string[];
  primaryDraft: string;
  alternateDraft: string;
};

export type GenerationHistoryResponse = {
  apiVersion: string;
  deploymentMode: DeploymentMode;
  generations: GenerationRecordSummary[];
};

export type DraftingProviderStatus = {
  runtimeType: DraftingRuntimeType;
  ready: boolean;
  modelName?: string;
  warning?: string;
  recommendedModelName?: string;
  setupHint?: string;
};

export type ParserProviderStatus = {
  runtimeType: ParserRuntimeType;
  ready: boolean;
  imageOcrAvailable: boolean;
  modelName?: string;
  warning?: string;
  fallbackMode: ParserFallbackMode;
  recommendedModelName?: string;
  setupHint?: string;
};

export type RuntimeReadinessState =
  | "ready"
  | "degraded"
  | "not_configured"
  | "unavailable"
  | "disabled";

export type RuntimeReadinessEntry = {
  status: RuntimeReadinessState;
  label: string;
  detail?: string;
};

export type RuntimeReadiness = {
  drafting: RuntimeReadinessEntry;
  evidence: RuntimeReadinessEntry;
  voice: RuntimeReadinessEntry;
  telemetry: RuntimeReadinessEntry;
  attachHelper: AttachCapability;
};

export type GenerateDraftRequest = {
  sessionId: string;
  sessionVersion: number;
  siteId: SiteId;
  actionMode: ActionMode;
  tonePreset: TonePreset;
  draftInput: string;
  instructionInput?: string;
  contextEnabled: boolean;
  snapshot: ComposerSnapshot;
  evidence: EvidenceSummary[];
  usedVoiceInput: boolean;
  costMode: CostMode;
  providerConfig?: ProviderConfig;
};

export type DraftRole = "primary" | "alternate";

export type DraftVariantKind =
  | "cleaned_draft"
  | "context_reply"
  | "default_primary"
  | "default_alternate";

export type DraftVariant = {
  id: string;
  role: DraftRole;
  variantKind?: DraftVariantKind;
  label: string;
  text: string;
  styleNotes: string[];
};

export type EntityCorrection = {
  from: string;
  to: string;
  source: "context" | "metadata" | "evidence";
};

export type GenerateDraftSelectionDebug = {
  responseTarget?: {
    textPreview: string;
    author?: string;
    role?: "customer" | "agent" | "unknown";
    reason: string;
  };
  currentMessageFallbackUsed: boolean;
  supportTurnCount: number;
};

export type GenerateDraftSupportingFactDebug = {
  kind:
    | "request_frame"
    | "explicit_fact"
    | "resolved_reference"
    | "supporting_detail"
    | "allowed_uncertainty";
  textPreview: string;
  sourceAuthor?: string;
  relevance: number;
};

export type GenerateDraftExcludedTurnDebug = {
  kind:
    | "confirmed_answer"
    | "hypothesis"
    | "action_request"
    | "question"
    | "ack"
    | "other";
  textPreview: string;
  author?: string;
};

export type GenerateDraftCleanupDebug = {
  winner: "model";
  modelQualityScore?: number;
  selectedQualityScore: number;
  suspiciousTokens: string[];
};

export type GenerateDraftContextReplyDebug = {
  winner: "model" | "cleaned_draft_reuse";
  usedFallback: boolean;
  qualityScore?: number;
  coverage: "grounded" | "current_message_only" | "limited";
};

export type GenerateDraftProviderDebug = {
  runtime: "ollama" | "generic_local_chat_api";
  usedRetryPass: boolean;
};

export type GenerateDraftDebug = {
  selection: GenerateDraftSelectionDebug;
  supportingFacts: GenerateDraftSupportingFactDebug[];
  excludedTurns: GenerateDraftExcludedTurnDebug[];
  cleanup: GenerateDraftCleanupDebug;
  contextReply: GenerateDraftContextReplyDebug;
  provider: GenerateDraftProviderDebug;
};

export type GenerateDraftResponse = {
  apiVersion: string;
  requestId: string;
  drafts: [DraftVariant, DraftVariant];
  warnings: string[];
  timings: GenerateDraftTimings;
  inputSummary: {
    contextUsed: boolean;
    contextItemsUsed: number;
    contextScopeUsed: ContextScope;
    evidenceIdsUsed: string[];
    usedVoiceInput: boolean;
    providerPath: "local_model" | "cloud";
    entityCorrectionsApplied: EntityCorrection[];
  };
  debug?: GenerateDraftDebug;
};

// =============================================================================
// Insert Types — TRD §20
// =============================================================================

export type InsertResult =
  | { success: true }
  | { success: false; errorCode: string; message: string };

export type ComposerHandle = {
  element: Element;
  adapterId: AdapterId;
  fingerprint: string;
};
