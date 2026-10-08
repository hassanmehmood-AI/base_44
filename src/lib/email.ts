/** Minimal shape check — not meant to catch every RFC 5322 edge case, just
 * the obvious "not an email at all" inputs. Shared by the Email Composer's
 * client-side validation and the server action's re-check, so both sides
 * agree on exactly the same rule. */
export function isValidEmailFormat(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
