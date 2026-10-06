import { defineConfig, globalIgnores } from "eslint/config";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([
  ...nextTs,
  globalIgnores(["android/**", "dist/**", ".expo/**", "node_modules/**"]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);
