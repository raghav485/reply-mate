import React from "react";
import { createRoot } from "react-dom/client";
import { SidePanelApp } from "./SidePanelApp.js";

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <SidePanelApp />
    </React.StrictMode>
  );
}
