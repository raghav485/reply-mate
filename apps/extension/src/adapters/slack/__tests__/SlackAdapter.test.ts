// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SlackAdapter } from "../SlackAdapter.js";

function loadFixture(): void {
  const html = readFileSync(resolve(process.cwd(), "src/fixture/slack.html"), "utf8");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = bodyMatch?.[1] ?? html;
  document.title = "Slack Fixture";
}

describe("SlackAdapter", () => {
  let adapter: SlackAdapter;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  function installRectMock(): void {
    rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function mockRect(this: HTMLElement) {
        const element = this as HTMLElement;
        const top = Number(element.dataset.rectTop || 0);
        const height = Number(element.dataset.rectHeight || 0);
        const width = Number(element.dataset.rectWidth || 320);
        const left = Number(element.dataset.rectLeft || 0);

        return {
          x: left,
          y: top,
          top,
          left,
          width,
          height,
          right: left + width,
          bottom: top + height,
          toJSON() {
            return this;
          },
        } as DOMRect;
      });
  }

  beforeEach(() => {
    adapter = new SlackAdapter();
    loadFixture();
    installRectMock();
  });

  afterEach(() => {
    rectSpy?.mockRestore();
  });

  it("detects channel composer when focused", () => {
    const channelEditor = document.getElementById("slack-channel-editor") as HTMLElement;
    channelEditor.focus();

    const handle = adapter.detectComposer(document);
    expect(handle).not.toBeNull();
    expect(handle?.adapterId).toBe("slack");
    expect(handle?.element).toBe(channelEditor);
  });

  it("detects thread composer when focused", () => {
    const threadEditor = document.getElementById("slack-thread-editor") as HTMLElement;
    threadEditor.focus();

    const handle = adapter.detectComposer(document);
    expect(handle).not.toBeNull();
    expect(handle?.adapterId).toBe("slack");
    expect(handle?.element).toBe(threadEditor);
  });

  it("extracts normalized snapshot with metadata and context", () => {
    const threadEditor = document.getElementById("slack-thread-editor") as HTMLElement;
    threadEditor.textContent = "Draft reply text";
    threadEditor.focus();

    const handle = adapter.detectComposer(document);
    expect(handle).not.toBeNull();

    const snapshot = adapter.extractSnapshot(document, handle!);

    expect(snapshot.metadata.siteId).toBe("slack_web");
    expect(snapshot.metadata.channelName).toBe("#customer-support");
    expect(snapshot.metadata.threadTitle).toBe("Thread: Access issue follow-up");
    expect(snapshot.draftText).toContain("Draft reply text");
    expect(snapshot.visibleContext.length).toBeGreaterThan(0);
    expect(snapshot.visibleContext[0].source).toBe("visible_thread");
    expect(snapshot.contextScope).toBe("thread");
    expect(snapshot.composerMode).toBe("thread");
    expect(snapshot.workspaceKey).toContain("::thread::");
    expect(snapshot.sessionVersion).toBe(1);
    expect(snapshot.captureDebug?.adapterId).toBe("slack");
    expect(snapshot.captureDebug?.sourceCounts.visible_thread).toBeGreaterThan(0);
    expect(snapshot.captureDebug?.summary.examinedCandidates).toBeGreaterThanOrEqual(
      snapshot.visibleContext.length
    );
  });

  it("captures channel scope when the channel composer is active", () => {
    const channelEditor = document.getElementById("slack-channel-editor") as HTMLElement;
    channelEditor.focus();

    const handle = adapter.detectComposer(document)!;
    const snapshot = adapter.extractSnapshot(document, handle);

    expect(snapshot.contextScope).toBe("channel");
    expect(snapshot.composerMode).toBe("channel");
    expect(snapshot.workspaceKey).toContain("::channel::");
    expect(snapshot.visibleContext[0].author).toBe("Customer One");
  });

  it("keeps only the latest unique on-screen channel rows", () => {
    const channelEditor = document.getElementById("slack-channel-editor") as HTMLElement;
    channelEditor.focus();

    const handle = adapter.detectComposer(document)!;
    const snapshot = adapter.extractSnapshot(document, handle);
    const texts = snapshot.visibleContext.map((item) => item.text);

    expect(texts).toContain("Just checked again and everything is working on GHL.");
    expect(texts).toContain(
      "@Lucas Montgomery that's odd. We are on it @crmteam please check CRM system stats."
    );
    expect(texts).not.toContain("This stale offscreen row should never be captured.");
    expect(
      texts.filter(
        (text) =>
          text ===
          "@Lucas Montgomery that's odd. We are on it @crmteam please check CRM system stats."
      )
    ).toHaveLength(1);
    expect(snapshot.captureDebug?.dropReasons.some((entry) => entry.reason === "offscreen")).toBe(
      true
    );
    expect(snapshot.captureDebug?.dropReasons.some((entry) => entry.reason === "duplicate")).toBe(
      true
    );
  });

  it("keeps the newest visible row when channel context is truncated", () => {
    const messagesContainer = document.querySelector(
      '[data-qa="messages_container"]'
    ) as HTMLElement;

    for (let index = 0; index < 14; index += 1) {
      const wrapper = document.createElement("div");
      wrapper.className = "c-virtual_list__item";
      wrapper.dataset.rectTop = String(220 + index * 24);
      wrapper.dataset.rectHeight = "24";

      const row = document.createElement("div");
      row.id = `slack-generated-${index}`;
      row.setAttribute("data-qa", "message_container");
      row.dataset.rectTop = String(220 + index * 24);
      row.dataset.rectHeight = "24";

      const author = document.createElement("span");
      author.setAttribute("data-qa", "message_sender");
      author.textContent = "Chris Leventis";

      const timestamp = document.createElement("span");
      timestamp.setAttribute("data-qa", "message_timestamp");
      timestamp.textContent = `10:${String(index).padStart(2, "0")} AM`;

      const text = document.createElement("div");
      text.setAttribute("data-qa", "message-text");
      text.textContent =
        index === 13
          ? "It has been updated."
          : `Earlier context row ${index} that should be dropped before the newest status update.`;

      row.append(author, timestamp, text);
      wrapper.append(row);
      messagesContainer.append(wrapper);
    }

    const channelEditor = document.getElementById("slack-channel-editor") as HTMLElement;
    channelEditor.focus();

    const handle = adapter.detectComposer(document)!;
    const snapshot = adapter.extractSnapshot(document, handle);
    const texts = snapshot.visibleContext.map((item) => item.text);

    expect(texts).toContain("It has been updated.");
    expect(texts).not.toContain(
      "Earlier context row 0 that should be dropped before the newest status update."
    );
  });

  it("inserts replace and append text", () => {
    const channelEditor = document.getElementById("slack-channel-editor") as HTMLElement;
    channelEditor.textContent = "Initial";
    channelEditor.focus();
    const handle = adapter.detectComposer(document)!;

    const replaceResult = adapter.insertText(document, handle, "Replacement", "replace");
    expect(replaceResult.success).toBe(true);
    expect(channelEditor.textContent).toBe("Replacement");

    const appendResult = adapter.insertText(document, handle, "Follow-up", "append");
    expect(appendResult.success).toBe(true);
    expect(channelEditor.textContent).toBe("Replacement\nFollow-up");
  });

  it("reports manual-only attachment capability", () => {
    expect(adapter.getAttachCapability(document)).toBe("manual_only");
  });
});
