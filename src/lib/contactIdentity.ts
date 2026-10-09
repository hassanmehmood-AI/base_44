/** Compact "Company · Business" secondary line for a contact row — omits
 * whichever half is missing (businessName is optional free text; companyName
 * is always present) rather than leaving a dangling separator. Company here
 * is the tenant company a contact belongs to (contacts.companyId); business
 * is the contact's own business (contacts.businessName, free text) — two
 * unrelated concepts that both help identify who a contact actually is. */
export function contactSecondaryLine(companyName: string, businessName: string | null): string {
  return [companyName, businessName?.trim() || null].filter((v): v is string => !!v).join(" · ");
}

/** Short id-based suffix for contacts that are still indistinguishable after
 * every other already-displayed field is shown — e.g. two same-named
 * contacts at the same company with the same business and the same email.
 * Only returns a suffix for ids actually involved in a collision; an
 * unambiguous contact gets nothing (no suffix noise for the common case).
 * `extraFields` should mirror whatever else the caller already renders for
 * each item (email, business name, etc.) so the key reflects what the user
 * can actually see on screen. */
export function disambiguationSuffixes<T extends { id: string }>(
  items: T[],
  extraFields: (item: T) => (string | null)[]
): Map<string, string> {
  const keyOf = (item: T) => JSON.stringify(extraFields(item));
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const suffixes = new Map<string, string>();
  for (const item of items) {
    if ((counts.get(keyOf(item)) ?? 0) > 1) {
      suffixes.set(item.id, `#${item.id.slice(0, 6)}`);
    }
  }
  return suffixes;
}
