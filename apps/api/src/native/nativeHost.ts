import { stdin, stdout } from "node:process";
import type {
  NativeHostRequest,
  NativeHostResponse,
} from "@replymate/contracts";
import { loadLocalEnv } from "../bootstrap/loadEnv.js";
import { loadOrCreateLocalRuntimeToken } from "./runtimeAuth.js";

function encodeMessage(message: NativeHostResponse): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

function isLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
      return false;
    }
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function buildErrorResponse(
  request: NativeHostRequest,
  error: unknown
): NativeHostResponse {
  if (error instanceof Error) {
    return {
      id: request.id,
      ok: false,
      type: request.type,
      error: {
        message: error.message,
      },
    };
  }

  return {
    id: request.id,
    ok: false,
    type: request.type,
    error: {
      message: typeof error === "string" ? error : "Native host request failed.",
    },
  };
}

async function fetchJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit,
  token: string
): Promise<T> {
  if (!isLoopbackBaseUrl(baseUrl)) {
    throw new Error("ReplyMate native host only supports loopback API base URLs.");
  }

  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const payload = (await response.json()) as T & {
    message?: string;
    errorCode?: string;
  };
  if (!response.ok) {
    const error = new Error(payload.message || `Native host API request failed with ${response.status}.`);
    (error as Error & { errorCode?: string; status?: number }).errorCode = payload.errorCode;
    (error as Error & { errorCode?: string; status?: number }).status = response.status;
    throw error;
  }
  return payload;
}

async function handleRequest(request: NativeHostRequest, token: string): Promise<NativeHostResponse> {
  switch (request.type) {
    case "runtime.status":
      return {
        id: request.id,
        ok: true,
        type: request.type,
        payload: {
          apiVersion: "v1",
          hostName: "app.replymate.native",
        },
      };
    case "providerCredentials.status":
      return {
        id: request.id,
        ok: true,
        type: request.type,
        payload: await fetchJson(
          request.payload.baseUrl,
          "/v1/settings/provider-credentials",
          { method: "GET" },
          token
        ),
      };
    case "providerCredentials.save":
      return {
        id: request.id,
        ok: true,
        type: request.type,
        payload: await fetchJson(
          request.payload.baseUrl,
          "/v1/settings/provider-credentials",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              target: request.payload.target,
              kind: request.payload.kind,
              apiKey: request.payload.apiKey,
            }),
          },
          token
        ),
      };
    case "providerCredentials.delete":
      return {
        id: request.id,
        ok: true,
        type: request.type,
        payload: await fetchJson(
          request.payload.baseUrl,
          "/v1/settings/provider-credentials",
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              target: request.payload.target,
              kind: request.payload.kind,
            }),
          },
          token
        ),
      };
    case "settings.validate":
      return {
        id: request.id,
        ok: true,
        type: request.type,
        payload: await fetchJson(
          request.payload.baseUrl,
          "/v1/settings/validate",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              client: "replymate-extension",
              providerConfig: request.payload.providerConfig,
            }),
          },
          token
        ),
      };
    case "draft.generate":
      return {
        id: request.id,
        ok: true,
        type: request.type,
        payload: await fetchJson(
          request.payload.baseUrl,
          "/v1/generate",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request.payload.request),
          },
          token
        ),
      };
    case "evidence.ingest": {
      const form = new FormData();
      form.set("sessionId", request.payload.sessionId);
      form.set("fileName", request.payload.fileName);
      form.set("mimeType", request.payload.mimeType);
      form.set("sizeBytes", String(request.payload.sizeBytes));
      form.set("mode", request.payload.mode);
      form.set("mentionInReply", String(request.payload.mentionInReply));
      form.set(
        "file",
        new Blob([Buffer.from(request.payload.fileDataBase64, "base64")], {
          type: request.payload.mimeType,
        }),
        request.payload.fileName
      );

      return {
        id: request.id,
        ok: true,
        type: request.type,
        payload: await fetchJson(
          request.payload.baseUrl,
          "/v1/evidence/ingest",
          {
            method: "POST",
            body: form,
          },
          token
        ),
      };
    }
    case "evidence.job":
      return {
        id: request.id,
        ok: true,
        type: request.type,
        payload: await fetchJson(
          request.payload.baseUrl,
          `/v1/evidence/jobs/${encodeURIComponent(request.payload.jobId)}`,
          { method: "GET" },
          token
        ),
      };
  }
}

async function main(): Promise<void> {
  loadLocalEnv();
  const token = await loadOrCreateLocalRuntimeToken();
  let buffer = Buffer.alloc(0);

  stdin.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (buffer.length < 4 + length) {
        return;
      }

      const raw = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);

      let request: NativeHostRequest | null = null;
      try {
        request = JSON.parse(raw.toString("utf8")) as NativeHostRequest;
      } catch {
        continue;
      }

      void handleRequest(request, token)
        .catch((error) => buildErrorResponse(request as NativeHostRequest, error))
        .then((response) => {
          stdout.write(encodeMessage(response));
        });
    }
  });
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "ReplyMate native host failed.";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
