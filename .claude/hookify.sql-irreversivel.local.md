---
name: sql-irreversivel-em-producao
enabled: true
event: all
action: block
conditions:
  - field: query
    operator: regex_match
    pattern: \b(DROP\s+(TABLE|SCHEMA|DATABASE|COLUMN)|TRUNCATE\s+(TABLE\s+)?\w)
---

**Não existe banco de teste. Isto é produção.**

O Supabase aqui é um projeto só: não tem staging, não tem branch de banco. O que
este SQL apagar, apagou para todo mundo agora, inclusive para o consultor que
está com o app aberto.

`DROP` e `TRUNCATE` não têm volta pelo caminho normal. Antes de insistir:
- Confirmar com o Thiago que é para apagar mesmo.
- Se for limpeza de coluna, `ALTER TABLE ... DROP COLUMN` continua bloqueado de
  propósito: renomear para `_lixo_<coluna>` resolve e é reversível.
- Se for descartar linhas, `DELETE` com `WHERE` explícito passa normalmente.
- Guardar antes o que vai sumir (`SELECT` para um arquivo) custa um minuto.
