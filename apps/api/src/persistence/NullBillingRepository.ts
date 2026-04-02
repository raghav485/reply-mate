import type { BillingSummary } from "@replymate/contracts";
import type { BillingRepository } from "./BillingRepository.js";
import type {
  PersistedAccountEntitlement,
  PersistedBillingCustomer,
  PersistedBillingSubscription,
  PersistedCheckoutSession,
  PersistedDeviceAuth,
  PersistedMagicLink,
} from "./billingTypes.js";

export class NullBillingRepository implements BillingRepository {
  async createMagicLink(_input: PersistedMagicLink): Promise<void> {}
  async getMagicLinkByTokenHash(_tokenHash: string): Promise<PersistedMagicLink | null> {
    return null;
  }
  async consumeMagicLink(_magicLinkId: string, _consumedAt: string): Promise<void> {}
  async createDeviceAuth(_input: PersistedDeviceAuth): Promise<void> {}
  async getDeviceAuthByDeviceCode(_deviceCode: string): Promise<PersistedDeviceAuth | null> {
    return null;
  }
  async getDeviceAuthByUserCode(_userCode: string): Promise<PersistedDeviceAuth | null> {
    return null;
  }
  async approveDeviceAuth(_input: {
    userCode: string;
    accountId: string;
    approvedAt: string;
  }): Promise<PersistedDeviceAuth | null> {
    return null;
  }
  async consumeDeviceAuth(_deviceCode: string, _consumedAt: string): Promise<void> {}
  async upsertBillingCustomer(_input: PersistedBillingCustomer): Promise<void> {}
  async getBillingCustomer(_accountId: string): Promise<PersistedBillingCustomer | null> {
    return null;
  }
  async findBillingCustomerByStripeCustomerId(
    _stripeCustomerId: string
  ): Promise<PersistedBillingCustomer | null> {
    return null;
  }
  async upsertSubscription(_input: PersistedBillingSubscription): Promise<void> {}
  async getSubscription(_accountId: string): Promise<PersistedBillingSubscription | null> {
    return null;
  }
  async findSubscriptionByStripeSubscriptionId(
    _stripeSubscriptionId: string
  ): Promise<PersistedBillingSubscription | null> {
    return null;
  }
  async updateCheckoutSession(_input: PersistedCheckoutSession): Promise<void> {}
  async getCheckoutSession(_checkoutSessionId: string): Promise<PersistedCheckoutSession | null> {
    return null;
  }
  async getLatestCheckoutSessionForAccount(
    _accountId: string
  ): Promise<PersistedCheckoutSession | null> {
    return null;
  }
  async hasProcessedWebhookEvent(_eventId: string): Promise<boolean> {
    return false;
  }
  async recordProcessedWebhookEvent(_input: {
    eventId: string;
    eventType: string;
    receivedAt: string;
    processedAt: string;
  }): Promise<void> {}
  async upsertEntitlement(_input: PersistedAccountEntitlement): Promise<void> {}
  async getEntitlement(_accountId: string): Promise<PersistedAccountEntitlement | null> {
    return null;
  }
  async getBillingSummary(_accountId: string): Promise<BillingSummary | null> {
    return null;
  }
  async syncAccountBillingState(_input: {
    accountId: string;
    plan: BillingSummary["plan"];
    subscriptionState: BillingSummary["account"]["subscriptionState"];
    betaAccess: boolean;
  }): Promise<void> {}
}
