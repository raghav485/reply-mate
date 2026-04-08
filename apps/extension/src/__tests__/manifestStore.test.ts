import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type ExtensionManifest = {
  version: string;
  host_permissions?: string[];
  optional_host_permissions?: string[];
  content_scripts?: Array<{
    matches?: string[];
  }>;
};

function readJson<T>(relativePath: string): T {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const filePath = path.resolve(testDir, "..", "..", relativePath);
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

describe("manifest.store.json", () => {
  it("stays aligned with the extension package version", () => {
    const manifest = readJson<ExtensionManifest>("manifest.store.json");
    const extensionPackage = readJson<{ version: string }>("package.json");

    expect(manifest.version).toBe(extensionPackage.version);
  });

  it("keeps store-only page access scoped away from dev-only origins", () => {
    const manifest = readJson<ExtensionManifest>("manifest.store.json");
    const contentScriptMatches = manifest.content_scripts?.flatMap((entry) => entry.matches ?? []) ?? [];

    expect(contentScriptMatches).toContain("https://*/*");
    expect(contentScriptMatches).not.toContain("file://*/*");
    expect(contentScriptMatches).not.toContain("http://localhost/*");
    expect(contentScriptMatches).not.toContain("http://127.0.0.1/*");
  });

  it("limits optional runtime host access to custom HTTPS providers", () => {
    const manifest = readJson<ExtensionManifest>("manifest.store.json");

    expect(manifest.optional_host_permissions).toEqual(["https://*/*"]);
    expect(manifest.host_permissions).toEqual(
      expect.arrayContaining([
        "https://app.slack.com/*",
        "https://*.slack.com/*",
        "https://mail.google.com/*",
        "https://api.openai.com/*",
        "https://api.anthropic.com/*",
        "https://generativelanguage.googleapis.com/*",
        "https://openrouter.ai/*",
      ])
    );
  });
});
