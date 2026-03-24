import type { FeatureModule, ModuleContext } from "@replymate/contracts";
import { FEATURE_FLAGS } from "@replymate/contracts";

let unsubscribe: (() => void) | null = null;

function hashValue(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function sanitizePayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!payload) return {};

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const lowered = key.toLowerCase();
    if (
      lowered.includes("text") ||
      lowered.includes("draft") ||
      lowered.includes("context") ||
      lowered.includes("transcript") ||
      lowered.includes("summary")
    ) {
      continue;
    }

    if (typeof value === "string") {
      output[key] =
        lowered.includes("sessionid") || lowered === "sessionId"
          ? hashValue(value)
          : value.slice(0, 64);
      continue;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      output[key] = value;
    }
  }

  return output;
}

export const telemetryModule: FeatureModule = {
  id: "telemetry",
  version: "0.1.0",
  surfaces: ["background"],
  dependsOn: [],
  requiredCapabilities: [],

  register(ctx: ModuleContext) {
    unsubscribe = ctx.bus.subscribe("telemetry/event", (event) => {
      if (!ctx.featureFlags.isEnabled(FEATURE_FLAGS.TELEMETRY_ENABLED)) {
        return;
      }

      const settings = ctx.settings.get();
      if (!settings.preferences.telemetryEnabled || !ctx.apiClient.getBaseUrl()) {
        return;
      }

      void ctx.apiClient
        .post("/v1/metrics", {
          name: event.name,
          payload: sanitizePayload(event.payload),
        })
        .catch((error) => {
          ctx.logger.warn("Telemetry post failed", {
            error: error instanceof Error ? error.message : String(error),
            name: event.name,
          });
        });
    });

    ctx.logger.info("Telemetry module registered.");
  },

  teardown() {
    unsubscribe?.();
    unsubscribe = null;
  },
};
