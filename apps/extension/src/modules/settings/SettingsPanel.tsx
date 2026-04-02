import { useEffect, useMemo, useState } from "react";
import {
  FEATURE_FLAGS,
  type AppSettings,
  type CloudProviderKind,
  type DraftingProviderStatus,
  type FeatureFlagKey,
  type LocalProviderKind,
  type ModelMode,
  type ProviderCredentialStatusResponse,
  type ParserProviderStatus,
  type SettingsValidationResponse,
  type TonePreset,
} from "@replymate/contracts";
import { useShellContext } from "../../core/ui/ShellContext.js";

const FLAG_META: {
  key: FeatureFlagKey;
  label: string;
  desc: string;
  alwaysOn?: boolean;
}[] = [
  {
    key: FEATURE_FLAGS.DRAFTING_ENABLED,
    label: "Drafting",
    desc: "Core draft generation. Always on.",
    alwaysOn: true,
  },
  {
    key: FEATURE_FLAGS.EVIDENCE_ENABLED,
    label: "Evidence Upload",
    desc: "Upload files as context or intended attachments.",
  },
  {
    key: FEATURE_FLAGS.VOICE_ENABLED,
    label: "Voice Input",
    desc: "Speak instead of type.",
  },
  {
    key: FEATURE_FLAGS.TELEMETRY_ENABLED,
    label: "Telemetry",
    desc: "Coarse event reporting for diagnostics.",
  },
  {
    key: FEATURE_FLAGS.SITE_SLACK_ENABLED,
    label: "Slack",
    desc: "Slack web adapter.",
  },
  {
    key: FEATURE_FLAGS.SITE_GMAIL_ENABLED,
    label: "Gmail",
    desc: "Gmail web adapter.",
  },
  {
    key: FEATURE_FLAGS.SITE_GENERIC_ENABLED,
    label: "Generic Sites",
    desc: "Beta support for generic web composers.",
  },
];

function cloneSettings(settings: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(settings)) as AppSettings;
}

function formatDraftingRuntimeType(status: DraftingProviderStatus): string {
  switch (status.runtimeType) {
    case "openai_compatible":
      return "OpenAI-compatible API";
    case "anthropic":
      return "Anthropic API";
    case "gemini":
      return "Gemini API";
    case "generic_local_chat_api":
      return "Local OpenAI-compatible API";
    case "ollama":
    default:
      return "Ollama";
  }
}

function formatParserRuntimeType(status: ParserProviderStatus): string {
  switch (status.runtimeType) {
    case "drafting_runtime":
      return "Reuse drafting runtime";
    case "metadata_local":
      return "Metadata-only local parser";
    case "generic_local_chat_api":
      return "Local OpenAI-compatible API";
    case "ollama":
    default:
      return "Ollama";
  }
}

function localProviderLabel(kind: LocalProviderKind): string {
  return kind === "openai_compatible_local"
    ? "Local OpenAI-compatible"
    : "Ollama";
}

function cloudProviderLabel(kind: CloudProviderKind): string {
  switch (kind) {
    case "anthropic":
      return "Anthropic";
    case "gemini":
      return "Gemini";
    case "openrouter":
      return "OpenRouter";
    case "openai_compatible_custom":
      return "Custom OpenAI-compatible";
    case "openai":
    default:
      return "OpenAI";
  }
}

function cloudProviderPlaceholder(kind: CloudProviderKind): string {
  switch (kind) {
    case "anthropic":
      return "https://api.anthropic.com";
    case "gemini":
      return "https://generativelanguage.googleapis.com";
    case "openrouter":
      return "https://openrouter.ai/api";
    case "openai":
      return "https://api.openai.com";
    case "openai_compatible_custom":
    default:
      return "https://your-openai-compatible-endpoint";
  }
}

