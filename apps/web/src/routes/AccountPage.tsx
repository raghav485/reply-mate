import type { BillingSummary, HostedSession } from "@replymate/contracts";
import { WebApiClient } from "../shared/ApiClient.js";
import { useBillingSummary } from "../shared/useBillingSummary.js";

type AccountPageProps = {
  session: HostedSession | null;
};

export function resolveAccountPrimaryAction(
  summary: BillingSummary | null
): { kind: "none" | "portal" | "pricing"; label?: string } {
  if (!summary) {
    return { kind: "none" };
  }

  switch (summary.entitlement.accessState) {
    case "past_due":
      return summary.billingPortalAvailable
        ? { kind: "portal", label: "Update billing" }
        : summary.billingReadiness.checkoutAvailable
          ? { kind: "pricing", label: "View pricing" }
          : { kind: "none" };
    case "inactive":
    case "canceled":
      return summary.billingReadiness.checkoutAvailable
        ? { kind: "pricing", label: "Upgrade" }
        : { kind: "none" };
    case "active":
    case "trialing":
    case "beta":
      return summary.billingPortalAvailable
        ? { kind: "portal", label: "Manage billing" }
        : { kind: "none" };
    default:
      return { kind: "none" };
  }
}

export function AccountPage({ session }: AccountPageProps) {
  const { summary, error, loading, refresh } = useBillingSummary(session);
  const primaryAction = resolveAccountPrimaryAction(summary);

  const handleManage = async () => {
    if (!session) {
      window.location.assign("/login");
      return;
    }
    const portal = await WebApiClient.createBillingPortal(session.accessToken);
    window.location.assign(portal.url);
  };

  const handlePrimaryAction = async () => {
    if (primaryAction.kind === "pricing") {
      window.location.assign("/pricing");
      return;
    }
    if (primaryAction.kind === "portal") {
      await handleManage();
    }
  };

  if (!session) {
    return (
      <section>
        <h1>ReplyMate account</h1>
        <p>Sign in to view billing and subscription state.</p>
      </section>
    );
  }

  return (
    <section>
      <h1>ReplyMate account</h1>
      <p>Signed in as {session.account.email}</p>
      {summary ? (
        <div className="card">
          <div className="row">
            <span>Plan</span>
            <strong>{summary.plan}</strong>
          </div>
          <div className="row">
            <span>Subscription</span>
            <strong>{summary.account.subscriptionState}</strong>
          </div>
          <div className="row">
            <span>Access</span>
            <strong>{summary.entitlement.accessState}</strong>
          </div>
          <p>{summary.entitlement.message}</p>
          {summary.billingReadiness.message ? (
            <p className="status">{summary.billingReadiness.message}</p>
          ) : null}
          <button onClick={() => void refresh()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh status"}
          </button>
          {primaryAction.kind !== "none" ? (
            <button
              disabled={primaryAction.kind === "portal" && !summary.billingPortalAvailable}
              onClick={() => void handlePrimaryAction()}
            >
              {primaryAction.label}
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="status error">{error}</p> : null}
    </section>
  );
}
