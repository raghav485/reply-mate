import { describe, expect, it, vi } from "vitest";
import type {
  AppSettings,
  FeatureFlagKey,
  FeatureModule,
  ModuleContext,
} from "@replymate/contracts";
import { DEFAULT_FLAGS, FEATURE_FLAGS } from "@replymate/contracts";
import { CapabilityRegistryImpl } from "../CapabilityRegistry.js";
import { ModuleRegistryImpl } from "../ModuleRegistry.js";

type FlagOverrides = Partial<Record<FeatureFlagKey, boolean>>;

class MockFeatureFlags {
  private flags: Record<FeatureFlagKey, boolean>;

  constructor(overrides: FlagOverrides = {}) {
    this.flags = { ...DEFAULT_FLAGS, ...overrides };
  }

  isEnabled(flag: FeatureFlagKey): boolean {
    return this.flags[flag] ?? false;
  }

  getAll(): Record<FeatureFlagKey, boolean> {
    return { ...this.flags };
  }

  setFlag(flag: FeatureFlagKey, value: boolean): void {
    this.flags[flag] = value;
  }

  async load(): Promise<void> {
    // no-op for tests
  }

  async save(): Promise<void> {
    // no-op for tests
  }
}

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeContext(
  capabilityRegistry: CapabilityRegistryImpl,
  featureFlags: MockFeatureFlags,
  logger: ReturnType<typeof makeLogger>
): ModuleContext {
  const settings: AppSettings = {
    backend: {
      baseUrl: "",
      token: "",
      authMode: "optional",
      validationWarnings: [],
    },
    preferences: {
      defaultTonePreset: "professional",
      defaultCostMode: "local_only",
      telemetryEnabled: true,
      debugMode: false,
      allowHybridVoiceFallback: false,
    },
    featureFlags: featureFlags.getAll(),
  };

  return {
    runtimeSurface: "sidepanel",
    bus: {
      publish: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      clear: vi.fn(),
    },
    sessionStore: {
      getSession: vi.fn(() => null),
      getSessions: vi.fn(() => []),
      setSession: vi.fn(),
      clearSession: vi.fn(),
      updateSnapshot: vi.fn(),
      isSessionCurrent: vi.fn(() => false),
    },
    capabilityRegistry,
    featureFlags,
    settings: {
      load: vi.fn(async () => {}),
      get: vi.fn(() => settings),
      save: vi.fn(async () => {}),
      validateConnection: vi.fn(async () => ({
        valid: true,
        warnings: [],
        apiVersion: "v1",
        serverVersion: "test",
        authMode: "optional" as const,
        draftingProvider: {
          runtimeType: "ollama" as const,
          ready: true,
          modelName: "test-model",
        },
        parserProvider: {
          runtimeType: "drafting_runtime" as const,
          ready: false,
          imageOcrAvailable: false,
          fallbackMode: "metadata_local" as const,
          warning: "Image OCR is not configured; using metadata-only summary.",
        },
      })),
      subscribe: vi.fn(() => () => {}),
    },
    apiClient: {
      getBaseUrl: vi.fn(() => ""),
      setBaseUrl: vi.fn(),
      setToken: vi.fn(),
      getToken: vi.fn(() => ""),
      get: vi.fn(),
      post: vi.fn(),
      postMultipart: vi.fn(),
    },
    logger,
    uiRegistry: {
      registerPanel: vi.fn(),
      getPanels: vi.fn(() => []),
    },
  };
}

function makeModule(
  id: FeatureModule["id"],
  dependsOn: FeatureModule["dependsOn"] = [],
  hooks?: {
    register?: () => void;
    teardown?: () => void;
  }
): FeatureModule {
  return {
    id,
    version: "test",
    surfaces: ["sidepanel", "background", "options"],
    dependsOn,
    requiredCapabilities: [],
    async register() {
      hooks?.register?.();
    },
    async teardown() {
      hooks?.teardown?.();
    },
  };
}

