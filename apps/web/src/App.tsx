import { useEffect, useState } from "react";
import type { HostedSession } from "@replymate/contracts";
import { AccountPage } from "./routes/AccountPage.js";
import { CheckoutCancelPage } from "./routes/CheckoutCancelPage.js";
import { CheckoutSuccessPage } from "./routes/CheckoutSuccessPage.js";
import { LoginPage } from "./routes/LoginPage.js";
import { PricingPage } from "./routes/PricingPage.js";
import { readStoredSession, storeSession } from "./shared/ApiClient.js";

export function resolveRoute(pathname: string): "login" | "pricing" | "account" | "success" | "cancel" {
  if (pathname === "/pricing") return "pricing";
  if (pathname === "/account") return "account";
  if (pathname === "/checkout/success") return "success";
  if (pathname === "/checkout/cancel") return "cancel";
  return "login";
}

export function App() {
  const [route, setRoute] = useState(() => resolveRoute(window.location.pathname));
  const [session, setSession] = useState<HostedSession | null>(() => readStoredSession());

  useEffect(() => {
    const onPopState = () => setRoute(resolveRoute(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const updateSession = (next: HostedSession | null) => {
    storeSession(next);
    setSession(next);
  };

  return (
    <main className="shell">
      <nav>
        <a href="/login">Login</a>
        <a href="/pricing">Pricing</a>
        <a href="/account">Account</a>
        {session ? (
          <button
            className="linkish"
            onClick={() => {
              updateSession(null);
              window.history.pushState({}, "", "/login");
              setRoute("login");
            }}
          >
            Sign out
          </button>
        ) : null}
      </nav>
      {route === "login" ? <LoginPage session={session} setSession={updateSession} /> : null}
      {route === "pricing" ? <PricingPage session={session} /> : null}
      {route === "account" ? <AccountPage session={session} /> : null}
      {route === "success" ? <CheckoutSuccessPage session={session} /> : null}
      {route === "cancel" ? <CheckoutCancelPage session={session} /> : null}
    </main>
  );
}
