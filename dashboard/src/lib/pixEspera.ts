'use client';

// Espera do Pix automático, igual aos apps de pagamento: a tela mostra o QR e o
// copia e cola, e quando a pessoa volta do app do banco a MESMA tela já diz que
// o Pix foi pago. Usado pelo modal da LP, pela /pix-automatico e pela tela
// logada /pix-recorrente. O quiz (/diagnostico, HTML estático) tem a mesma regra
// escrita à mão: mudou aqui, muda lá.
//
// Regra de pago (D2): pago === true OU status === 'ativo'. O `pago` vem da api
// nova; o `status` cobre a api antiga. "Nada foi cobrado" só quando a api disser
// pago === false.

import { useEffect, useRef, useState } from 'react';

export interface PixStatus {
  status?: string | null;
  pago?: boolean;
  pagoEm?: string | null;
  situacao?: string | null;
  criadoEm?: string | null;
  expiraEm?: string | null;
  modo?: string | null;
  qrPayload?: string | null;
  qrImagemBase64?: string | null; // só quando a consulta pediu ?qr=1 e o contrato ainda espera o pagamento
}

export type FimPix = 'vencido' | 'recusado';

export const pixFoiPago = (d: PixStatus | null | undefined): boolean =>
  Boolean(d) && (d!.pago === true || d!.status === 'ativo');

export const pixAcessoLiberado = (d: PixStatus | null | undefined): boolean => d?.status === 'ativo';

// A api disse, com todas as letras, que não houve pagamento e que este código acabou.
// Com a api antiga (sem `pago`) nunca encerra antes do prazo: 'recusado' lá pode ser
// de quem pagou e teve o débito mensal recusado depois.
export function pixEncerrou(d: PixStatus | null | undefined): FimPix | null {
  if (!d || pixFoiPago(d) || d.pago !== false) return null;
  const s = d.situacao || '';
  const st = d.status || '';
  if (s === 'recusado' || s === 'cancelado' || st === 'recusado' || st === 'cancelado') return 'recusado';
  if (s === 'vencido' || st === 'expirado') return 'vencido';
  return null;
}

// ── Textos (redator, 16/11/2026) ─────────────────────────────────────────────
export const TXT_PIX = {
  esperandoTitulo: 'Esperando o pagamento',
  esperandoCorpo: 'Pague no app do seu banco e volte aqui. Esta tela confirma sozinha.',
  esperandoApoio: 'Abra o app do banco, escolha Pix e leia o QR ou cole o código.',
  pagoTitulo: 'Pix pago',
  pagoContaNova: 'Recebemos seu pagamento. Seu acesso já está liberado. O link para criar sua senha chega no seu e-mail em alguns minutos. Olhe também o spam.',
  pagoContaExiste: 'Recebemos seu pagamento. Seu acesso já está liberado. Entre com o seu e-mail e a sua senha.',
  pagoLiberando: 'Estamos liberando seu acesso.',
  pagoLiberandoPasso: 'Fique nesta tela. Se demorar, olhe seu e-mail, inclusive o spam.',
  // Pago, mas passados 15 min o acesso ainda não saiu: sem giro e sem "Fique nesta tela".
  pagoDemoraNova: 'Recebemos seu pagamento. O link para criar sua senha chega no seu e-mail. Olhe também o spam.',
  pagoDemoraConta: 'Recebemos seu pagamento. O acesso chega no seu e-mail. Olhe também o spam.',
  retomado: 'Vimos que o seu Pix foi pago enquanto você estava fora.',
  vencidoTitulo: 'O código venceu',
  recusadoTitulo: 'O Pix não foi concluído',
  semConexao: 'Sem conexão agora. Seguimos tentando.',
  copiar: 'Copiar código',
  copiado: 'Código copiado',
  gerarOutro: 'Gerar outro código',
  pagarCartao: 'Pagar no cartão',
  criarSenha: 'Criar minha senha',
  entrar: 'Entrar na plataforma',
} as const;

// Corpo do vencido e do recusado. "Nada foi cobrado" só com pago === false; o
// cartão só onde a tela tem caminho de cartão.
export function corpoSemPagamento(fim: FimPix, nadaCobrado: boolean, temCartao: boolean): string {
  const abre = fim === 'vencido' ? 'Não recebemos o pagamento deste código.' : 'Não recebemos o pagamento.';
  return [abre, nadaCobrado ? 'Nada foi cobrado.' : '', temCartao ? 'Gere outro código ou pague no cartão.' : 'Gere outro código.']
    .filter(Boolean).join(' ');
}

// ── Contrato guardado no aparelho (24 h) ─────────────────────────────────────
// Quem fecha a aba, ou volta do banco com a página recarregada, reencontra o
// mesmo código e a confirmação. Nunca guarda CPF nem e-mail, nem a imagem do QR
// (ela volta da api, com ?qr=1).
export interface PixGuardado {
  id: string;
  t: number; // quando o código foi gerado (ms)
  fimMs: number; // até quando o código vale
  payload: string;
  temConta: boolean;
}

