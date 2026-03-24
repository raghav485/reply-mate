import type { DraftGenerationInput } from "./draftingTypes.js";
import {
  normalizedEditDistance,
  normalizeText,
  typoDensityScore,
} from "./draftingLexical.js";

function getContextFramingLines(input: DraftGenerationInput): string[] {
  const sources = new Set(input.request.snapshot.visibleContext.map((item) => item.source));

  if (input.contextScope === "page" || sources.has("visible_page")) {
    return [
      "Visible page context (lower confidence): nearby on-screen text captured around the active composer.",
      "This context may be partial or incomplete. Do not overclaim chronology, authorship, or hidden conversation state.",
    ];
  }
  if (sources.has("visible_email_thread")) {
    return [
      "Captured email thread context: use the visible email chain the user is replying to as strong grounding.",
    ];
  }
  if (sources.has("quoted_email")) {
    return [
      "Captured quoted email context: use it as email-thread evidence, but be careful with incomplete quoted fragments.",
    ];
  }
  if (input.contextScope === "thread") {
    return [
      "Captured thread context: use it when it directly improves correctness, reference resolution, or factual grounding.",
    ];
  }
  if (input.contextScope === "channel") {
    return [
      "Captured channel context: use it when it directly improves correctness, reference resolution, or factual grounding.",
    ];
  }
  return ["No captured conversation context is available."];
}

function buildContextFacts(input: DraftGenerationInput) {
  if (input.selectedContext.contextFacts.length > 0) {
    return input.selectedContext.contextFacts;
  }

  return input.contextDeltas.map((delta) => {
    const matchingTurn = input.recentTurns.find((turn) => turn.text === delta.sourceText);
    return {
      kind: delta.kind,
      abstractedText: delta.text,
      sourceText: delta.sourceText,
      sourceAuthor: delta.sourceAuthor,
      sourceRole: matchingTurn?.role,
      confidence: matchingTurn?.confidence || "medium",
      relevance: matchingTurn?.relevanceScore || 1,
    };
  });
}

function hasUsableContext(input: DraftGenerationInput): boolean {
  return (
    Boolean(input.selectedContext.responseTarget) ||
    input.selectedContext.supportingTurns.length > 0 ||
    input.selectedContext.contextFacts.length > 0
  );
}

function isShortDeclarativeStatusDraft(input: DraftGenerationInput): boolean {
  if (input.lexicalCorrectionsApplied.length === 0) return false;
  const resolved = normalizeText(input.normalizedDraft);
  if (!resolved || resolved.includes("?")) return false;
  const tokens = resolved
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0 || tokens.length > 8) return false;
  return tokens.some((token) =>
    ["updated", "completed", "sent", "fixed", "approved", "added", "removed", "queued", "integrated", "charged", "resolved", "posted", "created"].includes(
      token
    )
  );
}

export function buildCleanedDraftPrompt(
  input: DraftGenerationInput,
  strictRetry = false
): { system: string; user: string } {
  const correctionLines =
    input.entityCorrectionsApplied.length > 0
      ? input.entityCorrectionsApplied
          .map((item) => `- ${item.from} -> ${item.to} (${item.source})`)
          .join("\n")
      : "- none";
  const lexicalCorrectionLines =
    input.lexicalCorrectionsApplied.length > 0
      ? input.lexicalCorrectionsApplied
          .map((item) => `- ${item.from} -> ${item.to} (${item.source})`)
          .join("\n")
      : "- none";

  return {
    system: [
      "You are ReplyMate.",
      "Clean the user's draft into grammatical, sendable English.",
      "You MUST fix every spelling error, typo, punctuation issue, capitalization issue, and layout problem you can safely resolve.",
      "Preserve meaning, keep corrected entities, and do not import facts from context.",
      "The output must remain a cleaned version of the user's draft, not a contextual answer.",
      "Return JSON only.",
    ].join(" "),
    user: [
      'Return JSON with this shape: {"text":"...","warnings":["..."]}',
      "",
      `Tone: ${input.request.tonePreset}`,
      strictRetry
        ? "The previous cleanup stayed too rough. Rewrite more aggressively while preserving meaning and make the result fully sendable."
        : "Rewrite the draft so it is clean, grammatical, polished, and sendable.",
      "",
      "Original draft:",
      input.cleanedDraft || "(empty)",
      "",
      "Normalized draft after high-confidence corrections:",
      input.normalizedDraft || "(empty)",
      "",
      "Lexical corrections already applied:",
      lexicalCorrectionLines,
      "",
      "Entity corrections already applied:",
      correctionLines,
      "",
      "Rules:",
      "- Fully clean grammar, spelling, punctuation, capitalization, whitespace, and readability.",
      "- Fix obvious broken tokens and typo fragments whenever you can do so safely.",
      "- Keep the same answer path and meaning.",
      "- Do not import teammate context, side requests, or extra facts.",
      "- Do not answer the thread from context here; only clean the draft itself.",
    ].join("\n"),
  };
}

