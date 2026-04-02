import type {
  AccountPreferences,
  AccountSummary,
  GenerationRecordSummary,
} from "@replymate/contracts";
import type {
  AccountSeed,
  GenerationRecordInput,
  PersistedEvidenceJob,
  PersistedSession,
} from "./types.js";

export interface HostedStateRepository {
  upsertAccount(seed: AccountSeed): Promise<AccountSummary>;
  getAccount(accountId: string): Promise<AccountSummary | null>;
  findAccountByEmail(email: string): Promise<AccountSummary | null>;
  createSession(input: Omit<PersistedSession, "updatedAt" | "lastUsedAt">): Promise<PersistedSession>;
  getSession(sessionId: string): Promise<PersistedSession | null>;
  getSessionByRefreshTokenHash(refreshTokenHash: string): Promise<PersistedSession | null>;
  touchSession(sessionId: string): Promise<void>;
  revokeSession(sessionId: string, revokedAt: string): Promise<void>;
  getAccountPreferences(accountId: string): Promise<AccountPreferences>;
  saveAccountPreferences(accountId: string, preferences: AccountPreferences): Promise<AccountPreferences>;
  createEvidenceJob(input: PersistedEvidenceJob): Promise<void>;
  getEvidenceJob(jobId: string): Promise<PersistedEvidenceJob | null>;
  updateEvidenceJob(
    jobId: string,
    patch: Partial<Omit<PersistedEvidenceJob, "jobId" | "accountId" | "createdAt">>
  ): Promise<PersistedEvidenceJob | null>;
  listIncompleteEvidenceJobs(): Promise<PersistedEvidenceJob[]>;
  appendGenerationRecord(input: GenerationRecordInput): Promise<void>;
  listGenerationRecords(accountId: string, limit?: number): Promise<GenerationRecordSummary[]>;
}
