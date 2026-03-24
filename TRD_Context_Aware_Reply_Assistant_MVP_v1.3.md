---
document_type: TRD
document_id: TRD-CRA-MVP-003
product_name: Context-Aware Reply Assistant
working_name: ReplyMate
version: 1.3
status: Build-ready
date: 2026-03-12
source_prd: PRD_Context_Aware_Reply_Assistant_MVP_v1.3.md
primary_consumer: AI build agent
technical_defaults:
  repo_type: monorepo
  extension_runtime: chrome_mv3
  extension_ui: react_typescript
  backend_runtime: node_typescript
  backend_api_style: rest_json
  shared_contracts: required
  adapter_architecture: required
  plugin_registry: required
  feature_flags: required
  primary_voice_pipeline: mediarecorder_plus_backend_transcription
  provider_adapters:
    - local_generation
    - cloud_generation
    - local_speech
    - cloud_transcription
    - storage
    - document_parser
  default_cost_mode: local_only
  optional_cost_modes:
    - hybrid_low_cost
    - cloud_quality
  summary_caps:
    per_file_chars: 1200
    total_chars: 3000
  max_recording_duration_sec: 90
  stale_session_insert_protection: required
  contract_versioning: semver_required
  async_evidence_jobs: required
---

# Technical Requirements Document
## Context-Aware Reply Assistant MVP

## 1. Purpose

This TRD translates the PRD into an implementation-ready technical design that is easy for an AI build agent to follow. It resolves architectural ambiguity, defines module boundaries, describes the extension and backend runtime, and makes the product explicitly non-monolithic.

The most important architectural decision in this TRD is:

> Build a small core shell with explicit contracts, then compose the product from feature modules and adapters.

That means new features should be added as modules, new sites should be added as adapters, and external dependencies should be wrapped behind provider adapters.

The second critical implementation rule is cost control: the product must be **local-first and cloud-optional**. Paid cloud providers are adapters, not hard dependencies of the base product.

## 2. Architecture Goals

1. Keep the core small and stable.
2. Keep site-specific logic out of the core.
3. Keep provider-specific logic out of the core.
4. Allow optional feature modules to be enabled or disabled without breaking the base drafting workflow.
5. Make it easy to add a new site or feature with minimum core edits.
6. Make failure isolated at the module boundary.
7. Preserve explicit schemas and contracts so an AI build agent can reason reliably about the system.
8. Keep the default user path free or near-free by preferring local providers over paid cloud providers.
9. Prevent stale-session insertion, prompt injection, and oversized evidence payloads at the architecture level.

## 3. Top-Level Architecture

The system is composed of five layers:

1. **Core Extension Shell**
2. **Feature Modules**
3. **Site Adapters**
4. **Provider Adapters**
5. **Backend Services**

### 3.1 Core Extension Shell
The core shell is the smallest always-on part of the product. It owns:

- app bootstrapping
- module registry
- capability registry
- event bus
- background service worker
- side panel host
- settings host
- active session store
- permission manager
- shared UI primitives

The core shell does **not** contain:
- Slack DOM logic
- Gmail DOM logic
- evidence parsing logic
- voice transcription logic
- model-specific logic

### 3.2 Feature Modules
Feature modules plug into the core shell and expose capabilities.

Required MVP feature modules:
- drafting module
- evidence module
- voice module
- settings module
- telemetry module

Optional later modules:
- templates module
- knowledge module
- style guide module
- analytics dashboard module
- auto-attach helper module per site

### 3.3 Site Adapters
Site adapters are responsible for:
- composer detection
- context extraction
- metadata extraction
- insert behavior
- attach capability flags

Required MVP site adapters:
- Slack web
- Gmail web
- Generic web beta

### 3.4 Provider Adapters
Provider adapters wrap external services.

Required MVP provider adapter categories:
- LLM provider adapter
- transcription provider adapter
- storage provider adapter
- document parser adapter

### 3.5 Backend Services
Backend services orchestrate:
- evidence ingest
- transcription
- prompt building
- draft generation
- coarse telemetry
- health checks

## 4. Dependency Rules

These rules are mandatory.

### 4.1 Core Dependency Rule
The core shell may depend only on:
- shared contracts
- shared utilities
- browser APIs
- framework/runtime primitives

