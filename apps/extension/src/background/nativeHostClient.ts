import type {
  NativeRuntimeStatus,
  NativeHostRequest,
  NativeHostResponse,
} from "@replymate/contracts";
import { ApiClientError } from "../shared-client/ApiClient.js";

const NATIVE_HOST_NAME = "app.replymate.native";

function buildNativeRuntimeStatus(input: {
  extensionId: string;
  availability: NativeRuntimeStatus["availability"];
  message: string;
  actionHint?: string;
}): NativeRuntimeStatus {
  return {
    transport: "native_host",
    extensionId: input.extensionId,
    hostName: NATIVE_HOST_NAME,
    availability: input.availability,
    message: input.message,
    actionHint: input.actionHint,
  };
}

function classifyNativeHostDisconnect(extensionId: string, message?: string): {
  status: NativeRuntimeStatus;
  error: ApiClientError;
} {
  const normalized = (message || "").toLowerCase();

  if (normalized.includes("native messaging host not found")) {
    const status = buildNativeRuntimeStatus({
      extensionId,
      availability: "not_registered",
      message:
        "ReplyMate local runtime is not registered for this extension. Run the native-host setup command, then restart Chrome.",
      actionHint:
        "Build the API, register the native host for this extension ID, then fully restart Chrome.",
    });
    return {
      status,
      error: new ApiClientError(
        status.message,
        503,
        "NATIVE_RUNTIME_NOT_REGISTERED"
      ),
    };
  }

  if (
    normalized.includes("forbidden") ||
    normalized.includes("access to the specified native messaging host is forbidden")
  ) {
    const status = buildNativeRuntimeStatus({
      extensionId,
      availability: "forbidden",
      message:
        "ReplyMate local runtime is registered for a different extension ID. Re-register the native host for this extension and restart Chrome.",
      actionHint:
        "Re-run the native-host registration command with the current unpacked extension ID, then restart Chrome.",
    });
    return {
      status,
      error: new ApiClientError(
        status.message,
        503,
        "NATIVE_RUNTIME_EXTENSION_ID_MISMATCH"
      ),
    };
  }

  const status = buildNativeRuntimeStatus({
    extensionId,
    availability: "unavailable",
    message:
      "ReplyMate local runtime is unavailable or disconnected. Restart Chrome, then verify the native host is still registered for this extension.",
    actionHint:
      "Restart Chrome first. If this keeps happening, re-register the native host for the current extension ID.",
  });
  return {
    status,
    error: new ApiClientError(
      status.message,
      503,
      "NATIVE_RUNTIME_UNAVAILABLE"
    ),
  };
}

function toApiClientError(response: Extract<NativeHostResponse, { ok: false }>): ApiClientError {
  return new ApiClientError(
    response.error.message,
    response.error.status || 500,
    response.error.errorCode
  );
}

export class NativeHostClient {
  async getStatus(extensionId: string): Promise<NativeRuntimeStatus> {
    return new Promise((resolve) => {
      let settled = false;
      let port: chrome.runtime.Port;
      try {
        port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
      } catch {
        resolve(classifyNativeHostDisconnect(extensionId).status);
        return;
      }

      const cleanup = () => {
        port.onMessage.removeListener(onMessage);
        port.onDisconnect.removeListener(onDisconnect);
        try {
          port.disconnect();
        } catch {
          // noop
        }
      };

      const onDisconnect = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(
          classifyNativeHostDisconnect(extensionId, chrome.runtime.lastError?.message).status
        );
      };

      const onMessage = (
        response: NativeHostResponse
      ) => {
        if (response.id !== request.id || settled) {
          return;
        }
        settled = true;
        cleanup();
        if (!response.ok) {
          resolve(
            buildNativeRuntimeStatus({
              extensionId,
              availability: "unavailable",
              message:
                "ReplyMate local runtime responded with an error. Restart Chrome, then verify the native host is still registered for this extension.",
              actionHint:
                "If this keeps happening, re-register the native host for the current extension ID.",
            })
          );
          return;
        }
        resolve(
          buildNativeRuntimeStatus({
            extensionId,
            availability: "ready",
            message: `ReplyMate local runtime is connected through ${NATIVE_HOST_NAME}.`,
          })
        );
      };

      const request: NativeHostRequest = {
        id: crypto.randomUUID(),
        type: "runtime.status",
        payload: { extensionId },
      };

      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(onDisconnect);

      try {
        port.postMessage(request);
      } catch {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(classifyNativeHostDisconnect(extensionId).status);
        }
      }
    });
  }

  async request<T>(request: NativeHostRequest): Promise<T> {
    return this.requestInternal(request, chrome.runtime.id);
  }

  private async requestInternal<T>(
    request: NativeHostRequest,
    extensionId: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let port: chrome.runtime.Port;
      try {
        port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
      } catch {
        reject(classifyNativeHostDisconnect(extensionId).error);
        return;
      }

      const cleanup = () => {
        port.onMessage.removeListener(onMessage);
        port.onDisconnect.removeListener(onDisconnect);
        try {
          port.disconnect();
        } catch {
          // noop
        }
      };

      const onDisconnect = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        const classified = classifyNativeHostDisconnect(
          extensionId,
          chrome.runtime.lastError?.message
        );
        reject(classified.error);
      };

      const onMessage = (response: NativeHostResponse) => {
        if (response.id !== request.id || settled) {
          return;
        }
        settled = true;
        cleanup();
        if (!response.ok) {
          reject(toApiClientError(response));
          return;
        }
        resolve(response.payload as T);
      };

      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(onDisconnect);

      try {
        port.postMessage(request);
      } catch {
        if (!settled) {
          settled = true;
          cleanup();
          const classified = classifyNativeHostDisconnect(extensionId);
          reject(classified.error);
        }
      }
    });
  }
}
