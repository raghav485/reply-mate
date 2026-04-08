import type {
  DraftingProviderStatus,
  EvidenceSummary,
  GenerateDraftRequest,
  GenerateDraftResponse,
  ParserProviderStatus,
  ProviderConfig,
  SettingsValidationResponse,
} from "@replymate/contracts";
import { ApiClientError } from "../shared-client/ApiClient.js";
import { vaultService } from "./vaultService.js";
import * as mammoth from "mammoth/mammoth.browser";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { AnthropicLLMProviderAdapter } from "../../../api/src/providers/AnthropicLLMProviderAdapter.js";
import { GeminiLLMProviderAdapter } from "../../../api/src/providers/GeminiLLMProviderAdapter.js";
import { GenericLocalChatApiLLMProviderAdapter } from "../../../api/src/providers/GenericLocalChatApiLLMProviderAdapter.js";
import { OllamaLLMProviderAdapter } from "../../../api/src/providers/OllamaLLMProviderAdapter.js";
import { fetchOllamaAvailableModels, fetchOllamaModelCapabilities } from "../../../api/src/providers/ollamaRuntimeSupport.js";

const MAX_SUMMARY_CHARS = 1200;
const MAX_TEXT_SNIPPET_CHARS = 950;

type LlmProvider = {
  checkHealth(): Promise<DraftingProviderStatus>;
  generateDrafts(input: GenerateDraftRequest): Promise<GenerateDraftResponse>;
};

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function buildCredentialError(message: string, errorCode: string): ApiClientError {
  return new ApiClientError(message, 423, errorCode);
}

function isForbiddenRuntimeError(error: unknown): boolean {
  if (error instanceof ApiClientError) {
    return error.status === 403;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /403\s+forbidden|forbidden/i.test(message);
}

function normalizeProviderRuntimeError(
  config: ProviderConfig,
  error: unknown
): never {
  if (
    config.mode === "local_models" &&
    config.local.kind === "ollama" &&
    isForbiddenRuntimeError(error)
  ) {
    throw new ApiClientError(
      `Ollama rejected ReplyMate's Chrome extension origin. Restart Ollama with OLLAMA_ORIGINS=chrome-extension://${chrome.runtime.id} and try again.`,
      403,
      "OLLAMA_ORIGIN_FORBIDDEN"
    );
  }

  throw error;
}

function resolveCloudBaseUrl(config: ProviderConfig["cloud"]): string {
  const explicit = normalizeBaseUrl(config.baseUrl);
  if (explicit) {
    return explicit;
  }

  switch (config.kind) {
    case "anthropic":
      return "https://api.anthropic.com";
    case "gemini":
      return "https://generativelanguage.googleapis.com";
    case "openrouter":
      return "https://openrouter.ai/api";
    case "openai":
      return "https://api.openai.com";
    case "openai_compatible_custom":
    default:
      return "";
  }
}

function resolveDraftingOptions() {
  return {
    timeoutMs: 45_000,
    temperature: 0.15,
    topP: 0.85,
    repeatPenalty: 1.05,
    numPredict: 420,
    keepAlive: "15m",
  };
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}

function isLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}

async function ensureCustomHostPermission(url: string): Promise<void> {
  const origin = new URL(url).origin;
  const contains = await chrome.permissions.contains({
    origins: [`${origin}/*`],
  });
  if (!contains) {
    throw new ApiClientError(
      "ReplyMate needs one-time host access for this custom provider endpoint.",
      403,
      "CUSTOM_HOST_PERMISSION_REQUIRED"
    );
  }
}

function normalizeProviderConfig(config: ProviderConfig): ProviderConfig {
  return {
    ...config,
    local: {
      ...config.local,
      baseUrl: normalizeBaseUrl(config.local.baseUrl),
    },
    cloud: {
      ...config.cloud,
      baseUrl: normalizeBaseUrl(config.cloud.baseUrl),
    },
  };
}

