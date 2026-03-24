import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  DocumentParserAdapter,
  EvidenceIngestRequest,
  EvidenceSummary,
  ParserProviderStatus,
} from "@replymate/contracts";
import { ProviderError } from "../core/errors.js";

const execFileAsync = promisify(execFile);
const MAX_SUMMARY_CHARS = 1200;
const MAX_TEXT_SNIPPET_CHARS = 950;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function toBuffer(data: Blob | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function truncateSummary(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_SUMMARY_CHARS) {
    return { text, truncated: false };
  }

  return {
    text: text.slice(0, MAX_SUMMARY_CHARS).trimEnd(),
    truncated: true,
  };
}

function buildEvidenceSummary(input: {
  fileName: string;
  parserMode: EvidenceSummary["parserMode"];
  summaryText: string;
  confidence: EvidenceSummary["confidence"];
  warnings: string[];
  sourcePageCount?: number;
  extractedTextChars?: number;
}): EvidenceSummary {
  const capped = truncateSummary(input.summaryText);
  const warnings = capped.truncated
    ? [...input.warnings, "Summary truncated to max per-file character limit."]
    : [...input.warnings];

  return {
    evidenceId: `ev_${randomUUID()}`,
    name: input.fileName,
    mode: "context_only",
    mentionInReply: false,
    summaryText: capped.text,
    parserMode: input.parserMode,
    confidence: input.confidence,
    warnings,
    truncated: capped.truncated,
    summaryCharCount: capped.text.length,
    sourcePageCount: input.sourcePageCount,
    extractedTextChars: input.extractedTextChars,
  };
}

function buildNativeTextSummary(label: string, fileName: string, extractedText: string): string {
  const snippet = extractedText.slice(0, MAX_TEXT_SNIPPET_CHARS);
  return `${label} extracted from ${fileName}: ${snippet}`;
}

