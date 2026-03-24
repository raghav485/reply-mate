import type {
  DocumentParserAdapter,
  EvidenceIngestRequest,
  EvidenceSummary,
  ParserProviderStatus,
} from "@replymate/contracts";
import { ProviderError } from "../core/errors.js";
import { fetchOllamaAvailableModels, fetchOllamaModelCapabilities } from "./ollamaRuntimeSupport.js";
import { fetchJsonWithTimeout } from "./runtimeHttp.js";
import {
  buildImageEvidenceSummary,
  buildVisionPrompt,
  parseVisionOcrPayload,
} from "./visionParserSupport.js";

type OllamaVisionResponse = {
  message?: {
    content?: unknown;
  };
  response?: unknown;
};

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

export class OllamaVisionDocumentParserAdapter implements DocumentParserAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly modelName: string,
    private readonly timeoutMs: number,
    private readonly keepAlive = "20m"
  ) {}

  async checkHealth(): Promise<ParserProviderStatus> {
    if (!this.modelName.trim()) {
      return {
        runtimeType: "ollama",
        ready: false,
        imageOcrAvailable: false,
        warning: "No local parser model is configured.",
        fallbackMode: "metadata_local",
        recommendedModelName: "minicpm-v",
        setupHint: "Recommended OCR model for M4 / 16GB: minicpm-v.",
      };
    }

    try {
      const availableModels = await fetchOllamaAvailableModels(this.baseUrl, this.timeoutMs);
      if (!availableModels.includes(this.modelName)) {
        return {
          runtimeType: "ollama",
          ready: false,
          imageOcrAvailable: false,
          modelName: this.modelName,
          warning: `Ollama runtime is reachable, but parser model "${this.modelName}" was not found.`,
          fallbackMode: "metadata_local",
          recommendedModelName: "minicpm-v",
          setupHint: "Use minicpm-v for OCR-first local parsing.",
        };
      }

      const capabilities = await fetchOllamaModelCapabilities(
        this.baseUrl,
        this.modelName,
        this.timeoutMs
      );
      const hasVision = capabilities.includes("vision");

      return {
        runtimeType: "ollama",
        ready: hasVision,
        imageOcrAvailable: hasVision,
        modelName: this.modelName,
        warning: hasVision
          ? undefined
          : `Configured local model "${this.modelName}" does not support vision; using metadata-only summary.`,
        fallbackMode: "metadata_local",
        recommendedModelName: "minicpm-v",
        setupHint: "Use minicpm-v or qwen3-vl:4b for a vision-capable parser model.",
      };
    } catch (error) {
      return {
        runtimeType: "ollama",
        ready: false,
        imageOcrAvailable: false,
        modelName: this.modelName,
        warning: error instanceof Error ? error.message : String(error),
        fallbackMode: "metadata_local",
        recommendedModelName: "minicpm-v",
        setupHint: "Use minicpm-v or qwen3-vl:4b for a vision-capable parser model.",
      };
    }
  }

  async summarizeFile(input: EvidenceIngestRequest): Promise<EvidenceSummary> {
    const prompt = buildVisionPrompt(input.fileName);
    const imageBase64 = (await toBuffer(input.fileData)).toString("base64");

    const response = await fetchJsonWithTimeout<OllamaVisionResponse>(
      this.baseUrl,
      "/api/chat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.modelName,
          stream: false,
          think: false,
          keep_alive: this.keepAlive,
          messages: [
            { role: "system", content: prompt.system },
            {
              role: "user",
              content: prompt.user,
              images: [imageBase64],
            },
          ],
        }),
      },
      this.timeoutMs,
      "EVIDENCE_PARSE_FAILED"
    );

    const raw =
      extractAssistantTextContent(response.message?.content) ||
      extractAssistantTextContent(response.response);

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
