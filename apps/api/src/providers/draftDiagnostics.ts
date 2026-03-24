import type { GenerateDraftDebug } from "@replymate/contracts";
import { normalizeText } from "./draftingLexical.js";
import type {
  CleanedDraftCandidate,
  ContextReplyCandidate,
  DraftGenerationInput,
} from "./draftingTypes.js";

const MAX_PREVIEW_CHARS = 220;
const MAX_SUPPORTING_FACTS = 3;
const MAX_EXCLUDED_TURNS = 3;

function truncatePreview(text: string, maxChars = MAX_PREVIEW_CHARS): string {
  const normalized = normalizeText(text);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function findMatchingTurn(
  input: DraftGenerationInput,
  text: string | null | undefined
): DraftGenerationInput["recentTurns"][number] | undefined {
  if (!text) {
    return undefined;
  }

  const allTurns = [...input.recentTurns, ...input.excludedTurns];
  return allTurns.find((turn) => normalizeText(turn.text) === normalizeText(text));
}

function getSupportingFacts(input: DraftGenerationInput) {
  if (input.selectedContext.contextFacts.length > 0) {
    return input.selectedContext.contextFacts;
  }

  return input.contextDeltas.map((delta) => ({
    kind: delta.kind,
    abstractedText: normalizeText(delta.text),
    sourceText: delta.sourceText,
    sourceAuthor: delta.sourceAuthor,
    sourceRole: delta.kind === "request_frame" ? "customer" : "unknown",
    confidence: delta.kind === "request_frame" ? "high" : "medium",
    relevance:
      delta.kind === "request_frame"
        ? 5
        : delta.kind === "explicit_fact"
          ? 4
          : delta.kind === "supporting_detail"
            ? 3
            : delta.kind === "resolved_reference"
              ? 2
              : 1,
  }));
}

function getCoverage(input: DraftGenerationInput): GenerateDraftDebug["contextReply"]["coverage"] {
  const supportingFacts = getSupportingFacts(input).filter(
    (fact) => fact.kind !== "request_frame"
  );
  const hasUsableContext =
    Boolean(input.selectedContext.responseTarget) ||
    input.selectedContext.supportingTurns.length > 0 ||
    input.selectedContext.contextFacts.length > 0;

  if (!hasUsableContext) {
    return "limited";
  }

  if (
    input.selectedContext.responseTarget &&
    input.contextItemsUsed > 0 &&
    supportingFacts.length === 0
  ) {
    return "current_message_only";
  }

  return "grounded";
}

export function buildImproveDraftDebug(options: {
  input: DraftGenerationInput;
  runtime: GenerateDraftDebug["provider"]["runtime"];
  usedRetryPass: boolean;
  cleanedSelection: CleanedDraftCandidate;
  cleanedModelCandidate?: CleanedDraftCandidate | null;
  contextCandidate?: ContextReplyCandidate | null;
  contextWinner: GenerateDraftDebug["contextReply"]["winner"];
}): GenerateDraftDebug {
  const responseTargetText = options.input.responseTargetTurn || options.input.selectedContext.responseTarget;
  const responseTargetTurn = findMatchingTurn(options.input, responseTargetText);
  const supportingFacts = getSupportingFacts(options.input)
    .filter((fact) => fact.kind !== "request_frame")
    .sort((left, right) => right.relevance - left.relevance)
    .slice(0, MAX_SUPPORTING_FACTS)
    .map((fact) => ({
      kind: fact.kind,
      textPreview: truncatePreview(fact.abstractedText || fact.sourceText || ""),
      sourceAuthor: fact.sourceAuthor,
      relevance: fact.relevance,
    }));

  const excludedTurns = options.input.excludedTurns.slice(0, MAX_EXCLUDED_TURNS).map((turn) => ({
    kind: turn.kind,
    textPreview: truncatePreview(turn.text),
    author: turn.author,
  }));

  return {
    selection: {
      responseTarget: responseTargetText
        ? {
            textPreview: truncatePreview(responseTargetText),
            author: responseTargetTurn?.author,
            role: responseTargetTurn?.role,
            reason:
              options.input.responseTargetReason ||
              options.input.selectedContext.selectionReason ||
              "Selected as the best current reply target.",
          }
        : undefined,
      currentMessageFallbackUsed: options.input.currentMessageFallbackUsed,
      supportTurnCount: options.input.selectedContext.supportingTurns.length,
    },
    supportingFacts,
    excludedTurns,
    cleanup: {
      winner: "model",
      modelQualityScore: options.cleanedModelCandidate?.qualityScore,
      selectedQualityScore: options.cleanedSelection.qualityScore,
      suspiciousTokens: [...options.cleanedSelection.suspiciousTokens],
    },
    contextReply: {
      winner: options.contextWinner,
      usedFallback: options.contextWinner === "cleaned_draft_reuse",
      qualityScore:
        options.contextWinner === "model" ? options.contextCandidate?.qualityScore : undefined,
      coverage: getCoverage(options.input),
    },
    provider: {
      runtime: options.runtime,
      usedRetryPass: options.usedRetryPass,
    },
  };
}
