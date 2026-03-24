// =============================================================================
// Background Service Worker — TRD §14.1
// =============================================================================

import { bootstrap } from "../core/boot/bootstrap.js";
import {
  WorkspaceStateStore,
  type PendingEvidenceState,
  type WorkspaceState,
} from "../core/workspace/WorkspaceStateStore.js";
import { ApiClientError } from "../shared-client/ApiClient.js";
import { EvidenceApiClient, type EvidenceIngestResponse } from "./EvidenceApiClient.js";
import { buildEvidenceIngestFailure } from "./evidenceErrors.js";
import type {
  ActionMode,
  AdapterId,
  AttachCapability,
  AppSettings,
  ComposerSnapshot,
  ComposerSession,
  CostMode,
  EvidenceSummary,
  FeatureFlagKey,
  GenerateDraftRequest,
  GenerateDraftResponse,
  ModuleContext,
  RuntimeReadiness,
  RuntimeReadinessEntry,
  SettingsValidationResponse,
  TelemetryEventName,
  TonePreset,
  TranscriptionResponse,
} from "@replymate/contracts";
import { FEATURE_FLAGS, TELEMETRY_EVENT_NAMES } from "@replymate/contracts";

type EvidenceUploadItem = {
  localId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  mode: "context_only" | "intended_attachment";
  mentionInReply: boolean;
  dataBase64: string;
};

type VoiceTranscribePayload = {
  audioBase64: string;
  mimeType: string;
  costMode: GenerateDraftRequest["costMode"];
};

type VoiceLocalStartPayload = {
  sessionId: string;
  target: "draft" | "instructions";
};

type VoiceLocalEventPayload = {
  sessionId: string;
  target: "draft" | "instructions";
  kind:
    | "requesting_permission"
    | "awaiting_page_click"
    | "recording"
    | "transcribing"
    | "transcript_ready"
    | "error"
    | "stopped";
  startedAt?: string;
  transcript?: string;
  message?: string;
  failureKind?: string;
};

type RuntimeReadinessPayload = {
  tabId?: number;
  browserLocalVoiceAvailable?: boolean;
  browserRecordingAvailable?: boolean;
};

type InsertExecutionResponse = {
  success: boolean;
  errorCode?: string;
  message?: string;
};

const workspaceStateStore = new WorkspaceStateStore();
const RUNTIME_VALIDATION_CACHE_TTL_MS = 5_000;
const runtimeValidationCache = new Map<
  string,
  { expiresAt: number; result: SettingsValidationResponse }
>();
const runtimeValidationInFlight = new Map<string, Promise<SettingsValidationResponse>>();

type DraftingWorkspaceStatePatch = {
  actionMode?: ActionMode;
  tonePreset?: TonePreset;
  costMode?: CostMode;
  instruction?: string;
  usedVoiceInput?: boolean;
  response?: GenerateDraftResponse | null;
  error?: string | null;
  siteId?: ComposerSession["siteId"];
  adapterId?: ComposerSession["adapterId"];
};

function mergeEvidence(
  current: EvidenceSummary[],
  additions: EvidenceSummary[]
): EvidenceSummary[] {
  const next = [...current];
  for (const summary of additions) {
    const existingIndex = next.findIndex((item) => item.evidenceId === summary.evidenceId);
    if (existingIndex >= 0) {
      next[existingIndex] = summary;
    } else {
      next.push(summary);
    }
  }
  return next.slice(0, 5);
}

function removeEvidenceById(
  current: EvidenceSummary[],
  evidenceId: string
): EvidenceSummary[] {
  return current.filter((item) => item.evidenceId !== evidenceId);
}

function broadcast(type: string, payload?: unknown): void {
  chrome.runtime.sendMessage({ type, payload }).catch(() => {});
}

function broadcastSessionUpdated(session: ComposerSession | null, tabId: number): void {
  broadcast("SESSION_UPDATED", {
    tabId,
    sessionId: session?.sessionId ?? null,
    workspaceKey: session?.snapshot?.workspaceKey,
  });
}

function broadcastEvidenceUpdated(
  tabId: number,
  workspaceKey: string,
  evidence: EvidenceSummary[]
): void {
  broadcast("EVIDENCE_UPDATED", {
    tabId,
    workspaceKey,
    evidence,
  });
}

function broadcastEvidenceStatusUpdated(
  tabId: number,
  workspaceKey: string,
  pendingEvidence: PendingEvidenceState[]
): void {
  broadcast("EVIDENCE_STATUS_UPDATED", {
    tabId,
    workspaceKey,
    pendingEvidence,
  });
}

function mergePendingEvidence(
  current: PendingEvidenceState[],
  updates: PendingEvidenceState[]
): PendingEvidenceState[] {
  const next = [...current];
  for (const update of updates) {
    const index = next.findIndex((item) => item.localId === update.localId);
    if (index >= 0) {
      next[index] = update;
    } else {
      next.push(update);
    }
  }
  return next;
}

function removePendingEvidence(
  current: PendingEvidenceState[],
  localId: string
): PendingEvidenceState[] {
  return current.filter((item) => item.localId !== localId);
}

async function getActiveTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id ?? null;
}

function findSessionById(
  sessionStore: ModuleContext["sessionStore"],
  sessionId: string | undefined
): ComposerSession | null {
  if (!sessionId) return null;
  return sessionStore.getSessions().find((session) => session.sessionId === sessionId) ?? null;
}

function resolveSessionForMessage(
  ctx: ModuleContext,
  payload: Record<string, unknown> | undefined,
  sender: chrome.runtime.MessageSender
): ComposerSession | null {
  const requestedTabId =
    typeof payload?.tabId === "number" ? payload.tabId : sender.tab?.id;
  if (typeof requestedTabId === "number") {
    return ctx.sessionStore.getSession(requestedTabId);
  }

  const requestedSessionId =
    typeof payload?.sessionId === "string" ? payload.sessionId : undefined;
  return findSessionById(ctx.sessionStore, requestedSessionId);
}

function resolveWorkspaceKey(
  ctx: ModuleContext,
  payload: Record<string, unknown> | undefined,
  sender: chrome.runtime.MessageSender
): string | null {
  if (typeof payload?.workspaceKey === "string" && payload.workspaceKey.trim()) {
    return payload.workspaceKey;
  }

  return resolveSessionForMessage(ctx, payload, sender)?.snapshot?.workspaceKey ?? null;
}

