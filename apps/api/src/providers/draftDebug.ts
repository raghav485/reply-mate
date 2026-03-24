import type { GenerateDraftDebug } from "@replymate/contracts";

function isDraftDebugEnabled(): boolean {
  const value = (process.env.REPLYMATE_DEBUG_DRAFT || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function logImproveDraftTrace(trace: GenerateDraftDebug): void {
  if (!isDraftDebugEnabled()) {
    return;
  }
  console.info(`[ReplyMate][ImproveDraftTrace] ${JSON.stringify(trace)}`);
}
