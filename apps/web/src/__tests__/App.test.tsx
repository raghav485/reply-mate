import { describe, expect, it } from "vitest";
import { resolveRoute } from "../App.js";
import { resolveAccountPrimaryAction } from "../routes/AccountPage.js";
import { resolvePricingAction } from "../routes/PricingPage.js";

describe("web app routing", () => {
  it("maps known account routes", () => {
    expect(resolveRoute("/login")).toBe("login");
    expect(resolveRoute("/pricing")).toBe("pricing");
    expect(resolveRoute("/account")).toBe("account");
    expect(resolveRoute("/checkout/success")).toBe("success");
    expect(resolveRoute("/checkout/cancel")).toBe("cancel");
  });

  it("routes pricing CTA based on billing state", () => {
    expect(resolvePricingAction(null, false)).toEqual({
      kind: "login",
      label: "Sign in to upgrade",
    });
    expect(
      resolvePricingAction(
        {
          apiVersion: "v1",
          deploymentMode: "hosted_public",
          account: {
            accountId: "acct_1",
            email: "user@example.com",
            plan: "pro",
            subscriptionState: "active",
            betaAccess: false,
          },
          entitlement: {
            accessState: "active",
            canGenerate: true,
            canUseEvidence: true,
            requiresUpgrade: false,
            message: "Subscription access is active.",
        },
        subscription: null,
        plan: "pro",
        cancelAtPeriodEnd: false,
        billingPortalAvailable: true,
        billingReadiness: {
          status: "configured",
          checkoutAvailable: true,
        },
      },
      true
    )
    ).toEqual({
      kind: "account",
      label: "Open account",
    });
  });

  it("routes account CTA based on billing state", () => {
    expect(
      resolveAccountPrimaryAction({
        apiVersion: "v1",
        deploymentMode: "hosted_public",
        account: {
          accountId: "acct_1",
          email: "user@example.com",
          plan: "pro",
          subscriptionState: "past_due",
          betaAccess: false,
        },
        entitlement: {
          accessState: "past_due",
          canGenerate: false,
          canUseEvidence: false,
          requiresUpgrade: true,
          message: "Subscription payment is past due.",
        },
        subscription: null,
        plan: "pro",
        cancelAtPeriodEnd: false,
        billingPortalAvailable: true,
        billingReadiness: {
          status: "configured",
          checkoutAvailable: true,
        },
      })
    ).toEqual({
      kind: "portal",
      label: "Update billing",
    });
  });

  it("marks pricing unavailable when checkout is not configured for blocked states", () => {
    expect(
      resolvePricingAction(
        {
          apiVersion: "v1",
          deploymentMode: "hosted_public",
          account: {
            accountId: "acct_2",
            email: "user@example.com",
            plan: "pro",
            subscriptionState: "inactive",
            betaAccess: false,
          },
          entitlement: {
            accessState: "inactive",
            canGenerate: false,
            canUseEvidence: false,
            requiresUpgrade: true,
            message: "Upgrade required.",
          },
          subscription: null,
          plan: "pro",
          cancelAtPeriodEnd: false,
          billingPortalAvailable: false,
          billingReadiness: {
            status: "partial",
            checkoutAvailable: false,
            message: "Billing is not fully configured.",
          },
        },
        true
      )
    ).toEqual({
      kind: "unavailable",
      label: "Billing unavailable",
    });
  });
});