The core shell must not depend directly on:
- site-specific adapter implementations
- provider-specific SDKs
- optional feature module internals

### 4.2 Feature Module Dependency Rule
A feature module may depend on:
- core contracts
- shared utilities
- optional provider abstractions
- optional site capabilities through contracts

A feature module must not import another feature module’s internals directly. Cross-feature communication must happen through explicit contracts or the event bus.

### 4.3 Site Adapter Dependency Rule
A site adapter may depend on:
- shared contracts
- DOM utilities
- core adapter interfaces

A site adapter must not depend on:
- provider SDKs
- backend client internals beyond shared API client contracts

### 4.4 Provider Adapter Dependency Rule
Provider adapters may depend on external SDKs. No other package should need those SDKs directly.

## 5. Monorepo Layout

Recommended layout:

```text
repo/
  apps/
    extension/
      src/
        core/
          boot/
          registry/
          bus/
          permissions/
          session/
          ui/
        background/
        sidepanel/
        options/
        content/
        adapters/
          sites/
            slack/
            gmail/
            generic/
        modules/
          drafting/
          evidence/
          voice/
          settings/
          telemetry/
        shared-client/
      manifest.json
    api/
      src/
        core/
        routes/
        services/
        adapters/
          llm/
          transcription/
          storage/
          parser/
        prompts/
        validation/
        observability/
  packages/
    contracts/
      src/
        events/
        schemas/
        types/
        capabilities/
    ui-kit/
    test-fixtures/
      slack/
      gmail/
      generic/
  docs/
```

### 5.1 Why This Structure
- `apps/extension` owns browser runtime code.
- `apps/api` owns backend orchestration.
- `packages/contracts` is the shared boundary.
- `modules/` allows feature-level growth.
- `adapters/sites/` isolates DOM risk.
- `adapters/` in the API isolates provider risk.

## 6. Core Contracts

The contracts package is the most important technical boundary.

It must contain:

- domain types
- API request and response schemas
- module capability types
- event names and payloads
- adapter interfaces
- error codes
- feature flag names

### 6.1 Contract Design Rule
If two modules need to communicate, the payload must be defined in `packages/contracts` before implementation.

### 6.2 Required Contract Types

```ts
export type SiteId = "slack_web" | "gmail_web" | "generic_web";
export type FeatureId = "drafting" | "evidence" | "voice" | "settings" | "telemetry";
export type AdapterId = "slack" | "gmail" | "generic";
export type ProviderId = "llm" | "transcription" | "storage" | "parser";
export type EvidenceMode = "context_only" | "intended_attachment";
export type AttachCapability = "none" | "manual_only" | "helper_available";
```

### 6.2A Contract Versioning

All cross-module and extension-to-backend contracts must be versioned.

Rules:
- Use semantic versioning for shared contract packages.
- Include `apiVersion` on backend responses that cross process boundaries.
- Breaking contract changes require explicit version bumps and migration notes.
- Optional fields may be added in a backward-compatible way, but existing required fields may not change meaning silently.

### 6.3 Capability Model

```ts
export type CapabilityMap = {
  drafting: boolean;
  evidence: boolean;
  voice: boolean;
  telemetry: boolean;
  attachHelper: AttachCapability;
};
```

## 7. Module Registry

The module registry is how the product avoids becoming monolithic.

### 7.1 Registry Responsibilities
- register modules at boot
- expose module metadata
- expose feature flags
- expose capability availability
- mount module UI into known extension surfaces
- handle disabled-module fallbacks

### 7.2 Module Interface

```ts
export interface FeatureModule {
  id: FeatureId;
  version: string;
  dependsOn: FeatureId[];
  requiredCapabilities: string[];
  optionalCapabilities?: string[];
  register(ctx: ModuleContext): Promise<void> | void;
  teardown?(ctx: ModuleContext): Promise<void> | void;
}
```

### 7.3 Module Context

```ts
export interface ModuleContext {
  bus: EventBus;
  sessionStore: SessionStore;
  capabilityRegistry: CapabilityRegistry;
  featureFlags: FeatureFlagService;
  apiClient: ApiClient;
  logger: Logger;
}
```

