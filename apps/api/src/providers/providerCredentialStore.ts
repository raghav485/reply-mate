import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, platform as runtimePlatform } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type {
  CloudProviderKind,
  LocalProviderKind,
  ProviderCredentialDeleteRequest,
  ProviderCredentialRef,
  ProviderCredentialState,
  ProviderCredentialStatusResponse,
  ProviderCredentialStoragePlatform,
  ProviderCredentialUpsertRequest,
} from "@replymate/contracts";
import { ApiError } from "../core/errors.js";

const execFileAsync = promisify(execFile);
const KEYCHAIN_SERVICE = "app.replymate.local.providers";
const WINDOWS_STORE_VERSION = 1;
const WINDOWS_CREDENTIALS_FILE = "provider-credentials.v1.json";

type ProviderCredentialStore = {
  getStatus(): ProviderCredentialStatusResponse["storage"];
  readCredential(input: ProviderCredentialRef): Promise<string | null>;
  writeCredential(input: ProviderCredentialUpsertRequest): Promise<void>;
  deleteCredential(input: ProviderCredentialDeleteRequest): Promise<void>;
};

type ProcessRunner = {
  execFile: typeof execFileAsync;
  spawn(command: string, args: string[], input?: string): Promise<{ stdout: string; stderr: string }>;
};

type StoreDependencies = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  processRunner?: ProcessRunner;
  credentialsRoot?: string;
};

type WindowsStoreFile = {
  version: number;
  entries: Record<
    string,
    {
      ciphertext: string;
      updatedAt: string;
      hash: string;
    }
  >;
};

const LOCAL_KINDS: LocalProviderKind[] = ["ollama", "openai_compatible_local"];
const CLOUD_KINDS: CloudProviderKind[] = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "openai_compatible_custom",
];

const DEFAULT_PROCESS_RUNNER: ProcessRunner = {
  execFile: execFileAsync,
  spawn(command, args, input) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(new Error(stderr.trim() || `${command} exited with code ${code ?? 1}.`));
      });

      if (input !== undefined) {
        child.stdin.write(input);
      }
      child.stdin.end();
    });
  },
};

function getPlatformName(platform: NodeJS.Platform): ProviderCredentialStoragePlatform {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";
  return "unknown";
}

function buildAccountKey(input: ProviderCredentialRef): string {
  return `${input.target}:${input.kind}`;
}

function hashAccountKey(input: ProviderCredentialRef): string {
  return createHash("sha256").update(buildAccountKey(input)).digest("hex");
}

function getAllCredentialRefs(): ProviderCredentialRef[] {
  return [
    ...LOCAL_KINDS.map((kind) => ({ target: "local" as const, kind })),
    ...CLOUD_KINDS.map((kind) => ({ target: "cloud" as const, kind })),
  ];
}

class MemoryProviderCredentialStore implements ProviderCredentialStore {
  private readonly values = new Map<string, string>();

  constructor(private readonly platformName: ProviderCredentialStoragePlatform) {}

  getStatus(): ProviderCredentialStatusResponse["storage"] {
    return {
      backend: "memory",
      platform: this.platformName,
      persistenceMode: "session_only",
      supported: true,
      message: "ReplyMate is using an in-memory credential store for tests.",
    };
  }

  async readCredential(input: ProviderCredentialRef): Promise<string | null> {
    return this.values.get(buildAccountKey(input)) || null;
  }

  async writeCredential(input: ProviderCredentialUpsertRequest): Promise<void> {
    this.values.set(buildAccountKey(input), input.apiKey);
  }

  async deleteCredential(input: ProviderCredentialDeleteRequest): Promise<void> {
    this.values.delete(buildAccountKey(input));
  }
}

class UnsupportedProviderCredentialStore implements ProviderCredentialStore {
  constructor(
    private readonly platformName: ProviderCredentialStoragePlatform,
    private readonly message: string
  ) {}

  getStatus(): ProviderCredentialStatusResponse["storage"] {
    return {
      backend: "unsupported",
      platform: this.platformName,
      persistenceMode: "unsupported",
      supported: false,
      message: this.message,
    };
  }

  async readCredential(_input: ProviderCredentialRef): Promise<string | null> {
    return null;
  }

  async writeCredential(_input: ProviderCredentialUpsertRequest): Promise<void> {
    throw new ApiError({
      message: this.getStatus().message || "Secure provider credential storage is unavailable.",
      errorCode: "CREDENTIAL_STORAGE_UNAVAILABLE",
      statusCode: 501,
    });
  }

  async deleteCredential(_input: ProviderCredentialDeleteRequest): Promise<void> {
    return;
  }
}

