import { describe, expect, it } from "vitest";
import { ApiClientError } from "../../shared-client/ApiClient.js";
import {
  buildEvidenceIngestFailure,
  serializeUnknownError,
} from "../evidenceErrors.js";

describe("evidenceErrors", () => {
  it("serializes ApiClientError without collapsing to [object Object]", () => {
    const error = new ApiClientError("File too large.", 413, "FILE_TOO_LARGE");
    const serialized = serializeUnknownError(error);

    expect(serialized).toEqual({
      message: "File too large.",
      errorCode: "FILE_TOO_LARGE",
      status: 413,
      name: "ApiClientError",
      rawType: "ApiClientError",
    });
  });

  it("treats ApiClientError evidence failures as expected warnings", () => {
    const error = new ApiClientError("File too large.", 413, "FILE_TOO_LARGE");
    const failure = buildEvidenceIngestFailure(error);

    expect(failure.expected).toBe(true);
    expect(failure.logMessage).toBe("Evidence ingest failed: API 413 FILE_TOO_LARGE");
    expect(failure.userMessage).toBe("File too large.");
  });

  it("serializes plain error objects with readable fields", () => {
    const failure = buildEvidenceIngestFailure({
      message: "Parser timed out.",
      errorCode: "EVIDENCE_PARSE_FAILED",
      status: 504,
    });

    expect(failure.expected).toBe(true);
    expect(failure.logMessage).toBe("Evidence ingest failed: API 504 EVIDENCE_PARSE_FAILED");
    expect(failure.userMessage).toBe("Parser timed out.");
  });

  it("marks unknown failures as unexpected errors", () => {
    const failure = buildEvidenceIngestFailure(new Error("Disk write failed."));

    expect(failure.expected).toBe(false);
    expect(failure.logMessage).toBe("Evidence ingest failed unexpectedly: Disk write failed.");
    expect(failure.userMessage).toBe("Disk write failed.");
  });

  it("treats browser abort strings as expected evidence failures", () => {
    const failure = buildEvidenceIngestFailure(
      new Error("signal is aborted without reason")
    );

    expect(failure.expected).toBe(true);
    expect(failure.logMessage).toBe(
      "Evidence ingest failed: signal is aborted without reason"
    );
  });
});
