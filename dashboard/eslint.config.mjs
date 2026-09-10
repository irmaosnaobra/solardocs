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
    // `.next/**` ancora na raiz do config (dashboard/), entao NAO pegava
    // `dashboard/src/.next/` — 30 MB de build de 07/08 que alguem gerou rodando
    // next de dentro de src/. Resultado: 98,1% dos 10.792 problemas do lint eram
    // chunk minificado, e o numero real (206, em 77 arquivos) ficava enterrado.
    // O `**/` na frente e o que torna o ignore independente de onde o build caiu.
    "**/.next/**",
    "**/out/**",
    "**/dist/**",
    "**/coverage/**",
    // HTML monolitico de public/ nao passa por aqui (o ESLint nao le .html), mas
    // ha .js solto servido estatico que tambem nao e codigo de app.
    "public/**",
  ]),
]);

export default eslintConfig;
