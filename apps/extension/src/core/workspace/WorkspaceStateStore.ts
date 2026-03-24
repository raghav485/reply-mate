import type {
  ActionMode,
  AdapterId,
  CostMode,
  EvidenceSummary,
  GenerateDraftResponse,
  SiteId,
  TonePreset,
} from "@replymate/contracts";

const STORAGE_KEY = "replymate:workspace-state:v1";
const MAX_WORKSPACES = 20;

export type PendingEvidenceState = {
  localId: string;
  name: string;
  state: "queued" | "processing" | "failed";
  error?: string;
  jobId?: string;
};

export type WorkspaceState = {
  workspaceKey: string;
  siteId?: SiteId;
  adapterId?: AdapterId;
  actionMode?: ActionMode;
  tonePreset?: TonePreset;
  costMode?: CostMode;
  instruction?: string;
  usedVoiceInput?: boolean;
  response?: GenerateDraftResponse | null;
  error?: string | null;
  evidence?: EvidenceSummary[];
  pendingEvidence?: PendingEvidenceState[];
  updatedAt: string;
};

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readEvidence(input: unknown): EvidenceSummary[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return input.filter((item): item is EvidenceSummary => isRecord(item));
}

function readPendingEvidence(input: unknown): PendingEvidenceState[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return input
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item): PendingEvidenceState => ({
      localId: typeof item.localId === "string" ? item.localId : "",
      name: typeof item.name === "string" ? item.name : "",
      state:
        item.state === "queued" || item.state === "processing" || item.state === "failed"
          ? item.state
          : "queued",
      error: typeof item.error === "string" ? item.error : undefined,
      jobId: typeof item.jobId === "string" ? item.jobId : undefined,
    }))
    .filter((item) => item.localId && item.name);
}

function normalizeWorkspaceState(input: unknown): WorkspaceState | null {
  if (!isRecord(input)) return null;
  const workspaceKey =
    typeof input.workspaceKey === "string" ? input.workspaceKey.trim() : "";
  if (!workspaceKey) return null;

  return {
    workspaceKey,
    siteId: typeof input.siteId === "string" ? (input.siteId as SiteId) : undefined,
    adapterId:
      typeof input.adapterId === "string" ? (input.adapterId as AdapterId) : undefined,
    actionMode:
      typeof input.actionMode === "string"
        ? (input.actionMode as ActionMode)
        : undefined,
    tonePreset:
      typeof input.tonePreset === "string"
        ? (input.tonePreset as TonePreset)
        : undefined,
    costMode:
      typeof input.costMode === "string" ? (input.costMode as CostMode) : undefined,
    instruction:
      typeof input.instruction === "string" ? input.instruction : undefined,
    usedVoiceInput:
      typeof input.usedVoiceInput === "boolean" ? input.usedVoiceInput : undefined,
    response: isRecord(input.response) || input.response === null
      ? (input.response as GenerateDraftResponse | null)
      : undefined,
    error:
      typeof input.error === "string" || input.error === null
        ? (input.error as string | null)
        : undefined,
    evidence: readEvidence(input.evidence),
    pendingEvidence: readPendingEvidence(input.pendingEvidence),
    updatedAt:
      typeof input.updatedAt === "string" && input.updatedAt
        ? input.updatedAt
        : new Date(0).toISOString(),
  };
}

export class WorkspaceStateStore {
  private states = new Map<string, WorkspaceState>();

  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    if (!chrome.storage?.session?.get) {
      return;
    }

    try {
      const result = await chrome.storage.session.get(STORAGE_KEY);
      const raw = result?.[STORAGE_KEY];
      if (!Array.isArray(raw)) {
        return;
      }

      for (const item of raw) {
        const normalized = normalizeWorkspaceState(item);
        if (normalized) {
          this.states.set(normalized.workspaceKey, normalized);
        }
      }
    } catch {
      this.states.clear();
    }
  }

  get(workspaceKey: string): WorkspaceState | null {
    const current = this.states.get(workspaceKey);
    return current ? cloneState(current) : null;
  }

  async savePartial(
    workspaceKey: string,
    patch: Partial<WorkspaceState>
  ): Promise<WorkspaceState> {
    const existing = this.states.get(workspaceKey);
    const next: WorkspaceState = {
      workspaceKey,
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    if (!next.evidence) {
      next.evidence = existing?.evidence ?? [];
    }
    if (!next.pendingEvidence) {
      next.pendingEvidence = existing?.pendingEvidence ?? [];
    }

    this.states.set(workspaceKey, next);
    await this.persist();
    return cloneState(next);
  }

  async setEvidence(
    workspaceKey: string,
    evidence: EvidenceSummary[]
  ): Promise<WorkspaceState> {
    return this.savePartial(workspaceKey, { evidence });
  }

  async setPendingEvidence(
    workspaceKey: string,
    pendingEvidence: PendingEvidenceState[]
  ): Promise<WorkspaceState> {
    return this.savePartial(workspaceKey, { pendingEvidence });
  }

  async clear(workspaceKey: string): Promise<void> {
    if (!this.states.delete(workspaceKey)) {
      return;
    }

    await this.persist();
  }

  private async persist(): Promise<void> {
    while (this.states.size > MAX_WORKSPACES) {
      const oldest = Array.from(this.states.values()).sort((a, b) =>
        a.updatedAt.localeCompare(b.updatedAt)
      )[0];
      if (!oldest) break;
      this.states.delete(oldest.workspaceKey);
    }

    if (!chrome.storage?.session?.set) {
      return;
    }

    const payload = Array.from(this.states.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );

    await chrome.storage.session.set({
      [STORAGE_KEY]: payload,
    });
  }
}
