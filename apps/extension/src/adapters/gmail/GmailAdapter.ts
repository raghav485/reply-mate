import type {
  AttachCapability,
  ComposerHandle,
  ComposerSnapshot,
  ContextScope,
  MessageContextItem,
  SiteAdapter,
} from "@replymate/contracts";
import {
  DEFAULT_CONTEXT_BOUNDS,
  boundContextItems,
  findFocusedComposerElement,
  getComposerText,
  insertTextIntoComposer,
  isComposerLikeElement,
  isElementVisible,
  makeComposerHandle,
  normalizeText,
  type RawContextCandidate,
} from "../shared/dom.js";
import { collectVisiblePageContext } from "../shared/pageContext.js";
import {
  buildCaptureDebugSnapshot,
  incrementDropReason,
  mergeDropReasonCounts,
  type CaptureDebugCounts,
} from "../shared/captureDiagnostics.js";

const GMAIL_COMPOSER_SELECTORS = [
  'div[role="textbox"][g_editable="true"]',
  'div[contenteditable="true"][aria-label*="Message Body"]',
  'div[contenteditable="true"][aria-label*="message body"]',
  'div[contenteditable="true"][role="textbox"]',
] as const;

const GMAIL_STANDALONE_COMPOSE_SURFACE_SELECTORS = [
  '[role="dialog"]',
  ".AD",
  ".compose-container",
] as const;

const GMAIL_COMPOSE_FIELD_SELECTORS = [
  'input[name="subjectbox"]',
  'input[aria-label*="To"]',
  'textarea[aria-label*="To"]',
  ".afV",
  ".vR",
] as const;

const GMAIL_SEND_CONTROL_SELECTORS = [
  '[data-tooltip*="Send"]',
  '[aria-label^="Send"]',
  '[aria-label*="Send"]',
  ".dC",
] as const;

const GMAIL_THREAD_ENTRY_SELECTORS = [
  "div.adn",
  "div.h7",
  "div.hx",
  "div.gE",
  "div.gs",
  "div.ajA",
  "div.ajR",
  "blockquote.gmail_quote",
  "div.gmail_quote",
] as const;

const GMAIL_CANONICAL_ENTRY_SELECTORS = [
  "div.adn",
  "div.h7",
  "div.hx",
  "div.gE",
  "blockquote.gmail_quote",
  "div.gmail_quote",
] as const;

const GMAIL_BODY_TEXT_SELECTORS = [
  "div.a3s",
  ".ii.gt .a3s",
  '.ii.gt [dir="ltr"]',
  '.ii.gt [dir="auto"]',
] as const;

const GMAIL_SUMMARY_TEXT_SELECTORS = [
  ".y2",
  ".ajA",
  ".gs",
  ".ajR",
] as const;

const GMAIL_AUTHOR_SELECTORS = [
  "span.gD",
  "span[email]",
  ".go",
] as const;

const GMAIL_TIMESTAMP_SELECTORS = [
  ".g3",
  "time",
] as const;

const GMAIL_METADATA_REMOVE_SELECTORS = [
  ...GMAIL_AUTHOR_SELECTORS,
  ...GMAIL_TIMESTAMP_SELECTORS,
  ".g2",
  ".gH",
  ".gK",
  ".ajy",
  ".ajz",
  ".ajx",
  ".ajB",
  ".ajT",
  ".hq",
  ".ig",
  ".J-J5-Ji",
  '[role="button"]',
  '[aria-label*="Reply"]',
  '[aria-label*="More"]',
  '[aria-label*="Forward"]',
  '[data-tooltip*="Reply"]',
  '[data-tooltip*="More"]',
  "button",
  "img",
  "svg",
] as const;

const GMAIL_CHROME_TEXT_PATTERNS = [
  /^to me$/i,
  /^reply$/i,
  /^reply all$/i,
  /^forward$/i,
  /^more$/i,
  /^show details$/i,
  /^hide details$/i,
  /^via\s+/i,
  /^you can't react with an emoji/i,
  /^\d{1,2}:\d{2}\s*(am|pm)(\s*\([^)]*\))?$/i,
  /^(mon|tue|wed|thu|fri|sat|sun),?\s+[a-z]{3,}\s+\d{1,2}/i,
] as const;

