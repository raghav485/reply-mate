import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "playwright/test";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, "..", "..");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  outputDir: "./test-results",
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run serve --workspace @replymate/api",
    url: "http://127.0.0.1:3000/v1/health",
    reuseExistingServer: true,
    cwd: repoRoot,
    timeout: 60_000,
  },
});
