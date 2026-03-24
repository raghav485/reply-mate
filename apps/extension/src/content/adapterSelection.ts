import type {
  AdapterId,
  ComposerHandle,
  FeatureFlagKey,
  SiteAdapter,
} from "@replymate/contracts";
import { FEATURE_FLAGS } from "@replymate/contracts";

export type AdapterMap = Record<AdapterId, SiteAdapter>;
export type SiteFlagSnapshot = Partial<Record<FeatureFlagKey, boolean>>;

function isSlackHost(hostname: string): boolean {
  return hostname === "app.slack.com" || hostname.endsWith(".slack.com");
}

function isGmailHost(hostname: string): boolean {
  return hostname === "mail.google.com";
}

function isEnabled(flags: SiteFlagSnapshot, key: FeatureFlagKey): boolean {
  return flags[key] !== false;
}

export function getPreferredAdapterOrder(
  hostname: string,
  flags: SiteFlagSnapshot
): AdapterId[] {
  const orders: AdapterId[] = [];
  const genericEnabled = isEnabled(flags, FEATURE_FLAGS.SITE_GENERIC_ENABLED);

  if (isSlackHost(hostname) && isEnabled(flags, FEATURE_FLAGS.SITE_SLACK_ENABLED)) {
    orders.push("slack");
  }

  if (isGmailHost(hostname) && isEnabled(flags, FEATURE_FLAGS.SITE_GMAIL_ENABLED)) {
    orders.push("gmail");
  }

  if (genericEnabled) {
    orders.push("generic");
  }

  return orders;
}

export function resolveAdapter(
  doc: Document,
  hostname: string,
  adapters: AdapterMap,
  flags: SiteFlagSnapshot
): { adapter: SiteAdapter; handle: ComposerHandle } | null {
  const preferredOrder = getPreferredAdapterOrder(hostname, flags);

  for (const adapterId of preferredOrder) {
    const adapter = adapters[adapterId];
    const handle = adapter.detectComposer(doc);
    if (handle) {
      return { adapter, handle };
    }
  }

  return null;
}
