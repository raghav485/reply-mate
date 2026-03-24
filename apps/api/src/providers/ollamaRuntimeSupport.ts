import { fetchJsonWithTimeout } from "./runtimeHttp.js";

type OllamaTagsResponse = {
  models?: Array<{
    name?: string;
    model?: string;
  }>;
};

type OllamaShowResponse = {
  capabilities?: string[];
};

export async function fetchOllamaAvailableModels(
  baseUrl: string,
  timeoutMs: number
): Promise<string[]> {
  const response = await fetchJsonWithTimeout<OllamaTagsResponse>(
    baseUrl,
    "/api/tags",
    { method: "GET" },
    timeoutMs,
    "DRAFT_PROVIDER_UNAVAILABLE"
  );

  return Array.isArray(response.models)
    ? response.models
        .map((item) => item.name || item.model || "")
        .filter((item) => item.trim().length > 0)
    : [];
}

export async function fetchOllamaModelCapabilities(
  baseUrl: string,
  modelName: string,
  timeoutMs: number
): Promise<string[]> {
  const response = await fetchJsonWithTimeout<OllamaShowResponse>(
    baseUrl,
    "/api/show",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName }),
    },
    timeoutMs,
    "DRAFT_PROVIDER_UNAVAILABLE"
  );

  return Array.isArray(response.capabilities)
    ? response.capabilities.filter((item): item is string => typeof item === "string")
    : [];
}
