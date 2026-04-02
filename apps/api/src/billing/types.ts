export type StripeCheckoutSession = {
  id: string;
  url: string | null;
  customer: string | null;
  subscription: string | null;
};

export type StripeBillingPortalSession = {
  url: string;
};

export type StripeCustomer = {
  id: string;
  email: string | null;
};

export type StripeWebhookEvent = {
  id: string;
  type: string;
  created: number;
  data: {
    object: Record<string, unknown>;
  };
};