function decodeBase64Blob(payload: string, mimeType: string): Blob {
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeValidationKey(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

function getRuntimeValidationCacheKey(settings: AppSettings): string {
  return `${normalizeValidationKey(settings.backend.baseUrl)}::${settings.backend.token || ""}`;
}

function clearRuntimeValidationCache(): void {
  runtimeValidationCache.clear();
  runtimeValidationInFlight.clear();
}

function isMissingReceiverMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("receiving end does not exist") ||
    normalized.includes("could not establish connection")
  );
}

function sendTabMessage<T>(tabId: number, message: unknown): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError?.message) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(response as T | undefined);
    });
  });
}

async function pingTabBridge(tabId: number): Promise<boolean> {
  try {
    const response = await sendTabMessage<{ pong?: boolean }>(tabId, { type: "PING" });
    return Boolean(response?.pong);
  } catch (error) {
    if (error instanceof Error && isMissingReceiverMessage(error.message)) {
      return false;
    }
    throw error;
  }
}

async function ensureTabBridge(tabId: number): Promise<{
  ready: boolean;
  recovered: boolean;
  message?: string;
}> {
  const ready = await pingTabBridge(tabId);
  if (ready) {
    return { ready: true, recovered: false };
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch (error) {
    return {
      ready: false,
      recovered: false,
      message:
        error instanceof Error
          ? error.message
          : "ReplyMate could not inject its page bridge into this tab.",
    };
  }

  await sleep(120);

  try {
    const recovered = await pingTabBridge(tabId);
    return recovered
      ? { ready: true, recovered: true }
      : {
          ready: false,
          recovered: true,
          message: "ReplyMate could not reconnect to this page. Refresh Slack and try again.",
        };
  } catch (error) {
    return {
      ready: false,
      recovered: true,
      message:
        error instanceof Error
          ? error.message
          : "ReplyMate could not reconnect to this page. Refresh Slack and try again.",
    };
  }
}

async function waitForSessionSnapshot(
  sessionStore: ModuleContext["sessionStore"],
  tabId: number,
  timeoutMs = 400
): Promise<ComposerSession | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = sessionStore.getSession(tabId);
    if (session?.snapshot) {
      return session;
    }
    await sleep(40);
  }
  return sessionStore.getSession(tabId);
}

async function refreshComposerSnapshotForTab(
  tabId: number
): Promise<{
  foundComposer: boolean;
  adapterId?: AdapterId | null;
  sessionId?: string | null;
}> {
  const response = await sendTabMessage<{
    ok?: boolean;
    foundComposer?: boolean;
    adapterId?: AdapterId | null;
    sessionId?: string | null;
  }>(tabId, {
    type: "REFRESH_COMPOSER_SNAPSHOT",
  });

  return {
    foundComposer: Boolean(response?.foundComposer),
    adapterId: response?.adapterId ?? null,
    sessionId: response?.sessionId ?? null,
  };
}

async function ensureSessionForTab(
  sessionStore: ModuleContext["sessionStore"],
  tabId: number,
  options: {
    forceRefresh?: boolean;
  } = {}
): Promise<{
  session: ComposerSession | null;
  bridgeRecovered: boolean;
  bridgeReady: boolean;
  message?: string;
  foundComposer: boolean;
  staleCleared: boolean;
}> {
  const existing = sessionStore.getSession(tabId);
  if (existing?.snapshot && !options.forceRefresh) {
    return {
      session: existing,
      bridgeRecovered: false,
      bridgeReady: true,
      foundComposer: true,
      staleCleared: false,
    };
  }

  const bridge = await ensureTabBridge(tabId);
  if (!bridge.ready) {
    return {
      session: null,
      bridgeRecovered: bridge.recovered,
      bridgeReady: false,
      message: bridge.message,
      foundComposer: false,
      staleCleared: false,
    };
  }

  let refreshResult: Awaited<ReturnType<typeof refreshComposerSnapshotForTab>> | null = null;
  try {
    refreshResult = await refreshComposerSnapshotForTab(tabId);
  } catch (error) {
    if (error instanceof Error && isMissingReceiverMessage(error.message)) {
      return {
        session: null,
        bridgeRecovered: bridge.recovered,
        bridgeReady: false,
        message: error.message,
        foundComposer: false,
        staleCleared: false,
      };
    }
    throw error;
  }

  if (options.forceRefresh && refreshResult && !refreshResult.foundComposer) {
    const hadSession = Boolean(existing);
    if (hadSession) {
      sessionStore.clearSession(tabId);
    }
    broadcastSessionUpdated(null, tabId);
    return {
      session: null,
      bridgeRecovered: bridge.recovered,
      bridgeReady: true,
      message: "ReplyMate could not find an active text box on this page. Focus the composer and try again.",
      foundComposer: false,
      staleCleared: hadSession,
    };
  }

  const session = await waitForSessionSnapshot(sessionStore, tabId, options.forceRefresh ? 500 : 400);
  return {
    session,
    bridgeRecovered: bridge.recovered,
    bridgeReady: true,
    foundComposer: refreshResult?.foundComposer ?? Boolean(session?.snapshot),
    staleCleared: false,
    message:
      session?.snapshot
        ? undefined
        : "ReplyMate could not find an active text box after reconnecting to the page.",
  };
}

async function validateRuntimeSettingsCached(
  settingsService: ModuleContext["settings"],
  currentSettings: AppSettings
): Promise<SettingsValidationResponse> {
  const cacheKey = getRuntimeValidationCacheKey(currentSettings);
  const now = Date.now();
  const cached = runtimeValidationCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return cached.result;
  }

  const inFlight = runtimeValidationInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const validationPromise = settingsService
    .validateConnection({
      baseUrl: currentSettings.backend.baseUrl,
      token: currentSettings.backend.token,
    })
    .then((result) => {
      runtimeValidationCache.set(cacheKey, {
        expiresAt: Date.now() + RUNTIME_VALIDATION_CACHE_TTL_MS,
        result,
      });
      runtimeValidationInFlight.delete(cacheKey);
      return result;
    })
    .catch((error) => {
      runtimeValidationInFlight.delete(cacheKey);
      throw error;
    });

  runtimeValidationInFlight.set(cacheKey, validationPromise);
  return validationPromise;
}

function isTelemetryEventName(value: string): value is TelemetryEventName {
  return (TELEMETRY_EVENT_NAMES as readonly string[]).includes(value);
}

function publishRateLimitedTelemetry(
  bus: ModuleContext["bus"],
  scope: string,
  error: unknown
): void {
  if (
    error instanceof ApiClientError &&
    (error.status === 429 || error.errorCode === "RATE_LIMITED")
  ) {
    bus.publish({
      type: "telemetry/event",
      name: "rate_limited",
      payload: { scope, status: error.status },
    });
  }
}

