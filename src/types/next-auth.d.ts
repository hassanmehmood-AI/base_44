import type { RoleKey } from "@/server/constants";

declare module "next-auth" {
  interface User {
    roleKey?: RoleKey;
    // set only when this identity was reached via the "impersonate" provider —
    // the real Superuser's id/name who is currently acting as this user
    impersonatorId?: string;
    impersonatorName?: string;
  }
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      roleKey: RoleKey;
      // company ids the user is explicitly granted (ignored for SUPERUSER, which has implicit access to all)
      companyIds: string[];
      modules: string[];
      impersonatorId?: string;
      impersonatorName?: string;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id?: string;
    roleKey?: RoleKey;
    companyIds?: string[];
    modules?: string[];
    impersonatorId?: string;
    impersonatorName?: string;
  }
}
