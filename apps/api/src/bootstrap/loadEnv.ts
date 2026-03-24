import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as nodeUtil from "node:util";
import { fileURLToPath } from "node:url";

type LoadLocalEnvOptions = {
  repoRoot?: string;
  envFiles?: string[];
};

function resolveRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
}

function parseEnvContent(content: string): Record<string, string> {
  const parseEnv = (nodeUtil as { parseEnv?: (input: string) => Record<string, string> }).parseEnv;
  if (typeof parseEnv === "function") {
    return parseEnv(content);
  }

  const parsed: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }

  return parsed;
}

export function loadLocalEnv(options: LoadLocalEnvOptions = {}): void {
  const repoRoot = options.repoRoot || resolveRepoRoot();
  const envFiles = options.envFiles || [".env.example", ".env.local"];
  const originalKeys = new Set(Object.keys(process.env));

  for (const relativePath of envFiles) {
    const absolutePath = resolve(repoRoot, relativePath);
    if (!existsSync(absolutePath)) continue;

    const parsed = parseEnvContent(readFileSync(absolutePath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (originalKeys.has(key)) continue;
      process.env[key] = value;
    }
  }
}
