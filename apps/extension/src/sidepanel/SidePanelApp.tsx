import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { bootstrap } from "../core/boot/bootstrap.js";
import type {
  FeatureId,
  ModuleContext,
  RuntimeReadiness,
  RuntimeReadinessEntry,
} from "@replymate/contracts";
import { ShellContextProvider } from "../core/ui/ShellContext.js";
import { ActiveTabProvider } from "../core/ui/ActiveTabContext.js";
import {
  ActiveSessionProvider,
  type ActiveSessionConnectionState,
} from "../core/ui/ActiveSessionContext.js";
import { sendRuntimeMessage } from "../shared/runtime.js";
import { useSidePanelSessionController } from "./useSidePanelSessionController.js";
export { sidePanelWindowActions } from "./useSidePanelSessionController.js";

function canUseLocalSpeech(): boolean {
  const runtime = window as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return Boolean(runtime.SpeechRecognition || runtime.webkitSpeechRecognition);
}

function canRecordAudio(): boolean {
  return (
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined"
  );
}


function formatConnectionState(state: ActiveSessionConnectionState): string {
  switch (state) {
    case "idle":
      return "Idle";
    case "connected":
      return "Connected";
    case "disconnected":
      return "Disconnected";
    case "error":
      return "Error";
    case "connecting":
    default:
      return "Connecting…";
  }
}

function formatStatus(status: RuntimeReadinessEntry["status"]): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "degraded":
      return "Degraded";
    case "not_configured":
      return "Not configured";
    case "disabled":
      return "Disabled";
    case "unavailable":
    default:
      return "Unavailable";
  }
}

function formatComposerState(
  state: "available" | "missing" | "unknown" | "unsupported"
): string {
  switch (state) {
    case "available":
      return "Active text box detected";
    case "missing":
      return "No active text box";
    case "unsupported":
      return "Unsupported page";
    case "unknown":
    default:
      return "Scanning for a text box";
  }
}

/**
 * Side Panel App — TRD §14.3
 *
 * Boots the local shell first, then hydrates background runtime state.
 * This keeps the sidepanel usable even when Chrome has a stale background connection.
 */
