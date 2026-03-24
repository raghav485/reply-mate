import type {
  ComposerHandle,
  InsertResult,
  MessageContextItem,
} from "@replymate/contracts";

export type ContextBounds = {
  maxItems: number;
  maxCharsPerItem: number;
  maxTotalChars: number;
};

type BoundContextOptions = {
  preferLatest?: boolean;
};

export const DEFAULT_CONTEXT_BOUNDS: ContextBounds = {
  maxItems: 10,
  maxCharsPerItem: 1500,
  maxTotalChars: 8000,
};

export type RawContextCandidate = {
  id?: string;
  text: string;
  author?: string;
  role?: "customer" | "agent" | "unknown";
};

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function isComposerLikeElement(element: Element | null): element is HTMLElement {
  if (!element || !(element instanceof HTMLElement)) return false;

  const isTextarea = element.tagName.toLowerCase() === "textarea";
  const isContentEditable =
    element.isContentEditable ||
    element.getAttribute("contenteditable") === "true";
  const role = element.getAttribute("role")?.toLowerCase();
  const isTextboxRole = role === "textbox";

  return isTextarea || isContentEditable || isTextboxRole;
}

export function isElementVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.hidden) return false;

  const ariaHidden = element.getAttribute("aria-hidden");
  if (ariaHidden === "true") return false;

  const style = element.style;
  if (style.display === "none" || style.visibility === "hidden") return false;

  return true;
}

function findEditableAncestor(start: Node | null): HTMLElement | null {
  let current: Node | null = start;

  while (current) {
    if (current instanceof HTMLElement && isComposerLikeElement(current)) {
      return current;
    }
    current = current.parentNode;
  }

  return null;
}

export function findFocusedComposerElement(doc: Document): HTMLElement | null {
  const active = doc.activeElement;
  const fromActive = findEditableAncestor(active);
  if (fromActive) return fromActive;

  const selection = doc.defaultView?.getSelection();
  const anchor = selection?.anchorNode ?? null;
  const fromSelection = findEditableAncestor(anchor);
  if (fromSelection) return fromSelection;

  const focused = doc.querySelector<HTMLElement>(
    "textarea:focus, [contenteditable='true']:focus, [role='textbox']:focus"
  );
  if (focused && isComposerLikeElement(focused)) {
    return focused;
  }

  return null;
}

export function generateElementFingerprint(element: Element): string {
  const path: string[] = [];
  let current: Element | null = element;

  while (current && current.tagName) {
    let selector = current.tagName.toLowerCase();
    let hasStableMarker = false;

    if (current.id) {
      selector += `#${current.id}`;
      path.unshift(selector);
      break;
    }

    const dataQa = current.getAttribute("data-qa");
    if (dataQa) {
      selector += `[data-qa=\"${dataQa}\"]`;
      hasStableMarker = true;
    }

    const dataTestId = current.getAttribute("data-testid");
    if (!hasStableMarker && dataTestId) {
      selector += `[data-testid=\"${dataTestId}\"]`;
      hasStableMarker = true;
    }

    const name = current.getAttribute("name");
    if (!hasStableMarker && name) {
      selector += `[name=\"${name}\"]`;
      hasStableMarker = true;
    }

    const ariaLabel = current.getAttribute("aria-label");
    if (!hasStableMarker && ariaLabel) {
      selector += `[aria-label=\"${ariaLabel}\"]`;
      hasStableMarker = true;
    }

    const placeholder = current.getAttribute("placeholder");
    if (!hasStableMarker && placeholder) {
      selector += `[placeholder=\"${placeholder}\"]`;
      hasStableMarker = true;
    }

    if (
      !hasStableMarker &&
      (
        (current instanceof HTMLElement && current.isContentEditable) ||
        current.getAttribute("contenteditable") === "true"
      )
    ) {
      selector += `[contenteditable=\"true\"]`;
      hasStableMarker = true;
    }

    const role = current.getAttribute("role");
    if (role) {
      selector += `[role=\"${role}\"]`;
      hasStableMarker = true;
    }

    if (!hasStableMarker) {
      let sibling = current.previousElementSibling;
      let index = 1;
      while (sibling) {
        if (sibling.tagName === current.tagName) index += 1;
        sibling = sibling.previousElementSibling;
      }

      if (index > 1) {
        selector += `:nth-of-type(${index})`;
      }
    }

    path.unshift(selector);
    if (hasStableMarker) {
      break;
    }
    current = current.parentElement;
  }

  return path.join(" > ");
}

