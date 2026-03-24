import type { ContextScope, MessageContextItem } from "@replymate/contracts";
import {
  boundContextItems,
  isElementVisible,
  normalizeText,
  type RawContextCandidate,
} from "./dom.js";
import type { CaptureDebugCounts, CaptureDropReasonKey } from "./captureDiagnostics.js";

export type PageContextMode = "generic_primary" | "gmail_new_compose";

export type PageContextCapture = {
  items: MessageContextItem[];
  truncated: boolean;
  contextScope: ContextScope;
  warnings: string[];
  extractionConfidence: number;
  diagnostics: PageContextDiagnostics;
};

type PageContextCaptureKind =
  | "search_like"
  | "chat_like"
  | "document_like"
  | "task_detail_like"
  | "generic_unknown";

type LimitedReason =
  | "only_chrome_found"
  | "only_autocomplete_found"
  | "only_empty_fields_found"
  | "no_semantic_lane_content"
  | "none";

export type PageContextDiagnostics = {
  captureKind: PageContextCaptureKind;
  limitedReason: LimitedReason;
  examinedCandidates: number;
  dropReasonCounts: CaptureDebugCounts;
};

type RectInfo = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
  usable: boolean;
};

type CandidateKind =
  | "heading"
  | "task_field"
  | "result_card"
  | "message_card"
  | "document_block"
  | "generic_block";

type Candidate = RawContextCandidate & {
  element: HTMLElement;
  score: number;
  kind: CandidateKind;
  laneOverlap: number;
  relation: "above" | "below" | "overlap";
};

const SEMANTIC_ROOT_SELECTOR = "main, article, section, [role='main'], [role='article']";
const HEADING_SELECTOR = "h1, h2, h3, h4";
const TEXT_BLOCK_SELECTOR =
  "article, section, p, li, blockquote, pre, td, dd, dt, [role='listitem'], [role='row'], div";
const CHROME_TAGS = new Set([
  "nav",
  "header",
  "footer",
  "aside",
  "menu",
  "button",
  "label",
  "input",
  "textarea",
  "select",
  "option",
  "svg",
  "path",
  "img",
  "picture",
  "canvas",
  "form",
]);
const CHROME_DESCRIPTOR_PATTERN =
  /\b(nav|navigation|toolbar|header|footer|sidebar|drawer|menu|command|searchbar|filters?|breadcrumb|chip|pill|composer|replymate|button|controls?|actions?|tabs?)\b/i;
const AUTOCOMPLETE_PATTERN =
  /\b(autocomplete|autosuggest|suggestions?|typeahead|searchbox|command palette)\b/i;
