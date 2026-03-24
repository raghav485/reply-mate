import type {
  DraftingProviderStatus,
  GenerateDraftRequest,
  GenerateDraftResponse,
  LLMProviderAdapter,
} from "@replymate/contracts";
import { ProviderError, ValidationError } from "../core/errors.js";
import {
  buildCleanedDraftPrompt,
  buildContextReplyPrompt,
  buildDraftingPrompt,
} from "./draftingPrompts.js";
import {
  buildDraftResponse,
  buildImproveDraftResponse,
  getContextCoverageWarning,
} from "./draftingResponse.js";
import { buildImproveDraftDebug } from "./draftDiagnostics.js";
import {
  parseAndValidateModelDrafts,
  parseSingleDraftText,
  validateCleanedDraftCandidate,
  validateContextReplyCandidate,
  selectPreferredContextReplyCandidate,
  selectPreferredLlmCleanupCandidate,
  extractAssistantTextContent,
} from "./draftingValidation.js";
import {
  createDraftGenerationInput,
} from "./draftInput.js";
import { logImproveDraftTrace } from "./draftDebug.js";
import {
  type DraftGenerationInput,
  type CleanedDraftCandidate,
  type ContextReplyCandidate,
  type DraftValidationOutcome,
} from "./draftingTypes.js";
import { fetchJsonWithTimeout } from "./runtimeHttp.js";

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

type ModelsResponse = {
  data?: Array<{
    id?: string;
  }>;
};

type AttemptCandidate = {
  outcome: DraftValidationOutcome;
  strictRetry: boolean;
};

function isRecoverableModelValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError && error.errorCode === "INVALID_MODEL_OUTPUT";
}

function buildApiPath(baseUrl: string, resource: "models" | "chat/completions"): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/v1")) {
    return `/${resource}`;
  }
  return `/v1/${resource}`;
}

