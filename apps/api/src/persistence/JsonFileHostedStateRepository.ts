import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AccountPreferences,
  AccountSummary,
  GenerationRecordSummary,
} from "@replymate/contracts";
import type { HostedStateRepository } from "./HostedStateRepository.js";
import type {
  AccountSeed,
  GenerationRecordInput,
  HostedStateData,
  PersistedAccount,
  PersistedAccountPreferences,
  PersistedEvidenceJob,
  PersistedSession,
} from "./types.js";

function createEmptyState(): HostedStateData {
  return {
    accounts: {},
    sessions: {},
    accountPreferences: {},
    evidenceJobs: {},
    generationRecords: {},
  };
}

export class JsonFileHostedStateRepository implements HostedStateRepository {
  private state: HostedStateData = createEmptyState();

  private loadPromise: Promise<void>;

  private writeQueue = Promise.resolve();

  constructor(private readonly filePath: string) {
    this.loadPromise = this.load();
  }

  async upsertAccount(seed: AccountSeed): Promise<AccountSummary> {
    await this.loadPromise;
    return this.mutate(() => {
      const now = new Date().toISOString();
      const existing = this.state.accounts[seed.accountId];
      const next: PersistedAccount = {
        ...seed,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      this.state.accounts[seed.accountId] = next;
      return toAccountSummary(next);
    });
  }

  async getAccount(accountId: string): Promise<AccountSummary | null> {
    await this.loadPromise;
    const account = this.state.accounts[accountId];
    return account ? toAccountSummary(account) : null;
  }

  async findAccountByEmail(email: string): Promise<AccountSummary | null> {
    await this.loadPromise;
    const normalized = email.trim().toLowerCase();
    const account = Object.values(this.state.accounts).find(
      (candidate) => candidate.email.trim().toLowerCase() === normalized
    );
    return account ? toAccountSummary(account) : null;
  }

  async createSession(
    input: Omit<PersistedSession, "updatedAt" | "lastUsedAt">
  ): Promise<PersistedSession> {
    await this.loadPromise;
    return this.mutate(() => {
      const now = new Date().toISOString();
      const session: PersistedSession = {
        ...input,
        updatedAt: now,
        lastUsedAt: now,
      };
      this.state.sessions[input.sessionId] = session;
      return structuredClone(session);
    });
  }

  async getSession(sessionId: string): Promise<PersistedSession | null> {
    await this.loadPromise;
    const session = this.state.sessions[sessionId];
    return session ? structuredClone(session) : null;
  }

  async getSessionByRefreshTokenHash(refreshTokenHash: string): Promise<PersistedSession | null> {
    await this.loadPromise;
    const session = Object.values(this.state.sessions).find(
      (candidate) => candidate.refreshTokenHash === refreshTokenHash
    );
    return session ? structuredClone(session) : null;
  }

  async touchSession(sessionId: string): Promise<void> {
    await this.loadPromise;
    await this.mutate(() => {
      const current = this.state.sessions[sessionId];
      if (!current) {
        return;
      }
      const now = new Date().toISOString();
      current.lastUsedAt = now;
      current.updatedAt = now;
    });
  }

  async revokeSession(sessionId: string, revokedAt: string): Promise<void> {
    await this.loadPromise;
    await this.mutate(() => {
      const current = this.state.sessions[sessionId];
      if (!current) {
        return;
      }
      current.revokedAt = revokedAt;
      current.updatedAt = revokedAt;
    });
  }

  async getAccountPreferences(accountId: string): Promise<AccountPreferences> {
    await this.loadPromise;
    const existing = this.state.accountPreferences[accountId];
    return existing
      ? {
          defaultTonePreset: existing.defaultTonePreset,
          defaultCostMode: existing.defaultCostMode,
        }
      : {
          defaultTonePreset: "professional",
          defaultCostMode: "local_only",
        };
  }

  async saveAccountPreferences(
    accountId: string,
    preferences: AccountPreferences
  ): Promise<AccountPreferences> {
    await this.loadPromise;
    return this.mutate(() => {
      const next: PersistedAccountPreferences = {
        accountId,
        defaultTonePreset: preferences.defaultTonePreset,
        defaultCostMode: preferences.defaultCostMode,
        updatedAt: new Date().toISOString(),
      };
      this.state.accountPreferences[accountId] = next;
      return {
        defaultTonePreset: next.defaultTonePreset,
        defaultCostMode: next.defaultCostMode,
      };
    });
  }

  async createEvidenceJob(input: PersistedEvidenceJob): Promise<void> {
    await this.loadPromise;
    await this.mutate(() => {
      this.state.evidenceJobs[input.jobId] = structuredClone(input);
    });
  }

  async getEvidenceJob(jobId: string): Promise<PersistedEvidenceJob | null> {
    await this.loadPromise;
    const job = this.state.evidenceJobs[jobId];
    return job ? structuredClone(job) : null;
  }

  async updateEvidenceJob(
    jobId: string,
    patch: Partial<Omit<PersistedEvidenceJob, "jobId" | "accountId" | "createdAt">>
  ): Promise<PersistedEvidenceJob | null> {
    await this.loadPromise;
    return this.mutate(() => {
      const current = this.state.evidenceJobs[jobId];
      if (!current) {
        return null;
      }

      const next: PersistedEvidenceJob = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      this.state.evidenceJobs[jobId] = next;
      return structuredClone(next);
    });
  }

  async listIncompleteEvidenceJobs(): Promise<PersistedEvidenceJob[]> {
    await this.loadPromise;
    return Object.values(this.state.evidenceJobs)
      .filter((job) => job.state === "queued" || job.state === "processing")
      .map((job) => structuredClone(job));
  }

  async appendGenerationRecord(input: GenerationRecordInput): Promise<void> {
    await this.loadPromise;
    await this.mutate(() => {
      this.state.generationRecords[input.generationId] = structuredClone(input);
    });
  }

  async listGenerationRecords(
    accountId: string,
    limit = 25
  ): Promise<GenerationRecordSummary[]> {
    await this.loadPromise;
    return Object.values(this.state.generationRecords)
      .filter((record) => record.accountId === accountId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((record) => ({
        generationId: record.generationId,
        requestId: record.requestId,
        createdAt: record.createdAt,
        siteId: record.siteId,
        actionMode: record.actionMode,
        tonePreset: record.tonePreset,
        providerPath: record.providerPath,
        warningCount: record.warningCount,
        usedVoiceInput: record.usedVoiceInput,
        contextScopeUsed: record.contextScopeUsed,
        evidenceIdsUsed: [...record.evidenceIdsUsed],
        primaryDraft: record.primaryDraft,
        alternateDraft: record.alternateDraft,
      }));
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as HostedStateData;
      this.state = {
        ...createEmptyState(),
        ...parsed,
        accounts: parsed.accounts || {},
        sessions: parsed.sessions || {},
        accountPreferences: parsed.accountPreferences || {},
        evidenceJobs: parsed.evidenceJobs || {},
        generationRecords: parsed.generationRecords || {},
      };
    } catch {
      this.state = createEmptyState();
    }
  }

  private async mutate<T>(run: () => T): Promise<T> {
    const nextWrite = this.writeQueue.then(async () => {
      const result = run();
      await this.persist();
      return result;
    });
    this.writeQueue = nextWrite.then(
      () => undefined,
      () => undefined
    );
    return nextWrite;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(this.state, null, 2), "utf8");
    await rename(tempPath, this.filePath);
  }
}

function toAccountSummary(account: PersistedAccount): AccountSummary {
  return {
    accountId: account.accountId,
    email: account.email,
    plan: account.plan,
    subscriptionState: account.subscriptionState,
    betaAccess: account.betaAccess,
    displayName: account.displayName,
  };
}
