import { describe, expect, it, vi } from "vitest";
import { PostgresBillingRepository } from "../PostgresBillingRepository.js";

describe("PostgresBillingRepository", () => {
  it("marks billing portal as available when a billing customer exists without a subscription", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            account_id: "acct_1",
            email: "user@example.com",
            plan: "pro",
            subscription_state: "inactive",
            beta_access: false,
            display_name: null,
            access_state: "inactive",
            can_generate: false,
            can_use_evidence: false,
            requires_upgrade: true,
            entitlement_message: "Upgrade to continue.",
            billing_customer_id: "cus_replymate",
            stripe_customer_id: null,
            stripe_subscription_id: null,
            stripe_price_id: null,
            trial_ends_at: null,
            current_period_ends_at: null,
            cancel_at_period_end: null,
          },
        ],
      });

    const repository = new PostgresBillingRepository({ query } as any);
    const summary = await repository.getBillingSummary("acct_1");

    expect(summary?.billingPortalAvailable).toBe(true);
    expect(summary?.subscription).toBeNull();
  });

  it("returns the newest checkout session for an account", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          checkout_session_id: "cs_new",
          account_id: "acct_1",
          stripe_customer_id: "cus_1",
          stripe_subscription_id: null,
          stripe_price_id: "price_1",
          url: "https://checkout.stripe.com/c/pay/cs_new",
          state: "open",
          created_at: "2026-03-27T00:00:00.000Z",
          updated_at: "2026-03-27T00:00:00.000Z",
        },
      ],
    });

    const repository = new PostgresBillingRepository({ query } as any);
    const checkout = await repository.getLatestCheckoutSessionForAccount("acct_1");

    expect(checkout?.checkoutSessionId).toBe("cs_new");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("ORDER BY created_at DESC"), [
      "acct_1",
    ]);
  });
});
