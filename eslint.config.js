import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "node_modules/",
      "coverage/",
      ".playwright-cli/",
      "playwright-report/",
      "test-results/",
      "output/",
      "public/models/",
      "public/ort/",
      "*.tsbuildinfo",
    ],
  },
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "react-refresh/only-export-components": [
        "error",
        {
          allowConstantExport: true,
        },
      ],
    },
  },
  {
    files: [
      "eslint.config.js",
      "vite.config.ts",
      "playwright.config.ts",
      "tests/**/*.ts",
      "e2e/**/*.ts",
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.es2022,
        ...globals.serviceworker,
      },
    },
  },
);