export function SidePanelApp() {
  const [runtimeReadiness, setRuntimeReadiness] = useState<RuntimeReadiness | null>(null);
  const [ctx, setCtx] = useState<ModuleContext | null>(null);
  const [panels, setPanels] = useState<
    { featureId: FeatureId; component: ComponentType<any> }[]
  >([]);
  const [shellError, setShellError] = useState<string | null>(null);
  const readinessRequestRef = useRef(0);

  const refreshRuntimeReadiness = useCallback(
    async (tabId: number | null): Promise<void> => {
      const requestId = ++readinessRequestRef.current;
      const response = await sendRuntimeMessage<{
        readiness?: RuntimeReadiness;
      }>({
        type: "GET_RUNTIME_READINESS",
        payload: {
          tabId,
          browserLocalVoiceAvailable: canUseLocalSpeech(),
          browserRecordingAvailable: canRecordAudio(),
        },
      });

      if (requestId !== readinessRequestRef.current) {
        return;
      }
      setRuntimeReadiness(response?.readiness ?? null);
    },
    []
  );

  const {
    activeTabId,
    session,
    connectionState,
    composerAvailability,
    connectionMessage,
    ensureFreshSession,
    retryConnection,
    syncSession,
  } = useSidePanelSessionController({
    refreshRuntimeReadiness,
  });

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const { ctx, registry } = await bootstrap("sidepanel");
        await registry.bootAll(ctx);
        if (!mounted) return;
        setCtx(ctx);
        setPanels(ctx.uiRegistry.getPanels("sidepanel"));
      } catch (error) {
        if (!mounted) return;
        console.error("Side Panel shell bootstrap failed:", error);
        setShellError(error instanceof Error ? error.message : String(error));
      }
    }

    void init();
    return () => {
      mounted = false;
    };
  }, []);

  if (!ctx) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#11111a] text-app-textSecondary">
        <div className="text-center">
          <div className="w-8 h-8 bg-app-accent rounded flex items-center justify-center text-white font-bold text-lg mx-auto mb-4 animate-pulse">
            R
          </div>
          <h1 className="text-lg font-semibold tracking-wide text-white mb-2">ReplyMate</h1>
          <p className="text-sm">{shellError || connectionMessage || "Loading ReplyMate…"}</p>
        </div>
      </div>
    );
  }

  return (
    <ShellContextProvider ctx={ctx}>
      <ActiveTabProvider tabId={activeTabId}>
          <ActiveSessionProvider
            value={{
              session,
              activeTabId,
              connectionState,
              composerAvailability,
              connectionMessage,
              ensureFreshSession,
              retryConnection,
              syncSession,
            }}
          >
          <div className="bg-[#11111a] text-app-textPrimary font-sans antialiased w-full h-screen overflow-hidden flex flex-col border border-[#2d2d44]">
            {/* BEGIN: Header */}
            <header className="flex items-center justify-between px-4 py-3 bg-app-bg border-b border-app-border sticky top-0 z-10">
              <div className="flex items-center space-x-2">
                <div className="w-6 h-6 bg-app-accent rounded flex items-center justify-center text-white font-bold text-sm">
                  R
                </div>
                <h1 className="text-lg font-semibold tracking-wide">ReplyMate</h1>
              </div>
              <div className="flex items-center space-x-3">
                {/* Connection Status Badge */}
                <div
                  className="flex items-center space-x-2 bg-app-panel border border-app-border rounded-full px-3 py-1 text-sm text-app-textSecondary"
                  data-testid="replymate-connection-status"
                >
                  <div 
                    className={`w-2 h-2 rounded-full ${
                      connectionState === "connected" ? "bg-app-success shadow-[0_0_5px_#4ade80]" : 
                      connectionState === "connecting" ? "bg-app-warning" :
                      connectionState === "disconnected" || connectionState === "error" ? "bg-red-500" :
                      "bg-app-textSecondary"
                    }`}
                  />
                  <span>{formatConnectionState(connectionState)}</span>
                </div>
                <button
                  aria-label="Pin ReplyMate"
                  className="text-app-textSecondary hover:text-white transition-colors"
                >
                  <i className="ph ph-push-pin text-xl"></i>
                </button>
              </div>
            </header>

            {/* BEGIN: Main Content Area */}
            <main className="flex-1 overflow-y-auto p-4 space-y-6">
              {connectionMessage && (
                <div className="bg-app-panel border border-app-border rounded-lg p-3 text-sm text-app-textSecondary">
                  <p
                      className={
                        connectionState === "error"
                          ? "text-app-warning"
                        : composerAvailability === "missing" || composerAvailability === "unsupported"
                          ? "text-app-textSecondary"
                          : ""
                    }
                  >
                    {connectionMessage}
                  </p>
                  {(connectionState === "disconnected" || connectionState === "error") && (
                    <button
                      type="button"
                      aria-label="Retry ReplyMate connection"
                      data-testid="replymate-retry-button"
                      className="mt-2 px-3 py-1 text-xs border border-app-border rounded-full hover:bg-app-border transition-colors text-white"
                      onClick={() => {
                        void retryConnection();
                      }}
                    >
                      Retry
                    </button>
                  )}
                </div>
              )}

              {/* BEGIN: System Status Section */}
              <section>
                <h2 className="text-xs font-semibold text-app-textSecondary uppercase tracking-wider mb-3">System Status</h2>
                <div className="grid grid-cols-3 gap-3">
                  {/* Connection Card */}
                  <div className="bg-[#1d1d2b] border border-[#2d2d44] rounded-lg p-3 flex flex-col min-h-[85px]">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <i className="ph ph-wifi-high text-app-textSecondary"></i>
                        <span className="text-xs font-medium">Conn</span>
                      </div>
                      <div className={`w-2 h-2 rounded-full ${connectionState === "connected" ? "bg-app-success" : "bg-app-textSecondary"}`}></div>
                    </div>
                    <div className="text-[10px] text-app-textSecondary mt-auto leading-tight">
                      <div data-testid="replymate-composer-state">
                        {formatComposerState(composerAvailability)}
                      </div>
                      <div
                        className="text-white truncate block mt-1"
                        data-testid="replymate-active-adapter"
                      >
                        {session?.adapterId
                          ? `${session.siteId} — ${session.adapterId} adapter`
                          : "No active adapter"}
                      </div>
                    </div>
                  </div>

                  {/* Writing Card */}
                  <div className="bg-[#1d1d2b] border border-[#2d2d44] rounded-lg p-3 flex flex-col min-h-[85px]">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <i className="ph ph-pencil-simple text-app-textSecondary"></i>
                        <span className="text-xs font-medium">Writing</span>
                      </div>
                      <div 
                        className={`w-2 h-2 rounded-full ${
                          runtimeReadiness?.drafting.status === "ready" ? "bg-app-success" : 
                          runtimeReadiness?.drafting.status === "degraded" ? "bg-app-warning" : "bg-app-textSecondary"
                        }`}
                      />
                    </div>
                    <div className="text-[10px] text-app-textSecondary mt-auto leading-tight">
                      {runtimeReadiness?.drafting.status === "ready" ? (
                        <>Model:<br/><span className="text-white">qwen3:8b</span></>
                      ) : (
                        <span>{runtimeReadiness ? formatStatus(runtimeReadiness.drafting.status) : "Off"}</span>
                      )}
                    </div>
                  </div>

                  {/* Voice Card */}
                  <div className="bg-[#1d1d2b] border border-[#2d2d44] rounded-lg p-3 flex flex-col min-h-[85px]">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <i className="ph ph-microphone text-app-textSecondary"></i>
                        <span className="text-xs font-medium">Voice</span>
                      </div>
                      <div 
                        className={`w-2 h-2 rounded-full ${
                          runtimeReadiness?.voice.status === "ready" ? "bg-app-success" : 
                          runtimeReadiness?.voice.status === "degraded" ? "bg-app-warning" : "bg-app-textSecondary"
                        }`}
                      />
                    </div>
                    <div className="text-[10px] text-app-textSecondary mt-auto leading-tight">
                      {runtimeReadiness ? (
                        runtimeReadiness.voice.status === "degraded" ? 
                          <span className="text-app-warning">Degraded</span> : 
                          <span>{formatStatus(runtimeReadiness.voice.status)}</span>
                      ) : "Off"}
                    </div>
                  </div>
                </div>
              </section>

              {/* BEGIN: Modules Area */}
              {panels.length === 0 ? (
                <div className="text-center py-12 px-4 bg-app-panel border border-app-border rounded-lg">
                  <div className="text-3xl mb-4 opacity-50">📦</div>
                  <p className="text-sm text-app-textSecondary">
                    Feature modules will appear here once registered.
                    <br />
                    Core shell is ready.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-6">
                  {panels.map(({ featureId, component: PanelComponent }) => (
                    <div key={featureId}>
                       <PanelComponent />
                    </div>
                  ))}
                </div>
              )}
            </main>

            {/* BEGIN: Footer */}
            <footer className="p-4 text-center border-t border-[#2d2d44] bg-[#11111a] mt-auto">
              <div className="bg-[#2a2a3e] border border-[#4a4a6a] rounded-lg p-3 text-center text-[#ccc] text-xs mb-4">
                Redesign Active v0.1.0 · Design by Stitch
              </div>
              <div className="text-xs text-[#666]">ReplyMate · Professional Drafting</div>
            </footer>
          </div>
        </ActiveSessionProvider>
      </ActiveTabProvider>
    </ShellContextProvider>
  );
}
