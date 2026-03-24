import type { ComposerSnapshot } from "@replymate/contracts";

type CaptureDiagnosticsPanelProps = {
  snapshot: ComposerSnapshot;
  visibleContext: ComposerSnapshot["visibleContext"];
  locationLabel: string;
  debugMode: boolean;
};

function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatCaptureAge(capturedAt?: string): string {
  if (!capturedAt) {
    return "Unknown";
  }

  const capturedMs = Date.parse(capturedAt);
  if (!Number.isFinite(capturedMs)) {
    return "Unknown";
  }

  const deltaMs = Math.max(0, Date.now() - capturedMs);
  if (deltaMs < 1_000) return "Just now";
  if (deltaMs < 60_000) return `${Math.round(deltaMs / 1_000)}s ago`;
  if (deltaMs < 3_600_000) return `${Math.round(deltaMs / 60_000)}m ago`;
  return `${Math.round(deltaMs / 3_600_000)}h ago`;
}

function formatDropReason(reason: string): string {
  return reason.replace(/_/g, " ");
}

function formatCaptureKind(kind?: string): string | null {
  if (!kind) return null;
  return kind.replace(/_/g, " ");
}

export function CaptureDiagnosticsPanel(props: CaptureDiagnosticsPanelProps) {
  const { snapshot, visibleContext, locationLabel, debugMode } = props;
  const captureDebug = snapshot.captureDebug;
  const summary = captureDebug?.summary;
  const rawContext = visibleContext.length > 0 ? visibleContext : snapshot.visibleContext;

  return (
    <div className="space-y-4" data-testid="replymate-capture-debug">
      <div className="grid grid-cols-2 gap-3 text-xs text-app-textSecondary">
        <div className="rounded-lg border border-app-border bg-[#1d1d2b] p-3">
          <div className="mb-1 uppercase tracking-widest opacity-60">Adapter</div>
          <div className="text-app-textPrimary">{captureDebug?.adapterId || "Unknown"}</div>
        </div>
        <div className="rounded-lg border border-app-border bg-[#1d1d2b] p-3">
          <div className="mb-1 uppercase tracking-widest opacity-60">Scope</div>
          <div className="text-app-textPrimary">{snapshot.contextScope}</div>
        </div>
        <div className="rounded-lg border border-app-border bg-[#1d1d2b] p-3">
          <div className="mb-1 uppercase tracking-widest opacity-60">Location</div>
          <div className="text-app-textPrimary break-words">{locationLabel}</div>
        </div>
        <div className="rounded-lg border border-app-border bg-[#1d1d2b] p-3">
          <div className="mb-1 uppercase tracking-widest opacity-60">Capture Age</div>
          <div className="text-app-textPrimary">{formatCaptureAge(captureDebug?.capturedAt)}</div>
        </div>
        <div className="rounded-lg border border-app-border bg-[#1d1d2b] p-3">
          <div className="mb-1 uppercase tracking-widest opacity-60">Visible Messages</div>
          <div className="text-app-textPrimary">
            {captureDebug?.visibleContextCount ?? rawContext.length}
          </div>
        </div>
        <div className="rounded-lg border border-app-border bg-[#1d1d2b] p-3">
          <div className="mb-1 uppercase tracking-widest opacity-60">Confidence</div>
          <div className="text-app-textPrimary">
            {formatConfidence(captureDebug?.extractionConfidence ?? snapshot.extractionConfidence)}
          </div>
        </div>
      </div>

      {debugMode && captureDebug && (
        <div className="space-y-3 rounded-xl border border-app-border bg-app-panel p-4">
          <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-widest text-app-textSecondary">
            {captureDebug.captureKind && (
              <span className="rounded-full border border-app-border px-2 py-1">
                Kind: {formatCaptureKind(captureDebug.captureKind)}
              </span>
            )}
            {captureDebug.limitedReason && captureDebug.limitedReason !== "none" && (
              <span className="rounded-full border border-app-warning px-2 py-1 text-app-warning">
                Reason: {formatCaptureKind(captureDebug.limitedReason)}
              </span>
            )}
            <span className="rounded-full border border-app-border px-2 py-1">
              Truncated: {captureDebug.truncated ? "Yes" : "No"}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs text-app-textSecondary">
            <div className="rounded-lg border border-app-border bg-[#1d1d2b] p-3">
              <div className="mb-1 uppercase tracking-widest opacity-60">Examined</div>
              <div className="text-app-textPrimary">{summary?.examinedCandidates ?? 0}</div>
            </div>
            <div className="rounded-lg border border-app-border bg-[#1d1d2b] p-3">
              <div className="mb-1 uppercase tracking-widest opacity-60">Kept</div>
              <div className="text-app-textPrimary">{summary?.keptCandidates ?? 0}</div>
            </div>
            <div className="rounded-lg border border-app-border bg-[#1d1d2b] p-3">
              <div className="mb-1 uppercase tracking-widest opacity-60">Dropped</div>
              <div className="text-app-textPrimary">{summary?.droppedCandidates ?? 0}</div>
            </div>
          </div>

          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-app-textSecondary">
              Source Breakdown
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] text-app-textSecondary">
              {Object.entries(captureDebug.sourceCounts).map(([source, count]) => (
                <span key={source} className="rounded-full border border-app-border px-2 py-1">
                  {source}: <span className="text-app-textPrimary">{count}</span>
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-app-textSecondary">
              Drop Reasons
            </div>
            {captureDebug.dropReasons.length > 0 ? (
              <div className="space-y-2">
                {captureDebug.dropReasons.map((entry) => (
                  <div
                    key={entry.reason}
                    className="flex items-center justify-between rounded-lg border border-app-border bg-[#1d1d2b] px-3 py-2 text-[11px]"
                  >
                    <span className="text-app-textSecondary capitalize">
                      {formatDropReason(entry.reason)}
                    </span>
                    <span className="font-semibold text-app-textPrimary">{entry.count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-app-textSecondary">No drop reasons recorded.</div>
            )}
          </div>

          {captureDebug.warnings.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-app-textSecondary">
                Adapter Warnings
              </div>
              <div className="space-y-2">
                {captureDebug.warnings.map((warning, index) => (
                  <div
                    key={`${warning}-${index}`}
                    className="rounded-lg border border-app-warning bg-app-warning/10 px-3 py-2 text-[11px] text-app-warning"
                  >
                    {warning}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-app-textSecondary">
          Raw Context Preview
        </div>
        {rawContext.length > 0 ? (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {rawContext.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-app-border bg-[#1d1d2b] p-3 text-[11px]"
              >
                <div className="mb-1 text-app-textSecondary">
                  {(item.author || "Unknown").trim() || "Unknown"} • {item.source}
                </div>
                <div className="whitespace-pre-wrap text-app-textPrimary">{item.text}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-app-border bg-[#1d1d2b] p-3 text-[11px] text-app-textSecondary">
            No raw context was captured in the latest snapshot.
          </div>
        )}
      </div>
    </div>
  );
}
