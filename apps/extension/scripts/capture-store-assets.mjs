import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(scriptDir, "..");
const extensionDist = path.resolve(extensionRoot, "dist");
const fixtureDir = path.resolve(extensionRoot, "src", "fixture");
const assetsDir = path.resolve(extensionRoot, "..", "..", "docs", "store", "assets");
const tempPrefix = path.join(os.tmpdir(), "replymate-store-assets-");

function fileToDataUrl(filePath) {
  return fs.readFile(filePath).then((buffer) => {
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  });
}

async function waitForText(page, text) {
  const normalized = text.toLowerCase();
  await page.waitForFunction(
    (expected) => document.body?.innerText?.toLowerCase().includes(expected),
    normalized,
    { timeout: 15_000 }
  );
}

async function sendRuntimeMessage(page, message) {
  return page.evaluate(
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
  );
}

async function getActiveChromeTabId(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const lastError = chrome.runtime.lastError;
          if (lastError?.message) {
            reject(new Error(lastError.message));
            return;
          }
          if (!tabs[0]?.id) {
            reject(new Error("No active tab id was available."));
            return;
          }
          resolve(tabs[0].id);
        });
      })
  );
}

async function focusComposer(page, selector, text) {
  await page.locator(selector).click();
  if (text) {
    await page.locator(selector).pressSequentially(text);
  }
}

async function openFixturePage(context, fixtureName) {
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
  await page.setViewportSize({ width: 860, height: 744 });
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

async function ensureStoreManifest() {
  const manifestPath = path.join(extensionDist, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const matches = manifest.content_scripts?.flatMap((entry) => entry.matches ?? []) ?? [];

  if (!matches.includes("https://*/*")) {
    throw new Error("dist/manifest.json does not look like the store manifest. Run build:store first.");
  }

  if (matches.includes("file://*/*")) {
    throw new Error("dist/manifest.json still includes dev-only file access. Run build:store first.");
  }
}

async function launchExtensionContext() {
  const userDataDir = await fs.mkdtemp(tempPrefix);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: [
      `--disable-extensions-except=${extensionDist}`,
      `--load-extension=${extensionDist}`,
    ],
  });

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }

  return {
    context,
    extensionId: new URL(serviceWorker.url()).host,
    cleanup: async () => {
      await context.close();
      await fs.rm(userDataDir, { recursive: true, force: true });
    },
  };
}

async function captureSettingsScreenshot(page, outputPath) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await waitForText(page, "ReplyMate Settings");
  await waitForText(page, "First-Run Checklist");
  await page.screenshot({ path: outputPath });
}

async function captureWorkspaceImages(
  context,
  extensionId,
  controlPage,
  fixtureName,
  selector,
  typedText,
  tempDir
) {
  const sidePanelPage = await context.newPage();
  await sidePanelPage.setViewportSize({ width: 390, height: 744 });
  await sidePanelPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  await waitForText(sidePanelPage, "ReplyMate");

  const fixturePage = await openFixturePage(context, fixtureName);
  await focusComposer(fixturePage, selector, typedText);
  await fixturePage.bringToFront();
  const fixtureTabId = await getActiveChromeTabId(controlPage);

  await sendRuntimeMessage(sidePanelPage, {
    type: "SYNC_ACTIVE_TAB_SESSION",
    payload: { tabId: fixtureTabId, forceRefresh: true },
  });

  await waitForText(sidePanelPage, "Active text box detected");

  const fixtureImagePath = path.join(
    tempDir,
    fixtureName.replace(".html", "-workspace.png")
  );
  const sidePanelImagePath = path.join(
    tempDir,
    fixtureName.replace(".html", "-sidepanel.png")
  );

  await fixturePage.screenshot({ path: fixtureImagePath });
  await sidePanelPage.screenshot({ path: sidePanelImagePath });

  await fixturePage.close();
  await sidePanelPage.close();

  return {
    fixtureImagePath,
    sidePanelImagePath,
  };
}

