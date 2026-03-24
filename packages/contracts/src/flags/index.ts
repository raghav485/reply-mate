// =============================================================================
// Feature Flags — TRD §13.1
// =============================================================================

/** All known feature flag keys. */
export const FEATURE_FLAGS = {
  DRAFTING_ENABLED: "feature.drafting.enabled",
  EVIDENCE_ENABLED: "feature.evidence.enabled",
  VOICE_ENABLED: "feature.voice.enabled",
  TELEMETRY_ENABLED: "feature.telemetry.enabled",
  SITE_SLACK_ENABLED: "site.slack.enabled",
  SITE_GMAIL_ENABLED: "site.gmail.enabled",
  SITE_GENERIC_ENABLED: "site.generic.enabled",
} as const;

export type FeatureFlagKey =
  (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

/** Default flag values — TRD §13.2: Drafting is always-on. */
export const DEFAULT_FLAGS: Record<FeatureFlagKey, boolean> = {
  [FEATURE_FLAGS.DRAFTING_ENABLED]: true,
  [FEATURE_FLAGS.EVIDENCE_ENABLED]: true,
  [FEATURE_FLAGS.VOICE_ENABLED]: true,
  [FEATURE_FLAGS.TELEMETRY_ENABLED]: true,
  [FEATURE_FLAGS.SITE_SLACK_ENABLED]: true,
  [FEATURE_FLAGS.SITE_GMAIL_ENABLED]: true,
  [FEATURE_FLAGS.SITE_GENERIC_ENABLED]: true,
};
