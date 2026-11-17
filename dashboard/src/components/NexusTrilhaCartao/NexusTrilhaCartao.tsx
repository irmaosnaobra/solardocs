'use client';

import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowRight, PlugZap, RefreshCw } from 'lucide-react';
import api from '@/services/api';
import NexusBanner from '@/components/NexusBanner/NexusBanner';
import {
  registrarConvite, trilhaPendente, useNexusTrilhaResumo, type ResumoTrilha,
} from '@/hooks/useNexusTrilhaResumo';
import styles from './NexusTrilhaCartao.module.css';

/**
 * Cartão da Trilha do Parceiro NEXUS, no topo de toda tela logada do SolarDoc e no /inicio.
 *
 * Aparece para TODA conta enquanto a trilha está ligada e o Raio-X não foi enviado (ver useNexusTrilhaResumo). Duas
 * versões: o parceiro do portal antigo (`precisa_refazer`) refaz o cadastro; quem nunca foi parceiro se cadastra.
 * "Agora não" esconde só nesta sessão do navegador (sessionStorage) e conta no servidor: o cartão volta no próximo
 * acesso. Da 3ª vez que aparece (2 "Agora não" antes) ganha também "Não quero", que tira o cartão e a etiqueta do
 * menu de vez. Some de vez também quando o Raio-X é enviado.
 *
 * Ele SUBSTITUI o convite antigo (NexusBanner): com a trilha ligada o convite não aparece. Enquanto o resumo não
 * chega, nada aparece; se a rota falhar (ainda não publicada, rede), volta o convite antigo, como era antes.
 *
 * Cores fixas, como as do NexusBanner: o cartão é o mesmo no tema escuro da plataforma e na tela clara do /inicio.
 */

const DESTINO = '/parceiro-nexus';

const PASSOS: { texto: string; ajuda: string }[] = [
  { texto: 'Confirme os dados da sua empresa', ajuda: 'Já vêm da SolarDoc. Você só confere e corrige o que precisar.' },
  { texto: 'Responda uma pergunta por tela', ajuda: 'Cerca de 10 minutos. Tudo fica salvo, então dá para parar e voltar.' },
  { texto: 'Passe com nota 80 ou mais', ajuda: 'Passou, abre a reunião com a NEXUS e o caminho para a proposta com sua marca.' },
];

const TEXTOS = {
  refazer: {
    titulo: 'Sem o Raio-X, a parceria NEXUS não anda',
    apoio: 'A parceria NEXUS agora vive dentro da SolarDoc. Seus dados já estão preenchidos.',
    botao: 'Refazer meu Raio-X',
  },
  novo: {
    titulo: 'Cadastre sua empresa na parceria NEXUS',
    apoio: 'Venda eletroposto com a sua marca. Seus dados já vêm da SolarDoc.',
    botao: 'Fazer meu Raio-X',
  },
} as const;

// ── "Agora não": vale até o fim da sessão do navegador ──────────────────────────
const ouvintes = new Set<() => void>();
const fechadosNaVisita = new Set<string>();

function assinar(fn: () => void): () => void {
  ouvintes.add(fn);
  return () => { ouvintes.delete(fn); };
}

function estaFechado(chave: string): boolean {
  if (fechadosNaVisita.has(chave)) return true;
  try { return sessionStorage.getItem(chave) === '1'; } catch { return false; }
}

function fechar(chave: string): void {
  fechadosNaVisita.add(chave);
  try { sessionStorage.setItem(chave, '1'); } catch { /* sem sessionStorage: fecha só até recarregar */ }
  ouvintes.forEach((fn) => fn());
}

/** Clique contado em feature_events. Nunca atrasa a navegação, e erro some calado. */
function registrarClique(versao: 'refazer' | 'novo'): void {
  try {
    api.post(
      '/feature-events',
      { feature: 'nexus_portal', event_type: 'trilha_cartao_clique', event_data: { versao } },
      { adapter: ['fetch', 'xhr'], fetchOptions: { keepalive: true } },
    ).catch(() => {});
  } catch { /* contar clique nunca quebra o cartão */ }
}

