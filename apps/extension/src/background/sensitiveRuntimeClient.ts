import type {
  EvidenceJobStatus,
  EvidenceSummary,
  GenerateDraftRequest,
  GenerateDraftResponse,
  NativeRuntimeStatus,
  ProviderConfig,
  ProviderCredentialDeleteRequest,
  ProviderCredentialStatusResponse,
  ProviderCredentialUpsertRequest,
  SettingsValidationResponse,
} from "@replymate/contracts";
import { ApiClientError } from "../shared-client/ApiClient.js";
import { extensionRuntimeService } from "./extensionRuntimeService.js";
import { vaultService } from "./vaultService.js";

const env = (
  import.meta as ImportMeta & {
    env?: Record<string, string | boolean | undefined>;
  }
).env;

function isLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    return (
      ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) &&
      (parsed.protocol === "http:" || parsed.protocol === "https:")
    );
  } catch {
    return false;
  }
}

function canUseDevHttp(baseUrl: string): boolean {
  return env?.DEV === true && isLoopbackBaseUrl(baseUrl);
}

async function fetchJson<T>(baseUrl: string, path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: {
      "x-replymate-dev-sensitive": "1",
      ...(init.headers || {}),
    },
  });
  const payload = (await response.json()) as T & { message?: string; errorCode?: string };
  if (!response.ok) {
    throw new ApiClientError(
      payload.message || "Sensitive ReplyMate local runtime request failed.",
      response.status,
      payload.errorCode
    );
  }
  return payload;
}

export class SensitiveRuntimeClient {
  private buildReadyRuntimeStatus(transport: NativeRuntimeStatus["transport"]): NativeRuntimeStatus {
    return {
      transport,
      availability: "ready",
      extensionId: chrome.runtime.id,
      hostName:
        transport === "extension_background" ? chrome.runtime.id : "app.replymate.native",
      message:
        transport === "dev_loopback"
          ? "ReplyMate is using the dev loopback runtime path. Native-host registration is not required in dev mode."
          : transport === "extension_background"
            ? "ReplyMate is using the extension vault path. Decrypted keys live only in background memory."
            : "ReplyMate local runtime is connected through app.replymate.native.",
      actionHint:
        transport === "dev_loopback"
          ? "For store-like testing, load a non-dev extension build. ReplyMate will use the extension vault path automatically."
          : transport === "extension_background"
            ? "Chrome may relock ReplyMate when the background service worker unloads."
            : undefined,
    };
  }

  async getNativeRuntimeStatus(input: {
    baseUrl: string;
  }): Promise<NativeRuntimeStatus> {
    if (canUseDevHttp(input.baseUrl)) {
      return this.buildReadyRuntimeStatus("dev_loopback");
    }

    return this.buildReadyRuntimeStatus("extension_background");
  }

  async validateConnection(input: {
    baseUrl: string;
    providerConfig?: ProviderConfig;
  }): Promise<SettingsValidationResponse> {
    if (canUseDevHttp(input.baseUrl)) {
      return this.validateConnectionDevHttp(input);
    }

    return extensionRuntimeService.validateConnection(input.providerConfig);
  }

  async getProviderCredentialStatus(input: {
    baseUrl: string;
  }): Promise<ProviderCredentialStatusResponse> {
    if (canUseDevHttp(input.baseUrl)) {
      const status = await fetchJson<ProviderCredentialStatusResponse>(
        input.baseUrl,
        "/v1/settings/provider-credentials",
        {
          method: "GET",
        }
      );
      return {
        ...status,
        vault: status.vault || {
          mode: "unconfigured",
          lockState: "setup_required",
          sessionCacheEnabled: true,
          passkeySupported: false,
          encryptedEntryCount: 0,
        },
        runtime: this.buildReadyRuntimeStatus("dev_loopback"),
      };
    }

    const status = await vaultService.getStatus();

    return {
      ...status,
      runtime: this.buildReadyRuntimeStatus("extension_background"),
    };
  }

