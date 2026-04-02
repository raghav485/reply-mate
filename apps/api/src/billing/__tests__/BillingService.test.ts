import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountSummary, BillingSummary } from "@replymate/contracts";
import type { HostedStateRepository } from "../../persistence/HostedStateRepository.js";
import type { BillingRepository } from "../../persistence/BillingRepository.js";
import { BillingService } from "../BillingService.js";
import { EntitlementService } from "../EntitlementService.js";
import type { StripeWebhookEvent } from "../types.js";

function createAccount(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    accountId: "acct_paid_1",
    email: "paid@example.com",
    plan: "pro",
    subscriptionState: "inactive",
    betaAccess: false,
    ...overrides,
  };
}

function createBillingRepositoryStub(): { repo: BillingRepository; state: {
  summary: BillingSummary | null;
  customer: any;
  subscription: any;
  checkout: any;
  processed: Set<string>;
  entitlements: any[];
  syncCalls: any[];
  recordedEvents: any[];
} } {
  const state = {
    summary: null as BillingSummary | null,
    customer: null as any,
    subscription: null as any,
    checkout: null as any,
    processed: new Set<string>(),
    entitlements: [] as any[],
    syncCalls: [] as any[],
    recordedEvents: [] as any[],
  };

  const repo: BillingRepository = {
    createMagicLink: async () => undefined,
    getMagicLinkByTokenHash: async () => null,
    consumeMagicLink: async () => undefined,
    createDeviceAuth: async () => undefined,
    getDeviceAuthByDeviceCode: async () => null,
    getDeviceAuthByUserCode: async () => null,
    approveDeviceAuth: async () => null,
    consumeDeviceAuth: async () => undefined,
    upsertBillingCustomer: async (input) => {
      state.customer = input;
    },
    getBillingCustomer: async () => state.customer,
    findBillingCustomerByStripeCustomerId: async (stripeCustomerId) =>
      state.customer?.stripeCustomerId === stripeCustomerId ? state.customer : null,
    upsertSubscription: async (input) => {
      state.subscription = input;
    },
    getSubscription: async () => state.subscription,
    findSubscriptionByStripeSubscriptionId: async (stripeSubscriptionId) =>
      state.subscription?.stripeSubscriptionId === stripeSubscriptionId
        ? state.subscription
        : null,
    updateCheckoutSession: async (input) => {
      state.checkout = input;
    },
    getCheckoutSession: async () => state.checkout,
    getLatestCheckoutSessionForAccount: async () => state.checkout,
    hasProcessedWebhookEvent: async (eventId) => state.processed.has(eventId),
    recordProcessedWebhookEvent: async (input) => {
      state.processed.add(input.eventId);
      state.recordedEvents.push(input);
    },
    upsertEntitlement: async (input) => {
      state.entitlements.push(input);
    },
    getEntitlement: async () => null,
    getBillingSummary: async () => state.summary,
    syncAccountBillingState: async (input) => {
      state.syncCalls.push(input);
    },
  };

  return { repo, state };
}

function createHostedStateRepositoryStub(account: AccountSummary): HostedStateRepository {
  return {
    upsertAccount: async () => account,
    getAccount: async () => account,
    findAccountByEmail: async (email) => (email === account.email ? account : null),
    createSession: async () => {
      throw new Error("not needed");
    },
    getSession: async () => null,
    getSessionByRefreshTokenHash: async () => null,
    touchSession: async () => undefined,
    revokeSession: async () => undefined,
    getAccountPreferences: async () => ({
      defaultTonePreset: "professional",
      defaultCostMode: "cloud_quality",
    }),
    saveAccountPreferences: async (_accountId, preferences) => preferences,
    createEvidenceJob: async () => undefined,
    getEvidenceJob: async () => null,
    updateEvidenceJob: async () => null,
    listIncompleteEvidenceJobs: async () => [],
    appendGenerationRecord: async () => undefined,
    listGenerationRecords: async () => [],
  };
}

