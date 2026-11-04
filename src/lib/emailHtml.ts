import DOMPurify, { type Config } from "isomorphic-dompurify";

/** Shared HTML sanitization for email content — "isomorphic" so the exact
 * same rules apply server-side (gmailSync.ts, before an inbound HTML email
 * is ever stored) and client-side (CorreoClient.tsx, as defense-in-depth
 * before dangerouslySetInnerHTML renders it) using the same library, not
 * two different sanitizers that could disagree.
 *
 * Deliberately strips ALL `<img>` tags rather than rewriting their `src` —
 * this blocks remote tracking images by default (an attacker/marketer
 * learning "this address opened the email, at this time, from this IP" the
 * moment any tag with a src loads) without needing a click-to-load proxy
 * layer, which is out of scope for this pass. `<script>`, every
 * `on*="..."` event-handler attribute, and `javascript:`/`data:` URLs are
 * stripped by DOMPurify's own defaults — this config only narrows those
 * defaults further (no images, no forms, no iframes/objects/embeds). */
const SANITIZE_CONFIG: Config = {
  ALLOWED_TAGS: [
    "a", "b", "strong", "i", "em", "u", "s", "br", "p", "div", "span",
    "ul", "ol", "li", "blockquote", "pre", "code",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "table", "thead", "tbody", "tr", "th", "td",
  ],
  ALLOWED_ATTR: ["href", "target", "rel", "class"],
  FORBID_TAGS: ["img", "script", "style", "iframe", "object", "embed", "form", "input", "button"],
  ALLOW_DATA_ATTR: false,
};

let hookInstalled = false;

/** Forces every surviving `<a>` to open safely in a new tab — an inbound
 * email's own target/rel attributes (if any) are never trusted; this
 * always overrides them. Prevents reverse-tabnabbing (a malicious page the
 * link opens gaining a `window.opener` reference back to the CRM tab) and
 * guarantees clicking an email link never navigates the CRM itself away.
 * Installed once (DOMPurify hooks are global to the shared instance, not
 * per-call) rather than on every sanitizeEmailHtml call. */
function installLinkSafetyHook(): void {
  if (hookInstalled) return;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
  hookInstalled = true;
}

/** Sanitizes raw inbound/outbound HTML email content down to a safe,
 * minimal allow-list — see SANITIZE_CONFIG. Returns an empty string for
 * empty/undefined input rather than throwing, since "no HTML content" is
 * a normal, expected case (a plain-text-only email), not an error. */
export function sanitizeEmailHtml(html: string | null | undefined): string {
  if (!html) return "";
  installLinkSafetyHook();
  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}
