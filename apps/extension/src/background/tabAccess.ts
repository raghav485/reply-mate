export type SessionAccessReason =
  | "unsupported_page"
  | "bridge_unavailable"
  | "no_composer";

type TabUrlClassification =
  | {
      supported: true;
      url: string | null;
    }
  | {
      supported: false;
      reason: "unsupported_page";
      message: string;
      url: string | null;
    };

const UNSUPPORTED_PAGE_MESSAGE =
  "ReplyMate cannot run on browser internal pages like new tabs or settings. Switch to a website and focus a text box.";
const BRIDGE_PERMISSION_MESSAGE =
  "ReplyMate could not access this website yet. Reload the tab and reopen the side panel.";
const BRIDGE_RECOVERY_MESSAGE =
  "ReplyMate could not reconnect to this page. Refresh the website and try again.";

const UNSUPPORTED_URL_PREFIXES = [
  "about:",
  "brave://",
  "chrome-extension://",
  "chrome-search://",
  "chrome://",
  "devtools://",
  "edge://",
  "moz-extension://",
  "opera://",
  "vivaldi://",
  "view-source:",
] as const;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function classifyTabUrl(url: string | undefined | null): TabUrlClassification {
  const normalized = (url ?? "").trim().toLowerCase();
  if (!normalized) {
    return {
      supported: true,
      url: url ?? null,
    };
  }

  for (const prefix of UNSUPPORTED_URL_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return {
        supported: false,
        reason: "unsupported_page",
        message: UNSUPPORTED_PAGE_MESSAGE,
        url: url ?? null,
      };
    }
  }

  return {
    supported: true,
    url: url ?? null,
  };
}

export function classifyBridgeAccessError(
  url: string | undefined | null,
  error: unknown
): {
  reason: Extract<SessionAccessReason, "unsupported_page" | "bridge_unavailable">;
  message: string;
} {
  const urlClassification = classifyTabUrl(url);
  if (!urlClassification.supported) {
    return {
      reason: urlClassification.reason,
      message: urlClassification.message,
    };
  }

  const normalized = toErrorMessage(error).toLowerCase();
  if (
    normalized.includes("cannot access contents of the page") ||
    normalized.includes("must request permission to access the respective host") ||
    normalized.includes("cannot be scripted")
  ) {
    return {
      reason: "bridge_unavailable",
      message: BRIDGE_PERMISSION_MESSAGE,
    };
  }

  if (
    normalized.includes("cannot access a chrome:// url") ||
    normalized.includes("cannot access a chrome-search:// url")
  ) {
    return {
      reason: "unsupported_page",
      message: UNSUPPORTED_PAGE_MESSAGE,
    };
  }

  if (
    normalized.includes("frame with id 0 was removed") ||
    normalized.includes("no frame with id") ||
    normalized.includes("frame was removed")
  ) {
    return {
      reason: "bridge_unavailable",
      message: BRIDGE_RECOVERY_MESSAGE,
    };
  }

  return {
    reason: "bridge_unavailable",
    message: BRIDGE_RECOVERY_MESSAGE,
  };
}
