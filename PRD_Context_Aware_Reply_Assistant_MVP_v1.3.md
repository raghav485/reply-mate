---
document_type: PRD
document_id: PRD-CRA-MVP-003
product_name: Context-Aware Reply Assistant
working_name: ReplyMate
version: 1.3
status: Build-ready
date: 2026-03-12
source_of_truth: this_document
companion_document: TRD_Context_Aware_Reply_Assistant_MVP_v1.3.md
primary_consumer: AI build agent
build_defaults:
  product_form: chrome_extension
  browser_target: chrome_chromium_mv3
  required_sites:
    - slack_web
    - gmail_web
  beta_sites:
    - generic_web_composer
  primary_ui:
    - inline_trigger
    - side_panel
  settings_ui: true
  auto_send: false
  voice_input: true
  evidence_upload: true
  evidence_modes:
    - context_only
    - intended_attachment
  universal_auto_attachment: false
  default_retention: ephemeral
  reply_variants_per_generation: 3
  modular_architecture: required
  cost_strategy: local_first
  default_cost_mode: local_only
  optional_cost_modes:
    - hybrid_low_cost
    - cloud_quality
  max_files_per_generation: 5
  max_recording_duration_sec: 90
  max_evidence_summary_chars_per_file: 1200
  max_combined_evidence_summary_chars: 3000
  keyboard_shortcut: mod_shift_r
---

# Product Requirements Document
## Context-Aware Reply Assistant MVP

## 1. Executive Summary

Context-Aware Reply Assistant is a Chrome browser extension that helps a user compose better customer-facing replies directly inside the web applications where they already work. The assistant detects the active composer, captures relevant visible context from the current conversation, accepts optional documents and screenshots as evidence, optionally accepts voice input, and generates polished drafts that the user can insert back into the same composer.

The product is intentionally narrow. It is not a general chatbot. It is a context-aware reply copilot for customer communication.

The MVP must be easy for an AI build agent to implement and easy for the product to grow over time. The architecture therefore must be modular, adapter-based, non-monolithic, and safe to extend or shrink.

The cost strategy is also explicit: the product must be **local-first and cloud-optional**. The default user experience should avoid per-request token spend whenever a local or browser-native path is available. Paid cloud inference is allowed only as an explicit, optional fallback mode.

## 2. Problem Statement

Today the user writes replies in Slack and other web apps, then manually copies customer context into an external AI tool, asks for a response, and copies the result back. That workflow is slow, repetitive, and fragile.

It creates five core problems:

1. It breaks focus by forcing the user to leave the current tool.
2. It often loses important context from the surrounding conversation.
3. It makes screenshots and documents awkward to explain manually.
4. It produces inconsistent tone because the user repeatedly re-prompts from scratch.
5. It does not scale well across many different web platforms.

The product should remove that friction by helping the user write directly where they already work.

## 3. Product Vision

Create the fastest, safest, and most extensible way to turn rough thoughts, visible conversation context, files, and spoken instructions into a strong customer reply without leaving the current page.

## 4. Goals

### 4.1 Primary Goal
Reduce the effort and time required to create a high-quality customer reply inside a supported website.

### 4.2 Secondary Goals
- Improve clarity, tone, and professionalism.
- Reduce context switching to external AI tools.
- Let the assistant use visible page context by default.
- Let the user upload screenshots and documents as evidence.
- Let the user speak instead of type when preferred.
- Preserve full user control over all outgoing messages.
- Keep the system modular enough to add or remove features with low risk.
- Keep ongoing operating cost free or negligible for the default user path.

### 4.3 Success Metrics
Directional MVP targets:

- At least 70 percent of successful generations result in insert or copy.
- Median time from assistant open to draft insert under 20 seconds, excluding unusually large files.
- At least 25 percent of successful generations use captured page context.
- At least 10 percent of successful generations use uploaded evidence.
- At least 10 percent of successful generations use voice input after launch.
- New site adapters and feature modules can be added without requiring core rewrite.

## 5. Non-Goals

Out of scope for MVP:

- Auto-sending messages.
- Native desktop app support.
- Mobile support.
- Slack bot or Slack app as the primary product.
- Full CRM integrations.
- Team admin features.
- Universal auto-attachment into every target platform.
- Organization knowledge base sync.
- Fully autonomous support actions.
- Text-to-speech output.
- Streaming partial generation output in MVP.
- Persistent storage of raw customer conversations by default.

## 6. Fixed Product Decisions

