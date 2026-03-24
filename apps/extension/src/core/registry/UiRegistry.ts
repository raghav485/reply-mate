// =============================================================================
// UiRegistry — Dynamically registers UI components
// =============================================================================

import type { FeatureId, RuntimeSurface } from "@replymate/contracts";
import React from "react";

type ReactComponent = React.ComponentType<any>;

export interface UiRegistry {
  /**
   * Register a top-level panel component for a feature module
   * on a specific extension surface.
   */
  registerPanel(
    surface: RuntimeSurface,
    featureId: FeatureId,
    component: ReactComponent
  ): void;
  
  /** Retrieve all registered panels for the given surface. */
  getPanels(surface: RuntimeSurface): { featureId: FeatureId; component: ReactComponent }[];
}

export class UiRegistryImpl implements UiRegistry {
  private panels: Map<RuntimeSurface, Map<FeatureId, ReactComponent>> = new Map();

  registerPanel(
    surface: RuntimeSurface,
    featureId: FeatureId,
    component: ReactComponent
  ): void {
    if (!this.panels.has(surface)) {
      this.panels.set(surface, new Map());
    }

    const panelsForSurface = this.panels.get(surface)!;
    if (panelsForSurface.has(featureId)) {
      console.warn(`[UiRegistry] Panel for ${featureId} already registered on ${surface}.`);
      return;
    }
    panelsForSurface.set(featureId, component);
  }

  getPanels(surface: RuntimeSurface): { featureId: FeatureId; component: ReactComponent }[] {
    const panelsForSurface = this.panels.get(surface);
    if (!panelsForSurface) {
      return [];
    }

    return Array.from(panelsForSurface.entries()).map(([featureId, component]) => ({
      featureId,
      component,
    }));
  }
}
