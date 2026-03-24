// =============================================================================
// CapabilityRegistry — TRD §6.3
// =============================================================================

import type {
  CapabilityMap,
  CapabilityRegistry as ICapabilityRegistry,
} from "@replymate/contracts";

const DEFAULT_CAPABILITIES: CapabilityMap = {
  drafting: false,
  evidence: false,
  voice: false,
  telemetry: false,
  attachHelper: "none",
};

export class CapabilityRegistryImpl implements ICapabilityRegistry {
  private capabilities: CapabilityMap = { ...DEFAULT_CAPABILITIES };

  getCapabilities(): CapabilityMap {
    return { ...this.capabilities };
  }

  setCapability<K extends keyof CapabilityMap>(
    key: K,
    value: CapabilityMap[K]
  ): void {
    this.capabilities[key] = value;
  }

  isAvailable(key: keyof CapabilityMap): boolean {
    const val = this.capabilities[key];
    if (typeof val === "boolean") return val;
    // For AttachCapability, "none" means unavailable
    return val !== "none";
  }
}