These decisions are closed for MVP. The AI build agent must not change them unless explicitly instructed by the founder.

- Product form: Chrome / Chromium Manifest V3 extension.
- Required first-party sites: Slack web and Gmail web.
- Required fallback: generic beta adapter for standard web composers.
- Primary UI surfaces: inline trigger plus side panel.
- Inline trigger placement: compact floating icon button anchored near the top-right edge of the active composer container, with adapter-specific adjustments where necessary.
- Human-in-the-loop rule: always.
- Auto-send: never.
- Voice input: included in MVP.
- File evidence: included in MVP.
- Universal auto-attachment to external platforms: not required in MVP.
- Default storage behavior: ephemeral.
- Modular architecture: required, not optional.
- Default cost mode: `local_only`.
- Optional cost modes: `hybrid_low_cost`, `cloud_quality`.
- Cloud fallback: off by default.
- Authentication UX for MVP: acceptable as internal / alpha setup with manual token configuration; smoother public onboarding is deferred.
- Keyboard shortcut: included in MVP.

### 6.1 Cost Strategy

The MVP must treat operating cost as a product requirement.

- `local_only` mode is the default.
- `local_only` mode must avoid paid cloud inference entirely.
- `hybrid_low_cost` mode may use explicit cloud fallback for unsupported or expensive local tasks.
- `cloud_quality` mode may use cloud providers more broadly but remains optional.
- If a request would incur cloud cost, the product must either block it in `local_only` mode or ask for explicit permission in another mode.
- Large evidence understanding and backend speech transcription may be unavailable in strict `local_only` mode if no local provider is available.

### 6.2 Session Integrity Rule

A generated draft may be inserted automatically into a composer only if the active session still matches the session that created the draft. If the user changed thread, route, tab focus, or composer identity before the result returned, the product must block direct insert and fall back to copy-only.

### 6.3 Prompt Safety Rule

Visible page content, customer messages, and uploaded evidence text are all untrusted inputs. The prompt builder must isolate those inputs from system instructions and must not allow customer-provided text to override the assistant's control rules.

## 7. Primary Users

### 7.1 Primary Persona
A person who frequently writes customer-facing replies and wants help sounding clearer, more professional, and more confident.

Examples:
- support rep
- founder doing support
- customer success manager
- freelancer handling client replies
- account manager
- operations team member

### 7.2 User Characteristics
- Writes many short or medium-length replies per day.
- Works in browser-based tools.
- Often knows what they want to say but struggles to phrase it well.
- Sometimes wants to speak rather than type.
- Sometimes needs AI to understand screenshots or documents before drafting the reply.

## 8. Jobs To Be Done

### JTBD-001
Help me write a better reply inside the tool where I am already typing.

### JTBD-002
Use the visible conversation and any uploaded evidence so I do not need to manually restate everything.

### JTBD-003
Let me speak my rough thoughts or instructions if I do not want to type.

### JTBD-004
Help me refer to intended attachments correctly without falsely claiming something was attached or sent.

### JTBD-005
Stay extensible so the product can support more sites and more feature modules later.

## 9. Product Principles

1. Inline first.
2. Context-aware by default.
3. Human remains in control.
4. Transparent about what data is used.
5. Useful even when context capture is partial.
6. Fast enough for repeated daily use.
7. Modular by design, not modular as a later refactor.
8. Features should fail independently instead of taking down the whole product.

## 10. User Flows

### Flow A: Improve an existing draft
1. User focuses a composer on a supported site.
2. Inline trigger appears.
3. User opens the assistant.
4. Side panel shows current draft, captured context, and metadata.
5. User optionally adjusts tone, mode, or a visible free-form instruction field.
6. User clicks Generate.
7. System returns 3 draft variants.
8. User inserts one into the composer.
9. User manually reviews and sends.

### Flow B: Generate from context plus evidence
1. User opens the assistant.
2. User uploads a screenshot, image, PDF, DOCX, TXT, or Markdown file.
3. User marks each file as `context_only` or `intended_attachment`.
4. System summarizes what it understood from the evidence.
5. User generates a reply.
6. Reply uses evidence if relevant and allowed.

### Flow C: Speak instead of type
1. User opens the assistant.
2. User clicks the microphone.
3. User speaks draft content or instructions.
4. System transcribes speech into editable text.
5. User reviews and generates a reply.


### Flow C.1: Add typed or spoken instructions
1. User opens the assistant.
2. The side panel shows a first-class instruction field separate from the draft field.
3. User types or speaks instructions such as “make this softer”, “be more technical”, or “match the customer’s tone”.
4. User generates a reply using the instruction field together with the draft, context, and any evidence.

