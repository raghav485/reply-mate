import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsServiceImpl } from "../SettingsService.js";

type StorageChangeListener = (
  changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
  areaName: string
) => void;

function createChromeMock(
  initialStore: Record<string, unknown> = {},
  runtimeHandler?: (message: unknown) => unknown | Promise<unknown>
) {
  const store = { ...initialStore };
  const listeners = new Set<StorageChangeListener>();

  const chromeMock = {
    runtime: {
      lastError: null,
      sendMessage: vi.fn((message: unknown, callback: (response: unknown) => void) => {
        Promise.resolve(runtimeHandler ? runtimeHandler(message) : undefined).then((response) =>
          callback(response)
        );
      }),
    },
    storage: {
      local: {
        get: vi.fn(async (keys?: string[]) => {
          if (!Array.isArray(keys)) {
            return { ...store };
          }

          const result: Record<string, unknown> = {};
          for (const key of keys) {
            if (key in store) {
              result[key] = store[key];
            }
          }
          return result;
        }),
        set: vi.fn(async (next: Record<string, unknown>) => {
          const changes: Record<string, { newValue?: unknown; oldValue?: unknown }> = {};
          for (const [key, value] of Object.entries(next)) {
            changes[key] = { oldValue: store[key], newValue: value };
            store[key] = value;
          }
          for (const listener of listeners) {
            listener(changes, "local");
          }
        }),
      },
      onChanged: {
        addListener: vi.fn((listener: StorageChangeListener) => {
          listeners.add(listener);
        }),
        removeListener: vi.fn((listener: StorageChangeListener) => {
          listeners.delete(listener);
        }),
      },
    },
  };

  return { chromeMock, store };
}

