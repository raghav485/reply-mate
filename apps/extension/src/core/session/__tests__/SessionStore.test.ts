// =============================================================================
// SessionStore Tests
// =============================================================================

import { describe, expect, it, vi } from "vitest";
import { SessionStoreImpl } from "../SessionStore.js";
import type { ComposerSession, ComposerSnapshot } from "@replymate/contracts";

function makeSnapshot(overrides?: Partial<ComposerSnapshot>): ComposerSnapshot {
  return {
    draftText: "Hello world",
    visibleContext: [],
    contextScope: "none",
    workspaceKey: "slack_web::https://app.slack.com/test::channel::customer-support",
    composerMode: "channel",
    metadata: {
      siteId: "slack_web",
      url: "https://app.slack.com/test",
    },
    extractionConfidence: 0.9,
    warnings: [],
    pageUrlAtCapture: "https://app.slack.com/test",
    viewFingerprint: "view-123",
    composerFingerprint: "comp-456",
    sessionVersion: 1,
    ...overrides,
  };
}

function makeSession(overrides?: Partial<ComposerSession>): ComposerSession {
  return {
    sessionId: "sess-001",
    tabId: 42,
    siteId: "slack_web",
    adapterId: "slack",
    capabilityMap: {
      drafting: true,
      evidence: false,
      voice: false,
      telemetry: false,
      attachHelper: "none",
    },
    snapshot: makeSnapshot(),
    warnings: [],
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("SessionStore", () => {
  it("starts with no sessions", () => {
    const store = new SessionStoreImpl();
    expect(store.getSession(42)).toBeNull();
    expect(store.getSessions()).toEqual([]);
  });

  it("stores and returns the session by tab id", () => {
    const store = new SessionStoreImpl();
    const session = makeSession();
    store.setSession(session.tabId, session);

    expect(store.getSession(session.tabId)).toEqual(session);
  });

  it("clears only the targeted tab session", () => {
    const store = new SessionStoreImpl();
    store.setSession(42, makeSession({ tabId: 42, sessionId: "sess-001" }));
    store.setSession(99, makeSession({ tabId: 99, sessionId: "sess-002" }));

    store.clearSession(42);

    expect(store.getSession(42)).toBeNull();
    expect(store.getSession(99)?.sessionId).toBe("sess-002");
  });

  it("updates only the matching session on the same tab", () => {
    const store = new SessionStoreImpl();
    store.setSession(42, makeSession({ sessionId: "sess-001" }));

    const newSnapshot = makeSnapshot({ draftText: "Updated draft" });
    store.updateSnapshot(42, "sess-001", newSnapshot);

    expect(store.getSession(42)?.snapshot?.draftText).toBe("Updated draft");
  });

  it("ignores snapshot updates for a non-matching session id", () => {
    const store = new SessionStoreImpl();
    store.setSession(42, makeSession({ sessionId: "sess-001" }));

    store.updateSnapshot(42, "sess-999", makeSnapshot({ draftText: "Different" }));

    expect(store.getSession(42)?.snapshot?.draftText).toBe("Hello world");
  });

  describe("isSessionCurrent (stale-session protection)", () => {
    it("returns true when all identifiers match", () => {
      const store = new SessionStoreImpl();
      store.setSession(42, makeSession());

      expect(store.isSessionCurrent(42, "sess-001", 1, "view-123", "comp-456")).toBe(true);
    });

    it("returns false when session id differs", () => {
      const store = new SessionStoreImpl();
      store.setSession(42, makeSession());

      expect(store.isSessionCurrent(42, "sess-999", 1, "view-123", "comp-456")).toBe(false);
    });

    it("returns false when session version differs", () => {
      const store = new SessionStoreImpl();
      store.setSession(42, makeSession());

      expect(store.isSessionCurrent(42, "sess-001", 2, "view-123", "comp-456")).toBe(false);
    });

    it("returns false when view fingerprint differs", () => {
      const store = new SessionStoreImpl();
      store.setSession(42, makeSession());

      expect(store.isSessionCurrent(42, "sess-001", 1, "view-changed", "comp-456")).toBe(false);
    });

    it("returns false when composer fingerprint differs", () => {
      const store = new SessionStoreImpl();
      store.setSession(42, makeSession());

      expect(store.isSessionCurrent(42, "sess-001", 1, "view-123", "comp-changed")).toBe(false);
    });

    it("stays current after draft text changes in the same composer", () => {
      const store = new SessionStoreImpl();
      store.setSession(42, makeSession());

      store.updateSnapshot(
        42,
        "sess-001",
        makeSnapshot({
          draftText: "Hello world with more typing",
          sessionVersion: 1,
          viewFingerprint: "view-123",
          composerFingerprint: "comp-456",
        })
      );

      expect(store.isSessionCurrent(42, "sess-001", 1, "view-123", "comp-456")).toBe(true);
    });

    it("returns false when the tab has no session", () => {
      const store = new SessionStoreImpl();

      expect(store.isSessionCurrent(42, "sess-001", 1, "view-123", "comp-456")).toBe(false);
    });
  });

  it("onChange listener fires on session changes", () => {
    const store = new SessionStoreImpl();
    const listener = vi.fn();

    store.onChange(listener);
    store.setSession(42, makeSession());

    expect(listener).toHaveBeenCalledOnce();
  });

  it("onChange unsubscribe stops notifications", () => {
    const store = new SessionStoreImpl();
    const listener = vi.fn();

    const unsub = store.onChange(listener);
    unsub();
    store.setSession(42, makeSession());

    expect(listener).not.toHaveBeenCalled();
  });
});
