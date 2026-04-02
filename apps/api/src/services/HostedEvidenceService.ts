import { randomUUID } from "node:crypto";
import type {
  EvidenceJobStatus,
  EvidenceMode,
  EvidenceSummary,
  StorageProviderAdapter,
} from "@replymate/contracts";
import { ApiError } from "../core/errors.js";
import type { HostedStateRepository } from "../persistence/HostedStateRepository.js";

type ProcessInput = {
  fileData: Buffer;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  mode: EvidenceMode;
  mentionInReply: boolean;
};

function sanitizeKey(input: string): string {
  return input.replace(/[^a-zA-Z0-9/_-]+/g, "_");
}

export class HostedEvidenceService {
  constructor(
    private readonly repository: HostedStateRepository,
    private readonly storage: StorageProviderAdapter
  ) {}

  async createAsyncJob(input: {
    accountId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    mode: EvidenceMode;
    mentionInReply: boolean;
    fileData: Buffer;
  }): Promise<EvidenceJobStatus> {
    const jobId = `job_${randomUUID()}`;
    const storageKey = sanitizeKey(`evidence/${input.accountId}/${jobId}/${input.fileName}`);
    await this.storage.putTempObject({
      key: storageKey,
      data: input.fileData,
      mimeType: input.mimeType,
      ttlSeconds: 60 * 60 * 24 * 7,
    });
    await this.repository.createEvidenceJob({
      jobId,
      accountId: input.accountId,
      storageKey,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      mode: input.mode,
      mentionInReply: input.mentionInReply,
      state: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return {
      jobId,
      state: "processing",
    };
  }

  async getJobForAccount(jobId: string, accountId: string): Promise<EvidenceJobStatus> {
    const job = await this.repository.getEvidenceJob(jobId);
    if (!job || job.accountId !== accountId) {
      throw new ApiError({
        message: "Evidence job not found.",
        errorCode: "EVIDENCE_PARSE_FAILED",
        statusCode: 404,
      });
    }

    return {
      jobId: job.jobId,
      state: job.state,
      result: job.result,
      errorCode: job.errorCode,
    };
  }

  async processJob(
    jobId: string,
    processor: (input: ProcessInput) => Promise<EvidenceSummary>
  ): Promise<void> {
    const job = await this.repository.getEvidenceJob(jobId);
    if (!job) {
      return;
    }

    await this.repository.updateEvidenceJob(jobId, { state: "processing" });
    try {
      const object = await this.storage.getTempObject(job.storageKey);
      if (!object) {
        throw new Error("Evidence file is no longer available.");
      }

      const summary = await processor({
        fileData: object.data,
        fileName: job.fileName,
        mimeType: job.mimeType,
        sizeBytes: job.sizeBytes,
        mode: job.mode,
        mentionInReply: job.mentionInReply,
      });

      await this.repository.updateEvidenceJob(jobId, {
        state: "ready",
        result: summary,
        errorCode: undefined,
      });
    } catch (error) {
      await this.repository.updateEvidenceJob(jobId, {
        state: "failed",
        errorCode: "EVIDENCE_PARSE_FAILED",
      });
      throw error;
    }
  }

  async resumeIncompleteJobs(
    processor: (input: ProcessInput) => Promise<EvidenceSummary>
  ): Promise<void> {
    const jobs = await this.repository.listIncompleteEvidenceJobs();
    await Promise.all(
      jobs.map(async (job) => {
        try {
          await this.processJob(job.jobId, processor);
        } catch {
          // Job state is updated inside processJob.
        }
      })
    );
  }
}
