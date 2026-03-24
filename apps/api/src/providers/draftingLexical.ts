import type {
  DraftLexicalCorrection,
  DraftLexicalCorrectionSource,
  LexicalCandidate,
} from "./draftingTypes.js";

export const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "because",
  "but",
  "can",
  "could",
  "for",
  "from",
  "get",
  "had",
  "has",
  "have",
  "hey",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "let",
  "like",
  "may",
  "me",
  "my",
  "not",
  "of",
  "on",
  "or",
  "our",
  "please",
  "so",
  "that",
  "the",
  "their",
  "them",
  "there",
  "they",
  "this",
  "to",
  "up",
  "us",
  "was",
  "we",
  "what",
  "when",
  "why",
  "will",
  "with",
  "you",
  "your",
]);

const GENERIC_STATUS_LEXICON = [
  "updated",
  "completed",
  "sent",
  "fixed",
  "approved",
  "added",
  "removed",
  "queued",
  "integrated",
  "charged",
  "resolved",
  "posted",
  "created",
];

export const GENERIC_STATUS_LEXICON_SET = new Set(GENERIC_STATUS_LEXICON);

export const COMMON_SENDABLE_LEXICON = new Set([
  "account",
  "after",
  "again",
  "already",
  "also",
  "appointment",
  "appointments",
  "automated",
  "before",
  "because",
  "calls",
  "call",
  "channel",
  "changed",
  "classified",
  "coming",
  "completed",
  "confirmed",
  "customer",
  "details",
  "directly",
  "fixed",
  "follow",
  "followup",
  "follow-up",
  "good",
  "incoming",
  "issue",
  "launch",
  "line",
  "message",
  "messages",
  "missed",
  "notification",
  "outage",
  "person",
  "problem",
  "receive",
  "received",
  "receiving",
  "scheduled",
  "seconds",
  "setting",
  "settings",
  "should",
  "still",
  "think",
  "through",
  "time",
  "timeout",
  "today",
  "tomorrow",
  "turned",
  "update",
  "updated",
  "voicemail",
  "week",
  "weeks",
]);

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeForComparison(value: string): string {
  return normalizeText(value).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "");
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost
      );
    }
    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[right.length];
}

export function normalizedEditDistance(left: string, right: string): number {
  const leftNormalized = normalizeForComparison(left);
  const rightNormalized = normalizeForComparison(right);
  if (!leftNormalized && !rightNormalized) return 0;
  return (
    levenshteinDistance(leftNormalized, rightNormalized) /
    Math.max(leftNormalized.length, rightNormalized.length, 1)
  );
}

