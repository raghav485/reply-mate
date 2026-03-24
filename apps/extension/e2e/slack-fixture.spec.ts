import { expect, test } from "playwright/test";
import {
  focusComposer,
  getActiveChromeTabId,
  launchExtensionHarness,
  openFixturePage,
  sendRuntimeMessage,
} from "./helpers.js";

test("slack fixture keeps latest unique nearby messages in captured context", async () => {
  const harness = await launchExtensionHarness();

  try {
    const fixturePage = await openFixturePage(harness.context, "slack.html");
    await focusComposer(fixturePage, "#slack-channel-editor", "Checking now");
    await fixturePage.bringToFront();
    const fixtureTabId = await getActiveChromeTabId(harness.extensionPage);

    const syncResponse = await sendRuntimeMessage<{
      session?: {
        snapshot?: {
          visibleContext?: Array<{ text: string; source: string }>;
          captureDebug?: {
            adapterId?: string;
            sourceCounts?: Record<string, number>;
            summary?: { examinedCandidates?: number; keptCandidates?: number };
            dropReasons?: Array<{ reason: string; count: number }>;
          } | null;
        } | null;
      } | null;
    }>(harness.extensionPage, {
      type: "SYNC_ACTIVE_TAB_SESSION",
      payload: { tabId: fixtureTabId, forceRefresh: true },
    });

    const visibleContext = syncResponse.session?.snapshot?.visibleContext ?? [];
    const captureDebug = syncResponse.session?.snapshot?.captureDebug;
    const texts = visibleContext.map((item) => item.text);

    expect(texts).toContain("Just checked again and everything is working on GHL.");
    expect(texts).toContain("Thanks for the update, we've been seeing people come back online.");
    expect(texts).not.toContain("This stale offscreen row should never be captured.");
    expect(
      texts.filter((text) => text.includes("@crmteam please check CRM system stats."))
    ).toHaveLength(1);
    expect(captureDebug?.adapterId).toBe("slack");
    expect(captureDebug?.sourceCounts?.visible_channel ?? 0).toBeGreaterThan(0);
    expect(captureDebug?.summary?.examinedCandidates ?? 0).toBeGreaterThanOrEqual(
      captureDebug?.summary?.keptCandidates ?? 0
    );
    expect(
      captureDebug?.dropReasons?.some((entry) => entry.reason === "offscreen")
    ).toBeTruthy();
  } finally {
    await harness.cleanup();
  }
});
