/** Contact-scoped unsent-work drafts (Email Composer, CRM Classification
 * panel). Browser-local by design: this is the same storage tier
 * CompanyContext/ThemeContext already use for per-session UI state (see
 * STORAGE_KEY in context/CompanyContext.tsx), and these drafts never get
 * sent anywhere until the user explicitly saves/sends — there's no new
 * server surface or database change needed to protect them.
 *
 * Every key is scoped by acting user + company + contact + composer type, so
 * a draft can never surface for the wrong user, company, or contact — even a
 * future key-format bug can't cross-contaminate, since loadDraft() also
 * checks the envelope's own contactId/companyId against what was asked for. */

export type DraftType = "email" | "classify";

interface DraftEnvelope<T> {
  contactId: string;
  companyId: string;
  savedAt: number;
  data: T;
}

function draftKey(type: DraftType, userId: string, companyId: string, contactId: string): string {
  return `crm-draft:${type}:${userId}:${companyId}:${contactId}`;
}

export function loadDraft<T>(type: DraftType, userId: string, companyId: string, contactId: string): T | null {
  try {
    const raw = localStorage.getItem(draftKey(type, userId, companyId, contactId));
    if (!raw) return null;
    const envelope = JSON.parse(raw) as DraftEnvelope<T>;
    if (envelope.contactId !== contactId || envelope.companyId !== companyId) return null;
    return envelope.data;
  } catch {
    return null;
  }
}

/** Returns false when the write failed (storage quota, private browsing,
 * etc.) so the caller can surface a clear warning instead of assuming the
 * draft is safely preserved. */
export function saveDraft<T>(type: DraftType, userId: string, companyId: string, contactId: string, data: T): boolean {
  try {
    const envelope: DraftEnvelope<T> = { contactId, companyId, savedAt: Date.now(), data };
    localStorage.setItem(draftKey(type, userId, companyId, contactId), JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(type: DraftType, userId: string, companyId: string, contactId: string): void {
  try {
    localStorage.removeItem(draftKey(type, userId, companyId, contactId));
  } catch {
    // nothing to clean up if storage isn't available
  }
}

/** Removes every draft belonging to one user — called on sign-out so drafts
 * don't linger in localStorage for the next person to use this browser. */
export function clearAllDraftsForUser(userId: string): void {
  try {
    const prefix = "crm-draft:";
    const marker = `:${userId}:`;
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix) && key.includes(marker)) toRemove.push(key);
    }
    toRemove.forEach((key) => localStorage.removeItem(key));
  } catch {
    // ignore — best-effort cleanup only
  }
}
