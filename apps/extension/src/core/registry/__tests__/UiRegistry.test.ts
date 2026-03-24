// =============================================================================
// UiRegistry Tests
// =============================================================================

import { describe, it, expect, vi } from "vitest";
import { UiRegistryImpl } from "../UiRegistry.js";
import React from "react";

describe("UiRegistry", () => {
  it("registers and retrieves React panels", () => {
    const registry = new UiRegistryImpl();
    const MockPanel = () => React.createElement("div", null, "Mock Panel");

    registry.registerPanel("sidepanel", "drafting", MockPanel as any);

    const panels = registry.getPanels("sidepanel");
    expect(panels).toHaveLength(1);
    expect(panels[0].featureId).toBe("drafting");
    expect(panels[0].component).toBe(MockPanel);
  });

  it("prevents duplicate registrations for the same featureId", () => {
    const registry = new UiRegistryImpl();
    const MockPanel1 = () => React.createElement("div", null, "Mock Panel 1");
    const MockPanel2 = () => React.createElement("div", null, "Mock Panel 2");

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    registry.registerPanel("sidepanel", "drafting", MockPanel1 as any);
    registry.registerPanel("sidepanel", "drafting", MockPanel2 as any);

    const panels = registry.getPanels("sidepanel");
    expect(panels).toHaveLength(1);
    expect(panels[0].component).toBe(MockPanel1);
    
    expect(consoleSpy).toHaveBeenCalledWith("[UiRegistry] Panel for drafting already registered on sidepanel.");
    consoleSpy.mockRestore();
  });
});
