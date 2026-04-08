import type {
  AppSettings,
  BackendSettings,
  CloudProviderKind,
  DeploymentMode,
  DraftingProviderStatus,
  DraftingRuntimeType,
  LocalProviderKind,
  ModelMode,
  NativeRuntimeStatus,
  ParserFallbackMode,
  ParserProviderStatus,
  ParserRuntimeType,
  ProviderConfig,
  ProviderCredentialDeleteRequest,
  ProviderCredentialState,
  ProviderCredentialStatusResponse,
  ProviderCredentialUpsertRequest,
  SettingsService as ISettingsService,
  SettingsValidationResponse,
  VaultPasskeySetupRequest,
  VaultPassphraseSetupRequest,
  VaultPasskeyUnlockRequest,
  VaultPassphraseUnlockRequest,
  VaultStatus,
} from "@replymate/contracts";
import { DEFAULT_FLAGS, type FeatureFlagKey } from "@replymate/contracts";
import { sendRuntimeMessage } from "../../shared/runtime.js";

const APP_SETTINGS_KEY = "replymate:appSettings";
const LEGACY_BACKEND_KEY = "replymate:backendConfig";
const LEGACY_FLAGS_KEY = "replymate:featureFlags";

function resolveDefaultBaseUrl(): string {
  const env = (
    import.meta as ImportMeta & {
      env?: Record<string, string | undefined>;
    }
  ).env;
  const configured = env?.VITE_REPLYMATE_DEFAULT_BASE_URL?.trim();
  return configured ? configured.replace(/\/+$/, "") : "http://localhost:3000";
}

const DEFAULT_BASE_URL = resolveDefaultBaseUrl();

const DEFAULT_SETTINGS: AppSettings = {
  backend: {
    baseUrl: DEFAULT_BASE_URL,
    token: "",
    validationWarnings: [],
  },
  provider: {
    mode: "local_models",
    local: {
      kind: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      modelName: "qwen3:8b",
      apiKey: "",
      hasStoredApiKey: false,
    },
    cloud: {
      kind: "openai",
      baseUrl: "",
      modelName: "",
      apiKey: "",
      hasStoredApiKey: false,
    },
  },
  preferences: {
    defaultTonePreset: "professional",
    defaultCostMode: "local_only",
    telemetryEnabled: false,
    debugMode: false,
    allowHybridVoiceFallback: false,
  },
  featureFlags: { ...DEFAULT_FLAGS },
};

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function mergeFeatureFlags(input: unknown): Record<FeatureFlagKey, boolean> {
  if (!isRecord(input)) {
    return { ...DEFAULT_FLAGS };
  }

  const merged = { ...DEFAULT_FLAGS };
  for (const key of Object.keys(DEFAULT_FLAGS) as FeatureFlagKey[]) {
    const value = input[key];
    if (typeof value === "boolean") {
      merged[key] = value;
    }
  }
  return merged;
}

function normalizeDraftingRuntimeType(input: unknown): DraftingRuntimeType {
  if (
    input === "generic_local_chat_api" ||
    input === "openai_compatible" ||
    input === "anthropic" ||
    input === "gemini"
  ) {
    return input;
  }
  return "ollama";
}

function normalizeModelMode(input: unknown): ModelMode {
  return input === "byok_api" ? "byok_api" : "local_models";
}

function normalizeLocalProviderKind(input: unknown): LocalProviderKind {
  return input === "openai_compatible_local" ? input : "ollama";
}

function normalizeCloudProviderKind(input: unknown): CloudProviderKind {
  if (
    input === "anthropic" ||
    input === "gemini" ||
    input === "openrouter" ||
    input === "openai_compatible_custom"
  ) {
    return input;
  }
  return "openai";
}

function normalizeParserRuntimeType(input: unknown): ParserRuntimeType {
  if (
    input === "metadata_local" ||
    input === "generic_local_chat_api" ||
    input === "drafting_runtime"
  ) {
    return input;
  }
  return "ollama";
}

