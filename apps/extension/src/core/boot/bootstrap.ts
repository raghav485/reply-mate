// =============================================================================
// Bootstrap — App initialization — TRD §3.1
// =============================================================================

import type { ModuleContext, RuntimeSurface } from "@replymate/contracts";
import { EventBusImpl } from "../bus/EventBus.js";
import {
  ModuleRegistryImpl,
  CapabilityRegistryImpl,
} from "../registry/index.js";
import { UiRegistryImpl } from "../registry/UiRegistry.js";
import { SessionStoreImpl } from "../session/index.js";
import { FeatureFlagServiceImpl } from "../permissions/FeatureFlagService.js";
import { SettingsServiceImpl } from "../settings/index.js";
import { ConsoleLogger } from "../ui/Logger.js";
import { ApiClientImpl } from "../../shared-client/ApiClient.js";
import { draftingModule } from "../../modules/drafting/index.js";
import { evidenceModule } from "../../modules/evidence/index.js";
import { settingsModule } from "../../modules/settings/index.js";
import { telemetryModule } from "../../modules/telemetry/index.js";
import { voiceModule } from "../../modules/voice/index.js";

export type BootResult = {
  ctx: ModuleContext;
  registry: ModuleRegistryImpl;
};

/**
 * Bootstrap the core shell.
 * Call this once from the background service worker or side panel entry.
 *
 * Boot sequence:
 * 1. Create core services
 * 2. Load settings and feature flags from storage
 * 4. Return ModuleContext + registry for module registration
 */
export async function bootstrap(surface: RuntimeSurface): Promise<BootResult> {
  const logger = new ConsoleLogger("ReplyMate");
  logger.info("Bootstrapping core shell...", { surface });

  // Create core services
  const bus = new EventBusImpl();
  const capabilityRegistry = new CapabilityRegistryImpl();
  const sessionStore = new SessionStoreImpl();
  const featureFlags = new FeatureFlagServiceImpl();
  const settings = new SettingsServiceImpl();
  const apiClient = new ApiClientImpl();
  const uiRegistry = new UiRegistryImpl();

  await settings.load();
  await featureFlags.load();
  const currentSettings = settings.get();
  apiClient.setBaseUrl(currentSettings.backend.baseUrl);
  apiClient.setToken(currentSettings.backend.token);

  // Build module context
  const ctx: ModuleContext = {
    runtimeSurface: surface,
    bus,
    sessionStore,
    capabilityRegistry,
    featureFlags,
    settings,
    apiClient,
    logger,
    uiRegistry,
  };

  // Create module registry
  const registry = new ModuleRegistryImpl(
    featureFlags,
    capabilityRegistry,
    logger
  );

  registry.addModule(draftingModule);
  registry.addModule(evidenceModule);
  registry.addModule(settingsModule);
  registry.addModule(telemetryModule);
  registry.addModule(voiceModule);

  logger.info("Core shell bootstrapped.");

  return { ctx, registry };
}
