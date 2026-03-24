import { useCallback, useEffect, useRef, useState } from "react";
import type { ComposerSession } from "@replymate/contracts";
import {
  RuntimeMessageError,
  sendRuntimeMessage,
} from "../shared/runtime.js";
import type {
  ActiveSessionConnectionState,
  ComposerAvailability,
  SessionRefreshReason,
  SessionSyncReason,
} from "../core/ui/ActiveSessionContext.js";

type SessionUpdatedMessage = {
  type: string;
  payload?: {
    tabId?: number;
    sessionId?: string | null;
    workspaceKey?: string;
  };
};

type ActiveTabSyncResponse = {
  ok?: boolean;
  tabId?: number | null;
  session?: ComposerSession | null;
  message?: string;
  foundComposer?: boolean;
  staleCleared?: boolean;
};

type SessionSyncOptions = {
  forceRefresh: boolean;
  requestedTabId: number | null;
  refreshReadiness: boolean;
  allowReload: boolean;
};

type UseSidePanelSessionControllerOptions = {
  refreshRuntimeReadiness?: (tabId: number | null) => Promise<void>;
};

const SIDEPANEL_BOOT_RELOAD_KEY = "replymate.sidepanel.bootReloaded";
const NO_COMPOSER_MESSAGE =
  "ReplyMate could not find an active text box on this page. Focus the composer and try again.";

function isRecoverableRuntimeError(error: unknown): boolean {
  return (
    error instanceof RuntimeMessageError &&
    (error.code === "missing_receiver" || error.code === "context_invalidated")
  );
}

function formatConnectionError(error: unknown): string {
  if (error instanceof RuntimeMessageError) {
    if (error.code === "missing_receiver" || error.code === "context_invalidated") {
      return "ReplyMate lost its background connection. Reopen the side panel or click Retry.";
    }
    return error.message;
  }

  return error instanceof Error ? error.message : String(error);
}

function shouldReloadAfterRecoverableError(): boolean {
  const storage = window.sessionStorage;
  if (storage.getItem(SIDEPANEL_BOOT_RELOAD_KEY) === "1") {
    storage.removeItem(SIDEPANEL_BOOT_RELOAD_KEY);
    return false;
  }

  storage.setItem(SIDEPANEL_BOOT_RELOAD_KEY, "1");
  return true;
}

function clearBootReloadFlag(): void {
  window.sessionStorage.removeItem(SIDEPANEL_BOOT_RELOAD_KEY);
}

export const sidePanelWindowActions = {
  reload(): void {
    window.location.reload();
  },
};

export type SidePanelSessionController = {
  activeTabId: number | null;
  session: ComposerSession | null;
  connectionState: ActiveSessionConnectionState;
  composerAvailability: ComposerAvailability;
  connectionMessage: string | null;
  ensureFreshSession(reason: SessionRefreshReason): Promise<ComposerSession | null>;
  retryConnection(): Promise<void>;
  syncSession(
    reason: SessionSyncReason,
    options?: Partial<SessionSyncOptions>
  ): Promise<ActiveTabSyncResponse>;
};

