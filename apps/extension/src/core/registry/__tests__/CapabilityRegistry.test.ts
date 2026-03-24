// =============================================================================
// CapabilityRegistry Tests
// =============================================================================

import { describe, it, expect } from "vitest";
import { CapabilityRegistryImpl } from "../CapabilityRegistry.js";

describe("CapabilityRegistry", () => {
  it("starts with all capabilities disabled", () => {
    const reg = new CapabilityRegistryImpl();
    const caps = reg.getCapabilities();

    expect(caps.drafting).toBe(false);
    expect(caps.evidence).toBe(false);
    expect(caps.voice).toBe(false);
    expect(caps.telemetry).toBe(false);
    expect(caps.attachHelper).toBe("none");
  });

  it("setCapability updates the value", () => {
    const reg = new CapabilityRegistryImpl();
    reg.setCapability("drafting", true);

    expect(reg.getCapabilities().drafting).toBe(true);
    expect(reg.isAvailable("drafting")).toBe(true);
  });

  it("isAvailable returns false for disabled boolean capabilities", () => {
    const reg = new CapabilityRegistryImpl();
    expect(reg.isAvailable("voice")).toBe(false);
  });

  it("isAvailable returns false for 'none' attach capability", () => {
    const reg = new CapabilityRegistryImpl();
    expect(reg.isAvailable("attachHelper")).toBe(false);
  });

  it("isAvailable returns true for non-'none' attach capability", () => {
    const reg = new CapabilityRegistryImpl();
    reg.setCapability("attachHelper", "manual_only");
    expect(reg.isAvailable("attachHelper")).toBe(true);
  });

  it("getCapabilities returns a copy, not a reference", () => {
    const reg = new CapabilityRegistryImpl();
    const caps = reg.getCapabilities();
    caps.drafting = true;

    // Original should be unaffected
    expect(reg.getCapabilities().drafting).toBe(false);
  });
});