async function captureCompositeScreenshot(
  context,
  outputPath,
  workspaceImagePath,
  sidePanelImagePath,
  label,
  eyebrow
) {
  const page = await context.newPage();
  const workspaceImage = await fileToDataUrl(workspaceImagePath);
  const sidePanelImage = await fileToDataUrl(sidePanelImagePath);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`
    <html>
      <head>
        <style>
          :root {
            color-scheme: light;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            min-height: 100vh;
            background:
              radial-gradient(circle at top left, rgba(34, 197, 94, 0.2), transparent 30%),
              linear-gradient(180deg, #f5f7fa 0%, #eef2f7 100%);
            color: #0f172a;
          }
          .frame {
            width: 1280px;
            height: 800px;
            padding: 36px;
          }
          .card {
            width: 100%;
            height: 100%;
            background: rgba(255, 255, 255, 0.9);
            border: 1px solid rgba(148, 163, 184, 0.28);
            border-radius: 28px;
            box-shadow: 0 24px 80px rgba(15, 23, 42, 0.12);
            padding: 26px;
            display: grid;
            grid-template-rows: auto 1fr;
            gap: 18px;
          }
          .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
          }
          .eyebrow {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 10px;
            border-radius: 999px;
            background: #e2f7ea;
            color: #166534;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }
          .title {
            margin: 12px 0 0;
            font-size: 28px;
            line-height: 1.15;
            font-weight: 800;
          }
          .subtitle {
            margin: 8px 0 0;
            max-width: 760px;
            color: #475569;
            font-size: 15px;
            line-height: 1.5;
          }
          .browser {
            border-radius: 22px;
            overflow: hidden;
            border: 1px solid rgba(148, 163, 184, 0.35);
            background: #ffffff;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
          }
          .browser-bar {
            height: 46px;
            background: #e2e8f0;
            border-bottom: 1px solid rgba(148, 163, 184, 0.3);
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 0 18px;
          }
          .dot {
            width: 11px;
            height: 11px;
            border-radius: 50%;
            background: #94a3b8;
          }
          .workspace {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 390px;
            min-height: 674px;
          }
          .workspace-shot {
            width: 100%;
            height: 674px;
            object-fit: cover;
            object-position: top left;
            border-right: 1px solid rgba(148, 163, 184, 0.25);
          }
          .panel-shot {
            width: 100%;
            height: 674px;
            object-fit: cover;
            object-position: top left;
            background: #11111a;
          }
        </style>
      </head>
      <body>
        <div class="frame">
          <div class="card">
            <div class="header">
              <div>
                <div class="eyebrow">${eyebrow}</div>
                <h1 class="title">${label}</h1>
                <p class="subtitle">Actual store-path UI running against ReplyMate's built-in Slack and Gmail fixtures.</p>
              </div>
            </div>
            <div class="browser">
              <div class="browser-bar">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </div>
              <div class="workspace">
                <img class="workspace-shot" src="${workspaceImage}" alt="" />
                <img class="panel-shot" src="${sidePanelImage}" alt="" />
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `);

  await page.screenshot({ path: outputPath });
  await page.close();
}

