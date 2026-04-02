import path from "node:path";
import { resolveDeploymentMode } from "../core/authSession.js";
import { getSharedDatabasePool, hasDatabaseUrl } from "./db.js";
import type { BillingRepository } from "./BillingRepository.js";
import type { HostedStateRepository } from "./HostedStateRepository.js";
import { JsonFileHostedStateRepository } from "./JsonFileHostedStateRepository.js";
import { NullBillingRepository } from "./NullBillingRepository.js";
import { PostgresBillingRepository } from "./PostgresBillingRepository.js";
import { PostgresHostedStateRepository } from "./PostgresHostedStateRepository.js";

export function resolveHostedStateFilePath(): string {
  return (
    process.env.REPLYMATE_PERSISTENCE_FILE?.trim() ||
    path.join(process.cwd(), ".replymate-data", "hosted-state.json")
  );
}

export function createHostedStateRepository(): HostedStateRepository {
  const deploymentMode = resolveDeploymentMode();
  if (hasDatabaseUrl()) {
    return new PostgresHostedStateRepository(getSharedDatabasePool());
  }

  if (deploymentMode !== "local") {
    throw new Error(
      "Hosted ReplyMate deployments require REPLYMATE_DATABASE_URL for Postgres-backed state."
    );
  }

  return new JsonFileHostedStateRepository(resolveHostedStateFilePath());
}

export function createBillingRepository(): BillingRepository {
  const deploymentMode = resolveDeploymentMode();
  if (hasDatabaseUrl()) {
    return new PostgresBillingRepository(getSharedDatabasePool());
  }

  if (deploymentMode !== "local") {
    throw new Error(
      "Hosted ReplyMate deployments require REPLYMATE_DATABASE_URL for billing and auth state."
    );
  }

  return new NullBillingRepository();
}
