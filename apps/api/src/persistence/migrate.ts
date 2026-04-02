import { loadLocalEnv } from "../bootstrap/loadEnv.js";
import { closeSharedDatabasePool, getSharedDatabasePool } from "./db.js";
import { runMigrations } from "./migrations.js";

async function main(): Promise<void> {
  loadLocalEnv();
  const result = await runMigrations({
    pool: getSharedDatabasePool(),
    onApplied: (fileName) => {
      console.log(`Applied migration: ${fileName}`);
    },
  });

  if (result.applied.length === 0) {
    console.log("No pending migrations.");
    return;
  }

  console.log(`Migration complete. Applied ${result.applied.length} migration(s).`);
}

main()
  .catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Migration failed with an unknown error."
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeSharedDatabasePool();
  });
