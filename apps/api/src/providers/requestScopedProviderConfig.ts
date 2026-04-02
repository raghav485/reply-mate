import type {
  CloudProviderConfig,
  DraftingRuntimeType,
  LLMProviderAdapter,
  ProviderConfig,
} from "@replymate/contracts";
import { AnthropicLLMProviderAdapter } from "./AnthropicLLMProviderAdapter.js";
import { GeminiLLMProviderAdapter } from "./GeminiLLMProviderAdapter.js";
import type { ProviderRuntime } from "./index.js";
import { GenericLocalChatApiLLMProviderAdapter } from "./GenericLocalChatApiLLMProviderAdapter.js";
import { OllamaLLMProviderAdapter } from "./OllamaLLMProviderAdapter.js";

export type DraftingProviderSelection = {
  mode: ProviderConfig["mode"] | "environment";
  runtimeType: DraftingRuntimeType;
  provider: LLMProviderAdapter | null;
  providerPath: "local_model" | "cloud";
};

function resolveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function resolveDraftingOptions() {
  return {
    timeoutMs: resolveNumber(process.env.REPLYMATE_DRAFT_TIMEOUT_MS, 45_000),
    temperature: resolveNumber(process.env.REPLYMATE_DRAFT_TEMPERATURE, 0.15),
    topP: resolveNumber(process.env.REPLYMATE_DRAFT_TOP_P, 0.85),
    repeatPenalty: resolveNumber(process.env.REPLYMATE_DRAFT_REPEAT_PENALTY, 1.05),
    numPredict: resolveNumber(process.env.REPLYMATE_DRAFT_NUM_PREDICT, 420),
    keepAlive: process.env.REPLYMATE_DRAFT_KEEP_ALIVE?.trim() || "15m",
  };
}

function resolveCloudBaseUrl(config: CloudProviderConfig): string {
  const explicit = config.baseUrl.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  switch (config.kind) {
    case "openai":
      return "https://api.openai.com";
    case "openrouter":
      return "https://openrouter.ai/api";
    case "anthropic":
      return "https://api.anthropic.com";
    case "gemini":
      return "https://generativelanguage.googleapis.com";
    case "openai_compatible_custom":
    default:
      return "";
  }
}

function createLocalProvider(config: ProviderConfig["local"]): {
  runtimeType: DraftingRuntimeType;
  provider: LLMProviderAdapter | null;
} {
  const options = resolveDraftingOptions();
  if (config.kind === "ollama") {
    return {
      runtimeType: "ollama",
      provider: new OllamaLLMProviderAdapter(
        config.baseUrl,
        config.modelName,
        options.timeoutMs,
        {
          temperature: options.temperature,
          topP: options.topP,
          repeatPenalty: options.repeatPenalty,
          numPredict: options.numPredict,
          keepAlive: options.keepAlive,
        }
      ),
    };
  }

  return {
    runtimeType: "generic_local_chat_api",
    provider: new GenericLocalChatApiLLMProviderAdapter(
      config.baseUrl,
      config.modelName,
      options.timeoutMs,
      config.apiKey,
      {
        temperature: options.temperature,
        topP: options.topP,
        repeatPenalty: options.repeatPenalty,
      },
      "generic_local_chat_api"
    ),
  };
}

function createCloudProvider(config: ProviderConfig["cloud"]): {
  runtimeType: DraftingRuntimeType;
  provider: LLMProviderAdapter | null;
} {
  const options = resolveDraftingOptions();
  const baseUrl = resolveCloudBaseUrl(config);

  switch (config.kind) {
    case "anthropic":
      return {
        runtimeType: "anthropic",
        provider: new AnthropicLLMProviderAdapter(baseUrl, config.modelName, options.timeoutMs, config.apiKey, {
          temperature: options.temperature,
          topP: options.topP,
        }),
      };
    case "gemini":
      return {
        runtimeType: "gemini",
        provider: new GeminiLLMProviderAdapter(baseUrl, config.modelName, options.timeoutMs, config.apiKey, {
          temperature: options.temperature,
          topP: options.topP,
        }),
      };
    case "openai":
    case "openrouter":
    case "openai_compatible_custom":
    default:
      return {
        runtimeType: "openai_compatible",
        provider: new GenericLocalChatApiLLMProviderAdapter(
          baseUrl,
          config.modelName,
          options.timeoutMs,
          config.apiKey,
          {
            temperature: options.temperature,
            topP: options.topP,
            repeatPenalty: options.repeatPenalty,
          },
          "openai_compatible"
        ),
      };
  }
}

export function resolveDraftingProviderSelection(
  envProviders: ProviderRuntime,
  config?: ProviderConfig
): DraftingProviderSelection {
  if (!config) {
    return {
      mode: "environment",
      runtimeType: envProviders.drafting.runtimeType,
      provider: envProviders.drafting.provider ?? envProviders.llm.cloud,
      providerPath: envProviders.drafting.provider ? "local_model" : "cloud",
    };
  }

  if (config.mode === "local_models") {
    const local = createLocalProvider(config.local);
    return {
      mode: config.mode,
      runtimeType: local.runtimeType,
      provider: local.provider,
      providerPath: "local_model",
    };
  }

  const cloud = createCloudProvider(config.cloud);
  return {
    mode: config.mode,
    runtimeType: cloud.runtimeType,
    provider: cloud.provider,
    providerPath: "cloud",
  };
}
