import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsServiceImpl } from "../SettingsService.js";

type StorageChangeListener = (
  changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
  areaName: string
) => void;

function createChromeMock(initialStore: Record<string, unknown> = {}) {
  const store = { ...initialStore };
  const listeners = new Set<StorageChangeListener>();

  const chromeMock = {
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

  it("loads, saves, and notifies subscribers", async () => {
    const { chromeMock, store } = createChromeMock();
    vi.stubGlobal("chrome", chromeMock);

    const service = new SettingsServiceImpl();
    await service.load();

    expect(service.get().backend.baseUrl).toBe("http://localhost:3000");

    const listener = vi.fn();
    service.subscribe(listener);

    const next = service.get();
    next.backend.baseUrl = "http://localhost:3000";
    next.preferences.defaultCostMode = "hybrid_low_cost";
    next.preferences.allowHybridVoiceFallback = true;

    await service.save(next);

    expect(service.get().backend.baseUrl).toBe("http://localhost:3000");
    expect(service.get().preferences.defaultCostMode).toBe("hybrid_low_cost");
    expect(listener).toHaveBeenCalled();
    expect(store["replymate:appSettings"]).toBeTruthy();
  });

  it("preserves an explicitly saved backend URL", async () => {
    const { chromeMock } = createChromeMock({
      "replymate:appSettings": {
        backend: {
          baseUrl: "http://127.0.0.1:3100",
          token: "",
          authMode: "optional",
          validationWarnings: [],
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

  it("validates the configured backend with bearer auth", async () => {
    const { chromeMock } = createChromeMock();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        valid: true,
        warnings: [],
        apiVersion: "v1",
        serverVersion: "0.3.0",
        authMode: "required",
        draftingProvider: {
          runtimeType: "ollama",
          ready: true,
          modelName: "llama3.2",
        },
        parserProvider: {
          runtimeType: "drafting_runtime",
          ready: true,
          imageOcrAvailable: true,
          modelName: "llama3.2-vision",
          fallbackMode: "metadata_local",
        },
      }),
      status: 200,
    }) as Response);

    vi.stubGlobal("chrome", chromeMock);
    vi.stubGlobal("fetch", fetchMock);

    const service = new SettingsServiceImpl();
    const result = await service.validateConnection({
      baseUrl: "http://localhost:3000/",
      token: "secret-token",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/v1/settings/validate",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer secret-token",
          "Content-Type": "application/json",
        }),
      })
    );
    expect(result.valid).toBe(true);
    expect(result.authMode).toBe("required");
    expect(result.draftingProvider.runtimeType).toBe("ollama");
    expect(result.parserProvider.imageOcrAvailable).toBe(true);
  });

  it("returns a local validation error when the backend URL is missing", async () => {
    const { chromeMock } = createChromeMock();
    vi.stubGlobal("chrome", chromeMock);

    const service = new SettingsServiceImpl();
    const result = await service.validateConnection({
      baseUrl: "",
      token: "",
    });

    expect(result.valid).toBe(false);
    expect(result.warnings).toContain("API base URL is required.");
    expect(result.draftingProvider.ready).toBe(false);
    expect(result.parserProvider.ready).toBe(false);
  });
});
