import { useEffect, useState } from "react";
import type { FeatureId, ModuleContext } from "@replymate/contracts";
import { bootstrap } from "../core/boot/bootstrap.js";
import { ShellContextProvider } from "../core/ui/ShellContext.js";

export function OptionsApp() {
  const [ctx, setCtx] = useState<ModuleContext | null>(null);
  const [panels, setPanels] = useState<
    { featureId: FeatureId; component: React.ComponentType<any> }[]
  >([]);

  useEffect(() => {
    async function init() {
      const { ctx, registry } = await bootstrap("options");
      await registry.bootAll(ctx);
      setCtx(ctx);
      setPanels(ctx.uiRegistry.getPanels("options"));
    }

    void init();
  }, []);

  if (!ctx) {
    return (
      <div className="settings-container">
        <div className="settings-header">
          <h1>
            <div className="logo" />
            ReplyMate Settings
          </h1>
          <p>Loading settings…</p>
        </div>
      </div>
    );
  }

  return (
    <ShellContextProvider ctx={ctx}>
    <div className="settings-container">
      {/* Header */}
      <div className="settings-header">
        <h1>
          <div className="logo" />
          ReplyMate Settings
        </h1>
        <p>Configure your backend connection and feature preferences.</p>
      </div>

      {panels.map(({ featureId, component: PanelComponent }) => (
        <PanelComponent key={featureId} />
      ))}
    </div>
    </ShellContextProvider>
  );
}