async function withTempFile<T>(
  fileName: string,
  data: Buffer,
  run: (filePath: string) => Promise<T>
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "replymate-parse-"));
  const filePath = join(dir, fileName);

  try {
    await writeFile(filePath, data);
    return await run(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function extractDocxText(buffer: Buffer, fileName: string): Promise<string> {
  return withTempFile(fileName, buffer, async (filePath) => {
    const { stdout } = await execFileAsync("/usr/bin/textutil", [
      "-convert",
      "txt",
      "-stdout",
      filePath,
    ]);
    return normalizeText(stdout || "");
  });
}

async function extractPdfText(buffer: Buffer, fileName: string): Promise<{
  text: string;
  pageCount: number;
}> {
  return withTempFile(fileName, buffer, async (filePath) => {
    const swiftSource = `
import Foundation
import PDFKit

let pdfPath = CommandLine.arguments[1]
let url = URL(fileURLWithPath: pdfPath)
guard let document = PDFDocument(url: url) else {
  fputs("Failed to open PDF\\n", stderr)
  exit(2)
}

let payload: [String: Any] = [
  "text": document.string ?? "",
  "pageCount": document.pageCount,
]

let data = try JSONSerialization.data(withJSONObject: payload, options: [])
FileHandle.standardOutput.write(data)
`;

    const scriptDir = await mkdtemp(join(tmpdir(), "replymate-pdfkit-"));
    const scriptPath = join(scriptDir, "extract.swift");

    try {
      await writeFile(scriptPath, swiftSource);
      const { stdout } = await execFileAsync("/usr/bin/swift", [scriptPath, filePath]);
      const payload = JSON.parse(String(stdout || "{}")) as {
        text?: string;
        pageCount?: number;
      };
      return {
        text: normalizeText(payload.text || ""),
        pageCount:
          typeof payload.pageCount === "number" && Number.isFinite(payload.pageCount)
            ? payload.pageCount
            : 0,
      };
    } finally {
      await rm(scriptDir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

export class LocalDocumentParserAdapter implements DocumentParserAdapter {
  constructor(
    private readonly options: {
      imageWarning?: string;
      runtimeType?: ParserProviderStatus["runtimeType"];
    } = {}
  ) {}

  async checkHealth(): Promise<ParserProviderStatus> {
    return {
      runtimeType: this.options.runtimeType ?? "metadata_local",
      ready: false,
      imageOcrAvailable: false,
      warning:
        this.options.imageWarning ||
        "Image OCR is not configured; using metadata-only summaries for images.",
      fallbackMode: "metadata_local",
      recommendedModelName: "minicpm-v",
      setupHint:
        "DOCX and text-based PDF extraction work locally. Use minicpm-v for image OCR.",
    };
  }

  async summarizeFile(input: EvidenceIngestRequest): Promise<EvidenceSummary> {
    const mimeType = input.mimeType.toLowerCase();

    if (mimeType === "text/plain" || mimeType === "text/markdown") {
      const raw = (await toBuffer(input.fileData)).toString("utf8");
      const normalized = normalizeText(raw);

      if (!normalized) {
        return buildEvidenceSummary({
          fileName: input.fileName,
          parserMode: "metadata_fallback",
          summaryText: `Uploaded ${input.fileName}. Could not decode text content.`,
          confidence: "low",
          warnings: ["Text extraction failed; using metadata-only summary."],
        });
      }

      return buildEvidenceSummary({
        fileName: input.fileName,
        parserMode: "metadata_fallback",
        summaryText: buildNativeTextSummary("Text", input.fileName, normalized),
        confidence: "high",
        warnings:
          normalized.length > MAX_TEXT_SNIPPET_CHARS
            ? ["Text content shortened for latency and context limits."]
            : [],
        extractedTextChars: normalized.length,
      });
    }

    if (
      mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      try {
        const extractedText = await extractDocxText(await toBuffer(input.fileData), input.fileName);

        if (!extractedText) {
          return buildEvidenceSummary({
            fileName: input.fileName,
            parserMode: "metadata_fallback",
            summaryText: `DOCX uploaded: ${input.fileName}. No readable text was extracted.`,
            confidence: "low",
            warnings: ["DOCX extraction found little or no readable text."],
          });
        }

        return buildEvidenceSummary({
          fileName: input.fileName,
          parserMode: "docx_text",
          summaryText: buildNativeTextSummary("DOCX text", input.fileName, extractedText),
          confidence: "high",
          warnings: [],
          extractedTextChars: extractedText.length,
        });
      } catch (error) {
        throw new ProviderError({
          message:
            error instanceof Error
              ? `DOCX extraction failed: ${error.message}`
              : "DOCX extraction failed.",
          errorCode: "EVIDENCE_PARSE_FAILED",
          statusCode: 502,
        });
      }
    }

    if (mimeType === "application/pdf") {
      try {
        const extracted = await extractPdfText(await toBuffer(input.fileData), input.fileName);

        if (extracted.text.length < 80) {
          return buildEvidenceSummary({
            fileName: input.fileName,
            parserMode: "metadata_fallback",
            summaryText:
              `PDF uploaded: ${input.fileName}. Embedded text extraction found little or no readable content.`,
            confidence: "low",
            warnings: [
              "PDF appears to be scanned/image-only; text extraction is limited in this parser path.",
            ],
            sourcePageCount: extracted.pageCount,
            extractedTextChars: extracted.text.length,
          });
        }

        return buildEvidenceSummary({
          fileName: input.fileName,
          parserMode: "pdf_text",
          summaryText: buildNativeTextSummary("PDF text", input.fileName, extracted.text),
          confidence: "high",
          warnings: [],
          sourcePageCount: extracted.pageCount,
          extractedTextChars: extracted.text.length,
        });
      } catch (error) {
        throw new ProviderError({
          message:
            error instanceof Error
              ? `PDF extraction failed: ${error.message}`
              : "PDF extraction failed.",
          errorCode: "EVIDENCE_PARSE_FAILED",
          statusCode: 502,
        });
      }
    }

    if (mimeType.startsWith("image/")) {
      const sizeKb = Math.max(1, Math.round((await toBuffer(input.fileData)).byteLength / 1024));
      return buildEvidenceSummary({
        fileName: input.fileName,
        parserMode: "metadata_fallback",
        summaryText:
          `Image uploaded: ${input.fileName} (${mimeType}, ${sizeKb} KB). Using metadata-only image summary for drafting context.`,
        confidence: "low",
        warnings: [
          this.options.imageWarning ||
            "Image OCR is not configured; using metadata-only summary.",
        ],
      });
    }

    return buildEvidenceSummary({
      fileName: input.fileName,
      parserMode: "metadata_fallback",
      summaryText:
        `File uploaded: ${input.fileName}. Unsupported parser path used metadata-only fallback.`,
      confidence: "low",
      warnings: ["Unsupported parser path; using metadata-only summary."],
    });
  }
}
