import { useEffect, useMemo, useState } from "react";
import {
  FEATURE_FLAGS,
  type AppSettings,
  type CostMode,
  type DraftingProviderStatus,
  type FeatureFlagKey,
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

function formatRuntimeType(status: DraftingProviderStatus): string {
  switch (status.runtimeType) {
    case "generic_local_chat_api":
      return "Generic local chat API";
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
      return "Generic local chat API";
    case "ollama":
    default:
      return "Ollama";
  }
}

function buildValidationSummary(response: SettingsValidationResponse): string {
  const runtimeLabel = formatRuntimeType(response.draftingProvider);
  const parserLabel = formatParserRuntimeType(response.parserProvider);
  if (!response.valid) {
    return response.warnings.join(" ");
  }

  if (response.draftingProvider.ready) {
    const modelSuffix = response.draftingProvider.modelName
      ? `, model ${response.draftingProvider.modelName}`
      : "";
    const parserState = response.parserProvider.ready && response.parserProvider.imageOcrAvailable
      ? `${parserLabel} image OCR ready`
      : response.parserProvider.fallbackMode === "metadata_local"
        ? `${parserLabel} is using metadata fallback`
        : `${parserLabel} is not ready`;
    return `Connected to ${response.serverVersion} (${response.authMode} auth). ${runtimeLabel} ready${modelSuffix}. ${parserState}.`;
  }

  return response.warnings.join(" ");
}

export function SettingsPanel() {
  const { settings, featureFlags } = useShellContext();
  const [draft, setDraft] = useState<AppSettings>(() => cloneSettings(settings.get()));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [validationResult, setValidationResult] =
    useState<SettingsValidationResponse | null>(null);

  useEffect(() => {
    setDraft(cloneSettings(settings.get()));
    return settings.subscribe((next) => {
      setDraft(cloneSettings(next));
    });
  }, [settings]);

  const dirty = useMemo(() => {
    return JSON.stringify(draft) !== JSON.stringify(settings.get());
  }, [draft, settings]);

  const handleToggle = (key: FeatureFlagKey) => {
    setDraft((prev) => ({
      ...prev,
      featureFlags: {
        ...prev.featureFlags,
        [key]: !(prev.featureFlags[key] ?? true),
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
      });

      setValidation(buildValidationSummary(response));
      setValidationResult(response);

      setDraft((prev) => ({
        ...prev,
        backend: {
          ...prev.backend,
          authMode: response.authMode,
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
    setError(null);
    setValidation(null);
    setValidationResult(null);

    try {
      const response = await settings.validateConnection({
        baseUrl: draft.backend.baseUrl,
        token: draft.backend.token,
      });

      setValidation(buildValidationSummary(response));
      setValidationResult(response);

      if (!response.valid) {
        setSaving(false);
        return;
      }

      const nextDraft: AppSettings = {
        ...draft,
        backend: {
          ...draft.backend,
          authMode: response.authMode,
          validationWarnings: response.warnings,
          lastValidatedAt: new Date().toISOString(),
        },
      };

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

  return (
    <div className="space-y-8 pb-10 animate-in fade-in duration-500">
      {/* Backend Connection */}
      <section>
        <div className="flex items-center space-x-2 mb-4">
          <i className="ph ph-plug-connected text-app-accent text-lg"></i>
          <h2 className="text-xs font-semibold text-app-textSecondary uppercase tracking-wider">Backend Connection</h2>
        </div>
        
        <div className="bg-app-panel border border-app-border rounded-xl p-5 space-y-4 shadow-sm">
          <div className="p-3 bg-app-accent/5 border border-app-accent/20 rounded-lg">
            <div className="text-[11px] text-app-textSecondary leading-relaxed italic">
              Recommended: <span className="text-white font-medium">qwen3:8b</span> for writing & <span className="text-white font-medium">minicpm-v</span> for OCR.
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label htmlFor="baseUrl" className="block text-[10px] font-bold text-app-textSecondary uppercase tracking-widest mb-1.5 ml-1">API Base URL</label>
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
              <label htmlFor="token" className="block text-[10px] font-bold text-app-textSecondary uppercase tracking-widest mb-1.5 ml-1">Bearer Token</label>
              <input
                id="token"
                type="password"
                placeholder="••••••••••••••••"
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
          </div>

          <button 
            className="w-full py-2.5 bg-app-bg border border-app-border rounded-lg text-xs font-bold text-app-textSecondary hover:text-white hover:bg-app-panel transition-all flex items-center justify-center space-x-2 shadow-sm"
            onClick={handleValidate}
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
              {/* Runtime Summary Cards */}
              <div className="p-3 bg-app-bg/30 border border-app-border rounded-lg flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <i className="ph ph-cpu text-app-textSecondary"></i>
                  <span className="text-xs text-white">Drafting</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${validationResult.draftingProvider.ready ? 'bg-app-success/10 text-app-success' : 'bg-app-warning/10 text-app-warning'}`}>
                  {validationResult.draftingProvider.ready ? 'Ready' : 'Pending'}
                </span>
              </div>
              <div className="p-3 bg-app-bg/30 border border-app-border rounded-lg flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <i className="ph ph-magnifying-glass text-app-textSecondary"></i>
                  <span className="text-xs text-white">Parser</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${validationResult.parserProvider.ready ? 'bg-app-success/10 text-app-success' : 'bg-app-warning/10 text-app-warning'}`}>
                  {validationResult.parserProvider.ready ? 'Ready' : 'Pending'}
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Defaults Section */}
      <section>
        <div className="flex items-center space-x-2 mb-4">
          <i className="ph ph-sliders text-app-accent text-lg"></i>
          <h2 className="text-xs font-semibold text-app-textSecondary uppercase tracking-wider">Generation Defaults</h2>
        </div>

        <div className="bg-app-panel border border-app-border rounded-xl p-5 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="defaultTone" className="block text-[10px] font-bold text-app-textSecondary uppercase tracking-widest ml-1">Tone</label>
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
                <option value="professional">🛡️ Professional</option>
                <option value="friendly">👋 Friendly</option>
                <option value="concise">⚡ Concise</option>
                <option value="empathetic">💖 Empathetic</option>
                <option value="confident">💪 Confident</option>
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="defaultCostMode" className="block text-[10px] font-bold text-app-textSecondary uppercase tracking-widest ml-1">Cost Mode</label>
              <select
                id="defaultCostMode"
                value={draft.preferences.defaultCostMode}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    preferences: {
                      ...prev.preferences,
                      defaultCostMode: e.target.value as CostMode,
                    },
                  }))
                }
                className="w-full bg-app-bg border border-app-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-app-accent/50 transition-all appearance-none cursor-pointer"
              >
                <option value="local_only">🏠 Local (Free)</option>
                <option value="hybrid_low_cost">⚖️ Hybrid</option>
                <option value="cloud_quality">☁️ Cloud (Quality)</option>
              </select>
            </div>
          </div>

          <div className="space-y-4 pt-2">
             {/* Toggles */}
             {[
               { icon: "ph-broadcast", label: "Telemetry", desc: "Diagnostic signals", checked: draft.preferences.telemetryEnabled, onChange: (val: boolean) => setDraft(prev => ({ ...prev, preferences: { ...prev.preferences, telemetryEnabled: val } })) },
               { icon: "ph-bug", label: "Debug Mode", desc: "Detailed logs", checked: draft.preferences.debugMode, onChange: (val: boolean) => setDraft(prev => ({ ...prev, preferences: { ...prev.preferences, debugMode: val } })) },
               { icon: "ph-microphone-stage", label: "Hybrid Voice", desc: "Remote fallback", checked: draft.preferences.allowHybridVoiceFallback, onChange: (val: boolean) => setDraft(prev => ({ ...prev, preferences: { ...prev.preferences, allowHybridVoiceFallback: val } })) }
             ].map((toggle) => (
                <div key={toggle.label} className="flex items-center justify-between group">
                  <div className="flex items-center space-x-3">
                    <i className={`ph ${toggle.icon} text-app-textSecondary group-hover:text-app-accent transition-colors`}></i>
                    <div>
                      <div className="text-xs font-semibold text-white">{toggle.label}</div>
                      <div className="text-[10px] text-app-textSecondary">{toggle.desc}</div>
                    </div>
                  </div>
                  <button 
                    onClick={() => toggle.onChange(!toggle.checked)}
                    className={`w-8 h-4 rounded-full relative transition-colors ${toggle.checked ? 'bg-app-accent' : 'bg-app-border'}`}
                  >
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${toggle.checked ? 'left-[17px]' : 'left-0.5'}`} />
                  </button>
                </div>
             ))}
          </div>
        </div>
      </section>

      {/* Feature Toggles Section */}
      <section>
        <div className="flex items-center space-x-2 mb-4">
          <i className="ph ph-toggle-left text-app-accent text-lg"></i>
          <h2 className="text-xs font-semibold text-app-textSecondary uppercase tracking-wider">Modules & Features</h2>
        </div>
        <div className="bg-app-panel border border-app-border rounded-xl p-5 space-y-4">
           {FLAG_META.map(({ key, label, desc, alwaysOn }) => (
             <div key={key} className="flex items-center justify-between opacity-90 hover:opacity-100 transition-opacity">
               <div className="max-w-[70%]">
                 <div className="text-xs font-semibold text-white">{label}</div>
                 <div className="text-[10px] text-app-textSecondary line-clamp-1">{desc}</div>
               </div>
               <button 
                disabled={alwaysOn}
                onClick={() => handleToggle(key)}
                className={`w-8 h-4 rounded-full relative transition-colors ${draft.featureFlags[key] !== false ? 'bg-app-success/50' : 'bg-app-border'} ${alwaysOn ? 'opacity-30 cursor-not-allowed' : ''}`}
              >
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${draft.featureFlags[key] !== false ? 'left-[17px]' : 'left-0.5'}`} />
              </button>
             </div>
           ))}
        </div>
      </section>

      {/* Action Bar */}
      <div className="sticky bottom-4 left-0 right-0 pt-6">
        <button 
          className={`w-full py-3 rounded-xl font-bold text-sm shadow-glow transition-all flex items-center justify-center space-x-2 ${
            dirty ? 'bg-app-accent text-white hover:opacity-90' : 'bg-app-panel text-app-textSecondary border border-app-border cursor-not-allowed'
          }`}
          disabled={saving || !dirty}
          onClick={handleSave}
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

      {/* Success Toast */}
      {saved && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 bg-app-success text-white rounded-full text-xs font-bold shadow-lg flex items-center space-x-2 animate-in slide-in-from-bottom-4 fade-in">
          <i className="ph ph-check-circle"></i>
          <span>Settings Applied</span>
        </div>
      )}
    </div>
  );
}
