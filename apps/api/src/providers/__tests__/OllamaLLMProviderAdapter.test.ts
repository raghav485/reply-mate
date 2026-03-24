import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerateDraftRequest } from "@replymate/contracts";
import { OllamaLLMProviderAdapter } from "../OllamaLLMProviderAdapter.js";

function makeRequest(overrides: Partial<GenerateDraftRequest> = {}): GenerateDraftRequest {
  return {
    sessionId: "sess-1",
    sessionVersion: 1,
    siteId: "slack_web",
    actionMode: "improve_current_draft",
    tonePreset: "professional",
    draftInput: "i thing we a rre good to hgo",
    instructionInput: "Keep it clear and professional",
    contextEnabled: true,
    snapshot: {
      draftText: "i thing we a rre good to hgo",
      visibleContext: [
        {
          id: "ctx-1",
          author: "Eugin",
          role: "agent",
          text: "We can line this up next week and then launch the following week.",
          source: "visible_thread",
        },
      ],
      contextScope: "thread",
      workspaceKey:
        "slack_web::https://app.slack.com/client/T123/C456::thread::launch::Campaign planning",
      composerMode: "thread",
      metadata: {
        siteId: "slack_web",
        url: "https://app.slack.com/client/T123/C456",
        title: "ReplyMate test thread",
        channelName: "#launch",
        threadTitle: "Campaign planning",
      },
      extractionConfidence: 0.92,
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

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("OllamaLLMProviderAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("retries without structured format when the first Ollama reply is empty", async () => {
    const pairResponse = okJson({
      message: {
        content: JSON.stringify({
          warnings: [],
          variants: [
            {
              role: "primary",
              text: "I think we are good to go.",
            },
            {
              role: "alternate",
              text: "I think we are good to go for next week’s launch.",
            },
          ],
        }),
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ message: { content: "" } }))
      .mockResolvedValue(pairResponse);
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OllamaLLMProviderAdapter("http://127.0.0.1:11434", "qwen3:8b", 1_000, {
      temperature: 0.15,
      topP: 0.85,
      repeatPenalty: 1.05,
      numPredict: 420,
      keepAlive: "15m",
    });

    const response = await adapter.generateDrafts(makeRequest());
    expect(response.drafts[0].role).toBe("primary");
    expect(response.drafts[0].label).toBe("Cleaned Draft");
    expect(response.drafts[0].variantKind).toBe("cleaned_draft");
    expect(response.drafts[0].text).toContain("I think we are good to go.");
    expect(response.drafts[1].role).toBe("alternate");
    expect(response.drafts[1].label).toBe("Context Reply");
    expect(response.drafts[1].variantKind).toBe("context_reply");
    expect(response.drafts[1].text).toContain("next week");
    expect(response.debug?.provider.runtime).toBe("ollama");
    expect(response.debug?.supportingFacts[0]?.textPreview).toContain("next week");
    expect(response.debug?.contextReply.coverage).toBe("grounded");
    expect(response.warnings).not.toContain(
      "Context Reply used limited context; output is based mostly on your draft."
    );
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));

    expect(firstBody.think).toBe(false);
    expect(firstBody.keep_alive).toBe("15m");
    expect(firstBody.format).toBeTruthy();
    expect(firstBody.options.temperature).toBe(0.15);
    expect(secondBody.think).toBe(false);
    expect(secondBody.format).toBeUndefined();
  });

  it("accepts the alternate even if it stays similar due to relaxed quality gates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okJson({
        message: {
          content: JSON.stringify({
            warnings: [],
            variants: [
              {
                role: "primary",
                text: "I think we are good to go.",
              },
              {
                role: "alternate",
                text: "I think we are good to go.",
              },
            ],
          }),
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OllamaLLMProviderAdapter("http://127.0.0.1:11434", "qwen3:8b", 1_000, {
      temperature: 0.15,
      topP: 0.85,
      repeatPenalty: 1.05,
      numPredict: 420,
      keepAlive: "15m",
    });

    const response = await adapter.generateDrafts(makeRequest());

    expect(response.drafts).toHaveLength(2);
    expect(response.drafts[0].label).toBe("Cleaned Draft");
    expect(response.drafts[1].label).toBe("Context Reply");
    expect(response.drafts[1].text).toBe(response.drafts[0].text);
    expect(response.debug?.contextReply.winner).toBe("model");
  });

  it("returns the strongest safe LLM cleanup after retry instead of substituting static cleanup", async () => {
    const roughCleanup = okJson({
      message: {
        content: JSON.stringify({
          warnings: [],
          variants: [
            {
              role: "primary",
              text: "hi courtney because the person had an apoointment scheduled at 9 am atime qand dnd was turned on today at 7:02 o she should not recieve any message afgtter this",
            },
            {
              role: "alternate",
              text: "hi courtney because the person had an apoointment scheduled at 9 am atime qand dnd was turned on today at 7:02 o she should not recieve any message afgtter this",
            },
          ],
        }),
      },
    });
    const cleanedRetry = okJson({
      message: {
        content: JSON.stringify({
          text: "Hi Courtney, because the person had an appointment scheduled at 9 AM and DND was turned on today at 7:02, she should not receive any messages after this.",
          warnings: [],
        }),
      },
    });
    const contextReply = okJson({
      message: {
        content: JSON.stringify({
          text: "Hi Courtney, because the person had an appointment scheduled at 9 AM and DND was turned on today at 7:02, she should not receive any messages after this.",
          warnings: [],
        }),
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(roughCleanup)
      .mockResolvedValueOnce(roughCleanup)
      .mockResolvedValueOnce(cleanedRetry)
      .mockResolvedValueOnce(contextReply);
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OllamaLLMProviderAdapter("http://127.0.0.1:11434", "qwen3:8b", 1_000, {
      temperature: 0.15,
      topP: 0.85,
      repeatPenalty: 1.05,
      numPredict: 420,
      keepAlive: "15m",
    });

    const response = await adapter.generateDrafts(
      makeRequest({
        draftInput:
          "hi courtney because the person had an apoointment scheduled at 9 am atime qand dnd was turned on today at 7:02 o she should not recieve any message afgtter this",
      })
    );

    expect(response.drafts[0].text).not.toMatch(/\batime\b/i);
    expect(response.drafts[0].text).not.toMatch(/\bqand\b/i);
    expect(response.drafts[0].text).toMatch(/[.!?]$/);
    expect(response.warnings).not.toContain(
      "Cleaned Draft quality was limited; rebuilt a sendable cleanup floor."
    );
    expect(response.debug?.cleanup.winner).toBe("model");
  });

  it("fails improve draft when no safe cleaned-draft candidate exists", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okJson({
        message: {
          content: JSON.stringify({
            warnings: [],
            variants: [
              {
                role: "primary",
                text: "hi courtney because the person had an apoointment scheduled at 9 am atime qand dnd was turned on today at 7:02 o she should not recieve any message afgtter this",
              },
              {
                role: "alternate",
                text: "hi courtney because the person had an apoointment scheduled at 9 am atime qand dnd was turned on today at 7:02 o she should not recieve any message afgtter this",
              },
            ],
          }),
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OllamaLLMProviderAdapter("http://127.0.0.1:11434", "qwen3:8b", 1_000, {
      temperature: 0.15,
      topP: 0.85,
      repeatPenalty: 1.05,
      numPredict: 420,
      keepAlive: "15m",
    });

    await expect(
      adapter.generateDrafts(
        makeRequest({
          draftInput:
            "hi courtney because the person had an apoointment scheduled at 9 am atime qand dnd was turned on today at 7:02 o she should not recieve any message afgtter this",
        })
      )
    ).rejects.toMatchObject({
      errorCode: "DRAFT_QUALITY_UNAVAILABLE",
    });
  });

  it("mirrors the cleaned draft when no safe context candidate exists", async () => {
    const cleanedDraft = okJson({
      message: {
        content: JSON.stringify({
          text: "I looked into it, and the automated reply was skipped because the call was marked as completed rather than missed.",
          warnings: [],
        }),
      },
    });
    const badContextReply = okJson({
      message: {
        content: JSON.stringify({
          text: "I looked into it, and the automated reply was skipped because the call was marked as completed rather than missed. @crmteam, please take a look and post an update.",
          warnings: [],
        }),
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(cleanedDraft)
      .mockResolvedValue(badContextReply);
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OllamaLLMProviderAdapter("http://127.0.0.1:11434", "qwen3:8b", 1_000, {
      temperature: 0.15,
      topP: 0.85,
      repeatPenalty: 1.05,
      numPredict: 420,
      keepAlive: "15m",
    });

    const response = await adapter.generateDrafts(
      makeRequest({
        draftInput:
          "@Eliza Maxwell I looked into it and the reason they didn't get the automated reply is because the call is listed as call completed and not as missed call. I am not sure why the call recording is not there.",
        snapshot: {
          ...makeRequest().snapshot,
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
        },
      })
    );

    expect(response.drafts[0].label).toBe("Cleaned Draft");
    expect(response.drafts[1].label).toBe("Context Reply");
    expect(response.drafts[1].text).not.toContain("@crmteam");
    expect(response.drafts[0].text).not.toContain("@crmteam");
    expect(response.drafts[1].text).toBe(response.drafts[0].text);
    expect(response.warnings).toContain(
      "Context Reply could not be safely improved with grounded context; the second card mirrors the cleaned draft."
    );
    expect(response.debug?.contextReply.winner).toBe("cleaned_draft_reuse");
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
