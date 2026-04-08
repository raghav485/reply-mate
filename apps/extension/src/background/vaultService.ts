import type {
  ProviderCredentialDeleteRequest,
  ProviderCredentialRef,
  ProviderCredentialStatusResponse,
  ProviderCredentialUpsertRequest,
  VaultPasskeySetupRequest,
  VaultPassphraseSetupRequest,
  VaultPasskeyUnlockRequest,
  VaultPassphraseUnlockRequest,
  VaultStatus,
} from "@replymate/contracts";
import { ApiClientError } from "../shared-client/ApiClient.js";

const VAULT_STORAGE_KEY = "replymate:vault";
const HKDF_INFO = "replymate-vault-kek-v1";
const PASSPHRASE_ITERATIONS = 600_000;

type VaultEntryRecord = {
  target: ProviderCredentialRef["target"];
  kind: ProviderCredentialRef["kind"];
  ciphertextBase64: string;
  ivBase64: string;
  wrappedDekBase64: string;
  wrapIvBase64: string;
};

type PasskeyVaultMetadata = {
  credentialId: string;
  prfSaltBase64: string;
  hkdfSaltBase64: string;
};

type PassphraseVaultMetadata = {
  saltBase64: string;
  iterations: number;
};

type VaultRecord = {
  version: 1;
  mode: "passkey" | "passphrase";
  sessionCacheEnabled: boolean;
  passkey?: PasskeyVaultMetadata;
  passphrase?: PassphraseVaultMetadata;
  entries: VaultEntryRecord[];
};

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function buildCredentialKey(input: ProviderCredentialRef): string {
  return `${input.target}:${input.kind}`;
}

function sanitizeStatusMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function createVaultError(message: string, errorCode: string): ApiClientError {
  return new ApiClientError(message, 423, errorCode);
}

async function encryptBytes(key: CryptoKey, bytes: Uint8Array): Promise<{
  ciphertextBase64: string;
  ivBase64: string;
}> {
  const iv = randomBytes(12);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(bytes))
  );
  return {
    ciphertextBase64: toBase64(ciphertext),
    ivBase64: toBase64(iv),
  };
}

async function decryptBytes(
  key: CryptoKey,
  ciphertextBase64: string,
  ivBase64: string
): Promise<Uint8Array> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(fromBase64(ivBase64)) },
    // Decrypt accepts BufferSource; pass the raw ArrayBuffer to satisfy TS.
    key,
    toArrayBuffer(fromBase64(ciphertextBase64))
  );
  return new Uint8Array(decrypted);
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", toArrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function deriveKekFromPrfOutput(
  prfOutputBase64: string,
  hkdfSaltBase64: string
): Promise<CryptoKey> {
  const sourceKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(fromBase64(prfOutputBase64)),
    "HKDF",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt: toArrayBuffer(fromBase64(hkdfSaltBase64)),
      info: new TextEncoder().encode(HKDF_INFO),
      hash: "SHA-256",
    },
    sourceKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function deriveKekFromPassphrase(
  passphrase: string,
  saltBase64: string,
  iterations: number
): Promise<CryptoKey> {
  const sourceKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(fromBase64(saltBase64)),
      iterations,
      hash: "SHA-256",
    },
    sourceKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function wrapDek(kek: CryptoKey, dekRaw: Uint8Array): Promise<{
  wrappedDekBase64: string;
  wrapIvBase64: string;
}> {
  const wrapped = await encryptBytes(kek, dekRaw);
  return {
    wrappedDekBase64: wrapped.ciphertextBase64,
    wrapIvBase64: wrapped.ivBase64,
  };
}

async function unwrapDek(
  kek: CryptoKey,
  wrappedDekBase64: string,
  wrapIvBase64: string
): Promise<CryptoKey> {
  const raw = await decryptBytes(kek, wrappedDekBase64, wrapIvBase64);
  return importAesKey(raw);
}

export class VaultService {
  private unlockedKek: CryptoKey | null = null;
  private cache = new Map<string, string>();

  async initialize(): Promise<void> {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  }

  async getStatus(): Promise<ProviderCredentialStatusResponse> {
    const record = await this.readRecord();
    const vault = this.buildVaultStatus(record);

    return {
      apiVersion: "v1",
      storage: {
        backend: "extension_local_vault",
        platform: "extension",
        persistenceMode: "persistent_encrypted",
        supported: true,
        message: vault.message,
      },
      runtime: {
        transport: "extension_background",
        availability: "ready",
        extensionId: chrome.runtime.id,
        hostName: chrome.runtime.id,
        message:
          vault.lockState === "unlocked"
            ? "ReplyMate is using the extension vault. Decrypted keys live only in background memory."
            : "ReplyMate is using the extension vault. Unlock is required before BYOK requests can run.",
        actionHint:
          vault.lockState === "locked"
            ? "Chrome may relock ReplyMate when the background unloads."
            : undefined,
      },
      vault,
      credentials: (record?.entries || []).map((entry) => ({
        target: entry.target,
        kind: entry.kind,
        hasStoredApiKey: true,
      })),
    };
  }

