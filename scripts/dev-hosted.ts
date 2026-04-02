import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getStripeBillingIntegrationReadiness } from "../apps/api/src/billing/readiness.js";
import { loadLocalEnv } from "../apps/api/src/bootstrap/loadEnv.js";
import { runDevStack } from "./dev-stack.js";

loadLocalEnv();

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const billingReadiness = getStripeBillingIntegrationReadiness();

runDevStack({
  repoRoot,
  title: "ReplyMate hosted billing dev startup",
  processes: [
    { label: "api", script: "dev:api" },
    { label: "web", script: "dev:web" },
    { label: "extension", script: "dev:extension" },
  ],
  startupLines: [
    "- API: http://localhost:3000",
    "- Web app: http://localhost:5173",
    "- Extension dist: apps/extension/dist",
    `- Billing readiness: ${billingReadiness.verificationMode.replace(/_/g, "-")} (${billingReadiness.status})`,
    `- Live Stripe checkout available: ${billingReadiness.checkoutAvailable ? "yes" : "no"}`,
    `- Webhook fixture verification available: ${billingReadiness.webhookVerificationAvailable ? "yes" : "no"}`,
    "- Load or reload the unpacked extension manually in chrome://extensions",
  ],
});
