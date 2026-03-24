// @vitest-environment jsdom
// =============================================================================
// GenericAdapter Tests
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GenericAdapter } from "../GenericAdapter.js";
import type { AdapterId } from "@replymate/contracts";

describe("GenericAdapter", () => {
  let adapter: GenericAdapter;
  const originalRect = HTMLElement.prototype.getBoundingClientRect;

  function setRect(
    element: HTMLElement,
    rect: Partial<{ top: number; left: number; width: number; height: number }>
  ) {
    element.setAttribute("data-rect-top", String(rect.top ?? 0));
    element.setAttribute("data-rect-left", String(rect.left ?? 0));
    element.setAttribute("data-rect-width", String(rect.width ?? 400));
    element.setAttribute("data-rect-height", String(rect.height ?? 40));
  }

  beforeEach(() => {
    adapter = new GenericAdapter();
    document.body.innerHTML = "";
    HTMLElement.prototype.getBoundingClientRect = function patchedRect() {
      const top = Number(this.getAttribute("data-rect-top") || "0");
      const left = Number(this.getAttribute("data-rect-left") || "0");
      const width = Number(this.getAttribute("data-rect-width") || "400");
      const height = Number(this.getAttribute("data-rect-height") || "40");
      if (
        this.hasAttribute("data-rect-top") ||
        this.hasAttribute("data-rect-left") ||
        this.hasAttribute("data-rect-width") ||
        this.hasAttribute("data-rect-height")
      ) {
        return DOMRect.fromRect({
          x: left,
          y: top,
          width,
          height,
        });
      }

      return originalRect.call(this);
    };
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
  });

  describe("detectComposer", () => {
    it("returns null if no element is focused", () => {
      expect(adapter.detectComposer(document)).toBeNull();
    });

    it("returns handle for focused textarea", () => {
      const textarea = document.createElement("textarea");
      textarea.id = "test-input";
      document.body.appendChild(textarea);
      textarea.focus();

      const handle = adapter.detectComposer(document);
      expect(handle).not.toBeNull();
      expect(handle?.element).toBe(textarea);
      expect(handle?.adapterId).toBe("generic");
      expect(handle?.fingerprint).toBe("textarea#test-input");
    });

    it("returns handle for focused contenteditable", () => {
      const div = document.createElement("div");
      div.setAttribute("contenteditable", "true");
      div.className = "editor";
      document.body.appendChild(div);
      div.focus();

      const handle = adapter.detectComposer(document);
      expect(handle).not.toBeNull();
      expect(handle?.element).toBe(div);
      expect(handle?.fingerprint).toContain("div");
    });
  });

  describe("extractSnapshot", () => {
    it("extracts nearby visible page context from textarea surfaces", () => {
      const sidebar = document.createElement("aside");
      sidebar.className = "sidebar";
      sidebar.textContent = "Navigation";
      setRect(sidebar, { top: 40, left: 0, width: 220, height: 600 });
      document.body.appendChild(sidebar);

      const thread = document.createElement("div");
      thread.className = "comment-thread";
      thread.textContent =
        "Customer asked whether we can confirm the prorated invoice breakdown before Friday.";
      setRect(thread, { top: 180, left: 260, width: 820, height: 80 });
      document.body.appendChild(thread);

      const textarea = document.createElement("textarea");
      textarea.value = "Hello World";
      setRect(textarea, { top: 620, left: 260, width: 820, height: 120 });
      document.body.appendChild(textarea);
      textarea.focus();

      const handle = adapter.detectComposer(document)!;
      const snapshot = adapter.extractSnapshot(document, handle);

      expect(snapshot.draftText).toBe("Hello World");
      expect(snapshot.metadata.siteId).toBe("generic_web");
      expect(snapshot.contextScope).toBe("page");
      expect(snapshot.visibleContext.length).toBeGreaterThan(0);
      expect(snapshot.visibleContext[0]?.source).toBe("visible_page");
      expect(snapshot.visibleContext[0]?.text).toContain("prorated invoice breakdown");
      expect(snapshot.warnings).toContain(
        "Using nearby visible page context; results may be less reliable than thread-aware adapters."
      );
      expect(snapshot.sessionVersion).toBe(1);
      expect(snapshot.captureDebug?.adapterId).toBe("generic");
      expect(snapshot.captureDebug?.captureKind).toBeTruthy();
      expect(snapshot.captureDebug?.sourceCounts.visible_page).toBeGreaterThan(0);
      expect(snapshot.captureDebug?.summary.examinedCandidates).toBeGreaterThanOrEqual(
        snapshot.visibleContext.length
      );
    });

    it("captures visible search results below a top-aligned search composer", () => {
      const autocomplete = document.createElement("div");
      autocomplete.setAttribute("role", "listbox");
      autocomplete.className = "search-suggestions";
      autocomplete.textContent = "Press / to jump to search box google ai model list";
      setRect(autocomplete, { top: 60, left: 180, width: 720, height: 200 });
      document.body.appendChild(autocomplete);

      const resultCard = document.createElement("section");
      resultCard.className = "search-result-card";
      resultCard.textContent =
        "Gemini 3 is Google's new AI model family for multimodal reasoning, coding, and interactive workflows.";
      setRect(resultCard, { top: 260, left: 200, width: 840, height: 120 });
      document.body.appendChild(resultCard);

      const search = document.createElement("textarea");
      search.setAttribute("aria-label", "Search");
      search.value = "google new ai model";
      setRect(search, { top: 20, left: 180, width: 780, height: 40 });
      document.body.appendChild(search);
      search.focus();

      const handle = adapter.detectComposer(document)!;
      const snapshot = adapter.extractSnapshot(document, handle);

      expect(snapshot.contextScope).toBe("page");
      expect(snapshot.visibleContext.some((item) => item.text.includes("Gemini 3"))).toBe(true);
      expect(
        snapshot.visibleContext.some((item) => item.text.includes("jump to search box"))
      ).toBe(false);
    });

    it("captures task title and note body on task-detail pages", () => {
      const title = document.createElement("h1");
      title.textContent = "Eco Wash Hawaii - Forms QC + Reactive & ReEngage";
      setRect(title, { top: 80, left: 260, width: 780, height: 60 });
      document.body.appendChild(title);

      const statusRow = document.createElement("div");
      statusRow.className = "task property-row";
      statusRow.textContent = "Status EUGIN";
      setRect(statusRow, { top: 200, left: 260, width: 420, height: 40 });
      document.body.appendChild(statusRow);

      const noteBody = document.createElement("section");
      noteBody.className = "task-description";
      noteBody.textContent = "Need to Update messaging according to the user's choice";
      setRect(noteBody, { top: 520, left: 260, width: 760, height: 90 });
      document.body.appendChild(noteBody);

      const composer = document.createElement("div");
      composer.setAttribute("contenteditable", "true");
      setRect(composer, { top: 620, left: 260, width: 760, height: 80 });
      document.body.appendChild(composer);
      composer.focus();

      const handle = adapter.detectComposer(document)!;
      const snapshot = adapter.extractSnapshot(document, handle);

      expect(snapshot.contextScope).toBe("page");
      expect(snapshot.visibleContext[0]?.text).toContain("Eco Wash Hawaii");
      expect(
        snapshot.visibleContext.some((item) =>
          item.text.includes("Need to Update messaging according to the user's choice")
        )
      ).toBe(true);
    });

    it("captures visible answer blocks above bottom chat composers", () => {
      const answer = document.createElement("article");
      answer.className = "assistant-response markdown";
      answer.textContent =
        "Bottom line: Keep 3 workflows, but make each one much narrower. Do not combine everything into 1 workflow.";
      setRect(answer, { top: 220, left: 180, width: 860, height: 180 });
      document.body.appendChild(answer);

      const composer = document.createElement("div");
      composer.setAttribute("contenteditable", "true");
      composer.setAttribute("aria-label", "Ask anything");
      setRect(composer, { top: 760, left: 180, width: 860, height: 70 });
      document.body.appendChild(composer);
      composer.focus();

      const handle = adapter.detectComposer(document)!;
      const snapshot = adapter.extractSnapshot(document, handle);

      expect(snapshot.contextScope).toBe("page");
      expect(
        snapshot.visibleContext.some((item) => item.text.includes("Keep 3 workflows"))
      ).toBe(true);
    });

    it("extracts text from contenteditable", () => {
      const div = document.createElement("div");
      div.setAttribute("contenteditable", "true");
      div.textContent = "Rich text content";
      setRect(div, { top: 300, left: 220, width: 640, height: 80 });
      document.body.appendChild(div);
      div.focus();

      const handle = adapter.detectComposer(document)!;
      const snapshot = adapter.extractSnapshot(document, handle);

      expect(snapshot.draftText).toBe("Rich text content");
    });

    it("returns no context when only generic form chrome is present", () => {
      const toolbar = document.createElement("div");
      toolbar.className = "toolbar";
      toolbar.textContent = "Save Draft";
      setRect(toolbar, { top: 40, left: 0, width: 1200, height: 60 });
      document.body.appendChild(toolbar);

      const textarea = document.createElement("textarea");
      textarea.value = "Hello again";
      setRect(textarea, { top: 520, left: 240, width: 720, height: 100 });
      document.body.appendChild(textarea);
      textarea.focus();

      const handle = adapter.detectComposer(document)!;
      const snapshot = adapter.extractSnapshot(document, handle);

      expect(snapshot.contextScope).toBe("none");
      expect(snapshot.visibleContext).toHaveLength(0);
      expect(snapshot.warnings[0]).toContain("Limited page context detected on this site.");
    });
  });

  describe("insertText", () => {
    it("replaces text in textarea", () => {
      const textarea = document.createElement("textarea");
      textarea.value = "Old text";
      document.body.appendChild(textarea);
      
      const handle = { element: textarea, adapterId: "generic" as AdapterId, fingerprint: "test" };
      const result = adapter.insertText(document, handle, "New text", "replace");

      expect(result.success).toBe(true);
      expect(textarea.value).toBe("New text");
    });

    it("appends text in textarea", () => {
      const textarea = document.createElement("textarea");
      textarea.value = "Line 1";
      document.body.appendChild(textarea);
      
      const handle = { element: textarea, adapterId: "generic" as AdapterId, fingerprint: "test" };
      const result = adapter.insertText(document, handle, "Line 2", "append");

      expect(result.success).toBe(true);
      expect(textarea.value).toBe("Line 1\nLine 2");
    });
  });
});
