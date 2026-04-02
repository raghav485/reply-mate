import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findInviteByCredentials,
  refreshHostedSession,
  revokeSessionFromAccessToken,
  issueHostedBetaSession,
  parseBetaInvites,
  readAccountFromSessionToken,
} from "../authSession.js";
import { createHostedStateRepository } from "../../persistence/index.js";

describe("authSession", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses beta invite entries from env syntax", () => {
    const invites = parseBetaInvites(
      "beta@replymate.app:invite-1:beta:Beta Tester;pro@replymate.app:invite-2:pro:Pro User"
    );

    expect(invites).toHaveLength(2);
    expect(invites[0]).toMatchObject({
      email: "beta@replymate.app",
      inviteCode: "invite-1",
      plan: "beta",
      displayName: "Beta Tester",
    });
  });

  it("matches invite credentials and round-trips a signed session token", async () => {
    vi.stubEnv("REPLYMATE_AUTH_SESSION_SECRET", "test-secret");
    vi.stubEnv(
      "REPLYMATE_PERSISTENCE_FILE",
      `/tmp/replymate-auth-session-test-${Date.now()}.json`
    );

    const invite = findInviteByCredentials({
      email: "beta@replymate.app",
      inviteCode: "invite-1",
      invites: parseBetaInvites("beta@replymate.app:invite-1:beta:Beta Tester"),
    });

    if (!invite) {
      throw new Error("Expected invite to resolve.");
    }

    const repository = createHostedStateRepository();
    const session = await issueHostedBetaSession({
      invite,
      repository,
      nowMs: Date.now(),
    });
    const account = await readAccountFromSessionToken({
      token: session.session.accessToken,
      repository,
    });

    expect(account?.account).toMatchObject({
      email: "beta@replymate.app",
      plan: "beta",
      subscriptionState: "beta",
      betaAccess: true,
    });
  });

  it("refreshes and revokes hosted sessions against the repository", async () => {
    vi.stubEnv("REPLYMATE_AUTH_SESSION_SECRET", "test-secret");
    vi.stubEnv(
      "REPLYMATE_PERSISTENCE_FILE",
      `/tmp/replymate-auth-session-refresh-${Date.now()}.json`
    );

    const invite = findInviteByCredentials({
      email: "beta@replymate.app",
      inviteCode: "invite-1",
      invites: parseBetaInvites("beta@replymate.app:invite-1:beta:Beta Tester"),
    });
    if (!invite) {
      throw new Error("Expected invite to resolve.");
    }

    const repository = createHostedStateRepository();
    const issued = await issueHostedBetaSession({
      invite,
      repository,
      nowMs: Date.now(),
    });

    const refreshed = await refreshHostedSession({
      refreshToken: issued.session.refreshToken,
      repository,
    });
    expect(refreshed.session.accessToken).toBeTruthy();

    expect(
      await readAccountFromSessionToken({
        token: issued.session.accessToken,
        repository,
      })
    ).not.toBeNull();

    await revokeSessionFromAccessToken({
      token: refreshed.session.accessToken,
      repository,
    });

    await expect(
      readAccountFromSessionToken({
        token: refreshed.session.accessToken,
        repository,
      })
    ).resolves.toBeNull();
  });
});