const PLACEHOLDER_TEXT_PATTERN =
  /\b(press\s*\/|jump to search box|write, press '|ask brain|enter a prompt|placeholder)\b/i;
const EMPTY_FIELD_PATTERN = /^(empty|-|none)$/i;
const RESULT_MARKER_PATTERN =
  /\b(result|snippet|search|answer|card|source|citation|article|summary)\b/i;
const CHAT_MARKER_PATTERN =
  /\b(message|assistant|response|reply|conversation|prompt|thread|chat)\b/i;
const TASK_MARKER_PATTERN =
  /\b(task|assignee|assignees|status|priority|dates?|description|summary|field|property|workflow)\b/i;
const DOCUMENT_MARKER_PATTERN =
  /\b(paragraph|document|article|markdown|prose|content|body|note|notes|overview)\b/i;

function getRectInfo(element: Element): RectInfo {
  if (!(element instanceof HTMLElement)) {
    return {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
      usable: false,
    };
  }

  const rect = element.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  const usable =
    width > 0 ||
    height > 0 ||
    rect.top !== 0 ||
    rect.bottom !== 0 ||
    rect.left !== 0 ||
    rect.right !== 0;

  return {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    width,
    height,
    usable,
  };
}

function getViewport(doc: Document): { width: number; height: number } {
  return {
    width: doc.defaultView?.innerWidth || 1440,
    height: doc.defaultView?.innerHeight || 900,
  };
}

function rectIntersectsViewport(rect: RectInfo, viewport: { width: number; height: number }): boolean {
  if (!rect.usable) return true;
  return rect.bottom >= -16 && rect.top <= viewport.height + 16 && rect.right >= -16 && rect.left <= viewport.width + 16;
}

function composerLaneCenter(composerRect: RectInfo, viewportWidth: number): number {
  if (!composerRect.usable || composerRect.width <= 0) {
    return viewportWidth / 2;
  }
  return composerRect.left + composerRect.width / 2;
}

function computeLaneOverlap(candidateRect: RectInfo, composerRect: RectInfo, viewportWidth: number): number {
  if (!candidateRect.usable || !composerRect.usable || composerRect.width <= 0) {
    const center = composerLaneCenter(composerRect, viewportWidth);
    if (!candidateRect.usable || candidateRect.width <= 0) return 1;
    return candidateRect.left <= center && candidateRect.right >= center ? 1 : 0;
  }

  const overlap = Math.max(
    0,
    Math.min(candidateRect.right, composerRect.right) - Math.max(candidateRect.left, composerRect.left)
  );
  if (overlap > 0) {
    return overlap / Math.max(1, Math.min(candidateRect.width, composerRect.width));
  }

  const center = composerLaneCenter(composerRect, viewportWidth);
  return candidateRect.left <= center && candidateRect.right >= center ? 0.65 : 0;
}

function relationToComposer(candidateRect: RectInfo, composerRect: RectInfo): "above" | "below" | "overlap" {
  if (!candidateRect.usable || !composerRect.usable) {
    return "above";
  }
  if (candidateRect.bottom <= composerRect.top + 16) return "above";
  if (candidateRect.top >= composerRect.bottom - 16) return "below";
  return "overlap";
}

function verticalDistance(candidateRect: RectInfo, composerRect: RectInfo): number {
  if (!candidateRect.usable || !composerRect.usable) return 0;
  if (candidateRect.bottom <= composerRect.top) return composerRect.top - candidateRect.bottom;
  if (candidateRect.top >= composerRect.bottom) return candidateRect.top - composerRect.bottom;
  return 0;
}

function isComposerRelated(element: Element, composerElement: Element): boolean {
  return (
    element === composerElement ||
    element.contains(composerElement) ||
    composerElement.contains(element)
  );
}

function getDescriptor(element: HTMLElement): string {
  return normalizeText(
    [
      element.tagName.toLowerCase(),
      element.id || "",
      element.className || "",
      element.getAttribute("role") || "",
      element.getAttribute("aria-label") || "",
      element.getAttribute("data-testid") || "",
      element.getAttribute("data-qa") || "",
      element.getAttribute("placeholder") || "",
    ].join(" ")
  );
}

function isAutocompleteLike(element: HTMLElement): boolean {
  const descriptor = getDescriptor(element);
  if (AUTOCOMPLETE_PATTERN.test(descriptor)) return true;

  return Boolean(
    element.closest(
      "[role='listbox'], [role='option'], [role='menu'], [role='dialog'][aria-label*='search'], .autocomplete, .suggestions"
    )
  );
}

function isChromeLike(element: HTMLElement, text: string): boolean {
  if (CHROME_TAGS.has(element.tagName.toLowerCase())) return true;
  if (PLACEHOLDER_TEXT_PATTERN.test(text)) return true;

  const descriptor = getDescriptor(element);
  if (CHROME_DESCRIPTOR_PATTERN.test(descriptor)) return true;
  if (AUTOCOMPLETE_PATTERN.test(descriptor)) return true;
  if (descriptor.includes("contenteditable") && text.length < 32) return true;

  return false;
}

function semanticChildCount(element: HTMLElement, composerElement: Element): number {
  return Array.from(element.children).filter((child) => {
    if (!(child instanceof HTMLElement)) return false;
    if (!isElementVisible(child) || isComposerRelated(child, composerElement)) return false;
    const text = normalizeText(child.textContent || "");
    if (text.length < 40) return false;
    if (isChromeLike(child, text) || isAutocompleteLike(child)) return false;
    return true;
  }).length;
}

function looksLikeTaskField(element: HTMLElement, text: string): boolean {
  if (!text || EMPTY_FIELD_PATTERN.test(text)) return false;
  const descriptor = getDescriptor(element);
  if (TASK_MARKER_PATTERN.test(descriptor)) return true;
  if (element.matches("dt, dd, [role='row'], tr")) return true;
  return /^(status|assignee|priority|date|dates|summary|description|tags?)\b/i.test(text);
}

function isMeaningfulTaskField(text: string): boolean {
  const compact = normalizeText(text);
  if (!compact) return false;
  if (EMPTY_FIELD_PATTERN.test(compact)) return false;
  if (compact.split(/\s+/).length < 2) return false;
  return !/\bempty\b/i.test(compact);
}

function classifyPageMode(doc: Document, composerElement: Element, composerRect: RectInfo): PageContextCaptureKind {
  const viewport = getViewport(doc);
  const title = normalizeText(doc.title || "");
  const descriptor = normalizeText(
    [title, composerElement.getAttribute("aria-label") || "", composerElement.getAttribute("placeholder") || ""].join(" ")
  );
  const nearTop = !composerRect.usable || composerRect.top <= viewport.height * 0.35;
  const nearBottom = composerRect.usable && composerRect.bottom >= viewport.height * 0.6;

  const hasSearchSignals =
    /\b(search|google)\b/i.test(descriptor) ||
    Boolean(doc.querySelector("input[type='search'], [role='search'], [aria-label*='Search']"));
  if (hasSearchSignals && nearTop) {
    return "search_like";
  }

  const hasTaskSignals =
    Boolean(doc.querySelector("h1")) &&
    Array.from(doc.querySelectorAll("body *"))
      .slice(0, 120)
      .some((element) => {
        if (!(element instanceof HTMLElement)) return false;
        return TASK_MARKER_PATTERN.test(getDescriptor(element));
      });
  if (hasTaskSignals) {
    return "task_detail_like";
  }

  const hasChatSignals = Array.from(doc.querySelectorAll("body *"))
    .slice(0, 160)
    .some((element) => {
      if (!(element instanceof HTMLElement)) return false;
      return CHAT_MARKER_PATTERN.test(getDescriptor(element));
    });
  if (hasChatSignals && nearBottom) {
    return "chat_like";
  }

  const hasDocumentSignals =
    Boolean(doc.querySelector("article, main, blockquote, pre")) ||
    Array.from(doc.querySelectorAll("p, li")).filter((element) => normalizeText(element.textContent || "").length >= 80).length >= 3;
  if (hasDocumentSignals) {
    return "document_like";
  }

  return "generic_unknown";
}

function getScrollContainer(element: Element, doc: Document): HTMLElement {
  let current: Element | null = element.parentElement;
  while (current && current !== doc.body) {
    if (current instanceof HTMLElement) {
      const style = doc.defaultView?.getComputedStyle(current);
      const overflowY = style?.overflowY || "";
      if (/(auto|scroll|overlay)/.test(overflowY)) {
        return current;
      }
    }
    current = current.parentElement;
  }
  return doc.body || (element as HTMLElement);
}

function collectCandidateRoots(
  doc: Document,
  composerElement: Element,
  composerRect: RectInfo,
  mode: PageContextCaptureKind
): HTMLElement[] {
  const roots: HTMLElement[] = [];
  const seen = new Set<Element>();
  const addRoot = (element: Element | null) => {
    if (!(element instanceof HTMLElement) || seen.has(element)) return;
    seen.add(element);
    roots.push(element);
  };

  const scrollRoot = getScrollContainer(composerElement, doc);
  const semanticAncestor = composerElement.closest<HTMLElement>(SEMANTIC_ROOT_SELECTOR);
  const topLevelAncestor = composerElement.closest<HTMLElement>("main, article, section, body");

  addRoot(semanticAncestor);
  addRoot(scrollRoot);
  addRoot(topLevelAncestor);
  addRoot(doc.querySelector("main"));
  addRoot(doc.querySelector("article"));
  addRoot(doc.body);

  if (composerRect.usable) {
    const laneCenter = composerLaneCenter(composerRect, getViewport(doc).width);
    const siblings = Array.from((scrollRoot.parentElement || doc.body).children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement
    );
    for (const sibling of siblings) {
      if (isComposerRelated(sibling, composerElement) || !isElementVisible(sibling)) continue;
      const rect = getRectInfo(sibling);
      if (!rectIntersectsViewport(rect, getViewport(doc))) continue;
      if (rect.usable && !(rect.left <= laneCenter && rect.right >= laneCenter)) continue;
      addRoot(sibling);
    }
  }

  if (mode === "search_like") {
    addRoot(doc.querySelector("[role='main']"));
  }

  return roots;
}

function guessCandidateKind(element: HTMLElement, text: string, mode: PageContextCaptureKind): CandidateKind | null {
  if (element.matches(HEADING_SELECTOR)) return "heading";
  if (looksLikeTaskField(element, text)) return isMeaningfulTaskField(text) ? "task_field" : null;

  const descriptor = getDescriptor(element);
  if (RESULT_MARKER_PATTERN.test(descriptor) || /(^|\s)g($|\s)/i.test(descriptor)) {
    return "result_card";
  }
  if (CHAT_MARKER_PATTERN.test(descriptor)) {
    return "message_card";
  }
  if (
    DOCUMENT_MARKER_PATTERN.test(descriptor) ||
    mode === "document_like" ||
    element.matches("p, li, blockquote, pre, article")
  ) {
    return "document_block";
  }
  if (text.length >= 50) {
    return "generic_block";
  }
  return null;
}

function extractCandidateText(element: HTMLElement, kind: CandidateKind): string {
  if (kind === "heading") {
    return normalizeText(element.textContent || "");
  }

  const directText = normalizeText(
    Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || "")
      .join(" ")
  );
  const fullText = normalizeText(element.textContent || "");

  if (kind === "task_field") {
    return fullText;
  }

  if (directText.length >= 40) {
    return directText;
  }

  return fullText;
}

