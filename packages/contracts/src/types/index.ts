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
  | "generic_local_chat_api";

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

export type BackendSettings = {
  baseUrl: string;
  token: string;
  authMode: AuthMode;
  validationWarnings: string[];
  lastValidatedAt?: string;
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
  preferences: UserPreferences;
  featureFlags: Record<FeatureFlagKey, boolean>;
};

export type SettingsValidationResponse = {
  valid: boolean;
  warnings: string[];
  apiVersion: string;
  serverVersion: string;
  authMode: AuthMode;
  draftingProvider: DraftingProviderStatus;
  parserProvider: ParserProviderStatus;
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
