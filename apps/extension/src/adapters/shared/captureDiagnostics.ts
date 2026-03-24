import type {
  AdapterId,
  CaptureDebugSnapshot,
  MessageContextItem,
} from "@replymate/contracts";

export type CaptureDropReasonKey = CaptureDebugSnapshot["dropReasons"][number]["reason"];

export type CaptureDebugCounts = Partial<Record<CaptureDropReasonKey, number>>;

type BuildCaptureDebugSnapshotOptions = {
  adapterId: AdapterId;
  composerMode?: CaptureDebugSnapshot["composerMode"];
  contextScope: CaptureDebugSnapshot["contextScope"];
  extractionConfidence: number;
  visibleContext: MessageContextItem[];
  truncated: boolean;
  warnings: string[];
  examinedCandidates: number;
  dropReasonCounts?: CaptureDebugCounts;
  captureKind?: CaptureDebugSnapshot["captureKind"];
  limitedReason?: CaptureDebugSnapshot["limitedReason"];
};

export function createEmptySourceCounts(): CaptureDebugSnapshot["sourceCounts"] {
  return {
    visible_thread: 0,
    visible_channel: 0,
    visible_page: 0,
    visible_email_thread: 0,
    quoted_email: 0,
    generic_dom: 0,
  };
}

export function countContextSources(
  visibleContext: MessageContextItem[]
): CaptureDebugSnapshot["sourceCounts"] {
  const sourceCounts = createEmptySourceCounts();
  for (const item of visibleContext) {
    sourceCounts[item.source] += 1;
  }
  return sourceCounts;
}

export function incrementDropReason(
  counts: CaptureDebugCounts,
  reason: CaptureDropReasonKey,
  amount = 1
): void {
  counts[reason] = (counts[reason] ?? 0) + amount;
}

export function mergeDropReasonCounts(
  ...sources: Array<CaptureDebugCounts | undefined>
): CaptureDebugCounts {
  const merged: CaptureDebugCounts = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [reason, count] of Object.entries(source)) {
      if (typeof count !== "number" || count <= 0) continue;
      incrementDropReason(merged, reason as CaptureDropReasonKey, count);
    }
  }
  return merged;
}

export function summarizeDropReasons(
  counts: CaptureDebugCounts
): CaptureDebugSnapshot["dropReasons"] {
  return Object.entries(counts)
    .filter((entry): entry is [CaptureDropReasonKey, number] => {
      const [, count] = entry;
      return typeof count === "number" && count > 0;
    })
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([reason, count]) => ({ reason, count }));
}

export function buildCaptureDebugSnapshot(
  options: BuildCaptureDebugSnapshotOptions
): CaptureDebugSnapshot {
  const dropReasons = summarizeDropReasons(options.dropReasonCounts ?? {});
  const keptCandidates = options.visibleContext.length;
  const droppedCandidates = Math.max(0, options.examinedCandidates - keptCandidates);

  return {
    capturedAt: new Date().toISOString(),
    adapterId: options.adapterId,
    composerMode: options.composerMode,
    contextScope: options.contextScope,
    extractionConfidence: options.extractionConfidence,
    visibleContextCount: keptCandidates,
    sourceCounts: countContextSources(options.visibleContext),
    truncated: options.truncated,
    warnings: [...options.warnings],
    summary: {
      examinedCandidates: options.examinedCandidates,
      keptCandidates,
      droppedCandidates,
    },
    dropReasons,
    captureKind: options.captureKind,
    limitedReason: options.limitedReason,
  };
}
