// Página que o cliente vê ao abrir uma proposta rastreada depois da validade.
// Só HTML e contas: sem banco, sem rede. O HTML antigo da proposta NUNCA sai depois do vencimento.

export interface DadosVencida {
  empresaNome: string;
  logo?: string | null;        // data URL do cadastro (logo_base64)
  corMarca?: string | null;    // #rrggbb do cadastro
  vendedor: string;
  telefone?: string | null;    // qualquer formato; só os dígitos contam
  codigo?: string | null;
  vencidaEm: string;           // DD/MM/AAAA
}

const esc = (s: unknown): string => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function lum(r: number, g: number, b: number): number {
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Cor da empresa escurecida até dar contraste com texto branco. Só #rrggbb entra no CSS. */
export function corSegura(hex: unknown): string {
  const h = String(hex ?? '').trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(h)) return '#B45309';
  let r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
  let guard = 0;
  while (lum(r, g, b) > 0.18 && guard < 40) { r *= 0.9; g *= 0.9; b *= 0.9; guard++; }
  const x = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${x(r)}${x(g)}${x(b)}`;
}

/** Só dígitos, com 55 na frente. Devolve null quando não parece telefone brasileiro. */
export function telefoneWa(raw: unknown): string | null {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return /^55\d{10,11}$/.test(d) ? d : null;
}

export function paginaVencida(d: DadosVencida): string {
  const cor = corSegura(d.corMarca);
  const fone = telefoneWa(d.telefone);
  const nome = d.vendedor.trim() || d.empresaNome;
  const msg = `Olá, ${nome}! Abri a proposta${d.codigo ? ' ' + d.codigo : ''} e ela venceu. Pode me mandar atualizada?`;
  const logo = d.logo && /^data:image\/[a-z+.-]+;base64,[a-z0-9+/=]+$/i.test(d.logo)
    ? `<img class="logo" src="${d.logo}" alt="${esc(d.empresaNome)}"/>` : '';
  const botoes = fone
    ? `<a class="btn wa" href="https://wa.me/${fone}?text=${encodeURIComponent(msg)}">Chamar no WhatsApp</a>
<a class="btn tel" href="tel:+${fone}">Ligar</a>`
    : '';
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>Proposta vencida · ${esc(d.empresaNome)}</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,"Segoe UI",Roboto,sans-serif;background:#F8FAFC;color:#0F172A;min-height:100vh}
.topo{background:${cor};padding:28px 20px;text-align:center;color:#fff}
.logo{max-height:80px;max-width:260px;object-fit:contain;display:block;margin:0 auto 8px}
.emp{font-size:18px;font-weight:700;margin:0}
.card{max-width:460px;margin:28px auto;padding:28px 22px;background:#fff;border-radius:14px;box-shadow:0 2px 16px rgba(15,23,42,.08);text-align:center}
h1{font-size:22px;margin:0 0 12px}
p{font-size:16px;line-height:1.5;margin:0 0 12px;color:#334155}
.btn{display:block;margin:12px 0 0;padding:15px 18px;border-radius:10px;font-weight:700;font-size:16px;text-decoration:none;text-align:center}
.wa{background:#16A34A;color:#fff}
.tel{background:#fff;color:${cor};border:2px solid ${cor}}
</style></head><body>
<div class="topo">${logo}<p class="emp">${esc(d.empresaNome)}</p></div>
<div class="card">
<h1>Esta proposta venceu em ${esc(d.vencidaEm)}.</h1>
<p>Os valores podem ter mudado. Fale com ${esc(nome)} para receber a proposta atualizada.</p>
${botoes}
</div>
</body></html>`;
}