  async setupWithPasskey(input: VaultPasskeySetupRequest): Promise<ProviderCredentialStatusResponse> {
    const hkdfSaltBase64 = toBase64(randomBytes(32));
    const kek = await deriveKekFromPrfOutput(input.prfOutputBase64, hkdfSaltBase64);
    const record = await this.upsertInitialRecord(
      {
        version: 1,
        mode: "passkey",
        sessionCacheEnabled: input.sessionCacheEnabled,
        passkey: {
          credentialId: input.credentialId,
          prfSaltBase64: input.prfSaltBase64,
          hkdfSaltBase64,
        },
        entries: [],
      },
      kek,
      input.initialCredential
    );
    await this.writeRecord(record);
    this.unlockedKek = kek;
    this.cache.clear();
    return this.getStatus();
  }

  async setupWithPassphrase(
    input: VaultPassphraseSetupRequest
  ): Promise<ProviderCredentialStatusResponse> {
    const saltBase64 = toBase64(randomBytes(32));
    const kek = await deriveKekFromPassphrase(
      input.passphrase,
      saltBase64,
      PASSPHRASE_ITERATIONS
    );
    const record = await this.upsertInitialRecord(
      {
        version: 1,
        mode: "passphrase",
        sessionCacheEnabled: input.sessionCacheEnabled,
        passphrase: {
          saltBase64,
          iterations: PASSPHRASE_ITERATIONS,
        },
        entries: [],
      },
      kek,
      input.initialCredential
    );
    await this.writeRecord(record);
    this.unlockedKek = kek;
    this.cache.clear();
    return this.getStatus();
  }

  async unlockWithPasskey(
    input: VaultPasskeyUnlockRequest
  ): Promise<ProviderCredentialStatusResponse> {
    const record = await this.requireRecord("VAULT_SETUP_REQUIRED");
    if (record.mode !== "passkey" || !record.passkey) {
      throw createVaultError("ReplyMate passkey vault is not configured.", "VAULT_SETUP_REQUIRED");
    }
    const kek = await deriveKekFromPrfOutput(
      input.prfOutputBase64,
      record.passkey.hkdfSaltBase64
    );
    await this.verifyUnlock(record, kek);
    this.unlockedKek = kek;
    this.cache.clear();
    return this.getStatus();
  }

  async unlockWithPassphrase(
    input: VaultPassphraseUnlockRequest
  ): Promise<ProviderCredentialStatusResponse> {
    const record = await this.requireRecord("VAULT_SETUP_REQUIRED");
    if (record.mode !== "passphrase" || !record.passphrase) {
      throw createVaultError(
        "ReplyMate passphrase vault is not configured.",
        "VAULT_SETUP_REQUIRED"
      );
    }
    const kek = await deriveKekFromPassphrase(
      input.passphrase,
      record.passphrase.saltBase64,
      record.passphrase.iterations
    );
    await this.verifyUnlock(record, kek);
    this.unlockedKek = kek;
    this.cache.clear();
    return this.getStatus();
  }

  async lock(): Promise<ProviderCredentialStatusResponse> {
    this.unlockedKek = null;
    this.cache.clear();
    return this.getStatus();
  }

  async saveCredential(
    input: ProviderCredentialUpsertRequest
  ): Promise<ProviderCredentialStatusResponse> {
    const record = await this.requireRecord("VAULT_SETUP_REQUIRED");
    const kek = this.requireUnlockedKek();
    const nextEntry = await this.encryptEntry(kek, input);
    const entryKey = buildCredentialKey(input);
    const nextEntries = record.entries.filter((entry) => buildCredentialKey(entry) !== entryKey);
    nextEntries.push(nextEntry);
    await this.writeRecord({
      ...record,
      entries: nextEntries,
    });
    this.cache.set(entryKey, input.apiKey);
    return this.getStatus();
  }

  async deleteCredential(
    input: ProviderCredentialDeleteRequest
  ): Promise<ProviderCredentialStatusResponse> {
    const record = await this.readRecord();
    if (!record) {
      return this.getStatus();
    }
    const nextEntries = record.entries.filter(
      (entry) => buildCredentialKey(entry) !== buildCredentialKey(input)
    );
    await this.writeRecord({
      ...record,
      entries: nextEntries,
    });
    this.cache.delete(buildCredentialKey(input));
    if (nextEntries.length === 0) {
      this.unlockedKek = null;
      this.cache.clear();
    }
    return this.getStatus();
  }

