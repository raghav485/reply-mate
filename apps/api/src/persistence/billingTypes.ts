import type {
  AccountAccessState,
  AccountPlan,
  BillingSummary,
  SubscriptionState,
} from "@replymate/contracts";

export type PersistedBillingCustomer = {
  accountId: string;
  stripeCustomerId: string;
  email: string;
  createdAt: string;
  updatedAt: string;
};

export type PersistedBillingSubscription = {
  accountId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  plan: AccountPlan;
  subscriptionState: SubscriptionState;
  trialEndsAt?: string;
  currentPeriodEndsAt?: string;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PersistedCheckoutSession = {
  checkoutSessionId: string;
  accountId: string;
  stripeCustomerId: string;
  stripeSubscriptionId?: string;
  stripePriceId: string;
  url: string;
  state: "open" | "completed" | "expired";
  createdAt: string;
  updatedAt: string;
};

export type PersistedWebhookEvent = {
  eventId: string;
  eventType: string;
  receivedAt: string;
  processedAt: string;
};

export type PersistedAccountEntitlement = {
  accountId: string;
  accessState: AccountAccessState;
  canGenerate: boolean;
  canUseEvidence: boolean;
  requiresUpgrade: boolean;
  message: string;
  updatedAt: string;
};

export type PersistedMagicLink = {
  magicLinkId: string;
  email: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  consumedAt?: string;
};

export type PersistedDeviceAuth = {
  deviceCode: string;
  userCode: string;
  client?: string;
  expiresAt: string;
  createdAt: string;
  approvedAt?: string;
  deniedAt?: string;
  consumedAt?: string;
  accountId?: string;
};

export type BillingSnapshot = {
  billingSummary: BillingSummary;
};
