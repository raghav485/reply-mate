import type {
  AttachCapability,
  ComposerHandle,
  ComposerSnapshot,
  ContextScope,
  MessageContextItem,
  SiteAdapter,
} from "@replymate/contracts";
import {
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
import {
  buildCaptureDebugSnapshot,
  incrementDropReason,
  type CaptureDebugCounts,
} from "../shared/captureDiagnostics.js";

const SLACK_COMPOSER_SELECTORS = [
  '[data-qa="thread_message_input"] [role="textbox"]',
  '[data-qa="message_input"] [role="textbox"]',
  '[data-qa="thread_message_input"] [contenteditable="true"]',
  '[data-qa="message_input"] [contenteditable="true"]',
  'div.p-rich_text_editor[contenteditable="true"]',
] as const;

const SLACK_MESSAGE_SELECTORS = [
  '[data-qa="message-text"]',
  ".c-message_kit__text",
  ".c-message__body",
  ".p-rich_text_block",
  ".p-rich_text_section",
] as const;

const SLACK_MESSAGE_METADATA_SELECTORS = [
  '[data-qa="message_sender"]',
  '[data-qa="message_sender_name"]',
  '[data-qa="message_timestamp"]',
  ".c-message__sender",
  ".c-message__sender_link",
  ".c-timestamp",
  "time",
] as const;

const SLACK_CANONICAL_MESSAGE_SELECTORS = [
  '[data-qa="message_container"]',
] as const;

const SLACK_WRAPPER_MESSAGE_SELECTORS = [
  ".c-virtual_list__item",
  '[data-qa="virtual-list-item"]',
] as const;

const SLACK_THREAD_ROOT_SELECTORS = [
  '[data-qa="thread_messages_container"]',
  '[data-qa="thread-pane"]',
  '[data-qa="thread_view"]',
  ".p-threads_flexpane",
] as const;

const SLACK_CHANNEL_ROOT_SELECTORS = [
  '[data-qa="message_pane"]',
  '[data-qa="messages_container"]',
  '[data-qa="channel_scroller"]',
  '[data-qa="conversation_panel"]',
] as const;

const SLACK_LIST_ROOT_SELECTORS = [
  '[data-qa="thread_messages_container"]',
  '[data-qa="messages_container"]',
  ".c-virtual_list__scroll_container",
  ".c-virtual_list",
  '[role="feed"]',
] as const;

const SLACK_SYSTEM_PATTERNS = [
  /\bwas added to\b/i,
  /\bjoined the channel\b/i,
  /\bleft the channel\b/i,
  /\bset the channel topic\b/i,
  /\bchanged the channel name\b/i,
] as const;

type SlackComposerMode = "thread" | "channel";

type SlackCandidate = RawContextCandidate & {
  container: HTMLElement;
  timestamp?: string;
  top: number;
  depth: number;
  distanceFromComposer: number;
};

type SlackContextCapture = {
  items: MessageContextItem[];
  truncated: boolean;
  contextScope: ContextScope;
  diagnostics: {
    examinedCandidates: number;
    dropReasonCounts: CaptureDebugCounts;
  };
};

function isSlackComposerElement(element: Element | null): element is HTMLElement {
  if (!isComposerLikeElement(element)) return false;

  const descriptor = [
    element.getAttribute("aria-label")?.toLowerCase() || "",
    element.getAttribute("data-qa")?.toLowerCase() || "",
    element.getAttribute("placeholder")?.toLowerCase() || "",
  ].join(" ");

  if (descriptor.includes("search")) return false;
  if (descriptor.includes("find")) return false;
  if (descriptor.includes("jump to")) return false;

  if (
    element.closest('[data-qa="thread_message_input"]') ||
    element.closest('[data-qa="message_input"]') ||
    element.closest(".p-message_input, .c-wysiwyg_container")
  ) {
    return true;
  }

  if (element.getAttribute("role")?.toLowerCase() === "textbox") {
    return true;
  }

  return (
    descriptor.includes("message") ||
    descriptor.includes("reply") ||
    descriptor.includes("send")
  );
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

function detectComposerMode(composerElement: Element): SlackComposerMode {
  return composerElement.closest('[data-qa="thread_message_input"], .p-threads_flexpane')
    ? "thread"
    : "channel";
}

function compareDocumentOrder(left: Element, right: Element): number {
  if (left === right) return 0;
  const relation = left.compareDocumentPosition(right);
  if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
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

function getElementDepth(element: Element): number {
  let depth = 0;
  let current: Element | null = element;
  while (current?.parentElement) {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
}

function getElementTop(element: Element): number {
  if (!hasUsableGeometry(element)) {
    return Number.POSITIVE_INFINITY;
  }
  return (element as HTMLElement).getBoundingClientRect().top;
}

function compareSlackContainers(left: HTMLElement, right: HTMLElement): number {
  const leftTop = getElementTop(left);
  const rightTop = getElementTop(right);
  if (Number.isFinite(leftTop) && Number.isFinite(rightTop) && leftTop !== rightTop) {
    return leftTop - rightTop;
  }
  return compareDocumentOrder(left, right);
}

function isSlackRowOnScreen(container: HTMLElement, root: HTMLElement): boolean {
  if (!container.isConnected) return false;
  if (!isElementVisible(container)) return false;

  const containerRect = container.getBoundingClientRect();
  if (!hasUsableGeometry(container)) {
    return true;
  }

  if (containerRect.width <= 0 && containerRect.height <= 0) {
    return false;
  }

  const viewportHeight = container.ownerDocument.defaultView?.innerHeight || 0;
  if (viewportHeight > 0) {
    const intersectsViewport =
      containerRect.bottom >= 0 && containerRect.top <= viewportHeight;
    if (!intersectsViewport) {
      return false;
    }
  }

  if (hasUsableGeometry(root)) {
    const rootRect = root.getBoundingClientRect();
    return (
      containerRect.bottom >= rootRect.top - 16 &&
      containerRect.top <= rootRect.bottom + 16
    );
  }

  return true;
}

function isSlackRowBeforeComposer(container: HTMLElement, composerElement: Element): boolean {
  if (container === composerElement) return false;
  if (container.contains(composerElement)) return false;
  if (composerElement.contains(container)) return false;

  if (hasUsableGeometry(container) && hasUsableGeometry(composerElement)) {
    const containerRect = container.getBoundingClientRect();
    const composerRect = (composerElement as HTMLElement).getBoundingClientRect();
    return containerRect.top <= composerRect.top + 24;
  }

  return Boolean(
    container.compareDocumentPosition(composerElement) & Node.DOCUMENT_POSITION_FOLLOWING
  );
}

function findScopedRoot(
  doc: Document,
  selectors: readonly string[],
  composerElement: Element
): HTMLElement | null {
  for (const selector of selectors) {
    const nearby = composerElement.closest<HTMLElement>(selector);
    if (nearby && isElementVisible(nearby)) {
      return nearby;
    }
  }

  let current: Element | null = composerElement.parentElement;
  while (current) {
    const element = current;
    if (
      element instanceof HTMLElement &&
      isElementVisible(element) &&
      selectors.some((selector) => element.matches(selector))
    ) {
      return element;
    }
    current = element.parentElement;
  }

  for (const selector of selectors) {
    const candidates = doc.querySelectorAll<HTMLElement>(selector);
    for (const candidate of candidates) {
      if (candidate && isElementVisible(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function resolveCanonicalMessageContainer(
  element: Element,
  root: HTMLElement
): HTMLElement | null {
  if (!(element instanceof HTMLElement)) return null;

  const descendantCanonicals = Array.from(
    element.querySelectorAll<HTMLElement>(SLACK_CANONICAL_MESSAGE_SELECTORS.join(", "))
  ).filter((candidate) => candidate !== element && root.contains(candidate));
  if (descendantCanonicals.length === 1) {
    return descendantCanonicals[0];
  }
  if (descendantCanonicals.length > 1) {
    return null;
  }

  const canonical = element.matches(SLACK_CANONICAL_MESSAGE_SELECTORS.join(", "))
    ? element
    : element.closest<HTMLElement>(SLACK_CANONICAL_MESSAGE_SELECTORS.join(", "));
  if (canonical && root.contains(canonical)) {
    return canonical;
  }

  const wrapper = element.matches(SLACK_WRAPPER_MESSAGE_SELECTORS.join(", "))
    ? element
    : element.closest<HTMLElement>(SLACK_WRAPPER_MESSAGE_SELECTORS.join(", "));
  if (wrapper && root.contains(wrapper)) {
    return wrapper;
  }

  return root.contains(element) ? element : null;
}

function hasSlackMessageSemantics(container: Element): boolean {
  const nestedCanonicals = Array.from(
    container.querySelectorAll<HTMLElement>(SLACK_CANONICAL_MESSAGE_SELECTORS.join(", "))
  ).filter((candidate) => candidate !== container);
  if (nestedCanonicals.length > 0) {
    return false;
  }

  const hasMessageText = SLACK_MESSAGE_SELECTORS.some((selector) =>
    Array.from(container.querySelectorAll(selector)).some((element) => {
      if (!isElementVisible(element)) return false;
      return normalizeText(element.textContent || "").length > 0;
    })
  );

  if (!hasMessageText) {
    return false;
  }

  const hasMetadata = SLACK_MESSAGE_METADATA_SELECTORS.some((selector) =>
    container.querySelector(selector)
  );
  const isKnownMessageContainer =
    container.getAttribute("data-qa") === "message_container" ||
    container.classList.contains("c-virtual_list__item");

  return hasMetadata || isKnownMessageContainer;
}

function extractContainerText(container: Element): string {
  for (const selector of SLACK_MESSAGE_SELECTORS) {
    const segments: string[] = [];
    const seen = new Set<string>();
    const elements = container.querySelectorAll(selector);
    for (const element of elements) {
      if (!isElementVisible(element)) continue;
      const text = normalizeText(element.textContent || "");
      if (!text || seen.has(text)) continue;
      seen.add(text);
      segments.push(text);
    }
    if (segments.length > 0) {
      return normalizeText(segments.join(" "));
    }
  }

  const directText = normalizeText(
    Array.from(container.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || "")
      .join(" ")
  );
  return directText;
}

function isSystemOrNoiseRow(container: Element, text: string): boolean {
  if (!text) return true;
  if (
    container.getAttribute("data-qa") === "system_message" ||
    container.className.toLowerCase().includes("system")
  ) {
    return true;
  }

  if (SLACK_SYSTEM_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  if (
    /view transcript/i.test(text) &&
    !container.querySelector(
      '[data-qa="message_sender"], .c-message__sender, .c-message__sender_link'
    )
  ) {
    return true;
  }

  return false;
}

function getMetadataText(doc: Document, selector: string): string | undefined {
  const value = doc.querySelector(selector)?.textContent;
  const normalized = value ? normalizeText(value) : "";
  return normalized || undefined;
}

function getSlackTimestamp(container: Element): string | undefined {
  return (
    normalizeText(
      container
        .querySelector('[data-qa="message_timestamp"], .c-timestamp, time')
        ?.textContent || ""
    ) || undefined
  );
}

function getSlackAuthor(container: Element): string | undefined {
  const raw = normalizeText(
    container
      .querySelector(
        '[data-qa="message_sender"], [data-qa="message_sender_name"], .c-message__sender, .c-message__sender_link'
      )
      ?.textContent || ""
  ).replace(/:\s*$/, "");

  if (!raw) return undefined;

  const midpoint = raw.length / 2;
  if (
    Number.isInteger(midpoint) &&
    raw.slice(0, midpoint) === raw.slice(midpoint)
  ) {
    return raw.slice(0, midpoint).trim() || undefined;
  }

  return raw;
}

function getSlackCandidateKey(candidate: SlackCandidate): string {
  const stableId =
    candidate.container.getAttribute("data-message-id") ||
    candidate.container.getAttribute("data-qa-message-id") ||
    candidate.container.getAttribute("data-item-key") ||
    candidate.container.getAttribute("data-ts") ||
    "";

  if (stableId) {
    return `id::${stableId}`;
  }

  if (candidate.author && candidate.timestamp) {
    return `meta::${candidate.author}::${candidate.timestamp}::${candidate.text}`;
  }

  if (candidate.author) {
    return `author::${candidate.author}::${candidate.text}`;
  }

  return `text::${candidate.text}`;
}

function shouldReplaceCandidate(existing: SlackCandidate, next: SlackCandidate): boolean {
  if (existing.container.contains(next.container)) {
    return true;
  }

  if (next.container.contains(existing.container)) {
    return false;
  }

  if (Math.abs(existing.top - next.top) <= 8) {
    if (existing.distanceFromComposer !== next.distanceFromComposer) {
      return next.distanceFromComposer < existing.distanceFromComposer;
    }
    return next.depth > existing.depth;
  }

  return next.top >= existing.top;
}

function dedupeSlackCandidates(candidates: SlackCandidate[]): SlackCandidate[] {
  const selected = new Map<string, SlackCandidate>();

  for (const candidate of candidates) {
    const key = getSlackCandidateKey(candidate);
    const existing = selected.get(key);
    if (!existing || shouldReplaceCandidate(existing, candidate)) {
      selected.set(key, candidate);
    }
  }

  return Array.from(selected.values()).sort((left, right) =>
    compareSlackContainers(left.container, right.container)
  );
}

function compareByComposerProximity(left: SlackCandidate, right: SlackCandidate): number {
  if (left.distanceFromComposer !== right.distanceFromComposer) {
    return left.distanceFromComposer - right.distanceFromComposer;
  }

  if (left.top !== right.top) {
    return right.top - left.top;
  }

  return compareSlackContainers(left.container, right.container);
}

function findMessageListRoot(root: HTMLElement, composerElement: Element): HTMLElement {
  const candidates = [
    root,
    ...Array.from(root.querySelectorAll<HTMLElement>(SLACK_LIST_ROOT_SELECTORS.join(", "))),
  ];

  let best = root;
  let bestScore = -1;

  for (const candidate of candidates) {
    if (!isElementVisible(candidate)) continue;
    const canonicalRows = Array.from(
      candidate.querySelectorAll<HTMLElement>(SLACK_CANONICAL_MESSAGE_SELECTORS.join(", "))
    ).filter(
      (row) =>
        isSlackRowOnScreen(row, candidate) &&
        isSlackRowBeforeComposer(row, composerElement) &&
        hasSlackMessageSemantics(row)
    );
    const score = canonicalRows.length;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
      continue;
    }
    if (score === bestScore && best !== candidate) {
      const relation = best.compareDocumentPosition(candidate);
      if (relation & Node.DOCUMENT_POSITION_CONTAINED_BY) {
        best = candidate;
      }
    }
  }

  return best;
}

function collectSlackContext(
  doc: Document,
  composerElement: Element,
  composerMode: SlackComposerMode
): SlackContextCapture {
  const scopedRoot =
    composerMode === "thread"
      ? findScopedRoot(doc, SLACK_THREAD_ROOT_SELECTORS, composerElement)
      : findScopedRoot(doc, SLACK_CHANNEL_ROOT_SELECTORS, composerElement);
  const dropReasonCounts: CaptureDebugCounts = {};

  if (!scopedRoot) {
    return {
      items: [],
      truncated: false,
      contextScope: "none",
      diagnostics: {
        examinedCandidates: 0,
        dropReasonCounts,
      },
    };
  }

  const messageListRoot = findMessageListRoot(scopedRoot, composerElement);
  const canonicalElements = Array.from(
    messageListRoot.querySelectorAll<HTMLElement>(SLACK_CANONICAL_MESSAGE_SELECTORS.join(", "))
  );
  const rawElements =
    canonicalElements.length > 0
      ? canonicalElements
      : Array.from(
          messageListRoot.querySelectorAll<HTMLElement>(
            SLACK_WRAPPER_MESSAGE_SELECTORS.join(", ")
          )
        );

  const canonicalContainers: HTMLElement[] = [];
  const seenContainers = new Set<Element>();
  let examinedCandidates = 0;

  for (const element of rawElements) {
    examinedCandidates += 1;
    const container = resolveCanonicalMessageContainer(element, messageListRoot);
    if (!container) {
      incrementDropReason(dropReasonCounts, "unsupported_shape");
      continue;
    }
    if (seenContainers.has(container)) {
      incrementDropReason(dropReasonCounts, "duplicate");
      continue;
    }
    if (!container.isConnected || !isElementVisible(container)) {
      incrementDropReason(dropReasonCounts, "hidden");
      continue;
    }
    if (!isSlackRowOnScreen(container, messageListRoot)) {
      incrementDropReason(dropReasonCounts, "offscreen");
      continue;
    }
    if (!isSlackRowBeforeComposer(container, composerElement)) {
      incrementDropReason(dropReasonCounts, "after_composer");
      continue;
    }
    if (!hasSlackMessageSemantics(container)) {
      incrementDropReason(dropReasonCounts, "unsupported_shape");
      continue;
    }
    seenContainers.add(container);
    canonicalContainers.push(container);
  }

  const candidates: SlackCandidate[] = [];
  const composerTop = hasUsableGeometry(composerElement)
    ? (composerElement as HTMLElement).getBoundingClientRect().top
    : Number.POSITIVE_INFINITY;
  for (const [index, container] of canonicalContainers.sort(compareSlackContainers).entries()) {
    const text = extractContainerText(container);
    if (!text) {
      incrementDropReason(dropReasonCounts, "empty_text");
      continue;
    }
    if (isSystemOrNoiseRow(container, text)) {
      incrementDropReason(dropReasonCounts, "system_or_ack");
      continue;
    }

    const top = Number.isFinite(getElementTop(container)) ? getElementTop(container) : index;

    candidates.push({
      id: container.id || `slack-msg-${index + 1}`,
      text,
      author: getSlackAuthor(container),
      timestamp: getSlackTimestamp(container),
      container,
      top,
      depth: getElementDepth(container),
      distanceFromComposer:
        Number.isFinite(composerTop) && Number.isFinite(top) ? Math.max(0, composerTop - top) : index,
      role: "unknown",
    });
  }

  const dedupedCandidates = dedupeSlackCandidates(candidates);
  if (dedupedCandidates.length < candidates.length) {
    incrementDropReason(dropReasonCounts, "duplicate", candidates.length - dedupedCandidates.length);
  }

  const uniqueLatestCandidates = dedupedCandidates
    .sort(compareByComposerProximity)
    .filter((candidate, _index, all) => {
      const viewportHeight = doc.defaultView?.innerHeight || 900;
      const proximityLimit = Math.max(480, viewportHeight * 0.85);
      const hasEnoughCloserRows = all.filter(
        (other) => other.distanceFromComposer < candidate.distanceFromComposer
      ).length >= 3;

      if (!hasEnoughCloserRows) {
        return true;
      }

      return candidate.distanceFromComposer <= proximityLimit;
    })
    .slice(0, 12)
    .sort((left, right) => compareSlackContainers(left.container, right.container));
  const bounded = boundContextItems(
    uniqueLatestCandidates.map(
      ({
        container: _container,
        timestamp: _timestamp,
        top: _top,
        depth: _depth,
        distanceFromComposer: _distanceFromComposer,
        ...rest
      }) =>
        rest
    ),
    "visible_thread",
    undefined,
    { preferLatest: true }
  );

  const contextScope: ContextScope =
    bounded.items.length === 0
      ? "none"
      : composerMode === "thread"
        ? "thread"
        : "channel";

  return {
    ...bounded,
    items: bounded.items.map((item) => ({
      ...item,
      source: composerMode === "thread" ? "visible_thread" : "visible_channel",
    })),
    contextScope,
    diagnostics: {
      examinedCandidates,
      dropReasonCounts,
    },
  };
}

export class SlackAdapter implements SiteAdapter {
  id = "slack" as const;
  siteId = "slack_web" as const;

  detectComposer(doc: Document): ComposerHandle | null {
    const focusedComposer = findFocusedComposerElement(doc);
    if (isSlackComposerElement(focusedComposer)) {
      return makeComposerHandle(focusedComposer, this.id);
    }

    const fallback = queryFirstVisible(doc, SLACK_COMPOSER_SELECTORS);
    if (fallback) {
      return makeComposerHandle(fallback, this.id);
    }

    return null;
  }

  extractSnapshot(doc: Document, composer: ComposerHandle): ComposerSnapshot {
    const draftText = getComposerText(composer.element);
    const composerMode = detectComposerMode(composer.element);
    const { items: visibleContext, truncated, contextScope, diagnostics } = collectSlackContext(
      doc,
      composer.element,
      composerMode
    );

    const url = doc.defaultView?.location.href || "";
    const baseUrl = url.split("?")[0] || "";

    const channelName =
      getMetadataText(
        doc,
        '[data-qa="channel_name"], [data-qa="channel_header_name"], .p-view_header__channel_title'
      ) || undefined;

    const threadTitle =
      getMetadataText(doc, '[data-qa="thread_title"], .p-threads_flexpane__title') ||
      undefined;

    const warnings: string[] = [];
    if (visibleContext.length === 0) {
      warnings.push(
        composerMode === "thread"
          ? "No thread context captured in strict thread mode."
          : "Limited Slack context detected."
      );
    }
    if (truncated) {
      warnings.push("Slack context was truncated for safety limits.");
    }

    const extractionConfidence =
      visibleContext.length > 0 ? 0.88 : draftText.length > 0 ? 0.68 : 0.45;

    return {
      draftText,
      visibleContext,
      contextScope,
      workspaceKey:
        composerMode === "thread"
          ? `${this.siteId}::${baseUrl}::thread::${channelName || ""}::${threadTitle || ""}`
          : `${this.siteId}::${baseUrl}::channel::${channelName || ""}`,
      composerMode,
      metadata: {
        siteId: this.siteId,
        url,
        title: doc.title || undefined,
        channelName,
        threadTitle,
      },
      extractionConfidence,
      warnings,
      pageUrlAtCapture: url,
      viewFingerprint:
        composerMode === "thread"
          ? `${baseUrl}::thread::${channelName || ""}::${threadTitle || ""}`
          : `${baseUrl}::channel::${channelName || ""}`,
      composerFingerprint: composer.fingerprint,
      sessionVersion: 1,
      captureDebug: buildCaptureDebugSnapshot({
        adapterId: this.id,
        composerMode,
        contextScope,
        extractionConfidence,
        visibleContext,
        truncated,
        warnings,
        examinedCandidates: diagnostics.examinedCandidates,
        dropReasonCounts: diagnostics.dropReasonCounts,
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
