// =============================================================================
// FeatureFlagService — TRD §13
// =============================================================================

import type {
  AppSettings,
  FeatureFlagService as IFeatureFlagService,
  FeatureFlagKey,
} from "@replymate/contracts";
import { DEFAULT_FLAGS } from "@replymate/contracts";

const STORAGE_KEY = "replymate:featureFlags";
const APP_SETTINGS_KEY = "replymate:appSettings";

export class FeatureFlagServiceImpl implements IFeatureFlagService {
  private flags: Record<FeatureFlagKey, boolean> = { ...DEFAULT_FLAGS };

  isEnabled(flag: FeatureFlagKey): boolean {
    return this.flags[flag] ?? false;
  }

  getAll(): Record<FeatureFlagKey, boolean> {
    return { ...this.flags };
  }

  setFlag(flag: FeatureFlagKey, value: boolean): void {
    this.flags[flag] = value;
  }

  async load(): Promise<void> {
    try {
      const result = await chrome.storage.local.get([STORAGE_KEY, APP_SETTINGS_KEY]);
      const appSettings = result[APP_SETTINGS_KEY] as AppSettings | undefined;
      if (appSettings?.featureFlags) {
        this.flags = { ...DEFAULT_FLAGS, ...appSettings.featureFlags };
        return;
      }

      if (result[STORAGE_KEY]) {
        const stored = result[STORAGE_KEY] as Partial<Record<FeatureFlagKey, boolean>>;
        // Merge stored flags onto defaults (new flags get defaults)
        this.flags = { ...DEFAULT_FLAGS, ...stored };
      }
    } catch {
      // Storage unavailable (e.g., tests), keep defaults
    }
  }

  async save(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(APP_SETTINGS_KEY);
      const appSettings = result[APP_SETTINGS_KEY] as AppSettings | undefined;
      await chrome.storage.local.set({
        [STORAGE_KEY]: this.flags,
        ...(appSettings
          ? {
              [APP_SETTINGS_KEY]: {
                ...appSettings,
                featureFlags: this.flags,
              },
            }
          : {}),
      });
    } catch {
      // Storage unavailable
    }
  }
}