### Flow D: Partial support fallback
1. User is on a generic site.
2. The extension captures only the active draft and limited nearby context.
3. The panel warns that page context is limited.
4. User still gets drafting help.

## 11. Functional Requirements

### 11.1 Core Reply Workflow

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| FR-001 | Detect the active reply composer on supported pages. | Slack and Gmail composer focus produces a usable active composer state within 1 second. |
| FR-002 | Show a lightweight inline trigger near the active composer. | User can open the assistant from page context without relying on toolbar-only behavior. |
| FR-003 | Provide a side panel as the primary assistant workspace. | Panel shows current site, composer state, and current session data. |
| FR-004 | Capture current draft text from the active composer. | The user sees current composer content in the panel before generation. |
| FR-005 | Capture relevant visible conversation context near the composer. | The user can review captured context before generation. |
| FR-006 | Capture lightweight metadata such as site name, page title, channel, thread title, or customer name when visible. | Missing metadata does not block generation. |
| FR-007 | Allow generation with draft only, draft plus context, or draft plus context plus evidence. | User can disable page context for a generation. |
| FR-008 | Generate exactly 3 draft variants for each successful generation request. | Each returned variant is meaningfully different. |
| FR-009 | Allow insert, copy, regenerate, and use-as-editable-draft actions on generated variants. | Insert works on Slack and Gmail; copy fallback is always available. |
| FR-010 | Never auto-send a message. | No background automation sends or schedules outbound messages. |
| FR-025 | Support an explicit `reply_from_scratch` action mode when the composer is empty or the user wants a fresh draft. | Empty-draft sessions can create a new reply without first typing a placeholder draft. |
| FR-026 | Support a keyboard shortcut to open the assistant for the active composer session. | `Cmd/Ctrl + Shift + R` opens the assistant when a valid composer is focused. |
| FR-027 | Define `use-as-editable-draft` precisely. | Selecting `use-as-editable-draft` replaces the panel draft field with the chosen variant, keeps it editable, and allows regeneration from the edited text. |
| FR-028 | Validate active session integrity before insert. | If the composer session, thread, or view changed since generation, direct insert is blocked and copy-only fallback is shown. |
| FR-037 | Expose a first-class free-form instruction field in the side panel. | The instruction field is always visible in the drafting UI, accepts typed or spoken guidance, and clearly influences generation without replacing the main draft field. |

### 11.2 Evidence and Attachment-Aware Drafting

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| FR-011 | Support evidence input via file picker, drag and drop, and paste for screenshots or images. | User can add supported files using any supported input method. |
| FR-012 | Support the following file types in MVP: PNG, JPG, JPEG, WEBP, PDF, DOCX, TXT, MD. | Unsupported types fail with a clear message. |
| FR-013 | Allow each file to be marked as `context_only` or `intended_attachment`. | Mode is visible and editable per file. |
| FR-014 | Allow optional `mention_in_reply` behavior per file. | Assistant only mentions files when explicitly permitted. |
| FR-015 | Summarize what the assistant understood from each evidence item or combined evidence set. | User sees an evidence understanding summary immediately when ingest completes or, at latest, before draft insertion. |
| FR-016 | Do not require universal auto-attachment into all supported target sites in MVP. | Core product value remains intact even when file attachment into the destination site is manual. |
| FR-029 | Enforce a product-level maximum of 5 evidence files per generation. | Users cannot exceed the cap without removing files first. |
| FR-030 | Support asynchronous evidence processing for large or slow files. | Large file ingest shows `processing`, `ready`, or `failed` state instead of blocking the UI indefinitely. |
| FR-031 | Cap evidence summary length to protect latency, token budget, and model context. | Each file summary and the combined evidence payload are truncated to defined safe limits with a visible warning if truncation occurs. |

### 11.3 Voice Input

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| FR-017 | Provide a microphone control inside the side panel. | User can explicitly start and stop recording. |
| FR-018 | Support speech-to-text into either the draft field or the instruction field. | Transcript lands in the correct editable input. |
| FR-019 | Keep voice optional and non-blocking. | The user can ignore voice and use typing only. |
| FR-020 | If microphone access is denied or unavailable, degrade cleanly to typed input. | User sees a clear fallback message and can continue. |

