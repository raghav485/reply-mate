// @vitest-environment jsdom

import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { bootstrapMock, sendRuntimeMessageMock } = vi.hoisted(() => ({
  bootstrapMock: vi.fn(),
  sendRuntimeMessageMock: vi.fn(),
}));

vi.mock("../../core/boot/bootstrap.js", () => ({
  bootstrap: bootstrapMock,
}));

vi.mock("../../shared/runtime.js", async () => {
  const actual = await vi.importActual<typeof import("../../shared/runtime.js")>(
    "../../shared/runtime.js"
  );
  return {
    ...actual,
    sendRuntimeMessage: sendRuntimeMessageMock,
  };
});

import { RuntimeMessageError } from "../../shared/runtime.js";
import * as SidePanelModule from "../SidePanelApp.js";

function createBootResult() {
  return {
    ctx: {
      uiRegistry: {
        getPanels: vi.fn().mockReturnValue([]),
      },
    } as any,
    registry: {
      bootAll: vi.fn().mockResolvedValue(undefined),
    } as any,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("SidePanelApp", () => {
  let container: HTMLDivElement;
  let root: Root;
  let reloadSpy: ReturnType<typeof vi.spyOn>;
  let runtimeMessageListener:
    | ((
        message: { type: string; payload?: Record<string, unknown> },
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void
      ) => void)
    | null;

  beforeEach(() => {
    bootstrapMock.mockReset();
    sendRuntimeMessageMock.mockReset();
    bootstrapMock.mockResolvedValue(createBootResult());
    sessionStorage.clear();
    runtimeMessageListener = null;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    reloadSpy = vi
      .spyOn(SidePanelModule.sidePanelWindowActions, "reload")
      .mockImplementation(() => undefined);

    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        runtime: {
          onMessage: {
            addListener: vi.fn((listener) => {
              runtimeMessageListener = listener;
            }),
            removeListener: vi.fn((listener) => {
              if (runtimeMessageListener === listener) {
                runtimeMessageListener = null;
              }
            }),
          },
        },
      },
    });
  });

  afterEach(async () => {
    reloadSpy.mockRestore();
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("reloads once when the sidepanel boots against a stale background receiver", async () => {
    sendRuntimeMessageMock.mockRejectedValueOnce(
      new RuntimeMessageError(
        "Could not establish connection. Receiving end does not exist.",
        "missing_receiver"
      )
    );

    await act(async () => {
      root.render(<SidePanelModule.SidePanelApp />);
    });
    await flush();

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("replymate.sidepanel.bootReloaded")).toBe("1");
  });

  it("shows reconnect UI after a second recoverable boot failure", async () => {
    sessionStorage.setItem("replymate.sidepanel.bootReloaded", "1");
    sendRuntimeMessageMock.mockRejectedValueOnce(
      new RuntimeMessageError(
        "Could not establish connection. Receiving end does not exist.",
        "missing_receiver"
      )
    );

    await act(async () => {
      root.render(<SidePanelModule.SidePanelApp />);
    });
    await flush();

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "ReplyMate lost its background connection. Reopen the side panel or click Retry."
    );
    expect(container.textContent).toContain("Disconnected");
    expect(sessionStorage.getItem("replymate.sidepanel.bootReloaded")).toBeNull();
  });

  it("reconnects successfully when retry is clicked after a recoverable failure", async () => {
    sessionStorage.setItem("replymate.sidepanel.bootReloaded", "1");
    sendRuntimeMessageMock.mockRejectedValueOnce(
      new RuntimeMessageError(
        "Could not establish connection. Receiving end does not exist.",
        "missing_receiver"
      )
    );

    await act(async () => {
      root.render(<SidePanelModule.SidePanelApp />);
    });
    await flush();

    sendRuntimeMessageMock
      .mockResolvedValueOnce({
        ok: true,
        tabId: 17,
        session: {
          sessionId: "gmail-session",
          siteId: "gmail_web",
          adapterId: "gmail",
          snapshot: { workspaceKey: "gmail::workspace" },
        },
      })
      .mockResolvedValueOnce({
        readiness: {
          drafting: { status: "ready", detail: "" },
          evidence: { status: "ready", detail: "" },
          voice: { status: "ready", detail: "" },
          telemetry: { status: "ready", detail: "" },
          attachHelper: "manual_only",
        },
      });

    const retryButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Retry ReplyMate connection"]'
    );
    expect(retryButton).not.toBeNull();

    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="replymate-connection-status"]')?.textContent
    ).toContain("Connected");
    expect(
      container.querySelector('[data-testid="replymate-active-adapter"]')?.textContent
    ).toContain("gmail_web — gmail adapter");
  });

  it("force-refreshes the active session when the panel regains focus", async () => {
    sendRuntimeMessageMock
      .mockResolvedValueOnce({
        ok: true,
        tabId: 17,
        session: {
          sessionId: "slack-session",
          siteId: "slack_web",
          adapterId: "slack",
          snapshot: { workspaceKey: "slack::workspace" },
        },
      })
      .mockResolvedValueOnce({
        readiness: {
          drafting: { status: "ready", detail: "" },
          evidence: { status: "ready", detail: "" },
          voice: { status: "ready", detail: "" },
          telemetry: { status: "ready", detail: "" },
          attachHelper: "manual_only",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        tabId: 17,
        session: {
          sessionId: "slack-session",
          siteId: "slack_web",
          adapterId: "slack",
          snapshot: { workspaceKey: "slack::workspace" },
        },
      });

    await act(async () => {
      root.render(<SidePanelModule.SidePanelApp />);
    });
    await flush();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();

    expect(sendRuntimeMessageMock).toHaveBeenNthCalledWith(3, {
      type: "SYNC_ACTIVE_TAB_SESSION",
      payload: { forceRefresh: true },
    });
  });

  it("shows unsupported-page UI without a retry button", async () => {
    sendRuntimeMessageMock
      .mockResolvedValueOnce({
        ok: true,
        tabId: 91,
        session: null,
        accessReason: "unsupported_page",
        foundComposer: false,
        message:
          "ReplyMate cannot run on browser internal pages like new tabs or settings. Switch to a website and focus a text box.",
      })
      .mockResolvedValueOnce({
        readiness: {
          drafting: { status: "ready", detail: "" },
          evidence: { status: "ready", detail: "" },
          voice: { status: "ready", detail: "" },
          telemetry: { status: "ready", detail: "" },
          attachHelper: "none",
        },
      });

    await act(async () => {
      root.render(<SidePanelModule.SidePanelApp />);
    });
    await flush();

    expect(container.textContent).toContain("Idle");
    expect(container.textContent).toContain("Unsupported page");
    expect(container.textContent).toContain(
      "ReplyMate cannot run on browser internal pages like new tabs or settings."
    );
    expect(
      container.querySelector('button[aria-label="Retry ReplyMate connection"]')
    ).toBeNull();
  });

  it("reconnects when switching from an unsupported page back to a supported site", async () => {
    sendRuntimeMessageMock
      .mockResolvedValueOnce({
        ok: true,
        tabId: 91,
        session: null,
        accessReason: "unsupported_page",
        foundComposer: false,
        message:
          "ReplyMate cannot run on browser internal pages like new tabs or settings. Switch to a website and focus a text box.",
      })
      .mockResolvedValueOnce({
        readiness: {
          drafting: { status: "ready", detail: "" },
          evidence: { status: "ready", detail: "" },
          voice: { status: "ready", detail: "" },
          telemetry: { status: "ready", detail: "" },
          attachHelper: "none",
        },
      });

    await act(async () => {
      root.render(<SidePanelModule.SidePanelApp />);
    });
    await flush();

    sendRuntimeMessageMock
      .mockResolvedValueOnce({
        ok: true,
        tabId: 55,
        session: {
          sessionId: "generic-session",
          siteId: "generic_web",
          adapterId: "generic",
          snapshot: { workspaceKey: "generic::workspace" },
        },
      })
      .mockResolvedValueOnce({
        readiness: {
          drafting: { status: "ready", detail: "" },
          evidence: { status: "ready", detail: "" },
          voice: { status: "ready", detail: "" },
          telemetry: { status: "ready", detail: "" },
          attachHelper: "none",
        },
      });

    await act(async () => {
      runtimeMessageListener?.(
        {
          type: "ACTIVE_TAB_CHANGED",
          payload: { tabId: 55 },
        },
        {} as chrome.runtime.MessageSender,
        () => undefined
      );
    });
    await flush();

    expect(container.textContent).toContain("Connected");
    expect(
      container.querySelector('[data-testid="replymate-active-adapter"]')?.textContent
    ).toContain("generic_web — generic adapter");
    expect(container.textContent).not.toContain("Unsupported page");
  });
});
