import { NextRequest, NextResponse } from "next/server";
import * as emailOnboardingService from "@/server/services/emailOnboarding";

/** Google's redirect target after the user approves (or denies) consent —
 * registered as GOOGLE_REDIRECT_URI in Google Cloud Console. Always
 * redirects back to Configuración rather than returning JSON: this is a
 * top-level browser navigation Google itself initiates, not an API call
 * the CRM's own client code makes, so there is no fetch() caller to hand a
 * JSON response to. Result is communicated via query params the
 * Configuración page reads once (?gmail_connected=<address> or
 * ?gmail_error=<message>) — not yet implemented client-side in this phase,
 * same deferred-UI scope as the rest of this increment. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const googleError = searchParams.get("error");

  const redirectBase = new URL("/configuracion", request.url);

  if (googleError) {
    redirectBase.searchParams.set("gmail_error", googleError === "access_denied" ? "You declined access — the mailbox was not connected." : googleError);
    return NextResponse.redirect(redirectBase);
  }
  if (!code || !state) {
    redirectBase.searchParams.set("gmail_error", "Missing authorization code from Google.");
    return NextResponse.redirect(redirectBase);
  }

  const result = await emailOnboardingService.handleOAuthCallback(code, state);
  if (!result.ok) {
    redirectBase.searchParams.set("gmail_error", result.message);
    return NextResponse.redirect(redirectBase);
  }

  redirectBase.searchParams.set("gmail_connected", result.emailAddress);
  return NextResponse.redirect(redirectBase);
}