### 7.4 Registry Rules
- Core loads modules from a declarative registry list.
- If a module is disabled, the registry records the capability as unavailable.
- The UI must degrade gracefully based on capability state.
- Module order must be deterministic.

## 8. Event Bus

The event bus is the main decoupling mechanism inside the extension runtime.

### 8.1 Event Categories
- session events
- adapter events
- generation events
- evidence events
- voice events
- telemetry events
- error events

### 8.2 Event Examples

```ts
type ExtensionEvent =
  | { type: "session/activeChanged"; tabId: number; sessionId: string | null }
  | { type: "session/snapshotUpdated"; sessionId: string; snapshot: ComposerSnapshot }
  | { type: "evidence/uploaded"; sessionId: string; evidence: EvidenceSummary }
  | { type: "voice/transcriptReady"; sessionId: string; target: "draft" | "instructions"; transcript: string }
  | { type: "generation/requested"; sessionId: string }
  | { type: "generation/succeeded"; sessionId: string; drafts: DraftVariant[] }
  | { type: "generation/failed"; sessionId: string; errorCode: ErrorCode };
```

### 8.3 Event Rules
- Events are append-only domain signals, not arbitrary data dumps.
- Event payloads must use shared contracts.
- Modules react to events; they do not directly mutate each other’s internal state.

## 9. Core Session Model

The active session is the central runtime object.

```ts
type ComposerSession = {
  sessionId: string;
  tabId: number;
  siteId: SiteId;
  adapterId: AdapterId;
  capabilityMap: CapabilityMap;
  snapshot: ComposerSnapshot | null;
  warnings: string[];
  updatedAt: string;
};
```

### 9.1 Session Responsibilities
- bind the active tab to the active composer
- carry the latest snapshot
- expose current site capability
- keep the side panel synchronized with the content runtime

### 9.2 Session Ownership
The background worker owns active session routing. The side panel reads and updates through explicit messages or store sync.

## 10. Site Adapter Framework

### 10.1 Site Adapter Interface

```ts
export interface SiteAdapter {
  id: AdapterId;
  siteId: SiteId;
  detectComposer(doc: Document): ComposerHandle | null;
  extractSnapshot(doc: Document, composer: ComposerHandle): ComposerSnapshot;
  insertText(doc: Document, composer: ComposerHandle, text: string, mode: "replace" | "append"): InsertResult;
  getAttachCapability(doc: Document): AttachCapability;
}
```

### 10.2 Adapter Rules
- All DOM selectors and DOM heuristics live here.
- Adapters must return normalized snapshot data.
- Adapters must never call backend APIs directly.
- Adapters must expose a stable contract even if their internal DOM logic changes.

### 10.3 Required Adapters

#### Slack Adapter
Responsibilities:
- detect channel, DM, and thread reply composers
- extract nearby visible message context
- extract channel or thread metadata
- insert generated text back into editor
- report attach capability as `manual_only` unless helper is proven reliable

#### Gmail Adapter
Responsibilities:
- detect reply or compose editors
- extract subject and sender metadata when visible
- extract nearby quoted email context
- insert generated text back into editor
- report attach capability as `manual_only` unless helper is proven reliable

#### Generic Adapter
Responsibilities:
- detect standard `textarea` or `contenteditable` inputs
- capture nearby visible text when confidence is sufficient
- degrade gracefully with lower confidence warnings

## 11. Provider Adapter Framework

### 11.1 Provider Adapter Categories
- `LLMProviderAdapter`
- `TranscriptionProviderAdapter`
- `StorageProviderAdapter`
- `DocumentParserAdapter`

### 11.2 Example Provider Interfaces

```ts
export interface LLMProviderAdapter {
  generateDrafts(input: GenerateDraftRequest): Promise<GenerateDraftResponse>;
}

export interface TranscriptionProviderAdapter {
  transcribeAudio(input: TranscriptionRequest): Promise<TranscriptionResponse>;
}

export interface StorageProviderAdapter {
  putTempObject(input: TempObjectPutRequest): Promise<TempObjectPutResponse>;
  deleteTempObject(key: string): Promise<void>;
}

export interface DocumentParserAdapter {
  summarizeFile(input: EvidenceIngestRequest): Promise<EvidenceSummary>;
}
```

