import { afterEach, describe, expect, it, vi } from "vitest";
import { describeDatabaseConnectionError, describePendingMigrationError } from "../db.js";

describe("describeDatabaseConnectionError", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a clear hosted setup message for connection-refused errors", () => {
    vi.stubEnv(
      "REPLYMATE_DATABASE_URL",
      "postgres://replymate:secret@127.0.0.1:5432/replymate"
    );

    const error = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
      code: "ECONNREFUSED",
    });

    expect(describeDatabaseConnectionError(error)).toContain(
      "Could not connect to Postgres at postgres://replymate:secret@127.0.0.1:5432/replymate."
    );
    expect(describeDatabaseConnectionError(error)).toContain(
      "npm run migrate --workspace @replymate/api"
    );
  });

  it("falls back to the underlying error message for non-network errors", () => {
    expect(describeDatabaseConnectionError(new Error("password authentication failed"))).toBe(
      "Could not connect to Postgres for ReplyMate hosted state: password authentication failed"
    );
  });
});

describe("describePendingMigrationError", () => {
  it("returns a migrate instruction when hosted schema is behind", () => {
    expect(
      describePendingMigrationError([
        "0002_billing_and_auth.sql",
      ])
    ).toContain("npm run migrate --workspace @replymate/api");

    expect(
      describePendingMigrationError([
        "0002_billing_and_auth.sql",
      ])
    ).toContain("0002_billing_and_auth.sql");
  });

  it("summarizes longer pending migration lists", () => {
    expect(
      describePendingMigrationError([
        "0002_billing_and_auth.sql",
        "0003_example.sql",
        "0004_example.sql",
        "0005_example.sql",
      ])
    ).toContain("and 1 more");
  });
});
