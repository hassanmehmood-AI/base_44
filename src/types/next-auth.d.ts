import type { RoleKey } from "@/server/constants";

declare module "next-auth" {
  interface User {
    roleKey?: RoleKey;
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
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id?: string;
    roleKey?: RoleKey;
    companyIds?: string[];
    modules?: string[];
  }
}
