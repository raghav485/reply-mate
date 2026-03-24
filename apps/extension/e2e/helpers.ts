import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright/test";

const helpersDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(helpersDir, "..");
const extensionDist = path.resolve(extensionRoot, "dist");
const fixtureDir = path.resolve(extensionRoot, "src", "fixture");

export type ExtensionHarness = {
  context: BrowserContext;
  extensionId: string;
  extensionPage: Page;
  cleanup: () => Promise<void>;
};

export async function launchExtensionHarness(
  extensionPagePath = "src/options/index.html"
): Promise<ExtensionHarness> {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "replymate-e2e-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDist}`,
      `--load-extension=${extensionDist}`,
    ],
  });

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }

  const extensionId = new URL(serviceWorker.url()).host;
  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/${extensionPagePath}`);

  return {
    context,
    extensionId,
    extensionPage,
    cleanup: async () => {
      await context.close();
      await fs.rm(userDataDir, { recursive: true, force: true });
    },
  };
}

export async function openFixturePage(
  context: BrowserContext,
  fixtureName: "slack.html" | "gmail.html"
): Promise<Page> {
  const fixtureHtml = await fs.readFile(path.join(fixtureDir, fixtureName), "utf8");
  const fixtureUrl =
    fixtureName === "slack.html"
      ? "https://app.slack.com/client/T123/C456"
      : "https://mail.google.com/mail/u/0/#inbox";

  await context.route(`${fixtureUrl.split("#")[0]}*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: fixtureHtml,
    });
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRectPatched() {
      const topAttr = this.getAttribute("data-rect-top");
      const heightAttr = this.getAttribute("data-rect-height");
      if (topAttr !== null || heightAttr !== null) {
        const top = Number(topAttr || "0");
        const height = Number(heightAttr || "0");
        const width = Number(this.getAttribute("data-rect-width") || "400");
        return DOMRect.fromRect({
          x: 0,
          y: top,
          width,
          height,
        });
      }

      return original.call(this);
    };
  });

  await page.goto(fixtureUrl);
  return page;
}

export async function focusComposer(page: Page, selector: string, text = ""): Promise<void> {
  await page.locator(selector).click();
  if (text) {
    await page.locator(selector).pressSequentially(text);
  }
}

export async function sendRuntimeMessage<T>(
  extensionPage: Page,
  message: unknown
): Promise<T> {
  return extensionPage.evaluate(
    (payload) =>
      new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(payload, (response) => {
          const lastError = chrome.runtime.lastError;
          if (lastError?.message) {
            reject(new Error(lastError.message));
            return;
          }
          resolve(response);
        });
      }),
    message
  ) as Promise<T>;
}

export async function getActiveChromeTabId(extensionPage: Page): Promise<number> {
  return extensionPage.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const lastError = chrome.runtime.lastError;
          if (lastError?.message) {
            reject(new Error(lastError.message));
            return;
          }
          if (!tabs[0]?.id) {
            reject(new Error("No current tab id."));
            return;
          }
          resolve(tabs[0].id);
        });
      })
  );
}
