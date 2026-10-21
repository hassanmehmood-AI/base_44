// Deliberately NOT "use client" and zero framework/DB imports — these are
// plain, pure functions callable from both the server-side ingestion
// pipeline (whatsapp.ts, deciding how to store a conversation's identity)
// and the client-side WhatsApp UI (WhatsAppClient.tsx, deciding how to
// render it). Same "no directive on a shared pure-logic module" lesson
// already applied to the Social Media/WhatsApp refresh-persistence fixes.
//
// Per the explicit requirement: conversations are classified by their
// WhatsApp JID (externalThreadId) suffix ONLY — never by display name.
// Two names coincidentally matching (e.g. two different "Itzaz khalid"
// threads — one a 1-on-1, several WhatsApp Groups where he's a member)
// must never be treated as "the same conversation" or collapsed/merged;
// this module's whole purpose is telling them apart reliably.

/** Confirmed directly against this CRM's own live production data (not
 * just Whapi's docs): every observed group chat_id ends in "@g.us"
 * (example seen live: "120363426877091849@g.us"), every observed personal
 * chat_id ends in "@s.whatsapp.net" (example seen live:
 * "923244373788@s.whatsapp.net"). "@c.us" is also accepted defensively —
 * Whapi's own docs reference it as an alternate personal-chat suffix in
 * some contexts, even though it wasn't the one actually observed live here. */
const GROUP_JID_SUFFIX = "@g.us";
const PERSONAL_JID_SUFFIXES = ["@s.whatsapp.net", "@c.us"];

export function isGroupJid(jid: string | null | undefined): boolean {
  return Boolean(jid?.endsWith(GROUP_JID_SUFFIX));
}

export function isPersonalJid(jid: string | null | undefined): boolean {
  if (!jid) return false;
  return PERSONAL_JID_SUFFIXES.some((suffix) => jid.endsWith(suffix));
}

/** The digits-only phone number for a personal chat's JID, for display
 * (e.g. "Haider · +923027542809"). Returns null for anything that isn't a
 * recognized personal JID shape (a group, or a malformed/unexpected
 * value) — callers must treat null as "don't show a phone number" rather
 * than guessing or stripping an arbitrary suffix off a group id. */
export function extractPersonalPhoneNumber(jid: string | null | undefined): string | null {
  if (!jid) return null;
  for (const suffix of PERSONAL_JID_SUFFIXES) {
    if (jid.endsWith(suffix)) {
      const digits = jid.slice(0, -suffix.length);
      return /^\d+$/.test(digits) ? digits : null;
    }
  }
  return null;
}

export type WhatsappConversationDisplay = {
  name: string;
  isGroup: boolean;
  /** Only ever populated for a genuinely personal chat — null for a group
   * (there is no single "the group's phone number") and null for a
   * personal chat whose JID doesn't parse as a phone number for any reason. */
  phoneNumber: string | null;
};

/** The single source of truth every WhatsApp UI location (inbox list,
 * Pipeline card, chat header) calls, so the three can never silently drift
 * out of sync with each other. Classification is derived ONLY from
 * `externalThreadId`'s JID shape — never from `subject`/`contactName` —
 * per the explicit requirement: a group and a personal chat can carry the
 * exact same display name (confirmed live in this CRM's own data) and must
 * still be told apart correctly regardless.
 *
 * `name` prefers contactName (a human-linked CRM contact, when one exists)
 * over `subject` (what the ingestion pipeline resolved — see
 * resolveInitialConversationSubject/maybeEnrichConversationIdentity in
 * services/whatsapp.ts), over the appropriate fallback for that
 * conversation's type — this is what stops a still-resolving group (one
 * whose real name hasn't been fetched yet) from ever displaying a
 * person's name as if it were the group's, satisfying the explicit "avoid
 * displaying a customer's name as a group name" requirement: a group with
 * no resolved name yet shows `fallbackGroupName`, never `subject` from
 * some unrelated personal conversation and never a blank/guessed value. */
export function resolveConversationDisplay(
  conversation: { contactName: string | null; subject: string | null; externalThreadId: string | null },
  fallbacks: { personal: string; group: string }
): WhatsappConversationDisplay {
  const isGroup = isGroupJid(conversation.externalThreadId);
  const name = conversation.contactName ?? conversation.subject ?? (isGroup ? fallbacks.group : fallbacks.personal);
  const phoneNumber = isGroup ? null : extractPersonalPhoneNumber(conversation.externalThreadId);
  return { name, isGroup, phoneNumber };
}
