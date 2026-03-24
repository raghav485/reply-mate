import type { ComposerSnapshot } from "@replymate/contracts";
import { CaptureDiagnosticsPanel } from "./CaptureDiagnosticsPanel.js";

type ContextDiagnosticsDrawerProps = {
  open: boolean;
  onClose: () => void;
  snapshot: ComposerSnapshot;
  visibleContext: ComposerSnapshot["visibleContext"];
  locationLabel: string;
  debugMode: boolean;
};

export function ContextDiagnosticsDrawer(props: ContextDiagnosticsDrawerProps) {
  const { open, onClose, snapshot, visibleContext, locationLabel, debugMode } = props;

  if (!open) {
    return null;
  }

  return (
    <div
      className="mt-4 rounded-2xl border border-app-border bg-app-panel p-4 shadow-glow"
      data-testid="replymate-context-drawer"
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-app-textPrimary">Context Diagnostics</h4>
          <div className="text-[11px] uppercase tracking-widest text-app-textSecondary">
            Latest snapshot only
          </div>
        </div>
        <button
          type="button"
          className="rounded-full border border-app-border px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-app-textSecondary hover:text-white"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <CaptureDiagnosticsPanel
        snapshot={snapshot}
        visibleContext={visibleContext}
        locationLabel={locationLabel}
        debugMode={debugMode}
      />
    </div>
  );
}
