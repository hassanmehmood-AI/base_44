import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Next.js 16 renamed `middleware.ts` -> `proxy.ts` (file convention only, same runtime behavior).
export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname.startsWith("/login");

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/crm", req.nextUrl));
  }
});

export const config = {
  // everything except static assets (by extension, so anything under /public is
  // covered, not just the ones we happen to name here), image optimization, the
  // auth API routes themselves, inbound provider webhooks (api/webhooks/* —
  // e.g. Meta — which authenticate via their own signature, not a user
  // session), and scheduled sync endpoints (api/cron/* — e.g. the Metricool
  // poll sync, called by an external scheduler, not a browser; authenticates
  // via its own CRON_SECRET check) — a logged-out redirect would otherwise
  // break all of these
  matcher: [
    "/((?!api/auth|api/webhooks|api/cron|_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|css|txt|xml|json|woff|woff2)$).*)",
  ],
};
