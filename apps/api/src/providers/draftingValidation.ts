import { ValidationError } from "../core/errors.js";
import {
  buildCommonLexicon,
  cleanTokenForMatch,
  countMeaningfulTokenOverlap,
  extractDraftTokens,
  extractMeaningfulTokens,
  GENERIC_STATUS_LEXICON_SET,
  normalizedEditDistance,
  normalizeForComparison,
  normalizeText,
  STOP_WORDS,
  typoDensityScore,
} from "./draftingLexical.js";
import {
  ALTERNATE_ROLE,
  PRIMARY_ROLE,
  type CleanedDraftCandidate,
  type ContextReplyCandidate,
  type DraftGenerationInput,
  type DraftSoftIssue,
  type DraftValidationOutcome,
  type DraftVariant,
} from "./draftingTypes.js";

type VariantKindKey =
  | "cleaned_draft"
  | "context_reply"
  | "default_primary"
  | "default_alternate";

function ensureTerminalPunctuation(value: string): string {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ValidationError("Model output was empty.", "INVALID_MODEL_OUTPUT");
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i);
  const candidate = fencedMatch?.[1]?.trim() || trimmed;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < firstBrace) {
    throw new ValidationError("Model output did not contain a JSON object.", "INVALID_MODEL_OUTPUT");
  }

  return candidate.slice(firstBrace, lastBrace + 1);
}

function parseModelPayload(raw: string): {
  warnings?: string[];
  variants?: Array<{ role?: string; text?: string }>;
} {
  try {
    return JSON.parse(extractJsonObject(raw));
  } catch (error) {
    throw new ValidationError(
      error instanceof Error ? error.message : "Failed to parse model output JSON.",
      "INVALID_MODEL_OUTPUT"
    );
  }
}

function parseSingleDraftPayload(raw: string): { warnings?: string[]; text?: string } {
  try {
    return JSON.parse(extractJsonObject(raw));
  } catch {
    return { text: normalizeText(raw) };
  }
}

function buildWordNgrams(value: string, size: number): Set<string> {
  const tokens = extractMeaningfulTokens(value);
  const grams = new Set<string>();
  if (tokens.length < size) return grams;

  for (let index = 0; index <= tokens.length - size; index += 1) {
    grams.add(tokens.slice(index, index + size).join(" "));
  }

  return grams;
}

function extractMentionCandidates(text: string): string[] {
  const matches = text.match(/@([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,2})/gu) ?? [];
  return matches.map((item) => item.replace(/^@/, "").trim());
}

function outputImportsExcludedTurn(output: string, turn: { text: string }): boolean {
  const overlap = countMeaningfulTokenOverlap(output, turn.text);
  const outputMentions = extractMentionCandidates(output).map((item) => normalizeForComparison(item));
  const turnMentions = extractMentionCandidates(turn.text).map((item) => normalizeForComparison(item));
  const sharedMention = turnMentions.some((mention) => outputMentions.includes(mention));
  return overlap >= 2 || sharedMention;
}

function outputCopiesSupportingContext(output: string, input: DraftGenerationInput): boolean {
  const scrubbedOutput = output.replace(/https?:\/\/[^\s]+/gi, "").replace(/[\w.]+@[\w.]+/gi, "");
  const outputNgrams = buildWordNgrams(scrubbedOutput, 4);
  if (outputNgrams.size === 0) return false;

  const draftBaseline = input.normalizedDraft || input.cleanedDraft;
  const scrubbedDraft = draftBaseline
    .replace(/https?:\/\/[^\s]+/gi, "")
    .replace(/[\w.]+@[\w.]+/gi, "");
  const draftNgrams = buildWordNgrams(scrubbedDraft, 4);
  const supportingDeltas = input.contextDeltas.filter(
    (delta) => delta.kind !== "request_frame" && Boolean(delta.sourceText)
  );

  for (const delta of supportingDeltas) {
    const sourceText = delta.sourceText || "";
    const scrubbedSource = sourceText
      .replace(/https?:\/\/[^\s]+/gi, "")
      .replace(/[\w.]+@[\w.]+/gi, "");
    const sourceNgrams = buildWordNgrams(scrubbedSource, 4);

    let copiedGrams = 0;
    for (const gram of outputNgrams) {
      if (sourceNgrams.has(gram) && !draftNgrams.has(gram)) {
        copiedGrams += 1;
      }
    }

    const sourceOverlap = countMeaningfulTokenOverlap(scrubbedOutput, scrubbedSource);
    const draftOverlap = countMeaningfulTokenOverlap(scrubbedOutput, scrubbedDraft);
    if (copiedGrams >= 2 || (sourceOverlap >= 8 && sourceOverlap >= draftOverlap + 2)) {
      return true;
    }
  }

  return false;
}

