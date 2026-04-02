# Writing Assistant Architecture

Generated At: 2026-03-31T20:41:20.498Z
Summary Source: heuristic

## Project Summary
Writing Assistant is organized into 17 module boundary group(s). Largest modules include apps/extension, apps/api, apps/web.

## Top Module Boundaries
- apps/extension (90 files, 1 deps, 0 dependents)
- apps/api (77 files, 1 deps, 0 dependents)
- apps/web (14 files, 2 deps, 1 dependents)
- packages/contracts (9 files, 0 deps, 52 dependents)
- scripts (8 files, 1 deps, 0 dependents)
- scripts/fixtures (7 files, 0 deps, 0 dependents)
- .env.example (1 files, 0 deps, 0 dependents)
- .gitignore (1 files, 0 deps, 0 dependents)
- .vscode (1 files, 0 deps, 0 dependents)
- AGENTS.md (1 files, 0 deps, 0 dependents)
- docs/agent (1 files, 0 deps, 0 dependents)
- package-lock.json (1 files, 0 deps, 0 dependents)
- package.json (1 files, 0 deps, 0 dependents)
- PRD_Context_Aware_Reply_Assistant_MVP_v1.3.md (1 files, 0 deps, 0 dependents)
- README.md (1 files, 0 deps, 0 dependents)
- TRD_Context_Aware_Reply_Assistant_MVP_v1.3.md (1 files, 0 deps, 0 dependents)
- tsconfig.base.json (1 files, 0 deps, 0 dependents)

## Dependency Hotspots
- packages/contracts/src/index.ts (incoming 52, outgoing 0, module packages/contracts)
- apps/api/src/auth/ConsoleEmailDeliveryAdapter.ts (incoming 0, outgoing 1, module apps/api)
- apps/api/src/billing/__tests__/BillingService.test.ts (incoming 0, outgoing 1, module apps/api)
- apps/api/src/billing/__tests__/requireEntitlement.test.ts (incoming 0, outgoing 1, module apps/api)
- apps/api/src/billing/requireEntitlement.ts (incoming 0, outgoing 1, module apps/api)
- apps/api/src/core/costPolicy.ts (incoming 0, outgoing 1, module apps/api)
- apps/api/src/persistence/NullBillingRepository.ts (incoming 0, outgoing 1, module apps/api)
- apps/api/src/persistence/PostgresBillingRepository.ts (incoming 0, outgoing 1, module apps/api)

## Recent Session Pointer
- No sessions recorded yet.

## User Architecture Rules
- None

## Provenance
- Structural data comes from persisted graph and session state.
- Generated prose is tagged above as heuristic or llm.
- Raw source code is never written into this file.