function computeCandidateScore(options: {
  candidateKind: CandidateKind;
  text: string;
  rect: RectInfo;
  composerRect: RectInfo;
  laneOverlap: number;
  relation: "above" | "below" | "overlap";
  mode: PageContextCaptureKind;
  element: HTMLElement;
  composerElement: Element;
}): number {
  const { candidateKind, text, rect, composerRect, laneOverlap, relation, mode, element, composerElement } = options;
  let score = 0;

  score += laneOverlap * 32;

  if (candidateKind === "heading") score += 42;
  if (candidateKind === "task_field") score += 18;
  if (candidateKind === "result_card") score += 26;
  if (candidateKind === "message_card") score += 26;
  if (candidateKind === "document_block") score += 22;
  if (candidateKind === "generic_block") score += 10;

  if (/[.!?]/.test(text)) score += 8;
  if (/\n|•|- /.test(text)) score += 5;
  if (text.length >= 80 && text.length <= 480) score += 10;
  if (text.length > 480) score += 4;

  if (mode === "search_like") {
    if (relation === "below") score += 18;
    if (relation === "overlap") score += 6;
  } else if (mode === "chat_like" || mode === "document_like" || mode === "task_detail_like") {
    if (relation === "above") score += 18;
    if (relation === "overlap") score += 8;
    if (relation === "below") score -= 4;
  } else {
    if (relation === "above") score += 8;
    if (relation === "below") score += 6;
  }

  const distance = verticalDistance(rect, composerRect);
  score -= Math.min(24, Math.floor(distance / 160) * 3);

  if (semanticChildCount(element, composerElement) >= 5 && candidateKind !== "result_card") {
    score -= 20;
  }

  return score;
}