describe("ModuleRegistry", () => {
  it("enforces the optional module feature-flag matrix", async () => {
    const toggles = [
      { id: "evidence" as const, flag: FEATURE_FLAGS.EVIDENCE_ENABLED },
      { id: "voice" as const, flag: FEATURE_FLAGS.VOICE_ENABLED },
      { id: "telemetry" as const, flag: FEATURE_FLAGS.TELEMETRY_ENABLED },
    ];

    for (let mask = 0; mask < 8; mask += 1) {
      const overrides: FlagOverrides = {};
      for (let i = 0; i < toggles.length; i += 1) {
        const enabled = Boolean(mask & (1 << i));
        overrides[toggles[i].flag] = enabled;
      }

      const featureFlags = new MockFeatureFlags(overrides);
      const capabilityRegistry = new CapabilityRegistryImpl();
      const logger = makeLogger();
      const ctx = makeContext(capabilityRegistry, featureFlags, logger);

      const registry = new ModuleRegistryImpl(featureFlags as any, capabilityRegistry, logger);
      registry.addModule(makeModule("drafting"));
      registry.addModule(makeModule("evidence"));
      registry.addModule(makeModule("voice"));
      registry.addModule(makeModule("telemetry"));

      await registry.bootAll(ctx);

      expect(registry.isRegistered("drafting")).toBe(true);
      expect(capabilityRegistry.getCapabilities().drafting).toBe(true);

      for (let i = 0; i < toggles.length; i += 1) {
        const enabled = Boolean(mask & (1 << i));
        expect(registry.isRegistered(toggles[i].id)).toBe(enabled);
        expect(capabilityRegistry.getCapabilities()[toggles[i].id]).toBe(enabled);
      }
    }
  });

  it("keeps drafting available when optional modules are disabled", async () => {
    const featureFlags = new MockFeatureFlags({
      [FEATURE_FLAGS.EVIDENCE_ENABLED]: false,
      [FEATURE_FLAGS.VOICE_ENABLED]: false,
      [FEATURE_FLAGS.TELEMETRY_ENABLED]: false,
    });

    const capabilityRegistry = new CapabilityRegistryImpl();
    const logger = makeLogger();
    const ctx = makeContext(capabilityRegistry, featureFlags, logger);

    const registry = new ModuleRegistryImpl(featureFlags as any, capabilityRegistry, logger);
    registry.addModule(makeModule("drafting"));
    registry.addModule(makeModule("evidence"));
    registry.addModule(makeModule("voice"));
    registry.addModule(makeModule("telemetry"));

    await registry.bootAll(ctx);

    expect(registry.getRegisteredModules()).toEqual(["drafting"]);
    expect(capabilityRegistry.getCapabilities().drafting).toBe(true);
    expect(capabilityRegistry.getCapabilities().evidence).toBe(false);
    expect(capabilityRegistry.getCapabilities().voice).toBe(false);
    expect(capabilityRegistry.getCapabilities().telemetry).toBe(false);
  });

  it("registers and tears down a dummy module with dependencies", async () => {
    const featureFlags = new MockFeatureFlags();
    const capabilityRegistry = new CapabilityRegistryImpl();
    const logger = makeLogger();
    const ctx = makeContext(capabilityRegistry, featureFlags, logger);

    const callOrder: string[] = [];

    const drafting = makeModule("drafting", [], {
      register: () => callOrder.push("drafting:register"),
      teardown: () => callOrder.push("drafting:teardown"),
    });

    const dummySettings = makeModule("settings", ["drafting"], {
      register: () => callOrder.push("settings:register"),
      teardown: () => callOrder.push("settings:teardown"),
    });

    const registry = new ModuleRegistryImpl(featureFlags as any, capabilityRegistry, logger);
    registry.addModule(dummySettings);
    registry.addModule(drafting);

    await registry.bootAll(ctx);
    expect(registry.isRegistered("drafting")).toBe(true);
    expect(registry.isRegistered("settings")).toBe(true);
    expect(callOrder).toEqual(["drafting:register", "settings:register"]);

    await registry.teardownAll(ctx);
    expect(callOrder).toEqual([
      "drafting:register",
      "settings:register",
      "settings:teardown",
      "drafting:teardown",
    ]);
  });
});
