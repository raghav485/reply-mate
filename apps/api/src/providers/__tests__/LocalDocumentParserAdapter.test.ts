import { describe, expect, it, vi } from "vitest";
import { LocalDocumentParserAdapter } from "../LocalDocumentParserAdapter.js";

describe("LocalDocumentParserAdapter", () => {
  it("reports Windows parser health truthfully", async () => {
    const adapter = new LocalDocumentParserAdapter({ platform: "win32" });
    const health = await adapter.checkHealth();

    expect(health.setupHint).toContain("Windows supports local TXT/Markdown");
    expect(health.setupHint).toContain("PDF uploads fall back to metadata");
  });

  it("uses Windows DOCX extraction through the built-in PowerShell path", async () => {
    const processRunner = vi.fn(async () => ({
      stdout: "Project kickoff notes and action items",
      stderr: "",
    }));
    const adapter = new LocalDocumentParserAdapter({
      platform: "win32",
      processRunner,
    });

    const summary = await adapter.summarizeFile({
      fileName: "notes.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileData: Buffer.from("docx"),
    });

    expect(summary.parserMode).toBe("docx_text");
    expect(summary.summaryText).toContain("Project kickoff notes");
  });

  it("falls back honestly for Windows PDF parsing", async () => {
    const adapter = new LocalDocumentParserAdapter({ platform: "win32" });

    const summary = await adapter.summarizeFile({
      fileName: "proposal.pdf",
      mimeType: "application/pdf",
      fileData: Buffer.from("pdf"),
    });

    expect(summary.parserMode).toBe("metadata_fallback");
    expect(summary.warnings[0]).toContain("Windows local PDF text extraction");
  });
});