function normalizeParserFallbackMode(input: unknown): ParserFallbackMode {
  return input === "none" ? "none" : "metadata_local";
}

function readProviderConfig(input: unknown): ProviderConfig {
  const provider = isRecord(input) ? input : {};
  const local = isRecord(provider.local) ? provider.local : {};
  const cloud = isRecord(provider.cloud) ? provider.cloud : {};

  return {
    mode: normalizeModelMode(provider.mode),
    local: {
      kind: normalizeLocalProviderKind(local.kind),
      baseUrl:
        normalizeBaseUrl(readString(local, "baseUrl") || "") ||
        DEFAULT_SETTINGS.provider.local.baseUrl,
      modelName: readString(local, "modelName") || DEFAULT_SETTINGS.provider.local.modelName,
      apiKey: "",
      hasStoredApiKey: readBoolean(local, "hasStoredApiKey") || false,
    },
    cloud: {
      kind: normalizeCloudProviderKind(cloud.kind),
      baseUrl: normalizeBaseUrl(readString(cloud, "baseUrl") || ""),
      modelName: readString(cloud, "modelName") || "",
      apiKey: "",
      hasStoredApiKey: readBoolean(cloud, "hasStoredApiKey") || false,
    },
  };
}

function defaultDraftingProviderStatus(
  overrides: Partial<DraftingProviderStatus> = {}
): DraftingProviderStatus {
  return {
    runtimeType: "ollama",
    ready: false,
    recommendedModelName: "qwen3:8b",
    setupHint: "Recommended for M4 / 16GB: qwen3:8b for writing.",
    ...overrides,
  };
}

function defaultParserProviderStatus(
  overrides: Partial<ParserProviderStatus> = {}
): ParserProviderStatus {
  return {
    runtimeType: "drafting_runtime",
    ready: false,
    imageOcrAvailable: false,
    fallbackMode: "metadata_local",
    recommendedModelName: "minicpm-v",
    setupHint: "Recommended OCR model for M4 / 16GB: minicpm-v.",
    ...overrides,
  };
}

function readDraftingProviderStatus(input: unknown): DraftingProviderStatus {
  if (!isRecord(input)) {
    return defaultDraftingProviderStatus();
  }

  return defaultDraftingProviderStatus({
    runtimeType: normalizeDraftingRuntimeType(input.runtimeType),
    ready: typeof input.ready === "boolean" ? input.ready : false,
    modelName: readString(input, "modelName"),
    warning: readString(input, "warning"),
    recommendedModelName: readString(input, "recommendedModelName"),
    setupHint: readString(input, "setupHint"),
  });
}

function readParserProviderStatus(input: unknown): ParserProviderStatus {
  if (!isRecord(input)) {
    return defaultParserProviderStatus();
  }

  return defaultParserProviderStatus({
    runtimeType: normalizeParserRuntimeType(input.runtimeType),
    ready: typeof input.ready === "boolean" ? input.ready : false,
    imageOcrAvailable:
      typeof input.imageOcrAvailable === "boolean" ? input.imageOcrAvailable : false,
    modelName: readString(input, "modelName"),
    warning: readString(input, "warning"),
    recommendedModelName: readString(input, "recommendedModelName"),
    setupHint: readString(input, "setupHint"),
    fallbackMode: normalizeParserFallbackMode(input.fallbackMode),
  });
}

function readProviderCredentialState(input: unknown): ProviderCredentialState | null {
  if (!isRecord(input)) {
    return null;
  }

  const target = readString(input, "target");
  const kind = readString(input, "kind");
  const hasStoredApiKey = readBoolean(input, "hasStoredApiKey");

  if (
    (target !== "local" && target !== "cloud") ||
    !kind ||
    hasStoredApiKey === undefined
  ) {
    return null;
  }

  return {
    target,
    kind: kind as ProviderCredentialState["kind"],
    hasStoredApiKey,
  };
}

