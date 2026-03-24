import { describe, expect, it } from "vitest";
import {
  selectGenerationPath,
  selectRemoteTranscriptionPath,
} from "../costPolicy.js";

describe("costPolicy", () => {
  describe("selectGenerationPath", () => {
    it("keeps local_only on local model generation when available", () => {
      expect(
        selectGenerationPath({
          costMode: "local_only",
          hasLocalModelGeneration: true,
          hasCloudGeneration: false,
        })
      ).toBe("local_model");
    });

    it("blocks local_only when no local generation provider exists", () => {
      expect(
        selectGenerationPath({
          costMode: "local_only",
          hasLocalModelGeneration: false,
          hasCloudGeneration: true,
        })
      ).toBe("blocked");
    });

    it("prefers local generation in hybrid mode", () => {
      expect(
        selectGenerationPath({
          costMode: "hybrid_low_cost",
          hasLocalModelGeneration: true,
          hasCloudGeneration: true,
        })
      ).toBe("local_model");
    });

    it("falls back to cloud generation in hybrid mode when local is unavailable", () => {
      expect(
        selectGenerationPath({
          costMode: "hybrid_low_cost",
          hasLocalModelGeneration: false,
          hasCloudGeneration: true,
        })
      ).toBe("cloud");
    });

    it("uses local model in cloud_quality mode when cloud is unavailable", () => {
      expect(
        selectGenerationPath({
          costMode: "cloud_quality",
          hasLocalModelGeneration: true,
          hasCloudGeneration: false,
        })
      ).toBe("local_model");
    });

    it("uses cloud generation first in cloud_quality mode", () => {
      expect(
        selectGenerationPath({
          costMode: "cloud_quality",
          hasLocalModelGeneration: false,
          hasCloudGeneration: true,
        })
      ).toBe("cloud");
    });

    it("blocks cloud_quality mode when no drafting provider is available", () => {
      expect(
        selectGenerationPath({
          costMode: "cloud_quality",
          hasLocalModelGeneration: false,
          hasCloudGeneration: false,
        })
      ).toBe("blocked");
    });
  });

  describe("selectRemoteTranscriptionPath", () => {
    it("blocks remote transcription in local_only mode", () => {
      expect(
        selectRemoteTranscriptionPath({
          costMode: "local_only",
          hasRemoteTranscription: true,
        })
      ).toBe("blocked");
    });

    it("allows hybrid remote transcription when configured", () => {
      expect(
        selectRemoteTranscriptionPath({
          costMode: "hybrid_low_cost",
          hasRemoteTranscription: true,
        })
      ).toBe("cloud");
    });

    it("allows cloud_quality transcription when configured", () => {
      expect(
        selectRemoteTranscriptionPath({
          costMode: "cloud_quality",
          hasRemoteTranscription: true,
        })
      ).toBe("cloud");
    });
  });
});