type GmailComposerMode = "reply_thread" | "new_compose";

type GmailContextCandidate = RawContextCandidate & {
  source: MessageContextItem["source"];
  timestamp?: string;
};

type GmailThreadContextCapture = {
  items: MessageContextItem[];
  truncated: boolean;
  contextScope: ContextScope;
  chromeOnly: boolean;
  diagnostics: {
    examinedCandidates: number;
    dropReasonCounts: CaptureDebugCounts;
  };
};

function isGmailComposerElement(element: Element | null): element is HTMLElement {
  if (!isComposerLikeElement(element)) return false;

  const label = element.getAttribute("aria-label")?.toLowerCase() || "";
  if (label.includes("search")) return false;

  if (element.getAttribute("g_editable") === "true") return true;
  if (label.includes("message body")) return true;

  return Boolean(element.closest(".nH, .M9, .ii, .adn"));
}

function queryFirstVisible(doc: Document, selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    const candidate = doc.querySelector<HTMLElement>(selector);
    if (candidate && isElementVisible(candidate)) {
      return candidate;
    }
  }
  return null;
}

function compareDocumentOrder(left: Element, right: Element): number {
  if (left === right) return 0;
  const relation = left.compareDocumentPosition(right);
  if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

function getMetadataText(doc: Document, selector: string): string | undefined {
  const value = doc.querySelector(selector)?.textContent;
  const normalized = value ? normalizeText(value) : "";
  return normalized || undefined;
}

function getSubject(doc: Document): string | undefined {
  const input = doc.querySelector<HTMLInputElement>('input[name="subjectbox"]');
  const inputValue = normalizeText(input?.value || "");
  if (inputValue) return inputValue;

  return getMetadataText(doc, "h2.hP, .hP");
}

function hasUsableGeometry(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const rect = element.getBoundingClientRect();
  return (
    rect.height > 0 ||
    rect.top !== 0 ||
    rect.bottom !== 0 ||
    (rect.width > 0 && rect.bottom - rect.top > 0)
  );
}

function isBeforeComposer(candidate: Element, composerElement: Element): boolean {
  if (candidate === composerElement) return false;
  if (candidate.contains(composerElement)) return false;
  if (composerElement.contains(candidate)) return false;

  if (hasUsableGeometry(candidate) && hasUsableGeometry(composerElement)) {
    const candidateRect = (candidate as HTMLElement).getBoundingClientRect();
    const composerRect = (composerElement as HTMLElement).getBoundingClientRect();
    return candidateRect.bottom <= composerRect.top + 24;
  }

  return Boolean(
    candidate.compareDocumentPosition(composerElement) & Node.DOCUMENT_POSITION_FOLLOWING
  );
}

function isNoiseText(text: string): boolean {
  if (!text) return true;
  if (/^[.\u2026]+$/.test(text)) return true;
  return normalizeText(text).length < 3;
}

function collectTextSegments(
  root: Element,
  selectors: readonly string[]
): string[] {
  const segments: string[] = [];
  const seen = new Set<string>();

  for (const selector of selectors) {
    const elements = root.matches(selector)
      ? [root]
      : Array.from(root.querySelectorAll(selector));

    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue;
      if (!isElementVisible(element)) continue;
      const text = normalizeText(element.textContent || "");
      if (isNoiseText(text) || seen.has(text)) continue;
      seen.add(text);
      segments.push(text);
    }
  }

  return segments;
}

function extractThreadText(element: Element): string {
  const author = getAuthorFromEntry(element);
  const timestamp = getTimestampFromEntry(element);

  if (element.matches("blockquote.gmail_quote, div.gmail_quote")) {
    const quoteSegments = collectTextSegments(element, [
      "blockquote.gmail_quote",
      "div.gmail_quote",
    ]);
    if (quoteSegments.length > 0) {
      return normalizeText(quoteSegments.join(" "));
    }
  }

  const bodySegments = collectTextSegments(element, GMAIL_BODY_TEXT_SELECTORS);
  if (bodySegments.length > 0) {
    return normalizeText(bodySegments.join(" "));
  }

  const summarySegments = collectTextSegments(element, GMAIL_SUMMARY_TEXT_SELECTORS);
  if (summarySegments.length > 0) {
    return normalizeText(summarySegments.join(" "));
  }

  const fallback = extractSanitizedGmailFallback(element, author, timestamp);
  return isNoiseText(fallback) ? "" : fallback;
}

