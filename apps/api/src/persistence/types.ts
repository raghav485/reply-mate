import type {
  AccountPlan,
  AccountPreferences,
  AccountSummary,
  ActionMode,
  ContextScope,
  GenerationRecordSummary,
  SiteId,
  SubscriptionState,
  TonePreset,
} from "@replymate/contracts";

export type PersistedAccount = AccountSummary & {
  createdAt: string;
  updatedAt: string;
};

export type PersistedSession = {
  sessionId: string;
  accountId: string;
  refreshTokenHash: string;
  refreshExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
  revokedAt?: string;
  userAgent?: string;
};

export type PersistedAccountPreferences = AccountPreferences & {
  accountId: string;
  updatedAt: string;
};

export type PersistedEvidenceJob = {
  jobId: string;
  accountId: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  mode: import("@replymate/contracts").EvidenceMode;
  mentionInReply: boolean;
  state: "queued" | "processing" | "ready" | "failed";
  createdAt: string;
  updatedAt: string;
  result?: import("@replymate/contracts").EvidenceSummary;
  errorCode?: string;
};

export type PersistedGenerationRecord = GenerationRecordSummary & {
  accountId: string;
};

export type HostedStateData = {
  accounts: Record<string, PersistedAccount>;
  sessions: Record<string, PersistedSession>;
  accountPreferences: Record<string, PersistedAccountPreferences>;
  evidenceJobs: Record<string, PersistedEvidenceJob>;
  generationRecords: Record<string, PersistedGenerationRecord>;
};

export type AccountSeed = {
  accountId: string;
  email: string;
  plan: AccountPlan;
  subscriptionState: SubscriptionState;
  betaAccess: boolean;
  displayName?: string;
};

export type GenerationRecordInput = {
  generationId: string;
  accountId: string;
  requestId: string;
  createdAt: string;
  siteId: SiteId;
  actionMode: ActionMode;
  tonePreset: TonePreset;
  providerPath: "local_model" | "cloud";
  warningCount: number;
  usedVoiceInput: boolean;
  contextScopeUsed: ContextScope;
  evidenceIdsUsed: string[];
  primaryDraft: string;
  alternateDraft: string;
};
