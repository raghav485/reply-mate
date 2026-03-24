import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(repoRoot, ".env.example");
const targetPath = resolve(repoRoot, ".env.local");

if (existsSync(targetPath)) {
  console.log(".env.local already exists; left unchanged.");
  process.exit(0);
}

copyFileSync(sourcePath, targetPath);
console.log("Created .env.local from .env.example.");
console.log("Edit .env.local if you want machine-specific local overrides.");
