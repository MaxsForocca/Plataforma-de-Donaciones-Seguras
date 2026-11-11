import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "**/dist-types/**",
    "**/build/**",
    "**/coverage/**",
    "**/.aws-sam/**",
    ".claude/**",
    ".opencode/**",
    ".specify/**",
    "_to_delete/**",
    "specs/**",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["frontend/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["backend/**/*.ts", "packages/**/*.ts", "scripts/**/*.{ts,mjs}", "*.js"],
    languageOptions: { globals: globals.node },
  },
  {
    // Constitución, principio II: Bootstrap y Next.js están prohibidos en cualquier forma.
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["bootstrap", "bootstrap/*", "react-bootstrap", "react-bootstrap/*"],
              message: "Bootstrap está prohibido por la constitución (principio II).",
            },
            {
              group: ["next", "next/*"],
              message: "Next.js está prohibido por la constitución (principio II).",
            },
          ],
        },
      ],
    },
  },
);
