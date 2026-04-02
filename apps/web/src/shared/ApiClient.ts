import type {
  BillingPortalResponse,
  BillingSummary,
  CheckoutSessionResponse,
  DeviceAuthCompleteResponse,
  EmailAuthRequestResponse,
  EmailAuthVerifyResponse,
  HostedSession,
} from "@replymate/contracts";

const SESSION_KEY = "replymate:webSession";

function resolveBaseUrl(): string {
  const env = (
    import.meta as ImportMeta & {
      env?: Record<string, string | undefined>;
    }
  ).env;

  return (
    env?.VITE_REPLYMATE_API_BASE_URL?.trim() ||
    (window.location.hostname === "localhost"
      ? "http://localhost:3000"
      : "https://api.replymate.app")
  ).replace(/\/+$/, "");
}

export function readStoredSession(): HostedSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as HostedSession;
  } catch {
    return null;
  }
}

export function storeSession(session: HostedSession | null): void {
  if (!session) {
    window.localStorage.removeItem(SESSION_KEY);
    return;
  }
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${resolveBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((init.headers as Record<string, string> | undefined) || {}),
    },
  });

  const payload = (await response.json()) as T & { message?: string };
  if (!response.ok) {
    throw new Error((payload as { message?: string }).message || "ReplyMate request failed.");
  }
  return payload;
}

export const WebApiClient = {
  requestMagicLink(email: string): Promise<EmailAuthRequestResponse> {
    return request("/v1/auth/email/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  verifyMagicLink(token: string): Promise<EmailAuthVerifyResponse> {
    return request("/v1/auth/email/verify", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  },

  completeDeviceAuth(userCode: string, token: string): Promise<DeviceAuthCompleteResponse> {
    return request(
      "/v1/auth/device/complete",
      {
        method: "POST",
        body: JSON.stringify({ userCode }),
      },
      token
    );
  },

  getBillingSummary(token: string): Promise<BillingSummary> {
    return request("/v1/billing/summary", { method: "GET" }, token);
  },

  createCheckoutSession(token: string): Promise<CheckoutSessionResponse> {
    return request(
      "/v1/billing/checkout",
      {
        method: "POST",
        body: JSON.stringify({
          successUrl: `${window.location.origin}/checkout/success`,
          cancelUrl: `${window.location.origin}/checkout/cancel`,
        }),
      },
      token
    );
  },

  createBillingPortal(token: string): Promise<BillingPortalResponse> {
    return request(
      "/v1/billing/portal",
      {
        method: "POST",
        body: JSON.stringify({
          returnUrl: `${window.location.origin}/account`,
        }),
      },
      token
    );
  },
};
