import { readFileSync } from "node:fs";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Arquivos que já passavam de 350 linhas antes da trava. Não acrescente arquivo novo
// na lista: divida o arquivo.
const baseline = JSON.parse(
  readFileSync(new URL("./eslint-max-lines-baseline.json", import.meta.url), "utf8"),
);
// Caminho vira padrão de glob: `[slug]`, `(grupo)` e afins precisam de barra para valer como texto.
const arquivosBaseline = baseline.files.map((f) => f.replace(/[()[\]{}!*?]/g, "\\$&"));

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Os scripts de build de landing e de capa rodam só no Node, em CommonJS, e nunca entram no app.
  // O require() deles é o jeito certo. A regra continua valendo no resto do projeto.
  {
    files: ["scripts/**/*.{js,cjs}"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Trava de tamanho: arquivo novo acima de 350 linhas falha o lint.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: { "max-lines": ["error", { max: 350 }] },
  },
  {
    files: ["src/**/__tests__/**", "src/**/*.test.{ts,tsx}", "src/**/*.spec.{ts,tsx}"],
    rules: { "max-lines": "off" },
  },
  // ESLint recusa `files` vazio, então a lista só entra quando tem arquivo.
  ...(arquivosBaseline.length
    ? [{ files: arquivosBaseline, rules: { "max-lines": "off" } }]
    : []),
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