function withStableSessionVersion(
  tabId: number,
  sessionId: string,
  snapshot: ComposerSnapshot,
  ctx: ModuleContext
): ComposerSnapshot {
  const current = ctx.sessionStore.getSession(tabId);
  const sessionVersion =
    current?.sessionId === sessionId && current.snapshot
      ? current.snapshot.sessionVersion
      : 1;

  return {
    ...snapshot,
    sessionVersion,
  };
}

function syncRuntimeSettings(settings: AppSettings, ctx: ModuleContext): void {
  ctx.apiClient.setBaseUrl(settings.backend.baseUrl);
  ctx.apiClient.setToken(settings.backend.token);

  for (const [flag, value] of Object.entries(settings.featureFlags)) {
    ctx.featureFlags.setFlag(flag as FeatureFlagKey, value);
  }
  void ctx.featureFlags.save();
}

function resolveAttachCapability(session: ComposerSession | null): AttachCapability {
  switch (session?.adapterId) {
    case "slack":
    case "gmail":
      return "manual_only";
    default:
      return "none";
  }
}

function buildDraftingReadiness(
  settings: AppSettings,
  validation: SettingsValidationResponse | null,
  validationError: string | null
): RuntimeReadinessEntry {
  if (!settings.backend.baseUrl) {
    return {
      status: "not_configured",
      label: "Drafting not configured",
      detail: "ReplyMate backend URL is not configured.",
    };
  }

  if (!validation) {
    return {
      status: "unavailable",
      label: "Drafting unavailable",
      detail: validationError || "Could not validate the drafting runtime.",
    };
  }

  if (validation.draftingProvider.ready) {
    return {
      status: "ready",
      label: "Drafting ready",
      detail: validation.draftingProvider.modelName
        ? `Model ${validation.draftingProvider.modelName}`
        : "Local drafting runtime is ready.",
    };
  }

  const notConfigured =
    validation.draftingProvider.warning?.includes("No local drafting model is configured.") ||
    validation.draftingProvider.warning?.includes("No drafting provider is configured.");

  return {
    status: notConfigured ? "not_configured" : "unavailable",
    label: notConfigured ? "Drafting not configured" : "Drafting unavailable",
    detail:
      validation.draftingProvider.setupHint ||
      validation.draftingProvider.warning ||
      "No usable drafting provider is ready.",
  };
}

function buildEvidenceReadiness(
  settings: AppSettings,
  validation: SettingsValidationResponse | null,
  validationError: string | null
): RuntimeReadinessEntry {
  if (!settings.backend.baseUrl) {
    return {
      status: "not_configured",
      label: "Evidence OCR not configured",
      detail: "ReplyMate backend URL is not configured.",
    };
  }

  if (!validation) {
    return {
      status: "unavailable",
      label: "Evidence OCR unavailable",
      detail: validationError || "Could not validate the evidence parser runtime.",
    };
  }

  if (validation.parserProvider.ready && validation.parserProvider.imageOcrAvailable) {
    return {
      status: "ready",
      label: "Evidence OCR ready",
      detail: validation.parserProvider.modelName
        ? `Model ${validation.parserProvider.modelName}`
        : "Local image OCR is ready.",
    };
  }

  if (validation.parserProvider.fallbackMode === "metadata_local") {
    return {
      status: "degraded",
      label: "Evidence OCR metadata fallback",
      detail:
        validation.parserProvider.warning ||
        "Current parser is metadata-only for images.",
    };
  }

  const notConfigured =
    validation.parserProvider.warning?.includes("No local parser model is configured.") ||
    validation.parserProvider.warning?.includes("No parser runtime is configured.");

  return {
    status: notConfigured ? "not_configured" : "unavailable",
    label: notConfigured ? "Evidence OCR not configured" : "Evidence OCR unavailable",
    detail:
      validation.parserProvider.setupHint ||
      validation.parserProvider.warning ||
      "No usable image OCR parser is ready.",
  };
}

function buildVoiceReadiness(
  settings: AppSettings,
  payload: RuntimeReadinessPayload | undefined
): RuntimeReadinessEntry {
  if (payload?.browserLocalVoiceAvailable) {
    return {
      status: "degraded",
      label: "Voice detected",
      detail:
        "Browser-local speech recognition was detected, but Chrome support can still be inconsistent. Start recording to verify it on this page.",
    };
  }

  const canUseRemoteCapture = Boolean(payload?.browserRecordingAvailable);
  const canUseRemoteTranscription =
    Boolean(settings.backend.baseUrl) &&
    settings.preferences.defaultCostMode !== "local_only" &&
    (settings.preferences.defaultCostMode === "cloud_quality" ||
      settings.preferences.allowHybridVoiceFallback);

  if (canUseRemoteCapture && canUseRemoteTranscription) {
    return {
      status: "degraded",
      label: "Voice degraded",
      detail: "Browser-local speech recognition is unavailable; remote transcription can still be used.",
    };
  }

  return {
    status: "unavailable",
    label: "Voice unavailable",
    detail: "No usable voice path is available under the current browser and settings.",
  };
}

function buildTelemetryReadiness(settings: AppSettings): RuntimeReadinessEntry {
  if (
    !settings.preferences.telemetryEnabled ||
    !settings.featureFlags[FEATURE_FLAGS.TELEMETRY_ENABLED]
  ) {
    return {
      status: "disabled",
      label: "Telemetry disabled",
      detail: "Telemetry is turned off in settings or feature flags.",
    };
  }

  if (!settings.backend.baseUrl) {
    return {
      status: "disabled",
      label: "Telemetry disabled",
      detail: "Backend URL is not configured, so telemetry is not being sent.",
    };
  }

  return {
    status: "ready",
    label: "Telemetry enabled",
    detail: "Coarse diagnostics are enabled.",
  };
}

async function ingestEvidenceItem(
  evidenceApiClient: EvidenceApiClient,
  bus: ModuleContext["bus"],
  sessionId: string,
  item: EvidenceUploadItem
): Promise<EvidenceSummary> {
  const formData = new FormData();
  formData.append("sessionId", sessionId);
  formData.append("mode", item.mode);
  formData.append("mentionInReply", String(item.mentionInReply));
  formData.append("file", decodeBase64Blob(item.dataBase64, item.mimeType), item.name);

  const ingestResponse: EvidenceIngestResponse = await evidenceApiClient.ingest(formData);

  if (ingestResponse.mode === "sync") {
    return ingestResponse.result;
  }

  return evidenceApiClient.waitForSummary(ingestResponse.job.jobId, (attempt, jobId) => {
    bus.publish({
      type: "telemetry/event",
      name: "evidence_job_polled",
      payload: { jobId, attempt },
    });
  });
}

