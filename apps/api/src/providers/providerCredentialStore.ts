import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  CloudProviderKind,
  LocalProviderKind,
  ProviderCredentialDeleteRequest,
  ProviderCredentialRef,
  ProviderCredentialState,
  ProviderCredentialStatusResponse,
  ProviderCredentialUpsertRequest,
} from "@replymate/contracts";
import { ApiError } from "../core/errors.js";

const execFileAsync = promisify(execFile);
const KEYCHAIN_SERVICE = "app.replymate.local.providers";

type ProviderCredentialStore = {
  getStatus(): ProviderCredentialStatusResponse["storage"];
  readCredential(input: ProviderCredentialRef): Promise<string | null>;
  writeCredential(input: ProviderCredentialUpsertRequest): Promise<void>;
  deleteCredential(input: ProviderCredentialDeleteRequest): Promise<void>;
};

const LOCAL_KINDS: LocalProviderKind[] = ["ollama", "openai_compatible_local"];
const CLOUD_KINDS: CloudProviderKind[] = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "openai_compatible_custom",
];

function buildAccountKey(input: ProviderCredentialRef): string {
  return `${input.target}:${input.kind}`;
}

function getAllCredentialRefs(): ProviderCredentialRef[] {
  return [
    ...LOCAL_KINDS.map((kind) => ({ target: "local" as const, kind })),
    ...CLOUD_KINDS.map((kind) => ({ target: "cloud" as const, kind })),
  ];
}

class MemoryProviderCredentialStore implements ProviderCredentialStore {
  private readonly values = new Map<string, string>();

  getStatus(): ProviderCredentialStatusResponse["storage"] {
    return {
      backend: "memory",
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
  getStatus(): ProviderCredentialStatusResponse["storage"] {
    return {
      backend: "unsupported",
      supported: false,
      message:
        "Secure provider credential storage is currently supported only on macOS. ReplyMate store launch remains blocked until other platforms have native secure storage too.",
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
  getStatus(): ProviderCredentialStatusResponse["storage"] {
    return {
      backend: "macos_keychain",
      supported: true,
      message: "Provider keys are stored in the macOS Keychain by your local ReplyMate API.",
    };
  }

  async readCredential(input: ProviderCredentialRef): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("security", [
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
      await execFileAsync("security", [
        "add-generic-password",
        "-U",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        buildAccountKey(input),
        "-w",
        input.apiKey,
      ]);
    } catch (error) {
      throw new ApiError({
        message: "ReplyMate could not save the provider key into the macOS Keychain.",
        errorCode: "CREDENTIAL_STORAGE_UNAVAILABLE",
        statusCode: 500,
        details: {
          cause: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  async deleteCredential(input: ProviderCredentialDeleteRequest): Promise<void> {
    try {
      await execFileAsync("security", [
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

let singletonStore: ProviderCredentialStore | null = null;

export function getProviderCredentialStore(): ProviderCredentialStore {
  if (singletonStore) {
    return singletonStore;
  }

  const configured = process.env.REPLYMATE_PROVIDER_CREDENTIAL_STORE?.trim();
  if (configured === "memory" || process.env.NODE_ENV === "test") {
    singletonStore = new MemoryProviderCredentialStore();
    return singletonStore;
  }

  if (process.platform === "darwin") {
    singletonStore = new MacOsKeychainProviderCredentialStore();
    return singletonStore;
  }

  singletonStore = new UnsupportedProviderCredentialStore();
  return singletonStore;
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