function getAuthorFromEntry(element: Element): string | undefined {
  for (const selector of GMAIL_AUTHOR_SELECTORS) {
    const text = normalizeText(element.querySelector(selector)?.textContent || "");
    if (text) return text;
  }
  return undefined;
}

function getTimestampFromEntry(element: Element): string | undefined {
  for (const selector of GMAIL_TIMESTAMP_SELECTORS) {
    const text = normalizeText(element.querySelector(selector)?.textContent || "");
    if (text) return text;
  }
  return undefined;
}

function resolveCanonicalThreadEntry(
  element: HTMLElement,
  conversationSurface: HTMLElement,
  composerElement: Element
): HTMLElement | null {
  const canonical = element.closest<HTMLElement>(
    GMAIL_CANONICAL_ENTRY_SELECTORS.join(", ")
  );

  const resolved =
    canonical &&
    conversationSurface.contains(canonical) &&
    isBeforeComposer(canonical, composerElement)
      ? canonical
      : element;

  if (!conversationSurface.contains(resolved)) return null;
  if (!isElementVisible(resolved)) return null;
  if (!isBeforeComposer(resolved, composerElement)) return null;

  return resolved;
}

function collectThreadEntries(
  conversationSurface: HTMLElement,
  composerElement: Element
): { entries: HTMLElement[]; diagnostics: { examinedCandidates: number; dropReasonCounts: CaptureDebugCounts } } {
  const entries: HTMLElement[] = [];
  const seen = new Set<Element>();
  const dropReasonCounts: CaptureDebugCounts = {};
  let examinedCandidates = 0;

  for (const selector of GMAIL_THREAD_ENTRY_SELECTORS) {
    const elements = conversationSurface.matches(selector)
      ? [conversationSurface]
      : Array.from(conversationSurface.querySelectorAll<HTMLElement>(selector));

    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue;
      examinedCandidates += 1;
      if (!isElementVisible(element)) {
        incrementDropReason(dropReasonCounts, "hidden");
        continue;
      }
      if (!isBeforeComposer(element, composerElement)) {
        incrementDropReason(dropReasonCounts, "after_composer");
        continue;
      }
      const canonical = resolveCanonicalThreadEntry(
        element,
        conversationSurface,
        composerElement
      );
      if (!canonical) {
        incrementDropReason(dropReasonCounts, "unsupported_shape");
        continue;
      }
      if (seen.has(canonical)) {
        incrementDropReason(dropReasonCounts, "duplicate");
        continue;
      }
      seen.add(canonical);
      entries.push(canonical);
    }
  }

  return {
    entries: entries.sort(compareDocumentOrder),
    diagnostics: {
      examinedCandidates,
      dropReasonCounts,
    },
  };
}

function containsVisibleConversationSignals(
  element: HTMLElement,
  composerElement: Element
): boolean {
  const selectors = [
    ...GMAIL_THREAD_ENTRY_SELECTORS,
    ...GMAIL_AUTHOR_SELECTORS,
    ...GMAIL_TIMESTAMP_SELECTORS,
  ].join(", ");

  return Array.from(element.querySelectorAll<HTMLElement>(selectors)).some((candidate) => {
    if (!isElementVisible(candidate)) return false;
    if (!isBeforeComposer(candidate, composerElement)) return false;
    const text = normalizeText(candidate.textContent || "");
    return !isNoiseText(text);
  });
}

