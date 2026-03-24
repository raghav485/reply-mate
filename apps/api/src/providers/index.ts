import type {
  DraftingRuntimeType,
  DocumentParserAdapter,
  LLMProviderAdapter,
  ParserRuntimeType,
  StorageProviderAdapter,
  TranscriptionProviderAdapter,
} from "@replymate/contracts";
import { GenericLocalChatApiVisionDocumentParserAdapter } from "./GenericLocalChatApiVisionDocumentParserAdapter.js";
import { GenericLocalChatApiLLMProviderAdapter } from "./GenericLocalChatApiLLMProviderAdapter.js";
import { InMemoryStorageProviderAdapter } from "./InMemoryStorageProviderAdapter.js";
import { LocalDocumentParserAdapter } from "./LocalDocumentParserAdapter.js";
import { LocalTranscriptionProviderAdapter } from "./LocalTranscriptionProviderAdapter.js";
import { OllamaLLMProviderAdapter } from "./OllamaLLMProviderAdapter.js";
import { OllamaVisionDocumentParserAdapter } from "./OllamaVisionDocumentParserAdapter.js";

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

  return {
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
      cloud: null,
    },
    transcription: {
      remote: new LocalTranscriptionProviderAdapter(),
      cloud: null,
    },
    storage: new InMemoryStorageProviderAdapter(),
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
}
