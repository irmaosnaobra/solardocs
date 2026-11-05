// O CPF do cliente PF sai na proposta dentro de <span class="dp">...</span>. O PDF autenticado leva o
// número inteiro; o link público (/p/:id) passa por aqui e mostra só os 6 dígitos do meio.
// CNPJ é dado público e não usa essa marca.

export function mascararCpfNoHtml(html: string): string {
  return html.replace(/<span class="dp">([^<]*)<\/span>/g, (_m, texto: string) => {
    const d = String(texto).replace(/\D/g, '');
    const mascara = d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : '***.***.***-**';
    return `<span class="dp">${mascara}</span>`;
  });
}