### 11.3 Why Provider Adapters Matter
- Switching model vendors should not rewrite business logic.
- Changing transcription strategy should not affect UI code.
- Storage strategy can evolve independently of evidence logic.

## 12. Feature Modules

### 12.1 Drafting Module
Responsibilities:
- render generation controls
- render a first-class free-form instruction field
- build generation request payload
- call backend generate endpoint
- render draft variants
- expose insert, copy, regenerate, and use-as-editable-draft actions

Must work even if evidence and voice modules are disabled.

### 12.2 Evidence Module
Responsibilities:
- file selection
- drag and drop
- paste support
- file validation
- evidence upload
- evidence summary display
- evidence mode selection

If disabled, the drafting module must still work from current draft and page context.

### 12.3 Voice Module
Responsibilities:
- microphone button
- recording state
- transcription request
- transcript insertion into draft or instruction field

If disabled, all typed flows still work.

### 12.4 Settings Module
Responsibilities:
- backend configuration
- enabled sites
- default tone
- privacy settings
- debug mode
- feature flags visibility

### 12.5 Telemetry Module
Responsibilities:
- coarse event reporting
- module and adapter health signals
- no raw sensitive text by default

Required event types:
- `panel_opened`
- `composer_detected`
- `context_capture_succeeded`
- `context_capture_failed`
- `evidence_upload_started`
- `evidence_upload_succeeded`
- `evidence_upload_failed`
- `evidence_job_polled`
- `voice_started`
- `voice_transcribed`
- `generation_requested`
- `generation_succeeded`
- `generation_failed`
- `draft_inserted`
- `draft_copied`
- `stale_session_blocked`
- `rate_limited`
- `cloud_fallback_used`

Telemetry must be removable without breaking user workflows.

## 13. Feature Flags

Feature flags are required to support safe growth and safe removal.

### 13.1 Required Flags
- `feature.drafting.enabled`
- `feature.evidence.enabled`
- `feature.voice.enabled`
- `feature.telemetry.enabled`
- `site.slack.enabled`
- `site.gmail.enabled`
- `site.generic.enabled`

### 13.2 Rules
- Drafting is the only mandatory always-on feature in MVP.
- Evidence, voice, and telemetry must be disableable.
- Disabling a feature updates the capability registry and UI state.
- Disabled features must fail closed, not half-open.

## 14. Extension Runtime Components

### 14.1 Background Worker
Owns:
- active tab and session routing
- permission checks
- adapter registration
- messaging between side panel and content scripts
- feature flag snapshots

### 14.2 Content Runtime
Owns:
- adapter selection
- composer detection
- inline trigger injection
- inline trigger placement as a compact floating icon button anchored near the top-right edge of the active composer container, with adapter-specific adjustments where necessary
- snapshot extraction
- insert behavior

### 14.3 Side Panel App
Owns:
- session visualization
- feature module UI composition
- first-class instruction field rendering and state
- evidence tray
- voice controls
- draft results
- errors and warnings

### 14.4 Settings Page
Owns:
- configuration persistence
- site enablement
- backend URL and token validation
- local debug toggles

## 15. Data Models

### 15.1 Composer Snapshot

```ts
type MessageContextItem = {
  id: string;
  author?: string;
  role?: "customer" | "agent" | "unknown";
  text: string;
  source: "visible_thread" | "quoted_email" | "generic_dom";
};

type PageMetadata = {
  siteId: SiteId;
  url: string;
  title?: string;
  channelName?: string;
  threadTitle?: string;
  customerName?: string;
  senderName?: string;
};

type ComposerSnapshot = {
  draftText: string;
  visibleContext: MessageContextItem[];
  metadata: PageMetadata;
  extractionConfidence: number;
  warnings: string[];
  pageUrlAtCapture: string;
  viewFingerprint: string;
  composerFingerprint: string;
  sessionVersion: number;
};
```

### 15.2 Evidence Types

