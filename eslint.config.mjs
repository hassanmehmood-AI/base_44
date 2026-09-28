import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Tenant-scoped DB access must go through src/server/{repositories,services} —
    // pages, components, and route handlers may not import Drizzle directly.
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}", "src/context/**/*.{ts,tsx}"],
    ignores: ["src/app/api/auth/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/db", "@/db/*"],
              message: "Query the database through src/server/repositories or src/server/services, not directly.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
