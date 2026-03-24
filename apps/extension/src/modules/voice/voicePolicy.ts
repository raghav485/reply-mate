import type { CostMode } from "@replymate/contracts";

export type MicrophoneAccessState =
  | "granted"
  | "denied"
  | "unavailable"
  | "unknown";

export type VoiceFailureKind =
  | "permission_denied"
  | "sidepanel_surface_blocked"
  | "page_activation_required"
  | "speech_api_blocked"
  | "local_start_failed"
  | "speech_api_error"
  | "empty_capture"
  | "remote_blocked"
  | "insert_failed";

export type VoiceStartDecision =
  | { kind: "local" }
  | { kind: "remote" }
  | { kind: "confirm_remote"; reason: string }
  | { kind: "blocked"; reason: string };

export function classifySpeechFailure(
  error: string | undefined,
  microphoneAccess: MicrophoneAccessState
): VoiceFailureKind {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return microphoneAccess === "denied"
        ? "permission_denied"
        : "speech_api_blocked";
    case "no-speech":
    case "audio-capture":
      return "empty_capture";
    default:
      return "speech_api_error";
  }
}

export function canRetryRemoteTranscription(
  kind: VoiceFailureKind | null,
  hasSession: boolean,
  remoteRetryMode: CostMode | null
): boolean {
  if (!kind || !hasSession || !remoteRetryMode) {
    return false;
  }

  return (
    kind !== "permission_denied" &&
    kind !== "sidepanel_surface_blocked" &&
    kind !== "page_activation_required" &&
    kind !== "remote_blocked" &&
    kind !== "insert_failed"
  );
}

export function formatVoiceFailureMessage(
  kind: VoiceFailureKind,
  canRetryRemotely: boolean
): string {
  switch (kind) {
    case "permission_denied":
      return "Chrome blocked microphone access for ReplyMate. Allow microphone access for the side panel and try again.";
    case "sidepanel_surface_blocked":
      return "Chrome would not start local voice directly from the side panel. Use the on-page voice button to continue.";
    case "page_activation_required":
      return "Chrome requires a click on the page before local voice can start. Use the on-page voice button to continue.";
    case "speech_api_blocked":
      return canRetryRemotely
        ? "Browser-local speech recognition is blocked or unsupported in this Chrome surface. Retry with remote transcription."
        : "Browser-local speech recognition is blocked or unsupported in this Chrome surface. Remote transcription is disabled by local_only. Switch cost mode in ReplyMate settings to use the fallback path.";
    case "local_start_failed":
      return canRetryRemotely
        ? "Browser-local speech recognition ended immediately before capturing audio. Try again or use remote transcription."
        : "Browser-local speech recognition ended immediately before capturing audio. Remote transcription is disabled by local_only. Switch cost mode in ReplyMate settings to use the fallback path.";
    case "speech_api_error":
      return canRetryRemotely
        ? "Browser-local speech recognition failed before a usable transcript was produced. Try again or use remote transcription."
        : "Browser-local speech recognition failed before a usable transcript was produced. Remote transcription is disabled by local_only. Switch cost mode in ReplyMate settings to use the fallback path.";
    case "empty_capture":
      return canRetryRemotely
        ? "No speech was captured from the local voice path. Try speaking more clearly or use remote transcription."
        : "No speech was captured from the local voice path. Try speaking more clearly. Remote transcription is disabled by local_only.";
    case "remote_blocked":
      return "Remote transcription is blocked by the current cost mode and settings.";
    case "insert_failed":
      return "ReplyMate captured speech but could not insert it into the composer.";
    default:
      return "Voice capture failed. Please try again.";
  }
}

export function resolveRemoteRetryMode(input: {
  costMode: CostMode;
  defaultCostMode: CostMode;
  allowHybridFallback: boolean;
  browserRecordingAvailable: boolean;
}): CostMode | null {
  const { costMode, defaultCostMode, allowHybridFallback, browserRecordingAvailable } = input;

  if (!browserRecordingAvailable) {
    return null;
  }

  if (costMode === "cloud_quality" || costMode === "hybrid_low_cost") {
    return costMode;
  }

  if (defaultCostMode === "cloud_quality") {
    return "cloud_quality";
  }

  return allowHybridFallback ? "hybrid_low_cost" : null;
}

export function chooseVoiceStartMode(input: {
  costMode: CostMode;
  localSpeechAvailable: boolean;
  allowHybridFallback: boolean;
}): VoiceStartDecision {
  const { costMode, localSpeechAvailable, allowHybridFallback } = input;

  if (costMode === "local_only") {
    return localSpeechAvailable
      ? { kind: "local" }
      : {
          kind: "blocked",
          reason: "Browser-local speech recognition is unavailable in local_only mode.",
        };
  }

  if (costMode === "cloud_quality") {
    return { kind: "remote" };
  }

  if (localSpeechAvailable) {
    return { kind: "local" };
  }

  if (!allowHybridFallback) {
    return {
      kind: "blocked",
      reason: "Enable hybrid voice fallback in settings before using remote transcription.",
    };
  }

  return {
    kind: "confirm_remote",
    reason:
      "Browser-local speech recognition is unavailable. Use remote transcription for this voice note?",
  };
}