function buildValidationSummary(
  response: SettingsValidationResponse,
  settings: AppSettings
): string {
  if (!response.valid) {
    return response.warnings.join(" ");
  }

  const providerLabel =
    settings.provider.mode === "local_models"
      ? localProviderLabel(settings.provider.local.kind)
      : cloudProviderLabel(settings.provider.cloud.kind);

  const draftingLabel = response.draftingProvider.modelName
    ? `${formatDraftingRuntimeType(response.draftingProvider)} (${response.draftingProvider.modelName})`
    : formatDraftingRuntimeType(response.draftingProvider);
  const parserLabel = response.parserProvider.ready && response.parserProvider.imageOcrAvailable
    ? `${formatParserRuntimeType(response.parserProvider)} OCR ready`
    : response.parserProvider.fallbackMode === "metadata_local"
      ? `${formatParserRuntimeType(response.parserProvider)} metadata fallback`
      : `${formatParserRuntimeType(response.parserProvider)} not ready`;

  return `Connected to ${response.serverVersion}. ${providerLabel} is ready through ${draftingLabel}. ${parserLabel}.`;
}

function providerModeLabel(mode: ModelMode): string {
  return mode === "byok_api" ? "Use Your Own API" : "Local Models";
}

function applyCredentialStatus(
  settings: AppSettings,
  status: ProviderCredentialStatusResponse
): AppSettings {
  const localCredential = status.credentials.find(
    (entry) =>
      entry.target === "local" && entry.kind === settings.provider.local.kind
  );
  const cloudCredential = status.credentials.find(
    (entry) =>
      entry.target === "cloud" && entry.kind === settings.provider.cloud.kind
  );

  return {
    ...settings,
    provider: {
      ...settings.provider,
      local: {
        ...settings.provider.local,
        hasStoredApiKey: localCredential?.hasStoredApiKey || false,
      },
      cloud: {
        ...settings.provider.cloud,
        hasStoredApiKey: cloudCredential?.hasStoredApiKey || false,
      },
    },
  };
}

