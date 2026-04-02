import type {
  AccountAccessState,
  AccountSummary,
  EntitlementSummary,
  SubscriptionState,
} from "@replymate/contracts";
import type { BillingRepository } from "../persistence/BillingRepository.js";

function buildMessage(accessState: AccountAccessState): string {
  switch (accessState) {
    case "beta":
      return "Beta access is active.";
    case "trialing":
      return "Trial access is active.";
    case "active":
      return "Subscription access is active.";
    case "past_due":
      return "Subscription payment is past due. Update billing to continue.";
    case "canceled":
      return "Subscription is canceled. Upgrade to continue.";
    case "inactive":
    default:
      return "Upgrade to use hosted generation and evidence.";
  }
}

function toAccessState(input: {
  account: AccountSummary;
  subscriptionState?: SubscriptionState;
}): AccountAccessState {
  const state = input.subscriptionState || input.account.subscriptionState;
  if (input.account.betaAccess || input.account.plan === "beta" || state === "beta") {
    return "beta";
  }
  if (state === "trialing") return "trialing";
  if (state === "active") return "active";
  if (state === "past_due") return "past_due";
  if (state === "canceled") return "canceled";
  return "inactive";
}

export class EntitlementService {
  constructor(private readonly billingRepository: BillingRepository) {}

  resolveForAccount(input: {
    account: AccountSummary;
    subscriptionState?: SubscriptionState;
  }): EntitlementSummary {
    const accessState = toAccessState(input);
    const canUsePaidFeatures =
      accessState === "beta" || accessState === "trialing" || accessState === "active";

    return {
      accessState,
      canGenerate: canUsePaidFeatures,
      canUseEvidence: canUsePaidFeatures,
      requiresUpgrade: !canUsePaidFeatures,
      message: buildMessage(accessState),
    };
  }

  async syncAccountEntitlement(input: {
    account: AccountSummary;
    subscriptionState?: SubscriptionState;
  }): Promise<EntitlementSummary> {
    const entitlement = this.resolveForAccount(input);
    await this.billingRepository.upsertEntitlement({
      accountId: input.account.accountId,
      accessState: entitlement.accessState,
      canGenerate: entitlement.canGenerate,
      canUseEvidence: entitlement.canUseEvidence,
      requiresUpgrade: entitlement.requiresUpgrade,
      message: entitlement.message,
      updatedAt: new Date().toISOString(),
    });
    return entitlement;
  }

  async getEntitlement(account: AccountSummary): Promise<EntitlementSummary> {
    const stored = await this.billingRepository.getEntitlement(account.accountId);
    if (stored) {
      return {
        accessState: stored.accessState,
        canGenerate: stored.canGenerate,
        canUseEvidence: stored.canUseEvidence,
        requiresUpgrade: stored.requiresUpgrade,
        message: stored.message,
      };
    }

    return this.syncAccountEntitlement({ account });
  }
}
