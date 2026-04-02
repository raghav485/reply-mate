import type {
  AccountPlan,
  BillingSummary,
  SubscriptionState,
} from "@replymate/contracts";
import type {
  PersistedAccountEntitlement,
  PersistedBillingCustomer,
  PersistedBillingSubscription,
  PersistedCheckoutSession,
  PersistedDeviceAuth,
  PersistedMagicLink,
} from "./billingTypes.js";

export interface BillingRepository {
  createMagicLink(input: PersistedMagicLink): Promise<void>;
  getMagicLinkByTokenHash(tokenHash: string): Promise<PersistedMagicLink | null>;
  consumeMagicLink(magicLinkId: string, consumedAt: string): Promise<void>;
  createDeviceAuth(input: PersistedDeviceAuth): Promise<void>;
  getDeviceAuthByDeviceCode(deviceCode: string): Promise<PersistedDeviceAuth | null>;
  getDeviceAuthByUserCode(userCode: string): Promise<PersistedDeviceAuth | null>;
  approveDeviceAuth(input: {
    userCode: string;
    accountId: string;
    approvedAt: string;
  }): Promise<PersistedDeviceAuth | null>;
  consumeDeviceAuth(deviceCode: string, consumedAt: string): Promise<void>;
  upsertBillingCustomer(input: PersistedBillingCustomer): Promise<void>;
  getBillingCustomer(accountId: string): Promise<PersistedBillingCustomer | null>;
  findBillingCustomerByStripeCustomerId(stripeCustomerId: string): Promise<PersistedBillingCustomer | null>;
  upsertSubscription(input: PersistedBillingSubscription): Promise<void>;
  getSubscription(accountId: string): Promise<PersistedBillingSubscription | null>;
  findSubscriptionByStripeSubscriptionId(
    stripeSubscriptionId: string
  ): Promise<PersistedBillingSubscription | null>;
  updateCheckoutSession(input: PersistedCheckoutSession): Promise<void>;
  getCheckoutSession(checkoutSessionId: string): Promise<PersistedCheckoutSession | null>;
  getLatestCheckoutSessionForAccount(accountId: string): Promise<PersistedCheckoutSession | null>;
  hasProcessedWebhookEvent(eventId: string): Promise<boolean>;
  recordProcessedWebhookEvent(input: {
    eventId: string;
    eventType: string;
    receivedAt: string;
    processedAt: string;
  }): Promise<void>;
  upsertEntitlement(input: PersistedAccountEntitlement): Promise<void>;
  getEntitlement(accountId: string): Promise<PersistedAccountEntitlement | null>;
  getBillingSummary(accountId: string): Promise<BillingSummary | null>;
  syncAccountBillingState(input: {
    accountId: string;
    plan: AccountPlan;
    subscriptionState: SubscriptionState;
    betaAccess: boolean;
  }): Promise<void>;
}
