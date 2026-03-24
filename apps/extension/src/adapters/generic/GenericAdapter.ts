// =============================================================================
// Generic Adapter — Extracts from arbitrary <textarea> / contenteditable
// =============================================================================

import type {
  SiteAdapter,
  ComposerHandle,
  ComposerSnapshot,
  InsertResult,
  AttachCapability,
} from "@replymate/contracts";
import {
  findFocusedComposerElement,
  generateElementFingerprint,
  getComposerText,
} from "../shared/dom.js";
import { collectVisiblePageContext } from "../shared/pageContext.js";
import { buildCaptureDebugSnapshot } from "../shared/captureDiagnostics.js";

export class GenericAdapter implements SiteAdapter {
  id = "generic" as const;
  siteId = "generic_web" as const;

  detectComposer(doc: Document): ComposerHandle | null {
    const composerElement = findFocusedComposerElement(doc);
    if (!composerElement) return null;

    return {
      element: composerElement,
      adapterId: this.id,
      fingerprint: generateElementFingerprint(composerElement),
    };
  }

  extractSnapshot(
    doc: Document,
    composer: ComposerHandle
  ): ComposerSnapshot {
    const draftText = getComposerText(composer.element);
    const pageContext = collectVisiblePageContext(
      doc,
      composer.element,
      "generic_primary"
    );

    // Attempt to extract title/URL for metadata
    const url = doc.defaultView?.location.href || "";
    const title = doc.title || "";

    return {
      draftText,
      visibleContext: pageContext.items,
      contextScope: pageContext.contextScope,
      workspaceKey: `${this.siteId}::${url.split("?")[0]}::${url.split("?")[0]}`,
      composerMode: "generic",
      metadata: {
        siteId: this.siteId,
        url,
        title,
      },
      extractionConfidence:
        pageContext.items.length > 0
          ? pageContext.extractionConfidence
          : draftText.length > 0
            ? 0.5
            : 0.42,
      warnings: pageContext.warnings,
      pageUrlAtCapture: url,
      viewFingerprint: url.split("?")[0], // Use base URL as rough view proxy
      composerFingerprint: composer.fingerprint,
      sessionVersion: 1,
      captureDebug: buildCaptureDebugSnapshot({
        adapterId: this.id,
        composerMode: "generic",
        contextScope: pageContext.contextScope,
        extractionConfidence:
          pageContext.items.length > 0
            ? pageContext.extractionConfidence
            : draftText.length > 0
              ? 0.5
              : 0.42,
        visibleContext: pageContext.items,
        truncated: pageContext.truncated,
        warnings: pageContext.warnings,
        examinedCandidates: pageContext.diagnostics.examinedCandidates,
        dropReasonCounts: pageContext.diagnostics.dropReasonCounts,
        captureKind: pageContext.diagnostics.captureKind,
        limitedReason: pageContext.diagnostics.limitedReason,
      }),
    };
  }

  insertText(
    _doc: Document,
    composer: ComposerHandle,
    text: string,
    mode: "replace" | "append"
  ): InsertResult {
    const el = composer.element as HTMLElement;

    try {
      if (el.tagName.toLowerCase() === "textarea") {
        const textarea = el as HTMLTextAreaElement;
        // Focus the element first
        textarea.focus();

        if (mode === "replace") {
          // If range is selected, replace selection.
          // Otherwise, typically replace all (or insert at cursor).
          // For MVP "replace" usually means "replace the whole draft text"
          // but if user highlighted, we replace highlight.
          // Let's implement full replacement to be safe for draft-rewrite:
          textarea.value = text;
        } else {
          // Append mode
          textarea.value += (textarea.value.length > 0 ? "\n" : "") + text;
        }

        // Dispatch events so React/Vue/Angular apps notice the change
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
        el.focus();
        
        // Ensure cursor is at the end if appending
        if (mode === "append") {
          const selection = window.getSelection();
          if (selection) {
            selection.selectAllChildren(el);
            selection.collapseToEnd();
          }
        } else {
          // Replace mode: clear first
          el.innerHTML = "";
        }

        // Use modern execCommand if available for undo stack preservation
        if (!document.execCommand("insertText", false, text)) {
          // Fallback if execCommand fails
          const textNode = document.createTextNode(text);
          const selection = window.getSelection();
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(textNode);
            range.collapse(false);
          } else {
            el.appendChild(textNode);
          }
        }

        el.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        return {
          success: false,
          errorCode: "INSERT_FAILED",
          message: "Target is neither textarea nor contenteditable.",
        };
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        errorCode: "INSERT_FAILED",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  getAttachCapability(_doc: Document): AttachCapability {
    return "none"; // Generic sites have no known attach helper hook
  }
}
