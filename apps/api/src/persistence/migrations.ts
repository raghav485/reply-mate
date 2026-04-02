import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const MIGRATIONS_TABLE = "replymate_schema_migrations";

export function resolveMigrationsDir(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(currentDir, "migrations");
}

export async function listMigrationFiles(
  migrationsDir = resolveMigrationsDir()
): Promise<string[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export async function listPendingMigrationFiles(input: {
  pool: Pool;
  migrationsDir?: string;
}): Promise<string[]> {
  const migrationsDir = input.migrationsDir || resolveMigrationsDir();
  const files = await listMigrationFiles(migrationsDir);
  const migrationsTableName = `${MIGRATIONS_TABLE}`;
  const tableLookup = await input.pool.query<{ name: string | null }>(
    "SELECT to_regclass($1) AS name",
    [migrationsTableName]
  );

  if (!tableLookup.rows[0]?.name) {
    return files;
  }

  const appliedRows = await input.pool.query<{ name: string }>(
    `SELECT name FROM ${MIGRATIONS_TABLE}`
  );
  const appliedNames = new Set(appliedRows.rows.map((row) => row.name));
  return files.filter((fileName) => !appliedNames.has(fileName));
}

export async function runMigrations(input: {
  pool: Pool;
  migrationsDir?: string;
  onApplied?: (fileName: string) => void;
}): Promise<{ applied: string[]; skipped: string[] }> {
  const migrationsDir = input.migrationsDir || resolveMigrationsDir();
  const files = await listMigrationFiles(migrationsDir);
  const client = await input.pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const appliedRows = await client.query<{ name: string }>(
      `SELECT name FROM ${MIGRATIONS_TABLE}`
    );
    const appliedNames = new Set(appliedRows.rows.map((row) => row.name));
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const fileName of files) {
      if (appliedNames.has(fileName)) {
        skipped.push(fileName);
        continue;
      }

      const sql = await readFile(path.join(migrationsDir, fileName), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ($1)`, [fileName]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      applied.push(fileName);
      input.onApplied?.(fileName);
    }

    return { applied, skipped };
  } finally {
    client.release();
  }
}
