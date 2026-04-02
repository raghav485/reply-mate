import type { BillingSummary } from "@replymate/contracts";
import type { Pool } from "pg";
import type { BillingRepository } from "./BillingRepository.js";
import type {
  PersistedAccountEntitlement,
  PersistedBillingCustomer,
  PersistedBillingSubscription,
  PersistedCheckoutSession,
  PersistedDeviceAuth,
  PersistedMagicLink,
} from "./billingTypes.js";

type MagicLinkRow = {
  magic_link_id: string;
  email: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  consumed_at: string | null;
};

type DeviceAuthRow = {
  device_code: string;
  user_code: string;
  client: string | null;
  expires_at: string;
  created_at: string;
  approved_at: string | null;
  denied_at: string | null;
  consumed_at: string | null;
  account_id: string | null;
};

type BillingCustomerRow = {
  account_id: string;
  stripe_customer_id: string;
  email: string;
  created_at: string;
  updated_at: string;
};

type BillingSubscriptionRow = {
  account_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  stripe_price_id: string;
  plan: BillingSummary["plan"];
  subscription_state: BillingSummary["account"]["subscriptionState"];
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
};

type CheckoutSessionRow = {
  checkout_session_id: string;
  account_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  stripe_price_id: string;
  url: string;
  state: PersistedCheckoutSession["state"];
  created_at: string;
  updated_at: string;
};

type EntitlementRow = {
  account_id: string;
  access_state: PersistedAccountEntitlement["accessState"];
  can_generate: boolean;
  can_use_evidence: boolean;
  requires_upgrade: boolean;
  message: string;
  updated_at: string;
};

type BillingSummaryRow = {
  account_id: string;
  email: string;
  plan: BillingSummary["plan"];
  subscription_state: BillingSummary["account"]["subscriptionState"];
  beta_access: boolean;
  display_name: string | null;
  access_state: PersistedAccountEntitlement["accessState"] | null;
  can_generate: boolean | null;
  can_use_evidence: boolean | null;
  requires_upgrade: boolean | null;
  entitlement_message: string | null;
  billing_customer_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
  cancel_at_period_end: boolean | null;
};

function toMagicLink(row: MagicLinkRow): PersistedMagicLink {
  return {
    magicLinkId: row.magic_link_id,
    email: row.email,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    consumedAt: row.consumed_at || undefined,
  };
}

function toDeviceAuth(row: DeviceAuthRow): PersistedDeviceAuth {
  return {
    deviceCode: row.device_code,
    userCode: row.user_code,
    client: row.client || undefined,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    approvedAt: row.approved_at || undefined,
    deniedAt: row.denied_at || undefined,
    consumedAt: row.consumed_at || undefined,
    accountId: row.account_id || undefined,
  };
}

