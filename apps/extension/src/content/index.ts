// =============================================================================
// Content Script — TRD §14.2
// =============================================================================

/**
 * Content script responsibilities:
 * - Select the active site adapter for the page
 * - Detect active composer and send snapshots to background
 * - Render an inline trigger anchored to the active composer
 * - Handle INSERT_TEXT commands routed from background
 */

import type {
  AdapterId,
  ComposerHandle,
  ComposerSnapshot,
  FeatureFlagKey,
  SiteAdapter,
} from "@replymate/contracts";
import { GenericAdapter } from "../adapters/generic/GenericAdapter.js";
import { GmailAdapter } from "../adapters/gmail/GmailAdapter.js";
import { SlackAdapter } from "../adapters/slack/SlackAdapter.js";
import {
  resolveAdapter,
  type AdapterMap,
  type SiteFlagSnapshot,
} from "./adapterSelection.js";
import { createPageVoiceBridge } from "./pageVoiceBridge.js";

type ActiveComposerState = {
  adapter: SiteAdapter;
  handle: ComposerHandle;
  snapshot: ComposerSnapshot;
  sessionId: string;
};

const adapters: AdapterMap = {
  slack: new SlackAdapter(),
  gmail: new GmailAdapter(),
  generic: new GenericAdapter(),
};

let activeComposer: ActiveComposerState | null = null;
let lastSnapshotJSON = "";
let siteFlags: SiteFlagSnapshot = {};
let inlineTriggerButton: HTMLButtonElement | null = null;
let inlineTriggerTarget: Element | null = null;
let runtimeAvailable = true;
let invalidationLogged = false;
const pageVoiceBridge = createPageVoiceBridge({
  getAnchorElement: () => activeComposer?.handle.element ?? null,
  sendEvent: (payload) => {
    safeSendMessage({
      type: "VOICE_LOCAL_EVENT",
      payload,
    });
  },
});

console.info("[ReplyMate] Content script loaded.");

function isContextInvalidatedError(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error);
  return message.toLowerCase().includes("extension context invalidated");
}

function markRuntimeUnavailable(): void {
  if (!runtimeAvailable) return;
  runtimeAvailable = false;
  hideInlineTrigger();
  if (!invalidationLogged) {
    invalidationLogged = true;
    console.info("[ReplyMate] Content script context invalidated; waiting for page reload.");
  }
}

function safeSendMessage<T>(
  message: unknown,
  onResponse?: (response: T | undefined) => void
): void {
  if (!runtimeAvailable) return;

  if (!chrome?.runtime?.id) {
    markRuntimeUnavailable();
    return;
  }

  try {
    chrome.runtime.sendMessage(message, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError?.message) {
        if (isContextInvalidatedError(lastError.message)) {
          markRuntimeUnavailable();
          return;
        }
        return;
      }

      onResponse?.(response as T);
    });
  } catch (err) {
    if (isContextInvalidatedError(err)) {
      markRuntimeUnavailable();
      return;
    }
    console.warn("[ReplyMate] sendMessage failed", err);
  }
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function buildSessionId(
  adapterId: AdapterId,
  composerFingerprint: string
): string {
  const digest = hashString(`${adapterId}:${composerFingerprint}`);
  return `${adapterId}-${digest}`;
}

function refreshFeatureFlags(): void {
  safeSendMessage<{ flags?: Partial<Record<FeatureFlagKey, boolean>> }>(
    { type: "GET_FEATURE_FLAGS" },
    (response) => {
    if (response?.flags) {
      siteFlags = response.flags as Partial<Record<FeatureFlagKey, boolean>>;
      checkComposer();
    }
  });
}

