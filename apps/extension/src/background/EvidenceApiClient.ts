import type { EvidenceJobStatus, EvidenceSummary } from "@replymate/contracts";
import { ApiClientError } from "../shared-client/ApiClient.js";

type RequestOptions = {
  timeoutMs?: number;
};

type EvidenceHttpClient = {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  postMultipart<T>(
    path: string,
    formData: FormData,
    options?: RequestOptions
  ): Promise<T>;
};

type EvidenceIngestSyncResponse = {
  apiVersion: string;
  mode: "sync";
  result: EvidenceSummary;
};

type EvidenceIngestAsyncResponse = {
  apiVersion: string;
  mode: "async";
  job: EvidenceJobStatus;
};

export type EvidenceIngestResponse =
  | EvidenceIngestSyncResponse
  | EvidenceIngestAsyncResponse;

type EvidenceJobResponse = {
  apiVersion: string;
  job: EvidenceJobStatus;
};

const EVIDENCE_INGEST_TIMEOUT_MS = 120_000;
const EVIDENCE_JOB_TIMEOUT_MS = 120_000;
const EVIDENCE_POLL_ATTEMPTS = 53;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeEvidenceApiError(error: unknown): Error {
  if (error instanceof ApiClientError) {
    if (error.status === 408 || error.errorCode === "REQUEST_TIMEOUT") {
      return new ApiClientError(
        "Request timed out while waiting for evidence processing.",
        408,
        "REQUEST_TIMEOUT"
      );
    }

    return error;
  }

  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && /abort/i.test(error.message))
  ) {
    return new ApiClientError(
      "Request timed out while waiting for evidence processing.",
      408,
      "REQUEST_TIMEOUT"
    );
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(typeof error === "string" ? error : String(error));
}

export class EvidenceApiClient {
  constructor(private readonly apiClient: EvidenceHttpClient) {}

  async ingest(formData: FormData): Promise<EvidenceIngestResponse> {
    try {
      return await this.apiClient.postMultipart<EvidenceIngestResponse>(
        "/v1/evidence/ingest",
        formData,
        { timeoutMs: EVIDENCE_INGEST_TIMEOUT_MS }
      );
    } catch (error) {
      throw normalizeEvidenceApiError(error);
    }
  }

  async waitForSummary(
    jobId: string,
    onPoll?: (attempt: number, jobId: string) => void
  ): Promise<EvidenceSummary> {
    for (let attempt = 0; attempt < EVIDENCE_POLL_ATTEMPTS; attempt += 1) {
      onPoll?.(attempt + 1, jobId);

      let jobResponse: EvidenceJobResponse;
      try {
        jobResponse = await this.apiClient.get<EvidenceJobResponse>(
          `/v1/evidence/jobs/${jobId}`,
          { timeoutMs: EVIDENCE_JOB_TIMEOUT_MS }
        );
      } catch (error) {
        throw normalizeEvidenceApiError(error);
      }

      const { job } = jobResponse;
      if (job.state === "ready" && job.result) {
        return job.result;
      }

      if (job.state === "failed") {
        throw new ApiClientError(
          "Evidence parsing failed.",
          422,
          job.errorCode || "EVIDENCE_PARSE_FAILED"
        );
      }

      await sleep(attempt < 15 ? 1_000 : 2_000);
    }

    throw new ApiClientError(
      "Request timed out while waiting for evidence processing.",
      408,
      "REQUEST_TIMEOUT"
    );
  }
}