export function buildContextReplyPrompt(
  input: DraftGenerationInput,
  cleanedDraftText: string,
  strictRetry = false
): { system: string; user: string } {
  const contextFacts = buildContextFacts(input)
    .filter((fact) => fact.abstractedText)
    .map(
      (fact) =>
        `- ${fact.kind}: ${fact.abstractedText}${
          fact.sourceAuthor ? ` [source: ${fact.sourceAuthor}]` : ""
        }`
    )
    .join("\n");
  const excludedContextLines =
    input.excludedTurns.length > 0
      ? input.excludedTurns
          .map((item) => `- ${item.author} (${item.kind}): ${item.text}`)
          .join("\n")
      : "- none";
  const contextFramingLines = getContextFramingLines(input)
    .map((line) => `- ${line}`)
    .join("\n");

  return {
    system: [
      "You are ReplyMate.",
      "Write a stronger context-aware reply starting from the accepted cleaned draft.",
      "Use teammate or thread context as supporting evidence, not as reply wording.",
      "Do not quote or closely paraphrase teammate/internal context. Do not just mechanically append facts.",
      "Keep the same answer path as the cleaned draft unless grounded context clearly sharpens it.",
      "Return JSON only.",
    ].join(" "),
    user: [
      'Return JSON with this shape: {"text":"...","warnings":["..."]}',
      "",
      strictRetry
        ? "The previous alternate was either too weak, too similar to the cleaned draft, or copied context too directly."
        : "Write one stronger context-grounded reply.",
      "",
      `Tone: ${input.request.tonePreset}`,
      "",
      "Accepted Cleaned Draft:",
      cleanedDraftText,
      "",
      `Response target: ${input.responseTargetTurn || input.latestAsk || "none"}`,
      "",
      "Context constraints:",
      contextFramingLines || "- none",
      "",
      "Supporting context facts:",
      contextFacts || "- none",
      "",
      "Excluded context:",
      excludedContextLines || "- none",
      "",
      "Rules:",
      "- Answer the response target directly.",
      "- Start from the accepted cleaned draft and keep the same answer path.",
      "- Use supporting facts as evidence only.",
      "- Do not transplant teammate/internal wording into the reply.",
      "- Make the alternate materially more helpful than the cleaned draft when useful context exists.",
      "- Ensure the output reads as a single, natural, and coherent message.",
      "- Do not invent commitments, dates, timelines, or unsupported facts.",
    ].join("\n"),
  };
}

