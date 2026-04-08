import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const SECRET_FILE_NAME = "local-runtime-secret";

type RuntimeAuthFile = {
  version: 1;
  token: string;
  createdAt: string;
};

function resolveAuthRoot(): string {
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "ReplyMate");
  }
  return join(homedir(), ".replymate");
}

function resolveSecretPath(): string {
  return join(resolveAuthRoot(), SECRET_FILE_NAME);
}

async function writeSecretFile(path: string, payload: RuntimeAuthFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, path);
}

async function readSecretFile(path: string): Promise<RuntimeAuthFile | null> {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<RuntimeAuthFile>;
    if (parsed.version !== 1 || typeof parsed.token !== "string" || !parsed.token.trim()) {
      return null;
    }
    return {
      version: 1,
      token: parsed.token,
      createdAt:
        typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function loadOrCreateLocalRuntimeToken(): Promise<string> {
  const path = resolveSecretPath();
  const existing = await readSecretFile(path);
  if (existing) {
    return existing.token;
  }

  const token = randomBytes(32).toString("base64url");
  await writeSecretFile(path, {
    version: 1,
    token,
    createdAt: new Date().toISOString(),
  });
  return token;
}

export function getLocalRuntimeSecretPath(): string {
  return resolveSecretPath();
}
