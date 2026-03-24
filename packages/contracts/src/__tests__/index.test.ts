import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLAGS,
  ERROR_MESSAGES,
  FEATURE_FLAGS,
  TELEMETRY_EVENT_NAMES,
} from "../index.js";
import type {
  ComposerSnapshot,
  GenerateDraftResponse,
} from "../index.js";

describe("@replymate/contracts", () => {
  it("exposes the expected default feature flags", () => {
    expect(DEFAULT_FLAGS[FEATURE_FLAGS.DRAFTING_ENABLED]).toBe(true);
    expect(DEFAULT_FLAGS[FEATURE_FLAGS.EVIDENCE_ENABLED]).toBe(true);
    expect(DEFAULT_FLAGS[FEATURE_FLAGS.VOICE_ENABLED]).toBe(true);
    expect(DEFAULT_FLAGS[FEATURE_FLAGS.TELEMETRY_ENABLED]).toBe(true);
  });

  it("includes the parity telemetry event names", () => {
    expect(TELEMETRY_EVENT_NAMES).toContain("panel_opened");
    expect(TELEMETRY_EVENT_NAMES).toContain("draft_copied");
    expect(TELEMETRY_EVENT_NAMES).toContain("rate_limited");
    expect(TELEMETRY_EVENT_NAMES).toContain("cloud_fallback_used");
  });

  it("defines a cost mode blocked error message", () => {
    expect(ERROR_MESSAGES.COST_MODE_BLOCKED).toMatch(/cost mode/i);
  });

  it("supports optional generation and capture debug payloads", () => {
    const snapshot: ComposerSnapshot = {
      draftText: "Hello",
      visibleContext: [],
      contextScope: "none",
      workspaceKey: "generic::workspace",
      composerMode: "generic",
      metadata: {
        siteId: "generic_web",
        url: "https://example.com",
      },
      extractionConfidence: 0.5,
      warnings: [],
      pageUrlAtCapture: "https://example.com",
      viewFingerprint: "vf",
      composerFingerprint: "cf",
      sessionVersion: 1,
      captureDebug: {
        capturedAt: new Date().toISOString(),
        adapterId: "generic",
        composerMode: "generic",
        contextScope: "none",
        extractionConfidence: 0.5,
        visibleContextCount: 0,
        sourceCounts: {
          visible_thread: 0,
          visible_channel: 0,
          visible_page: 0,
          visible_email_thread: 0,
          quoted_email: 0,
          generic_dom: 0,
        },
        truncated: false,
        warnings: [],
        summary: {
          examinedCandidates: 4,
          keptCandidates: 0,
          droppedCandidates: 4,
        },
        dropReasons: [{ reason: "chrome_only", count: 4 }],
      },
    };

    const response: GenerateDraftResponse = {
      apiVersion: "v1",
      requestId: "req-1",
      drafts: [
        {
          id: "draft-1",
          role: "primary",
          variantKind: "cleaned_draft",
          label: "Cleaned Draft",
          text: "Hello there.",
          styleNotes: [],
        },
        {
          id: "draft-2",
          role: "alternate",
          variantKind: "context_reply",
          label: "Context Reply",
          text: "Hello there.",
          styleNotes: [],
        },
      ],
      warnings: [],
      timings: {
        preflightMs: 0,
        providerMs: 0,
        totalMs: 0,
        usedRetryPass: false,
      },
      inputSummary: {
        contextUsed: false,
        contextItemsUsed: 0,
        contextScopeUsed: "none",
        evidenceIdsUsed: [],
        usedVoiceInput: false,
        providerPath: "local_model",
        entityCorrectionsApplied: [],
      },
      debug: {
        selection: {
          currentMessageFallbackUsed: false,
          supportTurnCount: 0,
        },
        supportingFacts: [],
        excludedTurns: [],
        cleanup: {
          winner: "model",
          selectedQualityScore: 82,
          suspiciousTokens: [],
        },
        contextReply: {
          winner: "cleaned_draft_reuse",
          usedFallback: true,
          coverage: "limited",
        },
        provider: {
          runtime: "ollama",
          usedRetryPass: false,
        },
      },
    };

    expect(snapshot.captureDebug?.dropReasons[0]?.reason).toBe("chrome_only");
    expect(response.debug?.cleanup.winner).toBe("model");
  });
});
