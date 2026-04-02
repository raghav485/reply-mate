import { useCallback, useEffect, useState } from "react";
import type { BillingSummary, HostedSession } from "@replymate/contracts";
import { WebApiClient } from "./ApiClient.js";

export function useBillingSummary(session: HostedSession | null) {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!session) {
      setSummary(null);
      setError(null);
      return null;
    }

    setLoading(true);
    try {
      const next = await WebApiClient.getBillingSummary(session.accessToken);
      setSummary(next);
      setError(null);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    summary,
    error,
    loading,
    refresh,
  };
}
