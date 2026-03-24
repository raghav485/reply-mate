import { describe, expect, it } from "vitest";
import {
  assertGenerateDraftResponse,
  parseEvidenceIngestBody,
  parseGenerateDraftRequest,
  parseVoiceTranscribeBody,
} from "../index.js";

describe("schemas", () => {
  it("parses evidence ingest body", () => {
    const parsed = parseEvidenceIngestBody({
      sessionId: "sess-1",
      fileName: "note.txt",
      mimeType: "text/plain",
      sizeBytes: 12,
      mode: "context_only",
      mentionInReply: false,
      fileData: Buffer.from("hello"),
    });

    expect(parsed.fileName).toBe("note.txt");
    expect(parsed.mode).toBe("context_only");
  });

  it("parses voice transcription payload", () => {
    const parsed = parseVoiceTranscribeBody({
      audioBase64: "aGVsbG8=",
      mimeType: "audio/webm",
      languageHint: "en",
      costMode: "cloud_quality",
    });

    expect(parsed.mimeType).toBe("audio/webm");
    expect(parsed.languageHint).toBe("en");
    expect(parsed.costMode).toBe("cloud_quality");
  });

  it("enforces generate request schema", () => {
    const parsed = parseGenerateDraftRequest({
      sessionId: "s1",
      sessionVersion: 1,
      siteId: "slack_web",
      actionMode: "improve_current_draft",
      tonePreset: "professional",
      draftInput: "Hello",
      instructionInput: "Keep short",
      contextEnabled: true,
      snapshot: {
        draftText: "Hello",
        visibleContext: [
          {
            id: "c1",
            text: "Customer asked for update",
            source: "visible_thread",
            role: "customer",
          },
        ],
        contextScope: "thread",
        workspaceKey: "slack_web::https://app.slack.com/client/abc::thread::support::Billing issue",
        composerMode: "thread",
        metadata: {
          siteId: "slack_web",
          url: "https://app.slack.com/client/abc",
        },
        extractionConfidence: 0.8,
        warnings: [],
        pageUrlAtCapture: "https://app.slack.com/client/abc",
        viewFingerprint: "vf",
        composerFingerprint: "cf",
        sessionVersion: 1,
        captureDebug: {
          capturedAt: new Date().toISOString(),
          adapterId: "slack",
          composerMode: "thread",
          contextScope: "thread",
          extractionConfidence: 0.8,
          visibleContextCount: 1,
          sourceCounts: {
            visible_thread: 1,
            visible_channel: 0,
            visible_page: 0,
            visible_email_thread: 0,
            quoted_email: 0,
            generic_dom: 0,
          },
          truncated: false,
          warnings: [],
          summary: {
            examinedCandidates: 3,
            keptCandidates: 1,
            droppedCandidates: 2,
          },
          dropReasons: [{ reason: "duplicate", count: 1 }],
        },
      },
      evidence: [],
      usedVoiceInput: false,
      costMode: "local_only",
    });

    expect(parsed.siteId).toBe("slack_web");
    expect(parsed.snapshot.visibleContext).toHaveLength(1);
    expect(parsed.snapshot.captureDebug?.adapterId).toBe("slack");
  });

  it("rejects invalid action mode", () => {
    expect(() =>
      parseGenerateDraftRequest({
        sessionId: "s1",
        sessionVersion: 1,
        siteId: "slack_web",
        actionMode: "unknown_mode",
        tonePreset: "professional",
        draftInput: "Hello",
        contextEnabled: true,
        snapshot: {
          draftText: "Hello",
          visibleContext: [],
          contextScope: "none",
          workspaceKey: "slack_web::https://app.slack.com/client/abc::channel::support",
          composerMode: "channel",
          metadata: {
            siteId: "slack_web",
            url: "https://app.slack.com/client/abc",
          },
          extractionConfidence: 0.8,
          warnings: [],
          pageUrlAtCapture: "https://app.slack.com/client/abc",
          viewFingerprint: "vf",
          composerFingerprint: "cf",
          sessionVersion: 1,
        },
        evidence: [],
        usedVoiceInput: false,
        costMode: "local_only",
      })
    ).toThrowError(/Invalid actionMode/);
  });

  it("accepts page context and visible email thread sources", () => {
    const parsed = parseGenerateDraftRequest({
      sessionId: "s2",
      sessionVersion: 1,
      siteId: "gmail_web",
      actionMode: "improve_current_draft",
      tonePreset: "professional",
      draftInput: "Hello",
      contextEnabled: true,
      snapshot: {
        draftText: "Hello",
        visibleContext: [
          {
            id: "c1",
            text: "Prior email body",
            source: "visible_email_thread",
            role: "customer",
          },
          {
            id: "c2",
            text: "Nearby page note",
            source: "visible_page",
            role: "unknown",
          },
        ],
        contextScope: "page",
        workspaceKey: "gmail_web::https://mail.google.com/mail/u/0/#inbox::Subject",
        composerMode: "email",
        metadata: {
          siteId: "gmail_web",
          url: "https://mail.google.com/mail/u/0/#inbox",
        },
        extractionConfidence: 0.72,
        warnings: [],
        pageUrlAtCapture: "https://mail.google.com/mail/u/0/#inbox",
        viewFingerprint: "vf",
        composerFingerprint: "cf",
        sessionVersion: 1,
      },
      evidence: [],
      usedVoiceInput: false,
      costMode: "local_only",
    });

    expect(parsed.snapshot.contextScope).toBe("page");
    expect(parsed.snapshot.visibleContext[0]?.source).toBe("visible_email_thread");
    expect(parsed.snapshot.visibleContext[1]?.source).toBe("visible_page");
  });

  it("accepts optional generate debug payloads", () => {
    expect(() =>
      assertGenerateDraftResponse({
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
            text: "Hello there, for context the issue is resolved.",
            styleNotes: [],
          },
        ],
        warnings: [],
        inputSummary: {
          contextUsed: true,
          contextItemsUsed: 1,
          contextScopeUsed: "thread",
          evidenceIdsUsed: [],
          usedVoiceInput: false,
          providerPath: "local_model",
          entityCorrectionsApplied: [],
        },
        debug: {
          selection: {
            responseTarget: {
              textPreview: "Can we get an ETA for the billing fix before Friday?",
              author: "Ari",
              role: "customer",
              reason: "Latest substantive question in thread.",
            },
            currentMessageFallbackUsed: false,
            supportTurnCount: 1,
          },
          supportingFacts: [
            {
              kind: "explicit_fact",
              textPreview: "The billing fix is in progress.",
              sourceAuthor: "Agent",
              relevance: 4,
            },
          ],
          excludedTurns: [
            {
              kind: "action_request",
              textPreview: "@crmteam please check this.",
              author: "Carlos",
            },
          ],
          cleanup: {
            winner: "model",
            modelQualityScore: 90,
            selectedQualityScore: 90,
            suspiciousTokens: [],
          },
          contextReply: {
            winner: "model",
            usedFallback: false,
            qualityScore: 84,
            coverage: "grounded",
          },
          provider: {
            runtime: "ollama",
            usedRetryPass: true,
          },
        },
        timings: {
          preflightMs: 10,
          providerMs: 20,
          totalMs: 30,
          usedRetryPass: true,
        },
      })
    ).not.toThrow();
  });
});
