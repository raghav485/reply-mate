// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ComposerSession, GenerateDraftResponse } from "@replymate/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  useActiveTabIdMock,
  useActiveSessionMock,
  useShellContextMock,
  sendRuntimeMessageMock,
} = vi.hoisted(() => ({
  useActiveTabIdMock: vi.fn(),
  useActiveSessionMock: vi.fn(),
  useShellContextMock: vi.fn(),
  sendRuntimeMessageMock: vi.fn(),
}));

vi.mock("../../../core/ui/ActiveTabContext.js", () => ({
  useActiveTabId: useActiveTabIdMock,
}));

vi.mock("../../../core/ui/ActiveSessionContext.js", () => ({
  useActiveSession: useActiveSessionMock,
}));

vi.mock("../../../core/ui/ShellContext.js", () => ({
  useShellContext: useShellContextMock,
}));

vi.mock("../../../shared/runtime.js", async () => {
  const actual = await vi.importActual<typeof import("../../../shared/runtime.js")>(
    "../../../shared/runtime.js"
  );
  return {
    ...actual,
    sendRuntimeMessage: sendRuntimeMessageMock,
  };
});

import { DraftingPanel } from "../DraftingPanel.js";

function createSession(): ComposerSession {
  return {
    sessionId: "session-1",
    tabId: 22,
    siteId: "slack_web",
    adapterId: "slack",
    capabilityMap: {
      drafting: true,
      evidence: true,
      voice: true,
      telemetry: true,
      attachHelper: "manual_only",
    },
    snapshot: {
      draftText: "hopefully itd fixed and all the calls are receiving as they should",
      visibleContext: [
        {
          id: "ctx-1",
          author: "Carlos Luna",
          role: "agent",
          text: "Good morning Carlos! It happened again to the same person, saying she has an appointment.",
          source: "visible_channel",
        },
        {
          id: "ctx-2",
          author: "Eugin",
          role: "agent",
          text: "@crmteam please check CRM system stats.",
          source: "visible_channel",
        },
      ],
      contextScope: "channel",
      workspaceKey: "slack::workspace",
      composerMode: "channel",
      metadata: {
        siteId: "slack_web",
        url: "https://app.slack.com/client/T123/C456",
        title: "Diagnostics fixture",
        channelName: "Carlos Luna, Eugin Kim",
      },
      extractionConfidence: 0.88,
      warnings: ["Using the latest channel lane context."],
      pageUrlAtCapture: "https://app.slack.com/client/T123/C456",
      viewFingerprint: "vf",
      composerFingerprint: "cf",
      sessionVersion: 1,
      captureDebug: {
        capturedAt: new Date(Date.now() - 5_000).toISOString(),
        adapterId: "slack",
        composerMode: "channel",
        contextScope: "channel",
        extractionConfidence: 0.88,
        visibleContextCount: 2,
        sourceCounts: {
          visible_thread: 0,
          visible_channel: 2,
          visible_page: 0,
          visible_email_thread: 0,
          quoted_email: 0,
          generic_dom: 0,
        },
        truncated: false,
        warnings: ["Context truncated to the active Slack lane."],
        summary: {
          examinedCandidates: 5,
          keptCandidates: 2,
          droppedCandidates: 3,
        },
        dropReasons: [
          { reason: "outside_active_lane", count: 2 },
          { reason: "duplicate", count: 1 },
        ],
      },
    },
    warnings: [],
    updatedAt: new Date().toISOString(),
  };
}

function createResponse(): GenerateDraftResponse {
  return {
    apiVersion: "v1",
    requestId: "req-1",
    drafts: [
      {
        id: "draft-1",
        role: "primary",
        text: "Hopefully that fixed it, and the calls should now be coming through as expected.",
        variantKind: "cleaned_draft",
        label: "Cleaned Draft",
        styleNotes: ["Minimal cleanup", "Close to your draft"],
      },
      {
        id: "draft-2",
        role: "alternate",
        text: "Hopefully that fixed it. For context, this looks isolated to the same person with an appointment on the account.",
        variantKind: "context_reply",
        label: "Context Reply",
        styleNotes: ["Best answer with context", "Default insert"],
      },
    ],
    warnings: [
      "Context Reply used the current message but no additional supporting evidence was available.",
    ],
    timings: {
      preflightMs: 10,
      providerMs: 20,
      totalMs: 30,
      usedRetryPass: false,
    },
    inputSummary: {
      contextUsed: true,
      contextItemsUsed: 1,
      contextScopeUsed: "channel",
      evidenceIdsUsed: [],
      usedVoiceInput: false,
      providerPath: "local_model",
      entityCorrectionsApplied: [],
    },
    debug: {
      selection: {
        responseTarget: {
          textPreview:
            "Good morning Carlos! It happened again to the same person, saying she has an appointment.",
          author: "Carlos Luna",
          role: "agent",
          reason: "current_problem_report",
        },
        currentMessageFallbackUsed: true,
        supportTurnCount: 1,
      },
      supportingFacts: [
        {
          kind: "supporting_detail",
          textPreview: "This appears isolated to the same person who had an appointment.",
          sourceAuthor: "Carlos Luna",
          relevance: 3,
        },
      ],
      excludedTurns: [
        {
          kind: "action_request",
          textPreview: "@crmteam please check CRM system stats.",
          author: "Eugin",
        },
      ],
      cleanup: {
        winner: "model",
        modelQualityScore: 82,
        selectedQualityScore: 82,
        suspiciousTokens: ["itd"],
      },
      contextReply: {
        winner: "model",
        usedFallback: false,
        qualityScore: 92,
        coverage: "current_message_only",
      },
      provider: {
        runtime: "ollama",
        usedRetryPass: false,
      },
    },
  };
}