async function capturePromoImages(context, inputPaths) {
  const iconPath = path.join(extensionDist, "icons", "icon-128.png");
  const page = await context.newPage();
  const [iconImage, settingsImage, slackImage, gmailImage] = await Promise.all([
    fileToDataUrl(iconPath),
    fileToDataUrl(inputPaths.settings),
    fileToDataUrl(inputPaths.slack),
    fileToDataUrl(inputPaths.gmail),
  ]);

  const renderPromo = async ({
    width,
    height,
    outputPath,
    title,
    subtitle,
    slackTop,
    gmailTop,
    cardWidth,
    cardHeight,
  }) => {
    await page.setViewportSize({ width, height });
    await page.setContent(`
      <html>
        <head>
          <style>
            :root {
              color-scheme: light;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            }
            * { box-sizing: border-box; }
            body {
              margin: 0;
              width: ${width}px;
              height: ${height}px;
              overflow: hidden;
              background:
                radial-gradient(circle at 20% 20%, rgba(74, 222, 128, 0.36), transparent 28%),
                radial-gradient(circle at 88% 16%, rgba(59, 130, 246, 0.26), transparent 24%),
                linear-gradient(135deg, #0f172a 0%, #111827 52%, #1e293b 100%);
              color: white;
            }
            .wrap {
              position: relative;
              width: 100%;
              height: 100%;
              padding: ${width > 500 ? 44 : 24}px;
            }
            .badge {
              display: inline-flex;
              align-items: center;
              gap: 10px;
              padding: 8px 14px;
              border-radius: 999px;
              background: rgba(15, 23, 42, 0.5);
              border: 1px solid rgba(148, 163, 184, 0.22);
              backdrop-filter: blur(12px);
              font-size: ${width > 500 ? 14 : 11}px;
              font-weight: 700;
              letter-spacing: 0.08em;
              text-transform: uppercase;
            }
            .icon {
              width: ${width > 500 ? 32 : 22}px;
              height: ${width > 500 ? 32 : 22}px;
              border-radius: 9px;
              overflow: hidden;
              flex: none;
            }
            .title {
              max-width: ${width > 500 ? 520 : 220}px;
              margin: ${width > 500 ? 22 : 14}px 0 0;
              font-size: ${width > 500 ? 52 : 26}px;
              line-height: 0.98;
              font-weight: 900;
              letter-spacing: -0.04em;
            }
            .subtitle {
              max-width: ${width > 500 ? 460 : 220}px;
              margin: ${width > 500 ? 16 : 10}px 0 0;
              color: rgba(226, 232, 240, 0.9);
              font-size: ${width > 500 ? 19 : 12}px;
              line-height: 1.45;
            }
            .card {
              position: absolute;
              right: ${width > 500 ? 44 : 12}px;
              width: ${cardWidth}px;
              height: ${cardHeight}px;
              border-radius: 24px;
              overflow: hidden;
              border: 1px solid rgba(255, 255, 255, 0.18);
              box-shadow: 0 24px 70px rgba(15, 23, 42, 0.35);
            }
            .card img {
              width: 100%;
              height: 100%;
              object-fit: cover;
              object-position: top left;
              display: block;
            }
            .settings {
              bottom: ${width > 500 ? 44 : 16}px;
              transform: rotate(-4deg);
              background: rgba(255, 255, 255, 0.08);
            }
            .slack {
              top: ${slackTop}px;
              transform: rotate(6deg);
              background: rgba(255, 255, 255, 0.08);
            }
            .gmail {
              top: ${gmailTop}px;
              right: ${width > 500 ? 300 : 118}px;
              transform: rotate(-8deg);
              background: rgba(255, 255, 255, 0.08);
            }
            .grid {
              position: absolute;
              inset: 0;
              background-image:
                linear-gradient(rgba(148, 163, 184, 0.08) 1px, transparent 1px),
                linear-gradient(90deg, rgba(148, 163, 184, 0.08) 1px, transparent 1px);
              background-size: 46px 46px;
              mask-image: linear-gradient(180deg, rgba(255,255,255,0.6), transparent 70%);
              pointer-events: none;
            }
          </style>
        </head>
        <body>
          <div class="grid"></div>
          <div class="wrap">
            <div class="badge">
              <img class="icon" src="${iconImage}" alt="" />
              <span>ReplyMate</span>
            </div>
            <h1 class="title">${title}</h1>
            <p class="subtitle">${subtitle}</p>
            <div class="card slack"><img src="${slackImage}" alt="" /></div>
            <div class="card gmail"><img src="${gmailImage}" alt="" /></div>
            <div class="card settings"><img src="${settingsImage}" alt="" /></div>
          </div>
        </body>
      </html>
    `);
    await page.screenshot({ path: outputPath });
  };

  await renderPromo({
    width: 440,
    height: 280,
    outputPath: path.join(assetsDir, "replymate-promo-small.png"),
    title: "Draft replies where you work.",
    subtitle: "Slack, Gmail, local models, and your own API keys.",
    slackTop: 86,
    gmailTop: 124,
    cardWidth: 176,
    cardHeight: 112,
  });

  await renderPromo({
    width: 1400,
    height: 560,
    outputPath: path.join(assetsDir, "replymate-promo-marquee.png"),
    title: "ReplyMate keeps reply drafting inside the active site.",
    subtitle: "Store-path screenshots, encrypted local vault storage, and direct local or BYOK model access.",
    slackTop: 70,
    gmailTop: 144,
    cardWidth: 360,
    cardHeight: 228,
  });

  await page.close();
}

async function main() {
  await ensureStoreManifest();
  await fs.mkdir(assetsDir, { recursive: true });
  const tempDir = await fs.mkdtemp(tempPrefix);
  const harness = await launchExtensionContext();

  try {
    const controlPage = await harness.context.newPage();
    await controlPage.goto(`chrome-extension://${harness.extensionId}/src/options/index.html`);
    await waitForText(controlPage, "ReplyMate Settings");

    const settingsPath = path.join(assetsDir, "replymate-settings-store.png");
    await captureSettingsScreenshot(controlPage, settingsPath);

    const slackImages = await captureWorkspaceImages(
      harness.context,
      harness.extensionId,
      controlPage,
      "slack.html",
      "#slack-channel-editor",
      "Working on it",
      tempDir
    );
    const slackPath = path.join(assetsDir, "replymate-workflow-slack-store.png");
    await captureCompositeScreenshot(
      harness.context,
      slackPath,
      slackImages.fixtureImagePath,
      slackImages.sidePanelImagePath,
      "Slack capture and drafting in the same workspace",
      "Slack workflow"
    );

    const gmailImages = await captureWorkspaceImages(
      harness.context,
      harness.extensionId,
      controlPage,
      "gmail.html",
      "#gmail-reply-editor",
      "Thanks for the clarification",
      tempDir
    );
    const gmailPath = path.join(assetsDir, "replymate-workflow-gmail-store.png");
    await captureCompositeScreenshot(
      harness.context,
      gmailPath,
      gmailImages.fixtureImagePath,
      gmailImages.sidePanelImagePath,
      "Gmail thread context stays visible while ReplyMate drafts",
      "Gmail workflow"
    );

    await capturePromoImages(harness.context, {
      settings: settingsPath,
      slack: slackPath,
      gmail: gmailPath,
    });

    await controlPage.close();
    console.log("Store assets captured in docs/store/assets.");
  } finally {
    await harness.cleanup();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
