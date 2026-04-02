import { ProviderError } from "../core/errors.js";
import type {
  StripeBillingPortalSession,
  StripeCheckoutSession,
  StripeCustomer,
  StripeWebhookEvent,
} from "./types.js";
import { getStripeBillingIntegrationReadiness } from "./readiness.js";
import { verifyStripeWebhookSignature } from "./stripeWebhookSignature.js";

const STRIPE_API_BASE_URL = "https://api.stripe.com/v1";

function resolveOptionalEnv(name: string): string {
  return process.env[name]?.trim() || "";
}

function encodeForm(body: Record<string, string | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && value !== "") {
      params.set(key, value);
    }
  }
  return params;
}

async function parseJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new ProviderError({
      message: "Stripe returned an invalid response.",
      errorCode: "BILLING_UNAVAILABLE",
      statusCode: 502,
    });
  }
}

type StripeErrorPayload = {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

async function buildStripeRequestError(
  response: Response,
  fallbackMessage: string
): Promise<ProviderError> {
  let payload: StripeErrorPayload | null = null;
  try {
    payload = (await response.json()) as StripeErrorPayload;
  } catch {
    payload = null;
  }

  const stripeMessage = payload?.error?.message?.trim();
  const stripeType = payload?.error?.type?.trim();
  const stripeCode = payload?.error?.code?.trim();
  const detail = [stripeType, stripeCode].filter(Boolean).join("/");

  return new ProviderError({
    message:
      stripeMessage && detail
        ? `${fallbackMessage} Stripe responded with ${detail}: ${stripeMessage}`
        : stripeMessage
          ? `${fallbackMessage} ${stripeMessage}`
          : fallbackMessage,
    errorCode: "BILLING_UNAVAILABLE",
    statusCode: 502,
    retryable: response.status >= 500 || response.status === 429,
    details: {
      provider: "stripe",
      httpStatus: response.status,
      stripeType,
      stripeCode,
    },
  });
}

export class StripeBillingService {
  private readonly secretKey: string;
  private readonly webhookSecret: string;
  private readonly proPriceId: string;

  constructor() {
    this.secretKey = resolveOptionalEnv("REPLYMATE_STRIPE_SECRET_KEY");
    this.webhookSecret = resolveOptionalEnv("REPLYMATE_STRIPE_WEBHOOK_SECRET");
    this.proPriceId = resolveOptionalEnv("REPLYMATE_STRIPE_PRO_PRICE_ID");
  }

  canUseLiveBilling(): boolean {
    return getStripeBillingIntegrationReadiness().checkoutAvailable;
  }

  canVerifyWebhooks(): boolean {
    return getStripeBillingIntegrationReadiness().webhookVerificationAvailable;
  }

  private assertLiveBillingAvailable(): void {
    if (this.canUseLiveBilling()) {
      return;
    }

    const readiness = getStripeBillingIntegrationReadiness();
    throw new ProviderError({
      message:
        readiness.summary.message ||
        "ReplyMate billing is not configured.",
      errorCode: "BILLING_UNAVAILABLE",
      statusCode: 503,
      retryable: false,
      details: {
        provider: "stripe",
        readinessStatus: readiness.status,
      },
    });
  }

  private assertWebhookVerificationAvailable(): void {
    if (this.canVerifyWebhooks()) {
      return;
    }

    throw new ProviderError({
      message:
        "ReplyMate billing webhook verification is not configured. Add a Stripe webhook signing secret to enable webhook processing.",
      errorCode: "BILLING_UNAVAILABLE",
      statusCode: 503,
      retryable: false,
      details: {
        provider: "stripe",
        readinessStatus: getStripeBillingIntegrationReadiness().status,
      },
    });
  }

  getPriceId(): string {
    this.assertLiveBillingAvailable();
    return this.proPriceId;
  }

  async createCustomer(input: { email: string; name?: string }): Promise<StripeCustomer> {
    this.assertLiveBillingAvailable();

    const response = await fetch(`${STRIPE_API_BASE_URL}/customers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: encodeForm({
        email: input.email,
        name: input.name,
      }),
    });

    if (!response.ok) {
      throw await buildStripeRequestError(response, "Stripe customer creation failed.");
    }

    return parseJson<StripeCustomer>(response);
  }

  async createCheckoutSession(input: {
    customerId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<StripeCheckoutSession> {
    this.assertLiveBillingAvailable();

    const response = await fetch(`${STRIPE_API_BASE_URL}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: encodeForm({
        mode: "subscription",
        customer: input.customerId,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        "line_items[0][price]": this.proPriceId,
        "line_items[0][quantity]": "1",
        "allow_promotion_codes": "true",
      }),
    });

    if (!response.ok) {
      throw await buildStripeRequestError(response, "Stripe checkout session creation failed.");
    }

    return parseJson<StripeCheckoutSession>(response);
  }

  async createBillingPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<StripeBillingPortalSession> {
    this.assertLiveBillingAvailable();

    const response = await fetch(`${STRIPE_API_BASE_URL}/billing_portal/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: encodeForm({
        customer: input.customerId,
        return_url: input.returnUrl,
      }),
    });

    if (!response.ok) {
      throw await buildStripeRequestError(
        response,
        "Stripe billing portal session creation failed."
      );
    }

    return parseJson<StripeBillingPortalSession>(response);
  }

  verifyWebhook(input: { rawBody: Buffer; signatureHeader: string }): StripeWebhookEvent {
    this.assertWebhookVerificationAvailable();

    verifyStripeWebhookSignature({
      rawBody: input.rawBody,
      signatureHeader: input.signatureHeader,
      secret: this.webhookSecret,
    });

    try {
      return JSON.parse(input.rawBody.toString("utf8")) as StripeWebhookEvent;
    } catch {
      throw new ProviderError({
        message: "Stripe webhook payload could not be parsed as JSON.",
        errorCode: "BILLING_UNAVAILABLE",
        statusCode: 400,
        retryable: false,
      });
    }
  }
}
