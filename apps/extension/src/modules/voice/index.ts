// =============================================================================
// Voice Module — M5
// =============================================================================

import type { FeatureModule, ModuleContext } from "@replymate/contracts";
import { VoicePanel } from "./VoicePanel.js";

export const voiceModule: FeatureModule = {
  id: "voice",
  version: "0.1.0",
  surfaces: ["sidepanel"],
  dependsOn: [],
  requiredCapabilities: [],

  register(ctx: ModuleContext) {
    ctx.uiRegistry.registerPanel("sidepanel", "voice", VoicePanel);
    ctx.logger.info("Voice module registered UI panel.");
  },
};
