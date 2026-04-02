import type { BillingReadinessSummary } from "@replymate/contracts";

type BillingEnvField = "secretKey" | "webhookSecret" | "priceId";
type BillingVerificationMode = "none" | "fixture_only" | "live" | "invalid_partial";

const BILLING_ENV_VARS: Record<BillingEnvField, string> = {
  secretKey: "REPLYMATE_STRIPE_SECRET_KEY",
  webhookSecret: "REPLYMATE_STRIPE_WEBHOOK_SECRET",
  priceId: "REPLYMATE_STRIPE_PRO_PRICE_ID",
};

function hasEnvValue(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export type StripeBillingIntegrationReadiness = {
  status: BillingReadinessSummary["status"];
  verificationMode: BillingVerificationMode;
  checkoutAvailable: boolean;
  webhookVerificationAvailable: boolean;
  missingFields: BillingEnvField[];
  summary: BillingReadinessSummary;
};

function resolveVerificationMode(input: {
  hasSecretKey: boolean;
  hasWebhookSecret: boolean;
  hasPriceId: boolean;
}): BillingVerificationMode {
  if (input.hasWebhookSecret && input.hasSecretKey && input.hasPriceId) {
    return "live";
  }
  if (input.hasWebhookSecret && !input.hasSecretKey) {
    return "fixture_only";
  }
  if (!input.hasWebhookSecret && !input.hasSecretKey && !input.hasPriceId) {
    return "none";
  }
  return "invalid_partial";
}

function buildSummary(input: {
  verificationMode: BillingVerificationMode;
  checkoutAvailable: boolean;
}): BillingReadinessSummary {
  switch (input.verificationMode) {
    case "live":
      return {
        status: "configured",
        checkoutAvailable: input.checkoutAvailable,
      };
    case "fixture_only":
      return {
        status: "partial",
        checkoutAvailable: false,
        message:
          "ReplyMate billing can verify webhook-driven state changes locally, but live Stripe checkout and billing portal are not configured.",
      };
    case "invalid_partial":
      return {
        status: "partial",
        checkoutAvailable: false,
        message:
          "ReplyMate billing is partially configured. Complete the Stripe secret key, webhook secret, and price configuration before using checkout or billing portal.",
      };
    case "none":
    default:
      return {
        status: "unconfigured",
        checkoutAvailable: false,
        message:
          "ReplyMate billing is not configured. Checkout and billing portal are unavailable until Stripe settings are added.",
      };
  }
}

export function getStripeBillingIntegrationReadiness(): StripeBillingIntegrationReadiness {
  const hasSecretKey = hasEnvValue(BILLING_ENV_VARS.secretKey);
  const hasWebhookSecret = hasEnvValue(BILLING_ENV_VARS.webhookSecret);
  const hasPriceId = hasEnvValue(BILLING_ENV_VARS.priceId);
  const verificationMode = resolveVerificationMode({
    hasSecretKey,
    hasWebhookSecret,
    hasPriceId,
  });
  const missingFields = (Object.entries(BILLING_ENV_VARS) as [BillingEnvField, string][])
    .filter(([, envName]) => !hasEnvValue(envName))
    .map(([field]) => field);
  const checkoutAvailable = verificationMode === "live";

  return {
    status:
      verificationMode === "live"
        ? "configured"
        : verificationMode === "none"
          ? "unconfigured"
          : "partial",
    verificationMode,
    checkoutAvailable,
    webhookVerificationAvailable: hasWebhookSecret,
    missingFields,
    summary: buildSummary({
      verificationMode,
      checkoutAvailable,
    }),
  };
}

export function mapMissingBillingEnvFieldsToNames(
  fields: BillingEnvField[]
): string[] {
  return fields.map((field) => BILLING_ENV_VARS[field]);
}
