import type { CostMode } from "@replymate/contracts";

export type DraftingPathDecision =
  | "local_model"
  | "cloud"
  | "blocked";
export type ProviderPathDecision = "cloud" | "blocked";

export function selectGenerationPath(input: {
  costMode: CostMode;
  hasLocalModelGeneration: boolean;
  hasCloudGeneration: boolean;
}): DraftingPathDecision {
  if (input.costMode === "local_only") {
    if (input.hasLocalModelGeneration) return "local_model";
    return "blocked";
  }

  if (input.costMode === "hybrid_low_cost") {
    if (input.hasLocalModelGeneration) return "local_model";
    if (input.hasCloudGeneration) return "cloud";
    return "blocked";
  }

  if (input.hasCloudGeneration) return "cloud";
  if (input.hasLocalModelGeneration) return "local_model";
  return "blocked";
}

export function selectRemoteTranscriptionPath(input: {
  costMode: CostMode;
  hasRemoteTranscription: boolean;
}): ProviderPathDecision {
  if (input.costMode === "local_only") {
    return "blocked";
  }

  return input.hasRemoteTranscription ? "cloud" : "blocked";
}
