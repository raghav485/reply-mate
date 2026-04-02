import type {
  BillingSummary,
  GenerateDraftRequest,
  GenerateDraftResponse,
  HostedSession,
  SettingsValidationResponse,
} from "@replymate/contracts";
import { getStripeBillingIntegrationReadiness } from "../apps/api/src/billing/readiness.js";
import { EntitlementService } from "../apps/api/src/billing/EntitlementService.js";
import { loadLocalEnv } from "../apps/api/src/bootstrap/loadEnv.js";
import { deriveAccountId, issueHostedSessionForAccount } from "../apps/api/src/core/authSession.js";
import { closeSharedDatabasePool } from "../apps/api/src/persistence/db.js";
import { createBillingRepository, createHostedStateRepository } from "../apps/api/src/persistence/index.js";
import { postStripeWebhookFixture } from "./post-stripe-webhook.js";

type VerifyResult =
  | { ok: true; baseUrl: string; deploymentMode: string; notes: string[] }
  | { ok: false; step: string; message: string };

type SessionResponse = {
  session: HostedSession;
};

type DeviceAuthStartResponse = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  pollIntervalMs: number;
};

type VerificationMode = "none" | "fixture-only" | "mixed-fixture-live" | "invalid-partial";

function resolveVerificationMode(): VerificationMode {
  const readiness = getStripeBillingIntegrationReadiness();
  switch (readiness.verificationMode) {
    case "live":
      return "mixed-fixture-live";
    case "fixture_only":
      return "fixture-only";
    case "none":
      return "none";
    case "invalid_partial":
    default:
      return "invalid-partial";
  }
}

function buildGenerateRequest(accessState: string): GenerateDraftRequest {
  return {
    sessionId: `verify-${accessState}-session`,
    sessionVersion: 1,
    siteId: "gmail_web",
    actionMode: "improve_current_draft",
    tonePreset: "professional",
    draftInput: "Thanks for reaching out. We are reviewing the request now.",
    instructionInput: "Keep it short and clear.",
    contextEnabled: true,
    snapshot: {
      draftText: "Thanks for reaching out. We are reviewing the request now.",
      visibleContext: [
        {
          id: "ctx-1",
          author: "Customer",
          role: "customer",
          text: "Can you confirm when the billing issue will be fixed?",
          source: "visible_email_thread",
        },
      ],
      contextScope: "thread",
      workspaceKey: `billing-verify-${accessState}`,
      composerMode: "email",
      metadata: {
        siteId: "gmail_web",
        url: "https://mail.google.com/mail/u/0/#inbox/replymate",
        title: "Billing verification thread",
        senderName: "Customer",
      },
      extractionConfidence: 0.95,
      warnings: [],
      pageUrlAtCapture: "https://mail.google.com/mail/u/0/#inbox/replymate",
      viewFingerprint: `vf-${accessState}`,
      composerFingerprint: `cf-${accessState}`,
      sessionVersion: 1,
    },
    evidence: [],
    usedVoiceInput: false,
    costMode: "cloud_quality",
  };
}