export class GenericLocalChatApiLLMProviderAdapter implements LLMProviderAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly modelName: string,
    private readonly timeoutMs: number,
    private readonly apiKey = "",
    private readonly options: {
      temperature: number;
      topP: number;
      repeatPenalty: number;
    } = {
      temperature: 0.15,
      topP: 0.85,
      repeatPenalty: 1.05,
    }
  ) {}

  async checkHealth(): Promise<DraftingProviderStatus> {
    if (!this.modelName.trim()) {
      return {
        runtimeType: "generic_local_chat_api",
        ready: false,
        warning: "No local drafting model is configured.",
        recommendedModelName: "qwen3:8b",
        setupHint: "Recommended for M4 / 16GB: qwen3:8b for writing.",
      };
    }

    try {
      const response = await fetchJsonWithTimeout<ModelsResponse>(
        this.baseUrl,
        buildApiPath(this.baseUrl, "models"),
        {
          method: "GET",
          headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
        },
        this.timeoutMs,
        "DRAFT_PROVIDER_UNAVAILABLE"
      );

      const modelIds = Array.isArray(response.data)
        ? response.data.map((item) => item.id || "").filter((item) => item.trim().length > 0)
        : [];
      const ready = modelIds.includes(this.modelName);

      return {
        runtimeType: "generic_local_chat_api",
        ready,
        modelName: this.modelName,
        warning: ready
          ? undefined
          : `Local chat API is reachable, but model "${this.modelName}" was not found.`,
        recommendedModelName: "qwen3:8b",
        setupHint: "Use qwen3:8b as the default local writing model.",
      };
    } catch (error) {
      return {
        runtimeType: "generic_local_chat_api",
        ready: false,
        modelName: this.modelName,
        warning: error instanceof Error ? error.message : String(error),
        recommendedModelName: "qwen3:8b",
        setupHint: "Use qwen3:8b as the default local writing model.",
      };
    }
  }

  async generateDrafts(input: GenerateDraftRequest): Promise<GenerateDraftResponse> {
    const normalized: DraftGenerationInput = createDraftGenerationInput(input);

    const requestText = async (
      prompt: { system: string; user: string },
      structuredOutput: boolean
    ): Promise<string> => {
      const response = await fetchJsonWithTimeout<ChatCompletionResponse>(
        this.baseUrl,
        buildApiPath(this.baseUrl, "chat/completions"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: this.modelName,
            temperature: this.options.temperature,
            top_p: this.options.topP,
            presence_penalty: 0,
            frequency_penalty: Math.max(0, this.options.repeatPenalty - 1),
            ...(structuredOutput ? { response_format: { type: "json_object" } } : {}),
            messages: [
              { role: "system", content: prompt.system },
              { role: "user", content: prompt.user },
            ],
          }),
        },
        this.timeoutMs,
        "GENERATION_FAILED"
      );

      return extractAssistantTextContent(response.choices?.[0]?.message?.content);
    };

    if (input.actionMode === "improve_current_draft") {
      const hasUsableContext =
        Boolean(normalized.selectedContext.responseTarget) ||
        normalized.selectedContext.supportingTurns.length > 0 ||
        normalized.selectedContext.contextFacts.length > 0;

      const cleanedCandidates: CleanedDraftCandidate[] = [];
      let cleanedUsedRetry = false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const strictRetry = attempt === 1;
        const prompt = buildCleanedDraftPrompt(normalized, strictRetry);

        for (const structuredOutput of [true, false] as const) {
          let rawContent = "";
          try {
            rawContent = await requestText(prompt, structuredOutput);
          } catch (error) {
            if (
              cleanedCandidates.length > 0 &&
              error instanceof ProviderError &&
              error.errorCode === "GENERATION_TIMEOUT"
            ) {
              break;
            }
            throw error;
          }

          if (!rawContent) continue;

          try {
            const parsed = parseSingleDraftText(rawContent, "primary");
            const candidate = validateCleanedDraftCandidate(parsed.text, normalized);
            const mergedCandidate: CleanedDraftCandidate = {
              ...candidate,
              warnings: [...parsed.warnings, ...candidate.warnings],
            };
            cleanedCandidates.push(mergedCandidate);
            cleanedUsedRetry = cleanedUsedRetry || strictRetry;
            if (!mergedCandidate.shouldRetry) {
              attempt = 2;
              break;
            }
          } catch (error) {
            if (isRecoverableModelValidationError(error)) {
              continue;
            }
            throw error;
          }
        }
      }

      const cleanedSelection = selectPreferredLlmCleanupCandidate({
        modelCandidates: cleanedCandidates,
      });
      if (!cleanedSelection) {
        throw new ProviderError({
          message: "Improve Draft could not produce a safe cleaned draft from the available model.",
          errorCode: "DRAFT_QUALITY_UNAVAILABLE",
          retryable: false,
          statusCode: 503,
        });
      }

      const cleanedDraftText = cleanedSelection.text;
      const warnings: string[] = [];
      if (cleanedSelection.softIssues.length > 0 || cleanedSelection.shouldRetry) {
        warnings.push(
          "Cleaned Draft quality was limited; returned the strongest safe LLM cleanup available."
        );
      }
      warnings.push(...cleanedSelection.warnings);

      const contextCandidates: ContextReplyCandidate[] = [];
      let contextUsedRetry = false;
      if (hasUsableContext) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const strictRetry = attempt === 1;
          const prompt = buildContextReplyPrompt(normalized, cleanedDraftText, strictRetry);

          for (const structuredOutput of [true, false] as const) {
          let rawContent = "";
          try {
            rawContent = await requestText(prompt, structuredOutput);
          } catch (error) {
            if (
              contextCandidates.length > 0 &&
              error instanceof ProviderError &&
              error.errorCode === "GENERATION_TIMEOUT"
            ) {
              break;
              }
              throw error;
            }

            if (!rawContent) continue;

            try {
              const parsed = parseSingleDraftText(rawContent, "alternate");
              const candidate = validateContextReplyCandidate(
                parsed.text,
                normalized,
                cleanedDraftText
              );
              const mergedCandidate: ContextReplyCandidate = {
                ...candidate,
                warnings: [...parsed.warnings, ...candidate.warnings],
              };
              contextCandidates.push(mergedCandidate);
              contextUsedRetry = contextUsedRetry || strictRetry;
              if (!mergedCandidate.shouldRetry) {
                attempt = 2;
                break;
              }
            } catch (error) {
              if (isRecoverableModelValidationError(error)) {
                continue;
              }
              throw error;
            }
          }
        }
      }

      const contextSelection = selectPreferredContextReplyCandidate({
        modelCandidates: contextCandidates,
      });
      const contextReplyText = contextSelection ? contextSelection.text : cleanedDraftText;
      const contextWinner = contextSelection ? "model" : "cleaned_draft_reuse";
      const contextCoverageWarning = getContextCoverageWarning(normalized);
      if (contextCoverageWarning) {
        warnings.push(contextCoverageWarning);
      }
      if (contextSelection) {
        if (contextSelection.softIssues.length > 0 || contextSelection.shouldRetry) {
          warnings.push(
            "Context Reply quality was limited; returned the strongest safe model-authored contextual reply available."
          );
        }
        warnings.push(...contextSelection.warnings);
      } else {
        warnings.push(
          "Context Reply could not be safely improved with grounded context; the second card mirrors the cleaned draft."
        );
      }

      const usedRetryPass = cleanedUsedRetry || contextUsedRetry;
      const debug = buildImproveDraftDebug({
        input: normalized,
        runtime: "generic_local_chat_api",
        usedRetryPass,
        cleanedSelection,
        cleanedModelCandidate: cleanedSelection,
        contextCandidate: contextSelection,
        contextWinner,
      });
      logImproveDraftTrace(debug);

      const builtResponse = buildImproveDraftResponse({
        input: normalized,
        cleanedDraftText,
        contextReplyText,
        warnings: [...new Set(warnings.filter(Boolean))],
        providerPath: "local_model",
        debug,
      });
      return {
        ...builtResponse,
        timings: {
          ...builtResponse.timings,
          usedRetryPass,
        },
      };
    }

    let bestCandidate: AttemptCandidate | null = null;

    const rememberCandidate = (candidate: AttemptCandidate) => {
      if (!bestCandidate) {
        bestCandidate = candidate;
        return;
      }

      if (candidate.outcome.qualityScore !== bestCandidate.outcome.qualityScore) {
        if (candidate.outcome.qualityScore > bestCandidate.outcome.qualityScore) {
          bestCandidate = candidate;
        }
        return;
      }

      if (candidate.outcome.warnings.length < bestCandidate.outcome.warnings.length) {
        bestCandidate = candidate;
      }
    };
    const getBestCandidate = (): AttemptCandidate | null => bestCandidate;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const strictRetry = attempt === 1;
      const prompt = buildDraftingPrompt(normalized, strictRetry);

      for (const structuredOutput of [true, false] as const) {
        let response: ChatCompletionResponse;
        try {
          response = await fetchJsonWithTimeout<ChatCompletionResponse>(
            this.baseUrl,
            buildApiPath(this.baseUrl, "chat/completions"),
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
              },
              body: JSON.stringify({
                model: this.modelName,
                temperature: this.options.temperature,
                top_p: this.options.topP,
                presence_penalty: 0,
                frequency_penalty: Math.max(0, this.options.repeatPenalty - 1),
                ...(structuredOutput ? { response_format: { type: "json_object" } } : {}),
                messages: [
                  { role: "system", content: prompt.system },
                  { role: "user", content: prompt.user },
                ],
              }),
            },
            this.timeoutMs,
            "GENERATION_FAILED"
          );
        } catch (error) {
          const safeCandidate = getBestCandidate();
          if (
            safeCandidate &&
            error instanceof ProviderError &&
            error.errorCode === "GENERATION_TIMEOUT"
          ) {
            const builtResponse = buildDraftResponse({
              input: normalized,
              drafts: safeCandidate.outcome.drafts,
              warnings: [
                ...safeCandidate.outcome.warnings,
                "Local model timed out during refinement; returned the best completed result.",
              ],
              providerPath: "local_model",
            });
            return {
              ...builtResponse,
              timings: {
                ...builtResponse.timings,
                usedRetryPass: safeCandidate.strictRetry,
              },
            };
          }
          throw error;
        }

        const rawContent = extractAssistantTextContent(
          response.choices?.[0]?.message?.content
        );

        if (!rawContent) {
          continue;
        }

        let parsed: DraftValidationOutcome;
        try {
          parsed = parseAndValidateModelDrafts(rawContent, normalized);
        } catch (error) {
          if (isRecoverableModelValidationError(error)) {
            continue;
          }
          throw error;
        }
        rememberCandidate({ outcome: parsed, strictRetry });

        if (parsed.shouldRetry && !strictRetry) {
          break;
        }
        if (!parsed.shouldRetry || parsed.softIssues.length === 0) {
          const builtResponse = buildDraftResponse({
            input: normalized,
            drafts: parsed.drafts,
            warnings: parsed.warnings,
            providerPath: "local_model",
          });
          return {
            ...builtResponse,
            timings: {
              ...builtResponse.timings,
              usedRetryPass: strictRetry,
            },
          };
        }
      }
    }

    const safeCandidate = getBestCandidate();
    if (safeCandidate) {
      const builtResponse = buildDraftResponse({
        input: normalized,
        drafts: safeCandidate.outcome.drafts,
        warnings: [
          ...safeCandidate.outcome.warnings,
          "Context Reply was not strongly differentiated from Cleaned Draft; returned best effort.",
          "Local model quality was limited for this request; returned the safest available result.",
        ],
        providerPath: "local_model",
      });
      return {
        ...builtResponse,
        timings: {
          ...builtResponse.timings,
          usedRetryPass: safeCandidate.strictRetry,
        },
      };
    }

    throw new ProviderError({
      message:
        "The local chat runtime returned an empty or unusable reply. ReplyMate retried automatically, but no draft text was produced.",
      errorCode: "INVALID_MODEL_OUTPUT",
      statusCode: 502,
    });
  }
}