export function makeComposerHandle(
  element: Element,
  adapterId: ComposerHandle["adapterId"]
): ComposerHandle {
  return {
    element,
    adapterId,
    fingerprint: generateElementFingerprint(element),
  };
}

export function getComposerText(element: Element): string {
  if (!(element instanceof HTMLElement)) return "";

  if (element.tagName.toLowerCase() === "textarea") {
    return (element as HTMLTextAreaElement).value;
  }

  if (
    element.isContentEditable ||
    element.getAttribute("contenteditable") === "true" ||
    element.getAttribute("role")?.toLowerCase() === "textbox"
  ) {
    return element.innerText || element.textContent || "";
  }

  return "";
}

function dispatchComposerEvents(element: HTMLElement): void {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

export function insertTextIntoComposer(
  composer: ComposerHandle,
  text: string,
  mode: "replace" | "append"
): InsertResult {
  const element = composer.element;
  if (!(element instanceof HTMLElement)) {
    return {
      success: false,
      errorCode: "INSERT_FAILED",
      message: "Composer element is not editable.",
    };
  }

  try {
    if (element.tagName.toLowerCase() === "textarea") {
      const textarea = element as HTMLTextAreaElement;
      textarea.focus();
      if (mode === "replace") {
        textarea.value = text;
      } else {
        textarea.value += textarea.value.length > 0 ? `\n${text}` : text;
      }
      dispatchComposerEvents(textarea);
      return { success: true };
    }

    if (
      element.isContentEditable ||
      element.getAttribute("contenteditable") === "true" ||
      element.getAttribute("role")?.toLowerCase() === "textbox"
    ) {
      element.focus();
      const current = getComposerText(element);
      const next = mode === "replace" ? text : current.length > 0 ? `${current}\n${text}` : text;
      element.textContent = next;
      dispatchComposerEvents(element);
      return { success: true };
    }

    return {
      success: false,
      errorCode: "INSERT_FAILED",
      message: "Target is neither textarea nor editable textbox.",
    };
  } catch (err) {
    return {
      success: false,
      errorCode: "INSERT_FAILED",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export function boundContextItems(
  candidates: RawContextCandidate[],
  source: MessageContextItem["source"],
  bounds: ContextBounds = DEFAULT_CONTEXT_BOUNDS,
  options: BoundContextOptions = {}
): { items: MessageContextItem[]; truncated: boolean } {
  const orderedCandidates = options.preferLatest ? [...candidates].reverse() : candidates;
  const items: MessageContextItem[] = [];
  let totalChars = 0;
  let truncated = false;

  for (const [index, candidate] of orderedCandidates.entries()) {
    if (items.length >= bounds.maxItems) {
      truncated = true;
      break;
    }

    const normalized = normalizeText(candidate.text);
    if (!normalized) continue;

    let text = normalized;
    if (text.length > bounds.maxCharsPerItem) {
      text = text.slice(0, bounds.maxCharsPerItem).trimEnd();
      truncated = true;
    }

    const remaining = bounds.maxTotalChars - totalChars;
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
      id:
        candidate.id ??
        `${source}-${options.preferLatest ? orderedCandidates.length - index : index + 1}`,
      author: candidate.author,
      role: candidate.role ?? "unknown",
      text,
      source,
    });

    totalChars += text.length;
  }

  return {
    items: options.preferLatest ? items.reverse() : items,
    truncated,
  };
}