class MacOsKeychainProviderCredentialStore implements ProviderCredentialStore {
  constructor(private readonly processRunner: ProcessRunner) {}

  getStatus(): ProviderCredentialStatusResponse["storage"] {
    return {
      backend: "macos_keychain",
      platform: "macos",
      persistenceMode: "persistent_secure",
      supported: true,
      message: "Provider keys are stored in the macOS Keychain by your local ReplyMate runtime.",
    };
  }

  async readCredential(input: ProviderCredentialRef): Promise<string | null> {
    try {
      const { stdout } = await this.processRunner.execFile("security", [
        "find-generic-password",
        "-w",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        buildAccountKey(input),
      ]);
      const value = stdout.trim();
      return value || null;
    } catch {
      return null;
    }
  }

  async writeCredential(input: ProviderCredentialUpsertRequest): Promise<void> {
    try {
      await this.processRunner.spawn(
        "security",
        [
          "add-generic-password",
          "-U",
          "-s",
          KEYCHAIN_SERVICE,
          "-a",
          buildAccountKey(input),
          "-w",
        ],
        `${input.apiKey}\n`
      );
    } catch {
      throw new ApiError({
        message: "ReplyMate could not save the provider key into the macOS Keychain.",
        errorCode: "CREDENTIAL_STORAGE_UNAVAILABLE",
        statusCode: 500,
      });
    }
  }

  async deleteCredential(input: ProviderCredentialDeleteRequest): Promise<void> {
    try {
      await this.processRunner.execFile("security", [
        "delete-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        buildAccountKey(input),
      ]);
    } catch {
      // Missing keychain entries are fine.
    }
  }
}

class WindowsDpapiProviderCredentialStore implements ProviderCredentialStore {
  private corruptionWarning: string | null = null;

  constructor(
    private readonly storePath: string,
    private readonly processRunner: ProcessRunner
  ) {}

  getStatus(): ProviderCredentialStatusResponse["storage"] {
    return {
      backend: "windows_dpapi",
      platform: "windows",
      persistenceMode: "persistent_secure",
      supported: true,
      message:
        this.corruptionWarning ||
        "Provider keys are stored with Windows DPAPI under your local user profile.",
    };
  }

  async readCredential(input: ProviderCredentialRef): Promise<string | null> {
    const file = await this.readStoreFile();
    const entry = file.entries[hashAccountKey(input)];
    if (!entry?.ciphertext) {
      return null;
    }
    return this.decrypt(entry.ciphertext);
  }

  async writeCredential(input: ProviderCredentialUpsertRequest): Promise<void> {
    const file = await this.readStoreFile();
    file.entries[hashAccountKey(input)] = {
      ciphertext: await this.encrypt(input.apiKey),
      updatedAt: new Date().toISOString(),
      hash: hashAccountKey(input),
    };
    await this.writeStoreFile(file);
  }

  async deleteCredential(input: ProviderCredentialDeleteRequest): Promise<void> {
    const file = await this.readStoreFile();
    delete file.entries[hashAccountKey(input)];
    if (Object.keys(file.entries).length === 0) {
      await rm(this.storePath, { force: true }).catch(() => {});
      return;
    }
    await this.writeStoreFile(file);
  }