function readProviderCredentialStatusResponse(
  input: unknown
): ProviderCredentialStatusResponse | null {
  if (
    !isRecord(input) ||
    !isRecord(input.storage) ||
    !Array.isArray(input.credentials)
  ) {
    return null;
  }

  const backend = readString(input.storage, "backend");
  const supported = readBoolean(input.storage, "supported");
  if (
    !backend ||
    !["extension_local_vault", "macos_keychain", "windows_dpapi", "memory", "unsupported"].includes(backend) ||
    supported === undefined
  ) {
    return null;
  }

  const platform = readString(input.storage, "platform");
  const persistenceMode = readString(input.storage, "persistenceMode");
  if (
    !platform ||
    !["extension", "macos", "windows", "linux", "unknown"].includes(platform) ||
    !persistenceMode ||
    !["persistent_encrypted", "persistent_secure", "session_only", "unsupported"].includes(persistenceMode)
  ) {
    return null;
  }

  const credentials = input.credentials
    .map((item) => readProviderCredentialState(item))
    .filter((item): item is ProviderCredentialState => Boolean(item));

  return {
    apiVersion: readString(input, "apiVersion") || "v1",
    storage: {
      backend: backend as ProviderCredentialStatusResponse["storage"]["backend"],
      platform: platform as ProviderCredentialStatusResponse["storage"]["platform"],
      persistenceMode:
        persistenceMode as ProviderCredentialStatusResponse["storage"]["persistenceMode"],
      supported,
      message: readString(input.storage, "message"),
    },
    runtime: readNativeRuntimeStatus(input.runtime),
    vault: readVaultStatus(input.vault),
    credentials,
  };
}

function readVaultStatus(input: unknown): VaultStatus {
  if (!isRecord(input)) {
    return {
      mode: "unconfigured",
      lockState: "setup_required",
      sessionCacheEnabled: true,
      passkeySupported: false,
      encryptedEntryCount: 0,
    };
  }

  const mode = readString(input, "mode");
  const lockState = readString(input, "lockState");

  return {
    mode:
      mode === "passkey" || mode === "passphrase" || mode === "unconfigured"
        ? mode
        : "unconfigured",
    lockState:
      lockState === "locked" || lockState === "unlocked" || lockState === "setup_required"
        ? lockState
        : "setup_required",
    sessionCacheEnabled: readBoolean(input, "sessionCacheEnabled") ?? true,
    passkeySupported: readBoolean(input, "passkeySupported") ?? false,
    encryptedEntryCount:
      typeof input.encryptedEntryCount === "number" ? input.encryptedEntryCount : 0,
    credentialId: readString(input, "credentialId"),
    prfSaltBase64: readString(input, "prfSaltBase64"),
    message: readString(input, "message"),
  };
}

function readNativeRuntimeStatus(input: unknown): NativeRuntimeStatus | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  const transport = readString(input, "transport");
  const availability = readString(input, "availability");
  const extensionId = readString(input, "extensionId");
  const hostName = readString(input, "hostName");
  const message = readString(input, "message");

  if (
    !transport ||
    !["dev_loopback", "native_host", "extension_background"].includes(transport) ||
    !availability ||
    !["ready", "not_registered", "forbidden", "unavailable"].includes(availability) ||
    !extensionId ||
    !hostName ||
    !message
  ) {
    return undefined;
  }

  return {
    transport: transport as NativeRuntimeStatus["transport"],
    availability: availability as NativeRuntimeStatus["availability"],
    extensionId,
    hostName,
    message,
    actionHint: readString(input, "actionHint"),
  };
}

