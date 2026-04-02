import type {
  AccountSummary,
  BillingPortalResponse,
  BillingSummary,
  CheckoutSessionResponse,
  SubscriptionState,
} from "@replymate/contracts";
import { resolveDeploymentMode } from "../core/authSession.js";
import { ApiError } from "../core/errors.js";
import type { HostedStateRepository } from "../persistence/HostedStateRepository.js";
import type { BillingRepository } from "../persistence/BillingRepository.js";
import { getStripeBillingIntegrationReadiness } from "./readiness.js";
import { EntitlementService } from "./EntitlementService.js";
import { StripeBillingService } from "./StripeBillingService.js";
import type { StripeWebhookEvent } from "./types.js";

function resolveWebAppBaseUrl(): string {
  return (
    process.env.REPLYMATE_WEB_APP_BASE_URL?.trim() ||
    (resolveDeploymentMode() === "hosted_public"
      ? "https://app.replymate.app"
      : "http://localhost:5173")
  ).replace(/\/+$/, "");
}

function resolveSuccessUrl(successUrl?: string): string {
  return successUrl?.trim() || `${resolveWebAppBaseUrl()}/checkout/success`;
}

function resolveCancelUrl(cancelUrl?: string): string {
  return cancelUrl?.trim() || `${resolveWebAppBaseUrl()}/checkout/cancel`;
}

function resolvePortalReturnUrl(returnUrl?: string): string {
  return returnUrl?.trim() || `${resolveWebAppBaseUrl()}/account`;
}

function mapStripeSubscriptionState(status: string | undefined): SubscriptionState {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "inactive";
  }
}

function readStringField(object: Record<string, unknown>, key: string): string | undefined {
  const value = object[key];
  return typeof value === "string" ? value : undefined;
}

function readBooleanField(object: Record<string, unknown>, key: string): boolean | undefined {
  const value = object[key];
  return typeof value === "boolean" ? value : undefined;
}

function readEpochField(object: Record<string, unknown>, key: string): string | undefined {
  const value = object[key];
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : undefined;
}

function readPriceId(object: Record<string, unknown>): string | undefined {
  const items = object.items;
  if (
    typeof items !== "object" ||
    items === null ||
    !Array.isArray((items as { data?: unknown[] }).data)
  ) {
    return undefined;
  }

  const first = (items as { data: unknown[] }).data[0];
  if (
    typeof first !== "object" ||
    first === null ||
    typeof (first as { price?: unknown }).price !== "object" ||
    (first as { price?: unknown }).price === null
  ) {
    return undefined;
  }

  const price = (first as { price: Record<string, unknown> }).price;
  return typeof price.id === "string" ? price.id : undefined;
}

export class BillingService {
  constructor(
    private readonly billingRepository: BillingRepository,
    private readonly hostedStateRepository: HostedStateRepository,
    private readonly entitlementService: EntitlementService,
    private readonly stripeBillingService: StripeBillingService | null
  ) {}

  private getBillingReadiness() {
    return getStripeBillingIntegrationReadiness();
  }

  private applyBillingReadiness(summary: BillingSummary): BillingSummary {
    const readiness = this.getBillingReadiness();
    return {
      ...summary,
      deploymentMode: resolveDeploymentMode(),
      billingPortalAvailable: readiness.checkoutAvailable && summary.billingPortalAvailable,
      billingReadiness: readiness.summary,
    };
  }

  private requireLiveBilling(): void {
    const readiness = this.getBillingReadiness();
    if (this.stripeBillingService && readiness.checkoutAvailable) {
      return;
    }

    throw new ApiError({
      message:
        readiness.summary.message || "ReplyMate billing is not configured.",
      errorCode: "BILLING_UNAVAILABLE",
      statusCode: 503,
    });
  }

  private requireWebhookVerification(): void {
    const readiness = this.getBillingReadiness();
    if (this.stripeBillingService && readiness.webhookVerificationAvailable) {
      return;
    }

    throw new ApiError({
      message:
        "ReplyMate billing webhook verification is not configured. Add a Stripe webhook signing secret to process billing events.",
      errorCode: "BILLING_UNAVAILABLE",
      statusCode: 503,
    });
  }

  async getSummary(account: AccountSummary): Promise<BillingSummary> {
    const storedSummary = await this.billingRepository.getBillingSummary(account.accountId);
    if (storedSummary) {
      return this.applyBillingReadiness(storedSummary);
    }

    const entitlement = await this.entitlementService.syncAccountEntitlement({ account });
    return this.applyBillingReadiness({
      apiVersion: "v1",
      deploymentMode: resolveDeploymentMode(),
      account,
      entitlement,
      subscription: null,
      plan: account.plan,
      cancelAtPeriodEnd: false,
      billingPortalAvailable: false,
      billingReadiness: this.getBillingReadiness().summary,
    });
  }