  async resolveCredential(input: ProviderCredentialRef): Promise<string | null> {
    const cacheKey = buildCredentialKey(input);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) || null;
    }
    const record = await this.readRecord();
    if (!record) {
      return null;
    }
    const entry = record.entries.find((item) => buildCredentialKey(item) === cacheKey);
    if (!entry) {
      return null;
    }
    const kek = this.requireUnlockedKek();
    const dek = await unwrapDek(kek, entry.wrappedDekBase64, entry.wrapIvBase64);
    const key = new TextDecoder().decode(
      await decryptBytes(dek, entry.ciphertextBase64, entry.ivBase64)
    );
    if (record.sessionCacheEnabled) {
      this.cache.set(cacheKey, key);
    }
    return key;
  }

  private async upsertInitialRecord(
    record: VaultRecord,
    kek: CryptoKey,
    initialCredential: ProviderCredentialUpsertRequest
  ): Promise<VaultRecord> {
    const nextEntry = await this.encryptEntry(kek, initialCredential);
    return {
      ...record,
      entries: [nextEntry],
    };
  }

  private async encryptEntry(
    kek: CryptoKey,
    input: ProviderCredentialUpsertRequest
  ): Promise<VaultEntryRecord> {
    const dekRaw = randomBytes(32);
    const dek = await importAesKey(dekRaw);
    const encrypted = await encryptBytes(dek, new TextEncoder().encode(input.apiKey));
    const wrapped = await wrapDek(kek, dekRaw);
    return {
      target: input.target,
      kind: input.kind,
      ciphertextBase64: encrypted.ciphertextBase64,
      ivBase64: encrypted.ivBase64,
      wrappedDekBase64: wrapped.wrappedDekBase64,
      wrapIvBase64: wrapped.wrapIvBase64,
    };
  }

  private async verifyUnlock(record: VaultRecord, kek: CryptoKey): Promise<void> {
    if (record.entries.length === 0) {
      return;
    }
    try {
      await unwrapDek(
        kek,
        record.entries[0].wrappedDekBase64,
        record.entries[0].wrapIvBase64
      );
    } catch {
      throw createVaultError("ReplyMate vault unlock failed.", "VAULT_UNLOCK_REJECTED");
    }
  }

  private requireUnlockedKek(): CryptoKey {
    if (!this.unlockedKek) {
      throw createVaultError(
        "ReplyMate vault is locked. Unlock it before using stored provider keys.",
        "VAULT_LOCKED"
      );
    }
    return this.unlockedKek;
  }

  private async requireRecord(errorCode: string): Promise<VaultRecord> {
    const record = await this.readRecord();
    if (!record) {
      throw createVaultError(
        "ReplyMate vault is not configured. Set up a passkey or passphrase vault first.",
        errorCode
      );
    }
    return record;
  }

  private buildVaultStatus(record: VaultRecord | null): VaultStatus {
    if (!record) {
      return {
        mode: "unconfigured",
        lockState: "setup_required",
        sessionCacheEnabled: true,
        passkeySupported: false,
        encryptedEntryCount: 0,
        message: "Set up a passkey vault or passphrase vault before storing provider keys.",
      };
    }

    return {
      mode: record.mode,
      lockState: this.unlockedKek ? "unlocked" : "locked",
      sessionCacheEnabled: record.sessionCacheEnabled,
      passkeySupported: false,
      encryptedEntryCount: record.entries.length,
      credentialId: record.passkey?.credentialId,
      prfSaltBase64: record.passkey?.prfSaltBase64,
      message: this.unlockedKek
        ? "ReplyMate is unlocked for this background session only."
        : "ReplyMate is locked. Chrome may relock it when the background unloads.",
    };
  }

  private async readRecord(): Promise<VaultRecord | null> {
    const result = await chrome.storage.local.get(VAULT_STORAGE_KEY);
    const record = result[VAULT_STORAGE_KEY];
    if (!record || typeof record !== "object") {
      return null;
    }
    const candidate = record as VaultRecord;
    if (
      candidate.version !== 1 ||
      (candidate.mode !== "passkey" && candidate.mode !== "passphrase") ||
      !Array.isArray(candidate.entries)
    ) {
      return null;
    }
    return candidate;
  }

  private async writeRecord(record: VaultRecord): Promise<void> {
    try {
      await chrome.storage.local.set({
        [VAULT_STORAGE_KEY]: record,
      });
    } catch (error) {
      throw createVaultError(
        `ReplyMate could not update the encrypted vault: ${sanitizeStatusMessage(error)}`,
        "VAULT_WRITE_FAILED"
      );
    }
  }
}

export const vaultService = new VaultService();