function ensureInlineTriggerButton(): HTMLButtonElement {
  if (inlineTriggerButton) return inlineTriggerButton;

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", "Open ReplyMate assistant");
  button.textContent = "✦";
  button.style.position = "fixed";
  button.style.display = "none";
  button.style.width = "30px";
  button.style.height = "30px";
  button.style.borderRadius = "999px";
  button.style.border = "1px solid rgba(15, 23, 42, 0.2)";
  button.style.background = "#0f172a";
  button.style.color = "#ffffff";
  button.style.fontSize = "14px";
  button.style.lineHeight = "1";
  button.style.cursor = "pointer";
  button.style.zIndex = "2147483646";
  button.style.boxShadow = "0 6px 18px rgba(15, 23, 42, 0.24)";
  button.style.padding = "0";
  button.style.margin = "0";

  button.addEventListener("mousedown", (event) => {
    // Preserve composer focus while clicking the trigger.
    event.preventDefault();
  });

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    safeSendMessage({ type: "OPEN_SIDE_PANEL" });
  });

  document.documentElement.appendChild(button);
  inlineTriggerButton = button;
  return button;
}

function hideInlineTrigger(): void {
  if (!inlineTriggerButton) return;
  inlineTriggerButton.style.display = "none";
  inlineTriggerTarget = null;
  pageVoiceBridge.repositionPrompt();
}

function updateInlineTriggerPosition(target: Element): void {
  const button = ensureInlineTriggerButton();
  if (!(target instanceof HTMLElement)) {
    hideInlineTrigger();
    return;
  }

  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) {
    hideInlineTrigger();
    return;
  }

  const top = Math.max(8, rect.top + 8);
  const left = Math.min(window.innerWidth - 36, rect.right - 30 - 8);

  button.style.top = `${Math.round(top)}px`;
  button.style.left = `${Math.round(Math.max(8, left))}px`;
  button.style.display = "block";
  inlineTriggerTarget = target;
}

function chooseComposer(): { adapter: SiteAdapter; handle: ComposerHandle } | null {
  return resolveAdapter(document, window.location.hostname, adapters, siteFlags);
}

type CheckComposerOptions = {
  allowClear?: boolean;
  forceResend?: boolean;
};

function clearLocalComposerState(): void {
  activeComposer = null;
  lastSnapshotJSON = "";
  hideInlineTrigger();
}

function clearDisconnectedComposer(allowClear: boolean): void {
  if (!activeComposer) return;
  if (document.contains(activeComposer.handle.element)) return;

  pageVoiceBridge.clear();
  clearLocalComposerState();
  if (allowClear) {
    safeSendMessage({ type: "CLEAR_SESSION" });
  }
}

function checkComposer(options: CheckComposerOptions = {}): ActiveComposerState | null {
  const { allowClear = true, forceResend = false } = options;
  clearDisconnectedComposer(allowClear);
  const resolved = chooseComposer();

  if (!resolved) {
    const preservedComposer =
      !allowClear &&
      activeComposer &&
      document.contains(activeComposer.handle.element)
        ? activeComposer
        : null;

    if (preservedComposer) {
      updateInlineTriggerPosition(preservedComposer.handle.element);
      pageVoiceBridge.repositionPrompt();
      return preservedComposer;
    }

    if (activeComposer && allowClear) {
      pageVoiceBridge.clear();
      safeSendMessage({ type: "CLEAR_SESSION" });
    }
    clearLocalComposerState();
    return null;
  }

  const snapshot = resolved.adapter.extractSnapshot(document, resolved.handle);
  const sessionId = buildSessionId(
    resolved.adapter.id,
    snapshot.composerFingerprint
  );

  activeComposer = {
    adapter: resolved.adapter,
    handle: resolved.handle,
    snapshot,
    sessionId,
  };

  updateInlineTriggerPosition(resolved.handle.element);

  const payload = {
    sessionId,
    adapterId: resolved.adapter.id,
    snapshot,
  };
  const currentJSON = JSON.stringify(payload);

  if (!forceResend && currentJSON === lastSnapshotJSON) {
    pageVoiceBridge.repositionPrompt();
    return activeComposer;
  }

  lastSnapshotJSON = currentJSON;

  safeSendMessage(
    {
      type: "UPDATE_SNAPSHOT",
      payload,
    }
  );

  return activeComposer;
}

