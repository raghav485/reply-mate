import type { AccountSummary } from "@replymate/contracts";
import { ApiError } from "../core/errors.js";
import { EntitlementService } from "./EntitlementService.js";

export async function requireHostedEntitlement(input: {
  account: AccountSummary | undefined;
  entitlementService: EntitlementService;
  feature: "generate" | "evidence";
}): Promise<void> {
  if (!input.account) {
    throw new ApiError({
      message: "ReplyMate session is required.",
      errorCode: "UNAUTHORIZED",
      statusCode: 401,
    });
  }

  const entitlement = await input.entitlementService.getEntitlement(input.account);
  const allowed =
    input.feature === "generate" ? entitlement.canGenerate : entitlement.canUseEvidence;
  if (allowed) {
    return;
  }

  let errorCode: "PAYMENT_REQUIRED" | "SUBSCRIPTION_PAST_DUE" | "TRIAL_EXPIRED" | "BILLING_UNAVAILABLE" =
    "PAYMENT_REQUIRED";
  if (entitlement.accessState === "past_due") {
    errorCode = "SUBSCRIPTION_PAST_DUE";
  } else if (input.account.subscriptionState === "trialing") {
    errorCode = "TRIAL_EXPIRED";
  }

  throw new ApiError({
    message: entitlement.message,
    errorCode,
    statusCode: errorCode === "SUBSCRIPTION_PAST_DUE" ? 402 : 403,
    details: {
      accessState: entitlement.accessState,
      requiresUpgrade: entitlement.requiresUpgrade,
    },
  });
}
