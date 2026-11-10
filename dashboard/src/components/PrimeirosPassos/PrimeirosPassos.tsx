'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { primeirosPassosApi, type PassoId, type PrimeirosPassosEstado } from '@/services/api';
import { novaPropostaItem } from '@/components/Sidebar/itensMenu';
import { WA_SUPORTE } from '@/utils/suporte';
import styles from './PrimeirosPassos.module.css';

// Quadro "Primeiros passos": a recepção do usuário novo. Mostra os 4 passos, qual falta, por quê e como faz, e
// que depois fica tudo automático. Fica de fora (não renderiza nada) enquanto carrega, se a chamada falhar, se
// a pessoa fechou ou se `mostrar` é falso: nunca derruba a página que o hospeda.
//
// `mostrar` é a decisão de quem hospeda (só usuário comum: não admin, não comprador avulso). O componente não
// lê o contexto do dashboard de propósito, porque o /inicio fica fora do DashboardProvider.

/** Evento que a tela Empresa dispara depois de salvar: o quadro recarrega o estado. */
export const EVENTO_ATUALIZAR = 'primeiros-passos:atualizar';

type PassoPrincipal = Exclude<PassoId, 'whatsapp'>;

interface Texto {
  titulo: string;
  porque: string;
  como: string[];
  botao: string;
  feito: string;
  /** Para onde o botão leva. Os de /empresa levam à seção (id) e rolam até ela. */
  destino: string;
}

const TEXTOS: Record<PassoId, Texto> = {
  empresa: {
    titulo: 'Dados da empresa',
    porque: 'Razão social e CNPJ entram sozinhos em toda proposta e documento.',
    como: ['Abra o menu Empresa.', 'Preencha razão social e CNPJ. Só esses dois são obrigatórios.', 'Clique em Cadastrar empresa.'],
    botao: 'Cadastrar minha empresa',
    feito: 'Empresa cadastrada',
    destino: '/empresa#empresa-dados',
  },
  logo: {
    titulo: 'Logo da empresa',
    porque: 'Sua marca aparece em todas as propostas, sem você colocar de novo.',
    como: ['Abra o menu Empresa.', 'Clique na área da logo e escolha o arquivo (JPG ou PNG, até 1 MB). A cor é opcional.', 'Clique em Salvar alterações.'],
    botao: 'Subir minha logo',
    feito: 'Logo salva',
    destino: '/empresa#empresa-logo',
  },
  fotos: {
    titulo: 'Fotos dos seus trabalhos',
    porque: 'Suas obras mostram ao cliente o seu trabalho e entram sozinhas nas propostas.',
    como: ['No menu Empresa, vá até Fotos dos seus trabalhos.', 'Adicione 6, 9 ou 12 fotos de obras.', 'Clique em Salvar alterações.'],
    botao: 'Escolher minhas fotos',
    feito: 'Fotos salvas',
    destino: '/empresa#empresa-fotos',
  },
  proposta: {
    titulo: 'Primeira proposta',
    porque: 'É aqui que você vê tudo funcionando junto.',
    como: ['Clique em Nova proposta, no topo do menu.', 'Escolha o modelo.', 'Preencha o cliente e a conta de luz.'],
    botao: 'Criar minha primeira proposta',
    feito: 'Primeira proposta criada',
    // A mesma rota do botão "Nova proposta" do menu.
    destino: novaPropostaItem.href,
  },
  whatsapp: {
    titulo: 'Seu WhatsApp',
    porque: 'Assim a Giovanna, do suporte, te ajuda e você recebe os avisos por lá.',
    como: ['Digite seu número com DDD no campo abaixo.', 'Clique em Salvar meu WhatsApp.'],
    botao: 'Salvar meu WhatsApp',
    feito: 'WhatsApp cadastrado',
    destino: '',
  },
};

const ORDEM: PassoPrincipal[] = ['empresa', 'logo', 'fotos', 'proposta'];

