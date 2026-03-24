// =============================================================================
// Extension Events — TRD §8.2
// =============================================================================

import type {
  ComposerSnapshot,
  DraftVariant,
  EvidenceSummary,
  ErrorCode,
} from "../index.js";

export type ExtensionEvent =
  // Session events
  | {
      type: "session/activeChanged";
      tabId: number;
      sessionId: string | null;
    }
  | {
      type: "session/snapshotUpdated";
      sessionId: string;
      snapshot: ComposerSnapshot;
    }
  // Evidence events
  | {
      type: "evidence/uploaded";
      sessionId: string;
      evidence: EvidenceSummary;
    }
  | {
      type: "evidence/removed";
      sessionId: string;
      evidenceId: string;
    }
  // Voice events
  | {
      type: "voice/transcriptReady";
      sessionId: string;
      target: "draft" | "instructions";
      transcript: string;
    }
  // Generation events
  | {
      type: "generation/requested";
      sessionId: string;
    }
  | {
      type: "generation/succeeded";
      sessionId: string;
      drafts: DraftVariant[];
    }
  | {
      type: "generation/failed";
      sessionId: string;
      errorCode: ErrorCode;
    }
  // Insert events
  | {
      type: "insert/succeeded";
      sessionId: string;
    }
  | {
      type: "insert/failed";
      sessionId: string;
      errorCode: ErrorCode;
    }
  // Telemetry events
  | {
      type: "telemetry/event";
      name: TelemetryEventName;
      payload?: Record<string, unknown>;
    };

// =============================================================================
// Telemetry Event Names — TRD §12.5
// =============================================================================

export const TELEMETRY_EVENT_NAMES = [
  "panel_opened",
  "composer_detected",
  "context_capture_succeeded",
  "context_capture_failed",
  "evidence_upload_started",
  "evidence_upload_succeeded",
  "evidence_upload_failed",
  "evidence_job_polled",
  "voice_started",
  "voice_transcribed",
  "generation_requested",
  "generation_succeeded",
  "generation_failed",
  "draft_inserted",
  "draft_copied",
  "stale_session_blocked",
  "rate_limited",
  "cloud_fallback_used",
] as const;

export type TelemetryEventName = (typeof TELEMETRY_EVENT_NAMES)[number];
