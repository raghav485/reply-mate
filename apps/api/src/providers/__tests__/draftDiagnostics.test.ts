import { describe, expect, it } from "vitest";
import type { GenerateDraftRequest } from "@replymate/contracts";
import { buildImproveDraftDebug } from "../draftDiagnostics.js";
import { createDraftGenerationInput } from "../draftInput.js";
import {
  validateCleanedDraftCandidate,
  validateContextReplyCandidate,
} from "../draftingValidation.js";

function makeRequest(overrides: Partial<GenerateDraftRequest> = {}): GenerateDraftRequest {
  return {
    sessionId: "sess-debug-1",
    sessionVersion: 1,
    siteId: "slack_web",
    actionMode: "improve_current_draft",
    tonePreset: "professional",
    draftInput:
      "hopefully itd fixed and all the calls are receiving as they should",
    instructionInput: "",
    contextEnabled: true,
    snapshot: {
      draftText: "hopefully itd fixed and all the calls are receiving as they should",
      visibleContext: [
        {
          id: "ctx-1",
          author: "Carlos Luna",
          role: "agent",
          text: "Good morning Carlos! It happened again to the same person, saying she has an appointment. It also says she is dnd on all channels so idk why she keeps getting messages and appointments.",
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
        title: "ReplyMate diagnostics test",
        channelName: "ohana-k9",
      },
      extractionConfidence: 0.88,
      warnings: [],
      pageUrlAtCapture: "https://app.slack.com/client/T123/C456",
      viewFingerprint: "vf",
      composerFingerprint: "cf",
      sessionVersion: 1,
    },
    evidence: [],
    usedVoiceInput: false,
    costMode: "local_only",
    ...overrides,
  };
}

describe("draftDiagnostics", () => {
  it("surfaces current-message fallback target selection", () => {
    const input = createDraftGenerationInput(makeRequest());
    const cleanedSelection = validateCleanedDraftCandidate(
      "Hopefully that fixed it, and the calls should now be coming through as expected.",
      input
    );

    const debug = buildImproveDraftDebug({
      input,
      runtime: "ollama",
      usedRetryPass: false,
      cleanedSelection,
      contextWinner: "cleaned_draft_reuse",
      contextCandidate: null,
    });

    expect(debug.selection.responseTarget?.textPreview).toContain("same person");
    expect(debug.selection.supportTurnCount).toBeGreaterThanOrEqual(0);
    expect(debug.cleanup.winner).toBe("model");
  });

  it("reports mirrored context fallback and limited coverage correctly", () => {
    const input = createDraftGenerationInput(
      makeRequest({
        snapshot: {
          ...makeRequest().snapshot,
          visibleContext: [],
          contextScope: "none",
        },
      })
    );
    const cleanedSelection = validateCleanedDraftCandidate(
      "Hopefully that fixed it, and the calls should now be coming through as expected.",
      input
    );

    const debug = buildImproveDraftDebug({
      input,
      runtime: "ollama",
      usedRetryPass: true,
      cleanedSelection,
      cleanedModelCandidate: {
        ...cleanedSelection,
        qualityScore: 54,
        suspiciousTokens: ["atime", "qand"],
      },
      contextCandidate: null,
      contextWinner: "cleaned_draft_reuse",
    });

    expect(debug.cleanup.winner).toBe("model");
    expect(debug.cleanup.modelQualityScore).toBe(54);
    expect(debug.contextReply.winner).toBe("cleaned_draft_reuse");
    expect(debug.contextReply.coverage).toBe("limited");
    expect(debug.provider.usedRetryPass).toBe(true);
  });

  it("preserves context-reply quality and excluded turns", () => {
    const input = createDraftGenerationInput(makeRequest());
    const cleanedSelection = validateCleanedDraftCandidate(
      "Hopefully that fixed it, and the calls should now be coming through as expected.",
      input
    );
    const contextCandidate = validateContextReplyCandidate(
      "Hopefully that fixed it, and the calls should now be coming through as expected. For context, the user also noted that DND was enabled on all channels.",
      input,
      "Hopefully that fixed it, and the calls should now be coming through as expected."
    );

    const debug = buildImproveDraftDebug({
      input,
      runtime: "generic_local_chat_api",
      usedRetryPass: false,
      cleanedSelection,
      cleanedModelCandidate: cleanedSelection,
      contextCandidate,
      contextWinner: "model",
    });

    expect(debug.supportingFacts.length).toBeGreaterThanOrEqual(0);
    expect(debug.excludedTurns.some((turn) => turn.textPreview.includes("@crmteam"))).toBe(true);
    expect(debug.contextReply.winner).toBe("model");
    expect(debug.contextReply.qualityScore).toBe(contextCandidate.qualityScore);
  });
});