// Máscara (XX) XXXXX-XXXX, a mesma do cadastro.
function maskWhatsapp(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function chaveFechado(userId: string | null | undefined): string {
  return `solardoc:primeiros-passos-fechado:${userId || 'conta'}`;
}

function jaFechou(userId: string | null | undefined): boolean {
  try {
    return window.localStorage.getItem(chaveFechado(userId)) === '1';
  } catch {
    return false;
  }
}

function Marca({ feito, atual }: { feito: boolean; atual: boolean }) {
  if (feito) {
    return (
      <svg className={styles.marca} width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" focusable="false">
        <circle cx="13" cy="13" r="13" fill="var(--ink-green)" />
        <path d="M7.5 13.5l3.7 3.7 7.3-7.6" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg className={styles.marca} width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" focusable="false">
      <circle cx="13" cy="13" r="11.5" fill="none" stroke={atual ? 'var(--color-primary)' : 'var(--color-border-strong)'} strokeWidth="2.5" />
      {atual && <circle cx="13" cy="13" r="4.5" fill="var(--color-primary)" />}
    </svg>
  );
}

interface Props {
  /** Decisão de quem hospeda: só usuário comum. Falso = não busca nada e não mostra nada. */
  mostrar: boolean;
  /** Para lembrar o "fechar" por conta neste aparelho. */
  userId?: string | null;
  /** Chamado uma vez se a primeira carga falhar (a página pode manter o que tinha antes). */
  onFalhou?: () => void;
  /** Só aparece enquanto a primeira proposta não saiu (tela de documentos: cliente antigo não vê o quadro em cima de todo formulário). */
  soSemProposta?: boolean;
}

export default function PrimeirosPassos({ mostrar, userId, onFalhou, soSemProposta }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [estado, setEstado] = useState<PrimeirosPassosEstado | null>(null);
  const [fechado, setFechado] = useState(false);
  const [abertos, setAbertos] = useState<Partial<Record<PassoId, boolean>>>({});
  const [whatsapp, setWhatsapp] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erroWhatsapp, setErroWhatsapp] = useState('');
  const carregouUmaVez = useRef(false);
  const falhouAvisado = useRef(false);

  // Só mexe em estado dentro do retorno da chamada. Quem fechou não gera chamada nenhuma.
  const carregar = useCallback(() => {
    if (!mostrar || jaFechou(userId)) return;
    primeirosPassosApi.get()
      .then(({ data }) => {
        if (!data || !Array.isArray(data.passos)) throw new Error('resposta inesperada');
        carregouUmaVez.current = true;
        setEstado(data);
      })
      .catch(() => {
        // Falha: fica o que já estava na tela (ou nada). 401: o interceptor do api.ts já cuidou do login.
        if (!carregouUmaVez.current && !falhouAvisado.current) {
          falhouAvisado.current = true;
          onFalhou?.();
        }
      });
  }, [mostrar, userId, onFalhou]);

  useEffect(() => {
    carregar();
    window.addEventListener(EVENTO_ATUALIZAR, carregar);
    window.addEventListener('focus', carregar);
    return () => {
      window.removeEventListener(EVENTO_ATUALIZAR, carregar);
      window.removeEventListener('focus', carregar);
    };
  }, [carregar]);

  function fechar() {
    try {
      window.localStorage.setItem(chaveFechado(userId), '1');
    } catch {
      // Sem localStorage (modo privado, cota): some nesta visita e pode voltar na próxima.
    }
    setFechado(true);
  }

  function ir(destino: string) {
    const [rota, ancora] = destino.split('#');
    if (ancora && pathname === rota) {
      document.getElementById(ancora)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    router.push(destino);
  }

  async function salvarWhatsapp() {
    const digitos = whatsapp.replace(/\D/g, '');
    if (!digitos || salvando) return;
    setSalvando(true);
    setErroWhatsapp('');
    try {
      await primeirosPassosApi.salvarWhatsapp(digitos);
      setWhatsapp('');
      carregar();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      setErroWhatsapp(e.response?.data?.error || 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  if (!mostrar || fechado || !estado) return null;
  if (soSemProposta && estado.passos.some((p) => p.id === 'proposta' && p.feito)) return null;

  if (estado.tudoPronto) {
    return (
      <section className={`${styles.quadro} ${styles.pronto}`} aria-labelledby="pp-pronto-titulo">
        <div className={styles.prontoTopo}>
          <Marca feito atual={false} />
          <div>
            <h2 id="pp-pronto-titulo" className={styles.titulo}>Tudo pronto!</h2>
            <p className={styles.texto}>Sua empresa está cadastrada e as próximas propostas já saem com seus dados. É só clicar em Nova proposta quando precisar.</p>
          </div>
        </div>
        <div className={styles.rodape}>
          <button type="button" className={styles.btnSec} onClick={fechar}>Fechar primeiros passos</button>
        </div>
      </section>
    );
  }

  const porId = new Map(estado.passos.map((p) => [p.id, p]));
  const faltaWhatsapp = porId.get('whatsapp')?.feito === false;
  const pct = estado.total > 0 ? Math.min(100, Math.round((estado.feitos / estado.total) * 100)) : 0;

  return (
    <section className={styles.quadro} aria-labelledby="pp-titulo">
      <header className={styles.topo}>
        <div className={styles.topoTextos}>
          <h2 id="pp-titulo" className={styles.titulo}>Primeiros passos</h2>
          <p className={styles.texto}>É simples: você cadastra uma vez e o resto fica automático.</p>
        </div>
        <div className={styles.progresso}>
          <span className={styles.progressoNum}>{estado.feitos} de {estado.total}</span>
          <div
            className={styles.barra}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={estado.total}
            aria-valuenow={estado.feitos}
            aria-label="Primeiros passos concluídos"
          >
            <div className={styles.barraCheia} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </header>

      <ol className={styles.lista}>
        {ORDEM.map((id) => {
          const passo = porId.get(id);
          const t = TEXTOS[id];
          const feito = !!passo?.feito;
          const atual = estado.proximo === id;
          const aberto = !feito && (abertos[id] ?? atual);
          const qtd = passo?.qtd ?? 0;
          const minimo = passo?.minimo ?? 6;
          return (
            <li key={id} className={styles.passo}>
              <Marca feito={feito} atual={atual} />
              <div className={styles.corpo}>
                <h3 className={styles.passoTitulo}>{t.titulo}</h3>
                <p className={styles.porque}>{t.porque}</p>
                {feito && <p className={styles.feito}>{t.feito}</p>}
                {id === 'fotos' && !feito && qtd >= 1 && qtd < minimo && (
                  <p className={styles.contagem}>Você tem {qtd} de {minimo}.</p>
                )}
                {!feito && aberto && (
                  <>
                    <ol className={styles.como}>
                      {t.como.map((linha) => <li key={linha}>{linha}</li>)}
                    </ol>
                    <button type="button" className={styles.btn} onClick={() => ir(t.destino)}>{t.botao}</button>
                  </>
                )}
                {!feito && !aberto && (
                  <button
                    type="button"
                    className={styles.btnLink}
                    aria-expanded={false}
                    onClick={() => setAbertos((a) => ({ ...a, [id]: true }))}
                  >
                    Como faço
                  </button>
                )}
              </div>
            </li>
          );
        })}

        {faltaWhatsapp && (
          <li className={`${styles.passo} ${styles.passoExtra}`}>
            <Marca feito={false} atual={false} />
            <div className={styles.corpo}>
              <h3 className={styles.passoTitulo}>{TEXTOS.whatsapp.titulo}</h3>
              <p className={styles.porque}>{TEXTOS.whatsapp.porque}</p>
              <ol className={styles.como}>
                {TEXTOS.whatsapp.como.map((linha) => <li key={linha}>{linha}</li>)}
              </ol>
              <form
                className={styles.zap}
                onSubmit={(e) => { e.preventDefault(); void salvarWhatsapp(); }}
              >
                <label htmlFor="pp-whatsapp" className={styles.zapRotulo}>{TEXTOS.whatsapp.titulo}</label>
                <input
                  id="pp-whatsapp"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  className="input-field"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(maskWhatsapp(e.target.value))}
                  placeholder="Ex: (34) 99999-0000"
                />
                <button type="submit" className={styles.btn} disabled={salvando || !whatsapp.replace(/\D/g, '')}>
                  {salvando ? 'Salvando...' : TEXTOS.whatsapp.botao}
                </button>
              </form>
              {erroWhatsapp && <p className={styles.erro} role="alert">{erroWhatsapp}</p>}
            </div>
          </li>
        )}
      </ol>

      <div className={styles.automatico}>
        <h3 className={styles.autoTitulo}>Daqui pra frente é automático</h3>
        <p className={styles.autoTexto}>
          Depois do cadastro, logo, cor, contato, fotos e dados da empresa entram sozinhos em toda proposta. O modelo Completa + Banco já sai com as fotos das obras, os logos dos bancos e a folha de assinatura, pronto para mandar ao banco. Tudo fica salvo na nuvem, por cliente, e o link avisa quando o cliente abre e quando baixa o PDF.
        </p>
      </div>

      <div className={styles.ajuda}>
        <p className={styles.ajudaTexto}>Travou em algum passo? A Giovanna, do suporte, te ajuda pelo WhatsApp.</p>
        <a href={WA_SUPORTE} target="_blank" rel="noopener noreferrer" className={styles.btnSec}>Falar com o suporte no WhatsApp</a>
      </div>

      <div className={styles.rodape}>
        <button type="button" className={styles.btnLink} onClick={fechar}>Fechar primeiros passos</button>
      </div>
    </section>
  );
}
