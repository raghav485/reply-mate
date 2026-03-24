// =============================================================================
// ApiClient — HTTP client for backend API
// =============================================================================

import type { ApiClient as IApiClient } from "@replymate/contracts";

const DEFAULT_TIMEOUT = 45_000; // 45s — TRD §21.5

type RequestOptions = {
  timeoutMs?: number;
};

type ApiErrorPayload = {
  message?: string;
  errorCode?: string;
};

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode?: string
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export class ApiClientImpl implements IApiClient {
  private baseUrl = "";
  private token = "";

  getBaseUrl(): string {
    return this.baseUrl;
  }

  setBaseUrl(url: string): void {
    // Strip trailing slash
    this.baseUrl = url.replace(/\/+$/, "");
  }

  setToken(token: string): void {
    this.token = token;
  }

  getToken(): string {
    return this.token;
  }

  async get<T>(path: string, options?: RequestOptions): Promise<T> {
    const response = await this.fetch(path, { method: "GET" }, options);
    return response.json() as Promise<T>;
  }

  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    const response = await this.fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }, options);
    return response.json() as Promise<T>;
  }

  async postMultipart<T>(path: string, formData: FormData, options?: RequestOptions): Promise<T> {
    // Don't set Content-Type — browser sets it with boundary
    const response = await this.fetch(path, {
      method: "POST",
      body: formData,
    }, options);
    return response.json() as Promise<T>;
  }

  private async fetch(
    path: string,
    init: RequestInit,
    options?: RequestOptions
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          ...((init.headers as Record<string, string>) ?? {}),
          ...(this.token
            ? { Authorization: `Bearer ${this.token}` }
            : {}),
        },
      });

      if (!response.ok) {
        let payload: ApiErrorPayload | null = null;
        try {
          payload = (await response.clone().json()) as ApiErrorPayload;
        } catch {
          payload = null;
        }

        throw new ApiClientError(
          payload?.message || `API error: ${response.status} ${response.statusText}`,
          response.status,
          payload?.errorCode
        );
      }

      return response;
    } catch (error) {
      if (
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && /abort/i.test(error.message))
      ) {
        throw new ApiClientError(
          "Request timed out while waiting for backend processing.",
          408,
          "REQUEST_TIMEOUT"
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
