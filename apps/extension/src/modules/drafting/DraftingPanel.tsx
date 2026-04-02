// =============================================================================
// Drafting Panel UI — React Component
// =============================================================================

import { useEffect, useRef, useState } from "react";
import type {
  ActionMode,
  AppSettings,
  ComposerSession,
  ComposerSnapshot,
  ContextScope,
  CostMode,
  EvidenceSummary,
  GenerateDraftResponse,
  TonePreset,
} from "@replymate/contracts";
import { useActiveTabId } from "../../core/ui/ActiveTabContext.js";
import { useActiveSession } from "../../core/ui/ActiveSessionContext.js";
import { useShellContext } from "../../core/ui/ShellContext.js";
import type {
  PendingEvidenceState,
  WorkspaceState,
} from "../../core/workspace/WorkspaceStateStore.js";
import {
  RuntimeMessageError,
  sendRuntimeMessage,
} from "../../shared/runtime.js";
import { ContextDiagnosticsDrawer } from "./ContextDiagnosticsDrawer.js";
import { DraftingDebugPanel } from "./DraftingDebugPanel.js";

const MAX_EVIDENCE_SUMMARY_CHARS_PER_FILE = 1200;
const MAX_COMBINED_EVIDENCE_SUMMARY_CHARS = 3000;
const PENDING_INSERT_STORAGE_KEY = "replymate.pendingInsert";

type PendingInsertState = {
  text: string;
  tabId: number;
  requestedAt: number;
  bridgeRecoveryRequested: boolean;
};

type SessionRuntimeResponse = {
  session?: ComposerSession | null;
};

type EvidenceRuntimeResponse = {
  evidence?: EvidenceSummary[];
  pendingEvidence?: PendingEvidenceState[];
};

type WorkspaceStateRuntimeResponse = {
  state?: WorkspaceState | null;
};

type InsertRuntimeResponse = {
  success?: boolean;
  errorCode?: string;
  message?: string;
};

type EnsureTabBridgeResponse = {
  ok?: boolean;
  recovered?: boolean;
  message?: string;
  session?: ComposerSession | null;
};

type InlineNotice = {
  tone: "warning" | "error" | "success";
  message: string;
};

type SessionUpdatedMessage = {
  type?: string;
  payload?: {
    tabId?: number;
    workspaceKey?: string;
    evidence?: EvidenceSummary[];
    pendingEvidence?: PendingEvidenceState[];
  };
};

type PendingEvidenceDecision = "wait" | "continue" | "cancel";

const NO_COMPOSER_MESSAGE =
  "ReplyMate could not find an active text box on this page. Focus the composer and try again.";

