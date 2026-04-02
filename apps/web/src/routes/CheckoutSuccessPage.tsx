import type { HostedSession } from "@replymate/contracts";
import { useBillingSummary } from "../shared/useBillingSummary.js";

type CheckoutSuccessPageProps = {
  session: HostedSession | null;
};

export function CheckoutSuccessPage({ session }: CheckoutSuccessPageProps) {
  const { summary, error, loading, refresh } = useBillingSummary(session);

  return (
    <section>
      <h1>Checkout complete</h1>
      <p>ReplyMate received your Stripe checkout result. Return to the extension or open your account page to confirm access.</p>
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
      <a className="button-link" href="/account">
        Open account
      </a>
    </section>
  );
}