### 11.4 Settings, Privacy, and Reliability

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| FR-021 | Provide settings for enabled sites, default tone, privacy preferences, backend configuration, and cost mode. | Settings persist across browser restarts. |
| FR-022 | Show the inputs used for generation: draft, context, evidence summaries, and voice transcript if used. | User can inspect what is being sent. |
| FR-023 | Avoid storing raw conversation text, raw evidence, or raw audio by default. | Ephemeral handling is the default behavior. |
| FR-024 | Handle failure states clearly. | No composer, weak context, upload failure, transcription failure, generation failure, timeout, stale session, rate limit, and insert failure all produce clear UI feedback. |
| FR-032 | Enforce cost modes: `local_only`, `hybrid_low_cost`, and `cloud_quality`. | `local_only` is the default and blocks paid cloud use unless the user explicitly changes mode. |
| FR-033 | Make cloud usage explicit. | If a request would require cloud spend, the UI must say so before the request is sent unless the chosen mode already allows it. |
| FR-034 | Protect against prompt injection and adversarial customer text. | Customer-provided content cannot override the system instruction layer or attachment truth rules. |
| FR-035 | Support degraded-network recovery behavior. | Upload, voice transcription, and generation all expose timeout, cancel, and retry states. |
| FR-036 | Apply request throttling and backend rate limiting. | Double-clicking generate does not create duplicate requests, and users receive clear feedback on 429 or quota errors. |

## 12. Modular Architecture Requirements

These are first-class product requirements, not technical nice-to-haves.

| ID | Requirement | Why it exists | Acceptance Criteria |
|---|---|---|---|
| MA-001 | The MVP must be non-monolithic. | Future growth and safer change management. | The system is split into a core shell plus replaceable modules and adapters. |
| MA-002 | Site-specific logic must live in site adapters. | DOM churn and platform variability. | Slack, Gmail, and generic site behavior are isolated from core logic. |
| MA-003 | Feature logic must be organized into feature modules. | New features must be easy to add or remove. | Voice, evidence, drafting, telemetry, and settings can be turned on or off independently. |
| MA-004 | External service integrations must use provider adapters. | Future provider changes should not require application rewrite. | Model, transcription, storage, and parser integrations are behind adapter contracts. |
| MA-005 | The core product must still function when a non-core module is disabled. | Reduce blast radius. | If voice is disabled, typing still works; if evidence module is disabled, draft generation still works. |
| MA-006 | Module contracts must be explicit and versioned. | Safe upgrades and removals. | Shared interfaces or schemas exist for events, requests, responses, and capabilities. |
| MA-007 | New modules must be registerable without rewriting the core orchestration flow. | Expansion speed. | Core loads modules from a registry or manifest-based composition model. |
| MA-008 | Feature flags must allow optional modules to be enabled or disabled safely. | Controlled rollout and safe removal. | Evidence, voice, and telemetry can be turned off without breaking drafting. |
| MA-009 | Module removal must degrade gracefully rather than break the product. | Product reliability. | Removed or disabled modules expose clear missing-capability states in the UI. |
| MA-010 | Feature dependencies must be declared rather than assumed. | Prevent hidden coupling. | Each feature module declares required services and optional capabilities. |
| MA-011 | The architecture must support future expansion to more sites and more product capabilities without forcing a major refactor. | Long-term roadmap flexibility. | At least one new adapter and one new feature module can be added by following existing contracts. |

## 13. Non-Functional Requirements

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| NFR-001 | Performance | Inline trigger appears within 1 second on supported sites under normal conditions. |
| NFR-002 | Reliability | If context capture fails, draft-only mode still works. |
| NFR-003 | Security and privacy | Least-privilege permissions and explicit user-triggered microphone access. |
| NFR-004 | Maintainability | Site logic and provider logic are isolated behind interfaces. |
| NFR-005 | Accessibility | Keyboard-accessible panel controls and labeled microphone states. |
| NFR-006 | Observability | Core events, failures, and adapter-specific failures are measurable. |
| NFR-007 | Expandability | Adding a new site adapter or feature module should not require rewriting the core app shell. |
| NFR-008 | Cost efficiency | Default user flow should avoid paid cloud inference whenever a local path exists. |
| NFR-009 | Contract versioning | Shared contracts must include an explicit versioning strategy for safe evolution across modules and backend endpoints. |
| NFR-010 | Network resilience | Timeouts, retries, cancellation, and stale-session handling must be explicit and testable. |

## 14. Data Handling Rules

### 14.1 Included in Generation
- current draft
- visible context when enabled
- page metadata
- evidence summaries subject to summary caps
- optional voice transcript
- selected tone and action mode

