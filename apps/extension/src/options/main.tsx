import React from "react";
import { createRoot } from "react-dom/client";
import { OptionsApp } from "./OptionsApp.js";

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <OptionsApp />
    </React.StrictMode>
  );
}
