import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, ApiClientImpl } from "../ApiClient.js";

describe("ApiClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("maps aborted evidence requests to REQUEST_TIMEOUT", async () => {
    vi.useFakeTimers();
    const client = new ApiClientImpl();
    client.setBaseUrl("https://replymate.test");

    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("The user aborted a request.", "AbortError"));
          });
        });
      })
    );

    const request = client.get("/v1/evidence/jobs/job-1", { timeoutMs: 5 });
    const assertion = expect(request).rejects.toEqual(
      new ApiClientError(
        "Request timed out while waiting for backend processing.",
        408,
        "REQUEST_TIMEOUT"
      )
    );
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
  });
});
