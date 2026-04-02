import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runDevStack } from "./dev-stack.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

runDevStack({
  repoRoot,
  title: "ReplyMate local-first dev startup",
  processes: [
    { label: "api", script: "dev:api" },
    { label: "extension", script: "dev:extension" },
  ],
  startupLines: [
    "- API: http://localhost:3000",
    "- Extension dist: apps/extension/dist",
    "- Load or reload the unpacked extension manually in chrome://extensions",
    "- For the hosted account surface, start it separately with: npm run dev:web",
  ],
});
