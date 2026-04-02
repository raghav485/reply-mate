import type { HostedSession } from "@replymate/contracts";
import { useBillingSummary } from "../shared/useBillingSummary.js";

type CheckoutCancelPageProps = {
  session: HostedSession | null;
};

export function CheckoutCancelPage({ session }: CheckoutCancelPageProps) {
  const { summary, error, loading, refresh } = useBillingSummary(session);

  return (
    <section>
      <h1>Checkout canceled</h1>
      <p>No billing change was completed. You can retry when you are ready.</p>
      {summary ? (
        <p className="status">
          Current access: <strong>{summary.entitlement.accessState}</strong>. {summary.entitlement.message}
        </p>
      ) : null}
      {error ? <p className="status error">{error}</p> : null}
      {session ? (
        <button onClick={() => void refresh()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh status"}
        </button>
      ) : null}
      <a className="button-link" href="/pricing">
        Return to pricing
      </a>
    </section>
  );
}
