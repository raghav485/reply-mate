import { describe, expect, it, vi } from "vitest";
import { fetchJsonWithTimeout } from "../runtimeHttp.js";

describe("fetchJsonWithTimeout", () => {
  it("returns an explicit timeout message when the request aborts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url, init) => {
        const signal = init?.signal as AbortSignal | undefined;
        await new Promise((_, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
        return undefined;
      })
    );

    await expect(
      fetchJsonWithTimeout(
        "http://127.0.0.1:11434",
        "/api/chat",
        { method: "POST" },
        5,
        "GENERATION_FAILED"
      )
    ).rejects.toMatchObject({
      errorCode: "GENERATION_TIMEOUT",
      message: "Runtime request timed out after 5 ms while calling /api/chat.",
    });

    vi.unstubAllGlobals();
  });
});
