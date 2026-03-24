import { expect, test } from "playwright/test";
import {
  focusComposer,
  getActiveChromeTabId,
  launchExtensionHarness,
  openFixturePage,
  sendRuntimeMessage,
} from "./helpers.js";

test("gmail inline reply fixture captures visible thread context", async () => {
  const harness = await launchExtensionHarness();

  try {
    const fixturePage = await openFixturePage(harness.context, "gmail.html");
    await focusComposer(fixturePage, "#gmail-reply-editor", "Thanks for the clarification");
    await fixturePage.bringToFront();
    const fixtureTabId = await getActiveChromeTabId(harness.extensionPage);

    const syncResponse = await sendRuntimeMessage<{
      session?: {
        snapshot?: {
          contextScope?: string;
          visibleContext?: Array<{ text: string }>;
          warnings?: string[];
          captureDebug?: {
            adapterId?: string;
            captureKind?: string;
            sourceCounts?: Record<string, number>;
            summary?: { examinedCandidates?: number; keptCandidates?: number };
          } | null;
        } | null;
      } | null;
    }>(harness.extensionPage, {
      type: "SYNC_ACTIVE_TAB_SESSION",
      payload: { tabId: fixtureTabId, forceRefresh: true },
    });

    const snapshot = syncResponse.session?.snapshot;
    const warnings = snapshot?.warnings ?? [];
    const texts = (snapshot?.visibleContext ?? []).map((item) => item.text);
    const combinedText = texts.join(" ");
    const captureDebug = snapshot?.captureDebug;

    expect(snapshot?.contextScope).toBe("thread");
    expect(texts.some((text) => text.includes("prorated line item"))).toBeTruthy();
    expect(
      texts.some((text) => text.includes("help updating the campaign workflow before Friday"))
    ).toBeTruthy();
    expect(combinedText).not.toContain("Reply");
    expect(combinedText).not.toContain("More");
    expect(combinedText).not.toContain("to me");
    expect(
      warnings.some((warning) => warning.includes("No email thread is attached"))
    ).toBeFalsy();
    expect(captureDebug?.adapterId).toBe("gmail");
    expect(
      (captureDebug?.sourceCounts?.visible_email_thread ?? 0) +
        (captureDebug?.sourceCounts?.quoted_email ?? 0)
    ).toBeGreaterThan(0);
    expect(captureDebug?.summary?.examinedCandidates ?? 0).toBeGreaterThanOrEqual(
      captureDebug?.summary?.keptCandidates ?? 0
    );
    expect(captureDebug?.captureKind ?? "thread_context").toBeTruthy();
  } finally {
    await harness.cleanup();
  }
});
