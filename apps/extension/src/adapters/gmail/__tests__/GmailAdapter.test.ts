// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { GmailAdapter } from "../GmailAdapter.js";

function loadFixture(): void {
  const html = readFileSync(resolve(process.cwd(), "src/fixture/gmail.html"), "utf8");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = bodyMatch?.[1] ?? html;
  document.title = "Gmail Fixture";
}

describe("GmailAdapter", () => {
  let adapter: GmailAdapter;

  beforeEach(() => {
    adapter = new GmailAdapter();
    loadFixture();
  });

  it("detects reply composer when focused", () => {
    const replyEditor = document.getElementById("gmail-reply-editor") as HTMLElement;
    replyEditor.focus();

    const handle = adapter.detectComposer(document);
    expect(handle).not.toBeNull();
    expect(handle?.adapterId).toBe("gmail");
    expect(handle?.element).toBe(replyEditor);
  });

  it("detects compose editor in common pop-out style", () => {
    const composeEditor = document.getElementById("gmail-compose-editor") as HTMLElement;
    composeEditor.focus();

    const handle = adapter.detectComposer(document);
    expect(handle).not.toBeNull();
    expect(handle?.adapterId).toBe("gmail");
    expect(handle?.element).toBe(composeEditor);
  });

  it("extracts normalized snapshot with subject, sender, and quoted context", () => {
    const replyEditor = document.getElementById("gmail-reply-editor") as HTMLElement;
    replyEditor.textContent = "Thanks for the question";
    replyEditor.focus();

    const handle = adapter.detectComposer(document);
    expect(handle).not.toBeNull();

    const snapshot = adapter.extractSnapshot(document, handle!);

    expect(snapshot.metadata.siteId).toBe("gmail_web");
    expect(snapshot.metadata.threadTitle).toBe("Re: Q4 invoice clarification");
    expect(snapshot.metadata.senderName).toBe("Alex Customer");
    expect(snapshot.draftText).toContain("Thanks for the question");
    expect(snapshot.visibleContext.length).toBeGreaterThan(0);
    expect(["visible_email_thread", "quoted_email"]).toContain(
      snapshot.visibleContext[0].source
    );
    expect(
      snapshot.visibleContext.some((item) =>
        item.text.includes("Hello Support Team, could you confirm why the invoice includes a prorated line item")
      )
    ).toBe(true);
    expect(
      snapshot.visibleContext.some((item) =>
        item.text.includes("help updating the campaign workflow before Friday")
      )
    ).toBe(true);
    expect(snapshot.visibleContext.some((item) => /reply|more|to me/i.test(item.text))).toBe(
      false
    );
    expect(snapshot.contextScope).toBe("thread");
    expect(snapshot.warnings.join(" ")).not.toContain(
      "No email thread is attached to this compose surface"
    );
    expect(snapshot.sessionVersion).toBe(1);
    expect(snapshot.captureDebug?.adapterId).toBe("gmail");
    expect(
      (snapshot.captureDebug?.sourceCounts.visible_email_thread ?? 0) +
        (snapshot.captureDebug?.sourceCounts.quoted_email ?? 0)
    ).toBeGreaterThan(0);
    expect(snapshot.captureDebug?.summary.examinedCandidates).toBeGreaterThanOrEqual(
      snapshot.visibleContext.length
    );
  });

  it("uses nearby visible page context for new compose surfaces", () => {
    const composeEditor = document.getElementById("gmail-compose-editor") as HTMLElement;
    composeEditor.textContent = "Following up on this.";
    composeEditor.focus();

    const handle = adapter.detectComposer(document);
    expect(handle).not.toBeNull();

    const snapshot = adapter.extractSnapshot(document, handle!);

    expect(snapshot.contextScope).toBe("page");
    expect(snapshot.visibleContext.length).toBeGreaterThan(0);
    expect(snapshot.visibleContext[0].source).toBe("visible_page");
    expect(snapshot.metadata.threadTitle).toBe("Follow up on survey reward campaign");
    expect(snapshot.warnings.join(" ")).toContain(
      "No email thread is attached to this compose surface"
    );
    expect(snapshot.captureDebug?.adapterId).toBe("gmail");
    expect(snapshot.captureDebug?.captureKind).toBeTruthy();
    expect(snapshot.captureDebug?.sourceCounts.visible_page).toBeGreaterThan(0);
  });

  it("keeps inline replies in thread mode even inside broad Gmail shell containers", () => {
    const replyEditor = document.getElementById("gmail-reply-editor") as HTMLElement;
    replyEditor.focus();

    const handle = adapter.detectComposer(document)!;
    const snapshot = adapter.extractSnapshot(document, handle);

    expect(snapshot.contextScope).toBe("thread");
    expect(snapshot.visibleContext.length).toBeGreaterThan(0);
    expect(snapshot.visibleContext.every((item) => item.source !== "visible_page")).toBe(true);
    expect(snapshot.warnings.join(" ")).not.toContain("Limited Gmail thread context detected");
  });

  it("treats collapsed visible Gmail cards as reply-thread context", () => {
    document.getElementById("gmail-message-1")?.remove();
    const replyEditor = document.getElementById("gmail-reply-editor") as HTMLElement;
    replyEditor.focus();

    const handle = adapter.detectComposer(document)!;
    const snapshot = adapter.extractSnapshot(document, handle);

    expect(snapshot.contextScope).toBe("thread");
    expect(snapshot.visibleContext.length).toBeGreaterThan(0);
    expect(snapshot.visibleContext.some((item) => item.text.includes("prorated line item"))).toBe(true);
    expect(snapshot.warnings.join(" ")).not.toContain(
      "No email thread is attached to this compose surface"
    );
  });

  it("falls back to quoted thread content without switching to page mode", () => {
    document.getElementById("gmail-message-1")?.remove();
    document.getElementById("gmail-message-summary-1")?.remove();
    document.getElementById("gmail-message-card-1")?.remove();
    document.getElementById("gmail-message-summary-2")?.remove();
    document.getElementById("gmail-message-card-2")?.remove();
    const replyEditor = document.getElementById("gmail-reply-editor") as HTMLElement;
    replyEditor.focus();

    const handle = adapter.detectComposer(document)!;
    const snapshot = adapter.extractSnapshot(document, handle);

    expect(snapshot.contextScope).toBe("thread");
    expect(snapshot.visibleContext.length).toBeGreaterThan(0);
    expect(snapshot.visibleContext.every((item) => item.source === "quoted_email")).toBe(true);
    expect(snapshot.warnings.join(" ")).not.toContain(
      "No email thread is attached to this compose surface"
    );
  });

  it("sanitizes Gmail fallback text so header and action chrome are excluded", () => {
    const replyEditor = document.getElementById("gmail-reply-editor") as HTMLElement;
    replyEditor.focus();

    const handle = adapter.detectComposer(document)!;
    const snapshot = adapter.extractSnapshot(document, handle);
    const combinedText = snapshot.visibleContext.map((item) => item.text).join(" ");

    expect(combinedText).toContain("We can't react with an emoji to the group thread");
    expect(combinedText).not.toContain("Reply");
    expect(combinedText).not.toContain("More");
    expect(combinedText).not.toContain("to me");
    expect(combinedText).not.toContain("team@lcharcodetailingofclayton.com");
    expect(combinedText).not.toContain("You can't react with an emoji to a group");
  });

  it("inserts replace and append text", () => {
    const replyEditor = document.getElementById("gmail-reply-editor") as HTMLElement;
    replyEditor.textContent = "Initial";
    replyEditor.focus();
    const handle = adapter.detectComposer(document)!;

    const replaceResult = adapter.insertText(document, handle, "Replacement", "replace");
    expect(replaceResult.success).toBe(true);
    expect(replyEditor.textContent).toBe("Replacement");

    const appendResult = adapter.insertText(document, handle, "Follow-up", "append");
    expect(appendResult.success).toBe(true);
    expect(replyEditor.textContent).toBe("Replacement\nFollow-up");
  });

  it("reports manual-only attachment capability", () => {
    expect(adapter.getAttachCapability(document)).toBe("manual_only");
  });
});
