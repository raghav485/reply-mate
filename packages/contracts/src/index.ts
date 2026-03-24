// =============================================================================
// @replymate/contracts — Barrel Export
// =============================================================================

// Domain types
export type {
  SiteId,
  RuntimeSurface,
  FeatureId,
  AdapterId,
  ProviderId,
  EvidenceMode,
  AttachCapability,
  CostMode,
  DraftingRuntimeType,
  ParserRuntimeType,
  ParserFallbackMode,
  ContextScope,
  ComposerMode,
  CapabilityMap,
  MessageContextItem,
  CaptureDropReason,
  CaptureDebugSnapshot,
  PageMetadata,
  ComposerSnapshot,
  ComposerSession,
  EvidenceItem,
  EvidenceSummary,
  EvidenceJobState,
  EvidenceJobStatus,
  VoiceState,
  ActionMode,
  TonePreset,
  AuthMode,
  BackendSettings,
  UserPreferences,
  AppSettings,
  DraftingProviderStatus,
  ParserProviderStatus,
  RuntimeReadinessState,
  RuntimeReadinessEntry,
  RuntimeReadiness,
  SettingsValidationResponse,
  GenerateDraftRequest,
  DraftRole,
  DraftVariantKind,
  DraftVariant,
  EntityCorrection,
  GenerateDraftSelectionDebug,
  GenerateDraftSupportingFactDebug,
  GenerateDraftExcludedTurnDebug,
  GenerateDraftCleanupDebug,
  GenerateDraftContextReplyDebug,
  GenerateDraftProviderDebug,
  GenerateDraftDebug,
  GenerateDraftTimings,
  GenerateDraftResponse,
  InsertResult,
  ComposerHandle,
} from "./types/index.js";

// Events
export type {
  ExtensionEvent,
  TelemetryEventName,
} from "./events/index.js";
export { TELEMETRY_EVENT_NAMES } from "./events/index.js";

// Errors
export type { ErrorCode } from "./errors/index.js";
export { ERROR_MESSAGES } from "./errors/index.js";

// Feature flags
export type { FeatureFlagKey } from "./flags/index.js";
export { FEATURE_FLAGS, DEFAULT_FLAGS } from "./flags/index.js";

// Interfaces
export type {
  EventHandler,
  EventBus,
  SessionStore,
  CapabilityRegistry,
  FeatureFlagService,
  SettingsService,
  ApiClient,
  Logger,
  ModuleContext,
  FeatureModule,
  SiteAdapter,
  LLMProviderAdapter,
  TranscriptionRequest,
  TranscriptionResponse,
  TranscriptionProviderAdapter,
  TempObjectPutRequest,
  TempObjectPutResponse,
  StorageProviderAdapter,
  EvidenceIngestRequest,
  DocumentParserAdapter,
} from "./interfaces/index.js";
