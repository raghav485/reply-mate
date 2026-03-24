import type {
  TranscriptionProviderAdapter,
  TranscriptionRequest,
  TranscriptionResponse,
} from "@replymate/contracts";
import { ProviderError } from "../core/errors.js";

export class LocalTranscriptionProviderAdapter implements TranscriptionProviderAdapter {
  async transcribeAudio(input: TranscriptionRequest): Promise<TranscriptionResponse> {
    const sizeBytes = input.audioBlob.size;

    if (sizeBytes <= 0) {
      throw new ProviderError({
        message: "Audio payload is empty.",
        errorCode: "VOICE_TRANSCRIPTION_FAILED",
        retryable: false,
        statusCode: 400,
      });
    }

    const estimatedSeconds = Math.max(1, Math.round(sizeBytes / 32000));
    const languagePrefix = input.languageHint?.trim()
      ? `[${input.languageHint.trim()}] `
      : "";

    return {
      transcript:
        `${languagePrefix}Transcribed voice note (${estimatedSeconds}s, ${input.mimeType}). ` +
        "Review wording before sending.",
      confidence: 0.79,
    };
  }
}
