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
  // everything except static assets, image optimization, and the auth API routes themselves
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