async function resolveProviderConfig(
  config: ProviderConfig
): Promise<ProviderConfig> {
  const normalized = normalizeProviderConfig(config);
  const next: ProviderConfig = JSON.parse(JSON.stringify(normalized)) as ProviderConfig;

  if (normalized.local.hasStoredApiKey) {
    const stored = await vaultService.resolveCredential({
      target: "local",
      kind: normalized.local.kind,
    });
    if (!stored) {
      throw buildCredentialError(
        "ReplyMate vault is locked. Unlock it before using the stored local provider key.",
        "VAULT_LOCKED"
      );
    }
    next.local.apiKey = stored;
  }

  if (normalized.cloud.hasStoredApiKey) {
    const stored = await vaultService.resolveCredential({
      target: "cloud",
      kind: normalized.cloud.kind,
    });
    if (!stored) {
      throw buildCredentialError(
        "ReplyMate vault is locked. Unlock it before using the stored provider key.",
        "VAULT_LOCKED"
      );
    }
    next.cloud.apiKey = stored;
  }

  if (next.mode === "byok_api" && next.cloud.kind === "openai_compatible_custom") {
    const customUrl = resolveCloudBaseUrl(next.cloud);
    if (!customUrl) {
      throw new ApiClientError("Custom OpenAI-compatible base URL is required.", 400);
    }
    await ensureCustomHostPermission(customUrl);
  }

  if (next.mode === "local_models" && next.local.kind === "openai_compatible_local") {
    if (!next.local.baseUrl || !isLoopbackUrl(next.local.baseUrl)) {
      throw new ApiClientError(
        "Local OpenAI-compatible endpoints must use localhost or 127.0.0.1.",
        400
      );
    }
  }

  return next;
}

function createProvider(config: ProviderConfig): LlmProvider {
  const options = resolveDraftingOptions();
  if (config.mode === "local_models") {
    if (config.local.kind === "ollama") {
      return new OllamaLLMProviderAdapter(
        config.local.baseUrl,
        config.local.modelName,
        options.timeoutMs,
        {
          temperature: options.temperature,
          topP: options.topP,
          repeatPenalty: options.repeatPenalty,
          numPredict: options.numPredict,
          keepAlive: options.keepAlive,
        }
      );
    }

    return new GenericLocalChatApiLLMProviderAdapter(
      config.local.baseUrl,
      config.local.modelName,
      options.timeoutMs,
      config.local.apiKey,
      {
        temperature: options.temperature,
        topP: options.topP,
        repeatPenalty: options.repeatPenalty,
      },
      "generic_local_chat_api"
    );
  }

  const cloudBaseUrl = resolveCloudBaseUrl(config.cloud);
  switch (config.cloud.kind) {
    case "anthropic":
      return new AnthropicLLMProviderAdapter(
        cloudBaseUrl,
        config.cloud.modelName,
        options.timeoutMs,
        config.cloud.apiKey,
        {
          temperature: options.temperature,
          topP: options.topP,
        }
      );
    case "gemini":
      return new GeminiLLMProviderAdapter(
        cloudBaseUrl,
        config.cloud.modelName,
        options.timeoutMs,
        config.cloud.apiKey,
        {
          temperature: options.temperature,
          topP: options.topP,
        }
      );
    case "openai":
    case "openrouter":
    case "openai_compatible_custom":
    default:
      return new GenericLocalChatApiLLMProviderAdapter(
        cloudBaseUrl,
        config.cloud.modelName,
        options.timeoutMs,
        config.cloud.apiKey,
        {
          temperature: options.temperature,
          topP: options.topP,
          repeatPenalty: options.repeatPenalty,
        },
        "openai_compatible"
      );
  }
}

function buildParserStatus(config: ProviderConfig): ParserProviderStatus {
  if (config.mode === "local_models" && config.local.kind === "ollama") {
    return {
      runtimeType: "ollama",
      ready: true,
      imageOcrAvailable: false,
      warning:
        "Bundled TXT/DOCX/PDF parsing is ready. Image OCR requires a vision-capable model and is checked at upload time.",
      fallbackMode: "metadata_local",
      recommendedModelName: "minicpm-v",
      setupHint:
        "TXT, DOCX, and PDF parsing run in the extension. Configure a vision-capable model if you want image OCR.",
    };
  }

  return {
    runtimeType: config.mode === "local_models" ? "generic_local_chat_api" : "drafting_runtime",
    ready: true,
    imageOcrAvailable: false,
    warning:
      "Bundled TXT/DOCX/PDF parsing is ready. Image OCR availability is checked when you upload an image.",
    fallbackMode: "metadata_local",
    recommendedModelName: "minicpm-v",
    setupHint:
      "TXT, DOCX, and PDF parsing run in the extension. Use a vision-capable provider/model for image OCR.",
  };
}

