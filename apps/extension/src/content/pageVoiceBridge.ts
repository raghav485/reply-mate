import {
  classifySpeechFailure,
  type MicrophoneAccessState,
  type VoiceFailureKind,
} from "../modules/voice/voicePolicy.js";

type VoiceTarget = "draft" | "instructions";

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onaudiostart: (() => void) | null;
  onaudioend: (() => void) | null;
  onnomatch: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

type LocalVoiceEventKind =
  | "requesting_permission"
  | "awaiting_page_click"
  | "recording"
  | "transcribing"
  | "transcript_ready"
  | "error"
  | "stopped";

type LocalVoiceEvent = {
  sessionId: string;
  target: VoiceTarget;
  kind: LocalVoiceEventKind;
  startedAt?: string;
  transcript?: string;
  message?: string;
  failureKind?:
    | VoiceFailureKind
    | "sidepanel_surface_blocked"
    | "page_activation_required";
};

type PageVoiceBridgeDeps = {
  getAnchorElement: () => Element | null;
  sendEvent: (event: LocalVoiceEvent) => void;
};

type StartVoicePayload = {
  sessionId: string;
  target: VoiceTarget;
};

type StartAttemptOptions = {
  fromPageClick: boolean;
};

const MAX_RECORDING_MS = 90_000;

type VoiceBridgeState = {
  sessionId: string;
  target: VoiceTarget;
  microphoneAccess: MicrophoneAccessState;
  recognition: SpeechRecognitionLike | null;
  transcript: string;
  startedAtMs: number;
  startedAtIso: string;
  audioStarted: boolean;
  speechStarted: boolean;
  failureHandled: boolean;
  waitingForClick: boolean;
  pageClickUsed: boolean;
  autoStopTimer: number | null;
};

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const candidate =
    (window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    }).SpeechRecognition ||
    (window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    }).webkitSpeechRecognition;
  return candidate || null;
}

function stopStreamTracks(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function isMicrophonePermissionDenied(error: unknown): boolean {
  if (error instanceof DOMException) {
    return (
      error.name === "NotAllowedError" ||
      error.name === "PermissionDeniedError" ||
      error.name === "SecurityError"
    );
  }

  const message = (error instanceof Error ? error.message : String(error || "")).toLowerCase();
  return (
    message.includes("notallowederror") ||
    message.includes("permission denied") ||
    message.includes("microphone access") ||
    message.includes("the request is not allowed")
  );
}

async function queryMicrophonePermissionState(): Promise<MicrophoneAccessState> {
  const permissionsApi = (navigator as Navigator & {
    permissions?: {
      query?: (descriptor: PermissionDescriptor) => Promise<{ state?: string }>;
    };
  }).permissions;

  if (typeof permissionsApi?.query !== "function") {
    return "unknown";
  }

  try {
    const status = await permissionsApi.query({
      name: "microphone" as PermissionName,
    });
    if (status.state === "granted") return "granted";
    if (status.state === "denied") return "denied";
  } catch {
    return "unknown";
  }

  return "unknown";
}

async function probeMicrophoneAccess(): Promise<MicrophoneAccessState> {
  if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
    return "unavailable";
  }

  const permissionState = await queryMicrophonePermissionState();
  if (permissionState === "denied") {
    return "denied";
  }

  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return "granted";
  } catch (error) {
    if (isMicrophonePermissionDenied(error)) {
      return "denied";
    }
    return permissionState === "granted" ? "granted" : "unknown";
  } finally {
    stopStreamTracks(stream);
  }
}

function localVoiceFailureMessage(
  kind:
    | VoiceFailureKind
    | "sidepanel_surface_blocked"
    | "page_activation_required"
): string {
  switch (kind) {
    case "permission_denied":
      return "Chrome blocked microphone access for ReplyMate on this page. Allow microphone access and try again.";
    case "sidepanel_surface_blocked":
      return "Chrome needs a click on the page before local voice can start from this composer.";
    case "page_activation_required":
      return "Click the on-page voice button to start local voice capture.";
    case "speech_api_blocked":
      return "Browser-local speech recognition is blocked or unsupported on this page.";
    case "local_start_failed":
      return "ReplyMate could not start local voice capture on this page.";
    case "empty_capture":
      return "No speech was captured from the local voice path.";
    case "insert_failed":
      return "ReplyMate captured speech but could not insert it into the composer.";
    case "remote_blocked":
      return "Remote transcription is blocked by the current cost mode and settings.";
    case "speech_api_error":
    default:
      return "Browser-local speech recognition failed before a usable transcript was produced.";
  }
}

function createFloatingButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.setAttribute("aria-label", label);
  button.style.position = "fixed";
  button.style.display = "none";
  button.style.padding = "8px 12px";
  button.style.borderRadius = "999px";
  button.style.border = "1px solid rgba(139, 92, 246, 0.45)";
  button.style.background = "rgba(15, 23, 42, 0.96)";
  button.style.color = "#ffffff";
  button.style.fontSize = "12px";
  button.style.fontWeight = "600";
  button.style.cursor = "pointer";
  button.style.zIndex = "2147483646";
  button.style.boxShadow = "0 10px 24px rgba(15, 23, 42, 0.3)";
  button.style.lineHeight = "1.2";
  document.documentElement.appendChild(button);
  return button;
}

function positionButton(button: HTMLButtonElement, anchor: Element | null): void {
  if (!(anchor instanceof HTMLElement)) {
    button.style.display = "none";
    return;
  }

  const rect = anchor.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) {
    button.style.display = "none";
    return;
  }

  button.style.top = `${Math.round(Math.max(8, rect.top - 42))}px`;
  button.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - 220, rect.right - 180)))}px`;
  button.style.display = "block";
}

export function createPageVoiceBridge(deps: PageVoiceBridgeDeps) {
  let state: VoiceBridgeState | null = null;
  let pageClickButton: HTMLButtonElement | null = null;

  function ensurePageClickButton(): HTMLButtonElement {
    if (pageClickButton) return pageClickButton;

    const button = createFloatingButton("Click to start voice");
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const current = state;
      if (!current) return;
      hidePageClickButton();
      void startRecognitionAttempt(current, { fromPageClick: true });
    });
    window.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange);
    pageClickButton = button;
    return button;
  }

  function hidePageClickButton(): void {
    if (!pageClickButton) return;
    pageClickButton.style.display = "none";
  }

  function removePageClickButton(): void {
    if (!pageClickButton) return;
    window.removeEventListener("scroll", handleViewportChange, true);
    window.removeEventListener("resize", handleViewportChange);
    pageClickButton.remove();
    pageClickButton = null;
  }

  function handleViewportChange(): void {
    if (!pageClickButton) return;
    positionButton(pageClickButton, deps.getAnchorElement());
  }

  function emit(event: LocalVoiceEvent): void {
    deps.sendEvent(event);
  }

  function clearAutoStopTimer(current: VoiceBridgeState | null): void {
    if (!current?.autoStopTimer) return;
    window.clearTimeout(current.autoStopTimer);
    current.autoStopTimer = null;
  }

  function resetState(): void {
    if (state?.recognition) {
      state.recognition.onresult = null;
      state.recognition.onerror = null;
      state.recognition.onend = null;
      try {
        state.recognition.stop();
      } catch {
        // Ignore teardown failures during reset.
      }
    }

    clearAutoStopTimer(state);
    state = null;
    removePageClickButton();
  }

  function emitFailure(
    current: VoiceBridgeState,
    failureKind:
      | VoiceFailureKind
      | "sidepanel_surface_blocked"
      | "page_activation_required"
  ): void {
    clearAutoStopTimer(current);
    current.failureHandled = true;
    current.recognition = null;
    emit({
      sessionId: current.sessionId,
      target: current.target,
      kind: "error",
      failureKind,
      message: localVoiceFailureMessage(failureKind),
    });
  }

  function promptForPageClick(current: VoiceBridgeState): void {
    current.failureHandled = true;
    current.recognition = null;
    current.waitingForClick = true;
    const button = ensurePageClickButton();
    positionButton(button, deps.getAnchorElement());
    emit({
      sessionId: current.sessionId,
      target: current.target,
      kind: "awaiting_page_click",
      failureKind: current.pageClickUsed
        ? "page_activation_required"
        : "sidepanel_surface_blocked",
      message: localVoiceFailureMessage("page_activation_required"),
    });
  }

  async function startRecognitionAttempt(
    current: VoiceBridgeState,
    options: StartAttemptOptions
  ): Promise<void> {
    const Recognition = getSpeechRecognitionCtor();
    if (!Recognition) {
      emitFailure(current, "speech_api_blocked");
      return;
    }

    current.failureHandled = false;
    current.transcript = "";
    current.audioStarted = false;
    current.speechStarted = false;
    current.waitingForClick = false;
    current.pageClickUsed = options.fromPageClick;
    clearAutoStopTimer(current);

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onspeechstart = () => {
      if (state !== current) return;
      current.speechStarted = true;
    };
    recognition.onaudiostart = () => {
      if (state !== current) return;
      current.audioStarted = true;
    };
    recognition.onspeechend = () => undefined;
    recognition.onaudioend = () => undefined;
    recognition.onnomatch = () => undefined;
    recognition.onresult = (event) => {
      if (state !== current) return;
      const segments: string[] = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) {
          segments.push(result[0].transcript);
        }
      }
      if (segments.length > 0) {
        current.transcript = `${current.transcript} ${segments.join(" ")}`.trim();
      }
    };
    recognition.onerror = (event) => {
      if (state !== current) return;
      const failureKind = classifySpeechFailure(
        event.error,
        current.microphoneAccess
      );
      const needsPageClick =
        !options.fromPageClick &&
        failureKind === "speech_api_blocked" &&
        current.microphoneAccess !== "denied";

      if (needsPageClick) {
        promptForPageClick(current);
        return;
      }

      emitFailure(current, failureKind);
    };
    recognition.onend = () => {
      if (state !== current) return;
      if (current.failureHandled) {
        return;
      }

      current.recognition = null;
      clearAutoStopTimer(current);
      const transcript = current.transcript.trim();
      if (!transcript) {
        const elapsed = current.startedAtMs ? Date.now() - current.startedAtMs : 0;
        const looksLikeStartFailure =
          !current.audioStarted && !current.speechStarted && elapsed <= 1_500;
        if (looksLikeStartFailure && !options.fromPageClick) {
          promptForPageClick(current);
          return;
        }

        emitFailure(current, looksLikeStartFailure ? "local_start_failed" : "empty_capture");
        return;
      }

      emit({
        sessionId: current.sessionId,
        target: current.target,
        kind: "transcribing",
      });
      emit({
        sessionId: current.sessionId,
        target: current.target,
        kind: "transcript_ready",
        transcript,
      });
      resetState();
    };

    current.startedAtMs = Date.now();
    current.startedAtIso = new Date(current.startedAtMs).toISOString();
    current.recognition = recognition;
    current.autoStopTimer = window.setTimeout(() => {
      if (state !== current) return;
      try {
        recognition.stop();
      } catch {
        emitFailure(current, "local_start_failed");
      }
    }, MAX_RECORDING_MS);

    try {
      recognition.start();
      emit({
        sessionId: current.sessionId,
        target: current.target,
        kind: "recording",
        startedAt: current.startedAtIso,
      });
    } catch {
      current.recognition = null;
      clearAutoStopTimer(current);
      if (!options.fromPageClick) {
        promptForPageClick(current);
        return;
      }
      emitFailure(current, "local_start_failed");
    }
  }

  async function start(payload: StartVoicePayload): Promise<void> {
    resetState();
    state = {
      sessionId: payload.sessionId,
      target: payload.target,
      microphoneAccess: "unknown",
      recognition: null,
      transcript: "",
      startedAtMs: 0,
      startedAtIso: "",
      audioStarted: false,
      speechStarted: false,
      failureHandled: false,
      waitingForClick: false,
      pageClickUsed: false,
      autoStopTimer: null,
    };

    emit({
      sessionId: payload.sessionId,
      target: payload.target,
      kind: "requesting_permission",
    });

    const microphoneAccess = await probeMicrophoneAccess();
    if (!state || state.sessionId !== payload.sessionId) {
      return;
    }

    state.microphoneAccess = microphoneAccess;
    if (microphoneAccess === "denied") {
      emitFailure(state, "permission_denied");
      return;
    }

    await startRecognitionAttempt(state, { fromPageClick: false });
  }

  function stop(sessionId?: string): void {
    if (!state) return;
    if (sessionId && state.sessionId !== sessionId) return;

    hidePageClickButton();
    if (state.recognition) {
      try {
        state.recognition.stop();
      } catch {
        emitFailure(state, "local_start_failed");
      }
      return;
    }

    emit({
      sessionId: state.sessionId,
      target: state.target,
      kind: "stopped",
    });
    resetState();
  }

  return {
    start,
    stop,
    clear: resetState,
    repositionPrompt: handleViewportChange,
  };
}
