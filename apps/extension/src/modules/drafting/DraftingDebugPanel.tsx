import type { GenerateDraftDebug } from "@replymate/contracts";

type DraftingDebugPanelProps = {
  debug: GenerateDraftDebug;
};

function formatCoverage(coverage: GenerateDraftDebug["contextReply"]["coverage"]): string {
  switch (coverage) {
    case "grounded":
      return "Grounded";
    case "current_message_only":
      return "Current message only";
    case "limited":
    default:
      return "Limited";
  }
}

function formatWinner(winner: GenerateDraftDebug["cleanup"]["winner"]): string {
  switch (winner) {
    case "best_effort_model":
      return "Best-effort model output";
    case "model":
    default:
      return "Model output";
  }
}

function formatContextWinner(winner: GenerateDraftDebug["contextReply"]["winner"]): string {
  switch (winner) {
    case "cleaned_draft_reuse":
      return "Mirrors cleaned draft";
    case "model":
    default:
      return "Model output";
  }
}

export function DraftingDebugPanel(props: DraftingDebugPanelProps) {
  const { debug } = props;

  return (
    <div
      className="mt-4 space-y-4 rounded-2xl border border-app-border bg-app-panel p-4"
      data-testid="replymate-drafting-debug"
    >
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-app-textSecondary">
          Generation Diagnostics
        </h3>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-app-border bg-[#1d1d2b] p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-app-textSecondary">
            Response Target
          </div>
          {debug.selection.responseTarget ? (
            <div className="space-y-2 text-[11px]">
              <div className="text-app-textSecondary">
                {(debug.selection.responseTarget.author || "Unknown").trim() || "Unknown"}
                {debug.selection.responseTarget.role
                  ? ` • ${debug.selection.responseTarget.role}`
                  : ""}
              </div>
              <div className="text-app-textPrimary">
                {debug.selection.responseTarget.textPreview}
              </div>
              <div className="text-app-textSecondary italic">
                {debug.selection.responseTarget.reason}
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-app-textSecondary">No explicit response target selected.</div>
          )}
          <div className="mt-3 text-[11px] text-app-textSecondary">
            Current-message fallback:{" "}
            <span className="text-app-textPrimary">
              {debug.selection.currentMessageFallbackUsed ? "Yes" : "No"}
            </span>
          </div>
          <div className="text-[11px] text-app-textSecondary">
            Supporting turns:{" "}
            <span className="text-app-textPrimary">{debug.selection.supportTurnCount}</span>
          </div>
        </div>

        <div className="rounded-xl border border-app-border bg-[#1d1d2b] p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-app-textSecondary">
            Cleanup Decision
          </div>
          <div className="text-[11px] text-app-textSecondary">
            Winner: <span className="text-app-textPrimary">{formatWinner(debug.cleanup.winner)}</span>
          </div>
          <div className="text-[11px] text-app-textSecondary">
            Selected score:{" "}
            <span className="text-app-textPrimary">{Math.round(debug.cleanup.selectedQualityScore)}</span>
          </div>
          {typeof debug.cleanup.modelQualityScore === "number" && (
            <div className="text-[11px] text-app-textSecondary">
              Model score:{" "}
              <span className="text-app-textPrimary">{Math.round(debug.cleanup.modelQualityScore)}</span>
            </div>
          )}
          <div className="mt-3 text-[11px] text-app-textSecondary">
            Suspicious tokens:{" "}
            <span className="text-app-textPrimary">
              {debug.cleanup.suspiciousTokens.length > 0
                ? debug.cleanup.suspiciousTokens.join(", ")
                : "None"}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-app-border bg-[#1d1d2b] p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-app-textSecondary">
            Supporting Facts Used
          </div>
          {debug.supportingFacts.length > 0 ? (
            <div className="space-y-2">
              {debug.supportingFacts.map((fact, index) => (
                <div key={`${fact.kind}-${index}`} className="rounded-lg border border-app-border px-3 py-2 text-[11px]">
                  <div className="mb-1 text-app-textSecondary">
                    {fact.kind}
                    {fact.sourceAuthor ? ` • ${fact.sourceAuthor}` : ""}
                    {` • relevance ${fact.relevance}`}
                  </div>
                  <div className="text-app-textPrimary">{fact.textPreview}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-app-textSecondary">No supporting facts were selected.</div>
          )}
        </div>

        <div className="rounded-xl border border-app-border bg-[#1d1d2b] p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-app-textSecondary">
            Excluded Context
          </div>
          {debug.excludedTurns.length > 0 ? (
            <div className="space-y-2">
              {debug.excludedTurns.map((turn, index) => (
                <div key={`${turn.kind}-${index}`} className="rounded-lg border border-app-border px-3 py-2 text-[11px]">
                  <div className="mb-1 text-app-textSecondary">
                    {turn.kind}
                    {turn.author ? ` • ${turn.author}` : ""}
                  </div>
                  <div className="text-app-textPrimary">{turn.textPreview}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-app-textSecondary">No turns were excluded.</div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-app-border bg-[#1d1d2b] p-3 text-[11px] text-app-textSecondary">
        <div className="mb-2 font-semibold uppercase tracking-widest text-app-textSecondary">
          Context Reply Decision
        </div>
        <div>
          Winner:{" "}
          <span className="text-app-textPrimary">{formatContextWinner(debug.contextReply.winner)}</span>
        </div>
        <div>
          Coverage: <span className="text-app-textPrimary">{formatCoverage(debug.contextReply.coverage)}</span>
        </div>
        <div>
          Fallback used:{" "}
          <span className="text-app-textPrimary">
            {debug.contextReply.usedFallback ? "Yes" : "No"}
          </span>
        </div>
        {typeof debug.contextReply.qualityScore === "number" && (
          <div>
            Quality score:{" "}
            <span className="text-app-textPrimary">
              {Math.round(debug.contextReply.qualityScore)}
            </span>
          </div>
        )}
        <div className="mt-2">
          Runtime: <span className="text-app-textPrimary">{debug.provider.runtime}</span>
          {" • "}
          Retry pass:{" "}
          <span className="text-app-textPrimary">
            {debug.provider.usedRetryPass ? "Yes" : "No"}
          </span>
        </div>
      </div>
    </div>
  );
}
