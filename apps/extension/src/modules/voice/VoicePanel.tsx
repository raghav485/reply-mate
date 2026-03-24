import { useEffect, useRef, useState } from "react";
import type { ComposerSession, CostMode, VoiceState } from "@replymate/contracts";
import { useActiveSession } from "../../core/ui/ActiveSessionContext.js";
import { useShellContext } from "../../core/ui/ShellContext.js";
import { sendRuntimeMessage } from "../../shared/runtime.js";
import {
  canRetryRemoteTranscription,
  chooseVoiceStartMode,
  formatVoiceFailureMessage,
  resolveRemoteRetryMode,
  type VoiceFailureKind,
} from "./voicePolicy.js";

type VoiceTarget = "draft" | "instructions";

type VoiceTranscribeResponse = {
  apiVersion: string;
  transcript: string;
  confidence: number;
};

type RuntimeInsertResponse = {
  success: boolean;
  errorCode?: string;
  message?: string;
};

type RuntimeOkResponse = {
  ok?: boolean;
  error?: string;
  errorCode?: string;
  result?: VoiceTranscribeResponse;
};

type LocalVoiceEventMessage = {
  type?: string;
  payload?: {
    sessionId?: string;
    target?: VoiceTarget;
    kind?:
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
    failureKind?: VoiceFailureKind;
  };
};

const MAX_RECORDING_MS = 90_000;

function chooseRecorderMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];

  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result ?? "");
      const commaIndex = raw.indexOf(",");
      resolve(commaIndex >= 0 ? raw.slice(commaIndex + 1) : raw);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read audio blob."));
    reader.readAsDataURL(blob);
  });
}

function stopStreamTracks(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}