function contextReplyUsesDelta(output: string, deltas: DraftGenerationInput["contextDeltas"]): boolean {
  const outputNormalized = normalizeForComparison(output);
  return deltas.some((delta) => {
    const source = delta.sourceText || delta.text;
    return (
      countMeaningfulTokenOverlap(outputNormalized, delta.text) >= 2 ||
      countMeaningfulTokenOverlap(outputNormalized, source) >= 2 ||
      delta.entityHints.some((entity) =>
        normalizeForComparison(output).includes(normalizeForComparison(entity))
      )
    );
  });
}

function containsInventedSchedule(sourceText: string, outputText: string): boolean {
  const source = sourceText.toLowerCase();
  const output = outputText.toLowerCase();
  const timelinePattern =
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|launch week|tomorrow|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})\b/;
  return timelinePattern.test(output) && !timelinePattern.test(source);
}

function buildSourceBundle(input: DraftGenerationInput): string {
  return [
    input.originalDraft,
    input.normalizedDraft,
    input.threadTitle || "",
    input.channelName || "",
    input.responseTargetTurn || "",
    input.latestQuestion || "",
    input.latestConfirmedAnswer || "",
    input.latestActionRequest || "",
    input.latestRelevantSupportingTurn || "",
    ...input.keyEntities,
    ...input.request.snapshot.visibleContext.map((item) => item.text),
    ...input.recentTurns.map((item) => `${item.author}: ${item.text}`),
    ...input.excludedTurns.map((item) => `${item.author}: ${item.text}`),
    ...input.evidenceNotes,
  ]
    .filter(Boolean)
    .join("\n");
}

function isClarificationStyleReply(text: string): boolean {
  return (
    /\bclarify\b/i.test(text) ||
    /\bwhat do you mean\b/i.test(text) ||
    /\bwhat you mean by\b/i.test(text) ||
    /\bplease confirm\b/i.test(text) ||
    /\bterm is unclear\b/i.test(text) ||
    /\brefers to a specific\b/i.test(text)
  );
}