function classifyCandidateElement(
  element: HTMLElement,
  composerElement: Element,
  viewport: { width: number; height: number }
): { allowed: true } | { allowed: false; reason: CaptureDropReasonKey } {
  if (!isElementVisible(element)) {
    return { allowed: false, reason: "hidden" };
  }
  if (isComposerRelated(element, composerElement)) {
    return { allowed: false, reason: "unsupported_shape" };
  }

  const rect = getRectInfo(element);
  if (!rectIntersectsViewport(rect, viewport)) {
    return { allowed: false, reason: "offscreen" };
  }
  if (CHROME_TAGS.has(element.tagName.toLowerCase())) {
    return { allowed: false, reason: "chrome_only" };
  }

  return { allowed: true };
}

function collectCandidates(
  doc: Document,
  composerElement: Element,
  mode: PageContextCaptureKind
): {
  candidates: Candidate[];
  limitedReason: LimitedReason;
  diagnostics: PageContextDiagnostics;
} {
  const viewport = getViewport(doc);
  const composerRect = getRectInfo(composerElement);
  const roots = collectCandidateRoots(doc, composerElement, composerRect, mode);
  const candidates: Candidate[] = [];
  const seenElements = new Set<Element>();
  let chromeOnlyCount = 0;
  let autocompleteCount = 0;
  let emptyFieldCount = 0;
  let examinedCandidates = 0;
  const dropReasonCounts: CaptureDebugCounts = {};

  for (const root of roots) {
    const elements = [
      root,
      ...Array.from(root.querySelectorAll<HTMLElement>(`${HEADING_SELECTOR}, ${TEXT_BLOCK_SELECTOR}`)).slice(0, 260),
    ];

    for (const element of elements) {
      if (seenElements.has(element)) continue;
      seenElements.add(element);
      examinedCandidates += 1;

      const eligibility = classifyCandidateElement(element, composerElement, viewport);
      if (!eligibility.allowed) {
        dropReasonCounts[eligibility.reason] = (dropReasonCounts[eligibility.reason] ?? 0) + 1;
        continue;
      }

      const rawText = normalizeText(element.textContent || "");
      if (!rawText) {
        dropReasonCounts.empty_text = (dropReasonCounts.empty_text ?? 0) + 1;
        continue;
      }

      if (isAutocompleteLike(element)) {
        autocompleteCount += 1;
        dropReasonCounts.unsupported_shape = (dropReasonCounts.unsupported_shape ?? 0) + 1;
        continue;
      }

      if (isChromeLike(element, rawText)) {
        chromeOnlyCount += 1;
        dropReasonCounts.chrome_only = (dropReasonCounts.chrome_only ?? 0) + 1;
        continue;
      }

      const kind = guessCandidateKind(element, rawText, mode);
      if (!kind) {
        dropReasonCounts.unsupported_shape = (dropReasonCounts.unsupported_shape ?? 0) + 1;
        continue;
      }

      const text = extractCandidateText(element, kind);
      if (!text) {
        dropReasonCounts.empty_text = (dropReasonCounts.empty_text ?? 0) + 1;
        continue;
      }
      if (PLACEHOLDER_TEXT_PATTERN.test(text)) {
        dropReasonCounts.chrome_only = (dropReasonCounts.chrome_only ?? 0) + 1;
        continue;
      }
      if (kind === "task_field" && !isMeaningfulTaskField(text)) {
        emptyFieldCount += 1;
        dropReasonCounts.metadata_only = (dropReasonCounts.metadata_only ?? 0) + 1;
        continue;
      }

      if (kind !== "heading" && text.length < 24) {
        dropReasonCounts.noise_text = (dropReasonCounts.noise_text ?? 0) + 1;
        continue;
      }

      const rect = getRectInfo(element);
      const laneOverlap = computeLaneOverlap(rect, composerRect, viewport.width);
      if (laneOverlap <= 0 && mode !== "generic_unknown") {
        dropReasonCounts.outside_active_lane =
          (dropReasonCounts.outside_active_lane ?? 0) + 1;
        continue;
      }

      const relation = relationToComposer(rect, composerRect);
      const score = computeCandidateScore({
        candidateKind: kind,
        text,
        rect,
        composerRect,
        laneOverlap,
        relation,
        mode,
        element,
        composerElement,
      });

      if (score < 16) {
        dropReasonCounts.unsupported_shape = (dropReasonCounts.unsupported_shape ?? 0) + 1;
        continue;
      }

      candidates.push({
        id: element.id || undefined,
        text,
        role: "unknown",
        element,
        score,
        kind,
        laneOverlap,
        relation,
      });
    }
  }

  if (candidates.length > 0) {
    return {
      candidates,
      limitedReason: "none",
      diagnostics: {
        captureKind: mode,
        limitedReason: "none",
        examinedCandidates,
        dropReasonCounts,
      },
    };
  }

  if (autocompleteCount > 0) {
    return {
      candidates,
      limitedReason: "only_autocomplete_found",
      diagnostics: {
        captureKind: mode,
        limitedReason: "only_autocomplete_found",
        examinedCandidates,
        dropReasonCounts,
      },
    };
  }
  if (emptyFieldCount > 0) {
    return {
      candidates,
      limitedReason: "only_empty_fields_found",
      diagnostics: {
        captureKind: mode,
        limitedReason: "only_empty_fields_found",
        examinedCandidates,
        dropReasonCounts,
      },
    };
  }
  if (chromeOnlyCount > 0) {
    return {
      candidates,
      limitedReason: "only_chrome_found",
      diagnostics: {
        captureKind: mode,
        limitedReason: "only_chrome_found",
        examinedCandidates,
        dropReasonCounts,
      },
    };
  }

  return {
    candidates,
    limitedReason: "no_semantic_lane_content",
    diagnostics: {
      captureKind: mode,
      limitedReason: "no_semantic_lane_content",
      examinedCandidates,
      dropReasonCounts,
    },
  };
}

