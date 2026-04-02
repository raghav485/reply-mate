// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useShellContextMock } = vi.hoisted(() => ({
  useShellContextMock: vi.fn(),
}));

vi.mock("../../../core/ui/ShellContext.js", () => ({
  useShellContext: useShellContextMock,
}));

import { SettingsPanel } from "../SettingsPanel.js";

function createSettingsState() {
  let current = {
    backend: {
      baseUrl: "http://localhost:3000",
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
    preferences: {
      defaultTonePreset: "professional",
      defaultCostMode: "local_only",
      telemetryEnabled: false,
      debugMode: false,
      allowHybridVoiceFallback: false,
    },
    featureFlags: {
      drafting_enabled: true,
      evidence_enabled: true,
      voice_enabled: true,
      telemetry_enabled: true,
      site_slack_enabled: true,
      site_gmail_enabled: true,
      site_generic_enabled: false,
    },
  } as any;

  const listeners = new Set<(settings: any) => void>();

  const settings = {
    get: vi.fn(() => JSON.parse(JSON.stringify(current))),
    subscribe: vi.fn((listener: (settings: any) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    save: vi.fn(async (next: any) => {
      current = JSON.parse(JSON.stringify(next));
      for (const listener of listeners) {
        listener(JSON.parse(JSON.stringify(current)));
      }
    }),
    validateConnection: vi.fn(),
    getProviderCredentialStatus: vi.fn(async () => ({
      apiVersion: "v1",
      storage: {
        backend: "macos_keychain",
        supported: true,
      },
      credentials: [],
    })),
    saveProviderCredential: vi.fn(async () => ({
      apiVersion: "v1",
      storage: {
        backend: "macos_keychain",
        supported: true,
      },
      credentials: [],
    })),
    deleteProviderCredential: vi.fn(async () => ({
      apiVersion: "v1",
      storage: {
        backend: "macos_keychain",
        supported: true,
      },
      credentials: [],
    })),
  };

  return {
    settings,
    getCurrent: () => current,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setInputValue(element: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  );
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("SettingsPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    useShellContextMock.mockReset();
  });

  it("persists backend changes even when validation fails", async () => {
    const { settings, getCurrent } = createSettingsState();
    settings.validateConnection.mockRejectedValue(new Error("API unreachable"));
    useShellContextMock.mockReturnValue({
      settings,
      featureFlags: {
        setFlag: vi.fn(),
        save: vi.fn(async () => {}),
      },
    });

    await act(async () => {
      root.render(<SettingsPanel />);
    });
    await flush();

    const baseUrlInput = container.querySelector<HTMLInputElement>("#baseUrl");
    expect(baseUrlInput).not.toBeNull();

    await act(async () => {
      setInputValue(baseUrlInput!, "http://127.0.0.1:3100");
    });
    await flush();

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Apply Settings")
    );
    expect(saveButton).not.toBeUndefined();
    expect(saveButton).not.toHaveProperty("disabled", true);

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(settings.save).toHaveBeenCalled();
    expect(getCurrent().backend.baseUrl).toBe("http://127.0.0.1:3100");
    expect(container.textContent).toContain("Saved locally.");
    expect(container.textContent).toContain("Saved Locally");
  });

  it("persists default preferences even when validation returns invalid", async () => {
    const { settings, getCurrent } = createSettingsState();
    settings.validateConnection.mockResolvedValue({
      valid: false,
      warnings: ["API base URL is required."],
      apiVersion: "v1",
      serverVersion: "unknown",
      deploymentMode: "local",
      cloudGenerationAvailable: false,
      authMode: "optional",
      draftingProvider: {
        runtimeType: "ollama",
        ready: false,
      },
      parserProvider: {
        runtimeType: "drafting_runtime",
        ready: false,
        imageOcrAvailable: false,
        fallbackMode: "metadata_local",
      },
    });
    useShellContextMock.mockReturnValue({
      settings,
      featureFlags: {
        setFlag: vi.fn(),
        save: vi.fn(async () => {}),
      },
    });

    await act(async () => {
      root.render(<SettingsPanel />);
    });
    await flush();

    const toneSelect = container.querySelector<HTMLSelectElement>("#defaultTone");
    expect(toneSelect).not.toBeNull();

    await act(async () => {
      toneSelect!.value = "friendly";
      toneSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Apply Settings")
    );

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(settings.save).toHaveBeenCalled();
    expect(getCurrent().preferences.defaultTonePreset).toBe("friendly");
    expect(container.textContent).toContain("Saved locally.");
  });
});
