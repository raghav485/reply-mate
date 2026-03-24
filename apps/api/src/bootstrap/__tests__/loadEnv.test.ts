import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadLocalEnv } from "../loadEnv.js";

const TEST_KEYS = [
  "REPLYMATE_TEST_ENV_DEFAULT",
  "REPLYMATE_TEST_ENV_OVERRIDE",
  "REPLYMATE_TEST_ENV_SHELL",
] as const;

function clearTestEnv(): void {
  for (const key of TEST_KEYS) {
    delete process.env[key];
  }
}

describe("loadLocalEnv", () => {
  afterEach(() => {
    clearTestEnv();
  });

  it("loads defaults, allows .env.local overrides, and preserves shell env", () => {
    clearTestEnv();
    process.env.REPLYMATE_TEST_ENV_SHELL = "shell-value";

    const repoRoot = mkdtempSync(join(tmpdir(), "replymate-env-"));
    try {
      writeFileSync(
        join(repoRoot, ".env.example"),
        [
          "REPLYMATE_TEST_ENV_DEFAULT=from-example",
          "REPLYMATE_TEST_ENV_OVERRIDE=from-example",
          "REPLYMATE_TEST_ENV_SHELL=from-example",
        ].join("\n")
      );
      writeFileSync(
        join(repoRoot, ".env.local"),
        [
          "REPLYMATE_TEST_ENV_OVERRIDE=from-local",
          "REPLYMATE_TEST_ENV_SHELL=from-local",
        ].join("\n")
      );

      loadLocalEnv({ repoRoot });

      expect(process.env.REPLYMATE_TEST_ENV_DEFAULT).toBe("from-example");
      expect(process.env.REPLYMATE_TEST_ENV_OVERRIDE).toBe("from-local");
      expect(process.env.REPLYMATE_TEST_ENV_SHELL).toBe("shell-value");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("handles a missing .env.local file", () => {
    clearTestEnv();

    const repoRoot = mkdtempSync(join(tmpdir(), "replymate-env-"));
    try {
      writeFileSync(join(repoRoot, ".env.example"), "REPLYMATE_TEST_ENV_DEFAULT=from-example\n");

      loadLocalEnv({ repoRoot });

      expect(process.env.REPLYMATE_TEST_ENV_DEFAULT).toBe("from-example");
      expect(process.env.REPLYMATE_TEST_ENV_OVERRIDE).toBeUndefined();
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
