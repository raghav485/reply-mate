export type RuntimeMessageErrorCode =
  | "missing_receiver"
  | "context_invalidated"
  | "unknown";

export class RuntimeMessageError extends Error {
  constructor(
    message: string,
    readonly code: RuntimeMessageErrorCode
  ) {
    super(message);
    this.name = "RuntimeMessageError";
  }
}

function classifyRuntimeMessage(message: string): RuntimeMessageErrorCode {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("receiving end does not exist") ||
    normalized.includes("could not establish connection")
  ) {
    return "missing_receiver";
  }
  if (normalized.includes("extension context invalidated")) {
    return "context_invalidated";
  }
  return "unknown";
}

export function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError?.message) {
        reject(
          new RuntimeMessageError(
            runtimeError.message,
            classifyRuntimeMessage(runtimeError.message)
          )
        );
        return;
      }

      resolve(response as T);
    });
  });
}
