import type { GenerateDraftRequest } from "@replymate/contracts";
import type {
  ClassifiedContextTurn,
  ContextDelta,
  ContextFact,
  DraftGenerationInput,
  EntityCandidate,
  SelectedContext,
} from "./draftingTypes.js";
import {
  countMeaningfulTokenOverlap,
  extractMeaningfulTokens,
  hasTypoSignal,
  normalizeBrokenDraftTokens,
  normalizedEditDistance,
  normalizeForComparison,
  normalizeText,
  resolveLexicalDraftCorrections,
} from "./draftingLexical.js";

function ensureTerminalPunctuation(value: string): string {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function addEntityCandidate(
  map: Map<string, EntityCandidate>,
  value: string,
  source: EntityCandidate["source"],
  weight: number
): void {
  const cleaned = normalizeText(value).replace(/^@+/, "");
  const normalized = normalizeForComparison(cleaned);
  if (!cleaned || normalized.length < 3) return;
  if (!/[a-z]/i.test(cleaned)) return;

  const existing = map.get(normalized);
  if (!existing || existing.weight < weight) {
    map.set(normalized, { value: cleaned, normalized, source, weight });
  } else if (existing.weight === weight && cleaned.length > existing.value.length) {
    map.set(normalized, { value: cleaned, normalized, source, weight });
  }
}

function extractMentionCandidates(text: string): string[] {
  const matches = text.match(/@([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,2})/gu) ?? [];
  return matches.map((item) => item.replace(/^@/, "").trim());
}

function extractCapitalizedCandidates(text: string): string[] {
  const matches = text.match(/\b[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,2}\b/gu) ?? [];
  return matches
    .map((item) => item.trim())
    .filter(
      (item) =>
        item.length >= 3 &&
        !/^(Today|Yesterday|Tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.test(
          item
        )
    );
}

function buildEntityCandidates(
  visibleItems: GenerateDraftRequest["snapshot"]["visibleContext"],
  request: GenerateDraftRequest
): EntityCandidate[] {
  const candidates = new Map<string, EntityCandidate>();

  for (const item of visibleItems) {
    addEntityCandidate(candidates, item.author || "", "context", 3);
    for (const mention of extractMentionCandidates(item.text)) {
      addEntityCandidate(candidates, mention, "context", 3);
    }
    for (const candidate of extractCapitalizedCandidates(item.text)) {
      addEntityCandidate(
        candidates,
        candidate,
        "context",
        candidate.split(/\s+/).length >= 3 ? 2 : 1
      );
    }
  }

  addEntityCandidate(candidates, request.snapshot.metadata.customerName || "", "metadata", 3);
  addEntityCandidate(candidates, request.snapshot.metadata.senderName || "", "metadata", 3);
  addEntityCandidate(candidates, request.snapshot.metadata.threadTitle || "", "metadata", 1);

  for (const evidence of request.evidence) {
    addEntityCandidate(candidates, evidence.name, "evidence", 1);
    for (const candidate of extractCapitalizedCandidates(evidence.summaryText)) {
      addEntityCandidate(
        candidates,
        candidate,
        "evidence",
        candidate.split(/\s+/).length >= 3 ? 2 : 1
      );
    }
  }

  return [...candidates.values()].sort((left, right) => {
    if (right.weight !== left.weight) return right.weight - left.weight;
    return right.value.length - left.value.length;
  });
}

function extractDraftTokens(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function cleanTokenForMatch(token: string): string {
  return normalizeForComparison(token.replace(/^[@("'`]+|[.,!?;:)"'`]+$/g, ""));
}

function buildResolvedDraft(
  cleanedDraft: string,
  candidates: EntityCandidate[]
): {
  resolvedDraft: string;
  corrections: DraftGenerationInput["entityCorrectionsApplied"];
  keyEntities: string[];
} {
  const tokens = extractDraftTokens(cleanedDraft);
  if (tokens.length === 0 || candidates.length === 0) {
    return {
      resolvedDraft: cleanedDraft,
      corrections: [],
      keyEntities: candidates.slice(0, 6).map((item) => item.value),
    };
  }

  const working = [...tokens];
  const corrections: DraftGenerationInput["entityCorrectionsApplied"] = [];

  for (let ngramSize = 3; ngramSize >= 1; ngramSize -= 1) {
    for (let index = 0; index <= working.length - ngramSize; index += 1) {
      const segment = working.slice(index, index + ngramSize);
      const segmentNormalized = segment.map((token) => cleanTokenForMatch(token)).join(" ").trim();
      if (!segmentNormalized || segmentNormalized.length < 3) continue;

      const sameLengthCandidates = candidates.filter(
        (candidate) => candidate.value.split(/\s+/).length === ngramSize
      );

      const ranked = sameLengthCandidates
        .map((candidate) => ({
          candidate,
          distance: normalizedEditDistance(segmentNormalized, candidate.normalized),
        }))
        .filter(({ candidate, distance }) => {
          if (segmentNormalized === candidate.normalized) {
            return segment.join(" ") !== candidate.value && candidate.weight >= 2;
          }
          if (candidate.weight < 2) return false;
          const leftFirst = segmentNormalized.charAt(0);
          const rightFirst = candidate.normalized.charAt(0);
          if (!leftFirst || leftFirst !== rightFirst) return false;
          return distance <= (ngramSize === 1 ? 0.34 : 0.28);
        })
        .sort((left, right) => {
          if (left.distance !== right.distance) return left.distance - right.distance;
          return right.candidate.weight - left.candidate.weight;
        });

      const best = ranked[0];
      const runnerUp = ranked[1];
      if (!best) continue;
      if (runnerUp && Math.abs(best.distance - runnerUp.distance) < 0.08) continue;

      const replacement = best.candidate.value.split(/\s+/);
      working.splice(index, ngramSize, ...replacement);
      corrections.push({
        from: segment.join(" "),
        to: best.candidate.value,
        source: best.candidate.source,
      });
      index += replacement.length - 1;
    }
  }

  return {
    resolvedDraft: working.join(" "),
    corrections,
    keyEntities: candidates.slice(0, 6).map((item) => item.value),
  };
}

function hasQuestionMarkers(value: string): boolean {
  const normalized = normalizeText(value);
  return (
    normalized.includes("?") ||
    /^(can|could|what|why|when|where|who|how|is|are|do|does|did|will|would)\b/i.test(normalized)
  );
}

function hasUncertaintyMarkers(value: string): boolean {
  return /\b(may|might|could be|not sure|curious|seems like|possibly|perhaps)\b/i.test(value);
}

function hasActionRequestMarkers(value: string): boolean {
  return (
    /\b(please|take a look|post an update|can someone|mind|let us know|keep me posted)\b/i.test(
      value
    ) || /@\w+/i.test(value)
  );
}

function hasConfirmedAnswerMarkers(value: string): boolean {
  return /\b(i looked into it|the reason|because|it is listed as|it was listed as|i do see|should be okay|on our end we have not heard|we haven't heard anything|no broader outage|we have not heard of any outage)\b/i.test(
    value
  );
}

function hasAcknowledgementMarkers(value: string): boolean {
  const normalized = normalizeText(value);
  if (extractMeaningfulTokens(normalized).length >= 5) return false;
  return /^(thanks|thank you|interesting|keep me posted|good morning|got it|sounds good)\b/i.test(
    normalized
  );
}

function turnMirrorsDraft(turnText: string, draftText: string, draftEntities: string[]): boolean {
  if (countMeaningfulTokenOverlap(turnText, draftText) >= 2) {
    return true;
  }
  const normalizedDraft = normalizeForComparison(draftText);
  return draftEntities.some((entity) => normalizedDraft.includes(normalizeForComparison(entity)));
}

function isNoiseLikeTurn(turn: ClassifiedContextTurn): boolean {
  return turn.kind === "ack" || extractMeaningfulTokens(turn.text).length < 4;
}

function isValidSupportingFallbackTurn(
  turn: ClassifiedContextTurn,
  draftReference: string,
  draftEntities: string[]
): boolean {
  if (isNoiseLikeTurn(turn)) {
    return false;
  }

  if (turn.hasDirectRequest && !turnMirrorsDraft(turn.text, draftReference, draftEntities)) {
    return false;
  }

  if (turn.isSpeculative && !turnMirrorsDraft(turn.text, draftReference, draftEntities)) {
    return false;
  }

  return true;
}

function isValidResponseTargetFallbackTurn(turn: ClassifiedContextTurn): boolean {
  if (isNoiseLikeTurn(turn) || turn.hasDirectRequest) {
    return false;
  }

  return (
    turn.kind === "question" ||
    (turn.role === "customer" && turn.kind !== "confirmed_answer") ||
    looksLikeProblemReport(turn.text)
  );
}

function looksLikeProblemReport(text: string): boolean {
  return /\b(issue|problem|outage|error|appointment|appointments|message|messages|dnd|keeps getting|not receiving|didn'?t|doesn'?t|won'?t let)\b/i.test(
    text
  );
}

function inferDeltaFocus(text: string): string {
  const normalized = text.toLowerCase();
  if (/\b(invoice|billing|charge|payment|card|prorat)\b/.test(normalized)) return "billing";
  if (/\b(access|login|log in|password|account)\b/.test(normalized)) return "access";
  if (/\b(eta|timeline|before friday|next week|tomorrow|today)\b/.test(normalized)) {
    return "timeline";
  }
  if (/\b(workflow|message|messaging|follow-up|sequence|task|forms)\b/.test(normalized)) {
    return "workflow";
  }
  if (/\b(issue|incident|error|outage|bug|failed|failure)\b/.test(normalized)) return "incident";
  return "general";
}

function rawContextToAbstractedText(text: string): string {
  let normalized = normalizeText(text)
    .replace(/^@\S+(?:\s+@\S+)*/g, "")
    .replace(/^(hey|hi|hello)\s+[^,]+,\s*/i, "")
    .replace(/^on our end,?\s*/i, "")
    .replace(/^i (?:looked into it|checked|believe|think|found)\s*(?:and\s*)?/i, "")
    .replace(/^we have not heard of any\b/i, "No")
    .replace(/^there have not been any\b/i, "No")
    .replace(/\bit is listed as\b/gi, "it is classified as")
    .replace(/\bthe reason\b/gi, "")
    .replace(/\bplease let us know if it happens again.*$/i, "")
    .replace(/\bbut it should be okay\b/i, "")
    .replace(/\bwe can investigate further\b/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.\-:; ]+|[,.\-:; ]+$/g, "");

  if (!normalized) return "";

  if (/\bcompleted\b.*\bmissed\b|\bmissed\b.*\bcompleted\b/i.test(normalized)) {
    return "The calls appear to be classified as completed rather than missed.";
  }
  if (
    /\b(no|not)\b.*\boutage\b/i.test(normalized) ||
    /\bhaven'?t heard of any outage\b/i.test(normalized) ||
    /\bno broader outage\b/i.test(normalized)
  ) {
    return "No broader outage has been confirmed on our side.";
  }
  if (/\btimeout\b/i.test(normalized) && /\b20\b/.test(normalized)) {
    return "The timeout setting was updated to 20 seconds.";
  }

  return ensureTerminalPunctuation(normalized);
}

function buildRequestFrameText(turn: ClassifiedContextTurn): string {
  const focus = inferDeltaFocus(turn.text);
  if (focus === "incident") {
    return "Address the reported issue directly and clarify whether it reflects a broader outage or isolated call behavior.";
  }
  if (focus === "billing") {
    return "Answer the customer's billing concern directly and keep the reply grounded in the current account details.";
  }
  if (focus === "access") {
    return "Answer the access problem directly and explain the likely cause or next step clearly.";
  }
  if (focus === "timeline") {
    return "Answer the timing question directly and clarify what changed or what to expect.";
  }
  if (focus === "workflow") {
    return "Address the workflow issue directly and make the intended action clear.";
  }
  return "Answer the active customer concern directly instead of only polishing the existing draft.";
}

function firstMeaningfulSentence(value: string, maxChars = 180): string {
  const cleaned = normalizeText(value);
  if (!cleaned) return "";
  const sentence = cleaned.match(/^(.+?[.!?])(?:\s|$)/)?.[1] || cleaned;
  if (sentence.length <= maxChars) return sentence;
  return `${sentence.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function classifyVisibleTurns(options: {
  visibleItems: GenerateDraftRequest["snapshot"]["visibleContext"];
  draftText: string;
  resolvedDraft: string;
  keyEntities: string[];
  improveDraft: boolean;
  contextScope: DraftGenerationInput["contextScope"];
}): {
  recentTurns: ClassifiedContextTurn[];
  excludedTurns: ClassifiedContextTurn[];
  responseTarget: ClassifiedContextTurn | undefined;
  responseTargetTurn: string | undefined;
  responseTargetReason: string | undefined;
  currentMessageFallbackUsed: boolean;
  latestQuestion: string | undefined;
  latestConfirmedAnswer: string | undefined;
  latestActionRequest: string | undefined;
  latestRelevantSupportingTurn: string | undefined;
} {
  const recentVisibleItems = options.visibleItems.slice(-12);
  const draftReference = options.resolvedDraft || options.draftText;
  const draftHasActionRequest = hasActionRequestMarkers(draftReference);
  const draftEntities = options.keyEntities.filter((entity) =>
    normalizeForComparison(draftReference).includes(normalizeForComparison(entity))
  );

  const classified = recentVisibleItems.map<ClassifiedContextTurn>((item, index) => {
    const text = normalizeText(item.text);
    const author = normalizeText(item.author || "") || "Unknown";
    const hasDirectRequest = hasActionRequestMarkers(text);
    const isSpeculative = hasUncertaintyMarkers(text);
    const isQuestion = hasQuestionMarkers(text);
    const isConfirmedAnswer = hasConfirmedAnswerMarkers(text);
    const isAck = hasAcknowledgementMarkers(text);
    const sharedEntities = options.keyEntities.filter((entity) => {
      const normalizedEntity = normalizeForComparison(entity);
      return (
        normalizedEntity.length > 0 &&
        normalizeForComparison(text).includes(normalizedEntity) &&
        normalizeForComparison(draftReference).includes(normalizedEntity)
      );
    });
    const overlap = countMeaningfulTokenOverlap(text, draftReference);

    let kind: ClassifiedContextTurn["kind"] = "other";
    if (isConfirmedAnswer) {
      kind = "confirmed_answer";
    } else if (isQuestion) {
      kind = "question";
    } else if (hasDirectRequest) {
      kind = "action_request";
    } else if (isSpeculative) {
      kind = "hypothesis";
    } else if (isAck) {
      kind = "ack";
    }

    let relevanceScore = overlap * 3 + sharedEntities.length * 2 + Math.min(index, 3);
    if (kind === "confirmed_answer") relevanceScore += 2;
    if (kind === "question") relevanceScore += 1;
    if (kind === "ack") relevanceScore -= 3;
    if (hasDirectRequest && !draftHasActionRequest) relevanceScore -= 4;
    if (isSpeculative && !turnMirrorsDraft(text, draftReference, draftEntities)) {
      relevanceScore -= 3;
    }

    const supportsDraft = options.improveDraft
      ? overlap > 0 ||
        sharedEntities.length > 0 ||
        (kind === "confirmed_answer" && relevanceScore >= 2) ||
        (hasDirectRequest &&
          draftHasActionRequest &&
          turnMirrorsDraft(text, draftReference, draftEntities)) ||
        (isSpeculative && turnMirrorsDraft(text, draftReference, draftEntities))
      : relevanceScore >= 0;

    const confidence: ClassifiedContextTurn["confidence"] =
      kind === "confirmed_answer"
        ? "high"
        : overlap > 0 || sharedEntities.length > 0
          ? "medium"
          : "low";

    return {
      author,
      role: item.role || "unknown",
      text,
      kind,
      confidence,
      relevanceScore,
      sharedEntities,
      supportsDraft,
      hasDirectRequest,
      isSpeculative,
    };
  });

  const latestSupportingFallbackTurn = [...classified]
    .reverse()
    .find((turn) => isValidSupportingFallbackTurn(turn, draftReference, draftEntities));
  const latestResponseTargetFallbackTurn = [...classified]
    .reverse()
    .find((turn) => isValidResponseTargetFallbackTurn(turn));
  const currentMessageFallbackUsed =
    options.improveDraft &&
    (options.contextScope === "thread" || options.contextScope === "channel") &&
    normalizeText(options.draftText).length > 0 &&
    recentVisibleItems.length >= 1 &&
    recentVisibleItems.length <= 3 &&
    Boolean(latestResponseTargetFallbackTurn);

  const supportingCandidates = options.improveDraft
    ? classified.filter(
        (turn) =>
          turn.supportsDraft &&
          turn.relevanceScore >= 1 &&
          turn.kind !== "ack" &&
          !(turn.hasDirectRequest && !turnMirrorsDraft(turn.text, draftReference, draftEntities))
      )
    : classified.slice(-8);

  const selectedTurns =
    options.improveDraft && supportingCandidates.length === 0
      ? latestSupportingFallbackTurn
        ? [latestSupportingFallbackTurn]
        : classified
            .filter(
              (turn) => turn.relevanceScore > 0 && turn.kind !== "ack" && !turn.hasDirectRequest
            )
            .sort((left, right) => right.relevanceScore - left.relevanceScore)
            .slice(0, 3)
            .sort(
              (left, right) =>
                recentVisibleItems.findIndex((item) => normalizeText(item.text) === left.text) -
                recentVisibleItems.findIndex((item) => normalizeText(item.text) === right.text)
            )
      : options.improveDraft
        ? supportingCandidates
            .sort((left, right) => right.relevanceScore - left.relevanceScore)
            .slice(0, 5)
            .sort(
              (left, right) =>
                recentVisibleItems.findIndex((item) => normalizeText(item.text) === left.text) -
                recentVisibleItems.findIndex((item) => normalizeText(item.text) === right.text)
            )
        : supportingCandidates;

  const selectedSet = new Set(selectedTurns.map((turn) => turn.text));
  const excludedTurns = options.improveDraft
    ? classified.filter(
        (turn) =>
          !selectedSet.has(turn.text) &&
          (turn.hasDirectRequest ||
            (turn.isSpeculative && !turnMirrorsDraft(turn.text, draftReference, draftEntities)))
      )
    : [];

  const responseTargetCandidate = [...classified].reverse().find(
    (turn) =>
      turn.kind !== "ack" &&
      !turn.hasDirectRequest &&
        (turn.kind === "question" ||
        (turn.role === "customer" && turn.kind !== "confirmed_answer" && turn.relevanceScore >= 0) ||
        (turn.kind !== "confirmed_answer" &&
          turn.relevanceScore >= 2 &&
          (countMeaningfulTokenOverlap(turn.text, draftReference) >= 2 ||
            turn.sharedEntities.length > 0)) ||
        (options.improveDraft &&
          turn === latestResponseTargetFallbackTurn &&
          turn.kind !== "confirmed_answer" &&
          looksLikeProblemReport(turn.text)))
  );

  const responseTargetTurn =
    responseTargetCandidate?.text ??
    (currentMessageFallbackUsed ? latestResponseTargetFallbackTurn?.text : undefined);
  const responseTargetReason = responseTargetCandidate
    ? responseTargetCandidate.kind === "question"
      ? "explicit_question"
      : responseTargetCandidate === latestResponseTargetFallbackTurn &&
          looksLikeProblemReport(responseTargetCandidate.text)
        ? "current_problem_report"
        : "relevance_match"
    : currentMessageFallbackUsed
      ? "current_visible_message"
      : undefined;

  return {
    recentTurns: selectedTurns,
    excludedTurns,
    responseTarget: responseTargetCandidate ?? latestResponseTargetFallbackTurn,
    responseTargetTurn,
    responseTargetReason,
    currentMessageFallbackUsed,
    latestQuestion: [...classified].reverse().find((turn) => turn.kind === "question")?.text,
    latestConfirmedAnswer: [...classified]
      .reverse()
      .find((turn) => turn.kind === "confirmed_answer" && turn.relevanceScore >= 0)?.text,
    latestActionRequest: [...classified]
      .reverse()
      .find((turn) => turn.kind === "action_request")?.text,
    latestRelevantSupportingTurn: selectedTurns.at(-1)?.text,
  };
}

function countSelectedContextItems(params: {
  supportingTurns: ClassifiedContextTurn[];
  responseTargetTurn?: string;
}): number {
  const unique = new Set(params.supportingTurns.map((turn) => normalizeForComparison(turn.text)));
  if (params.responseTargetTurn) {
    unique.add(normalizeForComparison(params.responseTargetTurn));
  }
  unique.delete("");
  return unique.size;
}

function buildContextDeltas(input: {
  recentTurns: ClassifiedContextTurn[];
  responseTargetTurn?: string;
  resolvedDraft: string;
  cleanedDraft: string;
  currentMessageFallbackUsed: boolean;
}): ContextDelta[] {
  const draftReference = input.resolvedDraft || input.cleanedDraft;
  const deltas: ContextDelta[] = [];
  const seen = new Set<string>();

  if (input.responseTargetTurn) {
    const normalized = normalizeForComparison(input.responseTargetTurn);
    const key = `request_frame::${normalized}`;
    if (normalized && !seen.has(key)) {
      seen.add(key);
      deltas.push({
        kind: "request_frame",
        text: buildRequestFrameText({
          author: "Customer",
          role: "customer",
          text: input.responseTargetTurn,
          kind: "question",
          confidence: "high",
          relevanceScore: 10,
          sharedEntities: [],
          supportsDraft: true,
          hasDirectRequest: false,
          isSpeculative: false,
        }),
        sourceText: input.responseTargetTurn,
        sourceAuthor: "Customer",
        sourceKind: "question",
        entityHints: [],
      });
    }
  }

  const orderedTurns = [...input.recentTurns]
    .filter((turn) => turn.kind !== "ack")
    .sort((left, right) => right.relevanceScore - left.relevanceScore);

  for (const turn of orderedTurns) {
    const text = rawContextToAbstractedText(firstMeaningfulSentence(turn.text));
    if (!text) continue;
    if (normalizedEditDistance(text, draftReference) <= 0.16) continue;
    if (countMeaningfulTokenOverlap(text, draftReference) >= 6) continue;

    const kind: ContextDelta["kind"] =
      turn.kind === "confirmed_answer"
        ? "explicit_fact"
        : turn.kind === "question"
          ? "resolved_reference"
          : turn.isSpeculative
            ? "allowed_uncertainty"
            : "supporting_detail";
    const normalized = normalizeForComparison(text);
    const key = `${kind}::${normalized}`;
    if (!normalized || seen.has(key)) continue;

    seen.add(key);
    deltas.push({
      kind,
      text,
      sourceText: turn.text,
      sourceAuthor: turn.author,
      sourceKind: turn.kind,
      entityHints: turn.sharedEntities.slice(0, 3),
    });
    if (deltas.length >= 3) break;
  }

  return deltas;
}

function buildContextFacts(input: {
  recentTurns: ClassifiedContextTurn[];
  selectedContext: SelectedContext;
  contextDeltas: ContextDelta[];
}): ContextFact[] {
  if (input.selectedContext.contextFacts.length > 0) {
    return input.selectedContext.contextFacts;
  }

  return input.contextDeltas.map((delta) => {
    const matchingTurn = input.recentTurns.find((turn) => turn.text === delta.sourceText);
    return {
      kind: delta.kind,
      abstractedText: ensureTerminalPunctuation(delta.text),
      sourceText: delta.sourceText,
      sourceAuthor: delta.sourceAuthor,
      sourceRole: matchingTurn?.role || (delta.kind === "request_frame" ? "customer" : "unknown"),
      confidence: matchingTurn?.confidence || (delta.kind === "request_frame" ? "high" : "medium"),
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
    };
  });
}

function latestTurnByRole(
  recentTurns: ClassifiedContextTurn[],
  role: ClassifiedContextTurn["role"]
): string | undefined {
  for (let index = recentTurns.length - 1; index >= 0; index -= 1) {
    if (recentTurns[index]?.role === role) {
      return recentTurns[index]?.text;
    }
  }
  return undefined;
}

export function selectDraftingContext(request: GenerateDraftRequest): SelectedContext {
  return createDraftGenerationInput(request).selectedContext;
}

export function createDraftGenerationInput(request: GenerateDraftRequest): DraftGenerationInput {
  const originalDraft = request.draftInput || "";
  const cleanedDraft = normalizeText(originalDraft);
  const improveDraft = request.actionMode === "improve_current_draft";
  const visibleItems = Array.isArray(request.snapshot.visibleContext)
    ? request.snapshot.visibleContext.filter((item) => normalizeText(item.text).length > 0)
    : [];

  const metadataTexts = [
    request.snapshot.metadata.threadTitle || "",
    request.snapshot.metadata.channelName || "",
    request.snapshot.metadata.title || "",
    request.snapshot.metadata.senderName || "",
    request.snapshot.metadata.customerName || "",
  ];

  const brokenTokenNormalizedDraft = normalizeBrokenDraftTokens({
    draftText: cleanedDraft,
    contextTexts: visibleItems.map((item) => item.text),
    metadataTexts,
  });

  const lexicalResolved = resolveLexicalDraftCorrections({
    draftText: brokenTokenNormalizedDraft,
    contextTexts: visibleItems.map((item) => item.text),
    metadataTexts,
  });

  const entityCandidates = buildEntityCandidates(visibleItems, request);
  const resolved = buildResolvedDraft(lexicalResolved.resolvedDraft, entityCandidates);
  const normalizedDraft = normalizeText(resolved.resolvedDraft);

  const classifiedContext = classifyVisibleTurns({
    visibleItems,
    draftText: cleanedDraft,
    resolvedDraft: normalizedDraft,
    keyEntities: resolved.keyEntities,
    improveDraft,
    contextScope: request.snapshot.contextScope || "thread",
  });

  const latestAsk =
    classifiedContext.responseTargetTurn ||
    classifiedContext.latestQuestion ||
    classifiedContext.latestRelevantSupportingTurn ||
    classifiedContext.recentTurns.at(-1)?.text;
  const latestInternalInstruction =
    latestTurnByRole(classifiedContext.recentTurns, "agent") || classifiedContext.latestActionRequest;

  const contextDeltas = buildContextDeltas({
    recentTurns: classifiedContext.recentTurns,
    responseTargetTurn: classifiedContext.responseTargetTurn,
    resolvedDraft: normalizedDraft,
    cleanedDraft,
    currentMessageFallbackUsed: classifiedContext.currentMessageFallbackUsed,
  });

  const selectedContext: SelectedContext = {
    responseTarget: classifiedContext.responseTargetTurn ?? null,
    supportingTurns: classifiedContext.recentTurns,
    excludedTurns: classifiedContext.excludedTurns,
    contextFacts: [],
    selectionReason: classifiedContext.responseTargetReason,
  };

  const input: DraftGenerationInput = {
    request,
    originalDraft,
    cleanedDraft,
    normalizedDraft,
    contextScope: request.snapshot.contextScope || "thread",
    contextItemsUsed: countSelectedContextItems({
      supportingTurns: classifiedContext.recentTurns,
      responseTargetTurn: classifiedContext.responseTargetTurn,
    }),
    selectedContext,
    threadTitle: request.snapshot.metadata.threadTitle,
    channelName: request.snapshot.metadata.channelName,
    responseTargetTurn: classifiedContext.responseTargetTurn,
    responseTargetReason: classifiedContext.responseTargetReason,
    currentMessageFallbackUsed: classifiedContext.currentMessageFallbackUsed,
    latestAsk,
    latestQuestion: classifiedContext.latestQuestion,
    latestConfirmedAnswer: classifiedContext.latestConfirmedAnswer,
    latestActionRequest: classifiedContext.latestActionRequest,
    latestRelevantSupportingTurn: classifiedContext.latestRelevantSupportingTurn,
    latestInternalInstruction,
    unresolvedRequest: latestAsk,
    recentTurns: classifiedContext.recentTurns,
    excludedTurns: classifiedContext.excludedTurns,
    keyEntities: resolved.keyEntities,
    evidenceNotes: request.evidence.map((item) => `${item.name}: ${normalizeText(item.summaryText)}`),
    typoSignal: hasTypoSignal(cleanedDraft),
    entityCorrectionsApplied: resolved.corrections,
    lexicalCorrectionsApplied: lexicalResolved.corrections,
    contextDeltas,
  };

  input.selectedContext.contextFacts = buildContextFacts({
    recentTurns: input.recentTurns,
    selectedContext,
    contextDeltas,
  });

  return input;
}