function mergeSettings(input: unknown): AppSettings {
  if (!isRecord(input)) {
    return { ...DEFAULT_SETTINGS, featureFlags: { ...DEFAULT_SETTINGS.featureFlags } };
  }

  const backendRaw = isRecord(input.backend) ? input.backend : {};
  const preferencesRaw = isRecord(input.preferences) ? input.preferences : {};

  return {
    backend: {
      baseUrl: normalizeBaseUrl(
        readString(backendRaw, "baseUrl") || DEFAULT_SETTINGS.backend.baseUrl
      ),
      token: readString(backendRaw, "token") || "",
      validationWarnings: Array.isArray(backendRaw.validationWarnings)
        ? backendRaw.validationWarnings.filter((item): item is string => typeof item === "string")
        : [],
      lastValidatedAt: readString(backendRaw, "lastValidatedAt"),
    },
    provider: readProviderConfig(input.provider),
    preferences: {
      defaultTonePreset:
        readString(preferencesRaw, "defaultTonePreset") === "concise" ||
        readString(preferencesRaw, "defaultTonePreset") === "friendly" ||
        readString(preferencesRaw, "defaultTonePreset") === "empathetic" ||
        readString(preferencesRaw, "defaultTonePreset") === "confident"
          ? (readString(preferencesRaw, "defaultTonePreset") as AppSettings["preferences"]["defaultTonePreset"])
          : DEFAULT_SETTINGS.preferences.defaultTonePreset,
      defaultCostMode:
        readString(preferencesRaw, "defaultCostMode") === "hybrid_low_cost" ||
        readString(preferencesRaw, "defaultCostMode") === "cloud_quality"
          ? (readString(preferencesRaw, "defaultCostMode") as AppSettings["preferences"]["defaultCostMode"])
          : DEFAULT_SETTINGS.preferences.defaultCostMode,
      telemetryEnabled:
        readBoolean(preferencesRaw, "telemetryEnabled") ??
        DEFAULT_SETTINGS.preferences.telemetryEnabled,
      debugMode:
        readBoolean(preferencesRaw, "debugMode") ?? DEFAULT_SETTINGS.preferences.debugMode,
      allowHybridVoiceFallback:
        readBoolean(preferencesRaw, "allowHybridVoiceFallback") ??
        DEFAULT_SETTINGS.preferences.allowHybridVoiceFallback,
    },
    featureFlags: mergeFeatureFlags(input.featureFlags),
  };
}

function mergeLegacyState(backendConfig: unknown, featureFlags: unknown): AppSettings {
  const backendRaw = isRecord(backendConfig) ? backendConfig : {};
  return {
    ...DEFAULT_SETTINGS,
    backend: {
      ...DEFAULT_SETTINGS.backend,
      baseUrl: normalizeBaseUrl(
        readString(backendRaw, "baseUrl") || DEFAULT_SETTINGS.backend.baseUrl
      ),
      token: readString(backendRaw, "token") || "",
    },
    featureFlags: mergeFeatureFlags(featureFlags),
  };
}

function sanitizeSettingsForStorage(settings: AppSettings): AppSettings {
  const merged = mergeSettings(settings);
  return {
    ...merged,
    provider: {
      ...merged.provider,
      local: {
        ...merged.provider.local,
        apiKey: "",
      },
      cloud: {
        ...merged.provider.cloud,
        apiKey: "",
      },
    },
  };
}

function normalizeDeploymentMode(input: unknown): DeploymentMode {
  if (input === "hosted_beta" || input === "hosted_public") {
    return input;
  }
  return "local";
}