  async createCheckoutSession(input: {
    account: AccountSummary;
    successUrl?: string;
    cancelUrl?: string;
  }): Promise<CheckoutSessionResponse> {
    this.requireLiveBilling();

    let customer = await this.billingRepository.getBillingCustomer(input.account.accountId);
    const now = new Date().toISOString();
    if (!customer) {
      const created = await this.stripeBillingService!.createCustomer({
        email: input.account.email,
        name: input.account.displayName,
      });
      customer = {
        accountId: input.account.accountId,
        stripeCustomerId: created.id,
        email: created.email || input.account.email,
        createdAt: now,
        updatedAt: now,
      };
      await this.billingRepository.upsertBillingCustomer(customer);
    }

    const session = await this.stripeBillingService!.createCheckoutSession({
      customerId: customer.stripeCustomerId,
      successUrl: resolveSuccessUrl(input.successUrl),
      cancelUrl: resolveCancelUrl(input.cancelUrl),
    });

    if (!session.url) {
      throw new ApiError({
        message: "Stripe checkout did not return a usable URL.",
        errorCode: "BILLING_UNAVAILABLE",
        statusCode: 502,
      });
    }

    await this.billingRepository.updateCheckoutSession({
      checkoutSessionId: session.id,
      accountId: input.account.accountId,
      stripeCustomerId: customer.stripeCustomerId,
      stripeSubscriptionId: session.subscription || undefined,
      stripePriceId: this.stripeBillingService!.getPriceId(),
      url: session.url,
      state: "open",
      createdAt: now,
      updatedAt: now,
    });

    return {
      apiVersion: "v1",
      deploymentMode: resolveDeploymentMode(),
      url: session.url,
    };
  }

  async createBillingPortal(input: {
    account: AccountSummary;
    returnUrl?: string;
  }): Promise<BillingPortalResponse> {
    this.requireLiveBilling();

    const customer = await this.billingRepository.getBillingCustomer(input.account.accountId);
    if (!customer) {
      throw new ApiError({
        message: "ReplyMate billing is not set up for this account yet.",
        errorCode: "BILLING_UNAVAILABLE",
        statusCode: 400,
      });
    }

    const session = await this.stripeBillingService!.createBillingPortalSession({
      customerId: customer.stripeCustomerId,
      returnUrl: resolvePortalReturnUrl(input.returnUrl),
    });

    return {
      apiVersion: "v1",
      deploymentMode: resolveDeploymentMode(),
      url: session.url,
    };
  }

  async handleWebhook(event: StripeWebhookEvent): Promise<void> {
    this.requireWebhookVerification();

    if (await this.billingRepository.hasProcessedWebhookEvent(event.id)) {
      return;
    }

    const object = event.data.object;
    const now = new Date().toISOString();

    switch (event.type) {
      case "checkout.session.completed": {
        const checkoutSessionId = readStringField(object, "id");
        if (!checkoutSessionId) break;
        const existing = await this.billingRepository.getCheckoutSession(checkoutSessionId);
        if (!existing) break;
        await this.billingRepository.updateCheckoutSession({
          ...existing,
          stripeSubscriptionId: readStringField(object, "subscription") || existing.stripeSubscriptionId,
          state: "completed",
          updatedAt: now,
        });
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const customerId = readStringField(object, "customer");
        const subscriptionId = readStringField(object, "id");
        if (!customerId || !subscriptionId) break;
        const customer = await this.billingRepository.findBillingCustomerByStripeCustomerId(customerId);
        if (!customer) break;
        const account = await this.hostedStateRepository.getAccount(customer.accountId);
        if (!account) break;
        const nextState = mapStripeSubscriptionState(readStringField(object, "status"));
        await this.billingRepository.upsertSubscription({
          accountId: account.accountId,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          stripePriceId: readPriceId(object) || this.stripeBillingService!.getPriceId(),
          plan: "pro",
          subscriptionState: nextState,
          trialEndsAt: readEpochField(object, "trial_end"),
          currentPeriodEndsAt: readEpochField(object, "current_period_end"),
          cancelAtPeriodEnd: Boolean(readBooleanField(object, "cancel_at_period_end")),
          createdAt: now,
          updatedAt: now,
        });
        await this.billingRepository.syncAccountBillingState({
          accountId: account.accountId,
          plan: "pro",
          subscriptionState: nextState,
          betaAccess: account.betaAccess,
        });
        const updatedAccount = {
          ...account,
          plan: "pro" as const,
          subscriptionState: nextState,
        };
        await this.entitlementService.syncAccountEntitlement({
          account: updatedAccount,
          subscriptionState: nextState,
        });
        break;
      }

      case "invoice.payment_failed":
      case "invoice.paid": {
        const customerId = readStringField(object, "customer");
        if (!customerId) break;
        const customer = await this.billingRepository.findBillingCustomerByStripeCustomerId(customerId);
        if (!customer) break;
        const account = await this.hostedStateRepository.getAccount(customer.accountId);
        if (!account) break;
        const nextState: SubscriptionState =
          event.type === "invoice.payment_failed" ? "past_due" : "active";
        await this.billingRepository.syncAccountBillingState({
          accountId: account.accountId,
          plan: account.plan === "beta" ? "pro" : account.plan,
          subscriptionState: nextState,
          betaAccess: account.betaAccess,
        });
        const subscription = await this.billingRepository.getSubscription(account.accountId);
        if (subscription) {
          await this.billingRepository.upsertSubscription({
            ...subscription,
            subscriptionState: nextState,
            updatedAt: now,
          });
        }
        await this.entitlementService.syncAccountEntitlement({
          account: {
            ...account,
            plan: account.plan === "beta" ? "pro" : account.plan,
            subscriptionState: nextState,
          },
          subscriptionState: nextState,
        });
        break;
      }

      default:
        break;
    }

    await this.billingRepository.recordProcessedWebhookEvent({
      eventId: event.id,
      eventType: event.type,
      receivedAt: new Date(event.created * 1000).toISOString(),
      processedAt: now,
    });
  }
}
