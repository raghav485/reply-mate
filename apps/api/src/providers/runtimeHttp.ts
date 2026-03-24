import { ProviderError } from "../core/errors.js";

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export async function fetchJsonWithTimeout<T>(
  baseUrl: string,
  path: string,
  init: RequestInit,
  timeoutMs: number,
  errorCode: string
): Promise<T> {
  const controller = new AbortController();
  const timeoutMessage = `Runtime request timed out after ${timeoutMs} ms while calling ${path}.`;
  const timeoutId = setTimeout(() => controller.abort(new Error(timeoutMessage)), timeoutMs);

  try {
    const response = await fetch(joinUrl(baseUrl, path), {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderError({
        message: `Runtime request failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`,
        errorCode,
        statusCode: 502,
      });
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ProviderError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new ProviderError({
        message: timeoutMessage,
        errorCode: "GENERATION_TIMEOUT",
        statusCode: 504,
      });
    }

    throw new ProviderError({
      message: error instanceof Error ? error.message : String(error),
      errorCode,
      statusCode: 502,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
