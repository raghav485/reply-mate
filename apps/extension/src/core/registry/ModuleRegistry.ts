// =============================================================================
// ModuleRegistry — TRD §7
// =============================================================================

import type {
  FeatureModule,
  FeatureId,
  ModuleContext,
  FeatureFlagService,
  Logger,
  CapabilityRegistry,
  RuntimeSurface,
} from "@replymate/contracts";
import { FEATURE_FLAGS } from "@replymate/contracts";

type ModuleEntry = {
  module: FeatureModule;
  registered: boolean;
};

/**
 * Map FeatureId → feature flag key.
 * Drafting has no flag (always on per TRD §13.2).
 */
const FEATURE_TO_FLAG: Partial<Record<FeatureId, string>> = {
  evidence: FEATURE_FLAGS.EVIDENCE_ENABLED,
  voice: FEATURE_FLAGS.VOICE_ENABLED,
  telemetry: FEATURE_FLAGS.TELEMETRY_ENABLED,
};

export class ModuleRegistryImpl {
  private entries: Map<FeatureId, ModuleEntry> = new Map();
  private bootOrder: FeatureId[] = [];

  constructor(
    private featureFlags: FeatureFlagService,
    private capabilityRegistry: CapabilityRegistry,
    private logger: Logger
  ) {}

  /**
   * Add a module to the registry. Does NOT register it yet.
   * Call `bootAll()` after adding all modules.
   */
  addModule(module: FeatureModule): void {
    if (this.entries.has(module.id)) {
      this.logger.warn(`Module ${module.id} already added, skipping.`);
      return;
    }
    this.entries.set(module.id, { module, registered: false });
  }

  /**
   * Boot all added modules in dependency order.
   * Disabled modules are skipped but tracked.
   */
  async bootAll(ctx: ModuleContext): Promise<void> {
    // Resolve deterministic boot order via topological sort
    this.bootOrder = this.resolveBootOrder();

    for (const id of this.bootOrder) {
      const entry = this.entries.get(id)!;
      if (!this.supportsSurface(entry.module, ctx.runtimeSurface)) {
        continue;
      }
      const flagKey = FEATURE_TO_FLAG[id];

      // Check if disabled via feature flag
      if (
        flagKey &&
        !this.featureFlags.isEnabled(flagKey as any)
      ) {
        this.logger.info(`Module ${id} is disabled by feature flag.`);
        this.capabilityRegistry.setCapability(
          id as keyof ReturnType<typeof this.capabilityRegistry.getCapabilities>,
          false as any
        );
        continue;
      }

      // Check dependencies are registered
      const missingDeps = entry.module.dependsOn.filter(
        (dep) => !this.entries.get(dep)?.registered
      );
      if (missingDeps.length > 0) {
        this.logger.error(
          `Module ${id} skipped: missing dependencies [${missingDeps.join(", ")}]`
        );
        continue;
      }

      try {
        await entry.module.register(ctx);
        entry.registered = true;

        // Mark capability as available
        if (id in ctx.capabilityRegistry.getCapabilities()) {
          ctx.capabilityRegistry.setCapability(id as any, true as any);
        }

        this.logger.info(`Module ${id} v${entry.module.version} registered.`);
      } catch (err) {
        this.logger.error(`Module ${id} failed to register:`, {
          error: String(err),
        });
      }
    }
  }

  /**
   * Teardown all registered modules in reverse order.
   */
  async teardownAll(ctx: ModuleContext): Promise<void> {
    const reversed = [...this.bootOrder].reverse();
    for (const id of reversed) {
      const entry = this.entries.get(id);
      if (entry?.registered && entry.module.teardown) {
        try {
          await entry.module.teardown(ctx);
          entry.registered = false;
          this.logger.info(`Module ${id} torn down.`);
        } catch (err) {
          this.logger.error(`Module ${id} teardown failed:`, {
            error: String(err),
          });
        }
      }
    }
  }

  isRegistered(id: FeatureId): boolean {
    return this.entries.get(id)?.registered ?? false;
  }

  getRegisteredModules(): FeatureId[] {
    return [...this.entries.entries()]
      .filter(([, entry]) => entry.registered)
      .map(([id]) => id);
  }

  /**
   * Topological sort of modules by `dependsOn`.
   * Deterministic: IDs are sorted alphabetically when dependencies are equal.
   */
  private resolveBootOrder(): FeatureId[] {
    const visited = new Set<FeatureId>();
    const result: FeatureId[] = [];

    const visit = (id: FeatureId) => {
      if (visited.has(id)) return;
      visited.add(id);
      const entry = this.entries.get(id);
      if (!entry) return;
      for (const dep of entry.module.dependsOn) {
        visit(dep);
      }
      result.push(id);
    };

    // Stable iteration order
    const ids = [...this.entries.keys()].sort();
    for (const id of ids) {
      visit(id);
    }

    return result;
  }

  private supportsSurface(
    module: FeatureModule,
    surface: RuntimeSurface
  ): boolean {
    return module.surfaces.includes(surface);
  }
}