function buildValidationResponse(
  providerConfig: ProviderConfig,
  draftingProvider: DraftingProviderStatus,
  parserProvider: ParserProviderStatus
): SettingsValidationResponse {
  const warnings = [draftingProvider.warning, parserProvider.warning].filter(
    (value): value is string => Boolean(value)
  );

  return {
    valid: draftingProvider.ready,
    warnings,
    apiVersion: "v1",
    serverVersion: "extension-background",
    deploymentMode: "local",
    cloudGenerationAvailable: providerConfig.mode === "byok_api" && draftingProvider.ready,
    authMode: "optional",
    draftingProvider,
    parserProvider,
  };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildTextSummary(fileName: string, parserMode: EvidenceSummary["parserMode"], text: string): EvidenceSummary {
  const normalized = normalizeText(text);
  const snippet = normalized.slice(0, MAX_TEXT_SNIPPET_CHARS);
  let summaryText = `${fileName}: ${snippet}`;
  const warnings: string[] = [];
  let truncated = false;
  if (summaryText.length > MAX_SUMMARY_CHARS) {
    summaryText = summaryText.slice(0, MAX_SUMMARY_CHARS).trimEnd();
    truncated = true;
    warnings.push("Summary truncated to max per-file character limit.");
  }
  return {
    evidenceId: `ev_${crypto.randomUUID()}`,
    name: fileName,
    mode: "context_only",
    mentionInReply: false,
    summaryText,
    parserMode,
    confidence: normalized ? "high" : "low",
    warnings,
    truncated,
    summaryCharCount: summaryText.length,
    extractedTextChars: normalized.length,
  };
}

function buildMetadataFallback(fileName: string, warning: string): EvidenceSummary {
  const summaryText = `ReplyMate could not extract text from ${fileName}.`;
  return {
    evidenceId: `ev_${crypto.randomUUID()}`,
    name: fileName,
    mode: "context_only",
    mentionInReply: false,
    summaryText,
    parserMode: "metadata_fallback",
    confidence: "low",
    warnings: [warning],
    truncated: false,
    summaryCharCount: summaryText.length,
  };
}

async function parseDocx(fileData: Blob, fileName: string): Promise<EvidenceSummary> {
  const result = await mammoth.extractRawText({
    arrayBuffer: await fileData.arrayBuffer(),
  });
  return buildTextSummary(fileName, "docx_text", result.value || "");
}

async function parsePdf(fileData: Blob, fileName: string): Promise<EvidenceSummary> {
  const data = await fileData.arrayBuffer();
  const pdf = await getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;

  const parts: string[] = [];
  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const content = await page.getTextContent();
    parts.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .filter(Boolean)
        .join(" ")
    );
  }
  const summary = buildTextSummary(fileName, "pdf_text", parts.join("\n"));
  return {
    ...summary,
    sourcePageCount: pdf.numPages,
  };
}

async function fileToBase64(fileData: Blob): Promise<string> {
  const bytes = new Uint8Array(await fileData.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i)?.[1]?.trim() || trimmed;
  const firstBrace = fenced.indexOf("{");
  const lastBrace = fenced.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < firstBrace) {
    throw new ApiClientError("Image OCR output did not contain a JSON object.", 502, "EVIDENCE_PARSE_FAILED");
  }
  return fenced.slice(firstBrace, lastBrace + 1);
}