export function SettingsPanel() {
  const { settings, featureFlags } = useShellContext();
  const [draft, setDraft] = useState<AppSettings>(() => cloneSettings(settings.get()));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedMessage, setSavedMessage] = useState("Settings Applied");
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [validationResult, setValidationResult] =
    useState<SettingsValidationResponse | null>(null);
  const [credentialStatusMessage, setCredentialStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(cloneSettings(settings.get()));
    return settings.subscribe((next) => {
      setDraft(cloneSettings(next));
    });
  }, [settings]);

  useEffect(() => {
    let cancelled = false;

    async function syncCredentialState() {
      const current = settings.get();
      if (!current.backend.baseUrl) {
        return;
      }

      try {
        const status = await settings.getProviderCredentialStatus({
          baseUrl: current.backend.baseUrl,
          token: current.backend.token,
        });
        if (cancelled) {
          return;
        }
        setCredentialStatusMessage(status.storage.message || null);
        setDraft((prev) => applyCredentialStatus(prev, status));
      } catch {
        if (!cancelled) {
          setCredentialStatusMessage(null);
        }
      }
    }

    void syncCredentialState();

    return () => {
      cancelled = true;
    };
  }, [
    settings,
    draft.backend.baseUrl,
    draft.backend.token,
    draft.provider.local.kind,
    draft.provider.cloud.kind,
  ]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(settings.get()),
    [draft, settings]
  );

  const handleToggle = (key: FeatureFlagKey) => {
    setDraft((prev) => ({
      ...prev,
      featureFlags: {
        ...prev.featureFlags,
        [key]: !(prev.featureFlags[key] ?? true),
      },
    }));
  };

  const handleModeChange = (mode: ModelMode) => {
    setDraft((prev) => ({
      ...prev,
      provider: {
        ...prev.provider,
        mode,
      },
      preferences: {
        ...prev.preferences,
        defaultCostMode: mode === "local_models" ? "local_only" : "cloud_quality",
      },
    }));
  };

  const handleValidate = async () => {
    setError(null);
    setValidation(null);

    try {
      const response = await settings.validateConnection({
        baseUrl: draft.backend.baseUrl,
        token: draft.backend.token,
        providerConfig: draft.provider,
      });

      setValidation(buildValidationSummary(response, draft));
      setValidationResult(response);

      setDraft((prev) => ({
        ...prev,
        backend: {
          ...prev.backend,
          validationWarnings: response.warnings,
          lastValidatedAt: new Date().toISOString(),
        },
      }));

      return response.valid;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSavedMessage("Settings Applied");
    setError(null);
    setValidation(null);
    setValidationResult(null);

    try {
      const nextDraft: AppSettings = {
        ...draft,
        preferences: {
          ...draft.preferences,
          defaultCostMode:
            draft.provider.mode === "local_models" ? "local_only" : "cloud_quality",
        },
      };

      const persistCredentialIfPresent = async (
        target: "local" | "cloud"
      ): Promise<ProviderCredentialStatusResponse | null> => {
        if (target === "local") {
          if (
            nextDraft.provider.local.kind !== "openai_compatible_local" ||
            !nextDraft.provider.local.apiKey.trim()
          ) {
            return null;
          }

          return settings.saveProviderCredential({
            baseUrl: nextDraft.backend.baseUrl,
            token: nextDraft.backend.token,
            target: "local",
            kind: nextDraft.provider.local.kind,
            apiKey: nextDraft.provider.local.apiKey.trim(),
          });
        }

        if (!nextDraft.provider.cloud.apiKey.trim()) {
          return null;
        }

        return settings.saveProviderCredential({
          baseUrl: nextDraft.backend.baseUrl,
          token: nextDraft.backend.token,
          target: "cloud",
          kind: nextDraft.provider.cloud.kind,
          apiKey: nextDraft.provider.cloud.apiKey.trim(),
        });
      };

      const [localCredentialStatus, cloudCredentialStatus] = await Promise.all([
        persistCredentialIfPresent("local"),
        persistCredentialIfPresent("cloud"),
      ]);

      nextDraft.provider.local.apiKey = "";
      nextDraft.provider.cloud.apiKey = "";

      let syncedCredentialStatus: ProviderCredentialStatusResponse | null = null;
      if (nextDraft.backend.baseUrl) {
        try {
          syncedCredentialStatus =
            cloudCredentialStatus ||
            localCredentialStatus ||
            (await settings.getProviderCredentialStatus({
              baseUrl: nextDraft.backend.baseUrl,
              token: nextDraft.backend.token,
            }));
        } catch (credentialError) {
          if (cloudCredentialStatus || localCredentialStatus) {
            throw credentialError;
          }
        }
      }

      if (syncedCredentialStatus) {
        setCredentialStatusMessage(syncedCredentialStatus.storage.message || null);
        nextDraft.provider = applyCredentialStatus(nextDraft, syncedCredentialStatus).provider;
      }

      try {
        const response = await settings.validateConnection({
          baseUrl: nextDraft.backend.baseUrl,
          token: nextDraft.backend.token,
          providerConfig: nextDraft.provider,
        });

        setValidationResult(response);

        if (response.valid) {
          setValidation(buildValidationSummary(response, nextDraft));
          nextDraft.backend = {
            ...nextDraft.backend,
            validationWarnings: response.warnings,
            lastValidatedAt: new Date().toISOString(),
          };
          setSavedMessage("Settings Applied");
        } else {
          setValidation(`Saved locally. ${response.warnings.join(" ")}`);
          setSavedMessage("Saved Locally");
        }
      } catch (err) {
        setValidation(
          `Saved locally. Connection validation failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        setSavedMessage("Saved Locally");
      }

      setDraft(nextDraft);
      await settings.save(nextDraft);
      for (const [flag, value] of Object.entries(nextDraft.featureFlags)) {
        featureFlags.setFlag(flag as FeatureFlagKey, value);
      }
      await featureFlags.save();

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveStoredCredential = async (target: "local" | "cloud") => {
    setSaving(true);
    setError(null);

    try {
      const current =
        target === "local"
          ? draft.provider.local.kind
          : draft.provider.cloud.kind;
      const status = await settings.deleteProviderCredential({
        baseUrl: draft.backend.baseUrl,
        token: draft.backend.token,
        target,
        kind: current,
      });

      const nextDraft = applyCredentialStatus(
        {
          ...draft,
          provider: {
            ...draft.provider,
            local: {
              ...draft.provider.local,
              apiKey: "",
            },
            cloud: {
              ...draft.provider.cloud,
              apiKey: "",
            },
          },
        },
        status
      );
      setCredentialStatusMessage(status.storage.message || null);
      setDraft(nextDraft);
      await settings.save(nextDraft);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8 pb-10 animate-in fade-in duration-500">
      <section>
        <div className="flex items-center space-x-2 mb-4">
          <i className="ph ph-plug-connected text-app-accent text-lg"></i>
          <h2 className="text-xs font-semibold text-app-textSecondary uppercase tracking-wider">
            Backend Connection
          </h2>
        </div>

        <div className="bg-app-panel border border-app-border rounded-xl p-5 space-y-4 shadow-sm">
          <div className="p-3 bg-app-accent/5 border border-app-accent/20 rounded-lg space-y-1">
            <div className="text-[11px] text-app-textSecondary leading-relaxed">
              ReplyMate is free. Provider keys are stored by your local ReplyMate API, not in the
              extension itself.
            </div>
            <div className="text-[11px] text-app-textSecondary leading-relaxed italic">
              Recommended local setup: <span className="text-white font-medium">qwen3:8b</span> for
              writing and <span className="text-white font-medium">minicpm-v</span> for OCR.
            </div>
            {credentialStatusMessage ? (
              <div className="text-[11px] text-app-textSecondary leading-relaxed">
                {credentialStatusMessage}
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <div>
              <label
                htmlFor="baseUrl"
                className="block text-[10px] font-bold text-app-textSecondary uppercase tracking-widest mb-1.5 ml-1"
              >
                ReplyMate API Base URL
              </label>
              <input
                id="baseUrl"
                type="url"
                placeholder="http://localhost:3000"
                value={draft.backend.baseUrl}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    backend: { ...prev.backend, baseUrl: e.target.value },
                  }))
                }
                className="w-full bg-app-bg border border-app-border rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-app-accent/50 focus:shadow-glow-inner transition-all placeholder:text-app-textSecondary/50"
              />
            </div>

            <div>
              <label
                htmlFor="token"
                className="block text-[10px] font-bold text-app-textSecondary uppercase tracking-widest mb-1.5 ml-1"
              >
                API Access Token (Optional)
              </label>
              <input
                id="token"
                type="password"
                placeholder="Only if your local API requires one"
                value={draft.backend.token}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    backend: { ...prev.backend, token: e.target.value },
                  }))
                }
                className="w-full bg-app-bg border border-app-border rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-app-accent/50 focus:shadow-glow-inner transition-all placeholder:text-app-textSecondary/50"
              />
            </div>

            <div>
              <label
                htmlFor="providerMode"
                className="block text-[10px] font-bold text-app-textSecondary uppercase tracking-widest mb-1.5 ml-1"
              >
                Mode
              </label>
              <select
                id="providerMode"
                value={draft.provider.mode}
                onChange={(e) => handleModeChange(e.target.value as ModelMode)}
                className="w-full bg-app-bg border border-app-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-app-accent/50 transition-all appearance-none cursor-pointer"
              >
                <option value="local_models">Local Models</option>
                <option value="byok_api">Use Your Own API</option>
              </select>
            </div>
          </div>

          {draft.provider.mode === "local_models" ? (
            <div className="pt-2 border-t border-app-border space-y-3">
              <div className="text-[10px] font-bold text-app-textSecondary uppercase tracking-widest ml-1">
                Local Runtime
              </div>

              <select
                value={draft.provider.local.kind}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    provider: {
                      ...prev.provider,
                      local: {
                        ...prev.provider.local,
                        kind: e.target.value as LocalProviderKind,
                      },
                    },
                  }))
                }
                className="w-full bg-app-bg border border-app-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-app-accent/50 transition-all appearance-none cursor-pointer"
              >
                <option value="ollama">Ollama</option>
                <option value="openai_compatible_local">Local OpenAI-compatible</option>
              </select>

              <input
                type="url"
                placeholder={
                  draft.provider.local.kind === "ollama"
                    ? "http://127.0.0.1:11434"
                    : "http://127.0.0.1:1234/v1"
                }
                value={draft.provider.local.baseUrl}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    provider: {
                      ...prev.provider,
                      local: {
                        ...prev.provider.local,
                        baseUrl: e.target.value,
                      },
                    },
                  }))
                }
                className="w-full bg-app-bg border border-app-border rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-app-accent/50 transition-all placeholder:text-app-textSecondary/50"
              />

              <input
                type="text"
                placeholder="Model name, e.g. qwen3:8b"
                value={draft.provider.local.modelName}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    provider: {
                      ...prev.provider,
                      local: {
                        ...prev.provider.local,
                        modelName: e.target.value,
                      },
                    },
                  }))
                }
                className="w-full bg-app-bg border border-app-border rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-app-accent/50 transition-all placeholder:text-app-textSecondary/50"
              />

              {draft.provider.local.kind === "openai_compatible_local" ? (
                <div className="space-y-2">
                  <input
                    type="password"
                    placeholder={
                      draft.provider.local.hasStoredApiKey
                        ? "Stored securely in your local API"
                        : "Optional local API key"
                    }
                    value={draft.provider.local.apiKey}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        provider: {
                          ...prev.provider,
                          local: {
                            ...prev.provider.local,
                            apiKey: e.target.value,
                          },
                        },
                      }))
                    }
                    className="w-full bg-app-bg border border-app-border rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-app-accent/50 transition-all placeholder:text-app-textSecondary/50"
                  />
                  {draft.provider.local.hasStoredApiKey ? (
                    <div className="flex items-center justify-between text-[11px] text-app-textSecondary">
                      <span>Local API key is stored securely by the local ReplyMate API.</span>
                      <button
                        className="text-app-warning hover:text-white transition-colors"
                        onClick={() => void handleRemoveStoredCredential("local")}
                      >
                        Remove stored key
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="pt-2 border-t border-app-border space-y-3">
              <div className="text-[10px] font-bold text-app-textSecondary uppercase tracking-widest ml-1">
                Your Provider
              </div>

              <select
                value={draft.provider.cloud.kind}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    provider: {
                      ...prev.provider,
                      cloud: {
                        ...prev.provider.cloud,
                        kind: e.target.value as CloudProviderKind,
                      },
                    },
                  }))
                }
                className="w-full bg-app-bg border border-app-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-app-accent/50 transition-all appearance-none cursor-pointer"
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Gemini</option>
                <option value="openrouter">OpenRouter</option>
                <option value="openai_compatible_custom">Custom OpenAI-compatible</option>
              </select>

              <input
                type="text"
                placeholder="Model name"
                value={draft.provider.cloud.modelName}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    provider: {
                      ...prev.provider,
                      cloud: {
                        ...prev.provider.cloud,
                        modelName: e.target.value,
                      },
                    },
                  }))
                }
                className="w-full bg-app-bg border border-app-border rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-app-accent/50 transition-all placeholder:text-app-textSecondary/50"
              />

              <div className="space-y-2">
                <input
                  type="password"
                  placeholder={
                    draft.provider.cloud.hasStoredApiKey
                      ? "Stored securely in your local API"
                      : "Provider API key"
                  }
                  value={draft.provider.cloud.apiKey}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      provider: {
                        ...prev.provider,
                        cloud: {
                          ...prev.provider.cloud,
                          apiKey: e.target.value,
                        },
                      },
                    }))
                  }
                  className="w-full bg-app-bg border border-app-border rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-app-accent/50 transition-all placeholder:text-app-textSecondary/50"
                />
                {draft.provider.cloud.hasStoredApiKey ? (
                  <div className="flex items-center justify-between text-[11px] text-app-textSecondary">
                    <span>Provider key is stored securely by the local ReplyMate API.</span>
                    <button
                      className="text-app-warning hover:text-white transition-colors"
                      onClick={() => void handleRemoveStoredCredential("cloud")}
                    >
                      Remove stored key
                    </button>
                  </div>
                ) : null}
              </div>

              <input
                type="url"
                placeholder={cloudProviderPlaceholder(draft.provider.cloud.kind)}
                value={draft.provider.cloud.baseUrl}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    provider: {
                      ...prev.provider,
                      cloud: {
                        ...prev.provider.cloud,
                        baseUrl: e.target.value,
                      },
                    },
                  }))
                }
                className="w-full bg-app-bg border border-app-border rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-app-accent/50 transition-all placeholder:text-app-textSecondary/50"
              />
            </div>
          )}

          <button
            className="w-full py-2.5 bg-app-bg border border-app-border rounded-lg text-xs font-bold text-app-textSecondary hover:text-white hover:bg-app-panel transition-all flex items-center justify-center space-x-2 shadow-sm"
            onClick={() => void handleValidate()}
          >
            <i className="ph ph-seal-check"></i>
            <span>Validate Connection</span>
          </button>

          {validation && (
            <div className="p-3 bg-app-bg/50 border border-app-border rounded-lg text-[11px] text-app-textSecondary leading-normal">
              {validation}
            </div>
          )}

          {validationResult && (
            <div className="grid grid-cols-1 gap-3 mt-4 animate-in slide-in-from-top-2 duration-300">
              <div className="p-3 bg-app-bg/30 border border-app-border rounded-lg flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <i className="ph ph-switch text-app-textSecondary"></i>
                  <span className="text-xs text-white">Mode</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase bg-app-accent/10 text-app-accent">
                  {providerModeLabel(draft.provider.mode)}
                </span>
              </div>

              <div className="p-3 bg-app-bg/30 border border-app-border rounded-lg flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <i className="ph ph-cpu text-app-textSecondary"></i>
                  <span className="text-xs text-white">Provider</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase bg-app-accent/10 text-app-accent">
                  {draft.provider.mode === "local_models"
                    ? localProviderLabel(draft.provider.local.kind)
                    : cloudProviderLabel(draft.provider.cloud.kind)}
                </span>
              </div>

              <div className="p-3 bg-app-bg/30 border border-app-border rounded-lg flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <i className="ph ph-sparkle text-app-textSecondary"></i>
                  <span className="text-xs text-white">Drafting</span>
                </div>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                    validationResult.draftingProvider.ready
                      ? "bg-app-success/10 text-app-success"
                      : "bg-app-warning/10 text-app-warning"
                  }`}
                >
                  {validationResult.draftingProvider.ready ? "Ready" : "Pending"}
                </span>
              </div>

              <div className="p-3 bg-app-bg/30 border border-app-border rounded-lg flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <i className="ph ph-magnifying-glass text-app-textSecondary"></i>
                  <span className="text-xs text-white">Parser</span>
                </div>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                    validationResult.parserProvider.ready
                      ? "bg-app-success/10 text-app-success"
                      : "bg-app-warning/10 text-app-warning"
                  }`}
                >
                  {validationResult.parserProvider.ready ? "Ready" : "Fallback"}
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="flex items-center space-x-2 mb-4">
          <i className="ph ph-sliders text-app-accent text-lg"></i>
          <h2 className="text-xs font-semibold text-app-textSecondary uppercase tracking-wider">
            Generation Defaults
          </h2>
        </div>

        <div className="bg-app-panel border border-app-border rounded-xl p-5 space-y-6">
          <div className="space-y-2">
            <label
              htmlFor="defaultTone"
              className="block text-[10px] font-bold text-app-textSecondary uppercase tracking-widest ml-1"
            >
              Tone
            </label>
            <select
              id="defaultTone"
              value={draft.preferences.defaultTonePreset}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  preferences: {
                    ...prev.preferences,
                    defaultTonePreset: e.target.value as TonePreset,
                  },
                }))
              }
              className="w-full bg-app-bg border border-app-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-app-accent/50 transition-all appearance-none cursor-pointer"
            >
              <option value="professional">Professional</option>
              <option value="friendly">Friendly</option>
              <option value="concise">Concise</option>
              <option value="empathetic">Empathetic</option>
              <option value="confident">Confident</option>
            </select>
          </div>

          <div className="space-y-4 pt-2">
            {[
              {
                icon: "ph-broadcast",
                label: "Telemetry",
                desc: "Diagnostic signals",
                checked: draft.preferences.telemetryEnabled,
                onChange: (value: boolean) =>
                  setDraft((prev) => ({
                    ...prev,
                    preferences: { ...prev.preferences, telemetryEnabled: value },
                  })),
              },
              {
                icon: "ph-bug",
                label: "Debug Mode",
                desc: "Detailed logs",
                checked: draft.preferences.debugMode,
                onChange: (value: boolean) =>
                  setDraft((prev) => ({
                    ...prev,
                    preferences: { ...prev.preferences, debugMode: value },
                  })),
              },
              {
                icon: "ph-microphone-stage",
                label: "Cloud Voice Fallback",
                desc: "Only used in BYOK mode when browser-local speech is unavailable",
                checked: draft.preferences.allowHybridVoiceFallback,
                onChange: (value: boolean) =>
                  setDraft((prev) => ({
                    ...prev,
                    preferences: { ...prev.preferences, allowHybridVoiceFallback: value },
                  })),
              },
            ].map((toggle) => (
              <div key={toggle.label} className="flex items-center justify-between group">
                <div className="flex items-center space-x-3">
                  <i
                    className={`ph ${toggle.icon} text-app-textSecondary group-hover:text-app-accent transition-colors`}
                  ></i>
                  <div>
                    <div className="text-xs font-semibold text-white">{toggle.label}</div>
                    <div className="text-[10px] text-app-textSecondary">{toggle.desc}</div>
                  </div>
                </div>
                <button
                  onClick={() => toggle.onChange(!toggle.checked)}
                  className={`w-8 h-4 rounded-full relative transition-colors ${
                    toggle.checked ? "bg-app-accent" : "bg-app-border"
                  }`}
                >
                  <div
                    className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
                      toggle.checked ? "left-[17px]" : "left-0.5"
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center space-x-2 mb-4">
          <i className="ph ph-toggle-left text-app-accent text-lg"></i>
          <h2 className="text-xs font-semibold text-app-textSecondary uppercase tracking-wider">
            Modules & Features
          </h2>
        </div>
        <div className="bg-app-panel border border-app-border rounded-xl p-5 space-y-4">
          {FLAG_META.map(({ key, label, desc, alwaysOn }) => (
            <div
              key={key}
              className="flex items-center justify-between opacity-90 hover:opacity-100 transition-opacity"
            >
              <div className="max-w-[70%]">
                <div className="text-xs font-semibold text-white">{label}</div>
                <div className="text-[10px] text-app-textSecondary line-clamp-1">{desc}</div>
              </div>
              <button
                disabled={alwaysOn}
                onClick={() => handleToggle(key)}
                className={`w-8 h-4 rounded-full relative transition-colors ${
                  draft.featureFlags[key] !== false
                    ? "bg-app-success/50"
                    : "bg-app-border"
                } ${alwaysOn ? "opacity-30 cursor-not-allowed" : ""}`}
              >
                <div
                  className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
                    draft.featureFlags[key] !== false ? "left-[17px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      </section>

      <div className="sticky bottom-4 left-0 right-0 pt-6">
        <button
          className={`w-full py-3 rounded-xl font-bold text-sm shadow-glow transition-all flex items-center justify-center space-x-2 ${
            dirty
              ? "bg-app-accent text-white hover:opacity-90"
              : "bg-app-panel text-app-textSecondary border border-app-border cursor-not-allowed"
          }`}
          disabled={saving || !dirty}
          onClick={() => void handleSave()}
        >
          {saving ? (
            <i className="ph ph-spinner animate-spin"></i>
          ) : (
            <i className="ph ph-floppy-disk"></i>
          )}
          <span>{saving ? "Saving Changes..." : "Apply Settings"}</span>
        </button>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-[11px] flex items-start space-x-2 animate-in fade-in">
          <i className="ph ph-warning-circle text-base mt-0.5"></i>
          <span>{error}</span>
        </div>
      )}

      {saved && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 bg-app-success text-white rounded-full text-xs font-bold shadow-lg flex items-center space-x-2 animate-in slide-in-from-bottom-4 fade-in">
          <i className="ph ph-check-circle"></i>
          <span>{savedMessage}</span>
        </div>
      )}
    </div>
  );
}
