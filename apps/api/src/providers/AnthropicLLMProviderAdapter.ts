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

type AnthropicMessageResponse = {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
};

type AnthropicCountTokensResponse = {
  input_tokens?: number;
};

type AttemptCandidate = {
  outcome: DraftValidationOutcome;
  strictRetry: boolean;
};

const ANTHROPIC_VERSION = "2023-06-01";

function isRecoverableModelValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError && error.errorCode === "INVALID_MODEL_OUTPUT";
}

function extractAnthropicText(response: AnthropicMessageResponse): string {
  return Array.isArray(response.content)
    ? response.content
        .filter((item) => item.type === "text" && typeof item.text === "string")
        .map((item) => item.text?.trim() || "")
        .filter(Boolean)
        .join("\n\n")
    : "";
}

export class AnthropicLLMProviderAdapter implements LLMProviderAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly modelName: string,
    private readonly timeoutMs: number,
    private readonly apiKey: string,
    private readonly options: {
      temperature: number;
      topP: number;
      maxTokens?: number;
    } = {
      temperature: 0.15,
      topP: 0.85,
    }
  ) {}

  async checkHealth(): Promise<DraftingProviderStatus> {
    if (!this.modelName.trim()) {
      return {
        runtimeType: "anthropic",
        ready: false,
        warning: "No Anthropic model is configured.",
      };
    }

    if (!this.apiKey.trim()) {
      return {
        runtimeType: "anthropic",
        ready: false,
        modelName: this.modelName,
        warning: "Anthropic API key is required.",
      };
    }

    try {
      await fetchJsonWithTimeout<AnthropicCountTokensResponse>(
        this.baseUrl,
        "/v1/messages/count_tokens",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model: this.modelName,
            system: "Reply with token count only.",
            messages: [{ role: "user", content: "ping" }],
          }),
        },
        Math.min(this.timeoutMs, 10_000),
        "DRAFT_PROVIDER_UNAVAILABLE"
      );

      return {
        runtimeType: "anthropic",
        ready: true,
        modelName: this.modelName,
      };
    } catch (error) {
      return {
        runtimeType: "anthropic",
        ready: false,
        modelName: this.modelName,
        warning: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async generateDrafts(input: GenerateDraftRequest): Promise<GenerateDraftResponse> {
    const normalized: DraftGenerationInput = createDraftGenerationInput(input);

    const requestText = async (
      prompt: { system: string; user: string }
    ): Promise<string> => {
      const response = await fetchJsonWithTimeout<AnthropicMessageResponse>(
        this.baseUrl,
        "/v1/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model: this.modelName,
            system: prompt.system,
            max_tokens: this.options.maxTokens ?? 1400,
            temperature: this.options.temperature,
            top_p: this.options.topP,
            messages: [{ role: "user", content: prompt.user }],
          }),
        },
        this.timeoutMs,
        "GENERATION_FAILED"
      );

      return extractAnthropicText(response);
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

        let rawContent = "";
        try {
          rawContent = await requestText(prompt);
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

      const cleanedSelection = selectPreferredLlmCleanupCandidate({
        modelCandidates: cleanedCandidates,
      });
      if (!cleanedSelection) {
        throw new ProviderError({
          message: "Improve Draft could not produce a safe cleaned draft from the Anthropic model.",
          errorCode: "DRAFT_QUALITY_UNAVAILABLE",
          retryable: false,
          statusCode: 503,
        });
      }

      const cleanedDraftText = cleanedSelection.text;
      const warnings: string[] = [];
      if (cleanedSelection.softIssues.length > 0 || cleanedSelection.shouldRetry) {
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

          let rawContent = "";
          try {
            rawContent = await requestText(prompt);
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

      let rawContent = "";
      try {
        rawContent = await requestText(prompt);
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
        continue;
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
        "The Anthropic runtime returned an empty or unusable reply. ReplyMate retried automatically, but no draft text was produced.",
      errorCode: "INVALID_MODEL_OUTPUT",
      statusCode: 502,
    });
  }
}
