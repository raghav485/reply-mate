import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../apps/api/src/bootstrap/loadEnv.js";
import { buildStripeWebhookSignatureHeader } from "../apps/api/src/billing/stripeWebhookSignature.js";
import { closeSharedDatabasePool } from "../apps/api/src/persistence/db.js";
import { createBillingRepository, createHostedStateRepository } from "../apps/api/src/persistence/index.js";

type FixtureName =
  | "checkout.session.completed"
  | "customer.subscription.created"
  | "customer.subscription.trialing"
  | "customer.subscription.active"
  | "customer.subscription.deleted"
  | "invoice.payment_failed"
  | "invoice.paid";

type PlaceholderContext = Record<string, string | number>;

type StripeWebhookPostResult = {
  fixtureName: FixtureName;
  status: number;
  responseText: string;
};

const FIXTURE_FILES: Record<FixtureName, string> = {
  "checkout.session.completed": "checkout.session.completed.json",
  "customer.subscription.created": "customer.subscription.created.json",
  "customer.subscription.trialing": "customer.subscription.trialing.json",
  "customer.subscription.active": "customer.subscription.active.json",
  "customer.subscription.deleted": "customer.subscription.deleted.json",
  "invoice.payment_failed": "invoice.payment_failed.json",
  "invoice.paid": "invoice.paid.json",
};

function resolveFixturePath(fixtureName: FixtureName): string {
  return path.join(
    process.cwd(),
    "scripts",
    "fixtures",
    "stripe",
    FIXTURE_FILES[fixtureName]
  );
}

function parseArgs(argv: string[]): {
  fixtureName: FixtureName;
  accountEmail?: string;
  baseUrl: string;
  subscriptionId?: string;
  checkoutSessionId?: string;
  customerId?: string;
} {
  const fixtureName = argv[0] as FixtureName | undefined;
  if (!fixtureName || !(fixtureName in FIXTURE_FILES)) {
    throw new Error(
      `Usage: npm run post:stripe:webhook -- <fixture-name> [--email you@example.com] [--base-url http://localhost:3000]`
    );
  }

  const options = {
    fixtureName,
    baseUrl: (process.env.REPLYMATE_VERIFY_HOSTED_BASE_URL || "http://localhost:3000")
      .trim()
      .replace(/\/+$/, ""),
  } as {
    fixtureName: FixtureName;
    accountEmail?: string;
    baseUrl: string;
    subscriptionId?: string;
    checkoutSessionId?: string;
    customerId?: string;
  };

  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || value === undefined) {
      throw new Error(`Invalid argument sequence near ${flag || "<end>"}.`);
    }
    if (flag === "--email") {
      options.accountEmail = value.trim().toLowerCase();
      continue;
    }
    if (flag === "--base-url") {
      options.baseUrl = value.trim().replace(/\/+$/, "");
      continue;
    }
    if (flag === "--subscription-id") {
      options.subscriptionId = value.trim();
      continue;
    }
    if (flag === "--checkout-session-id") {
      options.checkoutSessionId = value.trim();
      continue;
    }
    if (flag === "--customer-id") {
      options.customerId = value.trim();
      continue;
    }
    throw new Error(`Unknown argument: ${flag}`);
  }

  return options;
}

function replacePlaceholders(template: string, context: PlaceholderContext): string {
  let output = template;
  for (const [key, value] of Object.entries(context)) {
    output = output.replaceAll(`__${key}__`, String(value));
  }
  return output;
}

