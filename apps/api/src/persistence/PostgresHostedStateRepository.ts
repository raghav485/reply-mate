import type {
  AccountPreferences,
  AccountSummary,
  GenerationRecordSummary,
} from "@replymate/contracts";
import type { Pool } from "pg";
import type { HostedStateRepository } from "./HostedStateRepository.js";
import type {
  AccountSeed,
  GenerationRecordInput,
  PersistedEvidenceJob,
  PersistedSession,
} from "./types.js";

type AccountRow = {
  account_id: string;
  email: string;
  plan: AccountSummary["plan"];
  subscription_state: AccountSummary["subscriptionState"];
  beta_access: boolean;
  display_name: string | null;
};

type SessionRow = {
  session_id: string;
  account_id: string;
  refresh_token_hash: string;
  refresh_expires_at: string;
  created_at: string;
  updated_at: string;
  last_used_at: string;
  revoked_at: string | null;
  user_agent: string | null;
};

type AccountPreferencesRow = {
  default_tone_preset: AccountPreferences["defaultTonePreset"];
  default_cost_mode: AccountPreferences["defaultCostMode"];
};

type EvidenceJobRow = {
  job_id: string;
  account_id: string;
  storage_key: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  mode: PersistedEvidenceJob["mode"];
  mention_in_reply: boolean;
  state: PersistedEvidenceJob["state"];
  created_at: string;
  updated_at: string;
  result_json: PersistedEvidenceJob["result"] | null;
  error_code: string | null;
};

type GenerationRecordRow = {
  generation_id: string;
  request_id: string;
  created_at: string;
  site_id: GenerationRecordSummary["siteId"];
  action_mode: GenerationRecordSummary["actionMode"];
  tone_preset: GenerationRecordSummary["tonePreset"];
  provider_path: GenerationRecordSummary["providerPath"];
  warning_count: number;
  used_voice_input: boolean;
  context_scope_used: GenerationRecordSummary["contextScopeUsed"];
  evidence_ids_used: string[];
  primary_draft: string;
  alternate_draft: string;
};

const DEFAULT_ACCOUNT_PREFERENCES: AccountPreferences = {
  defaultTonePreset: "professional",
  defaultCostMode: "local_only",
};

function toAccountSummary(row: AccountRow): AccountSummary {
  return {
    accountId: row.account_id,
    email: row.email,
    plan: row.plan,
    subscriptionState: row.subscription_state,
    betaAccess: row.beta_access,
    displayName: row.display_name || undefined,
  };
}

function toSession(row: SessionRow): PersistedSession {
  return {
    sessionId: row.session_id,
    accountId: row.account_id,
    refreshTokenHash: row.refresh_token_hash,
    refreshExpiresAt: row.refresh_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at || undefined,
    userAgent: row.user_agent || undefined,
  };
}

function toEvidenceJob(row: EvidenceJobRow): PersistedEvidenceJob {
  return {
    jobId: row.job_id,
    accountId: row.account_id,
    storageKey: row.storage_key,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    mode: row.mode,
    mentionInReply: row.mention_in_reply,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    result: row.result_json || undefined,
    errorCode: row.error_code || undefined,
  };
}

function toGenerationRecordSummary(row: GenerationRecordRow): GenerationRecordSummary {
  return {
    generationId: row.generation_id,
    requestId: row.request_id,
    createdAt: row.created_at,
    siteId: row.site_id,
    actionMode: row.action_mode,
    tonePreset: row.tone_preset,
    providerPath: row.provider_path,
    warningCount: Number(row.warning_count),
    usedVoiceInput: row.used_voice_input,
    contextScopeUsed: row.context_scope_used,
    evidenceIdsUsed: Array.isArray(row.evidence_ids_used) ? row.evidence_ids_used : [],
    primaryDraft: row.primary_draft,
    alternateDraft: row.alternate_draft,
  };
}

