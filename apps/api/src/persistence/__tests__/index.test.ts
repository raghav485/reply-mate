import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveDeploymentMode } from "../../core/authSession.js";
import { closeSharedDatabasePool } from "../db.js";
import { createHostedStateRepository } from "../index.js";
import { JsonFileHostedStateRepository } from "../JsonFileHostedStateRepository.js";
import { PostgresHostedStateRepository } from "../PostgresHostedStateRepository.js";

describe("createHostedStateRepository", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await closeSharedDatabasePool();
  });

  it("uses the JSON repository by default in local mode", () => {
    vi.stubEnv("REPLYMATE_DEPLOYMENT_MODE", "local");
    vi.stubEnv("REPLYMATE_DATABASE_URL", "");

    const repository = createHostedStateRepository();

    expect(resolveDeploymentMode()).toBe("local");
    expect(repository).toBeInstanceOf(JsonFileHostedStateRepository);
  });

  it("uses the Postgres repository when a database url is configured", () => {
    vi.stubEnv("REPLYMATE_DEPLOYMENT_MODE", "hosted_beta");
    vi.stubEnv("REPLYMATE_DATABASE_URL", "postgres://replymate:secret@localhost:5432/replymate");

    const repository = createHostedStateRepository();

    expect(repository).toBeInstanceOf(PostgresHostedStateRepository);
  });

  it("rejects hosted mode when the database url is missing", () => {
    vi.stubEnv("REPLYMATE_DEPLOYMENT_MODE", "hosted_beta");
    vi.stubEnv("REPLYMATE_DATABASE_URL", "");

    expect(() => createHostedStateRepository()).toThrow(
      "Hosted ReplyMate deployments require REPLYMATE_DATABASE_URL"
    );
  });
});
