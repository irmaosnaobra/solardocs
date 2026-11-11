import { readFileSync } from "node:fs";
import tseslint from "typescript-eslint";

// Arquivos que já passavam de 350 linhas antes da trava. Não acrescente arquivo novo
// na lista: divida o arquivo.
const baseline = JSON.parse(
  readFileSync(new URL("./eslint-max-lines-baseline.json", import.meta.url), "utf8"),
);
// Caminho vira padrão de glob: `[slug]`, `(grupo)` e afins precisam de barra para valer como texto.
const arquivosBaseline = baseline.files.map((f) => f.replace(/[()[\]{}!*?]/g, "\\$&"));

export default [
  // Só `src/` é lintado. O resto (dist, scripts, config) fica de fora.
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "*", "!src"],
  },
  {
    files: ["src/**/*.ts"],
    // Com quase nenhuma regra ligada, todo `eslint-disable` antigo pareceria "sem uso".
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions: { parser: tseslint.parser },
    // Só registra o plugin, sem ligar regra nenhuma: o código tem comentários
    // `eslint-disable @typescript-eslint/...` e, sem o plugin carregado, o ESLint
    // reclama de regra desconhecida.
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "max-lines": ["error", { max: 350 }],
    },
  },
  {
    files: ["src/**/__tests__/**", "src/**/*.test.ts", "src/**/*.spec.ts"],
    rules: { "max-lines": "off" },
  },
  // ESLint recusa `files` vazio, então a lista só entra quando tem arquivo.
  ...(arquivosBaseline.length
    ? [{ files: arquivosBaseline, rules: { "max-lines": "off" } }]
    : []),
];
