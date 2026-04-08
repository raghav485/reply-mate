import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildProviderCredentialStatusResponse,
  createProviderCredentialStore,
  hydrateProviderConfigSecrets,
} from "../providerCredentialStore.js";

function createWindowsProcessRunner() {
  return {
    execFile: async () => ({ stdout: "", stderr: "" }),
    spawn: async (_command: string, args: string[], input = "") => {
      const normalized = input.trim();
      const isDecrypt = args.join(" ").includes("Unprotect");
      if (isDecrypt) {
        const decoded = Buffer.from(normalized, "base64").toString("utf8");
        return { stdout: decoded.replace(/^encrypted:/, ""), stderr: "" };
      }

      return {
        stdout: Buffer.from(`encrypted:${normalized}`, "utf8").toString("base64"),
        stderr: "",
      };
    },
  };
}

describe("providerCredentialStore", () => {
  it("stores and reports provider credentials through the in-memory store", async () => {
    const store = createProviderCredentialStore({
      env: { NODE_ENV: "test" },
    });

    await store.writeCredential({
      target: "cloud",
      kind: "openai",
      apiKey: "sk-test",
    });

    const status = await buildProviderCredentialStatusResponse(store);

    expect(status.storage.backend).toBe("memory");
    expect(status.storage.persistenceMode).toBe("session_only");
    expect(status.credentials).toContainEqual({
      target: "cloud",
      kind: "openai",
      hasStoredApiKey: true,
    });
  });

  it("hydrates request-scoped provider config from the secure store", async () => {
    const store = createProviderCredentialStore({
      env: { NODE_ENV: "test" },
    });
    await store.writeCredential({
      target: "local",
      kind: "openai_compatible_local",
      apiKey: "local-secret",
    });

    const config = await hydrateProviderConfigSecrets(
      {
        mode: "local_models" as const,
        local: {
          kind: "openai_compatible_local" as const,
          baseUrl: "http://127.0.0.1:1234/v1",
          modelName: "qwen3:8b",
          apiKey: "",
          hasStoredApiKey: true,
        },
        cloud: {
          kind: "openai" as const,
          baseUrl: "",
          modelName: "",
          apiKey: "",
          hasStoredApiKey: false,
        },
      },
      store
    );

    expect(config?.local.apiKey).toBe("local-secret");
  });

  it("uses a Windows DPAPI-backed file store without persisting plaintext", async () => {
    const root = await mkdtemp(join(tmpdir(), "replymate-win-store-"));
    const store = createProviderCredentialStore({
      platform: "win32",
      env: {},
      credentialsRoot: root,
      processRunner: createWindowsProcessRunner(),
    });

    await store.writeCredential({
      target: "cloud",
      kind: "openai",
      apiKey: "sk-test-value",
    });

    const status = await buildProviderCredentialStatusResponse(store);
    expect(status.storage.backend).toBe("windows_dpapi");
    expect(status.storage.platform).toBe("windows");
    expect(status.storage.persistenceMode).toBe("persistent_secure");

    const file = await readFile(
      join(root, "ReplyMate", "credentials", "provider-credentials.v1.json"),
      "utf8"
    );
    expect(file).not.toContain("sk-test-value");
    expect(
      await store.readCredential({
        target: "cloud",
        kind: "openai",
      })
    ).toBe("sk-test-value");
  });

  it("writes macOS credentials without placing the raw key in process arguments", async () => {
    const spawn = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const store = createProviderCredentialStore({
      platform: "darwin",
      env: {},
      processRunner: {
        execFile: async () => ({ stdout: "", stderr: "" }),
        spawn,
      },
    });

    await store.writeCredential({
      target: "cloud",
      kind: "openai",
      apiKey: "sk-macos-secret",
    });

    expect(spawn).toHaveBeenCalledWith(
      "security",
      expect.not.arrayContaining(["sk-macos-secret"]),
      "sk-macos-secret\n"
    );
  });

  it("recovers from a corrupted Windows credential file", async () => {
    const root = await mkdtemp(join(tmpdir(), "replymate-win-store-corrupt-"));
    const filePath = join(root, "ReplyMate", "credentials", "provider-credentials.v1.json");
    await mkdir(join(root, "ReplyMate", "credentials"), { recursive: true });
    await writeFile(filePath, "{not-json", "utf8");

    const store = createProviderCredentialStore({
      platform: "win32",
      env: {},
      credentialsRoot: root,
      processRunner: createWindowsProcessRunner(),
    });

    const status = await buildProviderCredentialStatusResponse(store);
    expect(status.storage.message).toContain("corrupted Windows credential store");
    expect(status.credentials.every((entry) => entry.hasStoredApiKey === false)).toBe(true);
  });

  it("reports unsupported persisted storage on Linux", async () => {
    const store = createProviderCredentialStore({
      platform: "linux",
      env: {},
    });

    const status = await buildProviderCredentialStatusResponse(store);
    expect(status.storage.backend).toBe("unsupported");
    expect(status.storage.platform).toBe("linux");
    expect(status.storage.persistenceMode).toBe("unsupported");
    expect(status.storage.supported).toBe(false);
  });
});
