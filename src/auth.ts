import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import * as usersRepo from "@/server/repositories/users";
import * as accessRepo from "@/server/repositories/access";
import { verifyImpersonationTicket } from "@/server/services/impersonationTicket";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  // required for self-hosted deployments (Railway) — Next.js's default host-trust
  // check assumes Vercel-style infra and rejects the request otherwise.
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = typeof credentials?.email === "string" ? credentials.email : undefined;
        const password = typeof credentials?.password === "string" ? credentials.password : undefined;
        if (!email || !password) return null;

        const user = await usersRepo.findByEmail(email);
        if (!user || !user.isActive || !user.passwordHash) return null;

        const valid = await compare(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, name: user.fullName, email: user.email, roleKey: user.roleKey };
      },
    }),
    // "Switch user" (Superuser-only impersonation). Never trusts the client-submitted
    // identity directly — the ticket is minted server-side by startImpersonationAction/
    // stopImpersonationAction only after those already verified the caller's real
    // session via auth(), so authorize() here just needs to check the ticket's
    // signature and 15s expiry (see impersonationTicket.ts for why this shape).
    Credentials({
      id: "impersonate",
      credentials: { ticket: { label: "Ticket", type: "text" } },
      authorize: async (credentials) => {
        const ticket = typeof credentials?.ticket === "string" ? credentials.ticket : undefined;
        if (!ticket) return null;
        const payload = verifyImpersonationTicket(ticket);
        if (!payload) return null;

        if (payload.mode === "start") {
          if (!payload.targetId) return null;
          const issuer = await usersRepo.findById(payload.issuerId);
          if (!issuer || !issuer.isActive || issuer.roleKey !== "SUPERUSER") return null;
          const target = await usersRepo.findById(payload.targetId);
          if (!target || !target.isActive || target.roleKey === "SUPERUSER") return null;
          return {
            id: target.id,
            name: target.fullName,
            email: target.email,
            roleKey: target.roleKey,
            impersonatorId: issuer.id,
            impersonatorName: issuer.fullName,
          };
        }

        // mode === "stop": issuerId here is the ORIGINAL superuser to return to
        const original = await usersRepo.findById(payload.issuerId);
        if (!original || !original.isActive) return null;
        return { id: original.id, name: original.fullName, email: original.email, roleKey: original.roleKey };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // `user` is only present right after a successful authorize() call (sign-in,
      // or a switch-user/return-to-self via the "impersonate" provider). Company/
      // module access is cached in the token for the life of the session.
      if (user) {
        token.id = user.id;
        token.roleKey = user.roleKey;
        // Explicit assignment (not a conditional spread) so returning to self
        // — where user.impersonatorId is undefined — actually clears these
        // fields from the token instead of leaving the old value behind.
        token.impersonatorId = user.impersonatorId;
        token.impersonatorName = user.impersonatorName;
        const [companyIds, modules] = await Promise.all([
          accessRepo.findCompanyIdsForUser(user.id!),
          accessRepo.findModulesForUser(user.id!),
        ]);
        token.companyIds = companyIds;
        token.modules = modules;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id!;
      session.user.roleKey = token.roleKey!;
      session.user.companyIds = token.companyIds ?? [];
      session.user.modules = token.modules ?? [];
      session.user.impersonatorId = token.impersonatorId;
      session.user.impersonatorName = token.impersonatorName;
      return session;
    },
  },
});