function isDuplicateSelection(selected: Candidate[], next: Candidate): boolean {
  return selected.some((existing) => {
    if (normalizeText(existing.text) === normalizeText(next.text)) return true;
    if (existing.element.contains(next.element) || next.element.contains(existing.element)) {
      return existing.kind === next.kind;
    }
    return false;
  });
}

function assembleContextCandidates(
  doc: Document,
  composerElement: Element,
  mode: PageContextCaptureKind
): {
  candidates: RawContextCandidate[];
  limitedReason: LimitedReason;
  diagnostics: PageContextDiagnostics;
} {
  const { candidates, limitedReason, diagnostics } = collectCandidates(doc, composerElement, mode);
  if (candidates.length === 0) {
    return { candidates: [], limitedReason, diagnostics };
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);
    return left.text.length - right.text.length;
  });

  const selected: Candidate[] = [];
  const heading = candidates.find((candidate) => candidate.kind === "heading");
  if (heading) {
    selected.push(heading);
  }

  const supportLimit =
    mode === "task_detail_like" ? 4 : mode === "search_like" ? 3 : mode === "chat_like" ? 3 : 3;

  for (const candidate of candidates) {
    if (selected.length >= supportLimit + (heading ? 1 : 0)) break;
    if (heading && candidate === heading) continue;
    if (isDuplicateSelection(selected, candidate)) {
      diagnostics.dropReasonCounts.duplicate = (diagnostics.dropReasonCounts.duplicate ?? 0) + 1;
      continue;
    }
    selected.push(candidate);
  }

  const deduped: RawContextCandidate[] = [];
  const seenText = new Set<string>();
  for (const candidate of selected) {
    const text = normalizeText(candidate.text);
    if (!text) {
      diagnostics.dropReasonCounts.empty_text = (diagnostics.dropReasonCounts.empty_text ?? 0) + 1;
      continue;
    }
    if (seenText.has(text)) {
      diagnostics.dropReasonCounts.duplicate = (diagnostics.dropReasonCounts.duplicate ?? 0) + 1;
      continue;
    }
    seenText.add(text);
    deduped.push({
      id: candidate.id,
      text,
      role: "unknown",
    });
  }

  return {
    candidates: deduped,
    limitedReason: deduped.length > 0 ? "none" : limitedReason,
    diagnostics: {
      ...diagnostics,
      limitedReason: deduped.length > 0 ? "none" : limitedReason,
    },
  };
}

