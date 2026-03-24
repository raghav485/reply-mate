import type {
  AppSettings,
  AuthMode,
  BackendSettings,
  DraftingProviderStatus,
  DraftingRuntimeType,
  ParserFallbackMode,
  ParserProviderStatus,
  ParserRuntimeType,
  SettingsService as ISettingsService,
  SettingsValidationResponse,
} from "@replymate/contracts";
import {
  DEFAULT_FLAGS,
  type FeatureFlagKey,
} from "@replymate/contracts";

const APP_SETTINGS_KEY = "replymate:appSettings";
const LEGACY_BACKEND_KEY = "replymate:backendConfig";
const LEGACY_FLAGS_KEY = "replymate:featureFlags";

const DEFAULT_SETTINGS: AppSettings = {
  backend: {
    baseUrl: "http://localhost:3000",
    token: "",
    authMode: "optional",
    validationWarnings: [],
  },
  preferences: {
    defaultTonePreset: "professional",
    defaultCostMode: "local_only",
    telemetryEnabled: true,
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

function mergeFeatureFlags(
  input: unknown
): Record<FeatureFlagKey, boolean> {
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

function normalizeAuthMode(input: unknown): AuthMode {
  return input === "required" ? "required" : "optional";
}

function normalizeDraftingRuntimeType(input: unknown): DraftingRuntimeType {
  if (input === "generic_local_chat_api") {
    return input;
  }
  return "ollama";
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
      authMode: normalizeAuthMode(backendRaw.authMode),
      validationWarnings: Array.isArray(backendRaw.validationWarnings)
        ? backendRaw.validationWarnings.filter((item): item is string => typeof item === "string")
        : [],
      lastValidatedAt: readString(backendRaw, "lastValidatedAt"),
    },
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
        readBoolean(preferencesRaw, "debugMode") ??
        DEFAULT_SETTINGS.preferences.debugMode,
      allowHybridVoiceFallback:
        readBoolean(preferencesRaw, "allowHybridVoiceFallback") ??
        DEFAULT_SETTINGS.preferences.allowHybridVoiceFallback,
    },
    featureFlags: mergeFeatureFlags(input.featureFlags),
  };
}

function mergeLegacyState(
  backendConfig: unknown,
  featureFlags: unknown
): AppSettings {
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
    this.settings = mergeSettings(settings);
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
    backend: Pick<BackendSettings, "baseUrl" | "token">
  ): Promise<SettingsValidationResponse> {
    const baseUrl = normalizeBaseUrl(backend.baseUrl);
    if (!baseUrl) {
      return {
        valid: false,
        warnings: ["API base URL is required."],
        apiVersion: "v1",
        serverVersion: "unknown",
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
        ...(backend.token ? { Authorization: `Bearer ${backend.token}` } : {}),
      },
      body: JSON.stringify({ client: "replymate-extension" }),
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
      authMode: payload.authMode || "optional",
      draftingProvider: readDraftingProviderStatus(payload.draftingProvider),
      parserProvider: readParserProviderStatus(payload.parserProvider),
    };
  }

  subscribe(listener: (settings: AppSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