function buildImageSummary(fileName: string, raw: string): EvidenceSummary {
  const payload = JSON.parse(extractJsonObject(raw)) as {
    visible_text?: string;
    summary?: string;
    confidence?: EvidenceSummary["confidence"];
    warnings?: string[];
  };
  const visibleText = typeof payload.visible_text === "string" ? payload.visible_text.trim() : "";
  const summary = typeof payload.summary === "string" ? normalizeText(payload.summary) : "";
  const warnings = Array.isArray(payload.warnings)
    ? payload.warnings.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const combined = [
    visibleText ? `OCR extracted from ${fileName}:\n${visibleText}` : "",
    summary ? `Summary: ${summary}` : "",
  ].filter(Boolean).join("\n\n") || `Image uploaded: ${fileName}. OCR did not find usable text.`;
  const summaryText = combined.length > MAX_SUMMARY_CHARS ? combined.slice(0, MAX_SUMMARY_CHARS).trimEnd() : combined;
  return {
    evidenceId: `ev_${crypto.randomUUID()}`,
    name: fileName,
    mode: "context_only",
    mentionInReply: false,
    summaryText,
    parserMode: "image_ocr",
    confidence: payload.confidence === "high" || payload.confidence === "low" ? payload.confidence : "medium",
    warnings: combined.length > MAX_SUMMARY_CHARS
      ? [...warnings, "Summary truncated to max per-file character limit."]
      : warnings,
    truncated: combined.length > MAX_SUMMARY_CHARS,
    summaryCharCount: summaryText.length,
    extractedTextChars: visibleText.length,
  };
}

function buildVisionPrompt(fileName: string) {
  return {
    system:
      "You are ReplyMate OCR. Extract only visually present text from the image and summarize it. Return JSON only.",
    user: [
      "Return JSON with this exact shape:",
      '{"visible_text":"...","summary":"...","confidence":"high|medium|low","warnings":["..."]}',
      `File name: ${fileName}`,
      "Do not invent text that is not visible.",
    ].join("\n"),
  };
}