const VALIDADE_GUARDA_MS = 24 * 60 * 60 * 1000;
const chaveGuarda = (tela: string) => `sd-pix-espera-${tela}`;
const ID_RE = /^[\w-]{6,80}$/;
export const B64_RE = /^[A-Za-z0-9+/=]+$/;

// A imagem do QR vem em base64. A criação devolve PNG; se a api gerar GIF, o prefixo acompanha.
export function qrSrc(b64: string): string {
  return (b64.startsWith('R0lGOD') ? 'data:image/gif;base64,' : 'data:image/png;base64,') + b64;
}

export function guardarPix(tela: string, p: PixGuardado): void {
  try { localStorage.setItem(chaveGuarda(tela), JSON.stringify(p)); } catch { /* sem armazenamento: vale só nesta aba */ }
}

export function lerPixGuardado(tela: string): PixGuardado | null {
  try {
    const cru = localStorage.getItem(chaveGuarda(tela));
    if (!cru) return null;
    const p = JSON.parse(cru) as Partial<PixGuardado>;
    const ok = p && typeof p.id === 'string' && ID_RE.test(p.id)
      && typeof p.t === 'number' && Date.now() - p.t < VALIDADE_GUARDA_MS && p.t <= Date.now() + 60_000
      && typeof p.fimMs === 'number' && typeof p.payload === 'string';
    if (!ok) { localStorage.removeItem(chaveGuarda(tela)); return null; }
    return {
      id: p.id!, t: p.t!, fimMs: p.fimMs!, payload: p.payload!.slice(0, 2000),
      temConta: p.temConta === true,
    };
  } catch {
    return null;
  }
}

export function limparPixGuardado(tela: string): void {
  try { localStorage.removeItem(chaveGuarda(tela)); } catch { /* nada a limpar */ }
}

// pix_pago sai uma vez por contrato, mesmo com a tela reaberta ou com dois
// caminhos confirmando ao mesmo tempo.
const CHAVE_MARCA = 'sd-pix-pago-medido';
const marcasMemoria = new Set<string>();
export function primeiraVezPago(id: string): boolean {
  if (!id || marcasMemoria.has(id)) return false;
  marcasMemoria.add(id);
  try {
    const lista = JSON.parse(localStorage.getItem(CHAVE_MARCA) || '[]') as unknown;
    const ids = Array.isArray(lista) ? lista.filter((x): x is string => typeof x === 'string') : [];
    if (ids.includes(id)) return false;
    localStorage.setItem(CHAVE_MARCA, JSON.stringify([...ids, id].slice(-30)));
  } catch { /* sem armazenamento: a trava da memória basta nesta aba */ }
  return true;
}

// Até quando o código vale, no horário de Brasília: "hoje às 14:30" ou "amanhã às 09:05".
export function validadeTexto(fimMs: number): string {
  try {
    const fuso = 'America/Sao_Paulo';
    const dia = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: fuso });
    const hora = new Date(fimMs).toLocaleTimeString('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hour12: false });
    const dif = Math.round((Date.parse(dia(fimMs) + 'T00:00:00Z') - Date.parse(dia(Date.now()) + 'T00:00:00Z')) / 86400000);
    if (dif === 0) return 'hoje às ' + hora;
    if (dif === 1) return 'amanhã às ' + hora;
    const [, m, d] = dia(fimMs).split('-');
    return 'em ' + d + '/' + m + ' às ' + hora;
  } catch {
    return '';
  }
}

// ── A espera ─────────────────────────────────────────────────────────────────
export type FasePix = 'esperando' | 'pago' | 'encerrado' | 'sumiu';

export interface EstadoPix {
  fase: FasePix;
  dados: PixStatus | null;
  semConexao: boolean;
  fim: FimPix; // vale na fase 'encerrado'
  nadaCobrado: boolean; // a api disse pago === false
  pagoAoReabrir: boolean; // a 1ª consulta de uma tela reaberta já veio paga
  demorou: boolean; // pago, mas passados 15 min o acesso ainda não saiu (status nunca virou 'ativo')
}

interface Opcoes {
  chave: string | null; // id do contrato; null = não há espera
  fimMs: number; // até quando o código vale
  retomada: boolean; // a espera começou de um contrato guardado
  temImagem: boolean; // a tela já tem a imagem do QR; sem ela, a consulta pede ?qr=1
  buscar: (comQr: boolean) => Promise<PixStatus | null>;
  aoPagar?: (d: PixStatus, retomado: boolean) => void; // uma vez por contrato
}

const RAPIDO_MS = 3000; // a cada 3 s com a tela visível
const DEPOIS_MS = 10_000; // passados 15 min, a cada 10 s (a volta do banco consulta na hora)
const FASE_RAPIDA_MS = 15 * 60 * 1000;
const LIBERANDO_MS = 15 * 60 * 1000; // pago sem 'ativo': segue perguntando para trocar o texto
const FALHAS_AVISO = 3;
const TENTATIVAS_QR = 3; // quantas vezes pede o QR antes de desistir (a tela segue com o copia e cola)

