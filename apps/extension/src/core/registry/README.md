# Module Registry Notes

This folder owns modular feature boot behavior for the extension runtime.

## Feature Flag Matrix
- `drafting` is always-on.
- `evidence`, `voice`, and `telemetry` are optional and gated by feature flags.
- When an optional module is disabled, its capability is forced to unavailable.

## Dependency Rules
- Modules declare `dependsOn`.
- Boot order is topologically resolved and deterministic.
- Missing dependencies skip module registration without crashing the runtime.

## Safe Add/Remove Procedure
1. Add the feature to contracts (`FeatureId`, capability map, flag key if optional).
2. Register module in bootstrap.
3. Add feature-flag enabled and disabled tests in `ModuleRegistry.test.ts`.
4. Validate core drafting still works when optional modules are disabled.

## Test Coverage
- Capability behavior: `CapabilityRegistry.test.ts`
- UI registration: `UiRegistry.test.ts`
- Module flag/dependency matrix: `ModuleRegistry.test.ts`