async function fetchJson<T>(input: {
  step: string;
  url: string;
  method: "GET" | "POST";
  accessToken?: string;
  body?: unknown;
  expectStatus?: number;
}): Promise<{ ok: true; data: T; status: number } | VerifyResult> {
  try {
    const response = await fetch(input.url, {
      method: input.method,
      headers: {
        ...(input.body ? { "Content-Type": "application/json" } : {}),
        ...(input.accessToken ? { Authorization: `Bearer ${input.accessToken}` } : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
    });

    let payload: (T & { message?: string; errorCode?: string }) | null = null;
    try {
      payload = (await response.json()) as T & { message?: string; errorCode?: string };
    } catch {
      payload = null;
    }

    if (input.expectStatus && response.status !== input.expectStatus) {
      return {
        ok: false,
        step: input.step,
        message:
          payload?.message ||
          `Expected status ${input.expectStatus} but received ${response.status}.`,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        step: input.step,
        message: payload?.message || `${response.status} ${response.statusText}`,
      };
    }

    return { ok: true, data: (payload || {}) as T, status: response.status };
  } catch (error) {
    return {
      ok: false,
      step: input.step,
      message: error instanceof Error ? error.message : "Unexpected billing verification error.",
    };
  }
}

async function postEvidence(input: {
  step: string;
  baseUrl: string;
  accessToken: string;
  accessState: string;
  expectStatus?: number;
}): Promise<{ ok: true; errorCode?: string } | VerifyResult> {
  try {
    const formData = new FormData();
    formData.set("sessionId", `verify-${input.accessState}-session`);
    formData.set("mode", "context_only");
    formData.set("mentionInReply", "false");
    formData.append(
      "file",
      new Blob(["ReplyMate billing verification evidence"], {
        type: "text/plain",
      }),
      "billing-verification.txt"
    );

    const response = await fetch(`${input.baseUrl}/v1/evidence/ingest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
      body: formData,
    });

    let payload: { errorCode?: string; message?: string } | null = null;
    try {
      payload = (await response.json()) as { errorCode?: string; message?: string };
    } catch {
      payload = null;
    }

    if (input.expectStatus && response.status !== input.expectStatus) {
      return {
        ok: false,
        step: input.step,
        message:
          payload?.message ||
          `Expected status ${input.expectStatus} but received ${response.status}.`,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        step: input.step,
        message: payload?.message || `${response.status} ${response.statusText}`,
      };
    }

    return {
      ok: true,
      errorCode: payload?.errorCode,
    };
  } catch (error) {
    return {
      ok: false,
      step: input.step,
      message: error instanceof Error ? error.message : "Unexpected evidence verification error.",
    };
  }
}

async function createPaidVerificationSession(): Promise<HostedSession> {
  const hostedStateRepository = createHostedStateRepository();
  const billingRepository = createBillingRepository();
  const email =
    process.env.REPLYMATE_VERIFY_BILLING_EMAIL?.trim().toLowerCase() ||
    "billing-verify@replymate.local";
  const account = await hostedStateRepository.upsertAccount({
    accountId: deriveAccountId(email),
    email,
    plan: "pro",
    subscriptionState: "inactive",
    betaAccess: false,
    displayName: "Billing Verify",
  });
  await new EntitlementService(billingRepository).syncAccountEntitlement({ account });

  const issued = await issueHostedSessionForAccount({
    account,
    repository: hostedStateRepository,
    userAgent: "replymate-billing-verify",
  });

  return issued.session;
}

async function ensureFixtureCustomer(session: HostedSession): Promise<void> {
  const billingRepository = createBillingRepository();
  const existing = await billingRepository.getBillingCustomer(session.account.accountId);
  if (existing) {
    return;
  }

  const now = new Date().toISOString();
  await billingRepository.upsertBillingCustomer({
    accountId: session.account.accountId,
    stripeCustomerId: `cus_replymate_fixture_${session.account.accountId.slice(-10)}`,
    email: session.account.email,
    createdAt: now,
    updatedAt: now,
  });
}

async function assertAccessState(input: {
  step: string;
  baseUrl: string;
  accessToken: string;
  expected: BillingSummary["entitlement"]["accessState"];
}): Promise<{ ok: true; summary: BillingSummary } | VerifyResult> {
  const summary = await fetchJson<BillingSummary>({
    step: input.step,
    url: `${input.baseUrl}/v1/billing/summary`,
    method: "GET",
    accessToken: input.accessToken,
  });
  if (!summary.ok) {
    return summary;
  }
  if (summary.data.entitlement.accessState !== input.expected) {
    return {
      ok: false,
      step: input.step,
      message: `Expected ${input.expected} access state, received ${summary.data.entitlement.accessState}.`,
    };
  }

  return {
    ok: true,
    summary: summary.data,
  };
}

async function verifyBlockedPastDuePaths(input: {
  baseUrl: string;
  accessToken: string;
}): Promise<VerifyResult | { ok: true }> {
  const blockedGenerate = await fetchJson<{ errorCode?: string }>({
    step: "generate.past_due",
    url: `${input.baseUrl}/v1/generate`,
    method: "POST",
    accessToken: input.accessToken,
    body: buildGenerateRequest("past_due"),
    expectStatus: 402,
  });
  if (!blockedGenerate.ok) {
    return blockedGenerate;
  }
  if (blockedGenerate.data.errorCode !== "SUBSCRIPTION_PAST_DUE") {
    return {
      ok: false,
      step: "generate.past_due",
      message: `Expected SUBSCRIPTION_PAST_DUE, received ${blockedGenerate.data.errorCode || "unknown"}.`,
    };
  }

  const blockedEvidence = await postEvidence({
    step: "evidence.past_due",
    baseUrl: input.baseUrl,
    accessToken: input.accessToken,
    accessState: "past_due",
    expectStatus: 402,
  });
  if (!blockedEvidence.ok) {
    return blockedEvidence;
  }
  if (blockedEvidence.errorCode !== "SUBSCRIPTION_PAST_DUE") {
    return {
      ok: false,
      step: "evidence.past_due",
      message: `Expected SUBSCRIPTION_PAST_DUE, received ${blockedEvidence.errorCode || "unknown"}.`,
    };
  }

  return { ok: true };
}

async function runVerification(): Promise<VerifyResult> {
  loadLocalEnv();
  const baseUrl = (process.env.REPLYMATE_VERIFY_HOSTED_BASE_URL || "http://localhost:3000")
    .trim()
    .replace(/\/+$/, "");
  const notes: string[] = [];

  const settings = await fetchJson<SettingsValidationResponse>({
    step: "settings.validate",
    url: `${baseUrl}/v1/settings/validate`,
    method: "POST",
    body: { client: "replymate-billing-verify" },
  });
  if (!settings.ok) {
    return settings;
  }

  const deviceStart = await fetchJson<DeviceAuthStartResponse>({
    step: "auth.device.start",
    url: `${baseUrl}/v1/auth/device/start`,
    method: "POST",
    body: { client: "replymate-billing-verify" },
  });
  if (!deviceStart.ok) {
    return deviceStart;
  }
  if (!deviceStart.data.verificationUrl.includes(deviceStart.data.userCode)) {
    return {
      ok: false,
      step: "auth.device.start",
      message: "Verification URL did not include the device auth user code.",
    };
  }

  const betaEmail = process.env.REPLYMATE_VERIFY_BETA_EMAIL?.trim() || "";
  const betaInviteCode = process.env.REPLYMATE_VERIFY_BETA_INVITE_CODE?.trim() || "";
  if (betaEmail && betaInviteCode) {
    const betaLogin = await fetchJson<SessionResponse>({
      step: "auth.beta-login",
      url: `${baseUrl}/v1/auth/beta-login`,
      method: "POST",
      body: { email: betaEmail, inviteCode: betaInviteCode },
    });
    if (!betaLogin.ok) {
      return betaLogin;
    }
  } else {
    notes.push(
      "Skipped beta invite login because REPLYMATE_VERIFY_BETA_EMAIL/INVITE_CODE are not set."
    );
  }

  const paidSession = await createPaidVerificationSession();
  const inactiveSummary = await assertAccessState({
    step: "billing.summary.inactive",
    baseUrl,
    accessToken: paidSession.accessToken,
    expected: "inactive",
  });
  if (!inactiveSummary.ok) {
    return inactiveSummary;
  }

  const blockedInactive = await fetchJson<{ errorCode?: string }>({
    step: "generate.inactive",
    url: `${baseUrl}/v1/generate`,
    method: "POST",
    accessToken: paidSession.accessToken,
    body: buildGenerateRequest("inactive"),
    expectStatus: 403,
  });
  if (!blockedInactive.ok) {
    return blockedInactive;
  }
  if (blockedInactive.data.errorCode !== "PAYMENT_REQUIRED") {
    return {
      ok: false,
      step: "generate.inactive",
      message: `Expected PAYMENT_REQUIRED, received ${blockedInactive.data.errorCode || "unknown"}.`,
    };
  }

  const verificationMode = resolveVerificationMode();
  if (verificationMode === "invalid-partial") {
    return {
      ok: false,
      step: "billing.readiness",
      message:
        "Stripe billing env vars are partially configured. Use fixture-only mode with just REPLYMATE_STRIPE_WEBHOOK_SECRET, or configure secret key, webhook secret, and price id for live Stripe mode.",
    };
  }

  if (verificationMode === "none") {
    notes.push("Billing verification mode: Stripe checks skipped because Stripe env vars are absent.");
    return {
      ok: true,
      baseUrl,
      deploymentMode: settings.data.deploymentMode,
      notes,
    };
  }

  if (verificationMode === "fixture-only") {
    notes.push("Billing verification mode: fixture-only.");
    await ensureFixtureCustomer(paidSession);
  } else {
    notes.push("Billing verification mode: mixed fixture + live Stripe.");
    const checkout = await fetchJson<{ url: string }>({
      step: "billing.checkout",
      url: `${baseUrl}/v1/billing/checkout`,
      method: "POST",
      accessToken: paidSession.accessToken,
      body: {
        successUrl: "http://localhost:5173/checkout/success",
        cancelUrl: "http://localhost:5173/checkout/cancel",
      },
    });
    if (!checkout.ok) {
      return checkout;
    }
    if (!checkout.data.url.startsWith("https://")) {
      return {
        ok: false,
        step: "billing.checkout",
        message: "Checkout URL was not an https URL.",
      };
    }

    const checkoutCompleted = await postStripeWebhookFixture({
      fixtureName: "checkout.session.completed",
      baseUrl,
      accountEmail: paidSession.account.email,
    });
    if (checkoutCompleted.status >= 400) {
      return {
        ok: false,
        step: "webhook.checkout.session.completed",
        message: `${checkoutCompleted.status}: ${checkoutCompleted.responseText}`,
      };
    }
  }

  for (const fixtureName of [
    "customer.subscription.trialing",
    "customer.subscription.active",
  ] as const) {
    const posted = await postStripeWebhookFixture({
      fixtureName,
      baseUrl,
      accountEmail: paidSession.account.email,
    });
    if (posted.status >= 400) {
      return {
        ok: false,
        step: `webhook.${fixtureName}`,
        message: `${posted.status}: ${posted.responseText}`,
      };
    }
  }

  const activeSummary = await assertAccessState({
    step: "billing.summary.active",
    baseUrl,
    accessToken: paidSession.accessToken,
    expected: "active",
  });
  if (!activeSummary.ok) {
    return activeSummary;
  }

  if (settings.data.cloudGenerationAvailable) {
    const activeGenerate = await fetchJson<GenerateDraftResponse>({
      step: "generate.active",
      url: `${baseUrl}/v1/generate`,
      method: "POST",
      accessToken: paidSession.accessToken,
      body: buildGenerateRequest("active"),
    });
    if (!activeGenerate.ok) {
      return activeGenerate;
    }
  } else {
    notes.push(
      "Skipped active generation verification because hosted cloud generation is not available."
    );
  }

  if (verificationMode === "mixed-fixture-live") {
    if (!activeSummary.summary.billingPortalAvailable) {
      return {
        ok: false,
        step: "billing.summary.active",
        message: "Billing portal should be available once a Stripe customer exists.",
      };
    }

    const portal = await fetchJson<{ url: string }>({
      step: "billing.portal",
      url: `${baseUrl}/v1/billing/portal`,
      method: "POST",
      accessToken: paidSession.accessToken,
      body: {
        returnUrl: "http://localhost:5173/account",
      },
    });
    if (!portal.ok) {
      return portal;
    }
    if (!portal.data.url.startsWith("https://")) {
      return {
        ok: false,
        step: "billing.portal",
        message: "Billing portal URL was not an https URL.",
      };
    }
  } else {
    notes.push("Skipped live Stripe checkout and portal checks because fixture-only mode is active.");
  }

  const pastDueEvent = await postStripeWebhookFixture({
    fixtureName: "invoice.payment_failed",
    baseUrl,
    accountEmail: paidSession.account.email,
  });
  if (pastDueEvent.status >= 400) {
    return {
      ok: false,
      step: "webhook.invoice.payment_failed",
      message: `${pastDueEvent.status}: ${pastDueEvent.responseText}`,
    };
  }

  const pastDueSummary = await assertAccessState({
    step: "billing.summary.past_due",
    baseUrl,
    accessToken: paidSession.accessToken,
    expected: "past_due",
  });
  if (!pastDueSummary.ok) {
    return pastDueSummary;
  }

  const blockedPastDue = await verifyBlockedPastDuePaths({
    baseUrl,
    accessToken: paidSession.accessToken,
  });
  if (!blockedPastDue.ok) {
    return blockedPastDue;
  }

  const restoredEvent = await postStripeWebhookFixture({
    fixtureName: "invoice.paid",
    baseUrl,
    accountEmail: paidSession.account.email,
  });
  if (restoredEvent.status >= 400) {
    return {
      ok: false,
      step: "webhook.invoice.paid",
      message: `${restoredEvent.status}: ${restoredEvent.responseText}`,
    };
  }

  const restoredSummary = await assertAccessState({
    step: "billing.summary.restored",
    baseUrl,
    accessToken: paidSession.accessToken,
    expected: "active",
  });
  if (!restoredSummary.ok) {
    return restoredSummary;
  }

  return {
    ok: true,
    baseUrl,
    deploymentMode: settings.data.deploymentMode,
    notes,
  };
}

async function main(): Promise<void> {
  const result = await runVerification();
  if (!result.ok) {
    console.error(`[verify:billing] ${result.step} failed: ${result.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[verify:billing] passed against ${result.baseUrl} (${result.deploymentMode})`);
  for (const note of result.notes) {
    console.log(`[verify:billing] note: ${note}`);
  }
}

void main()
  .catch((error) => {
    console.error(
      `[verify:billing] unexpected failure: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeSharedDatabasePool().catch(() => undefined);
  });