function Passo({ n, texto, ajuda, aberto, onAlternar }: {
  n: number; texto: string; ajuda: string; aberto: boolean; onAlternar: () => void;
}) {
  const id = useId();
  return (
    <li className={styles.passo}>
      <span className={styles.numero} aria-hidden="true">{n}</span>
      <span className={styles.passoTexto}>{texto}</span>
      <button
        type="button"
        className={styles.ajuda}
        aria-label={`Ajuda: ${texto}`}
        aria-expanded={aberto}
        aria-controls={id}
        onClick={onAlternar}
      >?</button>
      <span id={id} role="note" className={styles.balao} hidden={!aberto}>{ajuda}</span>
    </li>
  );
}

function Cartao({ resumo, chave, userId }: { resumo: ResumoTrilha; chave: string; userId: string | number }) {
  const versao = resumo.precisa_refazer ? 'refazer' : 'novo';
  const t = TEXTOS[versao];
  const [aberto, setAberto] = useState<number | null>(null);
  const tituloId = useId();

  // Balão aberto: Esc ou toque fora fecha.
  useEffect(() => {
    if (aberto === null) return;
    const fora = (e: PointerEvent) => {
      const alvo = e.target as Element | null;
      if (!alvo?.closest?.(`.${styles.passo}`)) setAberto(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(null); };
    document.addEventListener('pointerdown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  const Icone = versao === 'refazer' ? RefreshCw : PlugZap;

  return (
    <section className={`${styles.cartao} ${versao === 'refazer' ? styles.refazer : ''}`} aria-labelledby={tituloId}>
      <div className={styles.miolo}>
        <div className={styles.cabeca}>
          <span className={styles.icone} aria-hidden="true"><Icone size={22} strokeWidth={2.2} /></span>
          <div className={styles.textos}>
            <h2 id={tituloId} className={styles.titulo}>{t.titulo}</h2>
            <p className={styles.apoio}>{t.apoio}</p>
          </div>
        </div>

        <ol className={styles.passos}>
          {PASSOS.map((p, i) => (
            <Passo
              key={p.texto}
              n={i + 1}
              texto={p.texto}
              ajuda={p.ajuda}
              aberto={aberto === i}
              onAlternar={() => setAberto((a) => (a === i ? null : i))}
            />
          ))}
        </ol>

        <div className={styles.acoes}>
          <Link className={styles.botao} href={DESTINO} onClick={() => registrarClique(versao)}>
            <span>{t.botao}</span>
            <ArrowRight className={styles.seta} size={18} strokeWidth={2.4} aria-hidden="true" />
          </Link>
          <div className={styles.depois}>
            <div className={styles.botoesDepois}>
              <button
                type="button"
                className={styles.agoraNao}
                onClick={() => { fechar(chave); registrarConvite(userId, 'fechou'); }}
              >Agora não</button>
              {resumo.convite.fechou >= 2 && (
                <button
                  type="button"
                  className={styles.naoQuero}
                  onClick={() => { fechar(chave); registrarConvite(userId, 'nao_quero'); }}
                >Não quero</button>
              )}
            </div>
            <span className={styles.volta}>Este cartão volta no próximo acesso.</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * O convite da NEXUS no topo da tela: o cartão da trilha quando ela está ligada, o convite antigo quando a trilha
 * está desligada ou o resumo falhou. Nunca os dois.
 */
export default function NexusConvite({ userId }: { userId?: string | number | null }) {
  const estado = useNexusTrilhaResumo(userId);
  const chave = `nexus_trilha_cartao:${userId ?? ''}`;
  // No servidor e na hidratação conta como fechado: só abre depois de ler o sessionStorage, sem piscar.
  const fechado = useSyncExternalStore(assinar, () => estaFechado(chave), () => true);

  if (userId == null || userId === '') return null;
  if (estado.estado === 'pendente') return null;
  // Trilha desligada ou resumo indisponível: o convite de antes, com as regras dele.
  if (estado.estado === 'falhou' || !estado.resumo.ligada) return <NexusBanner userId={userId} />;

  const resumo = trilhaPendente(estado);
  if (!resumo || fechado) return null;
  return <Cartao resumo={resumo} chave={chave} userId={userId} />;
}
