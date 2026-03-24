import { randomUUID } from "node:crypto";
import type { DraftVariant, GenerateDraftResponse } from "@replymate/contracts";
import {
  ALTERNATE_ROLE,
  PRIMARY_ROLE,
  type DraftGenerationInput,
} from "./draftingTypes.js";

type VariantKindKey =
  | "cleaned_draft"
  | "context_reply"
  | "default_primary"
  | "default_alternate";

function hasUsableContext(input: DraftGenerationInput): boolean {
  return (
    Boolean(input.selectedContext.responseTarget) ||
    input.selectedContext.supportingTurns.length > 0 ||
    input.selectedContext.contextFacts.length > 0
  );
}

export function buildDraftVariant(
  role: string,
  text: string,
  contextUsed: boolean,
  variantKind: VariantKindKey
): DraftVariant {
  const labelByKind: Record<VariantKindKey, string> = {
    cleaned_draft: "Cleaned Draft",
    context_reply: "Context Reply",
    default_primary: "Primary Reply",
    default_alternate: "Alternate Reply",
  };
  const notesByKind: Record<VariantKindKey, string[]> = {
    cleaned_draft: ["Minimal cleanup", "Close to your draft"],
    context_reply: [contextUsed ? "Best answer with context" : "Polished reply", "Default insert"],
    default_primary: [contextUsed ? "Best answer" : "Corrected", "Default insert"],
    default_alternate: ["Safer fallback", "Closer to draft"],
  };

  return {
    id: `draft-${randomUUID().slice(0, 8)}`,
    role: role as DraftVariant["role"],
    text,
    variantKind,
    label: labelByKind[variantKind],
    styleNotes: [...notesByKind[variantKind]],
  };
}

export function buildDraftResponse(options: {
  input: DraftGenerationInput;
  drafts: [DraftVariant, DraftVariant];
  warnings: string[];
  providerPath: GenerateDraftResponse["inputSummary"]["providerPath"];
  debug?: GenerateDraftResponse["debug"];
}): GenerateDraftResponse {
  return {
    apiVersion: "v1",
    requestId: `req_${randomUUID()}`,
    drafts: options.drafts,
    warnings: options.warnings,
    timings: {
      preflightMs: 0,
      providerMs: 0,
      totalMs: 0,
      usedRetryPass: false,
    },
    inputSummary: {
      contextUsed: options.input.request.contextEnabled,
      contextItemsUsed: options.input.contextItemsUsed,
      contextScopeUsed: options.input.contextScope,
      evidenceIdsUsed: options.input.request.evidence.map((item) => item.evidenceId),
      usedVoiceInput: options.input.request.usedVoiceInput,
      providerPath: options.providerPath,
      entityCorrectionsApplied: options.input.entityCorrectionsApplied,
    },
    debug: options.debug,
  };
}

export function buildImproveDraftResponse(options: {
  input: DraftGenerationInput;
  cleanedDraftText: string;
  contextReplyText: string;
  warnings: string[];
  providerPath: GenerateDraftResponse["inputSummary"]["providerPath"];
  debug?: GenerateDraftResponse["debug"];
}): GenerateDraftResponse {
  return buildDraftResponse({
    input: options.input,
    drafts: [
      buildDraftVariant(
        PRIMARY_ROLE,
        options.cleanedDraftText,
        options.input.contextItemsUsed > 0,
        "cleaned_draft"
      ),
      buildDraftVariant(
        ALTERNATE_ROLE,
        options.contextReplyText,
        options.input.contextItemsUsed > 0,
        "context_reply"
      ),
    ],
    warnings: options.warnings,
    providerPath: options.providerPath,
    debug: options.debug,
  });
}

export function getContextCoverageWarning(input: DraftGenerationInput): string | null {
  const supportingFacts = input.selectedContext.contextFacts.filter(
    (fact) => fact.kind !== "request_frame"
  );

  if (!hasUsableContext(input)) {
    return "Context Reply used limited context; output is based mostly on your draft.";
  }

  if (
    input.selectedContext.responseTarget &&
    input.contextItemsUsed > 0 &&
    supportingFacts.length === 0
  ) {
    return "Context Reply used the current message but no additional supporting evidence was available.";
  }

  return null;
}
