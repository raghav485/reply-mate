import path from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import type {
  DraftingRuntimeType,
  DocumentParserAdapter,
  LLMProviderAdapter,
  ParserRuntimeType,
  StorageProviderAdapter,
  TranscriptionProviderAdapter,
} from "@replymate/contracts";
import { resolveDeploymentMode } from "../core/authSession.js";
import { CloudLLMProviderAdapter } from "./CloudLLMProviderAdapter.js";
import { FileSystemStorageProviderAdapter } from "./FileSystemStorageProviderAdapter.js";
import { GenericLocalChatApiVisionDocumentParserAdapter } from "./GenericLocalChatApiVisionDocumentParserAdapter.js";
import { GenericLocalChatApiLLMProviderAdapter } from "./GenericLocalChatApiLLMProviderAdapter.js";
import { InMemoryStorageProviderAdapter } from "./InMemoryStorageProviderAdapter.js";
import { LocalDocumentParserAdapter } from "./LocalDocumentParserAdapter.js";
import { LocalTranscriptionProviderAdapter } from "./LocalTranscriptionProviderAdapter.js";
import { OllamaLLMProviderAdapter } from "./OllamaLLMProviderAdapter.js";
import { OllamaVisionDocumentParserAdapter } from "./OllamaVisionDocumentParserAdapter.js";
import { S3StorageProviderAdapter } from "./S3StorageProviderAdapter.js";

export type ProviderRuntime = {
  drafting: {
    runtimeType: DraftingRuntimeType;
    provider: LLMProviderAdapter | null;
  };
  llm: {
    cloud: LLMProviderAdapter | null;
  };
  transcription: {
    remote: TranscriptionProviderAdapter;
    cloud: TranscriptionProviderAdapter | null;
  };
  storage: StorageProviderAdapter;
  parser: {
    runtimeType: ParserRuntimeType;
    provider: DocumentParserAdapter | null;
    metadataFallback: DocumentParserAdapter;
    allowMetadataFallback: boolean;
  };
};

type StorageDriver = "memory" | "filesystem" | "s3";

function resolveDraftingRuntimeType(): DraftingRuntimeType {
  const raw = process.env.REPLYMATE_DRAFT_RUNTIME?.trim();
  if (raw === "generic_local_chat_api") {
    return raw;
  }
  return "ollama";
}

function resolveParserRuntimeType(): ParserRuntimeType {
  const raw = process.env.REPLYMATE_PARSER_RUNTIME?.trim();
  if (
    raw === "metadata_local" ||
    raw === "ollama" ||
    raw === "generic_local_chat_api"
  ) {
    return raw;
  }
  return "ollama";
}

function resolveStorageDriver(): StorageDriver {
  const raw = process.env.REPLYMATE_STORAGE_DRIVER?.trim();
  if (raw === "filesystem" || raw === "s3") {
    return raw;
  }
  if (raw === "memory") {
    return raw;
  }

  return resolveDeploymentMode() === "local" ? "memory" : "s3";
}

function resolveStorageForcePathStyle(): boolean {
  const raw = process.env.REPLYMATE_STORAGE_FORCE_PATH_STYLE?.trim().toLowerCase();
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  return Boolean(process.env.REPLYMATE_STORAGE_ENDPOINT?.trim());
}

function resolveStorageProvider(): StorageProviderAdapter {
  const driver = resolveStorageDriver();
  if (driver === "filesystem") {
    return new FileSystemStorageProviderAdapter(
      process.env.REPLYMATE_STORAGE_FILESYSTEM_ROOT?.trim() ||
        path.join(process.cwd(), ".replymate-data", "storage")
    );
  }
  if (driver === "s3") {
    const bucket = process.env.REPLYMATE_STORAGE_BUCKET?.trim() || "";
    const region = process.env.REPLYMATE_STORAGE_REGION?.trim() || "";
    const endpoint = process.env.REPLYMATE_STORAGE_ENDPOINT?.trim() || "";
    const accessKeyId = process.env.REPLYMATE_STORAGE_ACCESS_KEY_ID?.trim() || "";
    const secretAccessKey = process.env.REPLYMATE_STORAGE_SECRET_ACCESS_KEY?.trim() || "";

    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "REPLYMATE_STORAGE_DRIVER=s3 requires bucket, region, access key, and secret key configuration."
      );
    }

    return new S3StorageProviderAdapter(
      new S3Client({
        region,
        endpoint: endpoint || undefined,
        forcePathStyle: resolveStorageForcePathStyle(),
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      }),
      { bucket }
    );
  }
  return new InMemoryStorageProviderAdapter();
}

function resolveDraftingProvider(config: {
  runtimeType: DraftingRuntimeType;
  baseUrl: string;
  modelName: string;
  apiKey: string;
  timeoutMs: number;
  temperature: number;
  topP: number;
  repeatPenalty: number;
  numPredict: number;
  keepAlive: string;
}): LLMProviderAdapter | null {
  if (config.runtimeType === "ollama") {
    return new OllamaLLMProviderAdapter(config.baseUrl, config.modelName, config.timeoutMs, {
      temperature: config.temperature,
      topP: config.topP,
      repeatPenalty: config.repeatPenalty,
      numPredict: config.numPredict,
      keepAlive: config.keepAlive,
    });
  }

  return new GenericLocalChatApiLLMProviderAdapter(
    config.baseUrl,
    config.modelName,
    config.timeoutMs,
    config.apiKey,
    {
      temperature: config.temperature,
      topP: config.topP,
      repeatPenalty: config.repeatPenalty,
    }
  );
}