```ts
type EvidenceItem = {
  localId: string;
  evidenceId?: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  source: "picker" | "drag_drop" | "paste";
  mode: EvidenceMode;
  mentionInReply: boolean;
  uploadState: "local_only" | "uploading" | "uploaded" | "failed";
  parseState: "pending" | "processing" | "ready" | "failed";
  previewUrl?: string;
  error?: string;
};

type EvidenceSummary = {
  evidenceId: string;
  name: string;
  mode: EvidenceMode;
  mentionInReply: boolean;
  summaryText: string;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  truncated: boolean;
  summaryCharCount: number;
};

type EvidenceJobState = "queued" | "processing" | "ready" | "failed";

type EvidenceJobStatus = {
  jobId: string;
  state: EvidenceJobState;
  result?: EvidenceSummary;
  errorCode?: string;
};
```

### 15.3 Voice Types

```ts
type VoiceState =
  | { status: "idle" }
  | { status: "requesting_permission" }
  | { status: "recording"; target: "draft" | "instructions"; startedAt: string; mode: "local" | "cloud" }
  | { status: "transcribing"; target: "draft" | "instructions"; mode: "local" | "cloud" }
  | { status: "error"; message: string };
```

## 16. Context Capture Pipeline

1. Content runtime detects active composer.
2. Site adapter extracts:
   - current draft
   - visible nearby message blocks
   - page metadata
3. Snapshot is normalized against shared schema.
4. Background worker stores latest snapshot for the active session.
5. Side panel reads the snapshot and displays it for review.

### 16.1 Limits
Recommended caps:
- max visible context items: 10
- max chars per context item: 1500
- max total visible context chars: 8000
- exclude hidden fields and password inputs
- exclude unrelated DOM regions when confidence is low

### 16.2 Fallback Rule
If context extraction is weak:
- keep draft capture
- surface warning
- continue allowing generation

## 17. Evidence Pipeline

1. User adds file in the evidence module.
2. Evidence module validates type and size.
3. Evidence module uploads via multipart to backend ingest endpoint.
4. Backend chooses **sync** or **async job** processing.
5. Backend parser adapter summarizes the file.
6. Backend returns either `EvidenceSummary` immediately or an `EvidenceJobStatus` to poll.
7. Evidence module stores the summary in session state once ready.
8. Drafting module includes the summary in the generate request.

### 17.1 File Limits
- max 5 files per generation
- max 10 MB per image
- max 20 MB per document
- max 35 MB total

### 17.2 Evidence Modes
- `context_only`
- `intended_attachment`

### 17.3 Critical Rule
Draft text may refer to attachments only when:
- the file is marked `intended_attachment`, and
- the user approves the final draft

### 17.4 Sync vs Async Ingest Rule
Use synchronous ingest only for lightweight files that can be processed quickly.
Use asynchronous evidence jobs when:
- file type is PDF or DOCX and size is greater than 2 MB, or
- estimated parse time exceeds 3 seconds, or
- the backend cannot guarantee a timely synchronous response.

Async evidence flow:
1. `POST /v1/evidence/ingest` returns `jobId` and initial state.
2. Side panel shows `processing`.
3. Side panel polls job status until `ready` or `failed`.
4. Evidence summary appears in the UI as soon as the job becomes `ready`.

### 17.5 Summary Caps
To control latency, cost, and model context size:
- max `summaryText` chars per file: 1200
- max combined evidence summary chars in one generate request: 3000
- backend truncates summaries deterministically and sets `truncated: true`
- UI shows a warning if truncation occurred

## 18. Voice Pipeline

Voice must respect the selected cost mode.

- In `local_only`, prefer browser-native or on-device speech recognition when available.
- In `hybrid_low_cost`, prefer local speech first and allow explicit cloud transcription fallback.
- In `cloud_quality`, backend transcription may be used by default.

### 18.1 Voice Flow
1. User chooses target: draft or instructions.
2. Voice module requests mic permission.
3. Voice module selects local or cloud speech path using the cost policy engine.
4. User records or speaks.
5. Recording stops on explicit stop or max duration of 90 seconds.
6. Local speech provider or backend transcription returns transcript.
7. Voice module writes transcript into the selected text input.
8. User edits transcript if needed.

### 18.2 Failure Behavior
If voice fails:
- preserve current typed content
- show error state
- allow immediate fallback to typing
- do not automatically escalate from local to cloud in `local_only`

### 18.3 Cost-Mode Rule
Voice transcription that requires paid cloud compute must not run in `local_only`.
In `hybrid_low_cost`, cloud transcription requires explicit permission or a previously enabled setting.

