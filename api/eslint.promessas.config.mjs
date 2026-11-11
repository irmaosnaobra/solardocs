// Só para medir (npm run lint:promessas). NÃO entra no CI.
import tseslint from "typescript-eslint";

export default [
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"] },
  {
    files: ["src/**/*.ts"],
    ignores: ["src/**/__tests__/**", "src/**/*.test.ts", "src/**/*.spec.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: { "@typescript-eslint/no-floating-promises": "error" },
  },
];