function looksSendableDraft(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (!/^[A-Z0-9"'(]/.test(normalized)) return false;
  if (!/[.!?]$/.test(normalized)) return false;
  if (typoDensityScore(normalized) >= 0.24) return false;
  if (/\b(?:itd|theu|hopefullt|reciev|mesaging|knoe|ud)\b/i.test(normalized)) return false;
  return true;
}

function buildSuspiciousTokenLexicon(input: DraftGenerationInput): Set<string> {
  return buildCommonLexicon({
    contextTexts: input.request.snapshot.visibleContext.map((item) => item.text),
    metadataTexts: [
      input.threadTitle || "",
      input.channelName || "",
      input.request.snapshot.metadata.title || "",
      input.request.snapshot.metadata.senderName || "",
      input.request.snapshot.metadata.customerName || "",
      ...input.evidenceNotes,
    ],
    keyEntities: input.keyEntities,
    draftTexts: [input.cleanedDraft, input.normalizedDraft],
  });
}

function bestSuspiciousTokenCandidate(token: string, lexicon: Set<string>): string | null {
  let best: { value: string; distance: number } | null = null;
  for (const candidate of lexicon) {
    if (Math.abs(candidate.length - token.length) > 3) continue;
    const distance = normalizedEditDistance(token, candidate);
    if (distance > 0.22) continue;
    const sharesEdge =
      token.charAt(0) === candidate.charAt(0) ||
      token.slice(-1) === candidate.slice(-1) ||
      candidate.includes(token.slice(1)) ||
      token.includes(candidate.slice(1));
    if (!sharesEdge) continue;
    if (!best || distance < best.distance) {
      best = { value: candidate, distance };
    }
  }
  return best?.value ?? null;
}

function draftMirrorsTurn(input: DraftGenerationInput, turn: DraftGenerationInput["excludedTurns"][number]): boolean {
  if (countMeaningfulTokenOverlap(turn.text, input.normalizedDraft || input.cleanedDraft) >= 2) {
    return true;
  }
  const normalizedDraft = normalizeForComparison(input.normalizedDraft || input.cleanedDraft);
  return turn.sharedEntities.some((entity) =>
    normalizedDraft.includes(normalizeForComparison(entity))
  );
}

function hasStatusContextSupport(input: DraftGenerationInput): boolean {
  const source = [
    input.latestQuestion,
    input.latestConfirmedAnswer,
    input.latestRelevantSupportingTurn,
    ...input.recentTurns.map((turn) => turn.text),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /\b(update|updated|fix|fixed|change|changed|revise|revised|integrat|added|removed|charged|resolved|posted|complete|completed|done|queue|queued)\b/.test(
    source
  );
}

function isShortDeclarativeStatusDraft(input: DraftGenerationInput): boolean {
  if (input.lexicalCorrectionsApplied.length === 0) return false;
  const resolved = normalizeText(input.normalizedDraft);
  if (!resolved || /\?/.test(resolved)) return false;
  const tokens = normalizeForComparison(resolved).split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 8) return false;
  return (
    tokens.some((token) => GENERIC_STATUS_LEXICON_SET.has(token)) &&
    (hasStatusContextSupport(input) ||
      input.lexicalCorrectionsApplied.some((correction) => correction.source === "lexicon"))
  );
}

function validateSharedDraftRules(
  text: string,
  input: DraftGenerationInput,
  lane: "cleaned" | "context"
): void {
  const sourceBundle = buildSourceBundle(input);
  if (containsInventedSchedule(sourceBundle, text)) {
    throw new ValidationError(
      `${lane === "cleaned" ? "Cleaned Draft" : "Context Reply"} introduced timeline details not grounded in the source.`,
      "INVALID_MODEL_OUTPUT"
    );
  }

  const entityRegression = input.entityCorrectionsApplied.some((correction) => {
    const normalizedText = normalizeForComparison(text);
    return (
      normalizedText.includes(normalizeForComparison(correction.from)) &&
      !normalizedText.includes(normalizeForComparison(correction.to))
    );
  });

  if (entityRegression) {
    throw new ValidationError(
      `${lane === "cleaned" ? "Cleaned Draft" : "Context Reply"} regressed a high-confidence entity correction.`,
      "INVALID_MODEL_OUTPUT"
    );
  }
}

function cleanedDraftImportsContext(text: string, input: DraftGenerationInput): boolean {
  const supportingDeltas = input.contextDeltas.filter((delta) => delta.kind !== "request_frame");
  const draftBaseline = input.originalDraft || input.cleanedDraft || input.normalizedDraft;
  const draftOverlap = countMeaningfulTokenOverlap(text, draftBaseline);
  const strongestSupportingOverlap = Math.max(
    0,
    ...supportingDeltas.map((delta) => countMeaningfulTokenOverlap(text, delta.sourceText || delta.text))
  );

  return (
    (outputCopiesSupportingContext(text, input) && strongestSupportingOverlap >= draftOverlap + 3) ||
    (contextReplyUsesDelta(text, supportingDeltas) &&
      strongestSupportingOverlap >= draftOverlap + 2 &&
      normalizedEditDistance(text, draftBaseline) > 0.24)
  );
}

function buildDraftVariant(
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
    id: `draft-${role}-${Date.now()}`,
    role: role as DraftVariant["role"],
    variantKind,
    label: labelByKind[variantKind],
    text,
    styleNotes: [...notesByKind[variantKind]],
  };
}

export function extractAssistantTextContent(content: unknown): string {
  if (typeof content === "string") return normalizeText(content);
  if (Array.isArray(content)) {
    return normalizeText(
      content
        .map((item) => extractAssistantTextContent(item))
        .join("")
    );
  }
  if (content && typeof content === "object") {
    const record = content as { text?: unknown; content?: unknown };
    if (typeof record.text === "string") return normalizeText(record.text);
    if (typeof record.content === "string") return normalizeText(record.content);
  }
  return "";
}

export function parseSingleDraftText(
  raw: string,
  preferredRole: string = PRIMARY_ROLE
): { text: string; warnings: string[] } {
  const payload = parseSingleDraftPayload(raw);
  let text = ensureTerminalPunctuation(String(payload.text || ""));
  let warnings = Array.isArray(payload.warnings)
    ? payload.warnings.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  if (!text) {
    try {
      const pairPayload = parseModelPayload(raw);
      const variants = Array.isArray(pairPayload.variants) ? pairPayload.variants : [];
      const fallbackVariant =
        variants.find((item) => item?.role === preferredRole) ??
        variants[preferredRole === ALTERNATE_ROLE ? 1 : 0] ??
        variants[0];
      text = ensureTerminalPunctuation(String(fallbackVariant?.text || ""));
      warnings = Array.isArray(pairPayload.warnings)
        ? pairPayload.warnings.filter(
            (item): item is string => typeof item === "string" && item.trim().length > 0
          )
        : warnings;
    } catch {
      // Keep the original validation failure below.
    }
  }

  if (!text) {
    throw new ValidationError("Model output included an empty draft.", "INVALID_MODEL_OUTPUT");
  }

  return { text, warnings };
}

export function findUnresolvedSuspiciousTokens(
  text: string,
  input: DraftGenerationInput
): string[] {
  const lexicon = buildSuspiciousTokenLexicon(input);
  const suspicious = new Set<string>();

  for (const token of extractDraftTokens(text)) {
    const normalized = cleanTokenForMatch(token);
    if (!normalized || normalized.length < 4) continue;
    if (!/^[a-z]+$/.test(normalized)) continue;
    if (STOP_WORDS.has(normalized)) continue;
    if (GENERIC_STATUS_LEXICON_SET.has(normalized)) continue;
    if (lexicon.has(normalized)) continue;
    if (input.keyEntities.some((entity) => normalizeForComparison(entity) === normalized)) continue;

    const nearestCandidate = bestSuspiciousTokenCandidate(normalized, lexicon);
    const looksBroken =
      /q(?!u)/.test(normalized) ||
      /(.)\1{2,}/.test(normalized) ||
      (normalized.startsWith("a") && lexicon.has(normalized.slice(1))) ||
      (normalized.startsWith("q") && lexicon.has(normalized.slice(1))) ||
      Boolean(nearestCandidate);

    if (looksBroken) {
      suspicious.add(normalized);
    }
  }

  return [...suspicious].slice(0, 4);
}

export function validateCleanedDraftCandidate(
  text: string,
  input: DraftGenerationInput
): CleanedDraftCandidate {
  const normalized = ensureTerminalPunctuation(text);
  validateSharedDraftRules(normalized, input, "cleaned");

  if (cleanedDraftImportsContext(normalized, input)) {
    throw new ValidationError(
      "Cleaned Draft imported supporting context instead of only cleaning the draft.",
      "INVALID_MODEL_OUTPUT"
    );
  }

  const softIssues: CleanedDraftCandidate["softIssues"] = [];
  const warnings: string[] = [];
  const suspiciousTokens = findUnresolvedSuspiciousTokens(normalized, input);

  const changedEnough =
    !input.typoSignal ||
    normalizedEditDistance(normalized, input.cleanedDraft || input.normalizedDraft) > 0.12;
  if (!changedEnough) {
    softIssues.push("cleanup_changed_too_little");
    warnings.push("Cleaned Draft stayed too close to the malformed input.");
  }

  if (!looksSendableDraft(normalized)) {
    softIssues.push("cleanup_not_sendable");
    warnings.push("Cleaned Draft still looks rough or not fully sendable.");
  }

  if (suspiciousTokens.length > 0) {
    softIssues.push("cleanup_has_unresolved_tokens");
    warnings.push(
      ...suspiciousTokens.map(
        (token) => `Unclear reference to '${token}' - possible typo or missing context.`
      )
    );
  }

  if (
    input.excludedTurns.some(
      (turn) =>
        (turn.hasDirectRequest || turn.isSpeculative) &&
        !draftMirrorsTurn(input, turn) &&
        outputImportsExcludedTurn(normalized, turn)
    )
  ) {
    softIssues.push("imported_excluded_context");
    warnings.push("Cleaned Draft imported excluded context.");
  }

  if (countMeaningfulTokenOverlap(normalized, input.responseTargetTurn || "") >= 6) {
    softIssues.push("cleanup_context_heavy");
    warnings.push("Cleaned Draft became too context-heavy instead of staying draft-led.");
  }

  let qualityScore = 100;
  if (softIssues.includes("cleanup_changed_too_little")) qualityScore -= 18;
  if (softIssues.includes("cleanup_not_sendable")) qualityScore -= 24;
  if (softIssues.includes("cleanup_has_unresolved_tokens")) qualityScore -= 20;
  if (softIssues.includes("cleanup_context_heavy")) qualityScore -= 16;
  if (softIssues.includes("imported_excluded_context")) qualityScore -= 20;

  return {
    text: normalized,
    warnings,
    softIssues,
    suspiciousTokens,
    qualityScore,
    shouldRetry:
      softIssues.includes("cleanup_not_sendable") || (softIssues.length > 0 && qualityScore < 50),
  };
}

export function validateContextReplyCandidate(
  text: string,
  input: DraftGenerationInput,
  cleanedDraftText: string
): ContextReplyCandidate {
  const normalized = ensureTerminalPunctuation(text);
  validateSharedDraftRules(normalized, input, "context");

  if (outputCopiesSupportingContext(normalized, input)) {
    throw new ValidationError(
      "Context Reply copied teammate or supporting context too directly.",
      "INVALID_MODEL_OUTPUT"
    );
  }

  const warnings: string[] = [];
  const softIssues: DraftSoftIssue[] = [];
  const hasContextDeltas = input.contextDeltas.length > 0;
  const usesContextFact = hasContextDeltas ? contextReplyUsesDelta(normalized, input.contextDeltas) : false;

  if (hasContextDeltas && !usesContextFact) {
    softIssues.push("context_not_relevant_enough");
    warnings.push("Context Reply did not use the strongest grounded support.");
  }

  if (normalizedEditDistance(normalized, cleanedDraftText) <= 0.14) {
    softIssues.push("alternate_not_better_than_primary");
    warnings.push("Context Reply was too close to the Cleaned Draft.");
  }

  if (isShortDeclarativeStatusDraft(input) && isClarificationStyleReply(normalized)) {
    softIssues.push("clarification_instead_of_status");
    warnings.push(
      "Context Reply asked for clarification instead of keeping the resolved status path."
    );
  }

  if (
    input.excludedTurns.some(
      (turn) =>
        (turn.hasDirectRequest || turn.isSpeculative) &&
        !draftMirrorsTurn(input, turn) &&
        outputImportsExcludedTurn(normalized, turn)
    )
  ) {
    softIssues.push("imported_excluded_context");
    warnings.push(
      "Context Reply imported extra details that do not support the main discussion."
    );
  }

  let qualityScore = 100;
  for (const issue of softIssues) {
    if (issue === "context_not_relevant_enough") qualityScore -= 14;
    if (issue === "alternate_not_better_than_primary") qualityScore -= 14;
    if (issue === "clarification_instead_of_status") qualityScore -= 18;
    if (issue === "imported_excluded_context") qualityScore -= 52;
  }

  return {
    text: normalized,
    warnings,
    softIssues,
    qualityScore,
    shouldRetry: softIssues.length > 0 && qualityScore < 50,
  };
}

function scoreValidationOutcome(params: {
  warnings: string[];
  softIssues: DraftSoftIssue[];
}): number {
  let score = 100;
  for (const issue of params.softIssues) {
    if (issue === "cleaned_too_similar") score -= 25;
    if (issue === "cleaned_too_context_heavy") score -= 20;
    if (issue === "context_too_similar") score -= 20;
    if (issue === "context_copied_too_directly") score -= 22;
    if (issue === "context_not_relevant_enough") score -= 14;
    if (issue === "alternate_not_better_than_primary") score -= 14;
    if (issue === "limited_context") score -= 10;
    if (issue === "clarification_instead_of_status") score -= 18;
  }
  score -= params.warnings.length * 2;
  return score;
}

function hasUsableContext(input: DraftGenerationInput): boolean {
  return (
    Boolean(input.selectedContext.responseTarget) ||
    input.selectedContext.supportingTurns.length > 0 ||
    input.selectedContext.contextFacts.length > 0
  );
}

export function parseAndValidateModelDrafts(
  raw: string,
  input: DraftGenerationInput
): DraftValidationOutcome {
  const improveDraft = input.request.actionMode === "improve_current_draft";
  const usableContext = hasUsableContext(input);
  const payload = parseModelPayload(raw);
  const variants = Array.isArray(payload.variants) ? payload.variants : [];
  if (variants.length !== 2) {
    throw new ValidationError("Model output must include exactly two variants.", "INVALID_MODEL_OUTPUT");
  }

  const primaryCandidate = variants.find((item) => item?.role === PRIMARY_ROLE) ?? variants[0];
  const alternateCandidate = variants.find((item) => item?.role === ALTERNATE_ROLE) ?? variants[1];
  const primaryText = ensureTerminalPunctuation(String(primaryCandidate?.text || ""));
  const alternateText = ensureTerminalPunctuation(String(alternateCandidate?.text || ""));
  if (!primaryText || !alternateText) {
    throw new ValidationError("Model output included an empty variant.", "INVALID_MODEL_OUTPUT");
  }

  const drafts: [DraftVariant, DraftVariant] = [
    buildDraftVariant(
      PRIMARY_ROLE,
      primaryText,
      input.contextItemsUsed > 0,
      improveDraft ? "cleaned_draft" : "default_primary"
    ),
    buildDraftVariant(
      ALTERNATE_ROLE,
      alternateText,
      input.contextItemsUsed > 0,
      improveDraft ? "context_reply" : "default_alternate"
    ),
  ];

  const warnings = Array.isArray(payload.warnings)
    ? payload.warnings.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const softIssues: DraftSoftIssue[] = [];

  if (improveDraft && !usableContext) {
    warnings.push("Context Reply used limited context; output is based mostly on your draft.");
    softIssues.push("limited_context");
  }

  const sourceBundle = buildSourceBundle(input);
  const bestVariantDistance =
    input.cleanedDraft.length > 0
      ? Math.min(...drafts.map((variant) => normalizedEditDistance(variant.text, input.cleanedDraft)))
      : 1;
  const unchangedPrimary =
    input.cleanedDraft.length > 0 &&
    normalizeForComparison(drafts[0].text) === normalizeForComparison(input.cleanedDraft);
  const cleanedDraftDistance =
    input.normalizedDraft.length > 0
      ? normalizedEditDistance(drafts[0].text, input.normalizedDraft)
      : normalizedEditDistance(drafts[0].text, input.cleanedDraft);
  const cleanedVsContextDistance = normalizedEditDistance(drafts[0].text, drafts[1].text);
  const inventedSchedule = drafts.some((variant) => containsInventedSchedule(sourceBundle, variant.text));
  const entityRegression = input.entityCorrectionsApplied.some((correction) =>
    drafts.some((variant) => {
      const normalizedText = normalizeForComparison(variant.text);
      return (
        normalizedText.includes(normalizeForComparison(correction.from)) &&
        !normalizedText.includes(normalizeForComparison(correction.to))
      );
    })
  );
  const overStructuredPrimary =
    input.request.actionMode !== "draft_from_context" &&
    drafts[0].text.split("\n").length > 3 &&
    /(^|\n)[•\-]/.test(drafts[0].text);
  const importedExcludedActionRequest =
    improveDraft &&
    input.excludedTurns.some(
      (turn) => turn.hasDirectRequest && !draftMirrorsTurn(input, turn) && outputImportsExcludedTurn(drafts[1].text, turn)
    );
  const importedExcludedSpeculation =
    improveDraft &&
    input.excludedTurns.some(
      (turn) => turn.isSpeculative && !draftMirrorsTurn(input, turn) && outputImportsExcludedTurn(drafts[1].text, turn)
    );

  if (inventedSchedule) {
    throw new ValidationError(
      "Model output introduced timeline details not grounded in the source.",
      "INVALID_MODEL_OUTPUT"
    );
  }
  if (entityRegression) {
    throw new ValidationError(
      "Model output regressed a high-confidence entity correction.",
      "INVALID_MODEL_OUTPUT"
    );
  }
  if (overStructuredPrimary) {
    throw new ValidationError(
      "Model output added unnecessary structure to the primary reply.",
      "INVALID_MODEL_OUTPUT"
    );
  }
  if (importedExcludedActionRequest) {
    throw new ValidationError(
      "Context Reply imported a side request that was not part of the typed draft.",
      "INVALID_MODEL_OUTPUT"
    );
  }
  if (importedExcludedSpeculation) {
    throw new ValidationError(
      "Context Reply imported speculative context that was not aligned with the typed draft.",
      "INVALID_MODEL_OUTPUT"
    );
  }

  const cleanedDraftTooContextHeavy =
    improveDraft && input.normalizedDraft.length > 0 && cleanedDraftDistance > 0.42;
  const hasContextDeltas = improveDraft && input.contextDeltas.length > 0;
  const alternateUsesDelta = hasContextDeltas ? contextReplyUsesDelta(drafts[1].text, input.contextDeltas) : false;
  const collapsedImproveDraftOptions =
    improveDraft && usableContext && (cleanedVsContextDistance <= 0.14 || (hasContextDeltas && !alternateUsesDelta));
  const clarificationInsteadOfStatus =
    improveDraft && isShortDeclarativeStatusDraft(input) && isClarificationStyleReply(drafts[1].text);
  const copiedSupportingContext = improveDraft && outputCopiesSupportingContext(drafts[1].text, input);

  if (
    improveDraft &&
    input.cleanedDraft.length > 0 &&
    input.cleanedDraft.length <= 220 &&
    typoDensityScore(input.cleanedDraft) >= 0.45 &&
    (unchangedPrimary || bestVariantDistance <= 0.08)
  ) {
    softIssues.push("cleaned_too_similar");
  }
  if (cleanedDraftTooContextHeavy) {
    softIssues.push("cleaned_too_context_heavy");
  }
  if (collapsedImproveDraftOptions) {
    softIssues.push("context_too_similar");
  }
  if (copiedSupportingContext) {
    softIssues.push("context_copied_too_directly");
  }
  if (clarificationInsteadOfStatus) {
    softIssues.push("clarification_instead_of_status");
  }

  const qualityScore = scoreValidationOutcome({ warnings, softIssues });
  return {
    drafts,
    warnings,
    softIssues,
    qualityScore,
    shouldRetry:
      softIssues.includes("context_copied_too_directly") ||
      (softIssues.length > 0 && qualityScore < 50) ||
      (input.request.actionMode !== "improve_current_draft" &&
        input.cleanedDraft.length > 0 &&
        input.cleanedDraft.length <= 220 &&
        typoDensityScore(input.cleanedDraft) >= 0.45 &&
        (unchangedPrimary || bestVariantDistance <= 0.08)),
  };
}

export function selectPreferredLlmCleanupCandidate(options: {
  modelCandidates: CleanedDraftCandidate[];
}): CleanedDraftCandidate | null {
  return options.modelCandidates
    .filter((candidate) => !hasUnsafeCleanupIssues(candidate))
    .reduce<CleanedDraftCandidate | null>((best, candidate) => {
      if (!best) return candidate;

      if (candidate.qualityScore !== best.qualityScore) {
        return candidate.qualityScore > best.qualityScore ? candidate : best;
      }

      if (candidate.shouldRetry !== best.shouldRetry) {
        return candidate.shouldRetry ? best : candidate;
      }

      if (candidate.warnings.length !== best.warnings.length) {
        return candidate.warnings.length < best.warnings.length ? candidate : best;
      }

      return candidate.text.length >= best.text.length ? candidate : best;
    }, null);
}

export function selectPreferredContextReplyCandidate(options: {
  modelCandidates: ContextReplyCandidate[];
}): ContextReplyCandidate | null {
  return options.modelCandidates
    .filter((candidate) => !candidate.softIssues.includes("imported_excluded_context"))
    .reduce<ContextReplyCandidate | null>((best, candidate) => {
      if (!best) return candidate;

      if (candidate.qualityScore !== best.qualityScore) {
        return candidate.qualityScore > best.qualityScore ? candidate : best;
      }

      if (candidate.shouldRetry !== best.shouldRetry) {
        return candidate.shouldRetry ? best : candidate;
      }

      if (candidate.warnings.length !== best.warnings.length) {
        return candidate.warnings.length < best.warnings.length ? candidate : best;
      }

      return candidate.text.length >= best.text.length ? candidate : best;
    }, null);
}

function hasUnsafeCleanupIssues(candidate: CleanedDraftCandidate): boolean {
  return (
    candidate.softIssues.includes("cleanup_not_sendable") ||
    candidate.softIssues.includes("cleanup_context_heavy") ||
    candidate.softIssues.includes("imported_excluded_context")
  );
}
