// =============================================================================
// SessionStore — TRD §9
// =============================================================================

import type {
  ComposerSession,
  ComposerSnapshot,
  SessionStore as ISessionStore,
} from "@replymate/contracts";

export class SessionStoreImpl implements ISessionStore {
  private sessions = new Map<number, ComposerSession>();
  private listeners: Set<() => void> = new Set();

  getSession(tabId: number): ComposerSession | null {
    return this.sessions.get(tabId) ?? null;
  }

  getSessions(): ComposerSession[] {
    return Array.from(this.sessions.values());
  }

  setSession(tabId: number, session: ComposerSession): void {
    this.sessions.set(tabId, session);
    this.notify();
  }

  clearSession(tabId: number): void {
    if (this.sessions.delete(tabId)) {
      this.notify();
    }
  }

  updateSnapshot(tabId: number, sessionId: string, snapshot: ComposerSnapshot): void {
    const current = this.sessions.get(tabId);
    if (current && current.sessionId === sessionId) {
      this.sessions.set(tabId, {
        ...current,
        snapshot,
        updatedAt: new Date().toISOString(),
      });
      this.notify();
    }
  }

  /**
   * Stale-session protection — TRD §20.2.
   * Returns true only if the active session still matches the generation session.
   */
  isSessionCurrent(
    tabId: number,
    sessionId: string,
    sessionVersion: number,
    viewFingerprint: string,
    composerFingerprint: string
  ): boolean {
    const session = this.sessions.get(tabId);
    if (!session) return false;
    if (session.sessionId !== sessionId) return false;
    if (!session.snapshot) return false;
    if (session.snapshot.sessionVersion !== sessionVersion)
      return false;
    if (session.snapshot.viewFingerprint !== viewFingerprint)
      return false;
    if (session.snapshot.composerFingerprint !== composerFingerprint)
      return false;
    return true;
  }

  /** Subscribe to session changes. Returns unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // isolate listener errors
      }
    }
  }
}