## 19. Draft Generation Pipeline

1. Drafting module assembles:
   - current draft
   - instruction text
   - visible context
   - metadata
   - evidence summaries
   - action mode
   - tone preset
2. Payload is validated against shared schema.
3. Cost policy engine selects local or cloud generation provider.
4. Backend or local prompt builder creates the structured prompt.
5. Generation provider returns exactly 3 variants.
6. Response is schema-validated.
7. Drafting module renders the variants.
8. User chooses insert, copy, or refine.

### 19.1 Output Validation Rule
If the provider returns invalid structure:
- retry once with stricter schema reminder
- if still invalid, return structured failure

### 19.2 Prompt Specification
Prompt assembly must use explicit structured sections, not naive string concatenation.

Recommended logical structure:
- system rules
- action mode rules
- tone rules
- current draft
- user free-form instructions
- conversation context
- metadata
- evidence summaries
- output schema instructions

### 19.3 Prompt Injection Defense
Conversation text, customer text, and evidence text are untrusted inputs.
They must be inserted into clearly delimited data sections such as:
- `<draft>`
- `<user_instruction>`
- `<conversation_context>`
- `<evidence_summaries>`

They must never be merged into the system-rule section.

### 19.4 Attachment Truth Rules
The prompt builder must encode:
- `context_only` evidence may inform the reply but must not be claimed as attached
- `intended_attachment` evidence may be referenced only if `mentionInReply` is true
- the model must never claim a file has already been sent automatically

### 19.5 Cost Policy Engine
Provider selection is mandatory and follows:
1. try local generation provider if available and capable
2. if not available:
   - block in `local_only`
   - ask permission or use configured fallback in `hybrid_low_cost`
   - use cloud provider in `cloud_quality`
3. record which provider path was used for observability and cost metrics

## 20. Insert and Copy Pipeline

### 20.1 Insert
- side panel sends insert request to background
- request includes `sessionId`, `sessionVersion`, `viewFingerprint`, and `composerFingerprint`
- background verifies the active session still matches the generation session
- only then does background route to active content runtime
- active site adapter writes into the current composer
- adapter dispatches required DOM events
- success or failure is returned to panel

### 20.2 Stale Session Protection
If the tab, route, thread, view, or composer changed since generation:
- block direct insert
- return `STALE_SESSION`
- keep copy action available
- explain why direct insert was blocked

### 20.3 Copy Fallback
If insert fails:
- copy action remains available
- selected draft text remains visible
- panel explains the failure reason if known

## 21. Backend API

### 21.1 Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/v1/health` | GET | health check |
| `/v1/settings/validate` | POST | validate API URL and token |
| `/v1/evidence/ingest` | POST | upload and summarize evidence or create async evidence job |
| `/v1/evidence/jobs/:jobId` | GET | fetch async evidence job status |
| `/v1/voice/transcribe` | POST | transcribe audio when cloud transcription is allowed |
| `/v1/generate` | POST | generate 3 reply variants |
| `/v1/metrics` | POST | optional telemetry for the explicit event list defined in §12.5 |

### 21.2 Authentication
Use a bearer token configured in extension settings for MVP.
This is acceptable for internal / alpha use.
A smoother public-user auth flow is out of scope for MVP.

### 21.3 Generate Request Shape

```ts
type GenerateDraftRequest = {
  sessionId: string;
  sessionVersion: number;
  siteId: SiteId;
  actionMode: "improve_current_draft" | "draft_from_context" | "reply_from_scratch" | "make_shorter" | "make_more_professional" | "make_more_empathetic";
  tonePreset: "concise" | "friendly" | "professional" | "empathetic" | "confident";
  draftInput: string;
  instructionInput?: string;
  contextEnabled: boolean;
  snapshot: ComposerSnapshot;
  evidence: EvidenceSummary[];
  usedVoiceInput: boolean;
  costMode: "local_only" | "hybrid_low_cost" | "cloud_quality";
};
```

### 21.4 Generate Response Shape