export function buildDraftingPrompt(
  input: DraftGenerationInput,
  strictRetry = false
): { system: string; user: string } {
  const improveDraft = input.request.actionMode === "improve_current_draft";
  const system = [
    "You are ReplyMate, a context-aware writing assistant for short customer-facing replies.",
    "Fix spelling, grammar, capitalization, punctuation, names, and readability before optimizing tone.",
    "Preserve the user's intent and keep the response grounded in the supplied context.",
    "Use the supplied captured context only when it improves correctness, reference resolution, or factual grounding.",
    "Never invent commitments, dates, timelines, promises, or facts.",
    "Return JSON only.",
  ].join(" ");

  const alignedContextLines =
    input.recentTurns.length > 0
      ? input.recentTurns
          .map((item) => `- ${item.author} (${item.kind}, ${item.confidence}): ${item.text}`)
          .join("\n")
      : "- none";
  const excludedContextLines =
    input.excludedTurns.length > 0
      ? input.excludedTurns.map((item) => `- ${item.author} (${item.kind}): ${item.text}`).join("\n")
      : "- none";
  const evidenceLines =
    input.evidenceNotes.length > 0 ? input.evidenceNotes.map((item) => `- ${item}`).join("\n") : "- none";
  const entityLines =
    input.keyEntities.length > 0 ? input.keyEntities.map((item) => `- ${item}`).join("\n") : "- none";
  const correctionLines =
    input.entityCorrectionsApplied.length > 0
      ? input.entityCorrectionsApplied
          .map((item) => `- ${item.from} -> ${item.to} (${item.source})`)
          .join("\n")
      : "- none";
  const lexicalCorrectionLines =
    input.lexicalCorrectionsApplied.length > 0
      ? input.lexicalCorrectionsApplied
          .map((item) => `- ${item.from} -> ${item.to} (${item.source})`)
          .join("\n")
      : "- none";
  const contextDeltaLines =
    input.contextDeltas.length > 0
      ? input.contextDeltas
          .map((item) => {
            const source = item.sourceAuthor ? ` [source: ${item.sourceAuthor}]` : "";
            return `- ${item.kind}: ${item.text}${source}`;
          })
          .join("\n")
      : "- none";

  const cleanedTooSimilar =
    improveDraft &&
    input.cleanedDraft.length > 0 &&
    input.cleanedDraft.length <= 220 &&
    typoDensityScore(input.cleanedDraft) >= 0.45 &&
    input.typoSignal;
  const cleanedTooContextHeavy =
    improveDraft &&
    input.normalizedDraft.length > 0 &&
    normalizedEditDistance(input.cleanedDraft, input.normalizedDraft) <= 0.18;
  const limitedContext = improveDraft && !hasUsableContext(input);
  const correctedStatusDraft = improveDraft && isShortDeclarativeStatusDraft(input);
  const contextFramingLines = getContextFramingLines(input).map((line) => `- ${line}`).join("\n");

  const correctionPressure = strictRetry
    ? improveDraft
      ? [
          "The previous attempt did not clearly separate a minimal cleanup from a context-grounded final reply.",
          cleanedTooSimilar
            ? "Make the primary reply a true cleanup of the resolved draft, correcting errors more clearly while preserving meaning."
            : "",
          cleanedTooContextHeavy
            ? "Keep the primary reply very close to the resolved draft. Do not add contextual facts or reformulate it into the final answer."
            : "",
          "Make the alternate reply meaningfully more context-grounded than the cleaned draft when the captured context provides useful information.",
          correctedStatusDraft
            ? "The resolved draft is already a clear short status update after high-confidence correction. Keep the alternate reply on that same status path and do not ask the user to clarify the corrected word."
            : "",
          limitedContext ? "If context is weak, keep the alternate polished but do not invent new facts." : "",
        ]
          .filter(Boolean)
          .join(" ")
      : "The previous attempt stayed too close to the original or missed important corrections. Make stronger corrections while preserving intent."
    : improveDraft
      ? "Return one minimal cleanup and one best sendable context-grounded reply."
      : "Write the best corrected response first, then a safer alternate.";

  const commonUserLines = [
    "Return exactly 2 variants in JSON with this shape:",
    '{"warnings":["..."],"variants":[{"role":"primary","text":"..."},{"role":"alternate","text":"..."}]}',
    "",
    `Mode: ${input.request.actionMode}`,
    `Tone: ${input.request.tonePreset}`,
    `Context scope: ${input.contextScope}`,
    correctionPressure,
    "",
    "Original draft:",
    input.cleanedDraft || "(empty)",
    "",
    "Normalized draft after high-confidence corrections:",
    input.normalizedDraft || "(empty)",
    "",
    "Lexical corrections applied:",
    lexicalCorrectionLines,
    "",
    "Context-derived entity corrections:",
    correctionLines,
    "",
    "Key entities:",
    entityLines,
    "",
    "Page metadata:",
    `- Thread title: ${input.threadTitle || "none"}`,
    `- Channel name: ${input.channelName || "none"}`,
    "",
    "Context framing:",
    contextFramingLines,
    "",
    "Context digest:",
    `- Response target: ${input.responseTargetTurn || "none"}`,
    `- Latest relevant question: ${input.latestQuestion || input.latestAsk || "none"}`,
    `- Latest confirmed finding: ${input.latestConfirmedAnswer || "none"}`,
    `- Latest side request: ${input.latestActionRequest || "none"}`,
    `- Latest supporting turn: ${input.latestRelevantSupportingTurn || "none"}`,
    "",
    "Allowed aligned context:",
    alignedContextLines,
    "",
    "Preferred grounded context deltas for the Context Reply:",
    contextDeltaLines,
    "",
    "Excluded context that must not be imported into the Context Reply:",
    excludedContextLines,
    "",
    "Evidence:",
    evidenceLines,
    "",
  ];

  const outputRules = improveDraft
    ? [
        "Output rules for Improve Draft:",
        "- Primary Reply is the Cleaned Draft.",
        "- Primary Reply must stay very close to the resolved draft and only fix spelling, grammar, punctuation, capitalization, whitespace, layout, and high-confidence entity typos.",
        "- Primary Reply must not answer from context, add facts, or add commitments beyond the resolved draft.",
        "- Alternate Reply is the Context Reply.",
        "- Alternate Reply should be the best polished reply you would actually send when the captured context is useful.",
        "- Alternate Reply may move beyond the user's wording when the draft is rough, incomplete, or phrased as a question instead of the actual final reply.",
        "- If the user typed a rough question, the Alternate Reply may answer it properly when the captured context supports that answer.",
        "- If the user typed a near-final reply, the Alternate Reply may still improve wording, clarity, and contextual grounding.",
        "- Alternate Reply is draft-led: use only context that directly supports, completes, or sharpens the same answer path as the resolved draft.",
        "- Treat teammate or internal context as supporting evidence, not as reply wording.",
        "- Do not quote or closely paraphrase teammate context unless the user explicitly asked for a quote.",
        "- The Alternate Reply should answer the response target directly in the user's own reply voice.",
        "- When grounded context deltas are provided, Alternate Reply must incorporate at least one of them in a natural way.",
        "- Do not import teammate assignments, unrelated mentions, or side requests unless the resolved draft already includes them.",
        "- Do not convert excluded speculation into polished fact. If uncertainty is already in the resolved draft, preserve it as uncertainty.",
        "- If the resolved draft reflects a high-confidence correction to a malformed status word, use that corrected meaning instead of asking the user what the malformed word means.",
        "- If a name or entity was clearly corrected from context, both variants must use the corrected form.",
        "- Do not invent commitments, dates, timelines, or unsupported facts.",
        "- Do not use bullet points unless the user explicitly asked for structure or the content truly requires a short list.",
      ]
    : [
        "Output rules:",
        "- Primary Reply should be the best answer you would actually send.",
        "- Alternate Reply should be safer, more conservative, and closer to the user's original wording.",
        "- If a name or entity was clearly corrected from context, use the corrected form.",
        "- Do not mention context or evidence unless it is naturally relevant.",
        "- Keep the tone natural and businesslike, not robotic.",
        "- Do not use bullet points unless the user explicitly asked for structure or the content requires a short list.",
      ];

  return {
    system,
    user: [...commonUserLines, ...outputRules].join("\n"),
  };
}
