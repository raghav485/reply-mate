import { expect, test } from "playwright/test";
import {
  focusComposer,
  getActiveChromeTabId,
  launchExtensionHarness,
  openFixturePage,
  sendRuntimeMessage,
} from "./helpers.js";

test("sidepanel page loads and preserves the active session during explicit sync", async () => {
  const harness = await launchExtensionHarness("src/sidepanel/index.html");

  try {
    const fixturePage = await openFixturePage(harness.context, "slack.html");
    await focusComposer(fixturePage, "#slack-channel-editor", "Working on it");
    await fixturePage.bringToFront();
    const fixtureTabId = await getActiveChromeTabId(harness.extensionPage);

    await expect(
      harness.extensionPage.getByRole("heading", { name: "ReplyMate" })
    ).toBeVisible();
    await expect(
      harness.extensionPage.getByTestId("replymate-connection-status")
    ).toContainText(/connected|connecting/i);

    const syncResponse = await sendRuntimeMessage<{
      session?: { snapshot?: { draftText?: string } | null } | null;
    }>(harness.extensionPage, {
      type: "SYNC_ACTIVE_TAB_SESSION",
      payload: { tabId: fixtureTabId, forceRefresh: true },
    });

    expect(syncResponse.session?.snapshot?.draftText).toContain("Working on it");
    await expect(
      harness.extensionPage.getByTestId("replymate-composer-state")
    ).toContainText(/active text box/i);
  } finally {
    await harness.cleanup();
  }
});
