import { describe, expect, it } from "vitest";
import type { GenerateDraftRequest } from "@replymate/contracts";
import { createDraftGenerationInput } from "../draftInput.js";
import {
  validateCleanedDraftCandidate,
  validateContextReplyCandidate,
  parseAndValidateModelDrafts,
  parseSingleDraftText,
} from "../draftingValidation.js";
import {
  buildCleanedDraftPrompt,
  buildContextReplyPrompt,
} from "../draftingPrompts.js";
import {
  type DraftGenerationInput,
} from "../draftingTypes.js";

function makeRequest(overrides: Partial<GenerateDraftRequest> = {}): GenerateDraftRequest {
  return {
    sessionId: "sess-ctx-1",
    sessionVersion: 1,
    siteId: "slack_web",
    actionMode: "improve_current_draft",
    tonePreset: "professional",
    draftInput:
      "@Eliza Maxwell I looked into it and the reason they didn't get the automated reply is because the call is listed as call completed and not as missed call. I am not sure why the call recording is not there. It could be due to the Go high level outage.",
    instructionInput: "",
    contextEnabled: true,
    snapshot: {
      draftText:
        "@Eliza Maxwell I looked into it and the reason they didn't get the automated reply is because the call is listed as call completed and not as missed call. I am not sure why the call recording is not there. It could be due to the Go high level outage.",
      visibleContext: [
        {
          id: "ctx-1",
          author: "Eliza Maxwell",
          role: "unknown",
          text: "I've had a few missed calls recently that show up like this, with no automated text and no voicemail and no recording of the call. I'm curious if these are a glitch or if they are real calls.",
          source: "visible_channel",
        },
        {
          id: "ctx-2",
          author: "Carlos Luna",
          role: "unknown",
          text: "They may be getting filtered by the IVR as spam @crmteam please take a look and post an update",
          source: "visible_channel",
        },
        {
          id: "ctx-3",
          author: "Raghav",
          role: "unknown",
          text: "@Eliza Maxwell I looked into it and the reason they didn't get the automated reply is because the call is listed as call completed and not as missed call. I am not sure why the call recording is not there. It could be due to the Go High Level outage. Please let us know if it happens again and we can investigate further, but it should be okay.",
          source: "visible_channel",
        },
      ],
      contextScope: "channel",
      workspaceKey:
        "slack_web::https://app.slack.com/client/T123/C456::channel::ohana-k9-academy-fresno-ca",
      composerMode: "channel",
      metadata: {
        siteId: "slack_web",
        url: "https://app.slack.com/client/T123/C456",
        title: "ReplyMate context test",
        channelName: "ohana-k9-academy-fresno-ca",
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

describe("modularDrafting", () => {
  it("builds a draft-led context bundle and excludes unrelated side requests", () => {
    const input = createDraftGenerationInput(makeRequest());

    expect(input.responseTargetTurn).toContain("missed calls recently");
    expect(input.latestConfirmedAnswer).toContain("listed as call completed");
    expect(input.latestActionRequest).toContain("@crmteam");
    expect(input.recentTurns.some((turn) => turn.text.includes("@crmteam"))).toBe(false);
    expect(input.excludedTurns.some((turn) => turn.text.includes("@crmteam"))).toBe(true);
  });

  it("rejects Context Reply output that imports excluded side requests", () => {
    const input = createDraftGenerationInput(makeRequest());

    expect(() =>
      parseAndValidateModelDrafts(
        JSON.stringify({
          warnings: [],
          variants: [
            {
              role: "primary",
              text: "I looked into it and the call was marked as completed instead of missed.",
            },
            {
              role: "alternate",
              text: "I looked into it and Carlos is checking the IVR for spam.",
            },
          ],
        }),
        input
      )
    ).toThrow();
  });

  it("validates a clean draft candidate", () => {
    const input = createDraftGenerationInput(makeRequest());
    const candidate = validateCleanedDraftCandidate("I looked into it and it seems okay.", input);
    expect(candidate.qualityScore).toBeGreaterThan(50);
  });
});
