import { describe, expect, it } from "vitest";
import type { AccountSummary } from "@replymate/contracts";
import { ApiError } from "../../core/errors.js";
import type { BillingRepository } from "../../persistence/BillingRepository.js";
import { EntitlementService } from "../EntitlementService.js";
import { requireHostedEntitlement } from "../requireEntitlement.js";

class MemoryBillingRepository implements BillingRepository {
  entitlements = new Map<string, Awaited<ReturnType<EntitlementService["getEntitlement"]>>>();

  async createMagicLink(_input: any) {}
  async getMagicLinkByTokenHash(_tokenHash: string) { return null; }
  async consumeMagicLink(_magicLinkId: string, _consumedAt: string) {}
  async createDeviceAuth(_input: any) {}
  async getDeviceAuthByDeviceCode(_deviceCode: string) { return null; }
  async getDeviceAuthByUserCode(_userCode: string) { return null; }
  async approveDeviceAuth(_input: any) { return null; }
  async consumeDeviceAuth(_deviceCode: string, _consumedAt: string) {}
  async upsertBillingCustomer(_input: any) {}
  async getBillingCustomer(_accountId: string) { return null; }
  async findBillingCustomerByStripeCustomerId() { return null; }
  async upsertSubscription(_input: any) {}
  async getSubscription(_accountId: string) { return null; }
  async findSubscriptionByStripeSubscriptionId() { return null; }
  async updateCheckoutSession(_input: any) {}
  async getCheckoutSession(_checkoutSessionId: string) { return null; }
  async getLatestCheckoutSessionForAccount(_accountId: string) { return null; }
  async hasProcessedWebhookEvent(_eventId: string) { return false; }
  async recordProcessedWebhookEvent(_input: any) {}
  async upsertEntitlement(input: any) {
    this.entitlements.set(input.accountId, {
      accessState: input.accessState,
      canGenerate: input.canGenerate,
      canUseEvidence: input.canUseEvidence,
      requiresUpgrade: input.requiresUpgrade,
      message: input.message,
    });
  }
  async getEntitlement(accountId: string) {
    const current = this.entitlements.get(accountId);
    return current
      ? {
          accountId,
          accessState: current.accessState,
          canGenerate: current.canGenerate,
          canUseEvidence: current.canUseEvidence,
          requiresUpgrade: current.requiresUpgrade,
          message: current.message,
          updatedAt: new Date().toISOString(),
        }
      : null;
  }
  async getBillingSummary(_accountId: string) { return null; }
  async syncAccountBillingState(_input: any) {}
}

function createAccount(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    accountId: "acct_1",
    email: "user@example.com",
    plan: "pro",
    subscriptionState: "inactive",
    betaAccess: false,
    ...overrides,
  };
}

describe("requireHostedEntitlement", () => {
  it("blocks past-due access with SUBSCRIPTION_PAST_DUE", async () => {
    const repository = new MemoryBillingRepository();
    const service = new EntitlementService(repository);
    const account = createAccount({ subscriptionState: "past_due" });

    await expect(
      requireHostedEntitlement({
        account,
        entitlementService: service,
        feature: "generate",
      })
    ).rejects.toMatchObject<ApiError>({
      errorCode: "SUBSCRIPTION_PAST_DUE",
      statusCode: 402,
    });
  });

  it("blocks inactive access with PAYMENT_REQUIRED", async () => {
    const repository = new MemoryBillingRepository();
    const service = new EntitlementService(repository);

    await expect(
      requireHostedEntitlement({
        account: createAccount({ subscriptionState: "inactive" }),
        entitlementService: service,
        feature: "evidence",
      })
    ).rejects.toMatchObject<ApiError>({
      errorCode: "PAYMENT_REQUIRED",
      statusCode: 403,
    });
  });

  it("allows active paid access", async () => {
    const repository = new MemoryBillingRepository();
    const service = new EntitlementService(repository);

    await expect(
      requireHostedEntitlement({
        account: createAccount({ subscriptionState: "active" }),
        entitlementService: service,
        feature: "generate",
      })
    ).resolves.toBeUndefined();
  });
});