const INICIAL: Omit<EstadoPix, 'fase'> = { dados: null, semConexao: false, fim: 'vencido', nadaCobrado: false, pagoAoReabrir: false, demorou: false };

const naoAchou = (e: unknown) => (e as { response?: { status?: number }; status?: number })?.response?.status === 404
  || (e as { status?: number })?.status === 404;

export function usePixEspera({ chave, fimMs, retomada, temImagem, buscar, aoPagar }: Opcoes): EstadoPix {
  const [estado, setEstado] = useState<EstadoPix & { chave: string | null }>({ chave: null, fase: 'esperando', ...INICIAL });
  const buscarRef = useRef(buscar);
  const aoPagarRef = useRef(aoPagar);
  const temImagemRef = useRef(temImagem);
  useEffect(() => { buscarRef.current = buscar; aoPagarRef.current = aoPagar; temImagemRef.current = temImagem; });

  useEffect(() => {
    if (!chave) return;
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ocupado = false;
    let falhas = 0;
    let primeira = true;
    let pagoDesde = 0; // pago sem 'ativo': até quando seguir perguntando
    let pedirQr = retomada || !temImagemRef.current; // reaberta ou sem imagem: a 1ª consulta pede o QR
    let tentativasQr = 0;
    const inicio = Date.now();
    const pronto = (s: Partial<EstadoPix>) => vivo && setEstado((a) => ({ ...(a.chave === chave ? a : { fase: 'esperando' as FasePix, ...INICIAL }), ...s, chave }));
    const parar = () => { vivo = false; if (timer) { clearTimeout(timer); timer = null; } };

    function agendar() {
      if (!vivo) return;
      if (timer) clearTimeout(timer);
      timer = null;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return; // pausa; a volta religa
      const ms = pagoDesde ? 5000 : Date.now() - inicio < FASE_RAPIDA_MS ? RAPIDO_MS : DEPOIS_MS;
      timer = setTimeout(() => { void rodada(); }, ms);
    }

    async function rodada() {
      if (!vivo || ocupado) return;
      ocupado = true;
      try {
        const comQr = pedirQr && tentativasQr < TENTATIVAS_QR;
        if (comQr) tentativasQr++;
        const d = await buscarRef.current(comQr);
        if (!vivo) return;
        falhas = 0;
        if (d?.qrImagemBase64) pedirQr = false;
        const eraPrimeira = primeira;
        primeira = false;
        if (d && pixFoiPago(d)) {
          if (!pagoDesde) {
            pagoDesde = Date.now();
            aoPagarRef.current?.(d, retomada);
          }
          const demorou = !pixAcessoLiberado(d) && Date.now() - pagoDesde > LIBERANDO_MS;
          pronto({ fase: 'pago', dados: d, semConexao: false, demorou, ...(eraPrimeira && retomada ? { pagoAoReabrir: true } : {}) });
          if (pixAcessoLiberado(d) || demorou) { parar(); return; }
          return;
        }
        if (pagoDesde) return; // já mostrou pago: uma resposta estranha depois não desfaz
        const fim = pixEncerrou(d) ?? (Date.now() >= fimMs ? (d?.status === 'recusado' || d?.situacao === 'recusado' ? 'recusado' : 'vencido') : null);
        if (fim) {
          pronto({ fase: 'encerrado', dados: d, semConexao: false, fim, nadaCobrado: d?.pago === false });
          parar();
          return;
        }
        pronto({ fase: 'esperando', dados: d, semConexao: false });
      } catch (e) {
        if (!vivo) return;
        primeira = false;
        if (naoAchou(e)) { pronto({ fase: 'sumiu', semConexao: false }); parar(); return; }
        falhas++;
        if (falhas >= FALHAS_AVISO) pronto({ semConexao: true });
      } finally {
        ocupado = false;
        agendar();
      }
    }

    // Voltou do app do banco (aba visível de novo, ou página restaurada do cache):
    // consulta na hora e religa a espera. Esconder a aba só pausa.
    const aoVoltar = () => {
      if (!vivo || document.visibilityState === 'hidden') return;
      if (timer) { clearTimeout(timer); timer = null; }
      void rodada();
    };
    const aoEsconder = () => {
      if (document.visibilityState === 'hidden' && timer) { clearTimeout(timer); timer = null; }
    };
    const aoSair = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const aoVisibilidade = () => (document.visibilityState === 'hidden' ? aoEsconder() : aoVoltar());

    document.addEventListener('visibilitychange', aoVisibilidade);
    window.addEventListener('pageshow', aoVoltar);
    window.addEventListener('pagehide', aoSair);
    window.addEventListener('focus', aoVoltar);
    void rodada();

    return () => {
      parar();
      document.removeEventListener('visibilitychange', aoVisibilidade);
      window.removeEventListener('pageshow', aoVoltar);
      window.removeEventListener('pagehide', aoSair);
      window.removeEventListener('focus', aoVoltar);
    };
  }, [chave, fimMs, retomada]);

  if (!chave || estado.chave !== chave) return { fase: 'esperando', ...INICIAL };
  const { chave: _c, ...resto } = estado;
  void _c;
  return resto;
}