const bootPromise = bootstrap("background");

bootPromise.then(async ({ ctx, registry }) => {
  const { logger, bus, sessionStore, settings } = ctx;
  await workspaceStateStore.load();
  syncRuntimeSettings(settings.get(), ctx);
  settings.subscribe((next) => syncRuntimeSettings(next, ctx));

  registry.bootAll(ctx).then(() => {
    logger.info("All modules booted.");
  });

  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => logger.error("Failed to set panel behavior", { error: String(err) }));

  chrome.commands.onCommand.addListener((command) => {
    if (command === "open-assistant") {
      bus.publish({ type: "telemetry/event", name: "panel_opened", payload: { source: "shortcut" } });
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.sidePanel.open({ tabId: tabs[0].id }).catch((err) => {
            logger.error("Failed to open side panel via shortcut", {
              error: String(err),
            });
          });
        }
      });
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { type, payload } = message as { type: string; payload?: any };

    switch (type) {
      case "GET_SESSION": {
        const requestedTabId =
          typeof payload?.tabId === "number" ? payload.tabId : sender.tab?.id;
        sendResponse({
          session:
            typeof requestedTabId === "number"
              ? sessionStore.getSession(requestedTabId)
              : null,
        });
        break;
      }

      case "GET_ACTIVE_TAB": {
        getActiveTabId()
          .then((tabId) => sendResponse({ tabId }))
          .catch((error) =>
            sendResponse({
              tabId: null,
              error: error instanceof Error ? error.message : String(error),
            })
          );
        return true;
      }

      case "SYNC_ACTIVE_TAB_SESSION": {
        const requestedTabId =
          typeof payload?.tabId === "number" ? payload.tabId : null;
        const forceRefresh = payload?.forceRefresh === true;

        const sync = async () => {
          const tabId = requestedTabId ?? (await getActiveTabId());
          if (typeof tabId !== "number") {
            sendResponse({
              ok: true,
              tabId: null,
              session: null,
            });
            return;
          }

          const ensured = await ensureSessionForTab(sessionStore, tabId, {
            forceRefresh,
          });
          sendResponse({
            ok: ensured.bridgeReady,
            tabId,
            session: ensured.session ?? null,
            recovered: ensured.bridgeRecovered,
            message: ensured.message,
            foundComposer: ensured.foundComposer,
            staleCleared: ensured.staleCleared,
          });
        };

        sync().catch((error) => {
          sendResponse({
            ok: false,
            tabId: requestedTabId,
            session: null,
            message: error instanceof Error ? error.message : String(error),
          });
        });
        return true;
      }

      case "GET_WORKSPACE_STATE": {
        const workspaceKey = resolveWorkspaceKey(
          ctx,
          payload as Record<string, unknown> | undefined,
          sender
        );
        sendResponse({
          state: workspaceKey ? workspaceStateStore.get(workspaceKey) : null,
        });
        break;
      }

      case "SAVE_WORKSPACE_STATE": {
        const workspaceKey =
          typeof payload?.workspaceKey === "string" ? payload.workspaceKey : "";
        const patch = (payload?.state ?? {}) as Partial<WorkspaceState>;

        if (!workspaceKey) {
          sendResponse({ ok: false, error: "workspaceKey is required." });
          break;
        }

        workspaceStateStore
          .savePartial(workspaceKey, patch)
          .then((state) => sendResponse({ ok: true, state }))
          .catch((error) => {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        return true;
      }

      case "CLEAR_WORKSPACE_STATE": {
        const workspaceKey =
          typeof payload?.workspaceKey === "string" ? payload.workspaceKey : "";

        if (!workspaceKey) {
          sendResponse({ ok: false, error: "workspaceKey is required." });
          break;
        }

        workspaceStateStore
          .clear(workspaceKey)
          .then(() => sendResponse({ ok: true }))
          .catch((error) => {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        return true;
        break;
      }

      case "GET_SETTINGS": {
        sendResponse({ settings: settings.get() });
        break;
      }

      case "SAVE_SETTINGS": {
        settings
          .save(payload.settings as AppSettings)
          .then(() => {
            const nextSettings = settings.get();
            clearRuntimeValidationCache();
            syncRuntimeSettings(nextSettings, ctx);
            broadcast("SETTINGS_UPDATED", { settings: nextSettings });
            sendResponse({ ok: true, settings: nextSettings });
          })
          .catch((error) => {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        return true;
      }

      case "VALIDATE_SETTINGS": {
        settings
          .validateConnection(payload.backend)
          .then((result) => sendResponse({ ok: true, result }))
          .catch((error) => {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        return true;
      }

      case "GET_RUNTIME_READINESS": {
        const runtimePayload = (payload ?? {}) as RuntimeReadinessPayload;
        const requestedTabId =
          typeof runtimePayload.tabId === "number"
            ? runtimePayload.tabId
            : sender.tab?.id ?? null;
        const session =
          typeof requestedTabId === "number"
            ? sessionStore.getSession(requestedTabId)
            : null;
        const currentSettings = settings.get();

        validateRuntimeSettingsCached(settings, currentSettings)
          .then((validation) => {
            const readiness: RuntimeReadiness = {
              drafting: buildDraftingReadiness(currentSettings, validation, null),
              evidence: buildEvidenceReadiness(currentSettings, validation, null),
              voice: buildVoiceReadiness(currentSettings, runtimePayload),
              telemetry: buildTelemetryReadiness(currentSettings),
              attachHelper: resolveAttachCapability(session),
            };

            sendResponse({ ok: true, readiness, validation });
          })
          .catch((error) => {
            const validationError =
              error instanceof Error ? error.message : String(error);
            const readiness: RuntimeReadiness = {
              drafting: buildDraftingReadiness(currentSettings, null, validationError),
              evidence: buildEvidenceReadiness(currentSettings, null, validationError),
              voice: buildVoiceReadiness(currentSettings, runtimePayload),
              telemetry: buildTelemetryReadiness(currentSettings),
              attachHelper: resolveAttachCapability(session),
            };

            sendResponse({
              ok: true,
              readiness,
              error: validationError,
            });
          });
        return true;
      }

      case "TRACK_TELEMETRY_EVENT": {
        const name = payload?.name;
        if (!isTelemetryEventName(name)) {
          sendResponse({ ok: false, error: "Invalid telemetry event name." });
          break;
        }

        bus.publish({
          type: "telemetry/event",
          name,
          payload:
            payload && typeof payload.payload === "object" && payload.payload !== null
              ? payload.payload
              : undefined,
        });
        sendResponse({ ok: true });
        break;
      }

      case "UPDATE_SNAPSHOT": {
        const { sessionId, adapterId, snapshot } = payload as {
          sessionId: string;
          adapterId: AdapterId;
          snapshot: ComposerSnapshot;
        };
        const tabId = sender.tab?.id ?? 0;

        const previous = sessionStore.getSession(tabId);
        const shouldCreateSession =
          !previous ||
          previous.sessionId !== sessionId ||
          previous.adapterId !== adapterId;

        if (shouldCreateSession) {
          sessionStore.setSession(tabId, {
            tabId,
            sessionId,
            siteId: snapshot.metadata.siteId,
            adapterId,
            capabilityMap: ctx.capabilityRegistry.getCapabilities(),
            snapshot: null,
            warnings: [],
            updatedAt: new Date().toISOString(),
          });

          bus.publish({
            type: "session/activeChanged",
            tabId,
            sessionId,
          });
          bus.publish({
            type: "telemetry/event",
            name: "composer_detected",
            payload: { siteId: snapshot.metadata.siteId, adapterId },
          });
        }

        const stableSnapshot = withStableSessionVersion(tabId, sessionId, snapshot, ctx);
        sessionStore.updateSnapshot(tabId, sessionId, stableSnapshot);
        bus.publish({
          type: "session/snapshotUpdated",
          sessionId,
          snapshot: stableSnapshot,
        });
        bus.publish({
          type: "telemetry/event",
          name:
            stableSnapshot.visibleContext.length > 0
              ? "context_capture_succeeded"
              : "context_capture_failed",
          payload: {
            siteId: stableSnapshot.metadata.siteId,
            adapterId,
            visibleContextCount: stableSnapshot.visibleContext.length,
          },
        });

        const nextSession = sessionStore.getSession(tabId);
        broadcastSessionUpdated(nextSession, tabId);
        sendResponse({ ok: true });
        break;
      }

      case "OPEN_SIDE_PANEL": {
        const tabId = sender.tab?.id;
        if (!tabId) {
          sendResponse({
            ok: false,
            error: "No active tab context available for side panel open.",
          });
          break;
        }

        bus.publish({ type: "telemetry/event", name: "panel_opened", payload: { source: "inline_trigger" } });
        chrome.sidePanel
          .open({ tabId })
          .then(() => sendResponse({ ok: true }))
          .catch((err) => {
            sendResponse({ ok: false, error: String(err) });
          });

        return true;
      }

      case "CLEAR_SESSION": {
        const tabId = sender.tab?.id ?? 0;
        sessionStore.clearSession(tabId);
        bus.publish({
          type: "session/activeChanged",
          tabId,
          sessionId: null,
        });
        broadcastSessionUpdated(null, tabId);
        sendResponse({ ok: true });
        break;
      }

      case "CHECK_SESSION_CURRENT": {
        const { sessionId, sessionVersion, viewFingerprint, composerFingerprint } = payload;
        const tabId =
          typeof payload?.tabId === "number" ? payload.tabId : sender.tab?.id ?? 0;
        const isCurrent = sessionStore.isSessionCurrent(
          tabId,
          sessionId,
          sessionVersion,
          viewFingerprint,
          composerFingerprint
        );
        sendResponse({ isCurrent });
        break;
      }

      case "ENSURE_TAB_BRIDGE": {
        const tabId =
          typeof payload?.tabId === "number" ? payload.tabId : sender.tab?.id ?? 0;

        if (!tabId) {
          sendResponse({
            ok: false,
            message: "No active tab was available for ReplyMate recovery.",
          });
          break;
        }

        ensureSessionForTab(sessionStore, tabId, { forceRefresh: true })
          .then(({ session, bridgeRecovered, bridgeReady, message }) => {
            sendResponse({
              ok: bridgeReady && Boolean(session?.snapshot),
              recovered: bridgeRecovered,
              session: session ?? null,
              message,
            });
          })
          .catch((error) => {
            sendResponse({
              ok: false,
              message: error instanceof Error ? error.message : String(error),
            });
          });
        return true;
      }

      case "GET_FEATURE_FLAGS": {
        sendResponse({ flags: ctx.featureFlags.getAll() });
        break;
      }

      case "GET_EVIDENCE": {
        const workspaceKey = resolveWorkspaceKey(
          ctx,
          payload as Record<string, unknown> | undefined,
          sender
        );
        const state = workspaceKey ? workspaceStateStore.get(workspaceKey) : null;

        sendResponse({
          evidence: state?.evidence ?? [],
          pendingEvidence: state?.pendingEvidence ?? [],
        });
        break;
      }

      case "UPSERT_EVIDENCE": {
        const { workspaceKey, summaries, tabId } = payload as {
          workspaceKey?: string;
          summaries: EvidenceSummary[];
          tabId?: number;
        };
        const resolvedWorkspaceKey =
          workspaceKey ||
          resolveWorkspaceKey(ctx, payload as Record<string, unknown> | undefined, sender);

        if (!resolvedWorkspaceKey) {
          sendResponse({ ok: false, error: "No workspace available for evidence." });
          break;
        }

        const current = workspaceStateStore.get(resolvedWorkspaceKey)?.evidence ?? [];
        const updated = mergeEvidence(current, summaries);
        workspaceStateStore
          .setEvidence(resolvedWorkspaceKey, updated)
          .then(() => {
            for (const summary of summaries) {
              bus.publish({
                type: "evidence/uploaded",
                sessionId:
                  resolveSessionForMessage(
                    ctx,
                    payload as Record<string, unknown> | undefined,
                    sender
                  )?.sessionId || resolvedWorkspaceKey,
                evidence: summary,
              });
            }
            const resolvedTabId =
              typeof tabId === "number"
                ? tabId
                : resolveSessionForMessage(
                    ctx,
                    payload as Record<string, unknown> | undefined,
                    sender
                  )?.tabId ?? 0;
            broadcastEvidenceUpdated(resolvedTabId, resolvedWorkspaceKey, updated);
            sendResponse({ ok: true, evidence: updated });
          })
          .catch((error) =>
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            })
          );
        return true;
        break;
      }

      case "REMOVE_EVIDENCE": {
        const { evidenceId } = payload as {
          evidenceId: string;
        };
        const workspaceKey = resolveWorkspaceKey(
          ctx,
          payload as Record<string, unknown> | undefined,
          sender
        );

        if (!workspaceKey) {
          sendResponse({ ok: false, error: "No workspace available for evidence removal." });
          break;
        }

        const session =
          resolveSessionForMessage(ctx, payload as Record<string, unknown> | undefined, sender);
        const current = workspaceStateStore.get(workspaceKey)?.evidence ?? [];
        const evidence = removeEvidenceById(current, evidenceId);
        workspaceStateStore
          .setEvidence(workspaceKey, evidence)
          .then(() => {
            bus.publish({
              type: "evidence/removed",
              sessionId: session?.sessionId ?? workspaceKey,
              evidenceId,
            });
            broadcastEvidenceUpdated(session?.tabId ?? 0, workspaceKey, evidence);
            sendResponse({ ok: true, evidence });
          })
          .catch((error) =>
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            })
          );
        return true;
        break;
      }

      case "EVIDENCE_INGEST": {
        const { sessionId, items } = payload as {
          sessionId: string;
          items: EvidenceUploadItem[];
        };
        const session = findSessionById(sessionStore, sessionId);
        const workspaceKey = session?.snapshot?.workspaceKey;

        if (!sessionId || !workspaceKey || !session) {
          sendResponse({ success: false, error: "No active session for evidence ingest." });
          break;
        }

        if (!Array.isArray(items) || items.length === 0) {
          sendResponse({ success: false, error: "No evidence files provided." });
          break;
        }

        if (!ctx.apiClient.getBaseUrl()) {
          sendResponse({
            success: false,
            error: "Backend URL is not configured. Set it in ReplyMate settings.",
          });
          break;
        }

        bus.publish({
          type: "telemetry/event",
          name: "evidence_upload_started",
          payload: { sessionId, fileCount: items.length, workspaceKey },
        });

        const queuedEntries: PendingEvidenceState[] = items.map((item) => ({
          localId: item.localId,
          name: item.name,
          state: "queued",
        }));

        workspaceStateStore
          .savePartial(workspaceKey, {
            siteId: session.siteId,
            adapterId: session.adapterId,
            pendingEvidence: mergePendingEvidence(
              workspaceStateStore.get(workspaceKey)?.pendingEvidence ?? [],
              queuedEntries
            ),
          })
          .then((nextState) => {
            broadcastEvidenceStatusUpdated(
              session.tabId,
              workspaceKey,
              nextState.pendingEvidence ?? []
            );
            sendResponse({ success: true, accepted: true });
            const evidenceApiClient = new EvidenceApiClient(ctx.apiClient);

            void (async () => {
              for (const item of items) {
                const currentPending = workspaceStateStore.get(workspaceKey)?.pendingEvidence ?? [];
                const processingPending = mergePendingEvidence(currentPending, [
                  {
                    localId: item.localId,
                    name: item.name,
                    state: "processing",
                  },
                ]);

                await workspaceStateStore.savePartial(workspaceKey, {
                  siteId: session.siteId,
                  adapterId: session.adapterId,
                  pendingEvidence: processingPending,
                });
                broadcastEvidenceStatusUpdated(
                  session.tabId,
                  workspaceKey,
                  processingPending
                );

                try {
                  const summary = await ingestEvidenceItem(
                    evidenceApiClient,
                    bus,
                    sessionId,
                    item
                  );
                  const currentState = workspaceStateStore.get(workspaceKey);
                  const nextEvidence = mergeEvidence(currentState?.evidence ?? [], [summary]);
                  const nextPending = removePendingEvidence(
                    currentState?.pendingEvidence ?? [],
                    item.localId
                  );

                  await workspaceStateStore.savePartial(workspaceKey, {
                    siteId: session.siteId,
                    adapterId: session.adapterId,
                    evidence: nextEvidence,
                    pendingEvidence: nextPending,
                  });

                  bus.publish({ type: "evidence/uploaded", sessionId, evidence: summary });
                  bus.publish({
                    type: "telemetry/event",
                    name: "evidence_upload_succeeded",
                    payload: { sessionId, evidenceId: summary.evidenceId },
                  });
                  broadcastEvidenceUpdated(session.tabId, workspaceKey, nextEvidence);
                  broadcastEvidenceStatusUpdated(session.tabId, workspaceKey, nextPending);
                } catch (err) {
                  const failure = buildEvidenceIngestFailure(err);
                  const logData = {
                    errorCode: failure.errorCode,
                    status: failure.status,
                    name: failure.name,
                    rawType: failure.rawType,
                    userMessage: failure.userMessage,
                  };

                  if (failure.expected) {
                    logger.warn(failure.logMessage, logData);
                  } else {
                    logger.error(failure.logMessage, logData);
                  }
                  publishRateLimitedTelemetry(bus, "evidence_ingest", err);
                  bus.publish({
                    type: "telemetry/event",
                    name: "evidence_upload_failed",
                    payload: { sessionId, fileName: item.name },
                  });

                  const currentState = workspaceStateStore.get(workspaceKey);
                  const failedPending = mergePendingEvidence(
                    removePendingEvidence(
                      currentState?.pendingEvidence ?? [],
                      item.localId
                    ),
                    [
                      {
                        localId: item.localId,
                        name: item.name,
                        state: "failed",
                        error: failure.userMessage,
                      },
                    ]
                  );
                  await workspaceStateStore.savePartial(workspaceKey, {
                    siteId: session.siteId,
                    adapterId: session.adapterId,
                    pendingEvidence: failedPending,
                  });
                  broadcastEvidenceStatusUpdated(
                    session.tabId,
                    workspaceKey,
                    failedPending
                  );
                }
              }
            })().catch((error) => {
              logger.error("Evidence background queue failed unexpectedly.", {
                error: error instanceof Error ? error.message : String(error),
              });
            });
          })
          .catch((error) => {
            sendResponse({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });

        return true;
      }

      case "GENERATE_DRAFT": {
        const request = payload as GenerateDraftRequest;
        const session = findSessionById(sessionStore, request.sessionId);
        const workspaceKey = request.snapshot.workspaceKey;
        bus.publish({
          type: "generation/requested",
          sessionId: request.sessionId,
        });
        bus.publish({
          type: "telemetry/event",
          name: "generation_requested",
          payload: { siteId: request.siteId, costMode: request.costMode },
        });

        if (!ctx.apiClient.getBaseUrl()) {
          sendResponse({
            success: false,
            error: "Backend URL is not configured. Set it in ReplyMate settings.",
          });
          break;
        }

        if (
          request.siteId === "slack_web" &&
          request.snapshot.composerMode === "thread" &&
          request.actionMode === "draft_from_context" &&
          request.snapshot.contextScope !== "thread"
        ) {
          const message =
            "No thread context was captured for this Slack thread. Use Improve Draft or recapture the thread.";
          void workspaceStateStore.savePartial(workspaceKey, {
            siteId: request.siteId,
            adapterId: session?.adapterId,
            actionMode: request.actionMode,
            tonePreset: request.tonePreset,
            costMode: request.costMode,
            instruction: request.instructionInput || "",
            usedVoiceInput: request.usedVoiceInput,
            error: message,
            response: null,
          });
          sendResponse({
            success: false,
            error: message,
            errorCode: "NO_THREAD_CONTEXT",
          });
          break;
        }

        void workspaceStateStore.savePartial(workspaceKey, {
          siteId: request.siteId,
          adapterId: session?.adapterId,
          actionMode: request.actionMode,
          tonePreset: request.tonePreset,
          costMode: request.costMode,
          instruction: request.instructionInput || "",
          usedVoiceInput: request.usedVoiceInput,
        } satisfies DraftingWorkspaceStatePatch);

        ctx.apiClient
          .post<GenerateDraftResponse>("/v1/generate", request)
          .then((response) => {
            bus.publish({
              type: "generation/succeeded",
              sessionId: request.sessionId,
              drafts: response.drafts,
            });
            bus.publish({
              type: "telemetry/event",
              name: "generation_succeeded",
              payload: {
                siteId: request.siteId,
                providerPath: response.inputSummary.providerPath,
              },
            });
            workspaceStateStore
              .savePartial(workspaceKey, {
                siteId: request.siteId,
                adapterId: session?.adapterId,
                actionMode: request.actionMode,
                tonePreset: request.tonePreset,
                costMode: request.costMode,
                instruction: request.instructionInput || "",
                usedVoiceInput: request.usedVoiceInput,
                response,
                error: null,
              } satisfies DraftingWorkspaceStatePatch)
              .then(() => sendResponse({ success: true, response }))
              .catch((error) => {
                sendResponse({
                  success: false,
                  error: error instanceof Error ? error.message : String(error),
                });
              });
          })
          .catch((error) => {
            publishRateLimitedTelemetry(bus, "generate", error);
            bus.publish({
              type: "generation/failed",
              sessionId: request.sessionId,
              errorCode: "GENERATION_FAILED",
            });
            bus.publish({
              type: "telemetry/event",
              name: "generation_failed",
              payload: { siteId: request.siteId },
            });
            const nextError =
              error instanceof Error ? error.message : String(error);
            workspaceStateStore
              .savePartial(workspaceKey, {
                siteId: request.siteId,
                adapterId: session?.adapterId,
                actionMode: request.actionMode,
                tonePreset: request.tonePreset,
                costMode: request.costMode,
                instruction: request.instructionInput || "",
                usedVoiceInput: request.usedVoiceInput,
                response: null,
                error: nextError,
              } satisfies DraftingWorkspaceStatePatch)
              .finally(() => {
                sendResponse({
                  success: false,
                  error: nextError,
                  errorCode: error instanceof ApiClientError ? error.errorCode : undefined,
                });
              });
          });

        return true;
      }

      case "EXECUTE_INSERT": {
        const {
          sessionId,
          sessionVersion,
          viewFingerprint,
          composerFingerprint,
          text,
          mode,
        } = payload;
        const insertMode = mode === "append" ? "append" : "replace";

        void (async () => {
          const requestedTabId =
            typeof payload?.tabId === "number" ? payload.tabId : 0;

          if (!requestedTabId) {
            sendResponse({
              success: false,
              errorCode: "NO_COMPOSER",
              message: "No active tab was available for direct insert.",
            } satisfies InsertExecutionResponse);
            return;
          }

          const recoveredSessionState = await ensureSessionForTab(
            sessionStore,
            requestedTabId
          );
          const session =
            findSessionById(sessionStore, sessionId) ??
            recoveredSessionState.session ??
            sessionStore.getSession(requestedTabId);

          if (!session?.snapshot || !session.tabId) {
            const errorCode = recoveredSessionState.bridgeReady
              ? "NO_COMPOSER"
              : "INSERT_TAB_BRIDGE_MISSING";
            sendResponse({
              success: false,
              errorCode,
              message:
                recoveredSessionState.message ||
                (errorCode === "NO_COMPOSER"
                  ? "Focus the correct text box and try again."
                  : "ReplyMate could not reconnect to this page. Refresh Slack and try again."),
            } satisfies InsertExecutionResponse);
            return;
          }

          const isCurrent = sessionStore.isSessionCurrent(
            session.tabId,
            sessionId,
            sessionVersion,
            viewFingerprint,
            composerFingerprint
          );

          if (!isCurrent) {
            bus.publish({
              type: "telemetry/event",
              name: "stale_session_blocked",
              payload: { sessionId },
            });
            sendResponse({
              success: false,
              errorCode: "STALE_SESSION",
              message: "The target text box has changed. Please copy and paste instead.",
            } satisfies InsertExecutionResponse);
            return;
          }

          const bridge = await ensureTabBridge(session.tabId);
          if (!bridge.ready) {
            bus.publish({
              type: "insert/failed",
              sessionId,
              errorCode: "INSERT_FAILED",
            });
            sendResponse({
              success: false,
              errorCode: "INSERT_TAB_BRIDGE_MISSING",
              message:
                bridge.message ||
                "ReplyMate could not reconnect to this page. Refresh Slack and try again.",
            } satisfies InsertExecutionResponse);
            return;
          }

          const response = await sendTabMessage<InsertExecutionResponse>(session.tabId, {
            type: "INSERT_TEXT",
            payload: { text, mode: insertMode, adapterId: session.adapterId },
          });

          if (response?.success) {
            bus.publish({ type: "insert/succeeded", sessionId });
            bus.publish({
              type: "telemetry/event",
              name: "draft_inserted",
              payload: {
                sessionId,
                bridgeRecovered:
                  recoveredSessionState.bridgeRecovered || bridge.recovered,
              },
            });
          } else {
            const failureCode =
              response?.errorCode === "NO_COMPOSER" ||
              response?.errorCode === "STALE_SESSION" ||
              response?.errorCode === "INSERT_FAILED"
                ? response.errorCode
                : "INSERT_FAILED";
            bus.publish({
              type: "insert/failed",
              sessionId,
              errorCode: failureCode,
            });
          }

          sendResponse(
            response ?? {
              success: false,
              errorCode: "INSERT_FAILED",
              message: "ReplyMate could not insert the draft into this text box.",
            }
          );
        })().catch((error) => {
          sendResponse({
            success: false,
            errorCode: "INSERT_FAILED",
            message: error instanceof Error ? error.message : String(error),
          } satisfies InsertExecutionResponse);
        });
        return true;
      }

      case "VOICE_TRANSCRIPT_READY": {
        const { sessionId, target, transcript, source } = payload as {
          sessionId: string;
          target: "draft" | "instructions";
          transcript: string;
          source?: "local" | "cloud";
        };

        const normalizedTranscript = typeof transcript === "string" ? transcript.trim() : "";
        const validTarget = target === "draft" || target === "instructions";

        if (!sessionId || !validTarget || !normalizedTranscript) {
          sendResponse({ ok: false, error: "Invalid voice transcript payload." });
          break;
        }

        bus.publish({
          type: "voice/transcriptReady",
          sessionId,
          target,
          transcript: normalizedTranscript,
        });
        bus.publish({
          type: "telemetry/event",
          name: "voice_transcribed",
          payload: { sessionId, target, source: source === "cloud" ? "cloud" : "local" },
        });

        broadcast("VOICE_TRANSCRIPT_READY", {
          sessionId,
          target,
          transcript: normalizedTranscript,
          source: source === "cloud" ? "cloud" : "local",
        });

        sendResponse({ ok: true });
        break;
      }

      case "VOICE_LOCAL_START": {
        const request = payload as VoiceLocalStartPayload;
        const session = findSessionById(sessionStore, request.sessionId);

        if (!session?.tabId || !session.snapshot) {
          sendResponse({
            ok: false,
            error: "Focus the active composer before starting local voice capture.",
          });
          break;
        }

        ensureSessionForTab(sessionStore, session.tabId, { forceRefresh: false })
          .then(({ bridgeReady, message }) => {
            if (!bridgeReady) {
              sendResponse({
                ok: false,
                error: message || "ReplyMate could not reach the active page for local voice capture.",
              });
              return;
            }

            return sendTabMessage<{ ok?: boolean; error?: string }>(session.tabId, {
              type: "VOICE_LOCAL_START",
              payload: request,
            }).then((response) => {
              sendResponse({
                ok: Boolean(response?.ok),
                error: response?.error,
              });
            });
          })
          .catch((error) => {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        return true;
      }

      case "VOICE_LOCAL_STOP": {
        const request = payload as { sessionId?: string };
        const session = findSessionById(sessionStore, request.sessionId);

        if (!session?.tabId) {
          sendResponse({ ok: false, error: "No active local voice session to stop." });
          break;
        }

        sendTabMessage<{ ok?: boolean; error?: string }>(session.tabId, {
          type: "VOICE_LOCAL_STOP",
          payload: request,
        })
          .then((response) => {
            sendResponse({
              ok: Boolean(response?.ok),
              error: response?.error,
            });
          })
          .catch((error) => {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        return true;
      }

      case "VOICE_LOCAL_EVENT": {
        const localEvent = payload as VoiceLocalEventPayload;
        if (
          !localEvent?.sessionId ||
          (localEvent.target !== "draft" && localEvent.target !== "instructions")
        ) {
          sendResponse({ ok: false, error: "Invalid local voice event payload." });
          break;
        }

        const session = findSessionById(sessionStore, localEvent.sessionId);
        if (!session) {
          sendResponse({ ok: false, error: "No active session for local voice event." });
          break;
        }

        if (localEvent.kind === "recording") {
          bus.publish({
            type: "telemetry/event",
            name: "voice_started",
            payload: { sessionId: localEvent.sessionId, source: "local" },
          });
        }

        broadcast("VOICE_LOCAL_EVENT", {
          ...localEvent,
          tabId: session.tabId,
        });
        sendResponse({ ok: true });
        break;
      }

      case "VOICE_TRANSCRIBE": {
        const request = payload as VoiceTranscribePayload;

        if (!ctx.apiClient.getBaseUrl()) {
          sendResponse({
            ok: false,
            error: "Backend URL is not configured. Set it in ReplyMate settings.",
          });
          break;
        }

        if (request.costMode === "local_only") {
          sendResponse({
            ok: false,
            errorCode: "COST_MODE_BLOCKED",
            error: "Remote transcription is blocked in local_only mode.",
          });
          break;
        }

        if (
          request.costMode === "hybrid_low_cost" &&
          !settings.get().preferences.allowHybridVoiceFallback
        ) {
          sendResponse({
            ok: false,
            errorCode: "COST_MODE_BLOCKED",
            error: "Enable hybrid voice fallback in settings before using remote transcription.",
          });
          break;
        }

        bus.publish({
          type: "telemetry/event",
          name: "voice_started",
          payload: { mode: request.costMode, source: "remote" },
        });

        ctx.apiClient
          .post<TranscriptionResponse>("/v1/voice/transcribe", {
            audioBase64: request.audioBase64,
            mimeType: request.mimeType,
            costMode: request.costMode,
          })
          .then((result) => {
            if (request.costMode === "hybrid_low_cost") {
              bus.publish({
                type: "telemetry/event",
                name: "cloud_fallback_used",
                payload: { mode: request.costMode, surface: "voice" },
              });
            }
            sendResponse({ ok: true, result });
          })
          .catch((error) => {
            publishRateLimitedTelemetry(bus, "voice_transcribe", error);
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
              errorCode: error instanceof ApiClientError ? error.errorCode : undefined,
            });
          });
        return true;
      }

      default:
        sendResponse({ error: `Unknown message type: ${type}` });
    }

    return true;
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading") {
      const session = sessionStore.getSession(tabId);
      if (session) {
        sessionStore.clearSession(tabId);
        bus.publish({
          type: "session/activeChanged",
          tabId,
          sessionId: null,
        });
        broadcastSessionUpdated(null, tabId);
        logger.info("Session cleared due to tab navigation.", { tabId });
      }
    }
  });

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    ensureSessionForTab(sessionStore, tabId, { forceRefresh: false })
      .catch((error) => {
        logger.warn("Failed to hydrate active tab session on activation.", {
          tabId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        broadcast("ACTIVE_TAB_CHANGED", { tabId });
      });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    const session = sessionStore.getSession(tabId);
    if (session) {
      sessionStore.clearSession(tabId);
      broadcastSessionUpdated(null, tabId);
      logger.info("Session cleared due to tab close.", { tabId });
    }
  });

  logger.info("Background service worker ready.");
});
