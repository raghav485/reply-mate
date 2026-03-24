// =============================================================================
// Evidence Module — M4
// =============================================================================

import type { FeatureModule, ModuleContext } from "@replymate/contracts";
import { EvidencePanel } from "./EvidencePanel.js";

export const evidenceModule: FeatureModule = {
  id: "evidence",
  version: "0.1.0",
  surfaces: ["sidepanel"],
  dependsOn: [],
  requiredCapabilities: [],

  register(ctx: ModuleContext) {
    ctx.uiRegistry.registerPanel("sidepanel", "evidence", EvidencePanel);
    ctx.logger.info("Evidence module registered UI panel.");
  },
};
