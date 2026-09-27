import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app/**"],
              message:
                "Feature modules must not depend on route-layer implementation details.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/features/**/server/**/*.{ts,tsx}",
      "src/features/**/actions.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app/**"],
              message:
                "Feature modules must not depend on route-layer implementation details.",
            },
            {
              group: ["@/components/**"],
              message:
                "Feature server modules must depend on domain types, not UI components.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/components/**/*.{ts,tsx}",
      "src/features/**/client/**/*.{ts,tsx}",
      "src/features/**/components/**/*.{ts,tsx}",
      "src/app/**/_components/**/*.{ts,tsx}",
      "src/app/**/_hooks/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app/**"],
              message:
                "Shared and feature UI must not depend on route-layer implementation details.",
            },
            {
              group: ["@/features/**/server/**"],
              message:
                "Client-capable modules must not import server-only feature code.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
