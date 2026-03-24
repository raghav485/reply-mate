import type { FeatureModule, ModuleContext } from "@replymate/contracts";
import { SettingsPanel } from "./SettingsPanel.js";

export const settingsModule: FeatureModule = {
  id: "settings",
  version: "0.1.0",
  surfaces: ["options"],
  dependsOn: [],
  requiredCapabilities: [],

  register(ctx: ModuleContext) {
    ctx.uiRegistry.registerPanel("options", "settings", SettingsPanel);
    ctx.logger.info("Settings module registered options panel.");
  },
};