export function VoicePanel() {
  const { session, ensureFreshSession } = useActiveSession();
  const { settings } = useShellContext();
  const sessionRef = useRef<ComposerSession | null>(session);
  const costDefaultRef = useRef(settings.get().preferences.defaultCostMode);
  const [target, setTarget] = useState<VoiceTarget>("instructions");
  const [voiceState, setVoiceState] = useState<VoiceState>({ status: "idle" });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [voiceFailureKind, setVoiceFailureKind] = useState<VoiceFailureKind | null>(null);
  const [localVoiceNotice, setLocalVoiceNotice] = useState<string | null>(null);
  const [costMode, setCostMode] = useState<CostMode>(
    settings.get().preferences.defaultCostMode
  );
  const [defaultCostMode, setDefaultCostMode] = useState<CostMode>(
    settings.get().preferences.defaultCostMode
  );
  const [allowHybridFallback, setAllowHybridFallback] = useState(
    settings.get().preferences.allowHybridVoiceFallback
  );

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const autoStopTimerRef = useRef<number | null>(null);
  const tickerRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef<number>(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    const unsubscribeSettings = settings.subscribe((next) => {
      const previousCostDefault = costDefaultRef.current;
      costDefaultRef.current = next.preferences.defaultCostMode;
      setDefaultCostMode(next.preferences.defaultCostMode);
      setCostMode((prev) =>
        prev === previousCostDefault ? next.preferences.defaultCostMode : prev
      );
      setAllowHybridFallback(next.preferences.allowHybridVoiceFallback);
    });

    return () => {
      mountedRef.current = false;
      unsubscribeSettings();
      clearRecordingTimers();

      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      mediaRecorderRef.current = null;
      stopStreamTracks(streamRef.current);
      streamRef.current = null;
      chunksRef.current = [];
    };
  }, [settings]);

  useEffect(() => {
    const listener = (message: LocalVoiceEventMessage) => {
      if (message.type !== "VOICE_LOCAL_EVENT") return;

      const payload = message.payload;
      if (
        payload?.target !== "draft" &&
        payload?.target !== "instructions"
      ) {
        return;
      }

      const activeSession = sessionRef.current;
      if (!activeSession || payload.sessionId !== activeSession.sessionId) {
        return;
      }

      switch (payload.kind) {
        case "requesting_permission":
          setLocalVoiceNotice(null);
          setVoiceFailureKind(null);
          setVoiceState({ status: "requesting_permission" });
          break;
        case "awaiting_page_click":
          clearRecordingTimers();
          setElapsedMs(0);
          setVoiceFailureKind(
            payload.failureKind === "sidepanel_surface_blocked" ||
              payload.failureKind === "page_activation_required"
              ? payload.failureKind
              : "page_activation_required"
          );
          setLocalVoiceNotice(
            payload.message || "Click the on-page voice button to continue."
          );
          setVoiceState({ status: "requesting_permission" });
          break;
        case "recording": {
          const startedAt = payload.startedAt || new Date().toISOString();
          recordingStartedAtRef.current = Date.parse(startedAt) || Date.now();
          setElapsedMs(0);
          setTranscript("");
          setConfidence(null);
          setLocalVoiceNotice(null);
          setVoiceFailureKind(null);
          beginTicker();
          setVoiceState({
            status: "recording",
            target: payload.target,
            startedAt,
            mode: "local",
          });
          break;
        }
        case "transcribing":
          clearRecordingTimers();
          setElapsedMs(0);
          setLocalVoiceNotice(null);
          setVoiceState({
            status: "transcribing",
            target: payload.target,
            mode: "local",
          });
          break;
        case "transcript_ready":
          if (!payload.transcript?.trim()) {
            return;
          }
          void finalizeTranscript(
            activeSession,
            payload.target,
            payload.transcript.trim(),
            "local",
            null
          ).catch((error) => {
            setVoiceFailureKind("speech_api_error");
            setVoiceState({
              status: "error",
              message: error instanceof Error ? error.message : String(error),
            });
          });
          break;
        case "error":
          clearRecordingTimers();
          setElapsedMs(0);
          setLocalVoiceNotice(null);
          setVoiceFailureKind(payload.failureKind ?? "speech_api_error");
          setVoiceState({
            status: "error",
            message: payload.message || "Local voice capture failed.",
          });
          break;
        case "stopped":
          clearRecordingTimers();
          setElapsedMs(0);
          setLocalVoiceNotice(null);
          setVoiceFailureKind(null);
          setVoiceState({ status: "idle" });
          break;
        default:
          break;
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  const browserRecordingAvailable =
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined";
  const remoteRetryMode = resolveRemoteRetryMode({
    costMode,
    defaultCostMode,
    allowHybridFallback,
    browserRecordingAvailable,
  });
  const canRetryRemotely = canRetryRemoteTranscription(
    voiceFailureKind,
    Boolean(session),
    remoteRetryMode
  );

  const clearRecordingTimers = () => {
    if (tickerRef.current) {
      window.clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    if (autoStopTimerRef.current) {
      window.clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
  };

  const beginTicker = () => {
    if (tickerRef.current) {
      window.clearInterval(tickerRef.current);
    }
    tickerRef.current = window.setInterval(() => {
      const started = recordingStartedAtRef.current;
      if (!started) return;
      setElapsedMs(Date.now() - started);
    }, 250);
  };

  const setVoiceFailure = (kind: VoiceFailureKind) => {
    clearRecordingTimers();
    setElapsedMs(0);
    setVoiceFailureKind(kind);
    setLocalVoiceNotice(null);
    setVoiceState({
      status: "error",
      message: formatVoiceFailureMessage(
        kind,
        kind !== "permission_denied" &&
          kind !== "remote_blocked" &&
          kind !== "insert_failed" &&
          Boolean(session) &&
          Boolean(remoteRetryMode)
      ),
    });
  };

  const publishTranscript = async (
    sessionId: string,
    transcriptText: string,
    transcriptTarget: VoiceTarget,
    source: "local" | "cloud"
  ) => {
    const res = await sendRuntimeMessage<RuntimeOkResponse>({
      type: "VOICE_TRANSCRIPT_READY",
      payload: {
        sessionId,
        transcript: transcriptText,
        target: transcriptTarget,
        source,
      },
    });

    if (!res?.ok) {
      throw new Error(res?.error || "Failed to publish transcript event.");
    }
  };

  const appendTranscriptToDraft = async (
    activeSession: ComposerSession,
    transcriptText: string
  ) => {
    if (!activeSession.snapshot) {
      throw new Error("No active composer snapshot. Focus a text box and retry.");
    }

    const response = await sendRuntimeMessage<RuntimeInsertResponse>({
      type: "EXECUTE_INSERT",
      payload: {
        sessionId: activeSession.sessionId,
        sessionVersion: activeSession.snapshot.sessionVersion,
        viewFingerprint: activeSession.snapshot.viewFingerprint,
        composerFingerprint: activeSession.snapshot.composerFingerprint,
        text: transcriptText,
        mode: "append",
      },
    });

    if (!response?.success) {
      throw new Error(response?.message || response?.errorCode || "Insert failed.");
    }
  };

  const finalizeTranscript = async (
    activeSession: ComposerSession,
    transcriptTarget: VoiceTarget,
    transcriptText: string,
    mode: "local" | "cloud",
    confidenceValue: number | null
  ) => {
    clearRecordingTimers();
    setElapsedMs(0);
    setTranscript(transcriptText);
    setConfidence(confidenceValue);
    setVoiceFailureKind(null);

    await publishTranscript(activeSession.sessionId, transcriptText, transcriptTarget, mode);

    if (transcriptTarget === "draft") {
      try {
        await appendTranscriptToDraft(activeSession, transcriptText);
      } catch (error) {
        setVoiceFailureKind("insert_failed");
        throw error;
      }
    }

    if (!mountedRef.current) return;
    setVoiceState({ status: "idle" });
  };

  const transcribeRemotely = async (
    blob: Blob,
    requestCostMode: CostMode
  ): Promise<VoiceTranscribeResponse> => {
    const audioBase64 = await blobToBase64(blob);
    const response = await sendRuntimeMessage<RuntimeOkResponse>({
      type: "VOICE_TRANSCRIBE",
      payload: {
        audioBase64,
        mimeType: blob.type || "audio/webm",
        costMode: requestCostMode,
      },
    });

    if (!response.ok || !response.result) {
      throw new Error(response.error || response.errorCode || "Voice transcription failed.");
    }

    return response.result;
  };

  const stopRecording = () => {
    if (voiceState.status !== "recording") return;

    if (voiceState.mode === "local") {
      const activeSession = sessionRef.current;
      if (!activeSession) {
        setVoiceFailure("local_start_failed");
        return;
      }
      void sendRuntimeMessage<RuntimeOkResponse>({
        type: "VOICE_LOCAL_STOP",
        payload: {
          sessionId: activeSession.sessionId,
        },
      }).catch((error) => {
        setVoiceState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  const startLocalSpeech = async (activeSession: ComposerSession) => {
    recordingStartedAtRef.current = 0;
    clearRecordingTimers();
    setElapsedMs(0);
    setTranscript("");
    setConfidence(null);
    setVoiceFailureKind(null);
    setLocalVoiceNotice(null);
    setVoiceState({ status: "requesting_permission" });

    const response = await sendRuntimeMessage<RuntimeOkResponse>({
      type: "VOICE_LOCAL_START",
      payload: {
        sessionId: activeSession.sessionId,
        target,
      },
    });

    if (!response?.ok) {
      setVoiceState({
        status: "error",
        message: response?.error || "Failed to start local voice capture.",
      });
    }
  };

  const startRemoteSpeech = async (
    activeSession: ComposerSession,
    requestCostMode: CostMode
  ) => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("Voice capture is not supported in this browser context.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    setVoiceFailureKind(null);

    const mimeType = chooseRecorderMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onerror = () => {
      clearRecordingTimers();
      stopStreamTracks(streamRef.current);
      streamRef.current = null;
      mediaRecorderRef.current = null;
      chunksRef.current = [];
      setElapsedMs(0);
      setVoiceState({
        status: "error",
        message: "Voice recording failed. Please try again.",
      });
    };

    recorder.onstop = () => {
      mediaRecorderRef.current = null;
      clearRecordingTimers();
      setElapsedMs(0);

      const blob = new Blob(chunksRef.current, { type: mimeType || recorder.mimeType || "audio/webm" });
      chunksRef.current = [];
      stopStreamTracks(streamRef.current);
      streamRef.current = null;
      setVoiceState({ status: "transcribing", target, mode: "cloud" });

      void transcribeRemotely(blob, requestCostMode)
        .then((response) =>
          finalizeTranscript(activeSession, target, response.transcript.trim(), "cloud", response.confidence)
        )
        .catch((err) => {
          setVoiceState({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        });
    };

    recorder.start(250);
    recordingStartedAtRef.current = Date.now();
    setElapsedMs(0);
    setTranscript("");
    setConfidence(null);
    beginTicker();
    autoStopTimerRef.current = window.setTimeout(() => recorder.stop(), MAX_RECORDING_MS);
    setVoiceState({
      status: "recording",
      target,
      startedAt: new Date().toISOString(),
      mode: "cloud",
    });
  };

  const startRecording = async () => {
    const freshSession = await ensureFreshSession("voice");
    if (!freshSession) {
      setVoiceFailureKind(null);
      setVoiceState({
        status: "error",
        message:
          "ReplyMate could not find an active text box on this page. Focus the composer and try again.",
      });
      return;
    }

    const decision = chooseVoiceStartMode({
      costMode,
      localSpeechAvailable: true,
      allowHybridFallback,
    });

    try {
      setVoiceFailureKind(null);
      if (decision.kind === "blocked") {
        throw new Error(decision.reason);
      }

      if (decision.kind === "local") {
        await startLocalSpeech(freshSession);
        return;
      }

      if (decision.kind === "confirm_remote") {
        const approved = window.confirm(decision.reason);
        if (!approved) {
          return;
        }
      }

      await startRemoteSpeech(
        freshSession,
        decision.kind === "remote" ? costMode : "hybrid_low_cost"
      );
    } catch (err) {
      stopStreamTracks(streamRef.current);
      streamRef.current = null;
      mediaRecorderRef.current = null;
      chunksRef.current = [];
      clearRecordingTimers();
      setElapsedMs(0);
      const message = err instanceof Error ? err.message : String(err);
      if (/blocked/i.test(message)) {
        setVoiceFailure("remote_blocked");
      } else {
        setVoiceState({
          status: "error",
          message,
        });
      }
    }
  };

  const retryWithRemoteTranscription = async () => {
    if (!session || !remoteRetryMode) {
      setVoiceFailure("remote_blocked");
      return;
    }

    try {
      setVoiceFailureKind(null);
      setVoiceState({ status: "requesting_permission" });
      await startRemoteSpeech(session, remoteRetryMode);
    } catch (err) {
      stopStreamTracks(streamRef.current);
      streamRef.current = null;
      mediaRecorderRef.current = null;
      chunksRef.current = [];
      clearRecordingTimers();
      setElapsedMs(0);
      setVoiceState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const isRecording = voiceState.status === "recording";
  const isTranscribing = voiceState.status === "transcribing";
  const isBusy =
    voiceState.status === "recording" ||
    voiceState.status === "transcribing" ||
    voiceState.status === "requesting_permission";
  const canRecord = Boolean(session);

  return (
    <section>
      <h2 className="text-xs font-semibold text-app-textSecondary uppercase tracking-wider mb-3">Voice Input</h2>
      <div className="bg-app-panel border border-app-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center border transition-colors ${
              isRecording ? "bg-red-500/20 border-red-500 animate-pulse" : "bg-app-accent/10 border-app-accent/30"
            }`}>
              <i className={`ph ph-microphone text-xl ${isRecording ? "text-red-500" : "text-app-accent"}`}></i>
            </div>
            <div>
              <div className="text-sm font-medium text-white">Voice to Text</div>
              <div className="text-[10px] text-app-textSecondary uppercase tracking-wider">
                {isRecording ? `Recording... ${formatElapsed(elapsedMs)}` : isTranscribing ? "Transcribing..." : "Ready to record"}
              </div>
            </div>
          </div>
          <div className="flex space-x-1 bg-[#1d1d2b] p-1 rounded-lg border border-app-border">
            <button 
              className={`px-2 py-1 text-[10px] rounded transition-all font-bold ${target === "instructions" ? "bg-app-accent text-white" : "text-app-textSecondary hover:text-white"}`}
              onClick={() => setTarget("instructions")}
              disabled={isBusy}
            >
              INS
            </button>
            <button 
              className={`px-2 py-1 text-[10px] rounded transition-all font-bold ${target === "draft" ? "bg-app-accent text-white" : "text-app-textSecondary hover:text-white"}`}
              onClick={() => setTarget("draft")}
              disabled={isBusy}
            >
              DFT
            </button>
          </div>
        </div>

        <button 
          className={`w-full py-3 rounded-xl flex items-center justify-center space-x-2 transition-all group font-medium text-sm ${
            isRecording 
              ? "bg-red-500/10 border border-red-500/50 text-red-500 hover:bg-red-500/20" 
              : "bg-[#1d1d2b] border border-app-border text-white hover:border-app-accent"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          disabled={(!canRecord && !isRecording) || isTranscribing}
          onClick={isRecording ? stopRecording : startRecording}
        >
          <div className={`w-2 h-2 rounded-full ${isRecording ? "bg-red-500 animate-pulse" : "bg-app-textSecondary"}`}></div>
          <span>{isRecording ? "Stop Recording" : isTranscribing ? "Processing..." : "Start Recording"}</span>
        </button>

        {!session && !isRecording && (
          <div className="mt-3 text-[11px] text-app-textSecondary flex items-center justify-center space-x-1">
            <i className="ph ph-info"></i>
            <span>Focus a composer to start</span>
          </div>
        )}

        {/* Cost Mode in Voice Panel if relevant */}
        {defaultCostMode !== "local_only" && !isBusy && (
          <div className="mt-4 pt-4 border-t border-app-border flex items-center justify-between">
            <span className="text-[10px] text-app-textSecondary uppercase tracking-widest font-bold">Transcription Quality</span>
            <select 
              className="bg-transparent text-[10px] text-app-accent font-bold outline-none cursor-pointer hover:underline uppercase"
              value={costMode}
              onChange={(e) => setCostMode(e.target.value as CostMode)}
            >
              <option value="hybrid_low_cost">Standard</option>
              <option value="cloud_quality">High Qual</option>
            </select>
          </div>
        )}
      </div>

      {/* Notices and Errors */}
      {(localVoiceNotice || voiceState.status === "error") && (
        <div className="mt-3 space-y-2">
          {localVoiceNotice && (
            <div className="p-3 bg-app-accent/10 border border-app-accent/30 rounded-lg text-app-accent text-xs flex items-start space-x-2">
              <i className="ph ph-info text-lg mt-0.5"></i>
              <span>{localVoiceNotice}</span>
            </div>
          )}
          {voiceState.status === "error" && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-xs space-y-2">
              <div className="flex items-start space-x-2">
                <i className="ph ph-warning-circle text-lg mt-0.5"></i>
                <span className="flex-1">{voiceState.message}</span>
              </div>
              {canRetryRemotely && (
                <button 
                  className="w-full py-2 bg-red-500/20 border border-red-500/40 rounded-lg text-[11px] font-bold hover:bg-red-500/30 transition-colors uppercase tracking-tight"
                  onClick={() => void retryWithRemoteTranscription()}
                >
                  Retry with cloud transcription
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Transcript Results */}
      {transcript && (
        <div className="mt-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[10px] text-app-textSecondary uppercase tracking-widest font-bold">Latest Result</span>
            {confidence !== null && (
              <span className="text-[10px] font-bold text-app-success uppercase tracking-tighter">
                {Math.round(confidence * 100)}% Conf
              </span>
            )}
          </div>
          <div className="bg-app-panel border border-app-border rounded-lg p-3 text-sm text-app-textPrimary whitespace-pre-wrap italic leading-relaxed shadow-sm">
            "{transcript}"
          </div>
        </div>
      )}
    </section>
  );
}
