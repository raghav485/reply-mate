import type { BillingSummary, HostedSession } from "@replymate/contracts";
import { WebApiClient } from "../shared/ApiClient.js";
import { useBillingSummary } from "../shared/useBillingSummary.js";

type PricingPageProps = {
  session: HostedSession | null;
};

export function resolvePricingAction(
  summary: BillingSummary | null,
  hasSession: boolean
): { kind: "login" | "checkout" | "account" | "unavailable"; label: string } {
  if (!hasSession) {
    return { kind: "login", label: "Sign in to upgrade" };
  }

  if (
    summary &&
    (summary.entitlement.accessState === "inactive" ||
      summary.entitlement.accessState === "canceled" ||
      summary.entitlement.accessState === "past_due") &&
    !summary.billingReadiness.checkoutAvailable
  ) {
    return { kind: "unavailable", label: "Billing unavailable" };
  }

  switch (summary?.entitlement.accessState) {
    case "beta":
      return { kind: "account", label: "Beta access active" };
    case "trialing":
    case "active":
      return { kind: "account", label: "Open account" };
    case "inactive":
    case "canceled":
    case "past_due":
    default:
      return { kind: "checkout", label: "Upgrade with Stripe" };
  }
}

export function PricingPage({ session }: PricingPageProps) {
  const { summary, error, loading, refresh } = useBillingSummary(session);
  const action = resolvePricingAction(summary, Boolean(session));

  const handleUpgrade = async () => {
    if (action.kind === "login" || !session) {
      window.location.assign("/login");
      return;
    }

    if (action.kind === "account") {
      window.location.assign("/account");
      return;
    }

    if (action.kind === "unavailable") {
      return;
    }

    const checkout = await WebApiClient.createCheckoutSession(session.accessToken);
    window.location.assign(checkout.url);
  };

  return (
    <section>
      <h1>ReplyMate Pro</h1>
      <p>Hosted drafting, evidence uploads, and account-managed subscriptions for Slack and Gmail.</p>
      <div className="card">
        <div className="eyebrow">Single plan</div>
        <h2>Pro</h2>
        <p>Recurring subscription billed through Stripe. Generic web remains beta-only.</p>
        {summary?.billingReadiness.message ? (
          <p className="status">{summary.billingReadiness.message}</p>
        ) : null}
        {error ? <p className="status error">{error}</p> : null}
        <button
          onClick={() => void handleUpgrade()}
          disabled={action.kind === "unavailable" || loading}
        >
          {action.label}
        </button>
        {session ? (
          <button className="secondary-button" onClick={() => void refresh()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh status"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