function readPendingInsert(): PendingInsertState | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_INSERT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingInsertState;
    if (
      typeof parsed?.text !== "string" ||
      typeof parsed?.tabId !== "number" ||
      typeof parsed?.requestedAt !== "number" ||
      typeof parsed?.bridgeRecoveryRequested !== "boolean"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writePendingInsert(state: PendingInsertState): void {
  window.sessionStorage.setItem(PENDING_INSERT_STORAGE_KEY, JSON.stringify(state));
}

function clearPendingInsert(): void {
  window.sessionStorage.removeItem(PENDING_INSERT_STORAGE_KEY);
}

function formatInsertFailureMessage(
  errorCode?: string,
  message?: string
): string {
  switch (errorCode) {
    case "STALE_SESSION":
      return message || "The target text box changed. Please copy and paste instead.";
    case "NO_COMPOSER":
      return message || "Focus the correct text box and try again.";
    case "INSERT_TAB_BRIDGE_MISSING":
      return message || "ReplyMate could not reconnect to this page. Refresh Slack and try again.";
    case "INSERT_RUNTIME_RELOADED":
      return (
        message ||
        "ReplyMate was reloaded. Reopen the side panel and refresh Slack, then try again."
      );
    default:
      return message || "ReplyMate could not insert the draft into this text box.";
  }
}

function formatInsertRuntimeError(error: unknown): string {
  if (error instanceof RuntimeMessageError) {
    if (error.code === "missing_receiver") {
      return "ReplyMate could not reconnect to this page. Refresh Slack and try again.";
    }
    if (error.code === "context_invalidated") {
      return "ReplyMate was reloaded. Reopen the side panel and try again.";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function capEvidenceSummaries(input: EvidenceSummary[]): EvidenceSummary[] {
  let total = 0;
  const output: EvidenceSummary[] = [];

  for (const item of input) {
    if (total >= MAX_COMBINED_EVIDENCE_SUMMARY_CHARS) break;

    const cappedPerFile = item.summaryText.slice(0, MAX_EVIDENCE_SUMMARY_CHARS_PER_FILE);
    const remaining = MAX_COMBINED_EVIDENCE_SUMMARY_CHARS - total;
    const cappedCombined = cappedPerFile.slice(0, remaining);

    if (!cappedCombined) continue;

    const truncated =
      item.truncated ||
      cappedPerFile.length < item.summaryText.length ||
      cappedCombined.length < cappedPerFile.length;

    output.push({
      ...item,
      summaryText: cappedCombined,
      summaryCharCount: cappedCombined.length,
      truncated,
      warnings: truncated
        ? [...item.warnings, "Evidence summary truncated to fit limits."]
        : item.warnings,
    });

    total += cappedCombined.length;
  }

  return output;
}

function formatContextScope(scope: ContextScope): string {
  switch (scope) {
    case "thread":
      return "Thread";
    case "channel":
      return "Channel";
    case "page":
      return "Page";
    case "mixed":
      return "Mixed";
    case "none":
    default:
      return "None";
  }
}

function formatProviderPath(
  providerPath: GenerateDraftResponse["inputSummary"]["providerPath"]
): string {
  switch (providerPath) {
    case "cloud":
      return "Cloud";
    case "local_model":
    default:
      return "Local model";
  }
}


function isContextReplyVariant(variant: GenerateDraftResponse["drafts"][number]): boolean {
  return variant.variantKind === "context_reply";
}

function isCleanedDraftVariant(variant: GenerateDraftResponse["drafts"][number]): boolean {
  return variant.variantKind === "cleaned_draft";
}

function isEmphasizedVariant(variant: GenerateDraftResponse["drafts"][number]): boolean {
  if (variant.variantKind === "context_reply") return true;
  if (variant.variantKind === "cleaned_draft") return false;
  if (variant.variantKind === "default_alternate") return false;
  return variant.role === "primary";
}


function dedupeVisibleContext(
  items: ComposerSnapshot["visibleContext"]
): ComposerSnapshot["visibleContext"] {
  const deduped: ComposerSnapshot["visibleContext"] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const key = [
      (item.author || "").replace(/\s+/g, " ").trim(),
      item.text.replace(/\s+/g, " ").trim(),
      item.source,
    ].join("::");
    if (!item.text || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function getLocationLabel(snapshot: ComposerSnapshot): string {
  if (snapshot.composerMode === "thread") {
    return `Thread: ${snapshot.metadata.threadTitle || snapshot.metadata.channelName || "Unknown"}`;
  }
  if (snapshot.composerMode === "channel") {
    return `Channel: ${snapshot.metadata.channelName || snapshot.metadata.title || "Unknown"}`;
  }
  if (snapshot.composerMode === "email") {
    return `Email: ${snapshot.metadata.threadTitle || snapshot.metadata.title || "Unknown"}`;
  }
  return snapshot.metadata.title || snapshot.metadata.channelName || "Unknown";
}

function workspaceStateToFormState(
  state: WorkspaceState | null,
  toneDefault: TonePreset,
  costDefault: CostMode
) {
  return {
    instruction: state?.instruction ?? "",
    actionMode: state?.actionMode ?? "improve_current_draft",
    tonePreset: state?.tonePreset ?? toneDefault,
    costMode: costDefault === "local_only" ? "local_only" : state?.costMode ?? costDefault,
    usedVoiceInput: state?.usedVoiceInput ?? false,
    response: state?.response ?? null,
    error: state?.error ?? null,
  } as const;
}

function resolveEffectiveCostMode(settingsSnapshot: AppSettings): CostMode {
  return settingsSnapshot.provider.mode === "local_models" ? "local_only" : "cloud_quality";
}

export function DraftingPanel() {
  const activeTabId = useActiveTabId();
  const { session, ensureFreshSession } = useActiveSession();
  const { settings } = useShellContext();
  const toneDefaultRef = useRef(settings.get().preferences.defaultTonePreset);
  const costDefaultRef = useRef(settings.get().preferences.defaultCostMode);
  const sessionRef = useRef(session);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<GenerateDraftResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [insertNotice, setInsertNotice] = useState<InlineNotice | null>(null);
  const [evidence, setEvidence] = useState<EvidenceSummary[]>([]);
  const [pendingEvidence, setPendingEvidence] = useState<PendingEvidenceState[]>([]);
  const [usedVoiceInput, setUsedVoiceInput] = useState(false);
  const [debugMode, setDebugMode] = useState(
    settings.get().preferences.debugMode
  );

  const [instruction, setInstruction] = useState("");
  const [actionMode, setActionMode] = useState<ActionMode>("improve_current_draft");
  const [tonePreset, setTonePreset] = useState<TonePreset>(
    settings.get().preferences.defaultTonePreset
  );
  const [costMode, setCostMode] = useState<CostMode>(
    settings.get().preferences.defaultCostMode
  );
  const [pendingEvidencePromptOpen, setPendingEvidencePromptOpen] = useState(false);
  const [contextDrawerOpen, setContextDrawerOpen] = useState(false);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    setContextDrawerOpen(false);
  }, [session?.sessionId, session?.snapshot?.sessionVersion]);

  async function executeInsert(
    currentSession: ComposerSession,
    text: string
  ): Promise<InsertRuntimeResponse> {
    return sendRuntimeMessage<InsertRuntimeResponse>({
      type: "EXECUTE_INSERT",
      payload: {
        tabId: activeTabId,
        sessionId: currentSession.sessionId,
        sessionVersion: currentSession.snapshot?.sessionVersion,
        viewFingerprint: currentSession.snapshot?.viewFingerprint,
        composerFingerprint: currentSession.snapshot?.composerFingerprint,
        text,
      },
    });
  }

  useEffect(() => {
    const unsubscribeSettings = settings.subscribe((next) => {
      const previousToneDefault = toneDefaultRef.current;
      const previousCostDefault = costDefaultRef.current;
      toneDefaultRef.current = next.preferences.defaultTonePreset;
      costDefaultRef.current = next.preferences.defaultCostMode;

      setDebugMode(next.preferences.debugMode);
      setTonePreset((prev) =>
        prev === previousToneDefault ? next.preferences.defaultTonePreset : prev
      );
      setCostMode((prev) =>
        prev === previousCostDefault ? next.preferences.defaultCostMode : prev
      );
    });

    return () => {
      unsubscribeSettings();
    };
  }, [settings]);

  useEffect(() => {
    let mounted = true;
    let refreshToken = 0;

    async function hydrateWorkspaceState(
      workspaceKey: string,
      tabId: number,
      token: number
    ) {
      const [workspaceResponse, evidenceResponse] = await Promise.all([
        sendRuntimeMessage<WorkspaceStateRuntimeResponse>({
          type: "GET_WORKSPACE_STATE",
          payload: { workspaceKey, tabId },
        }),
        sendRuntimeMessage<EvidenceRuntimeResponse>({
          type: "GET_EVIDENCE",
          payload: { workspaceKey, tabId },
        }),
      ]);

      if (!mounted || token !== refreshToken) return;

      const workspaceState = workspaceResponse?.state ?? null;
      const nextFormState = workspaceStateToFormState(
        workspaceState,
        toneDefaultRef.current,
        costDefaultRef.current
      );

      setInstruction(nextFormState.instruction);
      setActionMode(nextFormState.actionMode);
      setTonePreset(nextFormState.tonePreset);
      setCostMode(nextFormState.costMode);
      setUsedVoiceInput(nextFormState.usedVoiceInput);
      setResponse(nextFormState.response);
      setError(nextFormState.error);
      setEvidence(
        Array.isArray(evidenceResponse?.evidence)
          ? evidenceResponse.evidence
          : workspaceState?.evidence ?? []
      );
      setPendingEvidence(
        Array.isArray(evidenceResponse?.pendingEvidence)
          ? evidenceResponse.pendingEvidence
          : workspaceState?.pendingEvidence ?? []
      );
    }

    const token = ++refreshToken;
    const workspaceKey = session?.snapshot?.workspaceKey;

    if (activeTabId === null || !workspaceKey) {
      setEvidence([]);
      setPendingEvidence([]);
      setInstruction("");
      setActionMode("improve_current_draft");
      setTonePreset(toneDefaultRef.current);
      setCostMode(costDefaultRef.current);
      setUsedVoiceInput(false);
      setResponse(null);
      setError(null);
      return () => {
        mounted = false;
      };
    }

    void hydrateWorkspaceState(workspaceKey, activeTabId, token).catch((runtimeError) => {
      if (!mounted || token !== refreshToken) return;
      setError(
        runtimeError instanceof Error
          ? runtimeError.message
          : "Failed to load drafting state."
      );
    });

    return () => {
      mounted = false;
    };
  }, [activeTabId, session?.sessionId, session?.snapshot?.workspaceKey]);

  useEffect(() => {
    const listener = (message: SessionUpdatedMessage) => {
      if (
        message.type === "EVIDENCE_UPDATED" &&
        typeof message.payload?.tabId === "number" &&
        message.payload.tabId === activeTabId
      ) {
        const workspaceKey = sessionRef.current?.snapshot?.workspaceKey;
        if (!workspaceKey || message.payload.workspaceKey !== workspaceKey) {
          return;
        }

        setEvidence(Array.isArray(message.payload.evidence) ? message.payload.evidence : []);
        return;
      }

      if (
        message.type === "EVIDENCE_STATUS_UPDATED" &&
        typeof message.payload?.tabId === "number" &&
        message.payload.tabId === activeTabId
      ) {
        const workspaceKey = sessionRef.current?.snapshot?.workspaceKey;
        if (!workspaceKey || message.payload.workspaceKey !== workspaceKey) {
          return;
        }

        setPendingEvidence(
          Array.isArray(message.payload.pendingEvidence)
            ? message.payload.pendingEvidence
            : []
        );
        return;
      }

      if (message.type === "VOICE_TRANSCRIPT_READY") {
        const transcript = (message.payload as Record<string, unknown> | undefined)?.transcript;
        const target = (message.payload as Record<string, unknown> | undefined)?.target;
        const sessionId = (message.payload as Record<string, unknown> | undefined)?.sessionId;

        if (typeof transcript !== "string" || !transcript.trim()) return;
        if (target !== "draft" && target !== "instructions") return;
        if (typeof sessionId !== "string" || sessionId !== sessionRef.current?.sessionId) return;

        setUsedVoiceInput(true);
        if (target === "instructions") {
          setInstruction((prev) =>
            prev.trim().length > 0 ? `${prev}\n${transcript}` : transcript
          );
        }
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [activeTabId]);

  useEffect(() => {
    if (activeTabId === null) {
      clearPendingInsert();
      return;
    }

    const pending = readPendingInsert();
    if (!pending || pending.tabId !== activeTabId) {
      return;
    }
    const pendingInsert = pending;

    let cancelled = false;

    async function resumePendingInsert() {
      if (!session?.snapshot) {
        if (pendingInsert.bridgeRecoveryRequested) {
          clearPendingInsert();
          if (!cancelled) {
            setInsertNotice({
              tone: "error",
              message:
                "ReplyMate could not reconnect to this page. Refresh Slack and try again.",
            });
          }
          return;
        }

        writePendingInsert({
          ...pendingInsert,
          bridgeRecoveryRequested: true,
        });

        if (!cancelled) {
          setInsertNotice({
            tone: "warning",
            message: "ReplyMate was reloaded. Reopening the side panel and retrying insert.",
          });
        }

        try {
          const recovery = await sendRuntimeMessage<EnsureTabBridgeResponse>({
            type: "ENSURE_TAB_BRIDGE",
            payload: { tabId: activeTabId },
          });

          if (!recovery?.ok) {
            clearPendingInsert();
            if (!cancelled) {
              setInsertNotice({
                tone: "error",
                message: formatInsertFailureMessage(
                  "INSERT_TAB_BRIDGE_MISSING",
                  recovery?.message
                ),
              });
            }
            return;
          }

          const recoveredSession =
            recovery.session ??
            (
              await sendRuntimeMessage<SessionRuntimeResponse>({
                type: "GET_SESSION",
                payload: { tabId: activeTabId },
              })
            ).session ??
            null;

          if (!recoveredSession?.snapshot) {
            clearPendingInsert();
            if (!cancelled) {
              setInsertNotice({
                tone: "error",
                message:
                  "ReplyMate could not reconnect to this page. Refresh Slack and try again.",
              });
            }
            return;
          }

          clearPendingInsert();

          const result = await executeInsert(recoveredSession, pendingInsert.text);
          if (cancelled) return;

          if (result?.success) {
            setInsertNotice({
              tone: "success",
              message: "ReplyMate reconnected and inserted the draft.",
            });
            return;
          }

          setInsertNotice({
            tone: "error",
            message: formatInsertFailureMessage(result?.errorCode, result?.message),
          });
        } catch (runtimeError) {
          clearPendingInsert();
          if (!cancelled) {
            setInsertNotice({
              tone: "error",
              message: formatInsertRuntimeError(runtimeError),
            });
          }
        }
        return;
      }

      clearPendingInsert();

      try {
        const result = await executeInsert(session, pendingInsert.text);
        if (cancelled) return;

        if (result?.success) {
          setInsertNotice({
            tone: "success",
            message: "ReplyMate reconnected and inserted the draft.",
          });
          return;
        }

        setInsertNotice({
          tone: "error",
          message: formatInsertFailureMessage(result?.errorCode, result?.message),
        });
      } catch (runtimeError) {
        if (!cancelled) {
          setInsertNotice({
            tone: "error",
            message: formatInsertRuntimeError(runtimeError),
          });
        }
      }
    }

    void resumePendingInsert();

    return () => {
      cancelled = true;
    };
  }, [activeTabId, session]);

  useEffect(() => {
    const workspaceKey = session?.snapshot?.workspaceKey;
    if (!workspaceKey) {
      return;
    }

    const timer = window.setTimeout(() => {
      void sendRuntimeMessage({
        type: "SAVE_WORKSPACE_STATE",
        payload: {
          workspaceKey,
          state: {
            workspaceKey,
            siteId: session.siteId,
            adapterId: session.adapterId,
            actionMode,
            tonePreset,
            costMode,
            instruction,
            usedVoiceInput,
            response,
            error,
          },
        },
      }).catch(() => {});
    }, 200);

    return () => window.clearTimeout(timer);
  }, [
    actionMode,
    costMode,
    error,
    instruction,
    response,
    session,
    tonePreset,
    usedVoiceInput,
  ]);

  const handleGenerate = async (pendingDecision?: PendingEvidenceDecision) => {
    const activePendingEvidence = pendingEvidence.filter(
      (item) => item.state === "queued" || item.state === "processing"
    );
    if (activePendingEvidence.length > 0) {
      if (!pendingDecision) {
        setPendingEvidencePromptOpen(true);
        return;
      }
      if (pendingDecision === "wait") {
        setPendingEvidencePromptOpen(false);
        setInsertNotice({
          tone: "warning",
          message:
            "ReplyMate is waiting for evidence processing to finish before you generate.",
        });
        return;
      }
      if (pendingDecision === "cancel") {
        setPendingEvidencePromptOpen(false);
        return;
      }
      setPendingEvidencePromptOpen(false);
    }

    const freshSession = await ensureFreshSession("generate");
    if (!freshSession?.snapshot) {
      setResponse(null);
      setError(NO_COMPOSER_MESSAGE);
      return;
    }

    setLoading(true);
    setError(null);
    setInsertNotice(null);
    const cappedEvidence = capEvidenceSummaries(evidence);
    const settingsSnapshot = settings.get();
    const requestCostMode = resolveEffectiveCostMode(settingsSnapshot);

    chrome.runtime.sendMessage(
      {
        type: "GENERATE_DRAFT",
        payload: {
          sessionId: freshSession.sessionId,
          sessionVersion: freshSession.snapshot.sessionVersion,
          siteId: freshSession.siteId,
          actionMode,
          tonePreset,
          draftInput: freshSession.snapshot.draftText,
          instructionInput: instruction,
          contextEnabled: true,
          snapshot: freshSession.snapshot,
          evidence: cappedEvidence,
          usedVoiceInput,
          costMode: requestCostMode,
          providerConfig: settingsSnapshot.provider,
        },
      },
      (res) => {
        setLoading(false);
        if (chrome.runtime.lastError) {
          setError(chrome.runtime.lastError.message || "Communication error");
        } else if (res?.success && res.response) {
          const activePendingCount = activePendingEvidence.length;
          const nextResponse =
            pendingDecision === "continue" && activePendingCount > 0
              ? {
                  ...res.response,
                  warnings: [
                    ...(Array.isArray(res.response.warnings) ? res.response.warnings : []),
                    `Generated without ${activePendingCount} evidence file(s) still processing.`,
                  ],
                }
              : res.response;
          setResponse(nextResponse);
          setError(null);
        } else {
          setResponse(null);
          setError(res?.error || "Unknown generation error");
        }
      }
    );
  };

  const handleInsert = async (text: string) => {
    if (activeTabId === null) return;

    setInsertNotice(null);

    try {
      const freshSession = await ensureFreshSession("insert");
      if (!freshSession?.snapshot) {
        setInsertNotice({
          tone: "error",
          message: NO_COMPOSER_MESSAGE,
        });
        return;
      }

      const result = await executeInsert(freshSession, text);
      if (!result?.success) {
        setInsertNotice({
          tone: "error",
          message: formatInsertFailureMessage(result?.errorCode, result?.message),
        });
      }
    } catch (runtimeError) {
      if (
        runtimeError instanceof RuntimeMessageError &&
        runtimeError.code === "missing_receiver"
      ) {
        writePendingInsert({
          text,
          tabId: activeTabId,
          requestedAt: Date.now(),
          bridgeRecoveryRequested: false,
        });
        window.location.reload();
        return;
      }

      setInsertNotice({
        tone: "error",
        message: formatInsertRuntimeError(runtimeError),
      });
    }
  };

  const handleCopy = (text: string) => {
    void navigator.clipboard.writeText(text);
    if (!session?.sessionId) return;

    chrome.runtime.sendMessage({
      type: "TRACK_TELEMETRY_EVENT",
      payload: {
        name: "draft_copied",
        payload: { sessionId: session.sessionId, source: "sidepanel" },
      },
    });
  };

  if (!session) {
    return (
      <div className="status-card">
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: 13,
            textAlign: "center",
            padding: "20px 0",
          }}
        >
          Focus a text box to start drafting.
        </div>
      </div>
    );
  }

  const snap = session.snapshot as ComposerSnapshot;
  const draftLength = snap.draftText?.length || 0;
  const uniqueVisibleContext = dedupeVisibleContext(snap.visibleContext);
  const previewContext = uniqueVisibleContext.slice(-4);
  const isSlackSession = snap.metadata.siteId === "slack_web";
  const isStrictSlackThread =
    isSlackSession && snap.composerMode === "thread";
  const missingStrictThreadContext =
    isStrictSlackThread && snap.contextScope !== "thread";
  const responseWarnings = response?.warnings ?? [];
  const contextCoverageWarning = responseWarnings.find((warning) =>
    warning.startsWith("Context Reply used ")
  );
  const generalResponseWarnings = responseWarnings.filter(
    (warning) => warning !== contextCoverageWarning
  );
  const entityCorrections = response?.inputSummary.entityCorrectionsApplied ?? [];
  const draftFromContextBlocked =
    loading || (missingStrictThreadContext && actionMode === "draft_from_context");
  const activePendingEvidence = pendingEvidence.filter(
    (item) => item.state === "queued" || item.state === "processing"
  );

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-xs font-semibold text-app-textSecondary uppercase tracking-wider mb-3">Reply Generation</h2>
        
        {/* Current Draft Context */}
        <div className="bg-app-panel border border-app-border rounded-lg p-4 mb-4">
          <h3 className="text-sm font-medium mb-3 text-app-textPrimary">Current Draft Context</h3>
          <div className="textarea-container rounded-lg border border-app-border">
            <textarea 
              className="textarea-inner w-full h-24 p-3 text-sm text-app-textSecondary resize-none outline-none bg-transparent" 
              readOnly 
              value={draftLength > 0 ? snap.draftText : "Empty text box detected"}
            />
          </div>

          {/* Context Diagnostics */}
          <div className="mt-4 pt-4 border-t border-app-border">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-app-textSecondary uppercase tracking-wider">Context Diagnostics</h4>
              <button 
                className="flex items-center space-x-1 text-xs text-white hover:opacity-90 transition-opacity bg-app-accent px-3 py-1.5 rounded-full"
                onClick={() => setContextDrawerOpen((current) => !current)}
              >
                <span>{contextDrawerOpen ? "Hide Context" : "View Context"}</span>
                <span className={`text-[10px] transition-transform ${contextDrawerOpen ? "rotate-90" : ""}`}>▶</span>
              </button>
            </div>
            <ul className="space-y-2 text-sm text-app-textSecondary">
              <li className="flex items-center space-x-2">
                <i className="ph ph-users text-lg"></i>
                <span>Scope: <span className="text-white">{formatContextScope(snap.contextScope)}</span></span>
              </li>
              <li className="flex items-center space-x-2">
                <i className="ph ph-chat-centered-text text-lg"></i>
                <span>Captured messages: <span className="text-white">{uniqueVisibleContext.length}</span></span>
              </li>
              <li className="flex items-center space-x-2">
                <i className="ph ph-map-pin text-lg"></i>
                <span className="truncate flex-1">Location: <span className="text-white" title={getLocationLabel(snap)}>{getLocationLabel(snap)}</span></span>
              </li>
            </ul>
            
            {snap.warnings.length > 0 && (
              <div className="mt-2 text-xs text-app-warning italic">
                {snap.warnings.join(" ")}
              </div>
            )}
            
            <ContextDiagnosticsDrawer
              open={contextDrawerOpen}
              onClose={() => setContextDrawerOpen(false)}
              snapshot={snap}
              visibleContext={previewContext.length > 0 ? uniqueVisibleContext : snap.visibleContext}
              locationLabel={getLocationLabel(snap)}
              debugMode={debugMode}
            />
          </div>
        </div>


        {/* AI Instructions */}
        <div className="bg-app-panel border border-app-border rounded-lg p-4">
          <h3 className="text-xs font-medium mb-3 text-app-textSecondary uppercase tracking-wider">AI Instructions</h3>
          
          <div className="grid grid-cols-2 gap-3 mb-4">
            <select
              className="bg-[#1d1d2b] border border-app-border rounded-lg px-3 py-2 text-xs text-app-textPrimary outline-none focus:border-app-accent transition-colors"
              value={actionMode}
              onChange={(e) => setActionMode(e.target.value as ActionMode)}
              disabled={loading}
            >
              <option value="improve_current_draft">Improve Draft</option>
              <option value="draft_from_context" disabled={missingStrictThreadContext}>Draft from Context</option>
              <option value="reply_from_scratch">Reply from Scratch</option>
              <option value="make_shorter">Make Shorter</option>
            </select>
            <select
              className="bg-[#1d1d2b] border border-app-border rounded-lg px-3 py-2 text-xs text-app-textPrimary outline-none focus:border-app-accent transition-colors"
              value={tonePreset}
              onChange={(e) => setTonePreset(e.target.value as TonePreset)}
              disabled={loading}
            >
              <option value="professional">Professional</option>
              <option value="friendly">Friendly</option>
              <option value="concise">Concise</option>
              <option value="empathetic">Empathetic</option>
              <option value="confident">Confident</option>
            </select>
          </div>

          <div className="textarea-container rounded-lg border border-app-accent/50 mb-4 shadow-glow-inner">
            <textarea 
              className="textarea-inner w-full h-20 p-3 text-sm text-white placeholder-app-textSecondary resize-none outline-none bg-transparent" 
              placeholder="E.g., Make it sound more enthusiastic, add a bulleted list..."
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="mb-4">
            <div className={`text-[11px] mb-2 ${evidence.length > 0 ? "text-app-success" : "text-app-textSecondary"}`}>
              <i className="ph ph-file-text mr-1"></i>
              Evidence: {evidence.length} ready · {activePendingEvidence.length} pending
            </div>
            
            {pendingEvidencePromptOpen && (
              <div className="p-3 bg-app-warning/10 border border-app-warning rounded-lg text-app-warning text-xs space-y-2">
                <p>Evidence files are still processing.</p>
                <div className="flex gap-2">
                  <button onClick={() => void handleGenerate("wait")} className="px-2 py-1 bg-app-warning text-black rounded font-medium">Wait</button>
                  <button onClick={() => void handleGenerate("continue")} className="px-2 py-1 bg-app-panel border border-app-warning rounded">Skip</button>
                </div>
              </div>
            )}
          </div>

          <button 
            className="w-full bg-linear-to-r from-app-accent to-[#5e35b1] text-white font-medium py-3 rounded-full flex items-center justify-center space-x-2 shadow-glow hover:opacity-90 transition-opacity disabled:opacity-50 disabled:shadow-none"
            onClick={() => void handleGenerate()}
            disabled={draftFromContextBlocked}
          >
            <span>{loading ? "Generating..." : "Generate Replies"}</span>
            {!loading && <i className="ph ph-sparkle text-lg"></i>}
          </button>
        </div>
      </section>

      {/* Errors and Notices */}
      {(error || insertNotice || generalResponseWarnings.length > 0) && (
        <section className="space-y-3">
          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500 rounded-lg text-red-500 text-sm space-y-3">
              <div className="flex items-start space-x-2">
                <i className="ph ph-warning-circle text-lg mt-0.5"></i>
                <span>{error}</span>
              </div>
            </div>
          )}
          {insertNotice && (
            <div className={`p-4 rounded-lg text-sm border flex items-start space-x-2 ${
              insertNotice.tone === "success" ? "bg-app-success/10 border-app-success text-app-success" : 
              insertNotice.tone === "warning" ? "bg-app-warning/10 border-app-warning text-app-warning" : 
              "bg-red-500/10 border-red-500 text-red-500"
            }`}>
              <i className={`ph ${insertNotice.tone === "success" ? "ph-check-circle" : "ph-info"} text-lg mt-0.5`}></i>
              <span>{insertNotice.message}</span>
            </div>
          )}
          {generalResponseWarnings.map((w, i) => (
            <div key={i} className="p-3 bg-app-warning/10 border border-app-warning rounded-lg text-app-warning text-xs">
              {w}
            </div>
          ))}
        </section>
      )}

      {/* Results Section */}
      {response && (
        <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-app-textSecondary uppercase tracking-wider">Results</h2>
            <div className="flex gap-2">
              <span className="px-2 py-0.5 bg-app-accent/20 text-app-accent border border-app-accent/30 rounded text-[10px] font-medium uppercase">
                {formatProviderPath(response.inputSummary.providerPath)}
              </span>
            </div>
          </div>

          {entityCorrections.length > 0 && (
            <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-[11px] text-app-textSecondary">
              <div className="font-semibold text-blue-400 mb-1 uppercase tracking-tighter">Verified Terms Applied:</div>
              {entityCorrections.map((item) => `${item.from} → ${item.to}`).join(" · ")}
            </div>
          )}

          <div className="space-y-4">
            {response.drafts.map((variant) => (
              <div 
                key={variant.id} 
                className={`bg-app-panel border rounded-xl p-4 transition-all duration-300 ${
                  isEmphasizedVariant(variant) ? "border-app-accent shadow-glow" : "border-app-border"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    <span className={`text-sm font-bold ${isEmphasizedVariant(variant) ? "text-white" : "text-app-textSecondary"}`}>
                      {variant.label}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border uppercase font-bold tracking-tight ${
                      isEmphasizedVariant(variant) ? "bg-app-accent border-app-accent text-white" : "bg-transparent border-app-border text-app-textSecondary"
                    }`}>
                      {isCleanedDraftVariant(variant) ? "Cleaned" : isContextReplyVariant(variant) ? "Context" : "Alt"}
                    </span>
                  </div>
                  {variant.styleNotes[0] && (
                    <span className="text-[10px] text-app-textSecondary italic">{variant.styleNotes[0]}</span>
                  )}
                </div>

                <div className="text-sm leading-relaxed text-app-textPrimary mb-4 whitespace-pre-wrap select-text">
                  {variant.text}
                </div>

                {isContextReplyVariant(variant) && contextCoverageWarning && (
                  <div className="mb-4 rounded-lg border border-app-warning bg-app-warning/10 px-3 py-2 text-[11px] text-app-warning">
                    {contextCoverageWarning}
                  </div>
                )}

                <div className="flex gap-2">
                  <button 
                    className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                      isEmphasizedVariant(variant) ? "bg-app-accent text-white btn-glow" : "bg-app-bg border border-app-border text-white hover:bg-app-border"
                    }`}
                    onClick={() => void handleInsert(variant.text)}
                  >
                    Insert Draft
                  </button>
                  <button 
                    className="px-4 py-2 bg-app-bg border border-app-border rounded-lg text-app-textSecondary hover:text-white transition-colors"
                    onClick={() => void handleCopy(variant.text)}
                    title="Copy to clipboard"
                  >
                    <i className="ph ph-copy text-sm"></i>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {debugMode && response.debug && <DraftingDebugPanel debug={response.debug} />}
          
          {debugMode && (
            <div className="mt-4 text-[10px] text-app-textSecondary text-center uppercase tracking-widest opacity-50">
              {Math.round(response.timings.totalMs)}ms · Provider: {Math.round(response.timings.providerMs)}ms · Retry: {response.timings.usedRetryPass ? "Yes" : "No"}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
