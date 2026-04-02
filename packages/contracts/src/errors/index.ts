// =============================================================================
// Error Codes — TRD §22
// =============================================================================

export type ErrorCode =
  | "NO_COMPOSER"
  | "LOW_CONTEXT_CONFIDENCE"
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "EVIDENCE_PARSE_FAILED"
  | "MIC_PERMISSION_DENIED"
  | "VOICE_RECORDING_FAILED"
  | "VOICE_TRANSCRIPTION_FAILED"
  | "GENERATION_FAILED"
  | "INVALID_MODEL_OUTPUT"
  | "INSERT_FAILED"
  | "STALE_SESSION"
  | "RATE_LIMITED"
  | "COST_MODE_BLOCKED"
  | "TOKEN_EXPIRED"
  | "UPLOAD_TIMEOUT"
  | "GENERATION_TIMEOUT"
  | "BACKEND_UNREACHABLE"
  | "NETWORK_OFFLINE"
  | "CONTRACT_VERSION_MISMATCH"
  | "UNAUTHORIZED"
  | "DRAFT_PROVIDER_UNAVAILABLE"
  | "NO_THREAD_CONTEXT"
  | "PAYMENT_REQUIRED"
  | "SUBSCRIPTION_PAST_DUE"
  | "TRIAL_EXPIRED"
  | "BILLING_UNAVAILABLE";

/**
 * Human-readable error messages for each error code.
 * Used by the UI to display clear feedback — TRD §22.1.
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  NO_COMPOSER: "No active composer detected on this page.",
  LOW_CONTEXT_CONFIDENCE:
    "Page context capture is limited. You can still generate from your draft.",
  UNSUPPORTED_FILE_TYPE: "This file type is not supported.",
  FILE_TOO_LARGE: "This file exceeds the maximum size limit.",
  EVIDENCE_PARSE_FAILED: "Failed to process the uploaded file.",
  MIC_PERMISSION_DENIED:
    "Microphone access was denied. You can still type your input.",
  VOICE_RECORDING_FAILED: "Voice recording failed. Please try again.",
  VOICE_TRANSCRIPTION_FAILED: "Speech transcription failed. Please try again.",
  GENERATION_FAILED: "Draft generation failed. Please try again.",
  INVALID_MODEL_OUTPUT: "The AI returned an unexpected response. Please retry.",
  INSERT_FAILED: "Could not insert text into the composer. Try copy instead.",
  STALE_SESSION:
    "The composer changed since generation. Use copy to paste manually.",
  RATE_LIMITED: "Too many requests. Please wait a moment and try again.",
  COST_MODE_BLOCKED:
    "This action is blocked by the current cost mode or fallback policy.",
  TOKEN_EXPIRED: "Your authentication token has expired. Update it in settings.",
  UPLOAD_TIMEOUT: "File upload timed out. Please try again.",
  GENERATION_TIMEOUT: "Generation timed out. Please try again.",
  BACKEND_UNREACHABLE:
    "Cannot reach the backend server. Check your connection and settings.",
  NETWORK_OFFLINE: "You appear to be offline. Check your network connection.",
  CONTRACT_VERSION_MISMATCH:
    "Version mismatch between extension and backend. Please update.",
  UNAUTHORIZED: "Unauthorized. Check your API token in settings.",
  DRAFT_PROVIDER_UNAVAILABLE:
    "No usable drafting provider is ready. Check your local model runtime and backend configuration.",
  NO_THREAD_CONTEXT:
    "No thread context was captured for this Slack thread. You can still improve the current draft.",
  PAYMENT_REQUIRED:
    "A paid ReplyMate subscription is required for this hosted feature.",
  SUBSCRIPTION_PAST_DUE:
    "Your ReplyMate subscription payment is past due. Update billing to continue.",
  TRIAL_EXPIRED:
    "Your ReplyMate trial has ended. Upgrade to continue using hosted features.",
  BILLING_UNAVAILABLE:
    "Billing is temporarily unavailable. Please try again shortly.",
};