export function useSidePanelSessionController(
  options: UseSidePanelSessionControllerOptions = {}
): SidePanelSessionController {
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [session, setSession] = useState<ComposerSession | null>(null);
  const [connectionState, setConnectionState] =
    useState<ActiveSessionConnectionState>("connecting");
  const [composerAvailability, setComposerAvailability] =
    useState<ComposerAvailability>("unknown");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const activeTabRef = useRef<number | null>(null);
  const refreshRuntimeReadinessRef = useRef(options.refreshRuntimeReadiness);
  const sessionSyncInFlightRef = useRef<{
    key: string;
    promise: Promise<ActiveTabSyncResponse>;
  } | null>(null);

  refreshRuntimeReadinessRef.current = options.refreshRuntimeReadiness;

  useEffect(() => {
    activeTabRef.current = activeTabId;
  }, [activeTabId]);

  const applyResponseState = useCallback(
    async (
      response: ActiveTabSyncResponse,
      options: Required<Pick<SessionSyncOptions, "refreshReadiness">>
    ): Promise<ActiveTabSyncResponse> => {
      const nextTabId = typeof response?.tabId === "number" ? response.tabId : null;

      if (!mountedRef.current) {
        return {
          ok: response?.ok ?? false,
          tabId: nextTabId,
          session: response?.session ?? null,
          message: response?.message,
          foundComposer: response?.foundComposer,
          staleCleared: response?.staleCleared,
        };
      }

      setActiveTabId(nextTabId);
      setSession(response?.session ?? null);

      if (options.refreshReadiness) {
        await refreshRuntimeReadinessRef.current?.(nextTabId);
      }

      if (response.ok === false) {
        clearBootReloadFlag();
        setConnectionState("disconnected");
        setComposerAvailability("unknown");
        setConnectionMessage(
          response.message ||
            "ReplyMate lost its background connection. Reopen the side panel or click Retry."
        );
      } else if (response.session?.snapshot) {
        clearBootReloadFlag();
        setConnectionState("connected");
        setComposerAvailability("available");
        setConnectionMessage(null);
      } else if (response.foundComposer === false) {
        clearBootReloadFlag();
        setConnectionState("connected");
        setComposerAvailability("missing");
        setConnectionMessage(response.message || NO_COMPOSER_MESSAGE);
      } else {
        clearBootReloadFlag();
        setConnectionState("connected");
        setComposerAvailability("unknown");
        setConnectionMessage(null);
      }

      return {
        ok: response?.ok ?? false,
        tabId: nextTabId,
        session: response?.session ?? null,
        message: response?.message,
        foundComposer: response?.foundComposer,
        staleCleared: response?.staleCleared,
      };
    },
    []
  );

  const syncSession = useCallback(
    async (
      reason: SessionSyncReason,
      syncOptions: Partial<SessionSyncOptions> = {}
    ): Promise<ActiveTabSyncResponse> => {
      const options: SessionSyncOptions = {
        forceRefresh: syncOptions.forceRefresh ?? false,
        requestedTabId: syncOptions.requestedTabId ?? null,
        refreshReadiness: syncOptions.refreshReadiness ?? false,
        allowReload: syncOptions.allowReload ?? false,
      };

      const inFlightKey = [
        options.requestedTabId ?? "active",
        options.forceRefresh ? "force" : "hydrate",
        options.refreshReadiness ? "readiness" : "session",
      ].join("::");
      if (sessionSyncInFlightRef.current?.key === inFlightKey) {
        return sessionSyncInFlightRef.current.promise;
      }

      const explicitConnect =
        reason === "boot" || reason === "panel_focus" || reason === "retry";
      if (explicitConnect) {
        setConnectionState("connecting");
      }

      const promise = (async () => {
        try {
          const response = await sendRuntimeMessage<ActiveTabSyncResponse>({
            type: "SYNC_ACTIVE_TAB_SESSION",
            payload: {
              ...(typeof options.requestedTabId === "number"
                ? { tabId: options.requestedTabId }
                : {}),
              forceRefresh: options.forceRefresh,
            },
          });

          return await applyResponseState(response, {
            refreshReadiness: options.refreshReadiness,
          });
        } catch (error) {
          if (
            options.allowReload &&
            isRecoverableRuntimeError(error) &&
            shouldReloadAfterRecoverableError()
          ) {
            sidePanelWindowActions.reload();
            return {
              ok: false,
              tabId: options.requestedTabId ?? activeTabRef.current,
              session: null,
              message: formatConnectionError(error),
              foundComposer: false,
              staleCleared: false,
            };
          }

          if (!mountedRef.current) {
            return {
              ok: false,
              tabId: options.requestedTabId ?? activeTabRef.current,
              session: null,
              message: formatConnectionError(error),
              foundComposer: false,
              staleCleared: false,
            };
          }

          setSession(null);
          setComposerAvailability("unknown");
          if (isRecoverableRuntimeError(error)) {
            setConnectionState("disconnected");
          } else {
            setConnectionState("error");
          }
          setConnectionMessage(formatConnectionError(error));

          return {
            ok: false,
            tabId: options.requestedTabId ?? activeTabRef.current,
            session: null,
            message: formatConnectionError(error),
            foundComposer: false,
            staleCleared: false,
          };
        }
      })().finally(() => {
        if (sessionSyncInFlightRef.current?.promise === promise) {
          sessionSyncInFlightRef.current = null;
        }
      });

      sessionSyncInFlightRef.current = {
        key: inFlightKey,
        promise,
      };
      return promise;
    },
    [applyResponseState]
  );

  const ensureFreshSession = useCallback(
    async (reason: SessionRefreshReason): Promise<ComposerSession | null> => {
      const response = await syncSession(reason, {
        forceRefresh: reason !== "boot",
        refreshReadiness: false,
        allowReload: false,
      });
      return response.session ?? null;
    },
    [syncSession]
  );

  const retryConnection = useCallback(async (): Promise<void> => {
    await syncSession("retry", {
      forceRefresh: true,
      refreshReadiness: true,
      allowReload: false,
    });
  }, [syncSession]);

  useEffect(() => {
    mountedRef.current = true;
    void syncSession("boot", {
      forceRefresh: false,
      refreshReadiness: true,
      allowReload: true,
    });

    const listener = (
      message: SessionUpdatedMessage,
      _sender: chrome.runtime.MessageSender,
      _sendResponse: (response?: unknown) => void
    ) => {
      if (message.type === "ACTIVE_TAB_CHANGED") {
        const requestedTabId =
          typeof message.payload?.tabId === "number" ? message.payload.tabId : undefined;
        void syncSession("tab_return", {
          forceRefresh: false,
          requestedTabId,
          refreshReadiness: true,
          allowReload: false,
        });
        return;
      }

      if (
        message.type === "SESSION_UPDATED" &&
        typeof message.payload?.tabId === "number" &&
        message.payload.tabId === activeTabRef.current
      ) {
        if (message.payload.sessionId === null) {
          setSession(null);
          setComposerAvailability("missing");
          setConnectionMessage(NO_COMPOSER_MESSAGE);
          return;
        }

        void syncSession("tab_return", {
          forceRefresh: false,
          requestedTabId: message.payload.tabId,
          refreshReadiness: false,
          allowReload: false,
        });
        return;
      }

      if (message.type === "SETTINGS_UPDATED") {
        void refreshRuntimeReadinessRef.current?.(activeTabRef.current);
      }
    };

    const handlePanelFocus = () => {
      void syncSession("panel_focus", {
        forceRefresh: true,
        refreshReadiness: true,
        allowReload: false,
      });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void syncSession("tab_return", {
        forceRefresh: true,
        refreshReadiness: true,
        allowReload: false,
      });
    };
    const handlePageShow = () => {
      void syncSession("tab_return", {
        forceRefresh: true,
        refreshReadiness: true,
        allowReload: false,
      });
    };

    chrome.runtime.onMessage.addListener(listener);
    window.addEventListener("focus", handlePanelFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      mountedRef.current = false;
      chrome.runtime.onMessage.removeListener(listener);
      window.removeEventListener("focus", handlePanelFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [syncSession]);

  return {
    activeTabId,
    session,
    connectionState,
    composerAvailability,
    connectionMessage,
    ensureFreshSession,
    retryConnection,
    syncSession,
  };
}
