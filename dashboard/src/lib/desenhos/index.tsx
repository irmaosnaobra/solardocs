/**
 * DESENHOS — a base compartilhada
 *
 * Os jogos de ícones das ferramentas (Kit Off-Grid, Inventário) nascem daqui:
 * a mesma moldura (viewBox, espessura, ponta arredondada) e os glifos que mais
 * de uma ferramenta usa. Ar-condicionado, notebook, impressora e furadeira
 * aparecem no catálogo do off-grid E no do inventário — desenhar duas vezes
 * daria dois desenhos ligeiramente diferentes do mesmo objeto, que é pior que
 * não ter desenho nenhum.
 *
 * Regra que vale pra todos: MONOCROMÁTICO, em `currentColor`. A cor não mora no
 * desenho, mora no estado de quem o usa.
 */

type P = { size?: number; className?: string };

/** Moldura comum: todo desenho nasce com o mesmo traço e o mesmo viewBox. */
export function svg(d: React.ReactNode) {
  const C = ({ size = 20, className }: P) => (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true" focusable="false"
    >{d}</svg>
  );
  return C;
}

export type IconeDesenho = ReturnType<typeof svg>;

// ───────────────────────────────────────────── GLIFOS DE MAIS DE UMA FERRAMENTA ──

export const ArCondicionado = svg(<>
  <rect x="2" y="4.5" width="20" height="8" rx="2.5" />
  <path d="M5 9.8h14" />
  <path d="M6.5 16c1-1.1 2.2-1.1 3.2 0M14 16c1-1.1 2.2-1.1 3.2 0" />
  <path d="M6.5 19.5c1-1.1 2.2-1.1 3.2 0M14 19.5c1-1.1 2.2-1.1 3.2 0" />
</>);

export const Notebook = svg(<>
  <path d="M5 5h14v9.5H5Z" />
  <path d="M2.5 17.5h19l-1.4 2.8H3.9Z" />
</>);

export const Desktop = svg(<>
  <rect x="2" y="4" width="12.5" height="9.5" rx="2" />
  <path d="M8.2 13.5v4M5.5 17.5h5.5" />
  <rect x="17" y="4" width="5" height="14" rx="2" />
  <path d="M19.5 7v.01" />
</>);

export const Impressora = svg(<>
  <path d="M7 8.5V3h10v5.5" />
  <rect x="3" y="8.5" width="18" height="7" rx="2.5" />
  <path d="M7 13.5h10V21H7Z" />
  <path d="M18 11.2h.01" />
</>);

export const Roteador = svg(<>
  <rect x="3" y="13.5" width="18" height="6" rx="2.5" />
  <path d="M6.5 16.5h.01M9.5 16.5h.01" />
  <path d="M16 16.5h2.5" />
  <path d="M8 10.5a5.5 5.5 0 0 1 8 0M10.4 7.6a9 9 0 0 1 3.2 0" />
</>);

export const Bebedouro = svg(<>
  <path d="M9 2.5h6v4.2a3 3 0 0 1-6 0Z" />
  <rect x="7" y="8.5" width="10" height="13" rx="2.5" />
  <path d="M10 14.5h4" />
</>);

export const Furadeira = svg(<>
  <path d="M2.5 6.5h9a1.6 1.6 0 0 1 1.6 1.6v4a1.6 1.6 0 0 1-1.6 1.6h-9Z" />
  <path d="M15.2 8.3h2v3.4h-2Z" />
  <path d="M13.1 10h2.1M17.2 10h4.8" />
  <path d="M4.2 13.7 3 21h4.2l1.3-7.3" />
</>);

/** Última linha de defesa de qualquer catálogo: nunca devolver desenho vazio. */
export const Tomada = svg(<>
  <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
  <circle cx="9.5" cy="10" r="1.2" /><circle cx="14.5" cy="10" r="1.2" />
  <path d="M9 15h6" />
</>);