  private async encrypt(value: string): Promise<string> {
    const script = [
      "$inputText = [Console]::In.ReadToEnd()",
      "$bytes = [System.Text.Encoding]::UTF8.GetBytes($inputText)",
      "$encrypted = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
      "[Convert]::ToBase64String($encrypted)",
    ].join(";");
    const { stdout } = await this.processRunner.spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      value
    );
    return stdout.trim();
  }

  private async decrypt(ciphertext: string): Promise<string | null> {
    try {
      const script = [
        "$inputText = [Console]::In.ReadToEnd().Trim()",
        "$bytes = [Convert]::FromBase64String($inputText)",
        "$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
        "[System.Text.Encoding]::UTF8.GetString($decrypted)",
      ].join(";");
      const { stdout } = await this.processRunner.spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        ciphertext
      );
      const value = stdout.trim();
      return value || null;
    } catch {
      return null;
    }
  }

  private async readStoreFile(): Promise<WindowsStoreFile> {
    if (!existsSync(this.storePath)) {
      return {
        version: WINDOWS_STORE_VERSION,
        entries: {},
      };
    }

    try {
      const raw = await readFile(this.storePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<WindowsStoreFile>;
      if (parsed.version !== WINDOWS_STORE_VERSION || typeof parsed.entries !== "object" || !parsed.entries) {
        throw new Error("Unsupported credential store schema.");
      }
      return {
        version: WINDOWS_STORE_VERSION,
        entries: Object.fromEntries(
          Object.entries(parsed.entries).filter((entry): entry is [string, WindowsStoreFile["entries"][string]] => {
            const value = entry[1];
            return Boolean(
              value &&
                typeof value === "object" &&
                typeof value.ciphertext === "string" &&
                typeof value.updatedAt === "string" &&
                typeof value.hash === "string"
            );
          })
        ),
      };
    } catch {
      const corruptedPath = `${this.storePath}.corrupt-${Date.now()}-${randomUUID()}`;
      await mkdir(dirname(corruptedPath), { recursive: true });
      await copyFile(this.storePath, corruptedPath).catch(() => {});
      await rm(this.storePath, { force: true }).catch(() => {});
      this.corruptionWarning =
        "ReplyMate detected a corrupted Windows credential store and reset it safely. Stored provider keys need to be re-entered.";
      return {
        version: WINDOWS_STORE_VERSION,
        entries: {},
      };
    }
  }

  private async writeStoreFile(file: WindowsStoreFile): Promise<void> {
    await mkdir(dirname(this.storePath), { recursive: true });
    const tempPath = `${this.storePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, JSON.stringify(file, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tempPath, this.storePath);
  }
}

function resolveWindowsCredentialStorePath(
  env: NodeJS.ProcessEnv,
  credentialsRoot?: string
): string {
  const base =
    credentialsRoot ||
    env.LOCALAPPDATA ||
    join(homedir(), "AppData", "Local");
  return join(base, "ReplyMate", "credentials", WINDOWS_CREDENTIALS_FILE);
}

export function createProviderCredentialStore(
  dependencies: StoreDependencies = {}
): ProviderCredentialStore {
  const platform = dependencies.platform ?? runtimePlatform();
  const env = dependencies.env ?? process.env;
  const processRunner = dependencies.processRunner ?? DEFAULT_PROCESS_RUNNER;
  const platformName = getPlatformName(platform);
  const configured = env.REPLYMATE_PROVIDER_CREDENTIAL_STORE?.trim();

  if (configured === "memory" || env.NODE_ENV === "test") {
    return new MemoryProviderCredentialStore(platformName);
  }

  if (platform === "darwin") {
    return new MacOsKeychainProviderCredentialStore(processRunner);
  }

  if (platform === "win32") {
    return new WindowsDpapiProviderCredentialStore(
      resolveWindowsCredentialStorePath(env, dependencies.credentialsRoot),
      processRunner
    );
  }

  return new UnsupportedProviderCredentialStore(
    platformName,
    "Secure provider credential storage is not supported on this OS in this ReplyMate milestone."
  );
}

let singletonStore: ProviderCredentialStore | null = null;

export function getProviderCredentialStore(): ProviderCredentialStore {
  if (singletonStore) {
    return singletonStore;
  }

  singletonStore = createProviderCredentialStore();
  return singletonStore;
}

export function resetProviderCredentialStoreForTests(): void {
  singletonStore = null;
}

export async function hydrateProviderConfigSecrets<
  T extends {
    local: { kind: LocalProviderKind; apiKey: string; hasStoredApiKey: boolean };
    cloud: { kind: CloudProviderKind; apiKey: string; hasStoredApiKey: boolean };
  },
>(config: T | undefined, store: ProviderCredentialStore): Promise<T | undefined> {
  if (!config) {
    return undefined;
  }

  const next: T = {
    ...config,
    local: { ...config.local },
    cloud: { ...config.cloud },
  };

  if (next.local.hasStoredApiKey && !next.local.apiKey.trim()) {
    next.local.apiKey =
      (await store.readCredential({
        target: "local",
        kind: next.local.kind,
      })) || "";
  }

  if (next.cloud.hasStoredApiKey && !next.cloud.apiKey.trim()) {
    next.cloud.apiKey =
      (await store.readCredential({
        target: "cloud",
        kind: next.cloud.kind,
      })) || "";
  }

  return next;
}

export async function buildProviderCredentialStatusResponse(
  store: ProviderCredentialStore = getProviderCredentialStore()
): Promise<ProviderCredentialStatusResponse> {
  const credentials: ProviderCredentialState[] = [];
  for (const ref of getAllCredentialRefs()) {
    credentials.push({
      ...ref,
      hasStoredApiKey: Boolean(await store.readCredential(ref)),
    });
  }

  return {
    apiVersion: "v1",
    storage: store.getStatus(),
    credentials,
  };
}

export type { ProviderCredentialStore, StoreDependencies };