async function resolvePlaceholderContext(input: {
  accountEmail?: string;
  fixtureName: FixtureName;
  subscriptionId?: string;
  checkoutSessionId?: string;
  customerId?: string;
}): Promise<PlaceholderContext> {
  const hostedStateRepository = createHostedStateRepository();
  const billingRepository = createBillingRepository();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const currentPeriodEnd = nowSeconds + 14 * 24 * 60 * 60;
  const trialEnd = nowSeconds + 7 * 24 * 60 * 60;
  const fallbackSubscriptionId =
    input.subscriptionId || `sub_replymate_fixture_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const context: PlaceholderContext = {
    EVENT_ID: `evt_replymate_${randomUUID().replace(/-/g, "")}`,
    EVENT_CREATED: nowSeconds,
    CURRENT_PERIOD_END: currentPeriodEnd,
    TRIAL_END: trialEnd,
    STRIPE_PRICE_ID:
      process.env.REPLYMATE_STRIPE_PRO_PRICE_ID?.trim() || "price_replymate_fixture_pro",
    STRIPE_SUBSCRIPTION_ID: fallbackSubscriptionId,
    STRIPE_CUSTOMER_ID: input.customerId || `cus_replymate_fixture_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    CHECKOUT_SESSION_ID:
      input.checkoutSessionId ||
      `cs_test_replymate_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
  };

  if (!input.accountEmail) {
    return context;
  }

  const account = await hostedStateRepository.findAccountByEmail(input.accountEmail);
  if (!account) {
    throw new Error(`No ReplyMate account exists for ${input.accountEmail}.`);
  }

  const customer = await billingRepository.getBillingCustomer(account.accountId);
  if (customer) {
    context.STRIPE_CUSTOMER_ID = customer.stripeCustomerId;
  }

  const latestCheckout = await billingRepository.getLatestCheckoutSessionForAccount(account.accountId);
  if (latestCheckout) {
    context.CHECKOUT_SESSION_ID = latestCheckout.checkoutSessionId;
    context.STRIPE_SUBSCRIPTION_ID =
      latestCheckout.stripeSubscriptionId || context.STRIPE_SUBSCRIPTION_ID;
  }

  const subscription = await billingRepository.getSubscription(account.accountId);
  if (subscription) {
    context.STRIPE_SUBSCRIPTION_ID = subscription.stripeSubscriptionId;
    context.STRIPE_PRICE_ID = subscription.stripePriceId;
    if (subscription.currentPeriodEndsAt) {
      context.CURRENT_PERIOD_END = Math.floor(
        new Date(subscription.currentPeriodEndsAt).getTime() / 1000
      );
    }
    if (subscription.trialEndsAt) {
      context.TRIAL_END = Math.floor(new Date(subscription.trialEndsAt).getTime() / 1000);
    }
  }

  if (
    input.fixtureName !== "checkout.session.completed" &&
    !customer &&
    !input.customerId
  ) {
    throw new Error(
      `No Stripe customer exists for ${input.accountEmail}. Create one with live checkout or run npm run verify:billing in fixture mode first.`
    );
  }

  return context;
}

export async function postStripeWebhookFixture(input: {
  fixtureName: FixtureName;
  baseUrl?: string;
  accountEmail?: string;
  subscriptionId?: string;
  checkoutSessionId?: string;
  customerId?: string;
}): Promise<StripeWebhookPostResult> {
  loadLocalEnv();
  const webhookSecret = process.env.REPLYMATE_STRIPE_WEBHOOK_SECRET?.trim() || "";
  if (!webhookSecret) {
    throw new Error("REPLYMATE_STRIPE_WEBHOOK_SECRET is required to post Stripe fixtures.");
  }

  const context = await resolvePlaceholderContext({
    accountEmail: input.accountEmail,
    fixtureName: input.fixtureName,
    subscriptionId: input.subscriptionId,
    checkoutSessionId: input.checkoutSessionId,
    customerId: input.customerId,
  });
  const template = await readFile(resolveFixturePath(input.fixtureName), "utf8");
  const rawBody = Buffer.from(replacePlaceholders(template, context), "utf8");
  const signatureHeader = buildStripeWebhookSignatureHeader({
    rawBody,
    secret: webhookSecret,
  });
  const baseUrl = (input.baseUrl || process.env.REPLYMATE_VERIFY_HOSTED_BASE_URL || "http://localhost:3000")
    .trim()
    .replace(/\/+$/, "");

  const response = await fetch(`${baseUrl}/v1/billing/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": signatureHeader,
    },
    body: rawBody,
  });

  return {
    fixtureName: input.fixtureName,
    status: response.status,
    responseText: await response.text(),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await postStripeWebhookFixture(options);
  if (result.status >= 400) {
    throw new Error(
      `[${result.fixtureName}] webhook failed with ${result.status}: ${result.responseText}`
    );
  }
  console.log(`[${result.fixtureName}] webhook accepted with ${result.status}`);
}

const isEntryPoint =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  void main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeSharedDatabasePool().catch(() => undefined);
    });
}
