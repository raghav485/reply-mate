import { randomUUID } from "node:crypto";
import type { EvidenceSummary } from "@replymate/contracts";
import { ValidationError } from "../core/errors.js";

export type VisionOcrPayload = {
  visible_text?: string;
  summary?: string;
  confidence?: EvidenceSummary["confidence"];
  warnings?: string[];
};

const MAX_SUMMARY_CHARS = 1200;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ValidationError("Vision parser output was empty.", "INVALID_MODEL_OUTPUT");
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i);
  const candidate = fencedMatch?.[1]?.trim() || trimmed;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");

  if (firstBrace < 0 || lastBrace < firstBrace) {
    throw new ValidationError(
      "Vision parser output did not contain a JSON object.",
      "INVALID_MODEL_OUTPUT"
    );
  }

  return candidate.slice(firstBrace, lastBrace + 1);
}

export function parseVisionOcrPayload(raw: string): VisionOcrPayload {
  try {
    return JSON.parse(extractJsonObject(raw)) as VisionOcrPayload;
  } catch (error) {
    throw new ValidationError(
      error instanceof Error ? error.message : "Failed to parse OCR response.",
      "INVALID_MODEL_OUTPUT"
    );
  }
}

export function buildVisionPrompt(fileName: string): {
  system: string;
  user: string;
} {
  return {
    system:
      "You are an OCR and document-understanding assistant for ReplyMate. Extract readable text from images and summarize only what is visually present. Return JSON only.",
    user: [
      "Analyze the attached image and return JSON with this exact shape:",
      '{"visible_text":"...","summary":"...","confidence":"high|medium|low","warnings":["..."]}',
      "",
      `File name: ${fileName}`,
      "Rules:",
      "- Extract the visible text as accurately as possible.",
      "- Preserve meaningful line breaks in visible_text when layout matters.",
      "- summary must briefly explain the image content for reply drafting.",
      "- If little or no readable text exists, say so in warnings and keep confidence low.",
      "- Do not invent text that is not visible in the image.",
    ].join("\n"),
  };
}

export function buildImageEvidenceSummary(input: {
  fileName: string;
  payload: VisionOcrPayload;
}): EvidenceSummary {
  const warnings = Array.isArray(input.payload.warnings)
    ? input.payload.warnings.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0
      )
    : [];
  const confidence =
    input.payload.confidence === "high" ||
    input.payload.confidence === "low" ||
    input.payload.confidence === "medium"
      ? input.payload.confidence
      : "medium";
  const visibleText = typeof input.payload.visible_text === "string"
    ? input.payload.visible_text.trim()
    : "";
  const summary = typeof input.payload.summary === "string" ? input.payload.summary.trim() : "";

  const pieces = [
    visibleText ? `OCR extracted from ${input.fileName}:\n${visibleText}` : "",
    summary ? `Summary: ${normalizeText(summary)}` : "",
  ].filter(Boolean);

  let summaryText = pieces.join("\n\n").trim();
  if (!summaryText) {
    summaryText = `Image uploaded: ${input.fileName}. OCR did not find usable text.`;
  }

  const truncated = summaryText.length > MAX_SUMMARY_CHARS;
  if (truncated) {
    summaryText = summaryText.slice(0, MAX_SUMMARY_CHARS).trimEnd();
    warnings.push("Summary truncated to max per-file character limit.");
  }

  if (!visibleText) {
    warnings.push("OCR found little or no readable text in the image.");
  }

  return {
    evidenceId: `ev_${randomUUID()}`,
    name: input.fileName,
    mode: "context_only",
    mentionInReply: false,
    summaryText,
    parserMode: "image_ocr",
    confidence,
    warnings,
    truncated,
    summaryCharCount: summaryText.length,
    extractedTextChars: visibleText.length,
  };
}
