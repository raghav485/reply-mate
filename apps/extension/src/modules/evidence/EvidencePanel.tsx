import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type {
  EvidenceMode,
  EvidenceSummary,
} from "@replymate/contracts";
import type { PendingEvidenceState } from "../../core/workspace/WorkspaceStateStore.js";
import { useActiveTabId } from "../../core/ui/ActiveTabContext.js";
import { useActiveSession } from "../../core/ui/ActiveSessionContext.js";
import { sendRuntimeMessage } from "../../shared/runtime.js";

type PendingEvidenceFile = {
  localId: string;
  file: File;
  mode: EvidenceMode;
  mentionInReply: boolean;
};

type RuntimeMessage = {
  type?: string;
  payload?: {
    tabId?: number;
    workspaceKey?: string;
    evidence?: EvidenceSummary[];
    pendingEvidence?: PendingEvidenceState[];
  };
};

type EvidenceRuntimeResponse = {
  evidence?: EvidenceSummary[];
  pendingEvidence?: PendingEvidenceState[];
};

const NO_COMPOSER_MESSAGE =
  "ReplyMate could not find an active text box on this page. Focus the composer and try again.";

const MAX_FILES_PER_GENERATION = 5;
const MAX_TOTAL_BYTES = 35 * 1024 * 1024;
const ACCEPT_ATTR = ".png,.jpg,.jpeg,.webp,.pdf,.docx,.txt,.md";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result ?? "");
      const commaIndex = raw.indexOf(",");
      resolve(commaIndex >= 0 ? raw.slice(commaIndex + 1) : raw);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function inferMimeTypeFromName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".md")) return "text/markdown";
  return "application/octet-stream";
}

function normalizeMimeType(file: File): string {
  const explicit = file.type?.toLowerCase().trim();
  if (!explicit || explicit === "application/octet-stream") {
    return inferMimeTypeFromName(file.name);
  }
  if (explicit === "image/jpg") return "image/jpeg";
  return explicit;
}

function maxBytesForMimeType(mimeType: string): number {
  return mimeType.startsWith("image/") ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
}

function validateFile(file: File): { valid: true } | { valid: false; reason: string } {
  const mimeType = normalizeMimeType(file);
  const allowed = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
  ]);

  if (!allowed.has(mimeType)) {
    return { valid: false, reason: `${file.name}: unsupported file type.` };
  }

  const maxBytes = maxBytesForMimeType(mimeType);
  if (file.size > maxBytes) {
    return {
      valid: false,
      reason: `${file.name}: file too large (max ${formatBytes(maxBytes)}).`,
    };
  }

  return { valid: true };
}

function formatParserMode(mode: EvidenceSummary["parserMode"]): string {
  switch (mode) {
    case "image_ocr":
      return "image OCR";
    case "docx_text":
      return "DOCX text";
    case "pdf_text":
      return "PDF text";
    case "metadata_fallback":
    default:
      return "metadata fallback";
  }
}

