// =============================================================================
// Core Interfaces — TRD §7.2, §7.3, §10.1
// =============================================================================

import type {
  FeatureId,
  SiteId,
  AdapterId,
  CapabilityMap,
  ComposerSnapshot,
  ComposerHandle,
  AttachCapability,
  InsertResult,
  ComposerSession,
  RuntimeSurface,
  AppSettings,
  BackendSettings,
  SettingsValidationResponse,
  DraftingProviderStatus,
  ParserProviderStatus,
} from "../types/index.js";
import type { ExtensionEvent } from "../events/index.js";
import type { FeatureFlagKey } from "../flags/index.js";

// =============================================================================
// Event Bus — TRD §8
// =============================================================================

export type EventHandler<T extends ExtensionEvent = ExtensionEvent> = (
  event: T
) => void;

export interface EventBus {
  publish(event: ExtensionEvent): void;
  subscribe<T extends ExtensionEvent["type"]>(
    type: T,
    handler: EventHandler<Extract<ExtensionEvent, { type: T }>>
  ): () => void;
  /** Remove all handlers. */
  clear(): void;
}

// =============================================================================
// Session Store — TRD §9
// =============================================================================

export interface SessionStore {
  getSession(tabId: number): ComposerSession | null;
  getSessions(): ComposerSession[];
  setSession(tabId: number, session: ComposerSession): void;
  clearSession(tabId: number): void;
  updateSnapshot(tabId: number, sessionId: string, snapshot: ComposerSnapshot): void;
  /**
   * Returns true if the given generation session identifiers still match
   * the active session — TRD §20.2 stale-session protection.
   */
  isSessionCurrent(
    tabId: number,
    sessionId: string,
    sessionVersion: number,
    viewFingerprint: string,
    composerFingerprint: string
  ): boolean;
}

// =============================================================================
// Capability Registry — TRD §6.3
// =============================================================================

export interface CapabilityRegistry {
  getCapabilities(): CapabilityMap;
  setCapability<K extends keyof CapabilityMap>(
    key: K,
    value: CapabilityMap[K]
  ): void;
  isAvailable(key: keyof CapabilityMap): boolean;
}

// =============================================================================
// Feature Flag Service — TRD §13
// =============================================================================

export interface FeatureFlagService {
  isEnabled(flag: FeatureFlagKey): boolean;
  getAll(): Record<FeatureFlagKey, boolean>;
  setFlag(flag: FeatureFlagKey, value: boolean): void;
  /** Load persisted flags from storage. */
  load(): Promise<void>;
  /** Persist current flags to storage. */
  save(): Promise<void>;
}

// =============================================================================
// API Client
// =============================================================================

export interface ApiClient {
  getBaseUrl(): string;
  setBaseUrl(url: string): void;
  setToken(token: string): void;
  getToken(): string;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  postMultipart<T>(path: string, formData: FormData): Promise<T>;
}

// =============================================================================
// Settings Service
// =============================================================================

export interface SettingsService {
  load(): Promise<void>;
  get(): AppSettings;
  save(settings: AppSettings): Promise<void>;
  validateConnection(
    backend: Pick<BackendSettings, "baseUrl" | "token">
  ): Promise<SettingsValidationResponse>;
  subscribe(listener: (settings: AppSettings) => void): () => void;
}

// =============================================================================
// Logger
// =============================================================================

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

// =============================================================================
// Module Context — TRD §7.3
// =============================================================================

// Forward declare UiRegistry interface from extension core since 
// contracts shouldn't depend on React/DOM types directly.
export interface UiRegistry {
  registerPanel(surface: RuntimeSurface, featureId: FeatureId, component: any): void;
  getPanels(surface: RuntimeSurface): { featureId: FeatureId; component: any }[];
}

export interface ModuleContext {
  runtimeSurface: RuntimeSurface;
  bus: EventBus;
  sessionStore: SessionStore;
  capabilityRegistry: CapabilityRegistry;
  featureFlags: FeatureFlagService;
  settings: SettingsService;
  apiClient: ApiClient;
  logger: Logger;
  uiRegistry: UiRegistry;
}

// =============================================================================
// Feature Module — TRD §7.2
// =============================================================================

export interface FeatureModule {
  id: FeatureId;
  version: string;
  surfaces: RuntimeSurface[];
  dependsOn: FeatureId[];
  requiredCapabilities: string[];
  optionalCapabilities?: string[];
  register(ctx: ModuleContext): Promise<void> | void;
  teardown?(ctx: ModuleContext): Promise<void> | void;
}

// =============================================================================
// Site Adapter — TRD §10.1
// =============================================================================

export interface SiteAdapter {
  id: AdapterId;
  siteId: SiteId;
  detectComposer(doc: Document): ComposerHandle | null;
  extractSnapshot(
    doc: Document,
    composer: ComposerHandle
  ): ComposerSnapshot;
  insertText(
    doc: Document,
    composer: ComposerHandle,
    text: string,
    mode: "replace" | "append"
  ): InsertResult;
  getAttachCapability(doc: Document): AttachCapability;
}

// =============================================================================
// Provider Adapters — TRD §11.2
// =============================================================================

import type {
  GenerateDraftRequest,
  GenerateDraftResponse,
  EvidenceSummary,
} from "../types/index.js";

export interface LLMProviderAdapter {
  checkHealth(): Promise<DraftingProviderStatus>;
  generateDrafts(
    input: GenerateDraftRequest
  ): Promise<GenerateDraftResponse>;
}

export interface TranscriptionRequest {
  audioBlob: Blob;
  mimeType: string;
  languageHint?: string;
}

export interface TranscriptionResponse {
  transcript: string;
  confidence: number;
}

export interface TranscriptionProviderAdapter {
  transcribeAudio(
    input: TranscriptionRequest
  ): Promise<TranscriptionResponse>;
}

export interface TempObjectPutRequest {
  key: string;
  data: Blob | Buffer;
  mimeType: string;
  ttlSeconds: number;
}

export interface TempObjectPutResponse {
  key: string;
  url: string;
  expiresAt: string;
}

export interface StorageProviderAdapter {
  putTempObject(input: TempObjectPutRequest): Promise<TempObjectPutResponse>;
  deleteTempObject(key: string): Promise<void>;
}

export interface EvidenceIngestRequest {
  fileData: Blob | Buffer;
  fileName: string;
  mimeType: string;
}

export interface DocumentParserAdapter {
  checkHealth(): Promise<ParserProviderStatus>;
  summarizeFile(input: EvidenceIngestRequest): Promise<EvidenceSummary>;
}