async function runImageOcr(config: ProviderConfig, fileData: Blob, fileName: string, mimeType: string): Promise<EvidenceSummary> {
  const base64 = await fileToBase64(fileData);
  const prompt = buildVisionPrompt(fileName);

  if (config.mode === "local_models" && config.local.kind === "ollama") {
    const response = await fetch(`${config.local.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.local.modelName,
        stream: false,
        think: false,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user, images: [base64] },
        ],
      }),
    });
    const payload = await response.json();
    const raw = payload?.message?.content || payload?.response || "";
    return buildImageSummary(fileName, String(raw || ""));
  }

  if (config.mode === "local_models" || config.cloud.kind === "openai" || config.cloud.kind === "openrouter" || config.cloud.kind === "openai_compatible_custom") {
    const targetConfig = config.mode === "local_models" ? config.local : config.cloud;
    const baseUrl = config.mode === "local_models" ? targetConfig.baseUrl : resolveCloudBaseUrl(config.cloud);
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const apiPath = normalizedBaseUrl.endsWith("/v1") ? "/chat/completions" : "/v1/chat/completions";
    const response = await fetch(`${normalizedBaseUrl}${apiPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(targetConfig.apiKey ? { Authorization: `Bearer ${targetConfig.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: targetConfig.modelName,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: prompt.system },
          {
            role: "user",
            content: [
              { type: "text", text: prompt.user },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          },
        ],
      }),
    });
    const payload = await response.json();
    const raw = payload?.choices?.[0]?.message?.content || "";
    return buildImageSummary(fileName, String(raw || ""));
  }

  if (config.cloud.kind === "gemini") {
    const baseUrl = resolveCloudBaseUrl(config.cloud);
    const modelName = config.cloud.modelName.startsWith("models/")
      ? config.cloud.modelName
      : `models/${config.cloud.modelName}`;
    const response = await fetch(`${baseUrl}/v1beta/${modelName}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": config.cloud.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt.system }] },
        contents: [
          {
            parts: [
              { text: prompt.user },
              { inlineData: { mimeType, data: base64 } },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
      }),
    });
    const payload = await response.json();
    const raw = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("\n") || "";
    return buildImageSummary(fileName, String(raw || ""));
  }

  if (config.cloud.kind === "anthropic") {
    const response = await fetch(`${resolveCloudBaseUrl(config.cloud)}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.cloud.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.cloud.modelName,
        max_tokens: 1400,
        system: prompt.system,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mimeType,
                  data: base64,
                },
              },
              { type: "text", text: prompt.user },
            ],
          },
        ],
      }),
    });
    const payload = await response.json();
    const raw = Array.isArray(payload?.content)
      ? payload.content.map((item: { text?: string }) => item.text || "").join("\n")
      : "";
    return buildImageSummary(fileName, String(raw || ""));
  }

  throw new ApiClientError(
    "Image OCR is not available for the current provider configuration.",
    422,
    "EVIDENCE_PARSE_FAILED"
  );
}

export class ExtensionRuntimeService {
  async validateConnection(providerConfig?: ProviderConfig): Promise<SettingsValidationResponse> {
    const config: ProviderConfig = providerConfig
      ? await resolveProviderConfig(providerConfig)
      : {
          mode: "local_models",
          local: {
            kind: "ollama",
            baseUrl: "http://127.0.0.1:11434",
            modelName: "qwen3:8b",
            apiKey: "",
            hasStoredApiKey: false,
          },
          cloud: {
            kind: "openai",
            baseUrl: "",
            modelName: "",
            apiKey: "",
            hasStoredApiKey: false,
          },
        };

    const provider = createProvider(config);
    const draftingProvider = await provider.checkHealth();
    return buildValidationResponse(config, draftingProvider, buildParserStatus(config));
  }

  async generateDraft(request: GenerateDraftRequest): Promise<GenerateDraftResponse> {
    if (!request.providerConfig) {
      throw new ApiClientError("Provider configuration is required.", 400);
    }
    const config = await resolveProviderConfig(request.providerConfig);
    const provider = createProvider(config);
    try {
      return await provider.generateDrafts({
        ...request,
        providerConfig: config,
      });
    } catch (error) {
      normalizeProviderRuntimeError(config, error);
    }
  }

  async ingestEvidence(input: {
    fileName: string;
    mimeType: string;
    fileData: Blob;
    providerConfig?: ProviderConfig;
  }): Promise<EvidenceSummary> {
    const mimeType = input.mimeType.toLowerCase();
    if (mimeType.startsWith("text/")) {
      return buildTextSummary(
        input.fileName,
        "metadata_fallback",
        await input.fileData.text()
      );
    }
    if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      return parseDocx(input.fileData, input.fileName);
    }
    if (mimeType === "application/pdf") {
      return parsePdf(input.fileData, input.fileName);
    }
    if (mimeType.startsWith("image/")) {
      if (!input.providerConfig) {
        return buildMetadataFallback(
          input.fileName,
          "Image OCR requires an active provider configuration."
        );
      }
      try {
        const config = await resolveProviderConfig(input.providerConfig);
        return await runImageOcr(config, input.fileData, input.fileName, input.mimeType);
      } catch (error) {
        return buildMetadataFallback(
          input.fileName,
          error instanceof Error ? error.message : "Image OCR is unavailable."
        );
      }
    }

    return buildMetadataFallback(
      input.fileName,
      "ReplyMate does not have a bundled parser for this file type."
    );
  }

  async buildReadiness(config: ProviderConfig): Promise<{
    draftingProvider: DraftingProviderStatus;
    parserProvider: ParserProviderStatus;
  }> {
    const resolved = await resolveProviderConfig(config);
    const provider = createProvider(resolved);
    return {
      draftingProvider: await provider.checkHealth(),
      parserProvider: buildParserStatus(resolved),
    };
  }

  async getLocalOllamaVisionStatus(baseUrl: string, modelName: string): Promise<boolean> {
    const models = await fetchOllamaAvailableModels(baseUrl, 10_000);
    if (!models.includes(modelName)) {
      return false;
    }
    const capabilities = await fetchOllamaModelCapabilities(baseUrl, modelName, 10_000);
    return capabilities.includes("vision");
  }
}

export const extensionRuntimeService = new ExtensionRuntimeService();
