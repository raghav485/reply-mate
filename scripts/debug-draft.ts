import type { GenerateDraftRequest } from "@replymate/contracts";
import { OllamaLLMProviderAdapter } from "../apps/api/src/providers/OllamaLLMProviderAdapter.js";

const adapter = new OllamaLLMProviderAdapter(
  "http://localhost:11434",
  "qwen3:8b",
  30_000,
  {
    temperature: 0.2,
    topP: 0.9,
    repeatPenalty: 1.1,
    numPredict: 500,
    keepAlive: "30m",
  }
);

const input: GenerateDraftRequest = {
  sessionId: "debug-session",
  sessionVersion: 1,
  siteId: "generic_web",
  actionMode: "improve_current_draft",
  tonePreset: "professional",
  draftInput: "sub account created by eugin and all set",
  contextEnabled: true,
  snapshot: {
    draftText: "sub account created by eugin and all set",
    visibleContext: [
      {
        id: "ctx-1",
        text: "Link to google drive: https://drive.google.com/drive/folders/1oMc1c",
        role: "agent",
        source: "visible_email_thread",
      },
    ],
    contextScope: "thread",
    workspaceKey: "debug-workspace",
    metadata: {
      siteId: "generic_web",
      url: "https://test.com",
      customerName: "Eugene",
      senderName: "Support",
    },
    extractionConfidence: 1,
    warnings: [],
    pageUrlAtCapture: "https://test.com",
    viewFingerprint: "test-view",
    composerFingerprint: "test-composer",
    sessionVersion: 1,
  },
  evidence: [],
  usedVoiceInput: false,
  costMode: "local_only",
};

async function run(): Promise<void> {
  const result = await adapter.generateDrafts(input);
  console.log(JSON.stringify(result, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