function hasOwn<T extends object>(value: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export class PostgresHostedStateRepository implements HostedStateRepository {
  constructor(private readonly pool: Pool) {}

  async upsertAccount(seed: AccountSeed): Promise<AccountSummary> {
    const result = await this.pool.query<AccountRow>(
      `
        INSERT INTO accounts (
          account_id,
          email,
          plan,
          subscription_state,
          beta_access,
          display_name,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
        ON CONFLICT (account_id) DO UPDATE
        SET
          email = EXCLUDED.email,
          plan = EXCLUDED.plan,
          subscription_state = EXCLUDED.subscription_state,
          beta_access = EXCLUDED.beta_access,
          display_name = EXCLUDED.display_name,
          updated_at = EXCLUDED.updated_at
        RETURNING
          account_id,
          email,
          plan,
          subscription_state,
          beta_access,
          display_name
      `,
      [
        seed.accountId,
        seed.email,
        seed.plan,
        seed.subscriptionState,
        seed.betaAccess,
        seed.displayName || null,
        new Date().toISOString(),
      ]
    );

    return toAccountSummary(result.rows[0]);
  }

  async getAccount(accountId: string): Promise<AccountSummary | null> {
    const result = await this.pool.query<AccountRow>(
      `
        SELECT
          account_id,
          email,
          plan,
          subscription_state,
          beta_access,
          display_name
        FROM accounts
        WHERE account_id = $1
      `,
      [accountId]
    );

    return result.rows[0] ? toAccountSummary(result.rows[0]) : null;
  }

  async findAccountByEmail(email: string): Promise<AccountSummary | null> {
    const result = await this.pool.query<AccountRow>(
      `
        SELECT
          account_id,
          email,
          plan,
          subscription_state,
          beta_access,
          display_name
        FROM accounts
        WHERE lower(email) = lower($1)
        LIMIT 1
      `,
      [email]
    );

    return result.rows[0] ? toAccountSummary(result.rows[0]) : null;
  }

  async createSession(
    input: Omit<PersistedSession, "updatedAt" | "lastUsedAt">
  ): Promise<PersistedSession> {
    const now = new Date().toISOString();
    const result = await this.pool.query<SessionRow>(
      `
        INSERT INTO sessions (
          session_id,
          account_id,
          refresh_token_hash,
          refresh_expires_at,
          created_at,
          updated_at,
          last_used_at,
          revoked_at,
          user_agent
        )
        VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8)
        RETURNING
          session_id,
          account_id,
          refresh_token_hash,
          refresh_expires_at,
          created_at,
          updated_at,
          last_used_at,
          revoked_at,
          user_agent
      `,
      [
        input.sessionId,
        input.accountId,
        input.refreshTokenHash,
        input.refreshExpiresAt,
        input.createdAt,
        now,
        input.revokedAt || null,
        input.userAgent || null,
      ]
    );

    return toSession(result.rows[0]);
  }

  async getSession(sessionId: string): Promise<PersistedSession | null> {
    const result = await this.pool.query<SessionRow>(
      `
        SELECT
          session_id,
          account_id,
          refresh_token_hash,
          refresh_expires_at,
          created_at,
          updated_at,
          last_used_at,
          revoked_at,
          user_agent
        FROM sessions
        WHERE session_id = $1
      `,
      [sessionId]
    );

    return result.rows[0] ? toSession(result.rows[0]) : null;
  }

  async getSessionByRefreshTokenHash(refreshTokenHash: string): Promise<PersistedSession | null> {
    const result = await this.pool.query<SessionRow>(
      `
        SELECT
          session_id,
          account_id,
          refresh_token_hash,
          refresh_expires_at,
          created_at,
          updated_at,
          last_used_at,
          revoked_at,
          user_agent
        FROM sessions
        WHERE refresh_token_hash = $1
      `,
      [refreshTokenHash]
    );

    return result.rows[0] ? toSession(result.rows[0]) : null;
  }

  async touchSession(sessionId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `
        UPDATE sessions
        SET
          last_used_at = $2,
          updated_at = $2
        WHERE session_id = $1
      `,
      [sessionId, now]
    );
  }

  async revokeSession(sessionId: string, revokedAt: string): Promise<void> {
    await this.pool.query(
      `
        UPDATE sessions
        SET
          revoked_at = $2,
          updated_at = $2
        WHERE session_id = $1
      `,
      [sessionId, revokedAt]
    );
  }

  async getAccountPreferences(accountId: string): Promise<AccountPreferences> {
    const result = await this.pool.query<AccountPreferencesRow>(
      `
        SELECT
          default_tone_preset,
          default_cost_mode
        FROM account_preferences
        WHERE account_id = $1
      `,
      [accountId]
    );

    if (!result.rows[0]) {
      return { ...DEFAULT_ACCOUNT_PREFERENCES };
    }

    return {
      defaultTonePreset: result.rows[0].default_tone_preset,
      defaultCostMode: result.rows[0].default_cost_mode,
    };
  }

  async saveAccountPreferences(
    accountId: string,
    preferences: AccountPreferences
  ): Promise<AccountPreferences> {
    const result = await this.pool.query<AccountPreferencesRow>(
      `
        INSERT INTO account_preferences (
          account_id,
          default_tone_preset,
          default_cost_mode,
          updated_at
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (account_id) DO UPDATE
        SET
          default_tone_preset = EXCLUDED.default_tone_preset,
          default_cost_mode = EXCLUDED.default_cost_mode,
          updated_at = EXCLUDED.updated_at
        RETURNING
          default_tone_preset,
          default_cost_mode
      `,
      [
        accountId,
        preferences.defaultTonePreset,
        preferences.defaultCostMode,
        new Date().toISOString(),
      ]
    );

    return {
      defaultTonePreset: result.rows[0].default_tone_preset,
      defaultCostMode: result.rows[0].default_cost_mode,
    };
  }

  async createEvidenceJob(input: PersistedEvidenceJob): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO evidence_jobs (
          job_id,
          account_id,
          storage_key,
          file_name,
          mime_type,
          size_bytes,
          mode,
          mention_in_reply,
          state,
          created_at,
          updated_at,
          result_json,
          error_code
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
      `,
      [
        input.jobId,
        input.accountId,
        input.storageKey,
        input.fileName,
        input.mimeType,
        input.sizeBytes,
        input.mode,
        input.mentionInReply,
        input.state,
        input.createdAt,
        input.updatedAt,
        input.result ? JSON.stringify(input.result) : null,
        input.errorCode || null,
      ]
    );
  }

  async getEvidenceJob(jobId: string): Promise<PersistedEvidenceJob | null> {
    const result = await this.pool.query<EvidenceJobRow>(
      `
        SELECT
          job_id,
          account_id,
          storage_key,
          file_name,
          mime_type,
          size_bytes,
          mode,
          mention_in_reply,
          state,
          created_at,
          updated_at,
          result_json,
          error_code
        FROM evidence_jobs
        WHERE job_id = $1
      `,
      [jobId]
    );

    return result.rows[0] ? toEvidenceJob(result.rows[0]) : null;
  }

  async updateEvidenceJob(
    jobId: string,
    patch: Partial<Omit<PersistedEvidenceJob, "jobId" | "accountId" | "createdAt">>
  ): Promise<PersistedEvidenceJob | null> {
    const updates: string[] = [];
    const values: Array<string | number | boolean | null> = [jobId];
    let parameterIndex = 2;

    const addUpdate = (column: string, value: string | number | boolean | null): void => {
      updates.push(`${column} = $${parameterIndex}`);
      values.push(value);
      parameterIndex += 1;
    };

    if (hasOwn(patch, "storageKey")) addUpdate("storage_key", patch.storageKey || null);
    if (hasOwn(patch, "fileName")) addUpdate("file_name", patch.fileName || null);
    if (hasOwn(patch, "mimeType")) addUpdate("mime_type", patch.mimeType || null);
    if (hasOwn(patch, "sizeBytes")) addUpdate("size_bytes", patch.sizeBytes ?? null);
    if (hasOwn(patch, "mode")) addUpdate("mode", patch.mode || null);
    if (hasOwn(patch, "mentionInReply")) {
      addUpdate("mention_in_reply", patch.mentionInReply ?? null);
    }
    if (hasOwn(patch, "state")) addUpdate("state", patch.state || null);
    if (hasOwn(patch, "result")) {
      updates.push(`result_json = $${parameterIndex}::jsonb`);
      values.push(patch.result ? JSON.stringify(patch.result) : null);
      parameterIndex += 1;
    }
    if (hasOwn(patch, "errorCode")) addUpdate("error_code", patch.errorCode || null);

    addUpdate("updated_at", new Date().toISOString());

    const result = await this.pool.query<EvidenceJobRow>(
      `
        UPDATE evidence_jobs
        SET ${updates.join(", ")}
        WHERE job_id = $1
        RETURNING
          job_id,
          account_id,
          storage_key,
          file_name,
          mime_type,
          size_bytes,
          mode,
          mention_in_reply,
          state,
          created_at,
          updated_at,
          result_json,
          error_code
      `,
      values
    );

    return result.rows[0] ? toEvidenceJob(result.rows[0]) : null;
  }

  async listIncompleteEvidenceJobs(): Promise<PersistedEvidenceJob[]> {
    const result = await this.pool.query<EvidenceJobRow>(
      `
        SELECT
          job_id,
          account_id,
          storage_key,
          file_name,
          mime_type,
          size_bytes,
          mode,
          mention_in_reply,
          state,
          created_at,
          updated_at,
          result_json,
          error_code
        FROM evidence_jobs
        WHERE state IN ('queued', 'processing')
        ORDER BY created_at ASC
      `
    );

    return result.rows.map(toEvidenceJob);
  }

  async appendGenerationRecord(input: GenerationRecordInput): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO generation_records (
          generation_id,
          account_id,
          request_id,
          created_at,
          site_id,
          action_mode,
          tone_preset,
          provider_path,
          warning_count,
          used_voice_input,
          context_scope_used,
          evidence_ids_used,
          primary_draft,
          alternate_draft
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14
        )
        ON CONFLICT (generation_id) DO UPDATE
        SET
          request_id = EXCLUDED.request_id,
          created_at = EXCLUDED.created_at,
          site_id = EXCLUDED.site_id,
          action_mode = EXCLUDED.action_mode,
          tone_preset = EXCLUDED.tone_preset,
          provider_path = EXCLUDED.provider_path,
          warning_count = EXCLUDED.warning_count,
          used_voice_input = EXCLUDED.used_voice_input,
          context_scope_used = EXCLUDED.context_scope_used,
          evidence_ids_used = EXCLUDED.evidence_ids_used,
          primary_draft = EXCLUDED.primary_draft,
          alternate_draft = EXCLUDED.alternate_draft
      `,
      [
        input.generationId,
        input.accountId,
        input.requestId,
        input.createdAt,
        input.siteId,
        input.actionMode,
        input.tonePreset,
        input.providerPath,
        input.warningCount,
        input.usedVoiceInput,
        input.contextScopeUsed,
        JSON.stringify(input.evidenceIdsUsed),
        input.primaryDraft,
        input.alternateDraft,
      ]
    );
  }

  async listGenerationRecords(
    accountId: string,
    limit = 25
  ): Promise<GenerationRecordSummary[]> {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : 25;
    const result = await this.pool.query<GenerationRecordRow>(
      `
        SELECT
          generation_id,
          request_id,
          created_at,
          site_id,
          action_mode,
          tone_preset,
          provider_path,
          warning_count,
          used_voice_input,
          context_scope_used,
          evidence_ids_used,
          primary_draft,
          alternate_draft
        FROM generation_records
        WHERE account_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [accountId, safeLimit]
    );

    return result.rows.map(toGenerationRecordSummary);
  }
}
