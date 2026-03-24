import { describe, expect, it } from "vitest";
import {
  canRetryRemoteTranscription,
  chooseVoiceStartMode,
  classifySpeechFailure,
  formatVoiceFailureMessage,
  resolveRemoteRetryMode,
} from "../voicePolicy.js";

describe("voicePolicy", () => {
  it("uses local speech in local_only mode when available", () => {
    expect(
      chooseVoiceStartMode({
        costMode: "local_only",
        localSpeechAvailable: true,
        allowHybridFallback: false,
      })
    ).toEqual({ kind: "local" });
  });

  it("blocks local_only mode when local speech is unavailable", () => {
    expect(
      chooseVoiceStartMode({
        costMode: "local_only",
        localSpeechAvailable: false,
        allowHybridFallback: true,
      })
    ).toEqual({
      kind: "blocked",
      reason: "Browser-local speech recognition is unavailable in local_only mode.",
    });
  });

  it("prefers local speech in hybrid mode when available", () => {
    expect(
      chooseVoiceStartMode({
        costMode: "hybrid_low_cost",
        localSpeechAvailable: true,
        allowHybridFallback: true,
      })
    ).toEqual({ kind: "local" });
  });

  it("requires explicit confirmation before hybrid remote fallback", () => {
    expect(
      chooseVoiceStartMode({
        costMode: "hybrid_low_cost",
        localSpeechAvailable: false,
        allowHybridFallback: true,
      })
    ).toEqual({
      kind: "confirm_remote",
      reason:
        "Browser-local speech recognition is unavailable. Use remote transcription for this voice note?",
    });
  });

  it("blocks hybrid remote fallback when the setting is disabled", () => {
    expect(
      chooseVoiceStartMode({
        costMode: "hybrid_low_cost",
        localSpeechAvailable: false,
        allowHybridFallback: false,
      })
    ).toEqual({
      kind: "blocked",
      reason: "Enable hybrid voice fallback in settings before using remote transcription.",
    });
  });

  it("uses remote transcription in cloud_quality mode", () => {
    expect(
      chooseVoiceStartMode({
        costMode: "cloud_quality",
        localSpeechAvailable: true,
        allowHybridFallback: false,
      })
    ).toEqual({ kind: "remote" });
  });

  it("allows one-shot remote retry through hybrid mode when local_only is selected", () => {
    expect(
      resolveRemoteRetryMode({
        costMode: "local_only",
        defaultCostMode: "local_only",
        allowHybridFallback: true,
        browserRecordingAvailable: true,
      })
    ).toBe("hybrid_low_cost");
  });

  it("blocks remote retry when recording is unavailable", () => {
    expect(
      resolveRemoteRetryMode({
        costMode: "local_only",
        defaultCostMode: "cloud_quality",
        allowHybridFallback: true,
        browserRecordingAvailable: false,
      })
    ).toBeNull();
  });

  it("treats not-allowed as speech API blocked when mic access was not denied", () => {
    expect(classifySpeechFailure("not-allowed", "granted")).toBe("speech_api_blocked");
    expect(classifySpeechFailure("service-not-allowed", "unknown")).toBe(
      "speech_api_blocked"
    );
  });

  it("treats not-allowed as permission denied when mic access was denied", () => {
    expect(classifySpeechFailure("not-allowed", "denied")).toBe("permission_denied");
  });

  it("limits remote retry for failure kinds that still need local capture", () => {
    expect(canRetryRemoteTranscription("permission_denied", true, "hybrid_low_cost")).toBe(
      false
    );
    expect(canRetryRemoteTranscription("speech_api_blocked", true, "hybrid_low_cost")).toBe(
      true
    );
  });

  it("formats speech API blocked message differently when remote retry is unavailable", () => {
    expect(formatVoiceFailureMessage("speech_api_blocked", true)).toContain(
      "Retry with remote transcription"
    );
    expect(formatVoiceFailureMessage("speech_api_blocked", false)).toContain(
      "Remote transcription is disabled by local_only"
    );
  });
});