function resolveParserProvider(config: {
  runtimeType: ParserRuntimeType;
  draftingRuntimeType: DraftingRuntimeType;
  baseUrl: string;
  modelName: string;
  apiKey: string;
  timeoutMs: number;
  keepAlive: string;
  genericSupportsImages: boolean;
}): DocumentParserAdapter | null {
  if (config.runtimeType === "metadata_local") {
    return null;
  }

  const effectiveRuntimeType =
    config.runtimeType === "drafting_runtime"
      ? config.draftingRuntimeType
      : config.runtimeType;

  if (effectiveRuntimeType === "ollama") {
    return new OllamaVisionDocumentParserAdapter(
      config.baseUrl,
      config.modelName,
      config.timeoutMs,
      config.keepAlive
    );
  }

  return new GenericLocalChatApiVisionDocumentParserAdapter(
    config.baseUrl,
    config.modelName,
    config.timeoutMs,
    config.apiKey,
    config.genericSupportsImages
  );
}

export function createProviderRuntime(): ProviderRuntime {
  const runtimeType = resolveDraftingRuntimeType();
  const baseUrl =
    process.env.REPLYMATE_DRAFT_BASE_URL?.trim() || "http://127.0.0.1:11434";
  const modelName = process.env.REPLYMATE_DRAFT_MODEL?.trim() || "";
  const apiKey = process.env.REPLYMATE_DRAFT_API_KEY?.trim() || "";
  const timeoutMs = Number(process.env.REPLYMATE_DRAFT_TIMEOUT_MS || 45_000);
  const temperature = Number(process.env.REPLYMATE_DRAFT_TEMPERATURE || 0.15);
  const topP = Number(process.env.REPLYMATE_DRAFT_TOP_P || 0.85);
  const repeatPenalty = Number(process.env.REPLYMATE_DRAFT_REPEAT_PENALTY || 1.05);
  const numPredict = Number(process.env.REPLYMATE_DRAFT_NUM_PREDICT || 420);
  const keepAlive = process.env.REPLYMATE_DRAFT_KEEP_ALIVE?.trim() || "15m";
  const cloudBaseUrl = process.env.REPLYMATE_CLOUD_DRAFT_BASE_URL?.trim() || "";
  const cloudModelName = process.env.REPLYMATE_CLOUD_DRAFT_MODEL?.trim() || "";
  const cloudApiKey = process.env.REPLYMATE_CLOUD_DRAFT_API_KEY?.trim() || "";
  const cloudTimeoutMs = Number(process.env.REPLYMATE_CLOUD_DRAFT_TIMEOUT_MS || 45_000);
  const cloudTemperature = Number(process.env.REPLYMATE_CLOUD_DRAFT_TEMPERATURE || 0.15);
  const cloudTopP = Number(process.env.REPLYMATE_CLOUD_DRAFT_TOP_P || 0.85);
  const cloudRepeatPenalty = Number(process.env.REPLYMATE_CLOUD_DRAFT_REPEAT_PENALTY || 1.05);
  const parserRuntimeType = resolveParserRuntimeType();
  const parserBaseUrl =
    process.env.REPLYMATE_PARSER_BASE_URL?.trim() ||
    (parserRuntimeType === "drafting_runtime" ? baseUrl : "http://127.0.0.1:11434");
  const parserModelName =
    process.env.REPLYMATE_PARSER_MODEL?.trim() ||
    (parserRuntimeType === "drafting_runtime" ? modelName : "");
  const parserApiKey =
    process.env.REPLYMATE_PARSER_API_KEY?.trim() ||
    (parserRuntimeType === "drafting_runtime" ? apiKey : "");
  const parserTimeoutMs = Number(process.env.REPLYMATE_PARSER_TIMEOUT_MS || 30_000);
  const parserKeepAlive = process.env.REPLYMATE_PARSER_KEEP_ALIVE?.trim() || "20m";
  const parserAllowMetadataFallback =
    (process.env.REPLYMATE_PARSER_ALLOW_METADATA_FALLBACK?.trim() || "true").toLowerCase() !==
    "false";
  const genericSupportsImages =
    process.env.REPLYMATE_GENERIC_LOCAL_CHAT_SUPPORTS_IMAGES?.trim().toLowerCase() === "true";
  const metadataFallback = new LocalDocumentParserAdapter({
    runtimeType:
      parserRuntimeType === "drafting_runtime" ? "drafting_runtime" : "metadata_local",
  });

  const runtime: ProviderRuntime = {
    drafting: {
      runtimeType,
      provider: resolveDraftingProvider({
        runtimeType,
        baseUrl,
        modelName,
        apiKey,
        timeoutMs,
        temperature,
        topP,
        repeatPenalty,
        numPredict,
        keepAlive,
      }),
    },
    llm: {
      cloud:
        cloudBaseUrl && cloudModelName
          ? new CloudLLMProviderAdapter(
              cloudBaseUrl,
              cloudModelName,
              cloudTimeoutMs,
              cloudApiKey,
              {
                temperature: cloudTemperature,
                topP: cloudTopP,
                repeatPenalty: cloudRepeatPenalty,
              }
            )
          : null,
    },
    transcription: {
      remote: new LocalTranscriptionProviderAdapter(),
      cloud: null,
    },
    storage: resolveStorageProvider(),
    parser: {
      runtimeType: parserRuntimeType,
      provider: resolveParserProvider({
        runtimeType: parserRuntimeType,
        draftingRuntimeType: runtimeType,
        baseUrl: parserBaseUrl,
        modelName: parserModelName,
        apiKey: parserApiKey,
        timeoutMs: parserTimeoutMs,
        keepAlive: parserKeepAlive,
        genericSupportsImages,
      }),
      metadataFallback,
      allowMetadataFallback: parserAllowMetadataFallback,
    },
  };

  return runtime;
}