function toBillingCustomer(row: BillingCustomerRow): PersistedBillingCustomer {
  return {
    accountId: row.account_id,
    stripeCustomerId: row.stripe_customer_id,
    email: row.email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSubscription(row: BillingSubscriptionRow): PersistedBillingSubscription {
  return {
    accountId: row.account_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripePriceId: row.stripe_price_id,
    plan: row.plan,
    subscriptionState: row.subscription_state,
    trialEndsAt: row.trial_ends_at || undefined,
    currentPeriodEndsAt: row.current_period_ends_at || undefined,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCheckoutSession(row: CheckoutSessionRow): PersistedCheckoutSession {
  return {
    checkoutSessionId: row.checkout_session_id,
    accountId: row.account_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id || undefined,
    stripePriceId: row.stripe_price_id,
    url: row.url,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEntitlement(row: EntitlementRow): PersistedAccountEntitlement {
  return {
    accountId: row.account_id,
    accessState: row.access_state,
    canGenerate: row.can_generate,
    canUseEvidence: row.can_use_evidence,
    requiresUpgrade: row.requires_upgrade,
    message: row.message,
    updatedAt: row.updated_at,
  };
}

export class PostgresBillingRepository implements BillingRepository {
  constructor(private readonly pool: Pool) {}

  async createMagicLink(input: PersistedMagicLink): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO auth_magic_links (
          magic_link_id,
          email,
          token_hash,
          expires_at,
          created_at,
          consumed_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        input.magicLinkId,
        input.email,
        input.tokenHash,
        input.expiresAt,
        input.createdAt,
        input.consumedAt || null,
      ]
    );
  }

  async getMagicLinkByTokenHash(tokenHash: string): Promise<PersistedMagicLink | null> {
    const result = await this.pool.query<MagicLinkRow>(
      `
        SELECT
          magic_link_id,
          email,
          token_hash,
          expires_at,
          created_at,
          consumed_at
        FROM auth_magic_links
        WHERE token_hash = $1
        LIMIT 1
      `,
      [tokenHash]
    );

    return result.rows[0] ? toMagicLink(result.rows[0]) : null;
  }

  async consumeMagicLink(magicLinkId: string, consumedAt: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_magic_links SET consumed_at = $2 WHERE magic_link_id = $1`,
      [magicLinkId, consumedAt]
    );
  }

  async createDeviceAuth(input: PersistedDeviceAuth): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO auth_device_codes (
          device_code,
          user_code,
          client,
          expires_at,
          created_at,
          approved_at,
          denied_at,
          consumed_at,
          account_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        input.deviceCode,
        input.userCode,
        input.client || null,
        input.expiresAt,
        input.createdAt,
        input.approvedAt || null,
        input.deniedAt || null,
        input.consumedAt || null,
        input.accountId || null,
      ]
    );
  }

  async getDeviceAuthByDeviceCode(deviceCode: string): Promise<PersistedDeviceAuth | null> {
    const result = await this.pool.query<DeviceAuthRow>(
      `
        SELECT
          device_code,
          user_code,
          client,
          expires_at,
          created_at,
          approved_at,
          denied_at,
          consumed_at,
          account_id
        FROM auth_device_codes
        WHERE device_code = $1
        LIMIT 1
      `,
      [deviceCode]
    );

    return result.rows[0] ? toDeviceAuth(result.rows[0]) : null;
  }

  async getDeviceAuthByUserCode(userCode: string): Promise<PersistedDeviceAuth | null> {
    const result = await this.pool.query<DeviceAuthRow>(
      `
        SELECT
          device_code,
          user_code,
          client,
          expires_at,
          created_at,
          approved_at,
          denied_at,
          consumed_at,
          account_id
        FROM auth_device_codes
        WHERE user_code = $1
        LIMIT 1
      `,
      [userCode]
    );

    return result.rows[0] ? toDeviceAuth(result.rows[0]) : null;
  }

  async approveDeviceAuth(input: {
    userCode: string;
    accountId: string;
    approvedAt: string;
  }): Promise<PersistedDeviceAuth | null> {
    const result = await this.pool.query<DeviceAuthRow>(
      `
        UPDATE auth_device_codes
        SET account_id = $2, approved_at = $3
        WHERE user_code = $1
        RETURNING
          device_code,
          user_code,
          client,
          expires_at,
          created_at,
          approved_at,
          denied_at,
          consumed_at,
          account_id
      `,
      [input.userCode, input.accountId, input.approvedAt]
    );

    return result.rows[0] ? toDeviceAuth(result.rows[0]) : null;
  }

  async consumeDeviceAuth(deviceCode: string, consumedAt: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_device_codes SET consumed_at = $2 WHERE device_code = $1`,
      [deviceCode, consumedAt]
    );
  }

  async upsertBillingCustomer(input: PersistedBillingCustomer): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO billing_customers (
          account_id,
          stripe_customer_id,
          email,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (account_id) DO UPDATE
        SET
          stripe_customer_id = EXCLUDED.stripe_customer_id,
          email = EXCLUDED.email,
          updated_at = EXCLUDED.updated_at
      `,
      [
        input.accountId,
        input.stripeCustomerId,
        input.email,
        input.createdAt,
        input.updatedAt,
      ]
    );
  }

  async getBillingCustomer(accountId: string): Promise<PersistedBillingCustomer | null> {
    const result = await this.pool.query<BillingCustomerRow>(
      `
        SELECT
          account_id,
          stripe_customer_id,
          email,
          created_at,
          updated_at
        FROM billing_customers
        WHERE account_id = $1
        LIMIT 1
      `,
      [accountId]
    );

    return result.rows[0] ? toBillingCustomer(result.rows[0]) : null;
  }

  async findBillingCustomerByStripeCustomerId(
    stripeCustomerId: string
  ): Promise<PersistedBillingCustomer | null> {
    const result = await this.pool.query<BillingCustomerRow>(
      `
        SELECT
          account_id,
          stripe_customer_id,
          email,
          created_at,
          updated_at
        FROM billing_customers
        WHERE stripe_customer_id = $1
        LIMIT 1
      `,
      [stripeCustomerId]
    );

    return result.rows[0] ? toBillingCustomer(result.rows[0]) : null;
  }

  async upsertSubscription(input: PersistedBillingSubscription): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO billing_subscriptions (
          account_id,
          stripe_customer_id,
          stripe_subscription_id,
          stripe_price_id,
          plan,
          subscription_state,
          trial_ends_at,
          current_period_ends_at,
          cancel_at_period_end,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (account_id) DO UPDATE
        SET
          stripe_customer_id = EXCLUDED.stripe_customer_id,
          stripe_subscription_id = EXCLUDED.stripe_subscription_id,
          stripe_price_id = EXCLUDED.stripe_price_id,
          plan = EXCLUDED.plan,
          subscription_state = EXCLUDED.subscription_state,
          trial_ends_at = EXCLUDED.trial_ends_at,
          current_period_ends_at = EXCLUDED.current_period_ends_at,
          cancel_at_period_end = EXCLUDED.cancel_at_period_end,
          updated_at = EXCLUDED.updated_at
      `,
      [
        input.accountId,
        input.stripeCustomerId,
        input.stripeSubscriptionId,
        input.stripePriceId,
        input.plan,
        input.subscriptionState,
        input.trialEndsAt || null,
        input.currentPeriodEndsAt || null,
        input.cancelAtPeriodEnd,
        input.createdAt,
        input.updatedAt,
      ]
    );
  }

  async getSubscription(accountId: string): Promise<PersistedBillingSubscription | null> {
    const result = await this.pool.query<BillingSubscriptionRow>(
      `
        SELECT
          account_id,
          stripe_customer_id,
          stripe_subscription_id,
          stripe_price_id,
          plan,
          subscription_state,
          trial_ends_at,
          current_period_ends_at,
          cancel_at_period_end,
          created_at,
          updated_at
        FROM billing_subscriptions
        WHERE account_id = $1
        LIMIT 1
      `,
      [accountId]
    );

    return result.rows[0] ? toSubscription(result.rows[0]) : null;
  }

  async findSubscriptionByStripeSubscriptionId(
    stripeSubscriptionId: string
  ): Promise<PersistedBillingSubscription | null> {
    const result = await this.pool.query<BillingSubscriptionRow>(
      `
        SELECT
          account_id,
          stripe_customer_id,
          stripe_subscription_id,
          stripe_price_id,
          plan,
          subscription_state,
          trial_ends_at,
          current_period_ends_at,
          cancel_at_period_end,
          created_at,
          updated_at
        FROM billing_subscriptions
        WHERE stripe_subscription_id = $1
        LIMIT 1
      `,
      [stripeSubscriptionId]
    );

    return result.rows[0] ? toSubscription(result.rows[0]) : null;
  }

  async updateCheckoutSession(input: PersistedCheckoutSession): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO billing_checkout_sessions (
          checkout_session_id,
          account_id,
          stripe_customer_id,
          stripe_subscription_id,
          stripe_price_id,
          url,
          state,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (checkout_session_id) DO UPDATE
        SET
          stripe_subscription_id = EXCLUDED.stripe_subscription_id,
          url = EXCLUDED.url,
          state = EXCLUDED.state,
          updated_at = EXCLUDED.updated_at
      `,
      [
        input.checkoutSessionId,
        input.accountId,
        input.stripeCustomerId,
        input.stripeSubscriptionId || null,
        input.stripePriceId,
        input.url,
        input.state,
        input.createdAt,
        input.updatedAt,
      ]
    );
  }

  async getCheckoutSession(checkoutSessionId: string): Promise<PersistedCheckoutSession | null> {
    const result = await this.pool.query<CheckoutSessionRow>(
      `
        SELECT
          checkout_session_id,
          account_id,
          stripe_customer_id,
          stripe_subscription_id,
          stripe_price_id,
          url,
          state,
          created_at,
          updated_at
        FROM billing_checkout_sessions
        WHERE checkout_session_id = $1
        LIMIT 1
      `,
      [checkoutSessionId]
    );

    return result.rows[0] ? toCheckoutSession(result.rows[0]) : null;
  }

  async getLatestCheckoutSessionForAccount(
    accountId: string
  ): Promise<PersistedCheckoutSession | null> {
    const result = await this.pool.query<CheckoutSessionRow>(
      `
        SELECT
          checkout_session_id,
          account_id,
          stripe_customer_id,
          stripe_subscription_id,
          stripe_price_id,
          url,
          state,
          created_at,
          updated_at
        FROM billing_checkout_sessions
        WHERE account_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [accountId]
    );

    return result.rows[0] ? toCheckoutSession(result.rows[0]) : null;
  }

  async hasProcessedWebhookEvent(eventId: string): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM billing_webhook_events WHERE event_id = $1) AS exists`,
      [eventId]
    );
    return Boolean(result.rows[0]?.exists);
  }

  async recordProcessedWebhookEvent(input: {
    eventId: string;
    eventType: string;
    receivedAt: string;
    processedAt: string;
  }): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO billing_webhook_events (
          event_id,
          event_type,
          received_at,
          processed_at
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (event_id) DO NOTHING
      `,
      [input.eventId, input.eventType, input.receivedAt, input.processedAt]
    );
  }

  async upsertEntitlement(input: PersistedAccountEntitlement): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO account_entitlements (
          account_id,
          access_state,
          can_generate,
          can_use_evidence,
          requires_upgrade,
          message,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (account_id) DO UPDATE
        SET
          access_state = EXCLUDED.access_state,
          can_generate = EXCLUDED.can_generate,
          can_use_evidence = EXCLUDED.can_use_evidence,
          requires_upgrade = EXCLUDED.requires_upgrade,
          message = EXCLUDED.message,
          updated_at = EXCLUDED.updated_at
      `,
      [
        input.accountId,
        input.accessState,
        input.canGenerate,
        input.canUseEvidence,
        input.requiresUpgrade,
        input.message,
        input.updatedAt,
      ]
    );
  }

  async getEntitlement(accountId: string): Promise<PersistedAccountEntitlement | null> {
    const result = await this.pool.query<EntitlementRow>(
      `
        SELECT
          account_id,
          access_state,
          can_generate,
          can_use_evidence,
          requires_upgrade,
          message,
          updated_at
        FROM account_entitlements
        WHERE account_id = $1
        LIMIT 1
      `,
      [accountId]
    );

    return result.rows[0] ? toEntitlement(result.rows[0]) : null;
  }

  async getBillingSummary(accountId: string): Promise<BillingSummary | null> {
    const result = await this.pool.query<BillingSummaryRow>(
      `
        SELECT
          a.account_id,
          a.email,
          a.plan,
          a.subscription_state,
          a.beta_access,
          a.display_name,
          e.access_state,
          e.can_generate,
          e.can_use_evidence,
          e.requires_upgrade,
          e.message AS entitlement_message,
          c.stripe_customer_id AS billing_customer_id,
          s.stripe_customer_id,
          s.stripe_subscription_id,
          s.stripe_price_id,
          s.trial_ends_at,
          s.current_period_ends_at,
          s.cancel_at_period_end
        FROM accounts a
        LEFT JOIN account_entitlements e ON e.account_id = a.account_id
        LEFT JOIN billing_customers c ON c.account_id = a.account_id
        LEFT JOIN billing_subscriptions s ON s.account_id = a.account_id
        WHERE a.account_id = $1
        LIMIT 1
      `,
      [accountId]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      apiVersion: "v1",
      deploymentMode: "hosted_public",
      account: {
        accountId: row.account_id,
        email: row.email,
        plan: row.plan,
        subscriptionState: row.subscription_state,
        betaAccess: row.beta_access,
        displayName: row.display_name || undefined,
      },
      entitlement: {
        accessState: row.access_state || row.subscription_state,
        canGenerate: row.can_generate ?? (row.subscription_state === "active" || row.subscription_state === "trialing" || row.subscription_state === "beta"),
        canUseEvidence: row.can_use_evidence ?? (row.subscription_state === "active" || row.subscription_state === "trialing" || row.subscription_state === "beta"),
        requiresUpgrade: row.requires_upgrade ?? !(row.subscription_state === "active" || row.subscription_state === "trialing" || row.subscription_state === "beta"),
        message: row.entitlement_message || "Account access is being resolved.",
      },
      subscription:
        row.stripe_customer_id && row.stripe_subscription_id && row.stripe_price_id
          ? {
              provider: "stripe",
              status: row.subscription_state,
              customerId: row.stripe_customer_id,
              subscriptionId: row.stripe_subscription_id,
              priceId: row.stripe_price_id,
            }
          : null,
      plan: row.plan,
      trialEndsAt: row.trial_ends_at || undefined,
      currentPeriodEndsAt: row.current_period_ends_at || undefined,
      cancelAtPeriodEnd: row.cancel_at_period_end ?? false,
      billingPortalAvailable: Boolean(row.billing_customer_id),
      billingReadiness: {
        status: "unconfigured",
        checkoutAvailable: false,
        message:
          "ReplyMate billing is not configured. Checkout and billing portal are unavailable until Stripe settings are added.",
      },
    };
  }

  async syncAccountBillingState(input: {
    accountId: string;
    plan: BillingSummary["plan"];
    subscriptionState: BillingSummary["account"]["subscriptionState"];
    betaAccess: boolean;
  }): Promise<void> {
    await this.pool.query(
      `
        UPDATE accounts
        SET
          plan = $2,
          subscription_state = $3,
          beta_access = $4,
          updated_at = $5
        WHERE account_id = $1
      `,
      [
        input.accountId,
        input.plan,
        input.subscriptionState,
        input.betaAccess,
        new Date().toISOString(),
      ]
    );
  }
}
