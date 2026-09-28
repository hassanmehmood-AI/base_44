import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import * as usersRepo from "@/server/repositories/users";
import * as accessRepo from "@/server/repositories/access";

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
  ],
  callbacks: {
    async jwt({ token, user }) {
      // `user` is only present right after a successful authorize() call (sign-in).
      // Company/module access is cached in the token for the life of the session —
      // a permission change made after sign-in won't take effect until the next login.
      if (user) {
        token.id = user.id;
        token.roleKey = user.roleKey;
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
      return session;
    },
  },
});
