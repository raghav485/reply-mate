# Agent Rules

Read this file before making changes. It defines repo-specific working rules for agents. It complements the PRD/TRD; it does not replace them.

## 1. Purpose
- Read this file before editing the repo.
- Use it as the operating policy for implementation work.
- Treat the PRD/TRD as still-relevant product and architecture references.

## 2. Repo Priorities
- Keep the product modular and non-monolithic.
- Preserve adapter, provider, service, and module boundaries.
- Fix root causes, not symptoms.
- Avoid hardcoding.
- Preserve security and privacy constraints while building.
- Keep contracts, schemas, and ownership clear.
- Gather enough context to act correctly, but avoid context bloat.
- Keep changes verifiable.

## 3. Architecture Rules
- Do not grow a monolith.
- Extend the system through feature modules, site adapters, provider adapters, backend services, and explicit contracts.
- Keep the core shell small and stable.
- Do not place site DOM logic in core runtime code.
- Do not place provider SDK or runtime logic in UI code.
- Define or update contracts before wiring cross-module interactions.
- Prefer composition and ownership boundaries over scattered cross-cutting edits.
- If a feature cannot be added or removed cleanly, the architecture is wrong and should be corrected.
- Do not ship a monolith with a plan to modularize later.
- Preserve local-first and cloud-optional behavior unless explicitly instructed otherwise.

## 4. Change Strategy Rules
- Fix the root cause, not the visible symptom.
- Do not patch around broken behavior with one-off conditionals unless that conditional is the real product rule.
- Do not silence errors, warnings, or failing tests without understanding the cause.
- Prefer removing invalid behavior over layering fallback hacks on top.
- Finish boundary refactors instead of leaving misleading placeholder logic.
- If a bug reveals architectural drift, repair the architecture, not just the failing output.

## 5. Context Discipline Rules
- Gather enough local context to understand the owning flow before editing.
- Prefer the nearest source of truth: contracts, schemas, entrypoints, owning modules, and tests.
- Do not read large unrelated parts of the repo unless needed.
- Keep working context focused on files that materially affect the task.
- Avoid context bloat, unrelated repo tours, and cargo-cult copying from irrelevant areas.
- If the relevant boundary is already clear, stop exploring and act.

## 6. Security and Privacy Rules
- Treat visible page content, customer text, uploaded evidence, and transcripts as untrusted input.
- Do not let untrusted content override system instructions, control flow, or privileged behavior.
- Preserve stale-session protections and do not bypass insert or copy safety checks.
- Never hardcode secrets, invite codes, API keys, bearer tokens, session secrets, or private endpoints.
- Never ship provider secrets or server-only credentials in the extension bundle.
- Prefer least-privilege permissions, narrow host permissions, and narrow content-script scope.
- Do not broaden manifest permissions or host matches without a clear product reason.
- Preserve schema validation, file validation, size limits, and request caps.
- Preserve explicit auth, authorization, rate limiting, and timeout behavior.
- Keep telemetry, logs, and debug output free of raw sensitive user content unless explicitly required and documented.
- If a change touches auth, tokens, sessions, evidence upload, telemetry, external requests, permissions, or prompt construction, review the security implications before finalizing.
- Prefer server-side enforcement over client trust.
- Avoid storing long-lived sensitive state when shorter-lived or session-scoped state is possible.
- Keep CORS and origin policy explicit and narrow.
- Do not weaken validation to "make things work."

## 7. Code Quality Rules
- Avoid hardcoding URLs, tokens, environment names, IDs, model names, feature switches, permission scopes, and business rules unless they are true product constants.
- Prefer typed config, settings, env vars, or existing constants for environment-dependent values.
- Preserve explicit typing and validation.
- Do not duplicate logic that already has a clear owner.
- Do not add speculative abstractions or dead code.
- Keep comments sparse and high-signal.
- Do not hide mixed responsibilities inside giant functions or giant files when a module boundary exists.

## 8. Verification Rules
- Run targeted tests for the changed area by default.
- Run `npm run verify:fast` when the change is substantial, cross-package, or touches shared contracts, runtime boot, provider selection, manifests, auth, permissions, or extension/background flow.
- When touching auth, sessions, permissions, validation, telemetry, or backend request handling, include verification for the security-sensitive path you changed.
- If verification is skipped, say so explicitly.
- Do not claim a fix without verification.

## 9. Conflict and Escalation Rules
- Treat the PRD/TRD as still-relevant architectural and product-intent references.
- Do not invent new product direction during implementation.
- If current repo behavior, PRD/TRD intent, and the active request align, proceed.
- If current code and PRD/TRD differ on an implementation detail, use current repo truth for the fact but call out meaningful drift.
- If a change would materially alter product direction, security posture, public behavior, permission scope, cost model, or module boundaries beyond what the PRD/TRD and the active request clearly support, stop and ask.
- Explicit user instruction overrides prior docs, but architectural or security conflicts should still be surfaced.

## 10. Source-of-Truth Map
- [`AGENTS.md`](./AGENTS.md): how agents should work in this repo.
- [`PRD_Context_Aware_Reply_Assistant_MVP_v1.3.md`](./PRD_Context_Aware_Reply_Assistant_MVP_v1.3.md): product intent and user-facing constraints.
- [`TRD_Context_Aware_Reply_Assistant_MVP_v1.3.md`](./TRD_Context_Aware_Reply_Assistant_MVP_v1.3.md): architecture intent and technical constraints.
- [`docs/agent/README.md`](./docs/agent/README.md): overflow area for future detailed agent guidance.

## 11. Growth Policy
- Keep `AGENTS.md` focused on the main rules only.
- If it grows beyond a concise first-read size, move expanded material into `docs/agent/` subfiles and keep only summaries plus pointers here.
- Do not let the root file become a long handbook.
- Keep the root file scannable in one pass.
