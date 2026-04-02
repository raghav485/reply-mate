import { useEffect, useState } from "react";
import type { HostedSession } from "@replymate/contracts";
import { WebApiClient, storeSession } from "../shared/ApiClient.js";

type LoginPageProps = {
  session: HostedSession | null;
  setSession: (session: HostedSession | null) => void;
};

export function LoginPage({ session, setSession }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const userCode = params.get("code");

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    void (async () => {
      setBusy(true);
      setError(null);
      setMessage("Signing you into ReplyMate…");
      try {
        const verified = await WebApiClient.verifyMagicLink(token);
        storeSession(verified.session);
        setSession(verified.session);
        if (userCode) {
          await WebApiClient.completeDeviceAuth(userCode, verified.session.accessToken);
          if (!cancelled) {
            setMessage("ReplyMate sign-in is complete. You can return to the extension.");
          }
        } else if (!cancelled) {
          setMessage("ReplyMate sign-in is complete.");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, userCode, setSession]);

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await WebApiClient.requestMagicLink(email);
      setMessage("Check your email or local API logs for the ReplyMate login link.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h1>ReplyMate login</h1>
      <p>Use a magic link to sign into your hosted account.</p>
      {session ? <p className="status ok">Signed in as {session.account.email}</p> : null}
      {userCode ? <p className="status">Extension sign-in code: {userCode}</p> : null}
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
      </label>
      <button disabled={busy || !email.trim()} onClick={() => void handleSubmit()}>
        {busy ? "Working…" : "Send magic link"}
      </button>
      {message ? <p className="status ok">{message}</p> : null}
      {error ? <p className="status error">{error}</p> : null}
    </section>
  );
}