export function EvidencePanel() {
  const activeTabId = useActiveTabId();
  const { session, ensureFreshSession } = useActiveSession();
  const [pendingFiles, setPendingFiles] = useState<PendingEvidenceFile[]>([]);
  const [pendingEvidence, setPendingEvidence] = useState<PendingEvidenceState[]>([]);
  const [uploaded, setUploaded] = useState<EvidenceSummary[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const workspaceKeyRef = useRef<string | null>(null);

  const totalCount =
    pendingFiles.length +
    pendingEvidence.filter((item) => item.state !== "failed").length +
    uploaded.length;
  const canAddMoreFiles = totalCount < MAX_FILES_PER_GENERATION;
  const pendingSizeTotal = useMemo(
    () => pendingFiles.reduce((sum, item) => sum + item.file.size, 0),
    [pendingFiles]
  );
  const hasFailedPendingEvidence = pendingEvidence.some((item) => item.state === "failed");

  useEffect(() => {
    let mounted = true;
    let refreshToken = 0;

    async function hydrateForTab(tabId: number | null, workspaceKey: string | null) {
      const token = ++refreshToken;

      if (tabId === null || !workspaceKey) {
        if (!mounted) return;
        workspaceKeyRef.current = null;
        setPendingFiles([]);
        setPendingEvidence([]);
        setUploaded([]);
        setError(null);
        setMessage(null);
        return;
      }

      try {
        const nextWorkspaceKey = workspaceKey;
        const previousWorkspaceKey = workspaceKeyRef.current;
        workspaceKeyRef.current = nextWorkspaceKey;

        const evidenceResponse = await sendRuntimeMessage<EvidenceRuntimeResponse>({
          type: "GET_EVIDENCE",
          payload: { workspaceKey: nextWorkspaceKey, tabId },
        });
        if (!mounted || token !== refreshToken) return;

        if (previousWorkspaceKey !== nextWorkspaceKey) {
          setPendingFiles([]);
          setPendingEvidence([]);
          setError(null);
          setMessage(null);
        }

        setUploaded(Array.isArray(evidenceResponse?.evidence) ? evidenceResponse.evidence : []);
        setPendingEvidence(
          Array.isArray(evidenceResponse?.pendingEvidence)
            ? evidenceResponse.pendingEvidence
            : []
        );
      } catch (runtimeError) {
        if (!mounted || token !== refreshToken) return;
        setError(
          runtimeError instanceof Error
            ? runtimeError.message
            : "Failed to load evidence state."
        );
      }
    }

    void hydrateForTab(activeTabId, session?.snapshot?.workspaceKey ?? null);

    const listener = (msg: RuntimeMessage) => {
      if (
        msg.type === "EVIDENCE_UPDATED" &&
        typeof msg.payload?.tabId === "number" &&
        msg.payload.tabId === activeTabId &&
        msg.payload.workspaceKey === workspaceKeyRef.current
      ) {
        setUploaded(Array.isArray(msg.payload.evidence) ? msg.payload.evidence : []);
        return;
      }

      if (
        msg.type === "EVIDENCE_STATUS_UPDATED" &&
        typeof msg.payload?.tabId === "number" &&
        msg.payload.tabId === activeTabId &&
        msg.payload.workspaceKey === workspaceKeyRef.current
      ) {
        setPendingEvidence(
          Array.isArray(msg.payload.pendingEvidence) ? msg.payload.pendingEvidence : []
        );
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      mounted = false;
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [activeTabId, session?.sessionId, session?.snapshot?.workspaceKey]);

  const onFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    const remaining =
      MAX_FILES_PER_GENERATION -
      (pendingFiles.length +
        pendingEvidence.filter((item) => item.state !== "failed").length +
        uploaded.length);
    if (remaining <= 0) {
      setError(`You can attach up to ${MAX_FILES_PER_GENERATION} files per generation.`);
      event.target.value = "";
      return;
    }

    const next: PendingEvidenceFile[] = [];
    const validationErrors: string[] = [];

    for (const [index, file] of files.slice(0, remaining).entries()) {
      const validation = validateFile(file);
      if (!validation.valid) {
        validationErrors.push(validation.reason);
        continue;
      }

      next.push({
        localId: `${Date.now()}-${index}-${file.name}`,
        file,
        mode: "context_only",
        mentionInReply: false,
      });
    }

    const nextTotalBytes =
      pendingSizeTotal + next.reduce((sum, item) => sum + item.file.size, 0);
    if (nextTotalBytes > MAX_TOTAL_BYTES) {
      setError(`Combined evidence size exceeds ${formatBytes(MAX_TOTAL_BYTES)}.`);
      event.target.value = "";
      return;
    }

    setPendingFiles((prev) => [...prev, ...next]);
    setMessage(
      files.length > remaining ? `Added up to ${remaining} file(s).` : `${next.length} file(s) added.`
    );
    setError(validationErrors.length > 0 ? validationErrors.join(" ") : null);
    event.target.value = "";
  };


  const removePending = (localId: string) => {
    setPendingFiles((prev) => prev.filter((item) => item.localId !== localId));
  };

  const removeUploaded = (evidenceId: string) => {
    const workspaceKey = workspaceKeyRef.current;
    if (!workspaceKey) return;

    chrome.runtime.sendMessage(
      {
        type: "REMOVE_EVIDENCE",
        payload: {
          tabId: activeTabId,
          workspaceKey,
          evidenceId,
        },
      },
      (res) => {
        if (chrome.runtime.lastError) {
          setError(chrome.runtime.lastError.message || "Failed to remove evidence.");
          return;
        }

        if (!res?.ok) {
          setError(res?.error || "Failed to remove evidence.");
          return;
        }

        setUploaded(Array.isArray(res.evidence) ? res.evidence : []);
        setMessage("Evidence removed.");
      }
    );
  };

  const uploadPending = async () => {
    if (pendingFiles.length === 0) return;

    const freshSession = await ensureFreshSession("evidence");
    if (!freshSession?.sessionId) {
      setError(NO_COMPOSER_MESSAGE);
      setMessage(null);
      return;
    }

    setUploading(true);
    setError(null);
    setMessage("Uploading and processing evidence...");

    try {
      const items = await Promise.all(
        pendingFiles.map(async (item) => ({
          localId: item.localId,
          name: item.file.name,
          mimeType: normalizeMimeType(item.file),
          sizeBytes: item.file.size,
          mode: item.mode,
          mentionInReply: item.mentionInReply,
          dataBase64: await fileToBase64(item.file),
        }))
      );

      chrome.runtime.sendMessage(
        {
          type: "EVIDENCE_INGEST",
          payload: {
            sessionId: freshSession.sessionId,
            items,
          },
        },
        (res) => {
          setUploading(false);

          if (chrome.runtime.lastError) {
            setError(chrome.runtime.lastError.message || "Evidence upload failed.");
            return;
          }

          if (!res?.success) {
            setError(res?.error || "Evidence upload failed.");
            return;
          }

          setPendingFiles([]);
          setMessage("Evidence queued for processing.");
        }
      );
    } catch (err) {
      setUploading(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-app-textSecondary uppercase tracking-wider">Evidence</h2>
        <span className="text-[10px] text-app-textSecondary bg-app-panel px-2 py-0.5 rounded border border-app-border">
          {totalCount} / {MAX_FILES_PER_GENERATION}
        </span>
      </div>

      <div className="bg-app-panel border border-app-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-app-success/10 rounded-full flex items-center justify-center border border-app-success/30">
              <i className="ph ph-file-plus text-xl text-app-success"></i>
            </div>
            <div>
              <div className="text-sm font-medium text-white">Context Files</div>
              <div className="text-[10px] text-app-textSecondary uppercase tracking-wider">
                {uploaded.length} Active · {pendingEvidence.length} pending
              </div>
            </div>
          </div>
          <button 
            className="w-8 h-8 rounded-full border border-app-border flex items-center justify-center text-app-textSecondary hover:text-white transition-colors disabled:opacity-30"
            onClick={() => inputRef.current?.click()}
            disabled={!session?.sessionId || !canAddMoreFiles || uploading}
            title="Add context files"
          >
            <i className="ph ph-plus"></i>
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          multiple
          onChange={onFilesSelected}
          className="hidden"
        />

        {/* Selected Files (Not yet uploaded) */}
        {pendingFiles.length > 0 && (
          <div className="mb-4 space-y-2">
            <div className="text-[10px] text-app-textSecondary uppercase tracking-tighter mb-2 font-bold px-1">Selected to Upload</div>
            {pendingFiles.map((item) => (
              <div key={item.localId} className="p-3 bg-app-bg/50 border border-app-accent/30 rounded-lg flex items-center justify-between group">
                <div className="flex items-center space-x-3 overflow-hidden">
                  <i className="ph ph-file-text text-app-accent text-lg"></i>
                  <div className="overflow-hidden">
                    <div className="text-xs text-white font-medium truncate">{item.file.name}</div>
                    <div className="text-[10px] text-app-textSecondary">{formatBytes(item.file.size)}</div>
                  </div>
                </div>
                <button 
                  onClick={() => removePending(item.localId)}
                  className="text-app-textSecondary hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <i className="ph ph-trash"></i>
                </button>
              </div>
            ))}
            <button 
              className="w-full mt-2 py-2 bg-app-accent text-white rounded-lg text-xs font-bold shadow-glow hover:opacity-90 transition-all"
              onClick={uploadPending}
              disabled={uploading}
            >
              {uploading ? "Ingesting..." : `Upload ${pendingFiles.length} File(s)`}
            </button>
          </div>
        )}

        {/* Processing/Uploaded Files */}
        <div className="space-y-3">
          {pendingEvidence.map((item) => (
             <div key={`proc-${item.localId}`} className="flex items-center justify-between p-2 bg-[#1d1d2b] border border-app-warning/20 rounded-lg">
               <div className="flex items-center space-x-2 overflow-hidden">
                 <div className="w-6 h-6 rounded bg-app-warning/10 flex items-center justify-center">
                    <i className="ph ph-spinner animate-spin text-app-warning text-xs"></i>
                 </div>
                 <span className="text-[11px] text-app-textSecondary truncate">{item.name}</span>
               </div>
               <span className="text-[9px] uppercase font-bold text-app-warning bg-app-warning/10 px-1.5 py-0.5 rounded leading-none shrink-0">Processing</span>
             </div>
          ))}

          {uploaded.map((item) => (
            <div key={item.evidenceId} className="flex items-start justify-between p-3 bg-app-panel border border-app-border rounded-lg hover:border-app-accent/30 transition-colors group">
              <div className="flex items-start space-x-3 overflow-hidden">
                <div className={`mt-0.5 p-1.5 rounded ${
                  item.name.toLowerCase().match(/\.(png|jpg|jpeg|webp)$/) ? "bg-blue-500/10 text-blue-400" : "bg-app-success/10 text-app-success"
                }`}>
                  <i className={`ph ${item.name.toLowerCase().match(/\.(png|jpg|jpeg|webp)$/) ? "ph-image" : "ph-file-text"} text-base`}></i>
                </div>
                <div className="overflow-hidden">
                  <div className="text-xs font-medium text-white truncate leading-tight mb-1">{item.name}</div>
                  <div className="flex items-center space-x-2 text-[9px] text-app-textSecondary uppercase tracking-tighter font-bold">
                    <span>{formatParserMode(item.parserMode)}</span>
                    <span>·</span>
                    <span>{item.extractedTextChars || 0} Chars</span>
                  </div>
                </div>
              </div>
              <button 
                onClick={() => removeUploaded(item.evidenceId)}
                className="ml-2 p-1 text-app-textSecondary hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
              >
                <i className="ph ph-trash-simple"></i>
              </button>
            </div>
          ))}
        </div>

        {!session?.sessionId && (
           <div className="mt-4 p-3 bg-app-bg/50 border border-dashed border-app-border rounded-lg text-center">
             <p className="text-[11px] text-app-textSecondary italic">Focus a composer to add evidence</p>
           </div>
        )}

        {uploaded.length === 0 && pendingFiles.length === 0 && pendingEvidence.length === 0 && session?.sessionId && (
           <div className="mt-4 p-4 border-2 border-dashed border-app-border rounded-xl flex flex-col items-center justify-center space-y-2 opacity-50">
             <i className="ph ph-cloud-arrow-up text-2xl"></i>
             <div className="text-[10px] uppercase font-bold tracking-widest">Drop Files Here</div>
           </div>
        )}
      </div>

      {(error || message || hasFailedPendingEvidence) && (
        <div className="mt-3">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-xs space-y-3">
              <div className="flex items-start space-x-2">
                <i className="ph ph-warning-circle text-lg mt-0.5"></i>
                <span>{error}</span>
              </div>
            </div>
          )}
          {message && !error && (
            <div className="p-3 bg-app-accent/10 border border-app-accent/30 rounded-lg text-app-accent text-xs flex items-start space-x-2">
              <i className="ph ph-info text-lg mt-0.5"></i>
              <span>{message}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
