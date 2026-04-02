import type {
  AppSettings,
  BackendSettings,
  CloudProviderKind,
  DeploymentMode,
  DraftingProviderStatus,
  DraftingRuntimeType,
  LocalProviderKind,
  ModelMode,
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
} from "@replymate/contracts";
import { DEFAULT_FLAGS, type FeatureFlagKey } from "@replymate/contracts";

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
      apiKey: readString(local, "apiKey") || "",
      hasStoredApiKey: readBoolean(local, "hasStoredApiKey") || false,
    },
    cloud: {
      kind: normalizeCloudProviderKind(cloud.kind),
      baseUrl: normalizeBaseUrl(readString(cloud, "baseUrl") || ""),
      modelName: readString(cloud, "modelName") || "",
      apiKey: readString(cloud, "apiKey") || "",
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
  if (!isRecord(input) || !isRecord(input.storage) || !Array.isArray(input.credentials)) {
    return null;
  }

  const backend = readString(input.storage, "backend");
  const supported = readBoolean(input.storage, "supported");
  if (
    !backend ||
    !["macos_keychain", "memory", "unsupported"].includes(backend) ||
    supported === undefined
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
      supported,
      message: readString(input.storage, "message"),
    },
    credentials,
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
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    if (!baseUrl) {
      return {
        valid: false,
        warnings: ["API base URL is required."],
        apiVersion: "v1",
        serverVersion: "unknown",
        deploymentMode: "local",
        cloudGenerationAvailable: false,
        authMode: "optional",
        draftingProvider: defaultDraftingProviderStatus({
          warning: "ReplyMate API base URL is not configured.",
        }),
        parserProvider: defaultParserProviderStatus({
          warning: "ReplyMate API base URL is not configured.",
        }),
      };
    }

    const response = await fetch(`${baseUrl}/v1/settings/validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
      },
      body: JSON.stringify({
        client: "replymate-extension",
        providerConfig: input.providerConfig || this.settings.provider,
      }),
    });

    const payload = (await response.json()) as SettingsValidationResponse & {
      message?: string;
    };

    if (!response.ok) {
      throw new Error(payload.message || "Settings validation failed.");
    }

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
    return this.requestCredentialStatus(input, {
      method: "GET",
    });
  }

  async saveProviderCredential(
    input: Pick<BackendSettings, "baseUrl" | "token"> & ProviderCredentialUpsertRequest
  ): Promise<ProviderCredentialStatusResponse> {
    return this.requestCredentialStatus(input, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: input.target,
        kind: input.kind,
        apiKey: input.apiKey,
      }),
    });
  }

  async deleteProviderCredential(
    input: Pick<BackendSettings, "baseUrl" | "token"> & ProviderCredentialDeleteRequest
  ): Promise<ProviderCredentialStatusResponse> {
    return this.requestCredentialStatus(input, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: input.target,
        kind: input.kind,
      }),
    });
  }

  subscribe(listener: (settings: AppSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async requestCredentialStatus(
    input: Pick<BackendSettings, "baseUrl" | "token">,
    init: RequestInit
  ): Promise<ProviderCredentialStatusResponse> {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    if (!baseUrl) {
      throw new Error("API base URL is required.");
    }

    const response = await fetch(`${baseUrl}/v1/settings/provider-credentials`, {
      ...init,
      headers: {
        ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
        ...(init.headers || {}),
      },
    });

    const payload = (await response.json()) as ProviderCredentialStatusResponse & {
      message?: string;
    };
    if (!response.ok) {
      throw new Error(payload.message || "Provider credential request failed.");
    }

    const parsed = readProviderCredentialStatusResponse(payload);
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