function isStrongStandaloneComposeSurface(
  surface: HTMLElement,
  composerElement: Element
): boolean {
  if (!surface.contains(composerElement) || !isElementVisible(surface)) {
    return false;
  }

  const hasComposeField = GMAIL_COMPOSE_FIELD_SELECTORS.some((selector) =>
    Boolean(surface.querySelector(selector))
  );
  const hasSubjectField = Boolean(surface.querySelector('input[name="subjectbox"]'));
  const hasSendControl = GMAIL_SEND_CONTROL_SELECTORS.some((selector) =>
    Boolean(surface.querySelector(selector))
  );
  const hasStandaloneShell =
    surface.matches('[role="dialog"], .AD, .aoI, .compose-container') ||
    /new message/i.test(surface.getAttribute("aria-label") || "");

  if (!hasStandaloneShell || !hasComposeField || !hasSendControl || !hasSubjectField) {
    return false;
  }

  return !containsVisibleConversationSignals(surface, composerElement);
}

function findStandaloneComposeSurface(composerElement: Element): HTMLElement | null {
  for (const selector of GMAIL_STANDALONE_COMPOSE_SURFACE_SELECTORS) {
    const surface = composerElement.closest<HTMLElement>(selector);
    if (surface && isStrongStandaloneComposeSurface(surface, composerElement)) {
      return surface;
    }
  }

  let current: Element | null = composerElement.parentElement;
  const docBody = composerElement.ownerDocument.body;
  let depth = 0;
  while (current && current !== docBody && depth < 10) {
    if (
      current instanceof HTMLElement &&
      isStrongStandaloneComposeSurface(current, composerElement)
    ) {
      return current;
    }
    current = current.parentElement;
    depth += 1;
  }

  return null;
}

function findConversationSurface(composerElement: Element): HTMLElement | null {
  const docBody = composerElement.ownerDocument.body;
  let current: Element | null = composerElement.parentElement;
  let depth = 0;

  while (current && current !== docBody && depth < 14) {
    if (
      current instanceof HTMLElement &&
      isElementVisible(current) &&
      containsVisibleConversationSignals(current, composerElement)
    ) {
      return current;
    }
    current = current.parentElement;
    depth += 1;
  }

  if (docBody && containsVisibleConversationSignals(docBody, composerElement)) {
    return docBody;
  }

  return null;
}

function hasThreadEntriesBeforeComposer(composerElement: Element): boolean {
  const doc = composerElement.ownerDocument;
  const selector = GMAIL_THREAD_ENTRY_SELECTORS.join(", ");
  return Array.from(doc.querySelectorAll<HTMLElement>(selector)).some((candidate) => {
    if (!isElementVisible(candidate)) return false;
    if (!isBeforeComposer(candidate, composerElement)) return false;
    return normalizeText(candidate.textContent || "").length > 0;
  });
}

function detectGmailComposerMode(composerElement: Element): GmailComposerMode {
  if (findStandaloneComposeSurface(composerElement)) {
    return "new_compose";
  }

  return hasThreadEntriesBeforeComposer(composerElement) ||
    findConversationSurface(composerElement) ||
    composerElement.closest(".nH, .ii.gt, .adn, .h7, .hx, .gE")
    ? "reply_thread"
    : "new_compose";
}

function collectFallbackTextSegments(
  root: Element,
  author?: string,
  timestamp?: string
): string[] {
  const ownerDocument = root.ownerDocument;
  const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segments: string[] = [];
  const seen = new Set<string>();
  let current = walker.nextNode();

  while (current) {
    const text = normalizeText(current.textContent || "");
    if (
      text &&
      !isNoiseText(text) &&
      !isChromeLikeText(text, author, timestamp) &&
      !seen.has(text)
    ) {
      seen.add(text);
      segments.push(text);
    }
    current = walker.nextNode();
  }

  return segments;
}

