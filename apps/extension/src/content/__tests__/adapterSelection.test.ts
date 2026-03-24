// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import type {
  AdapterId,
  ComposerHandle,
  SiteAdapter,
} from "@replymate/contracts";
import { FEATURE_FLAGS } from "@replymate/contracts";
import {
  getPreferredAdapterOrder,
  resolveAdapter,
  type AdapterMap,
} from "../adapterSelection.js";

function makeHandle(adapterId: AdapterId): ComposerHandle {
  const element = document.createElement("div");
  return {
    element,
    adapterId,
    fingerprint: `${adapterId}-fingerprint`,
  };
}

function makeAdapter(
  id: AdapterId,
  shouldDetect: boolean
): SiteAdapter {
  return {
    id,
    siteId:
      id === "slack"
        ? "slack_web"
        : id === "gmail"
          ? "gmail_web"
          : "generic_web",
    detectComposer: () => (shouldDetect ? makeHandle(id) : null),
    extractSnapshot: () => {
      throw new Error("Not used in adapter selection tests.");
    },
    insertText: () => ({ success: true }),
    getAttachCapability: () => "none",
  };
}

describe("adapterSelection", () => {
  it("prefers Slack then generic on Slack host", () => {
    const order = getPreferredAdapterOrder("app.slack.com", {});
    expect(order).toEqual(["slack", "generic"]);
  });

  it("prefers Gmail then generic on Gmail host", () => {
    const order = getPreferredAdapterOrder("mail.google.com", {});
    expect(order).toEqual(["gmail", "generic"]);
  });

  it("uses generic only on non-first-party hosts", () => {
    const order = getPreferredAdapterOrder("example.com", {});
    expect(order).toEqual(["generic"]);
  });

  it("respects disabled site flags", () => {
    const order = getPreferredAdapterOrder("app.slack.com", {
      [FEATURE_FLAGS.SITE_SLACK_ENABLED]: false,
    });
    expect(order).toEqual(["generic"]);
  });

  it("resolves first matching adapter in preferred order", () => {
    const adapters: AdapterMap = {
      slack: makeAdapter("slack", true),
      gmail: makeAdapter("gmail", true),
      generic: makeAdapter("generic", true),
    };

    const resolved = resolveAdapter(document, "app.slack.com", adapters, {});

    expect(resolved).not.toBeNull();
    expect(resolved?.adapter.id).toBe("slack");
  });

  it("falls back to generic when preferred adapter misses", () => {
    const adapters: AdapterMap = {
      slack: makeAdapter("slack", false),
      gmail: makeAdapter("gmail", false),
      generic: makeAdapter("generic", true),
    };

    const resolved = resolveAdapter(document, "app.slack.com", adapters, {});

    expect(resolved).not.toBeNull();
    expect(resolved?.adapter.id).toBe("generic");
  });
});
