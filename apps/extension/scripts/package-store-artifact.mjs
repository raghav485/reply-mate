import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(scriptDir, "..");
const distDir = path.resolve(extensionRoot, "dist");
const artifactsDir = path.resolve(extensionRoot, "store-artifacts");

function readJson(filePath) {
  return fs.readFile(filePath, "utf8").then((raw) => JSON.parse(raw));
}

async function ensureStoreManifest() {
  const manifest = await readJson(path.join(distDir, "manifest.json"));
  const matches = manifest.content_scripts?.flatMap((entry) => entry.matches ?? []) ?? [];

  if (!matches.includes("https://*/*")) {
    throw new Error(
      "dist/manifest.json does not look like the store manifest. Run `npm run build:store --workspace @replymate/extension` first."
    );
  }

  if (matches.includes("file://*/*")) {
    throw new Error("dist/manifest.json still includes dev-only file access. Rebuild with build:store first.");
  }
}

async function main() {
  await ensureStoreManifest();

  const extensionPackage = await readJson(path.join(extensionRoot, "package.json"));
  const artifactName = `replymate-chrome-store-v${extensionPackage.version}.zip`;
  const artifactPath = path.join(artifactsDir, artifactName);

  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.rm(artifactPath, { force: true });

  const entries = (await fs.readdir(distDir)).sort();
  if (entries.length === 0) {
    throw new Error("apps/extension/dist is empty. Build the store bundle before packaging it.");
  }

  if (process.platform === "win32") {
    const escapedEntries = entries.map((entry) => `'${entry.replace(/'/g, "''")}'`).join(", ");
    const escapedDestination = artifactPath.replace(/'/g, "''");
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path ${escapedEntries} -DestinationPath '${escapedDestination}' -Force`,
    ], { cwd: distDir });
  } else {
    await execFileAsync(
      "zip",
      ["-qr", artifactPath, ...entries],
      { cwd: distDir }
    );
  }

  console.log(`Store upload ZIP created at ${artifactPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