function warningForLimitedReason(reason: LimitedReason, mode: PageContextMode): string {
  const prefix =
    mode === "gmail_new_compose"
      ? "Limited page context detected on this compose surface."
      : "Limited page context detected on this site.";

  switch (reason) {
    case "only_autocomplete_found":
      return `${prefix} Only autocomplete or suggestion UI was visible near the composer.`;
    case "only_empty_fields_found":
      return `${prefix} Only empty field rows were visible in the main content lane.`;
    case "only_chrome_found":
      return `${prefix} Only chrome-like UI blocks were visible near the composer.`;
    case "no_semantic_lane_content":
      return `${prefix} No semantic content block was visible in the main content lane.`;
    case "none":
    default:
      return prefix;
  }
}

function confidenceForItems(items: MessageContextItem[], kind: PageContextCaptureKind): number {
  if (items.length === 0) return 0.4;

  switch (kind) {
    case "chat_like":
      return 0.74;
    case "document_like":
      return 0.72;
    case "task_detail_like":
      return 0.76;
    case "search_like":
      return 0.68;
    case "generic_unknown":
    default:
      return 0.64;
  }
}

export function collectVisiblePageContext(
  doc: Document,
  composerElement: Element,
  mode: PageContextMode
): PageContextCapture {
  const captureKind = classifyPageMode(doc, composerElement, getRectInfo(composerElement));
  const assembled = assembleContextCandidates(doc, composerElement, captureKind);
  const bounded = boundContextItems(assembled.candidates, "visible_page", undefined, {
    preferLatest: captureKind === "chat_like",
  });
  const warnings: string[] = [];

  if (bounded.items.length > 0) {
    warnings.push(
      mode === "gmail_new_compose"
        ? "Using nearby visible page context; results may be less reliable than email-thread context."
        : "Using nearby visible page context; results may be less reliable than thread-aware adapters."
    );
  } else {
    warnings.push(warningForLimitedReason(assembled.limitedReason, mode));
  }

  if (bounded.truncated) {
    warnings.push(
      mode === "gmail_new_compose"
        ? "Visible compose-surface context was truncated for safety limits."
        : "Visible page context was truncated for safety limits."
    );
  }

  return {
    items: bounded.items,
    truncated: bounded.truncated,
    contextScope: bounded.items.length > 0 ? "page" : "none",
    warnings,
    extractionConfidence: confidenceForItems(bounded.items, captureKind),
    diagnostics: assembled.diagnostics,
  };
}