function resolveHandleForInsert(
  requestedAdapterId?: AdapterId
): { adapter: SiteAdapter; handle: ComposerHandle } | null {
  if (requestedAdapterId) {
    const requestedAdapter = adapters[requestedAdapterId];
    const requestedHandle = requestedAdapter.detectComposer(document);
    if (requestedHandle) {
      return { adapter: requestedAdapter, handle: requestedHandle };
    }
  }

  if (activeComposer) {
    const activeHandle = activeComposer.adapter.detectComposer(document);
    if (activeHandle) {
      return { adapter: activeComposer.adapter, handle: activeHandle };
    }
  }

  return chooseComposer();
}

function onViewportChange(): void {
  if (!inlineTriggerTarget) return;
  if (!document.contains(inlineTriggerTarget)) {
    hideInlineTrigger();
    return;
  }

  updateInlineTriggerPosition(inlineTriggerTarget);
  pageVoiceBridge.repositionPrompt();
}

// Trigger checks on focus, input, and click movement.
document.addEventListener("focusin", () => {
  checkComposer({ allowClear: true });
}, true);
document.addEventListener("input", () => {
  checkComposer({ allowClear: true });
}, true);
document.addEventListener("click", () => {
  checkComposer({ allowClear: true });
}, true);
document.addEventListener("selectionchange", () => {
  checkComposer({ allowClear: false });
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  checkComposer({ allowClear: false });
});
window.addEventListener("focus", () => {
  checkComposer({ allowClear: false });
});
window.addEventListener("pageshow", () => {
  checkComposer({ allowClear: false });
});
window.addEventListener("scroll", onViewportChange, true);
window.addEventListener("resize", onViewportChange);

if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const changedFlags = changes["replymate:featureFlags"];
    if (!changedFlags) return;

    const nextValue = changedFlags.newValue;
    if (nextValue && typeof nextValue === "object") {
      siteFlags = nextValue as SiteFlagSnapshot;
      checkComposer();
    }
  });
}

refreshFeatureFlags();
checkComposer({ allowClear: true });

// Listen for messages from background/side panel.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message;

  switch (type) {
    case "PING": {
      sendResponse({ pong: true, url: window.location.href });
      break;
    }

    case "REFRESH_COMPOSER_SNAPSHOT": {
      const nextComposer = checkComposer({ allowClear: false });
      sendResponse({
        ok: true,
        foundComposer: Boolean(nextComposer),
        adapterId: nextComposer?.adapter.id ?? null,
        sessionId: nextComposer?.sessionId ?? null,
      });
      break;
    }

    case "INSERT_TEXT": {
      const text: string | undefined = payload?.text;
      const adapterId: AdapterId | undefined = payload?.adapterId;
      const mode: "replace" | "append" =
        payload?.mode === "append" ? "append" : "replace";

      if (!text) {
        sendResponse({
          success: false,
          errorCode: "INSERT_FAILED",
          message: "Missing insert text payload.",
        });
        break;
      }

      const resolved = resolveHandleForInsert(adapterId);
      if (!resolved) {
        sendResponse({
          success: false,
          errorCode: "NO_COMPOSER",
          message: "Could not find active text box to insert into.",
        });
        break;
      }

      const result = resolved.adapter.insertText(document, resolved.handle, text, mode);
      if (result.success) {
        checkComposer();
      }

      sendResponse(result);
      break;
    }

    case "VOICE_LOCAL_START": {
      const sessionId: string | undefined = payload?.sessionId;
      const target =
        payload?.target === "draft" || payload?.target === "instructions"
          ? payload.target
          : null;

      if (!sessionId || !target) {
        sendResponse({
          ok: false,
          error: "Invalid local voice payload.",
        });
        break;
      }

      const currentComposer = activeComposer ?? checkComposer({ allowClear: false });
      if (!currentComposer || currentComposer.sessionId !== sessionId) {
        sendResponse({
          ok: false,
          error: "Focus the active composer before starting local voice capture.",
        });
        break;
      }

      void pageVoiceBridge.start({ sessionId, target });
      sendResponse({ ok: true });
      break;
    }

    case "VOICE_LOCAL_STOP": {
      const sessionId: string | undefined = payload?.sessionId;
      pageVoiceBridge.stop(sessionId);
      sendResponse({ ok: true });
      break;
    }

    default:
      sendResponse({ error: `Unknown content message: ${type}` });
  }

  return true;
});