### 14.2 Excluded by Default
- full page HTML
- unrelated page content
- raw microphone audio after transcription completes
- long-term raw storage for analytics
- cloud requests in `local_only` mode
- customer text treated as control instructions

### 14.3 Default Retention
Ephemeral. Raw evidence and raw audio are temporary processing inputs, not long-lived product records.

## 15. Success Metrics

### Product Metrics
- weekly active users
- generations per active user
- insert rate
- copy fallback rate
- evidence usage rate
- voice usage rate
- regeneration rate

### Technical Health Metrics
- adapter extraction failure rate
- file parse failure rate
- transcription failure rate
- insert failure rate
- latency by site and feature module
- stale-session insert block rate
- timeout and retry rate

### Cost Metrics
- percent of generations completed in `local_only` mode
- cloud fallback rate per user
- average cloud cost per active user per month
- average tokens or compute budget consumed per cloud-backed generation

### Extensibility Metrics
- time to add one new site adapter
- time to disable one optional feature module safely
- number of core files changed when adding a new module

## 16. Release Scope

### Included in MVP
- Chrome MV3 extension
- Slack adapter
- Gmail adapter
- generic adapter beta
- inline trigger
- side panel
- current draft capture
- visible context capture
- evidence upload and evidence modes
- evidence understanding summary
- voice input
- tone and action modes
- 3 draft variants
- insert and copy fallback
- settings page
- modular architecture and adapter contracts

### Excluded from MVP
- text-to-speech
- universal auto-attachment
- deep CRM integrations
- team admin features
- mobile and desktop native apps

## 17. Definition of Done

The MVP is done when:

1. User can install the extension in Chrome.
2. Slack and Gmail are supported through dedicated adapters.
3. Generic web composer support exists in beta form.
4. The user can open the assistant from page context.
5. The user can review draft, context, and evidence before generation.
6. The user can upload supported files.
7. The user can speak into the assistant and receive a transcript.
8. The system generates 3 draft variants.
9. The user can insert a draft into Slack and Gmail.
10. Copy fallback always exists.
11. The system never auto-sends.
12. The system is clearly modular and passes the modular architecture acceptance criteria.

## 18. Risks and Mitigations

### R-001 Site DOM changes
Mitigation: isolate site logic in adapters and use adapter tests.

### R-002 Unsupported or hallucinated claims
Mitigation: strict prompting, evidence summaries, user review before sending.

### R-003 Voice inconsistency
Mitigation: optional feature, clean fallback to typing, backend transcription as source of truth.

### R-004 Attachment expectation mismatch
Mitigation: clear distinction between `context_only` and `intended_attachment`.

### R-005 Hidden coupling leading to future breakage
Mitigation: module contracts, capability registry, independent feature toggles, explicit dependency declarations.

### R-006 Slow evidence parsing or timeout failures
Mitigation: asynchronous ingest jobs for large files, summary caps, visible processing states, retry support.

### R-007 Prompt injection from customer-visible text
Mitigation: isolate untrusted conversation and evidence content from system instructions using structured prompt sections and hard guardrails.

### R-008 Cloud spend unexpectedly increasing
Mitigation: local-first provider selection, explicit cost modes, hard summary caps, and per-token / per-user rate limits.

## 19. AI Build Agent Rules

1. Treat `MA-*` requirements as mandatory.
2. Do not implement a monolith first and modularize later.
3. Keep site adapters, provider adapters, and feature modules isolated.
4. Prefer explicit contracts over implicit shared state.
5. Do not add out-of-scope features unless required to satisfy an in-scope requirement.
6. Never implement auto-send.
7. Do not store raw sensitive content by default.
8. Every major implementation unit should map back to at least one `FR-*`, `MA-*`, or `NFR-*` requirement.
9. Implement local-first provider selection before enabling any cloud fallback path.
10. Treat stale session protection, prompt isolation, summary caps, and timeout handling as mandatory.

## 20. PRD Traceability Summary

- Core reply flow: `FR-001` to `FR-010`, `FR-025` to `FR-028`, `FR-037`
- Evidence and attachment-aware drafting: `FR-011` to `FR-016`, `FR-029` to `FR-031`
- Voice input: `FR-017` to `FR-020`
- Settings, privacy, and resilience: `FR-021` to `FR-024`, `FR-032` to `FR-036`
- Modularity and future growth: `MA-001` to `MA-011`
- Cross-cutting quality constraints: `NFR-001` to `NFR-010`

This PRD is the source document for the TRD and for the build plan.
