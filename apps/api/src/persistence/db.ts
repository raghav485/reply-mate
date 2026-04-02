import { Pool, type PoolConfig } from "pg";
import { listPendingMigrationFiles } from "./migrations.js";

let sharedPool: Pool | null = null;

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.REPLYMATE_DATABASE_URL?.trim());
}

export function resolveDatabaseUrl(): string {
  const databaseUrl = process.env.REPLYMATE_DATABASE_URL?.trim() || "";
  if (!databaseUrl) {
    throw new Error(
      "REPLYMATE_DATABASE_URL is required for Postgres-backed ReplyMate hosted state."
    );
  }
  return databaseUrl;
}

export function createDatabasePool(
  overrides: Partial<PoolConfig> = {}
): Pool {
  return new Pool({
    connectionString: resolveDatabaseUrl(),
    ...overrides,
  });
}

export function describeDatabaseConnectionError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as Error & { code?: string }).code;
    if (code === "ECONNREFUSED") {
      return `Could not connect to Postgres at ${resolveDatabaseUrl()}. Make sure Postgres is running, the database exists, and then run \`npm run migrate --workspace @replymate/api\`.`;
    }
    return `Could not connect to Postgres for ReplyMate hosted state: ${error.message}`;
  }

  return "Could not connect to Postgres for ReplyMate hosted state.";
}

export function describePendingMigrationError(pendingMigrations: string[]): string {
  if (pendingMigrations.length === 0) {
    return "ReplyMate hosted database migrations are up to date.";
  }

  const listed = pendingMigrations.slice(0, 3).join(", ");
  const suffix =
    pendingMigrations.length > 3
      ? ` and ${pendingMigrations.length - 3} more`
      : "";

  return `ReplyMate hosted database is missing required migrations (${listed}${suffix}). Run \`npm run migrate --workspace @replymate/api\` before starting the API.`;
}

export function getSharedDatabasePool(): Pool {
  if (!sharedPool) {
    sharedPool = createDatabasePool();
  }
  return sharedPool;
}

export async function assertDatabaseConnection(): Promise<void> {
  try {
    await getSharedDatabasePool().query("SELECT 1");
  } catch (error) {
    throw new Error(describeDatabaseConnectionError(error));
  }
}

export async function assertDatabaseSchemaUpToDate(): Promise<void> {
  const pendingMigrations = await listPendingMigrationFiles({
    pool: getSharedDatabasePool(),
  });

  if (pendingMigrations.length > 0) {
    throw new Error(describePendingMigrationError(pendingMigrations));
  }
}

export async function closeSharedDatabasePool(): Promise<void> {
  if (!sharedPool) {
    return;
  }
  const pool = sharedPool;
  sharedPool = null;
  await pool.end();
}