function isChromeLikeText(
  text: string,
  author?: string,
  timestamp?: string
): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return true;
  if (author && normalized === author) return true;
  if (timestamp && normalized === timestamp) return true;
  if (/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(normalized)) return true;
  return GMAIL_CHROME_TEXT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function extractSanitizedGmailFallback(
  entry: Element,
  author?: string,
  timestamp?: string
): string {
  if (!(entry instanceof HTMLElement)) {
    return "";
  }

  const clone = entry.cloneNode(true) as HTMLElement;
  for (const selector of GMAIL_METADATA_REMOVE_SELECTORS) {
    for (const node of Array.from(clone.querySelectorAll(selector))) {
      node.remove();
    }
  }

  const summarySegments = collectTextSegments(clone, GMAIL_SUMMARY_TEXT_SELECTORS);
  if (summarySegments.length > 0) {
    return normalizeText(
      summarySegments.filter((segment) => !isChromeLikeText(segment, author, timestamp)).join(" ")
    );
  }

  const bodySegments = collectTextSegments(clone, GMAIL_BODY_TEXT_SELECTORS);
  if (bodySegments.length > 0) {
    return normalizeText(
      bodySegments.filter((segment) => !isChromeLikeText(segment, author, timestamp)).join(" ")
    );
  }

  return normalizeText(collectFallbackTextSegments(clone, author, timestamp).join(" "));
}