  async saveProviderCredential(
    input: { baseUrl: string } & ProviderCredentialUpsertRequest
  ): Promise<ProviderCredentialStatusResponse> {
    if (canUseDevHttp(input.baseUrl)) {
      const status = await fetchJson<ProviderCredentialStatusResponse>(
        input.baseUrl,
        "/v1/settings/provider-credentials",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }
      );
      return {
        ...status,
        vault: status.vault || {
          mode: "unconfigured",
          lockState: "setup_required",
          sessionCacheEnabled: true,
          passkeySupported: false,
          encryptedEntryCount: 0,
        },
        runtime: this.buildReadyRuntimeStatus("dev_loopback"),
      };
    }

    const status = await vaultService.saveCredential(input);

    return {
      ...status,
      runtime: this.buildReadyRuntimeStatus("extension_background"),
    };
  }

  async deleteProviderCredential(
    input: { baseUrl: string } & ProviderCredentialDeleteRequest
  ): Promise<ProviderCredentialStatusResponse> {
    if (canUseDevHttp(input.baseUrl)) {
      const status = await fetchJson<ProviderCredentialStatusResponse>(
        input.baseUrl,
        "/v1/settings/provider-credentials",
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }
      );
      return {
        ...status,
        vault: status.vault || {
          mode: "unconfigured",
          lockState: "setup_required",
          sessionCacheEnabled: true,
          passkeySupported: false,
          encryptedEntryCount: 0,
        },
        runtime: this.buildReadyRuntimeStatus("dev_loopback"),
      };
    }

    const status = await vaultService.deleteCredential(input);

    return {
      ...status,
      runtime: this.buildReadyRuntimeStatus("extension_background"),
    };
  }

  async generateDraft(input: {
    baseUrl: string;
    request: GenerateDraftRequest;
  }): Promise<GenerateDraftResponse> {
    if (canUseDevHttp(input.baseUrl)) {
      return fetchJson(input.baseUrl, "/v1/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.request),
      });
    }

    return extensionRuntimeService.generateDraft(input.request);
  }

  async ingestEvidence(input: {
    baseUrl: string;
    sessionId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    mode: "context_only" | "intended_attachment";
    mentionInReply: boolean;
    fileDataBase64: string;
  }): Promise<
    | { apiVersion: string; mode: "sync"; result: EvidenceSummary }
    | { apiVersion: string; mode: "async"; job: EvidenceJobStatus }
  > {
    if (canUseDevHttp(input.baseUrl)) {
      const form = new FormData();
      form.set("sessionId", input.sessionId);
      form.set("mode", input.mode);
      form.set("mentionInReply", String(input.mentionInReply));
      form.set(
        "file",
        new Blob([Uint8Array.from(atob(input.fileDataBase64), (ch) => ch.charCodeAt(0))], {
          type: input.mimeType,
        }),
        input.fileName
      );
      return fetchJson(input.baseUrl, "/v1/evidence/ingest", {
        method: "POST",
        body: form,
      });
    }

    const providerConfig = (await chrome.storage.local.get("replymate:appSettings"))[
      "replymate:appSettings"
    ]?.provider as ProviderConfig | undefined;
    const result = await extensionRuntimeService.ingestEvidence({
      fileName: input.fileName,
      mimeType: input.mimeType,
      fileData: new Blob(
        [Uint8Array.from(atob(input.fileDataBase64), (ch) => ch.charCodeAt(0))],
        { type: input.mimeType }
      ),
      providerConfig,
    });
    return {
      apiVersion: "v1",
      mode: "sync",
      result,
    };
  }

  async getEvidenceJob(input: {
    baseUrl: string;
    jobId: string;
  }): Promise<{ apiVersion: string; job: EvidenceJobStatus }> {
    if (canUseDevHttp(input.baseUrl)) {
      return fetchJson(input.baseUrl, `/v1/evidence/jobs/${encodeURIComponent(input.jobId)}`, {
        method: "GET",
      });
    }

    throw new ApiClientError("Asynchronous evidence jobs are not used in extension vault mode.", 404);
  }

  private async validateConnectionDevHttp(input: {
    baseUrl: string;
    providerConfig?: unknown;
  }): Promise<SettingsValidationResponse> {
    return fetchJson(input.baseUrl, "/v1/settings/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client: "replymate-extension",
        providerConfig: input.providerConfig,
      }),
    });
  }
}
