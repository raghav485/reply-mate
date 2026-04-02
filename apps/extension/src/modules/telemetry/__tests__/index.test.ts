import { afterEach, describe, expect, it, vi } from "vitest";
import { FEATURE_FLAGS, type ModuleContext } from "@replymate/contracts";
import { EventBusImpl } from "../../../core/bus/EventBus.js";
import { telemetryModule } from "../index.js";

function createContext(options?: {
  telemetryEnabled?: boolean;
  featureFlagEnabled?: boolean;
  baseUrl?: string;
  post?: (path: string, body: unknown) => Promise<unknown>;
}): ModuleContext {
  const bus = new EventBusImpl();
  const post = options?.post ?? vi.fn(async () => ({ accepted: true }));

  return {
    runtimeSurface: "background",
    bus,
    sessionStore: {} as ModuleContext["sessionStore"],
    capabilityRegistry: {} as ModuleContext["capabilityRegistry"],
    featureFlags: {
      isEnabled: (key) =>
        key === FEATURE_FLAGS.TELEMETRY_ENABLED
          ? options?.featureFlagEnabled ?? true
          : true,
    } as ModuleContext["featureFlags"],
    settings: ({
      get: () => ({
        backend: {
          baseUrl: options?.baseUrl ?? "http://localhost:3000",
          token: "",
          validationWarnings: [],
        },
        preferences: {
          defaultTonePreset: "professional",
          defaultCostMode: "local_only",
          telemetryEnabled: options?.telemetryEnabled ?? true,
          debugMode: false,
          allowHybridVoiceFallback: false,
        },
        featureFlags: {
          [FEATURE_FLAGS.DRAFTING_ENABLED]: true,
          [FEATURE_FLAGS.EVIDENCE_ENABLED]: true,
          [FEATURE_FLAGS.VOICE_ENABLED]: true,
          [FEATURE_FLAGS.TELEMETRY_ENABLED]: options?.featureFlagEnabled ?? true,
          [FEATURE_FLAGS.SITE_SLACK_ENABLED]: true,
          [FEATURE_FLAGS.SITE_GMAIL_ENABLED]: true,
          [FEATURE_FLAGS.SITE_GENERIC_ENABLED]: true,
        },
      }),
      load: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
      validateConnection: vi.fn(async () => ({
        valid: true,
        warnings: [],
        apiVersion: "v1",
        serverVersion: "0.3.0",
        deploymentMode: "local",
        cloudGenerationAvailable: false,
        authMode: "optional",
        draftingProvider: {
          runtimeType: "ollama",
          ready: true,
        },
        parserProvider: {
          runtimeType: "drafting_runtime",
          ready: false,
          imageOcrAvailable: false,
          fallbackMode: "metadata_local",
        },
      })),
      getProviderCredentialStatus: vi.fn(async () => ({
        apiVersion: "v1",
        storage: { backend: "memory", supported: true },
        credentials: [],
      })),
      saveProviderCredential: vi.fn(async () => ({
        apiVersion: "v1",
        storage: { backend: "memory", supported: true },
        credentials: [],
      })),
      deleteProviderCredential: vi.fn(async () => ({
        apiVersion: "v1",
        storage: { backend: "memory", supported: true },
        credentials: [],
      })),
      subscribe: vi.fn(() => () => {}),
    } as unknown) as ModuleContext["settings"],
    apiClient: ({
      getBaseUrl: () => options?.baseUrl ?? "http://localhost:3000",
      post,
      setBaseUrl: vi.fn(),
      setToken: vi.fn(),
      getToken: vi.fn(() => ""),
      get: vi.fn(),
      postMultipart: vi.fn(),
    } as unknown) as ModuleContext["apiClient"],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as ModuleContext["logger"],
    uiRegistry: {} as ModuleContext["uiRegistry"],
  };
}

describe("telemetryModule", () => {
  afterEach(() => {
    telemetryModule.teardown?.({} as ModuleContext);
  });

  it("posts sanitized telemetry payloads when telemetry is enabled", async () => {
    let postedPayload: Record<string, unknown> | undefined;
    const post = vi.fn(async (_path: string, body: unknown) => {
      postedPayload = (body as { payload?: Record<string, unknown> }).payload;
      return { accepted: true };
    });
    const ctx = createContext({ post });
    telemetryModule.register(ctx);

    ctx.bus.publish({
      type: "telemetry/event",
      name: "generation_succeeded",
      payload: {
        sessionId: "sess-123",
        transcript: "secret transcript",
        textLength: 10,
        siteId: "slack_web",
      },
    });

    await Promise.resolve();

    expect(post).toHaveBeenCalledWith(
      "/v1/metrics",
      expect.objectContaining({
        name: "generation_succeeded",
        payload: expect.objectContaining({
          sessionId: expect.any(String),
          siteId: "slack_web",
        }),
      })
    );

    if (!postedPayload) {
      throw new Error("Expected telemetry payload to be posted.");
    }
    const payload = postedPayload;
    expect(payload.sessionId).not.toBe("sess-123");
    expect(payload.transcript).toBeUndefined();
    expect(payload.textLength).toBeUndefined();
  });

  it("does not post telemetry when telemetry is disabled", async () => {
    const post = vi.fn(async () => ({ accepted: true }));
    const ctx = createContext({ post, telemetryEnabled: false });
    telemetryModule.register(ctx);

    ctx.bus.publish({
      type: "telemetry/event",
      name: "draft_copied",
      payload: { sessionId: "sess-123" },
    });

    await Promise.resolve();

    expect(post).not.toHaveBeenCalled();
  });
});
