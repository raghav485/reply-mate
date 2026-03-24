import { ApiClientError } from "../shared-client/ApiClient.js";

export type SerializedEvidenceError = {
  message: string;
  errorCode?: string;
  status?: number;
  name?: string;
  rawType: string;
};

export type EvidenceIngestFailure = SerializedEvidenceError & {
  expected: boolean;
  logMessage: string;
  userMessage: string;
};

const EXPECTED_EVIDENCE_MESSAGES = new Set([
  "EVIDENCE_PARSE_FAILED",
  "FILE_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "REQUEST_TIMEOUT",
]);

export function serializeUnknownError(error: unknown): SerializedEvidenceError {
  if (error instanceof ApiClientError) {
    return {
      message: error.message,
      errorCode: error.errorCode,
      status: error.status,
      name: error.name,
      rawType: "ApiClientError",
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      rawType: error.constructor?.name || "Error",
    };
  }

  if (error && typeof error === "object") {
    const candidate = error as {
      message?: unknown;
      error?: unknown;
      errorCode?: unknown;
      status?: unknown;
      name?: unknown;
    };
    const message =
      typeof candidate.message === "string"
        ? candidate.message
        : typeof candidate.error === "string"
          ? candidate.error
          : "Unknown error object";

    return {
      message,
      errorCode:
        typeof candidate.errorCode === "string" ? candidate.errorCode : undefined,
      status: typeof candidate.status === "number" ? candidate.status : undefined,
      name: typeof candidate.name === "string" ? candidate.name : undefined,
      rawType: "object",
    };
  }

  return {
    message: typeof error === "string" ? error : String(error),
    rawType: typeof error,
  };
}

export function isExpectedEvidenceIngestError(error: unknown): boolean {
  if (error instanceof ApiClientError) {
    return true;
  }

  const serialized = serializeUnknownError(error);
  if (serialized.status === 408) {
    return true;
  }
  if (serialized.errorCode && EXPECTED_EVIDENCE_MESSAGES.has(serialized.errorCode)) {
    return true;
  }

  return (
    EXPECTED_EVIDENCE_MESSAGES.has(serialized.message) ||
    /timeout/i.test(serialized.message) ||
    /abort/i.test(serialized.message) ||
    /signal is aborted without reason/i.test(serialized.message) ||
    /the user aborted a request/i.test(serialized.message)
  );
}

export function buildEvidenceIngestFailure(error: unknown): EvidenceIngestFailure {
  const serialized = serializeUnknownError(error);
  const expected = isExpectedEvidenceIngestError(error);
  const detail = serialized.status
    ? `API ${serialized.status}${serialized.errorCode ? ` ${serialized.errorCode}` : ""}`
    : serialized.errorCode || serialized.message;

  return {
    ...serialized,
    expected,
    logMessage: expected
      ? `Evidence ingest failed: ${detail}`
      : `Evidence ingest failed unexpectedly: ${detail}`,
    userMessage:
      serialized.message ||
      serialized.errorCode ||
      "Failed to ingest evidence.",
  };
}