```ts
type DraftVariant = {
  id: string;
  label: string;
  text: string;
  styleNotes: string[];
};

type GenerateDraftResponse = {
  apiVersion: string;
  requestId: string;
  drafts: [DraftVariant, DraftVariant, DraftVariant];
  warnings: string[];
  inputSummary: {
    contextUsed: boolean;
    evidenceIdsUsed: string[];
    usedVoiceInput: boolean;
    providerPath: "local" | "cloud";
  };
};
```

### 21.4A Streaming Policy

Streaming partial draft delivery is explicitly post-MVP. MVP generation requests must return complete, schema-validated draft payloads rather than streamed partial text.

### 21.5 Timeout, Retry, and Cancellation Policy
Recommended defaults:
- evidence upload request timeout: 30s
- async evidence job polling interval: 2s
- evidence job overall timeout: 120s
- generation timeout: 45s
- cloud transcription timeout: 45s

Rules:
- user can cancel upload, polling, generation, or transcription from the panel
- retry transient network or 5xx failures at most once automatically
- never retry non-idempotent operations indefinitely
- show explicit retry action in the UI after failure

### 21.6 Rate Limiting and Abuse Control
Backend must enforce per-token or per-user rate limits for:
- generation
- transcription
- evidence ingest

Client must:
- debounce rapid repeated clicks
- prevent duplicate in-flight generate submissions
- surface `RATE_LIMITED` clearly

### 21.7 CORS and CSP
- Backend CORS must explicitly allow the extension origin(s) and development origin(s) only.
- Manifest V3 CSP must remain compatible with packaged extension code and must not rely on remote hosted code execution.
- No provider SDK should require unsafe dynamic script injection inside the extension UI.


Implementation note for local/on-device model runtimes:
- If a local provider uses WebLLM, ONNX, Transformers.js, or another browser runtime, it must comply with Manifest V3 CSP, worker loading rules, `connect-src` restrictions, and any WebAssembly execution constraints.
- Local provider logic must stay behind the provider adapter interface so the core shell does not depend on a specific runtime.
### 21.8 Infrastructure and Secrets
Minimum production guidance:
- run backend behind HTTPS
- store provider keys in server-side env vars only
- never ship provider secrets in extension bundle
- use temporary object storage or temp disk with TTL for evidence/audio
- emit structured logs without raw content by default

## 22. Error Model

```ts
type ErrorCode =
  | "NO_COMPOSER"
  | "LOW_CONTEXT_CONFIDENCE"
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "EVIDENCE_PARSE_FAILED"
  | "MIC_PERMISSION_DENIED"
  | "VOICE_RECORDING_FAILED"
  | "VOICE_TRANSCRIPTION_FAILED"
  | "GENERATION_FAILED"
  | "INVALID_MODEL_OUTPUT"
  | "INSERT_FAILED"
  | "STALE_SESSION"
  | "RATE_LIMITED"
  | "TOKEN_EXPIRED"
  | "UPLOAD_TIMEOUT"
  | "GENERATION_TIMEOUT"
  | "BACKEND_UNREACHABLE"
  | "NETWORK_OFFLINE"
  | "CONTRACT_VERSION_MISMATCH"
  | "UNAUTHORIZED";
```

### 22.1 Error Handling Rule
Every module must map its failures to explicit error codes. No silent failures.

## 23. Testing Strategy

### 23.1 Unit Tests
Required for:
- schema validation
- prompt building
- file validation
- module registry behavior
- feature flag behavior
- adapter helper functions

### 23.2 Contract Tests
Required for:
- module interfaces
- event payloads
- site adapter return shapes
- provider adapter response normalization

### 23.3 Adapter Fixture Tests
Use sanitized HTML fixtures for:
- Slack
- Gmail
- generic pages

Test:
- composer detection
- snapshot extraction
- insert behavior stubs
- capability flags

### 23.4 Integration Tests
Test:
- background to content messaging
- side panel to session sync
- evidence upload with mocked backend
- async evidence job polling
- voice transcription with mocked backend
- generate flow with mocked provider
- stale-session insert blocking

### 23.5 End-to-End Tests
Use browser automation to validate:
- inline trigger
- side panel open
- keyboard shortcut open
- file upload
- async evidence processing state
- voice transcript flow
- draft generation
- insert behavior
- stale-session fallback to copy
- copy fallback