describe("SettingsServiceImpl", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads, saves, strips raw api keys, and notifies subscribers", async () => {
    const { chromeMock, store } = createChromeMock();
    vi.stubGlobal("chrome", chromeMock);

    const service = new SettingsServiceImpl();
    await service.load();

    const listener = vi.fn();
    service.subscribe(listener);

    const next = service.get();
    next.provider.mode = "byok_api";
    next.provider.cloud.kind = "openai";
    next.provider.cloud.modelName = "gpt-4.1-mini";
    next.provider.cloud.apiKey = "sk-test";
    next.provider.cloud.hasStoredApiKey = true;
    next.preferences.defaultCostMode = "cloud_quality";

    await service.save(next);

    expect(service.get().provider.cloud.apiKey).toBe("");
    expect(service.get().provider.cloud.hasStoredApiKey).toBe(true);
    expect(listener).toHaveBeenCalled();
    expect(store["replymate:appSettings"]).toMatchObject({
      provider: {
        cloud: {
          apiKey: "",
          hasStoredApiKey: true,
        },
      },
    });
  });

  it("preserves an explicitly saved backend URL from stored settings", async () => {
    const { chromeMock } = createChromeMock({
      "replymate:appSettings": {
        backend: {
          baseUrl: "http://127.0.0.1:3100",
          token: "",
          validationWarnings: [],
        },
        provider: {
          mode: "local_models",
          local: {
            kind: "ollama",
            baseUrl: "http://127.0.0.1:11434",
            modelName: "qwen3:8b",
            apiKey: "",
            hasStoredApiKey: false,
          },
          cloud: {
            kind: "openai",
            baseUrl: "",
            modelName: "",
            apiKey: "",
            hasStoredApiKey: false,
          },
        },
        preferences: {},
        featureFlags: {},
      },
    });
    vi.stubGlobal("chrome", chromeMock);

    const service = new SettingsServiceImpl();
    await service.load();

    expect(service.get().backend.baseUrl).toBe("http://127.0.0.1:3100");
  });

  it("validates the configured backend through the background runtime bridge", async () => {
    const { chromeMock } = createChromeMock({}, async () => ({
      ok: true,
      result: {
        valid: true,
        warnings: [],
        apiVersion: "v1",
        serverVersion: "0.3.0",
        deploymentMode: "local",
        cloudGenerationAvailable: true,
        authMode: "required",
        draftingProvider: {
          runtimeType: "openai_compatible",
          ready: true,
          modelName: "gpt-4.1-mini",
        },
        parserProvider: {
          runtimeType: "drafting_runtime",
          ready: true,
          imageOcrAvailable: true,
          fallbackMode: "metadata_local",
        },
      },
    }));

    vi.stubGlobal("chrome", chromeMock);

    const service = new SettingsServiceImpl();
    const result = await service.validateConnection({
      baseUrl: "http://localhost:3000/",
      token: "secret-token",
      providerConfig: {
        mode: "byok_api",
        local: {
          kind: "ollama",
          baseUrl: "http://127.0.0.1:11434",
          modelName: "qwen3:8b",
          apiKey: "",
          hasStoredApiKey: false,
        },
        cloud: {
          kind: "openai",
          baseUrl: "",
          modelName: "gpt-4.1-mini",
          apiKey: "",
          hasStoredApiKey: true,
        },
      },
    });

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "VALIDATE_SETTINGS",
      }),
      expect.any(Function)
    );
    expect(result.valid).toBe(true);
    expect(result.draftingProvider.runtimeType).toBe("openai_compatible");
  });

  it("reads native runtime status through the background runtime bridge", async () => {
    const { chromeMock } = createChromeMock({}, async () => ({
      ok: true,
      status: {
        transport: "native_host",
        availability: "ready",
        extensionId: "gfjfeddlbpnmpflhbfmgpobglimhfjip",
        hostName: "app.replymate.native",
        message: "ReplyMate local runtime is connected through app.replymate.native.",
      },
    }));

    vi.stubGlobal("chrome", chromeMock);

    const service = new SettingsServiceImpl();
    const result = await service.getNativeRuntimeStatus({
      baseUrl: "http://localhost:3000",
      token: "",
    });

    expect(result.transport).toBe("native_host");
    expect(result.availability).toBe("ready");
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "GET_NATIVE_RUNTIME_STATUS",
      }),
      expect.any(Function)
    );
  });

  it("manages provider credential status through the background runtime bridge", async () => {
    let callCount = 0;
    const { chromeMock } = createChromeMock({}, async () => {
      callCount += 1;
      return callCount === 1
        ? {
            ok: true,
            status: {
              apiVersion: "v1",
              storage: {
                backend: "macos_keychain",
                platform: "macos",
                persistenceMode: "persistent_secure",
                supported: true,
                message: "Stored in macOS Keychain.",
              },
              runtime: {
                transport: "native_host",
                availability: "ready",
                extensionId: "gfjfeddlbpnmpflhbfmgpobglimhfjip",
                hostName: "app.replymate.native",
                message:
                  "ReplyMate local runtime is connected through app.replymate.native.",
              },
              credentials: [
                {
                  target: "cloud",
                  kind: "openai",
                  hasStoredApiKey: true,
                },
              ],
            },
          }
        : {
            ok: true,
            status: {
              apiVersion: "v1",
              storage: {
                backend: "macos_keychain",
                platform: "macos",
                persistenceMode: "persistent_secure",
                supported: true,
              },
              runtime: {
                transport: "native_host",
                availability: "ready",
                extensionId: "gfjfeddlbpnmpflhbfmgpobglimhfjip",
                hostName: "app.replymate.native",
                message:
                  "ReplyMate local runtime is connected through app.replymate.native.",
              },
              credentials: [],
            },
          };
    });

    vi.stubGlobal("chrome", chromeMock);

    const service = new SettingsServiceImpl();

    const saved = await service.saveProviderCredential({
      baseUrl: "http://localhost:3000",
      token: "",
      target: "cloud",
      kind: "openai",
      apiKey: "sk-test",
    });
    const deleted = await service.deleteProviderCredential({
      baseUrl: "http://localhost:3000",
      token: "",
      target: "cloud",
      kind: "openai",
    });

    expect(saved.credentials[0]).toMatchObject({
      target: "cloud",
      kind: "openai",
      hasStoredApiKey: true,
    });
    expect(saved.runtime?.transport).toBe("native_host");
    expect(deleted.credentials).toHaveLength(0);
    expect(chromeMock.runtime.sendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: "SAVE_PROVIDER_CREDENTIAL",
      }),
      expect.any(Function)
    );
    expect(chromeMock.runtime.sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "DELETE_PROVIDER_CREDENTIAL",
      }),
      expect.any(Function)
    );
  });
});
