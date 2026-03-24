import type {
  ContextScope,
  DraftRole,
  DraftVariant,
  EntityCorrection,
  GenerateDraftRequest,
  GenerateDraftResponse,
} from "@replymate/contracts";

export type {
  ContextScope,
  DraftRole,
  DraftVariant,
  EntityCorrection,
  GenerateDraftRequest,
  GenerateDraftResponse,
};

export type EntitySource = EntityCorrection["source"];

export type EntityCandidate = {
  value: string;
  normalized: string;
  source: EntitySource;
  weight: number;
};

export type ParsedModelPayload = {
  warnings?: string[];
  variants?: Array<{
    role?: DraftRole;
    text?: string;
  }>;
};

export type ParsedSingleDraftPayload = {
  warnings?: string[];
  text?: string;
};

export type DraftSoftIssue =
  | "cleaned_too_similar"
  | "cleaned_too_context_heavy"
  | "context_too_similar"
  | "context_copied_too_directly"
  | "context_not_relevant_enough"
  | "alternate_not_better_than_primary"
  | "limited_context"
  | "clarification_instead_of_status"
  | "imported_excluded_context";

export type DraftValidationOutcome = {
  drafts: [DraftVariant, DraftVariant];
  warnings: string[];
  softIssues: DraftSoftIssue[];
  qualityScore: number;
  shouldRetry: boolean;
};

export type ContextTurnKind =
  | "confirmed_answer"
  | "hypothesis"
  | "action_request"
  | "question"
  | "ack"
  | "other";

export type ContextTurnConfidence = "high" | "medium" | "low";

export type DraftLexicalCorrectionSource = "context" | "metadata" | "lexicon";

export type DraftLexicalCorrection = {
  from: string;
  to: string;
  source: DraftLexicalCorrectionSource;
};

export type LexicalCandidate = {
  value: string;
  normalized: string;
  source: DraftLexicalCorrectionSource;
  weight: number;
};

export type ClassifiedContextTurn = {
  author: string;
  role: "customer" | "agent" | "unknown";
  text: string;
  kind: ContextTurnKind;
  confidence: ContextTurnConfidence;
  relevanceScore: number;
  sharedEntities: string[];
  supportsDraft: boolean;
  hasDirectRequest: boolean;
  isSpeculative: boolean;
};

export type ContextDeltaKind =
  | "request_frame"
  | "explicit_fact"
  | "resolved_reference"
  | "supporting_detail"
  | "allowed_uncertainty";

export type ContextDelta = {
  kind: ContextDeltaKind;
  text: string;
  sourceText?: string;
  sourceAuthor?: string;
  sourceKind?: ContextTurnKind;
  entityHints: string[];
};

export type ContextFact = {
  kind: ContextDeltaKind;
  abstractedText: string;
  sourceText?: string;
  sourceAuthor?: string;
  sourceRole?: "customer" | "agent" | "unknown";
  confidence: ContextTurnConfidence;
  relevance: number;
};

export type SelectedContext = {
  responseTarget: string | null;
  supportingTurns: ClassifiedContextTurn[];
  excludedTurns: ClassifiedContextTurn[];
  contextFacts: ContextFact[];
  selectionReason?: string;
};

export type DraftGenerationInput = {
  request: GenerateDraftRequest;
  originalDraft: string;
  cleanedDraft: string;
  normalizedDraft: string;
  contextScope: ContextScope;
  contextItemsUsed: number;
  selectedContext: SelectedContext;
  threadTitle?: string;
  channelName?: string;
  responseTargetTurn?: string;
  responseTargetReason?: string;
  currentMessageFallbackUsed: boolean;
  latestAsk?: string;
  latestQuestion?: string;
  latestConfirmedAnswer?: string;
  latestActionRequest?: string;
  latestRelevantSupportingTurn?: string;
  latestInternalInstruction?: string;
  unresolvedRequest?: string;
  recentTurns: ClassifiedContextTurn[];
  excludedTurns: ClassifiedContextTurn[];
  keyEntities: string[];
  evidenceNotes: string[];
  typoSignal: boolean;
  entityCorrectionsApplied: EntityCorrection[];
  lexicalCorrectionsApplied: DraftLexicalCorrection[];
  contextDeltas: ContextDelta[];
};

export type CleanedDraftCandidate = {
  text: string;
  warnings: string[];
  softIssues: Array<
    | "cleanup_changed_too_little"
    | "cleanup_not_sendable"
    | "cleanup_context_heavy"
    | "cleanup_has_unresolved_tokens"
    | "imported_excluded_context"
  >;
  suspiciousTokens: string[];
  qualityScore: number;
  shouldRetry: boolean;
};

export type ContextReplyCandidate = {
  text: string;
  warnings: string[];
  softIssues: DraftSoftIssue[];
  qualityScore: number;
  shouldRetry: boolean;
};

export type DraftGenerationTrace = {
  responseTarget?: string;
  responseTargetReason?: string;
  currentMessageFallbackUsed?: boolean;
  supportingFacts: string[];
  excludedTurns: string[];
  supportTurnCount?: number;
  cleanedSuspiciousTokens?: string[];
  cleanedDraftScore?: number;
  contextReplyScore?: number;
  contextReplyWinner: "model" | "cleaned_draft_reuse";
};

export const PRIMARY_ROLE: DraftRole = "primary";
export const ALTERNATE_ROLE: DraftRole = "alternate";
export const REQUIRED_ROLES = [PRIMARY_ROLE, ALTERNATE_ROLE] as const;

export const DRAFTING_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    warnings: {
      type: "array",
      items: { type: "string" },
    },
    variants: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          role: { type: "string", enum: [...REQUIRED_ROLES] },
          text: { type: "string" },
        },
        required: ["role", "text"],
      },
    },
  },
  required: ["warnings", "variants"],
} as const;

export const SINGLE_DRAFT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    warnings: {
      type: "array",
      items: { type: "string" },
    },
    text: { type: "string" },
  },
  required: ["text"],
} as const;