### 23.6 Modularity Regression Tests
Required special tests:
- disable evidence module and confirm drafting still works
- disable voice module and confirm drafting still works
- disable telemetry module and confirm user flows still work
- disable cloud fallback and confirm `local_only` mode still works
- add a dummy test module and confirm registration works without core rewrite

## 24. Feature Removal and Add-On Procedure

This section directly answers the modularity requirement.

### 24.1 Safe Add Procedure
To add a new feature:
1. create a new module under `modules/`
2. define or extend contracts in `packages/contracts`
3. register the module in the module registry
4. expose feature flag
5. add tests for enabled and disabled states

### 24.2 Safe Remove Procedure
To remove an optional feature:
1. disable feature flag
2. remove module registration
3. ensure capability registry marks feature unavailable
4. confirm fallback UI states exist
5. run modularity regression tests

### 24.3 Safe New Site Procedure
To add a new site:
1. create a new site adapter
2. implement shared adapter interface
3. add fixture tests
4. register adapter mapping by hostname
5. verify no core rewrite is needed except registry entry

## 25. Milestones

### M1 Core Shell
Deliver:
- monorepo
- contracts package
- module registry
- capability registry
- background worker
- side panel host
- settings host

### M2 Generic Drafting Slice
Deliver:
- generic adapter
- drafting module
- mocked generate flow
- insert and copy on fixture page

### M3 Slack and Gmail Adapters
Deliver:
- Slack adapter
- Gmail adapter
- snapshot extraction
- insert behavior

### M4 Evidence Module
Deliver:
- upload UI
- ingest endpoint
- evidence summaries
- mode selection

### M5 Voice Module
Deliver:
- microphone control
- recording state
- transcription endpoint
- transcript insertion

### M6 Backend Hardening
Deliver:
- provider adapters
- structured logging
- retry logic
- schema enforcement

### M7 Modularity Hardening
Deliver:
- feature flag matrix
- module disable tests
- dummy module registration test
- documentation cleanup

## 26. Traceability Matrix

| PRD ID | Technical Implementation Area |
|---|---|
| FR-001 to FR-006 | site adapters, content runtime, session model |
| FR-007 to FR-010, FR-025 to FR-028, FR-037 | drafting module, side panel, instruction field UX, insert/copy pipeline, shortcut handling, stale-session protection |
| FR-011 to FR-016, FR-029 to FR-031 | evidence module, async ingest endpoints, parser adapters, summary caps, attach capability handling |
| FR-017 to FR-020 | voice module, transcription endpoint, permission handling |
| FR-021 to FR-024, FR-032 to FR-036 | settings module, cost policy engine, observability, timeout/retry policy, rate limiting, network resilience |
| MA-001 to MA-011 | module registry, contracts package, capability registry, feature flags, provider adapters, safe add/remove procedures |
| NFR-001 to NFR-010 | testing strategy, observability, dependency rules, performance budgets, contract versioning, network resilience |

## 27. AI Build Agent Operating Rules

1. Start with the smallest vertical slice: core shell plus generic drafting.
2. Never couple a feature module directly to another feature module’s internals.
3. Never place site DOM logic inside the core shell.
4. Never place provider SDK calls inside UI code.
5. Always define contracts before implementing module interactions.
6. Always preserve typed fallback paths.
7. Always preserve copy fallback paths.
8. Treat feature flags and registry composition as mandatory, not optional.
9. If a new feature cannot be removed cleanly, the architecture is wrong and must be corrected.
10. Do not ship a monolith with a plan to modularize later.
11. Implement stale-session insert protection before enabling production insert on live sites.
12. Implement local-first provider selection and summary caps before enabling optional cloud fallback.

## 28. Build-Ready Summary

The implementation should behave like this:

- A small core shell starts the extension.
- Core loads enabled feature modules from a registry.
- Content runtime selects a site adapter for the active page.
- Site adapter returns a normalized snapshot.
- Side panel composes enabled feature modules around the active session.
- Evidence and voice are optional modules.
- Draft generation works even if optional modules are disabled.
- External providers sit behind provider adapters.
- Local providers are preferred by default; cloud providers are optional fallbacks.
- Async evidence jobs protect the UI from long-running file parse timeouts.
- Insert is blocked when the active session becomes stale.
- New sites and new features enter through contracts, registry, and tests.

That is the required technical shape for this product.