export class SettingsServiceImpl implements ISettingsService {
  private settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    featureFlags: { ...DEFAULT_SETTINGS.featureFlags },
  };

  private listeners = new Set<(settings: AppSettings) => void>();

  constructor() {
    if (chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") return;
        const nextSettings = changes[APP_SETTINGS_KEY]?.newValue;
        if (nextSettings) {
          this.settings = mergeSettings(nextSettings);
          this.notify();
        }
      });
    }
  }

  async load(): Promise<void> {
    try {
      const result = await chrome.storage.local.get([
        APP_SETTINGS_KEY,
        LEGACY_BACKEND_KEY,
        LEGACY_FLAGS_KEY,
      ]);
      if (result[APP_SETTINGS_KEY]) {
        this.settings = mergeSettings(result[APP_SETTINGS_KEY]);
      } else {
        this.settings = mergeLegacyState(
          result[LEGACY_BACKEND_KEY],
          result[LEGACY_FLAGS_KEY]
        );
      }
    } catch {
      this.settings = {
        ...DEFAULT_SETTINGS,
        featureFlags: { ...DEFAULT_SETTINGS.featureFlags },
      };
    }
  }

  get(): AppSettings {
    return JSON.parse(JSON.stringify(this.settings)) as AppSettings;
  }

  async save(settings: AppSettings): Promise<void> {
    this.settings = sanitizeSettingsForStorage(settings);
    this.settings.preferences.defaultCostMode =
      this.settings.provider.mode === "local_models" ? "local_only" : "cloud_quality";

    try {
      await chrome.storage.local.set({
        [APP_SETTINGS_KEY]: this.settings,
        [LEGACY_BACKEND_KEY]: {
          baseUrl: this.settings.backend.baseUrl,
          token: this.settings.backend.token,
        },
        [LEGACY_FLAGS_KEY]: this.settings.featureFlags,
      });
    } finally {
      this.notify();
    }
  }

  async validateConnection(
    input: Pick<BackendSettings, "baseUrl" | "token"> & {
      providerConfig?: ProviderConfig;
    }
  ): Promise<SettingsValidationResponse> {
    const baseUrl = normalizeBaseUrl(input.baseUrl) || DEFAULT_BASE_URL;

    const runtimeResponse = await sendRuntimeMessage<{
      ok: boolean;
      result?: SettingsValidationResponse;
      error?: string;
    }>({
      type: "VALIDATE_SETTINGS",
      payload: {
        backend: { baseUrl, token: input.token },
        providerConfig: input.providerConfig || this.settings.provider,
      },
    });

    if (!runtimeResponse.ok || !runtimeResponse.result) {
      throw new Error(runtimeResponse.error || "Settings validation failed.");
    }

    const payload = runtimeResponse.result;

    return {
      valid: payload.valid,
      warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
      apiVersion: payload.apiVersion || "v1",
      serverVersion: payload.serverVersion || "unknown",
      deploymentMode: normalizeDeploymentMode(payload.deploymentMode),
      cloudGenerationAvailable: Boolean(payload.cloudGenerationAvailable),
      authMode: payload.authMode || "optional",
      account: payload.account,
      draftingProvider: readDraftingProviderStatus(payload.draftingProvider),
      parserProvider: readParserProviderStatus(payload.parserProvider),
    };
  }

  async getProviderCredentialStatus(
    input: Pick<BackendSettings, "baseUrl" | "token">
  ): Promise<ProviderCredentialStatusResponse> {
    return this.requestCredentialStatus({
      action: "GET_PROVIDER_CREDENTIAL_STATUS",
      ...input,
    });
  }

  async getNativeRuntimeStatus(
    input: Pick<BackendSettings, "baseUrl" | "token">
  ): Promise<NativeRuntimeStatus> {
    const baseUrl = normalizeBaseUrl(input.baseUrl) || DEFAULT_BASE_URL;

    const runtimeResponse = await sendRuntimeMessage<{
      ok: boolean;
      status?: NativeRuntimeStatus;
      error?: string;
    }>({
      type: "GET_NATIVE_RUNTIME_STATUS",
      payload: {
        baseUrl,
        token: input.token,
      },
    });

    if (!runtimeResponse.ok || !runtimeResponse.status) {
      throw new Error(runtimeResponse.error || "Native runtime status check failed.");
    }

    const parsed = readNativeRuntimeStatus(runtimeResponse.status);
    if (!parsed) {
      throw new Error("Native runtime status payload is invalid.");
    }

    return parsed;
  }

  async saveProviderCredential(
    input: Pick<BackendSettings, "baseUrl" | "token"> & ProviderCredentialUpsertRequest
  ): Promise<ProviderCredentialStatusResponse> {
    return this.requestCredentialStatus({
      action: "SAVE_PROVIDER_CREDENTIAL",
      ...input,
    });
  }

  async deleteProviderCredential(
    input: Pick<BackendSettings, "baseUrl" | "token"> & ProviderCredentialDeleteRequest
  ): Promise<ProviderCredentialStatusResponse> {
    return this.requestCredentialStatus({
      action: "DELETE_PROVIDER_CREDENTIAL",
      ...input,
    });
  }

  async setupVaultWithPasskey(
    input: VaultPasskeySetupRequest
  ): Promise<ProviderCredentialStatusResponse> {
    return this.requestCredentialStatus({
      action: "SETUP_VAULT_PASSKEY",
      payload: input,
    });
  }

  async setupVaultWithPassphrase(
    input: VaultPassphraseSetupRequest
  ): Promise<ProviderCredentialStatusResponse> {
    return this.requestCredentialStatus({
      action: "SETUP_VAULT_PASSPHRASE",
      payload: input,
    });
  }

  async unlockVaultWithPasskey(
    input: VaultPasskeyUnlockRequest
  ): Promise<ProviderCredentialStatusResponse> {
    return this.requestCredentialStatus({
      action: "UNLOCK_VAULT_PASSKEY",
      payload: input,
    });
  }

  async unlockVaultWithPassphrase(
    input: VaultPassphraseUnlockRequest
  ): Promise<ProviderCredentialStatusResponse> {
    return this.requestCredentialStatus({
      action: "UNLOCK_VAULT_PASSPHRASE",
      payload: input,
    });
  }

  async lockVault(): Promise<ProviderCredentialStatusResponse> {
    return this.requestCredentialStatus({
      action: "LOCK_VAULT",
      payload: {},
    });
  }

  subscribe(listener: (settings: AppSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async requestCredentialStatus(
    input:
      | ({
          action: "GET_PROVIDER_CREDENTIAL_STATUS";
        } & Pick<BackendSettings, "baseUrl" | "token">)
      | ({
          action: "SAVE_PROVIDER_CREDENTIAL";
        } & Pick<BackendSettings, "baseUrl" | "token"> &
          ProviderCredentialUpsertRequest)
      | ({
          action: "DELETE_PROVIDER_CREDENTIAL";
        } & Pick<BackendSettings, "baseUrl" | "token"> &
          ProviderCredentialDeleteRequest)
      | {
          action:
            | "SETUP_VAULT_PASSKEY"
            | "SETUP_VAULT_PASSPHRASE"
            | "UNLOCK_VAULT_PASSKEY"
            | "UNLOCK_VAULT_PASSPHRASE"
            | "LOCK_VAULT";
          payload: unknown;
        }
  ): Promise<ProviderCredentialStatusResponse> {
    if ("baseUrl" in input) {
      input.baseUrl = normalizeBaseUrl(input.baseUrl) || DEFAULT_BASE_URL;
    }

    const runtimeResponse = await sendRuntimeMessage<{
      ok: boolean;
      status?: ProviderCredentialStatusResponse;
      error?: string;
    }>({
      type: input.action,
      payload: "payload" in input ? input.payload : input,
    });

    if (!runtimeResponse.ok || !runtimeResponse.status) {
      throw new Error(runtimeResponse.error || "Provider credential request failed.");
    }

    const parsed = readProviderCredentialStatusResponse(runtimeResponse.status);
    if (!parsed) {
      throw new Error("Provider credential response payload is invalid.");
    }

    return parsed;
  }

  private notify(): void {
    const snapshot = this.get();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Listener isolation.
      }
    }
  }
}
