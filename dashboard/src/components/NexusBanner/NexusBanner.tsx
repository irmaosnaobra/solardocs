'use client';

import { useSyncExternalStore } from 'react';
import { ArrowRight, PlugZap, X } from 'lucide-react';
import api from '@/services/api';
import { useNexusPortal } from '@/hooks/useNexusPortal';
import { useNexusParceiro } from '@/hooks/useNexusParceiro';
import styles from './NexusBanner.module.css';

/**
 * Convite para conhecer a NEXUS, a nossa distribuidora, no topo do SolarDoc logado e no /inicio.
 *
 * Só aparece quando as três coisas são verdade: o portal está ligado (`/gerador/nexus/status`), a pessoa não
 * fechou o convite nos últimos 7 dias e a conta ainda não é parceira (ver useNexusParceiro). Falha na checagem
 * do parceiro conta como "não é parceiro": melhor sobrar convite do que sumir.
 *
 * "Agora não" grava a data do fechamento em `nexus_banner_v2:<userId>` e o convite volta 7 dias depois. A chave é
 * outra de propósito: quem fechou o aviso antigo (`nexus_banner_fechado`) vê este.
 *
 * Versão curta ou completa, quem decide é o CSS, pela largura do próprio banner (container query): o celular e o
 * /inicio ficam com a curta. O portal é uma página estática (`/nexus/app`), não uma rota do Next: o link é um <a>
 * comum, de página inteira, e por isso o clique é registrado com keepalive, para não morrer na troca de página.
 */

const SETE_DIAS = 7 * 24 * 60 * 60 * 1000;
const FOLGA_DO_RELOGIO = 24 * 60 * 60 * 1000;
const DESTINO = '/nexus/app?o=solardoc_banner';
const TEXTO =
  'Procuramos parceiros que queiram entrar no mercado de carregadores e ter equipamento de qualidade. O seu login do SolarDoc já abre o portal da NEXUS.';
const ITENS = ['Carregadores', 'Mentoria e suporte', 'Engenharia', 'Indicação de clientes', 'E muito mais'];

const ouvintes = new Set<() => void>();
const fechadosNaVisita = new Map<string, number>();

function assinar(fn: () => void): () => void {
  ouvintes.add(fn);
  return () => { ouvintes.delete(fn); };
}

/** Quando a pessoa fechou (em ms), ou null. Aceita a data em ISO (o que gravamos) e em milissegundos. */
function fechadoEm(chave: string): number | null {
  const daVisita = fechadosNaVisita.get(chave);
  if (daVisita !== undefined) return daVisita;
  try {
    const bruto = localStorage.getItem(chave);
    if (!bruto) return null;
    const t = /^\d+$/.test(bruto) ? Number(bruto) : Date.parse(bruto);
    return Number.isFinite(t) ? t : null;
  } catch { return null; }
}

/** Fechado há menos de 7 dias. Relógio atrasado em até 1 dia ainda conta como fechado; mais que isso, volta. */
function estaFechado(chave: string): boolean {
  const t = fechadoEm(chave);
  if (t === null) return false;
  const idade = Date.now() - t;
  return idade < SETE_DIAS && idade > -FOLGA_DO_RELOGIO;
}

function registrarFechamento(chave: string): void {
  const agora = Date.now();
  fechadosNaVisita.set(chave, agora);
  try { localStorage.setItem(chave, new Date(agora).toISOString()); } catch { /* sem localStorage: fecha só nesta visita */ }
  ouvintes.forEach((fn) => fn());
}

/** Clique contado em feature_events. Nunca atrasa a navegação, e erro some calado. */
function registrarClique(): void {
  try {
    api.post(
      '/feature-events',
      { feature: 'nexus_portal', event_type: 'banner_clique', event_data: { origem: 'solardoc_banner' } },
      { adapter: ['fetch', 'xhr'], fetchOptions: { keepalive: true } },
    ).catch(() => {});
  } catch { /* contar clique nunca quebra o banner nem segura a navegação */ }
}

export default function NexusBanner({ userId }: { userId?: string | number | null }) {
  const ligado = useNexusPortal();
  const comUsuario = userId != null && userId !== '';
  const chave = `nexus_banner_v2:${userId ?? ''}`;
  // No servidor e na hidratação conta como fechado: só abre depois de ler o localStorage, sem piscar.
  const fechado = useSyncExternalStore(assinar, () => estaFechado(chave), () => true);
  // A sonda de parceiro só roda quando o banner apareceria de qualquer jeito.
  const situacao = useNexusParceiro(userId, ligado && comUsuario && !fechado);

  if (!ligado || fechado || !comUsuario || situacao !== 'livre') return null;

  return (
    <div className={styles.banner} role="region" aria-label="Convite para conhecer a NEXUS">
      <div className={styles.miolo}>
        <span className={styles.icone} aria-hidden="true">
          <PlugZap size={28} strokeWidth={2} />
        </span>
        <div className={styles.conteudo}>
          <p className={styles.curto}>A NEXUS, nossa distribuidora, procura parceiros.</p>
          <div className={styles.completo}>
            <p className={styles.titulo}>Conheça a NEXUS, a nossa distribuidora</p>
            <p className={styles.texto}>{TEXTO}</p>
            <ul className={styles.chips}>
              {ITENS.map((item) => (
                <li key={item} className={styles.chip}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className={styles.acoes}>
          <a className={styles.botao} href={DESTINO} onClick={registrarClique} aria-label="Conhecer a NEXUS">
            <span className={styles.rotuloLongo}>Conhecer a NEXUS</span>
            <span className={styles.rotuloCurto}>Conhecer</span>
            <ArrowRight className={styles.seta} size={18} strokeWidth={2.4} aria-hidden="true" />
          </a>
          <button type="button" className={styles.fechar} onClick={() => registrarFechamento(chave)} aria-label="Agora não">
            <span className={styles.fecharRotulo}>Agora não</span>
            <X className={styles.fecharIcone} size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
