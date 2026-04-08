import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NativeHostClient } from "../nativeHostClient.js";

type Listener<T> = (value: T) => void;

function createPort() {
  const messageListeners = new Set<Listener<unknown>>();
  const disconnectListeners = new Set<() => void>();

  return {
    onMessage: {
      addListener: vi.fn((listener: Listener<unknown>) => messageListeners.add(listener)),
      removeListener: vi.fn((listener: Listener<unknown>) => messageListeners.delete(listener)),
    },
    onDisconnect: {
      addListener: vi.fn((listener: () => void) => disconnectListeners.add(listener)),
      removeListener: vi.fn((listener: () => void) => disconnectListeners.delete(listener)),
    },
    disconnect: vi.fn(),
    postMessage: vi.fn((payload: unknown) => {
      queueMicrotask(() => {
        for (const listener of messageListeners) {
          listener({
            id: (payload as { id: string }).id,
            ok: true,
            type: "runtime.status",
            payload: {
              apiVersion: "v1",
              hostName: "app.replymate.native",
            },
          });
        }
      });
    }),
    emitDisconnect() {
      for (const listener of disconnectListeners) {
        listener();
      }
    },
  };
}

describe("NativeHostClient", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns a ready native runtime status when the host responds", async () => {
    const port = createPort();
    vi.stubGlobal("chrome", {
      runtime: {
        id: "gfjfeddlbpnmpflhbfmgpobglimhfjip",
        lastError: null,
        connectNative: vi.fn(() => port),
      },
    });

    const client = new NativeHostClient();
    const result = await client.getStatus("gfjfeddlbpnmpflhbfmgpobglimhfjip");

    expect(result.availability).toBe("ready");
    expect(result.transport).toBe("native_host");
    expect(result.extensionId).toBe("gfjfeddlbpnmpflhbfmgpobglimhfjip");
  });

  it("normalizes a missing native host into an actionable setup error", async () => {
    const port = createPort();
    const chromeMock = {
      runtime: {
        id: "gfjfeddlbpnmpflhbfmgpobglimhfjip",
        lastError: null as { message?: string } | null,
        connectNative: vi.fn(() => port),
      },
    };
    port.postMessage.mockImplementation(() => {
      queueMicrotask(() => {
        chromeMock.runtime.lastError = {
          message: "Specified native messaging host not found.",
        };
        port.emitDisconnect();
      });
    });

    vi.stubGlobal("chrome", chromeMock);

    const client = new NativeHostClient();
    await expect(
      client.request({
        id: "req-1",
        type: "providerCredentials.status",
        payload: { baseUrl: "http://localhost:3000" },
      })
    ).rejects.toMatchObject({
      errorCode: "NATIVE_RUNTIME_NOT_REGISTERED",
      message:
        "ReplyMate local runtime is not registered for this extension. Run the native-host setup command, then restart Chrome.",
    });
  });
});
