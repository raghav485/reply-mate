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
  selectImproveDraftCleanupCandidate,
} from "./draftingValidation.js";
import { createDraftGenerationInput } from "./draftInput.js";
import { logImproveDraftTrace } from "./draftDebug.js";
import type {
  CleanedDraftCandidate,
  ContextReplyCandidate,
  DraftGenerationInput,
  DraftValidationOutcome,
} from "./draftingTypes.js";
import { fetchJsonWithTimeout } from "./runtimeHttp.js";

type GeminiModelsResponse = {
  models?: Array<{
    name?: string;
  }>;
};

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

type AttemptCandidate = {
  outcome: DraftValidationOutcome;
  strictRetry: boolean;
};

function isRecoverableModelValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError && error.errorCode === "INVALID_MODEL_OUTPUT";
}

function normalizeGeminiModelName(modelName: string): string {
  return modelName.startsWith("models/") ? modelName : `models/${modelName}`;
}

function extractGeminiText(response: GeminiGenerateResponse): string {
  const parts = response.candidates?.[0]?.content?.parts;
  return Array.isArray(parts)
    ? parts
        .map((part) => (typeof part.text === "string" ? part.text.trim() : ""))
        .filter(Boolean)
        .join("\n\n")
    : "";
}

export class GeminiLLMProviderAdapter implements LLMProviderAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly modelName: string,
    private readonly timeoutMs: number,
    private readonly apiKey: string,
    private readonly options: {
      temperature: number;
      topP: number;
      maxOutputTokens?: number;
    } = {
      temperature: 0.15,
      topP: 0.85,
    }
  ) {}

  async checkHealth(): Promise<DraftingProviderStatus> {
    if (!this.modelName.trim()) {
      return {
        runtimeType: "gemini",
        ready: false,
        warning: "No Gemini model is configured.",
      };
    }

    if (!this.apiKey.trim()) {
      return {
        runtimeType: "gemini",
        ready: false,
        modelName: this.modelName,
        warning: "Gemini API key is required.",
      };
    }

    try {
      const response = await fetchJsonWithTimeout<GeminiModelsResponse>(
        this.baseUrl,
        "/v1beta/models",
        {
          method: "GET",
          headers: {
            "x-goog-api-key": this.apiKey,
          },
        },
        Math.min(this.timeoutMs, 10_000),
        "DRAFT_PROVIDER_UNAVAILABLE"
      );
      const expected = normalizeGeminiModelName(this.modelName);
      const available = Array.isArray(response.models)
        ? response.models
            .map((item) => item.name || "")
            .filter((item) => item.trim().length > 0)
        : [];
      const ready = available.includes(expected);

      return {
        runtimeType: "gemini",
        ready,
        modelName: this.modelName,
        warning: ready ? undefined : `Gemini API is reachable, but model "${this.modelName}" was not found.`,
      };
    } catch (error) {
      return {
        runtimeType: "gemini",
        ready: false,
        modelName: this.modelName,
        warning: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async generateDrafts(input: GenerateDraftRequest): Promise<GenerateDraftResponse> {
    const normalized: DraftGenerationInput = createDraftGenerationInput(input);

    const requestText = async (
      prompt: { system: string; user: string },
      structuredOutput: boolean
    ): Promise<string> => {
      const response = await fetchJsonWithTimeout<GeminiGenerateResponse>(
        this.baseUrl,
        `/v1beta/${normalizeGeminiModelName(this.modelName)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: prompt.system }],
            },
            contents: [
              {
                parts: [{ text: prompt.user }],
              },
            ],
            generationConfig: {
              temperature: this.options.temperature,
              topP: this.options.topP,
              maxOutputTokens: this.options.maxOutputTokens ?? 1600,
              ...(structuredOutput ? { responseMimeType: "application/json" } : {}),
            },
          }),
        },
        this.timeoutMs,
        "GENERATION_FAILED"
      );

      return extractGeminiText(response);
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

      const cleanupSelection = selectImproveDraftCleanupCandidate({
        modelCandidates: cleanedCandidates,
      });
      if (!cleanupSelection.cleanedSelection || !cleanupSelection.cleanupWinner) {
        throw new ProviderError({
          message: "Improve Draft could not produce a safe cleaned draft from the Gemini model.",
          errorCode: "DRAFT_QUALITY_UNAVAILABLE",
          retryable: false,
          statusCode: 503,
        });
      }

      const cleanedSelection = cleanupSelection.cleanedSelection;
      const cleanedDraftText = cleanedSelection.text;
      const warnings: string[] = [];
      if (cleanupSelection.cleanupWinner === "best_effort_model") {
        warnings.push(
          "Cleaned Draft quality was limited; returned a best-effort model cleanup. Review before sending."
        );
      } else if (cleanedSelection.softIssues.length > 0 || cleanedSelection.shouldRetry) {
        warnings.push(
          "Cleaned Draft quality was limited; returned the strongest safe model cleanup available."
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
            "Context Reply quality was limited; returned the strongest safe contextual reply available."
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
        cleanupWinner: cleanupSelection.cleanupWinner,
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
        providerPath: "cloud",
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

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const strictRetry = attempt === 1;
      const prompt = buildDraftingPrompt(normalized, strictRetry);

      for (const structuredOutput of [true, false] as const) {
        let rawContent = "";
        try {
          rawContent = await requestText(prompt, structuredOutput);
        } catch (error) {
          if (
            bestCandidate !== null &&
            error instanceof ProviderError &&
            error.errorCode === "GENERATION_TIMEOUT"
          ) {
            const safeCandidate: AttemptCandidate = bestCandidate;
            const builtResponse = buildDraftResponse({
              input: normalized,
              drafts: safeCandidate.outcome.drafts,
              warnings: [
                ...safeCandidate.outcome.warnings,
                "The provider timed out during refinement; returned the best completed result.",
              ],
              providerPath: "cloud",
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
            providerPath: "cloud",
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

    if (bestCandidate !== null) {
      const safeCandidate: AttemptCandidate = bestCandidate;
      const builtResponse = buildDraftResponse({
        input: normalized,
        drafts: safeCandidate.outcome.drafts,
        warnings: [
          ...safeCandidate.outcome.warnings,
          "Context Reply was not strongly differentiated from Cleaned Draft; returned best effort.",
          "Provider quality was limited for this request; returned the safest available result.",
        ],
        providerPath: "cloud",
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
        "The Gemini runtime returned an empty or unusable reply. ReplyMate retried automatically, but no draft text was produced.",
      errorCode: "INVALID_MODEL_OUTPUT",
      statusCode: 502,
    });
  }
}