export function extractMeaningfulTokens(value: string): string[] {
  return normalizeForComparison(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

export function extractDraftTokens(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function cleanTokenForMatch(token: string): string {
  return normalizeForComparison(token.replace(/^[@("'`]+|[.,!?;:)"'`]+$/g, ""));
}

export function countMeaningfulTokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(extractMeaningfulTokens(left));
  const rightTokens = new Set(extractMeaningfulTokens(right));
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

function addLexicalCandidate(
  map: Map<string, LexicalCandidate>,
  value: string,
  source: DraftLexicalCorrectionSource,
  weight: number
): void {
  const normalized = normalizeForComparison(value);
  if (!normalized || normalized.length < 4) return;
  if (!/^[a-z]+$/.test(normalized)) return;

  const existing = map.get(normalized);
  if (!existing || existing.weight < weight) {
    map.set(normalized, {
      value: normalized,
      normalized,
      source,
      weight,
    });
  }
}

function buildLexicalCandidates(options: {
  contextTexts: string[];
  metadataTexts: string[];
}): LexicalCandidate[] {
  const candidates = new Map<string, LexicalCandidate>();

  for (const text of options.contextTexts) {
    for (const token of extractMeaningfulTokens(text)) {
      addLexicalCandidate(candidates, token, "context", 3);
    }
  }

  for (const text of options.metadataTexts) {
    for (const token of extractMeaningfulTokens(text)) {
      addLexicalCandidate(candidates, token, "metadata", 2);
    }
  }

  for (const token of GENERIC_STATUS_LEXICON) {
    addLexicalCandidate(candidates, token, "lexicon", 1);
  }

  return [...candidates.values()].sort((left, right) => {
    if (right.weight !== left.weight) return right.weight - left.weight;
    return left.value.localeCompare(right.value);
  });
}

function applyTokenCasePattern(original: string, replacement: string): string {
  if (/^[A-Z]+$/.test(original)) return replacement.toUpperCase();
  if (/^[A-Z][a-z]+$/.test(original)) {
    return `${replacement.charAt(0).toUpperCase()}${replacement.slice(1)}`;
  }
  return replacement;
}

function replaceTokenPreservingPunctuation(token: string, replacement: string): string {
  const leading = token.match(/^[@("'`]+/)?.[0] ?? "";
  const trailing = token.match(/[.,!?;:)"'`]+$/)?.[0] ?? "";
  const core = token.slice(leading.length, trailing ? token.length - trailing.length : token.length);
  return `${leading}${applyTokenCasePattern(core, replacement)}${trailing}`;
}

export function buildCommonLexicon(options: {
  contextTexts: string[];
  metadataTexts: string[];
  keyEntities?: string[];
  draftTexts?: string[];
}): Set<string> {
  const set = new Set(
    [...COMMON_SENDABLE_LEXICON, ...GENERIC_STATUS_LEXICON].map((item) =>
      normalizeForComparison(item)
    )
  );

  const sources = [
    ...options.contextTexts,
    ...options.metadataTexts,
    ...(options.keyEntities ?? []),
    ...(options.draftTexts ?? []),
  ];

  for (const source of sources) {
    for (const token of extractMeaningfulTokens(source)) {
      set.add(token);
    }
  }

  return set;
}

export function normalizeBrokenDraftTokens(options: {
  draftText: string;
  contextTexts: string[];
  metadataTexts: string[];
  keyEntities?: string[];
  draftTexts?: string[];
}): string {
  const cleanedDraft = normalizeText(options.draftText);
  if (!cleanedDraft) return cleanedDraft;

  const tokens = extractDraftTokens(cleanedDraft);
  if (tokens.length < 2) return cleanedDraft;

  const lexicon = buildCommonLexicon(options);
  const merged: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    const next = tokens[index + 1];

    if (!next) {
      merged.push(current);
      continue;
    }

    const currentNormalized = cleanTokenForMatch(current);
    const nextNormalized = cleanTokenForMatch(next);
    const combined = `${currentNormalized}${nextNormalized}`;
    const shouldMerge =
      currentNormalized.length > 0 &&
      nextNormalized.length > 0 &&
      (currentNormalized.length <= 2 || nextNormalized.length <= 3) &&
      lexicon.has(combined);

    if (shouldMerge) {
      merged.push(applyTokenCasePattern(current, combined));
      index += 1;
      continue;
    }

    merged.push(current);
  }

  return normalizeText(merged.join(" "));
}

export function hasTypoSignal(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  return (
    !/^[A-Z]/.test(trimmed) ||
    !/[.!?]$/.test(trimmed) ||
    /\s{2,}/.test(trimmed) ||
    /\b[a-zA-Z]\s+[a-zA-Z]{2,}\b/.test(trimmed) ||
    /\b\w*([a-zA-Z])\1{1,}\w*\b/.test(trimmed)
  );
}

export function typoDensityScore(value: string): number {
  const normalized = value.trim();
  if (!normalized) return 0;

  let signalHits = 0;
  if (!/^[A-Z]/.test(normalized)) signalHits += 1;
  if (!/[.!?]$/.test(normalized)) signalHits += 1;
  if (/\s{2,}/.test(normalized)) signalHits += 1;
  if (/\b(?![IaA]\b)[a-zA-Z]\s+[a-zA-Z]{2,}\b/.test(normalized)) signalHits += 2;
  if (/\b\w*([a-zA-Z])\1{2,}\w*\b/.test(normalized)) signalHits += 2;
  if (/\b(?:hte|teh|thign|thingk|rre|hgo|tho|reciev|definately)\b/i.test(normalized)) {
    signalHits += 2;
  }

  return signalHits / Math.max(1, normalized.length / 24);
}

export function applyDeterministicCleanupCorrections(value: string): string {
  let next = normalizeText(value);
  const corrections: Array<[RegExp, string]> = [
    [/\bi thing\b/gi, "I think"],
    [/\bhopefullt\b/gi, "hopefully"],
    [/\bitd\b/gi, "it'd"],
    [/\btheu\b/gi, "they"],
    [/\bpls\b/gi, "please"],
    [/\bplz\b/gi, "please"],
    [/\bud\b/gi, "us"],
    [/\bmsgs\b/gi, "messages"],
    [/\bmsg\b/gi, "message"],
    [/\bmesaging\b/gi, "messaging"],
    [/\bmsging\b/gi, "messaging"],
    [/\bwordings\b/gi, "wording"],
    [/\bbeofre\b/gi, "before"],
    [/\bapo?o?intment\b/gi, "appointment"],
    [/\bapointments\b/gi, "appointments"],
    [/\breciev(?:e|ed|ing)?\b/gi, "receive"],
    [/\breceivd\b/gi, "received"],
    [/\brecieved\b/gi, "received"],
    [/\bafollow\b/gi, "a follow-up"],
    [/\bafgtter\b/gi, "after"],
    [/\ba rre\b/gi, "are"],
    [/\bfollow\b/gi, "follow"],
    [/\bfol low\b/gi, "follow"],
    [/\bhgo\b/gi, "go"],
    [/\bqand\b/gi, "and"],
    [/\batime\b/gi, "at that time"],
    [/\bthats\b/gi, "that's"],
    [/\bdont\b/gi, "don't"],
    [/\bdoesnt\b/gi, "doesn't"],
    [/\bdidnt\b/gi, "didn't"],
    [/\bwont\b/gi, "won't"],
    [/\bcant\b/gi, "can't"],
    [/\bim\b/gi, "I'm"],
    [/\bive\b/gi, "I've"],
    [/\bidk\b/gi, "I don't know"],
    [/\bo she\b/gi, "she"],
    [/\ba oppointment\b/gi, "appointment"],
    [/\ba appointment\b/gi, "appointment"],
    [/\bfollow up\b/gi, "follow-up"],
    [/\bipdted\b/gi, "updated"],
    [/\buknow\b/gi, "unknown"],
    [/\bknoe\b/gi, "know"],
    [/\bteh\b/gi, "the"],
  ];

  for (const [pattern, replacement] of corrections) {
    next = next.replace(pattern, replacement);
  }

  next = next.replace(/\b([A-Za-z])\s+([A-Za-z]{4,})\b/g, (match, left, right, offset, source) => {
    if (offset > 0 && source.charAt(offset - 1) === "'") {
      return match;
    }
    if (left.toLowerCase() === "i") {
      return `I ${right}`;
    }
    return right;
  });
  next = next.replace(/\s+([,.!?;:])/g, "$1");
  next = next.replace(/([,.!?;:])(?!\s|$)/g, "$1 ");
  next = next.replace(/\s{2,}/g, " ").trim();

  if (/^hi\s+[a-z]/i.test(next)) {
    next = next.replace(/^hi\s+([a-z])/i, (_, letter: string) => `Hi ${letter.toUpperCase()}`);
  }
  if (/^hello\s+[a-z]/i.test(next)) {
    next = next.replace(
      /^hello\s+([a-z])/i,
      (_, letter: string) => `Hello ${letter.toUpperCase()}`
    );
  }
  if (next && !/^[A-Z0-9"'(]/.test(next)) {
    next = `${next.charAt(0).toUpperCase()}${next.slice(1)}`;
  }

  return next;
}

export function resolveLexicalDraftCorrections(options: {
  draftText: string;
  contextTexts: string[];
  metadataTexts: string[];
}): { resolvedDraft: string; corrections: DraftLexicalCorrection[] } {
  const cleanedDraft = normalizeText(options.draftText);
  if (!cleanedDraft) {
    return { resolvedDraft: cleanedDraft, corrections: [] };
  }

  const tokens = extractDraftTokens(cleanedDraft);
  if (tokens.length === 0) {
    return { resolvedDraft: cleanedDraft, corrections: [] };
  }
  if (tokens.length > 12 && !hasTypoSignal(cleanedDraft)) {
    return { resolvedDraft: cleanedDraft, corrections: [] };
  }

  const candidates = buildLexicalCandidates(options);
  if (candidates.length === 0) {
    return { resolvedDraft: cleanedDraft, corrections: [] };
  }

  const working = [...tokens];
  const corrections: DraftLexicalCorrection[] = [];

  for (let index = 0; index < working.length; index += 1) {
    const token = working[index];
    const normalizedToken = cleanTokenForMatch(token);
    if (!normalizedToken || normalizedToken.length < 4) continue;
    if (!/^[a-z]+$/.test(normalizedToken)) continue;
    if (GENERIC_STATUS_LEXICON_SET.has(normalizedToken)) continue;
    if (candidates.some((candidate) => candidate.normalized === normalizedToken && candidate.weight >= 2)) {
      continue;
    }

    const ranked = candidates
      .filter((candidate) => Math.abs(candidate.normalized.length - normalizedToken.length) <= 2)
      .map((candidate) => ({
        candidate,
        distance: normalizedEditDistance(normalizedToken, candidate.normalized),
      }))
      .filter(({ candidate, distance }) => {
        if (distance <= 0) return false;
        if (candidate.source === "lexicon") {
          return distance <= 0.42;
        }
        const sharesEdge =
          normalizedToken.charAt(0) === candidate.normalized.charAt(0) ||
          normalizedToken.slice(-1) === candidate.normalized.slice(-1);
        return sharesEdge && distance <= 0.24;
      })
      .sort((left, right) => {
        if (left.distance !== right.distance) return left.distance - right.distance;
        return right.candidate.weight - left.candidate.weight;
      });

    const best = ranked[0];
    const runnerUp = ranked[1];
    if (!best) continue;
    if (runnerUp && Math.abs(best.distance - runnerUp.distance) < 0.08) continue;

    corrections.push({
      from: token,
      to: best.candidate.value,
      source: best.candidate.source,
    });
    working[index] = replaceTokenPreservingPunctuation(token, best.candidate.value);
  }

  return {
    resolvedDraft: working.join(" "),
    corrections,
  };
}