function dedupeGmailCandidates(
  candidates: GmailContextCandidate[]
): GmailContextCandidate[] {
  const deduped: GmailContextCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const key = [
      candidate.source,
      candidate.author || "",
      candidate.timestamp || "",
      normalizeText(candidate.text),
    ].join("::");
    if (!candidate.text || seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

function boundGmailContextItems(
  candidates: GmailContextCandidate[]
): { items: MessageContextItem[]; truncated: boolean } {
  const orderedCandidates = [...candidates].reverse();
  const items: MessageContextItem[] = [];
  let totalChars = 0;
  let truncated = false;

  for (const [index, candidate] of orderedCandidates.entries()) {
    if (items.length >= DEFAULT_CONTEXT_BOUNDS.maxItems) {
      truncated = true;
      break;
    }

    let text = normalizeText(candidate.text);
    if (!text) continue;

    if (text.length > DEFAULT_CONTEXT_BOUNDS.maxCharsPerItem) {
      text = text.slice(0, DEFAULT_CONTEXT_BOUNDS.maxCharsPerItem).trimEnd();
      truncated = true;
    }

    const remaining = DEFAULT_CONTEXT_BOUNDS.maxTotalChars - totalChars;
    if (remaining <= 0) {
      truncated = true;
      break;
    }

    if (text.length > remaining) {
      text = text.slice(0, remaining).trimEnd();
      truncated = true;
    }

    if (!text) {
      truncated = true;
      break;
    }

    items.push({
      id: candidate.id ?? `${candidate.source}-${orderedCandidates.length - index}`,
      author: candidate.author,
      role: candidate.role ?? "unknown",
      text,
      source: candidate.source,
    });
    totalChars += text.length;
  }

  return { items: items.reverse(), truncated };
}

function collectLegacyQuotedContext(
  scopeRoot: ParentNode,
  composerElement: Element
): {
  items: MessageContextItem[];
  truncated: boolean;
  diagnostics: { examinedCandidates: number; dropReasonCounts: CaptureDebugCounts };
} {
  const unique = new Set<Element>();
  const dropReasonCounts: CaptureDebugCounts = {};

  for (const selector of ["blockquote.gmail_quote", "div.gmail_quote"] as const) {
    const elements =
      scopeRoot instanceof Element && scopeRoot.matches(selector)
        ? [scopeRoot]
        : Array.from(scopeRoot.querySelectorAll(selector));
    for (const element of elements) {
      if (!isElementVisible(element)) {
        incrementDropReason(dropReasonCounts, "hidden");
        continue;
      }
      if (!isBeforeComposer(element, composerElement)) {
        incrementDropReason(dropReasonCounts, "after_composer");
        continue;
      }
      unique.add(element);
    }
  }

  const candidates: RawContextCandidate[] = [];
  const sorted = Array.from(unique).sort(compareDocumentOrder).slice(-20);

  for (const [index, element] of sorted.entries()) {
    const text = normalizeText(element.textContent || "");
    if (!text) {
      incrementDropReason(dropReasonCounts, "empty_text");
      continue;
    }
    if (isNoiseText(text)) {
      incrementDropReason(dropReasonCounts, "noise_text");
      continue;
    }

    candidates.push({
      id: (element as HTMLElement).id || `gmail-quote-${index + 1}`,
      text,
      author: getAuthorFromEntry(element),
      role: "unknown",
    });
  }

  const bounded = boundContextItems(candidates, "quoted_email");
  return {
    ...bounded,
    diagnostics: {
      examinedCandidates: sorted.length,
      dropReasonCounts,
    },
  };
}

function collectGmailThreadContext(
  composerElement: Element
): GmailThreadContextCapture {
  const conversationSurface = findConversationSurface(composerElement);
  const dropReasonCounts: CaptureDebugCounts = {};
  if (!conversationSurface) {
    return {
      items: [],
      truncated: false,
      contextScope: "thread",
      chromeOnly: false,
      diagnostics: {
        examinedCandidates: 0,
        dropReasonCounts,
      },
    };
  }

  const { entries, diagnostics } = collectThreadEntries(conversationSurface, composerElement);
  Object.assign(dropReasonCounts, diagnostics.dropReasonCounts);
  const candidates: GmailContextCandidate[] = [];

  for (const entry of entries) {
    const text = extractThreadText(entry);
    if (!text) {
      const hasBodyText = collectTextSegments(entry, GMAIL_BODY_TEXT_SELECTORS).length > 0;
      const hasSummaryText = collectTextSegments(entry, GMAIL_SUMMARY_TEXT_SELECTORS).length > 0;
      if (!hasBodyText && !hasSummaryText && getAuthorFromEntry(entry)) {
        incrementDropReason(dropReasonCounts, "metadata_only");
      } else {
        incrementDropReason(
          dropReasonCounts,
          entry.matches("blockquote.gmail_quote, div.gmail_quote") ? "noise_text" : "chrome_only"
        );
      }
      continue;
    }

    candidates.push({
      id: entry.id || undefined,
      text,
      author: getAuthorFromEntry(entry),
      timestamp: getTimestampFromEntry(entry),
      role: "unknown",
      source: entry.matches("blockquote.gmail_quote, div.gmail_quote")
        ? "quoted_email"
        : "visible_email_thread",
    });
  }

  if (candidates.length === 0) {
    const quotedFallback = collectLegacyQuotedContext(conversationSurface, composerElement);
    return {
      ...quotedFallback,
      contextScope: "thread",
      chromeOnly: entries.length > 0 && quotedFallback.items.length === 0,
      diagnostics: {
        examinedCandidates: Math.max(diagnostics.examinedCandidates, quotedFallback.diagnostics.examinedCandidates),
        dropReasonCounts: mergeDropReasonCounts(
          dropReasonCounts,
          quotedFallback.diagnostics.dropReasonCounts
        ),
      },
    };
  }

  const dedupedCandidates = dedupeGmailCandidates(candidates);
  if (dedupedCandidates.length < candidates.length) {
    incrementDropReason(dropReasonCounts, "duplicate", candidates.length - dedupedCandidates.length);
  }
  const bounded = boundGmailContextItems(dedupedCandidates);
  return {
    ...bounded,
    contextScope: "thread",
    chromeOnly: false,
    diagnostics: {
      examinedCandidates: diagnostics.examinedCandidates,
      dropReasonCounts,
    },
  };
}

export class GmailAdapter implements SiteAdapter {
  id = "gmail" as const;
  siteId = "gmail_web" as const;

  detectComposer(doc: Document): ComposerHandle | null {
    const focusedComposer = findFocusedComposerElement(doc);
    if (isGmailComposerElement(focusedComposer)) {
      return makeComposerHandle(focusedComposer, this.id);
    }

    const fallbacks = GMAIL_COMPOSER_SELECTORS.flatMap((selector) =>
      Array.from(doc.querySelectorAll<HTMLElement>(selector))
    ).filter((candidate, index, array) => {
      return isElementVisible(candidate) && array.indexOf(candidate) === index;
    });

    const replySurfaceFallback = fallbacks.find(
      (candidate) => detectGmailComposerMode(candidate) === "reply_thread"
    );
    if (replySurfaceFallback) {
      return makeComposerHandle(replySurfaceFallback, this.id);
    }

    const fallback = fallbacks[0] || queryFirstVisible(doc, GMAIL_COMPOSER_SELECTORS);
    if (fallback) {
      return makeComposerHandle(fallback, this.id);
    }

    return null;
  }

  extractSnapshot(doc: Document, composer: ComposerHandle): ComposerSnapshot {
    const draftText = getComposerText(composer.element);
    const composerMode = detectGmailComposerMode(composer.element);
    const threadContext =
      composerMode === "reply_thread"
        ? collectGmailThreadContext(composer.element)
        : null;
    const pageContext =
      composerMode === "new_compose"
        ? collectVisiblePageContext(doc, composer.element, "gmail_new_compose")
        : null;
    const visibleContext =
      composerMode === "reply_thread"
        ? threadContext?.items || []
        : pageContext?.items || [];
    const truncated =
      composerMode === "reply_thread"
        ? Boolean(threadContext?.truncated)
        : Boolean(pageContext?.truncated);

    const url = doc.defaultView?.location.href || "";
    const baseUrl = url.split("?")[0] || "";

    const subject =
      composerMode === "reply_thread"
        ? getMetadataText(doc, "h2.hP, .hP") || getSubject(doc)
        : getSubject(doc);
    const senderName = getMetadataText(doc, "span.gD, span[email], .go");

    const warnings: string[] = [];
    if (composerMode === "reply_thread" && visibleContext.length === 0) {
      warnings.push(
        threadContext?.chromeOnly
          ? "ReplyMate detected an email reply surface but the visible Gmail thread content was mostly header or action chrome."
          : "ReplyMate detected an email reply surface but could not extract visible thread text."
      );
    }
    if (composerMode === "new_compose" && pageContext) {
      warnings.push(
        "No email thread is attached to this compose surface; using nearby visible page context instead."
      );
      warnings.push(...pageContext.warnings);
    }
    if (composerMode === "reply_thread" && truncated) {
      warnings.push("Gmail thread context was truncated for safety limits.");
    }

    const extractionConfidence =
      composerMode === "reply_thread"
        ? visibleContext.length > 0
          ? 0.84
          : draftText.length > 0
            ? 0.65
            : 0.42
        : visibleContext.length > 0
          ? pageContext?.extractionConfidence || 0.68
          : draftText.length > 0
            ? 0.58
            : 0.42;

    return {
      draftText,
      visibleContext,
      contextScope:
        composerMode === "reply_thread" ? "thread" : pageContext?.contextScope || "none",
      workspaceKey: `${this.siteId}::${baseUrl}::${subject || ""}`,
      composerMode: "email",
      metadata: {
        siteId: this.siteId,
        url,
        title: doc.title || undefined,
        threadTitle: subject,
        senderName,
      },
      extractionConfidence,
      warnings,
      pageUrlAtCapture: url,
      viewFingerprint: `${baseUrl}::${subject || ""}`,
      composerFingerprint: composer.fingerprint,
      sessionVersion: 1,
      captureDebug: buildCaptureDebugSnapshot({
        adapterId: this.id,
        composerMode: "email",
        contextScope:
          composerMode === "reply_thread" ? "thread" : pageContext?.contextScope || "none",
        extractionConfidence,
        visibleContext,
        truncated,
        warnings,
        examinedCandidates:
          composerMode === "reply_thread"
            ? threadContext?.diagnostics.examinedCandidates ?? 0
            : pageContext?.diagnostics.examinedCandidates ?? 0,
        dropReasonCounts:
          composerMode === "reply_thread"
            ? threadContext?.diagnostics.dropReasonCounts
            : pageContext?.diagnostics.dropReasonCounts,
        captureKind: pageContext?.diagnostics.captureKind,
        limitedReason: pageContext?.diagnostics.limitedReason,
      }),
    };
  }

  insertText(
    _doc: Document,
    composer: ComposerHandle,
    text: string,
    mode: "replace" | "append"
  ) {
    return insertTextIntoComposer(composer, text, mode);
  }

  getAttachCapability(_doc: Document): AttachCapability {
    return "manual_only";
  }
}
