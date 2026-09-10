---
name: bump-sw-do-gerador
enabled: true
event: file
action: warn
conditions:
  - field: file_path
    operator: regex_match
    pattern: gerador.index\.html
---

**O /gerador é PWA — o sw.js precisa subir junto.**

Você mexeu no `index.html` do /gerador. No MESMO commit:
- bump do `vNN` em `dashboard/public/gerador/sw.js`

Sem o bump o app não recarrega sozinho: o consultor continua vendo a versão
velha e ninguém percebe. (Existe botão Atualizar, mas ninguém clica.)