function createSettings(debugMode: boolean) {
  return {
    load: vi.fn(),
    save: vi.fn(),
    validateConnection: vi.fn(),
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
    subscribe: vi.fn(() => () => undefined),
    get: vi.fn(() => ({
      backend: {
        baseUrl: "http://127.0.0.1:3000",
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
        debugMode,
        telemetryEnabled: false,
        allowHybridVoiceFallback: false,
      },
    })),
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes(label)
    ) ?? null
  ) as HTMLButtonElement | null;
}

describe("DraftingPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    sendRuntimeMessageMock.mockReset();
    useActiveTabIdMock.mockReturnValue(22);
    useActiveSessionMock.mockReturnValue({
      session: createSession(),
      ensureFreshSession: vi.fn().mockResolvedValue(createSession()),
    });

    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        runtime: {
          onMessage: {
            addListener: vi.fn(),
            removeListener: vi.fn(),
          },
          sendMessage: vi.fn(),
        },
      },
    });

    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("opens the context drawer and keeps deep diagnostics hidden when debug mode is off", async () => {
    useShellContextMock.mockReturnValue({
      settings: createSettings(false),
    });
    sendRuntimeMessageMock.mockImplementation(async (message: { type: string }) => {
      if (message.type === "GET_WORKSPACE_STATE") {
        return {
          state: {
            workspaceKey: "slack::workspace",
            actionMode: "improve_current_draft",
            tonePreset: "professional",
            costMode: "local_only",
            instruction: "",
            usedVoiceInput: false,
            response: createResponse(),
            error: null,
            updatedAt: new Date().toISOString(),
          },
        };
      }
      if (message.type === "GET_EVIDENCE") {
        return { evidence: [], pendingEvidence: [] };
      }
      return {};
    });

    await act(async () => {
      root.render(<DraftingPanel />);
    });
    await flush();

    expect(container.querySelector('[data-testid="replymate-drafting-debug"]')).toBeNull();

    const viewContextButton = findButton(container, "View Context");
    expect(viewContextButton).not.toBeNull();

    await act(async () => {
      viewContextButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(container.querySelector('[data-testid="replymate-context-drawer"]')).not.toBeNull();
    expect(container.textContent).toContain("Raw Context Preview");
    expect(container.textContent).toContain("Good morning Carlos!");
    expect(container.textContent).not.toContain("Drop Reasons");
  });

  it("shows generation diagnostics and deep capture diagnostics when debug mode is on", async () => {
    useShellContextMock.mockReturnValue({
      settings: createSettings(true),
    });
    sendRuntimeMessageMock.mockImplementation(async (message: { type: string }) => {
      if (message.type === "GET_WORKSPACE_STATE") {
        return {
          state: {
            workspaceKey: "slack::workspace",
            actionMode: "improve_current_draft",
            tonePreset: "professional",
            costMode: "local_only",
            instruction: "",
            usedVoiceInput: false,
            response: createResponse(),
            error: null,
            updatedAt: new Date().toISOString(),
          },
        };
      }
      if (message.type === "GET_EVIDENCE") {
        return { evidence: [], pendingEvidence: [] };
      }
      return {};
    });

    await act(async () => {
      root.render(<DraftingPanel />);
    });
    await flush();

    expect(container.querySelector('[data-testid="replymate-drafting-debug"]')).not.toBeNull();
    expect(container.textContent).toContain("Response Target");
    expect(container.textContent).toContain("Carlos Luna");
    expect(container.textContent).toContain("Model output");

    const viewContextButton = findButton(container, "View Context");
    expect(viewContextButton).not.toBeNull();

    await act(async () => {
      viewContextButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(container.querySelector('[data-testid="replymate-context-drawer"]')).not.toBeNull();
    expect(container.textContent).toContain("Source Breakdown");
    expect(container.textContent).toContain("Drop Reasons");
    expect(container.textContent).toContain("outside active lane");
    expect(container.textContent).toContain("Context truncated to the active Slack lane.");
  });
});
