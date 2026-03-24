import type {
  DocumentParserAdapter,
  EvidenceIngestRequest,
  EvidenceSummary,
  ParserProviderStatus,
} from "@replymate/contracts";
import { ProviderError } from "../core/errors.js";
import { fetchJsonWithTimeout } from "./runtimeHttp.js";
import {
  buildImageEvidenceSummary,
  buildVisionPrompt,
  parseVisionOcrPayload,
} from "./visionParserSupport.js";

type ModelsResponse = {
  data?: Array<{
    id?: string;
  }>;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

function buildApiPath(baseUrl: string, resource: "models" | "chat/completions"): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/v1")) {
    return `/${resource}`;
  }
  return `/v1/${resource}`;
}

function extractAssistantTextContent(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => extractAssistantTextContent(item))
      .filter(Boolean)
      .join("")
      .trim();
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text.trim();
    }
    if (typeof record.content === "string") {
      return record.content.trim();
    }
  }

  return "";
}

async function toBuffer(data: Blob | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export class GenericLocalChatApiVisionDocumentParserAdapter implements DocumentParserAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly modelName: string,
    private readonly timeoutMs: number,
    private readonly apiKey = "",
    private readonly supportsImages = false
  ) {}

  async checkHealth(): Promise<ParserProviderStatus> {
    if (!this.modelName.trim()) {
      return {
        runtimeType: "generic_local_chat_api",
        ready: false,
        imageOcrAvailable: false,
        warning: "No local parser model is configured.",
        fallbackMode: "metadata_local",
        recommendedModelName: "minicpm-v",
        setupHint: "Recommended OCR model for M4 / 16GB: minicpm-v.",
      };
    }

    try {
      const response = await fetchJsonWithTimeout<ModelsResponse>(
        this.baseUrl,
        buildApiPath(this.baseUrl, "models"),
        {
          method: "GET",
          headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
        },
        this.timeoutMs,
        "EVIDENCE_PARSE_FAILED"
      );

      const modelIds = Array.isArray(response.data)
        ? response.data.map((item) => item.id || "").filter((item) => item.trim().length > 0)
        : [];
      const hasModel = modelIds.includes(this.modelName);

      if (!hasModel) {
        return {
          runtimeType: "generic_local_chat_api",
          ready: false,
          imageOcrAvailable: false,
          modelName: this.modelName,
          warning: `Local chat API is reachable, but parser model "${this.modelName}" was not found.`,
          fallbackMode: "metadata_local",
          recommendedModelName: "minicpm-v",
          setupHint: "Use minicpm-v or qwen3-vl:4b for image OCR.",
        };
      }

      if (!this.supportsImages) {
        return {
          runtimeType: "generic_local_chat_api",
          ready: false,
          imageOcrAvailable: false,
          modelName: this.modelName,
          warning:
            `Configured local model "${this.modelName}" is reachable, but image OCR support is not enabled for this generic local chat API runtime.`,
          fallbackMode: "metadata_local",
          recommendedModelName: "minicpm-v",
          setupHint: "Use minicpm-v or qwen3-vl:4b for image OCR.",
        };
      }

      return {
        runtimeType: "generic_local_chat_api",
        ready: true,
        imageOcrAvailable: true,
        modelName: this.modelName,
        fallbackMode: "metadata_local",
        recommendedModelName: "minicpm-v",
        setupHint: "Use minicpm-v or qwen3-vl:4b for image OCR.",
      };
    } catch (error) {
      return {
        runtimeType: "generic_local_chat_api",
        ready: false,
        imageOcrAvailable: false,
        modelName: this.modelName,
        warning: error instanceof Error ? error.message : String(error),
        fallbackMode: "metadata_local",
        recommendedModelName: "minicpm-v",
        setupHint: "Use minicpm-v or qwen3-vl:4b for image OCR.",
      };
    }
  }

  async summarizeFile(input: EvidenceIngestRequest): Promise<EvidenceSummary> {
    const prompt = buildVisionPrompt(input.fileName);
    const mimeType = input.mimeType || "image/png";
    const imageBase64 = (await toBuffer(input.fileData)).toString("base64");

    const response = await fetchJsonWithTimeout<ChatCompletionResponse>(
      this.baseUrl,
      buildApiPath(this.baseUrl, "chat/completions"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.modelName,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: prompt.system },
            {
              role: "user",
              content: [
                { type: "text", text: prompt.user },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mimeType};base64,${imageBase64}`,
                  },
                },
              ],
            },
          ],
        }),
      },
      this.timeoutMs,
      "EVIDENCE_PARSE_FAILED"
    );

    const raw = extractAssistantTextContent(response.choices?.[0]?.message?.content);
    if (!raw) {
      throw new ProviderError({
        message: "Vision parser returned an empty response.",
        errorCode: "EVIDENCE_PARSE_FAILED",
        statusCode: 502,
      });
    }

    const payload = parseVisionOcrPayload(raw);
    return buildImageEvidenceSummary({
      fileName: input.fileName,
      payload,
    });
  }
}
