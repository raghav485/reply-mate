import { loadLocalEnv } from "../apps/api/src/bootstrap/loadEnv.js";

type VerifyResult = {
  ok: true;
  baseUrl: string;
  deploymentMode: string;
} | {
  ok: false;
  step: string;
  message: string;
};

type SettingsValidateResponse = {
  valid: boolean;
  deploymentMode: string;
  cloudGenerationAvailable: boolean;
};

type AccountSummary = {
  accountId: string;
  email: string;
};

type HostedSession = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  account: AccountSummary;
};

type SessionResponse = {
  session: HostedSession;
  deploymentMode: string;
};

type PreferencesResponse = {
  preferences: {
    defaultTonePreset: string;
    defaultCostMode: string;
  };
};

type GenerationHistoryResponse = {
  generations: Array<{ generationId: string }>;
};

const ALL_TONE_PRESETS = [
  "professional",
  "friendly",
  "concise",
  "empathetic",
  "confident",
] as const;
const ALL_COST_MODES = [
  "local_only",
  "hybrid_low_cost",
  "cloud_quality",
] as const;

async function main(): Promise<void> {
  loadLocalEnv();
  const result = await runVerification();
  if (!result.ok) {
    console.error(`[verify:hosted] ${result.step} failed: ${result.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `[verify:hosted] passed against ${result.baseUrl} (${result.deploymentMode})`
  );
}

async function runVerification(): Promise<VerifyResult> {
  const baseUrl = (process.env.REPLYMATE_VERIFY_HOSTED_BASE_URL || "http://localhost:3000")
    .trim()
    .replace(/\/+$/, "");
  const email = process.env.REPLYMATE_VERIFY_BETA_EMAIL?.trim() || "";
  const inviteCode = process.env.REPLYMATE_VERIFY_BETA_INVITE_CODE?.trim() || "";

  if (!email || !inviteCode) {
    return {
      ok: false,
      step: "env",
      message:
        "Set REPLYMATE_VERIFY_BETA_EMAIL and REPLYMATE_VERIFY_BETA_INVITE_CODE before running verify:hosted.",
    };
  }

  const settings = await fetchJson<SettingsValidateResponse>({
    step: "settings.validate",
    url: `${baseUrl}/v1/settings/validate`,
    method: "POST",
    body: { client: "replymate-hosted-verify" },
  });

  if (!settings.ok) {
    return settings;
  }
  if (settings.data.deploymentMode === "local") {
    return {
      ok: false,
      step: "settings.validate",
      message: "Server is running in local mode, not hosted mode.",
    };
  }
  if (!settings.data.cloudGenerationAvailable) {
    return {
      ok: false,
      step: "settings.validate",
      message: "Hosted verification requires cloud generation to be available.",
    };
  }

  const betaLogin = await fetchJson<SessionResponse>({
    step: "auth.beta-login",
    url: `${baseUrl}/v1/auth/beta-login`,
    method: "POST",
    body: { email, inviteCode },
  });
  if (!betaLogin.ok) {
    return betaLogin;
  }

  const refreshed = await fetchJson<SessionResponse>({
    step: "auth.refresh",
    url: `${baseUrl}/v1/auth/refresh`,
    method: "POST",
    body: { refreshToken: betaLogin.data.session.refreshToken },
  });
  if (!refreshed.ok) {
    return refreshed;
  }

  const accessToken = refreshed.data.session.accessToken;
  const me = await fetchJson<{ account: AccountSummary }>({
    step: "me",
    url: `${baseUrl}/v1/me`,
    method: "GET",
    accessToken,
  });
  if (!me.ok) {
    return me;
  }

  const originalPreferences = await fetchJson<PreferencesResponse>({
    step: "preferences.get",
    url: `${baseUrl}/v1/me/preferences`,
    method: "GET",
    accessToken,
  });
  if (!originalPreferences.ok) {
    return originalPreferences;
  }

  const nextPreferences = {
    defaultTonePreset: pickAlternate(
      originalPreferences.data.preferences.defaultTonePreset,
      ALL_TONE_PRESETS
    ),
    defaultCostMode: pickAlternate(
      originalPreferences.data.preferences.defaultCostMode,
      ALL_COST_MODES
    ),
  };

  const savedPreferences = await fetchJson<PreferencesResponse>({
    step: "preferences.put",
    url: `${baseUrl}/v1/me/preferences`,
    method: "PUT",
    accessToken,
    body: nextPreferences,
  });
  if (!savedPreferences.ok) {
    return savedPreferences;
  }

  const roundTrippedPreferences = await fetchJson<PreferencesResponse>({
    step: "preferences.roundtrip",
    url: `${baseUrl}/v1/me/preferences`,
    method: "GET",
    accessToken,
  });
  if (!roundTrippedPreferences.ok) {
    return roundTrippedPreferences;
  }

  if (
    roundTrippedPreferences.data.preferences.defaultTonePreset !== nextPreferences.defaultTonePreset ||
    roundTrippedPreferences.data.preferences.defaultCostMode !== nextPreferences.defaultCostMode
  ) {
    return {
      ok: false,
      step: "preferences.roundtrip",
      message: "Hosted preferences did not persist the updated values.",
    };
  }

  const history = await fetchJson<GenerationHistoryResponse>({
    step: "generations",
    url: `${baseUrl}/v1/me/generations`,
    method: "GET",
    accessToken,
  });
  if (!history.ok) {
    return history;
  }
  if (!Array.isArray(history.data.generations)) {
    return {
      ok: false,
      step: "generations",
      message: "Generation history payload is invalid.",
    };
  }

  await fetchJson<PreferencesResponse>({
    step: "preferences.restore",
    url: `${baseUrl}/v1/me/preferences`,
    method: "PUT",
    accessToken,
    body: originalPreferences.data.preferences,
  });

  return {
    ok: true,
    baseUrl,
    deploymentMode: settings.data.deploymentMode,
  };
}

async function fetchJson<T>(input: {
  step: string;
  url: string;
  method: "GET" | "POST" | "PUT";
  accessToken?: string;
  body?: unknown;
}): Promise<{ ok: true; data: T } | VerifyResult> {
  try {
    const response = await fetch(input.url, {
      method: input.method,
      headers: {
        ...(input.body ? { "Content-Type": "application/json" } : {}),
        ...(input.accessToken ? { Authorization: `Bearer ${input.accessToken}` } : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
    });
    const payload = (await response.json()) as T & { message?: string };

    if (!response.ok) {
      return {
        ok: false,
        step: input.step,
        message: payload.message || `${response.status} ${response.statusText}`,
      };
    }

    return {
      ok: true,
      data: payload,
    };
  } catch (error) {
    return {
      ok: false,
      step: input.step,
      message: error instanceof Error ? error.message : "Unexpected hosted verification error.",
    };
  }
}

function pickAlternate<T extends readonly string[]>(current: string, choices: T): T[number] {
  return (choices.find((choice) => choice !== current) || choices[0]) as T[number];
}

void main();