describe("BillingService", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns stored summaries with the active deployment mode", async () => {
    vi.stubEnv("REPLYMATE_DEPLOYMENT_MODE", "hosted_beta");
    const { repo, state } = createBillingRepositoryStub();
    const summary: BillingSummary = {
      apiVersion: "v1",
      deploymentMode: "hosted_public",
      account: createAccount({ subscriptionState: "active" }),
      entitlement: {
        accessState: "active",
        canGenerate: true,
        canUseEvidence: true,
        requiresUpgrade: false,
        message: "Subscription access is active.",
      },
      subscription: {
        provider: "stripe",
        status: "active",
        customerId: "cus_123",
        subscriptionId: "sub_123",
        priceId: "price_123",
      },
      plan: "pro",
      cancelAtPeriodEnd: false,
      billingPortalAvailable: true,
      billingReadiness: {
        status: "configured",
        checkoutAvailable: true,
      },
    };
    state.summary = summary;

    const service = new BillingService(
      repo,
      createHostedStateRepositoryStub(summary.account),
      new EntitlementService(repo),
      null
    );

    const result = await service.getSummary(summary.account);
    expect(result.deploymentMode).toBe("hosted_beta");
    expect(result.plan).toBe("pro");
    expect(result.billingPortalAvailable).toBe(false);
    expect(result.billingReadiness.status).toBe("unconfigured");
  });

  it("returns a clear error when billing portal is requested before a customer exists", async () => {
    vi.stubEnv("REPLYMATE_STRIPE_SECRET_KEY", "sk_test_replymate");
    vi.stubEnv("REPLYMATE_STRIPE_WEBHOOK_SECRET", "whsec_replymate");
    vi.stubEnv("REPLYMATE_STRIPE_PRO_PRICE_ID", "price_replymate_pro");
    const { repo } = createBillingRepositoryStub();
    const account = createAccount({ subscriptionState: "inactive" });
    const service = new BillingService(
      repo,
      createHostedStateRepositoryStub(account),
      new EntitlementService(repo),
      {
        createBillingPortalSession: vi.fn(),
      } as any
    );

    await expect(
      service.createBillingPortal({ account })
    ).rejects.toMatchObject({
      errorCode: "BILLING_UNAVAILABLE",
      statusCode: 400,
    });
  });

  it("updates subscription and entitlement state from Stripe webhook events", async () => {
    vi.stubEnv("REPLYMATE_STRIPE_WEBHOOK_SECRET", "whsec_replymate");
    const { repo, state } = createBillingRepositoryStub();
    const account = createAccount({ subscriptionState: "inactive" });
    await repo.upsertBillingCustomer({
      accountId: account.accountId,
      stripeCustomerId: "cus_replymate",
      email: account.email,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const service = new BillingService(
      repo,
      createHostedStateRepositoryStub(account),
      new EntitlementService(repo),
      {
        getPriceId: () => "price_replymate_pro",
      } as any
    );

    const event: StripeWebhookEvent = {
      id: "evt_subscription_active",
      type: "customer.subscription.updated",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: "sub_replymate",
          customer: "cus_replymate",
          status: "active",
          current_period_end: Math.floor(Date.now() / 1000) + 86_400,
          cancel_at_period_end: false,
          items: {
            data: [
              {
                price: {
                  id: "price_replymate_pro",
                },
              },
            ],
          },
        },
      },
    };

    await service.handleWebhook(event);

    expect(state.subscription.subscriptionState).toBe("active");
    expect(state.syncCalls[0]).toMatchObject({
      accountId: account.accountId,
      subscriptionState: "active",
    });
    expect(state.recordedEvents).toHaveLength(1);
    expect(state.entitlements.at(-1)?.accessState).toBe("active");
  });

  it("ignores duplicate webhook events", async () => {
    vi.stubEnv("REPLYMATE_STRIPE_WEBHOOK_SECRET", "whsec_replymate");
    const { repo, state } = createBillingRepositoryStub();
    const account = createAccount();
    state.processed.add("evt_duplicate");
    const service = new BillingService(
      repo,
      createHostedStateRepositoryStub(account),
      new EntitlementService(repo),
      {
        getPriceId: () => "price_replymate_pro",
      } as any
    );

    await service.handleWebhook({
      id: "evt_duplicate",
      type: "invoice.payment_failed",
      created: Math.floor(Date.now() / 1000),
      data: { object: { customer: "cus_replymate" } },
    });

    expect(state.recordedEvents).toHaveLength(0);
  });
});
