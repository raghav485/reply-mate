// =============================================================================
// Drafting Module — Main Feature Module (TRD §14.3)
// =============================================================================

import type { FeatureModule, ModuleContext } from "@replymate/contracts";
import { DraftingPanel } from "./DraftingPanel.js";

export const draftingModule: FeatureModule = {
  id: "drafting",
  version: "0.1.0",
  surfaces: ["sidepanel"],
  dependsOn: [],
  requiredCapabilities: [],

  register(ctx: ModuleContext) {
    // Register the main UI panel in the side panel shell
    ctx.uiRegistry.registerPanel("sidepanel", "drafting", DraftingPanel);

    ctx.logger.info("Drafting module registered UI panel.");
  },
};
