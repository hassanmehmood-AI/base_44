/** Shared attachment constraints — the SAME rules apply client-side (the
 * composer's file picker, for instant feedback) and server-side (the real
 * enforcement; the client-side check is a UX nicety, never trusted alone).
 * V1 scope is deliberately narrow per the approved plan: exactly these five
 * formats, nothing else accepted yet. */

export const ALLOWED_ATTACHMENT_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "image/jpeg": "JPG",
  "image/png": "PNG",
};

/** Per-file cap. Gmail's own practical ceiling for a direct (non-resumable)
 * attachment send is ~25MB total message size including base64 overhead
 * (~33% larger than the raw bytes) — 20MB per file keeps a single-attachment
 * send comfortably under that even accounting for the encoding overhead and
 * the message's own headers/body. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Total across every attachment on one outbound message — the actual
 * Gmail-imposed ceiling this is protecting against. */
export const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export type AttachmentValidationError = "TYPE_NOT_ALLOWED" | "TOO_LARGE";

/** The shape persisted in messages.metadata.attachments (jsonb) — `key` is
 * the storage object key (see emailAttachmentStorage.ts's
 * buildAttachmentKey), never exposed directly to the browser; the frontend
 * only ever sees a download URL built from the message id + an index into
 * this array, resolved server-side by the authenticated serving route. */
export type StoredEmailAttachment = { filename: string; mimeType: string; size: number; key: string };

export function validateAttachmentType(mimeType: string): boolean {
  return mimeType in ALLOWED_ATTACHMENT_TYPES;
}

export function validateAttachmentSize(sizeBytes: number): boolean {
  return sizeBytes > 0 && sizeBytes <= MAX_ATTACHMENT_BYTES;
}

/** Validates one candidate attachment against both rules at once — used
 * identically by the composer's immediate per-file feedback and the
 * server action's real enforcement, so neither side can silently diverge
 * from the other about what's actually allowed. */
export function validateAttachment(mimeType: string, sizeBytes: number): AttachmentValidationError | null {
  if (!validateAttachmentType(mimeType)) return "TYPE_NOT_ALLOWED";
  if (!validateAttachmentSize(sizeBytes)) return "TOO_LARGE";
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
