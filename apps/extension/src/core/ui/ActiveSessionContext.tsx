import { createContext, useContext, type ReactNode } from "react";
import type { ComposerSession } from "@replymate/contracts";

export type SessionRefreshReason =
  | "boot"
  | "panel_focus"
  | "tab_return"
  | "generate"
  | "insert"
  | "voice"
  | "evidence";

export type SessionSyncReason = SessionRefreshReason | "retry";

export type ActiveSessionConnectionState =
  | "connecting"
  | "idle"
  | "connected"
  | "disconnected"
  | "error";

export type ComposerAvailability = "available" | "missing" | "unknown" | "unsupported";

export type ActiveSessionController = {
  session: ComposerSession | null;
  activeTabId: number | null;
  connectionState: ActiveSessionConnectionState;
  composerAvailability: ComposerAvailability;
  connectionMessage: string | null;
  ensureFreshSession(reason: SessionRefreshReason): Promise<ComposerSession | null>;
  retryConnection(): Promise<void>;
  syncSession(
    reason: SessionSyncReason,
    options?: {
      forceRefresh?: boolean;
      requestedTabId?: number | null;
      refreshReadiness?: boolean;
      allowReload?: boolean;
    }
  ): Promise<{
    ok?: boolean;
    tabId?: number | null;
    session?: ComposerSession | null;
    message?: string;
    accessReason?: "unsupported_page" | "bridge_unavailable" | "no_composer";
    foundComposer?: boolean;
    staleCleared?: boolean;
  }>;
};

const ActiveSessionContext = createContext<ActiveSessionController | null>(null);

export function ActiveSessionProvider(props: {
  value: ActiveSessionController;
  children: ReactNode;
}) {
  return (
    <ActiveSessionContext.Provider value={props.value}>
      {props.children}
    </ActiveSessionContext.Provider>
  );
}

export function useActiveSession(): ActiveSessionController {
  const value = useContext(ActiveSessionContext);
  if (!value) {
    throw new Error("useActiveSession must be used within ActiveSessionProvider.");
  }
  return value;
}
