import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "../../core/errors.js";
import { StripeBillingService } from "../StripeBillingService.js";
import { buildStripeWebhookSignatureHeader } from "../stripeWebhookSignature.js";

describe("StripeBillingService", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function createService(): StripeBillingService {
    vi.stubEnv("REPLYMATE_STRIPE_SECRET_KEY", "sk_test_replymate");
    vi.stubEnv("REPLYMATE_STRIPE_WEBHOOK_SECRET", "whsec_replymate");
    vi.stubEnv("REPLYMATE_STRIPE_PRO_PRICE_ID", "price_replymate_pro");
    return new StripeBillingService();
  }

  function createWebhookOnlyService(): StripeBillingService {
    vi.stubEnv("REPLYMATE_STRIPE_WEBHOOK_SECRET", "whsec_replymate");
    return new StripeBillingService();
  }

  it("verifies webhook payloads with a valid Stripe signature", () => {
    const service = createService();
    const rawBody = Buffer.from(
      JSON.stringify({
        id: "evt_replymate",
        type: "invoice.paid",
        created: 1_710_000_000,
        data: { object: { customer: "cus_123" } },
      }),
      "utf8"
    );

    const signatureHeader = buildStripeWebhookSignatureHeader({
      rawBody,
      secret: "whsec_replymate",
      timestamp: 1_710_000_000,
    });

    expect(service.verifyWebhook({ rawBody, signatureHeader }).type).toBe("invoice.paid");
  });

  it("rejects invalid webhook signatures", () => {
    const service = createService();
    const rawBody = Buffer.from(
      JSON.stringify({
        id: "evt_replymate_invalid",
        type: "invoice.payment_failed",
        created: 1_710_000_000,
        data: { object: { customer: "cus_123" } },
      }),
      "utf8"
    );

    expect(() =>
      service.verifyWebhook({
        rawBody,
        signatureHeader: "t=1710000000,v1=invalid",
      })
    ).toThrowError(ProviderError);
  });

  it("supports fixture-mode webhook verification with only the webhook secret configured", () => {
    const service = createWebhookOnlyService();
    const rawBody = Buffer.from(
      JSON.stringify({
        id: "evt_replymate_fixture",
        type: "customer.subscription.updated",
        created: 1_710_000_000,
        data: { object: { customer: "cus_fixture" } },
      }),
      "utf8"
    );

    const signatureHeader = buildStripeWebhookSignatureHeader({
      rawBody,
      secret: "whsec_replymate",
      timestamp: 1_710_000_000,
    });

    expect(service.verifyWebhook({ rawBody, signatureHeader }).type).toBe(
      "customer.subscription.updated"
    );
  });

  it("fails live checkout creation clearly when Stripe live billing is not configured", async () => {
    const service = createWebhookOnlyService();

    await expect(
      service.createCheckoutSession({
        customerId: "cus_replymate",
        successUrl: "http://localhost:5173/checkout/success",
        cancelUrl: "http://localhost:5173/checkout/cancel",
      })
    ).rejects.toMatchObject({
      errorCode: "BILLING_UNAVAILABLE",
      statusCode: 503,
    });
  });

  it("surfaces Stripe API error detail on checkout failure", async () => {
    const service = createService();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 402,
        json: async () => ({
          error: {
            type: "card_error",
            code: "card_declined",
            message: "Your card was declined.",
          },
        }),
      }) as Response)
    );

    await expect(
      service.createCheckoutSession({
        customerId: "cus_replymate",
        successUrl: "http://localhost:5173/checkout/success",
        cancelUrl: "http://localhost:5173/checkout/cancel",
      })
    ).rejects.toMatchObject({
      errorCode: "BILLING_UNAVAILABLE",
      message: expect.stringContaining("card_declined"),
    });
  });
});
