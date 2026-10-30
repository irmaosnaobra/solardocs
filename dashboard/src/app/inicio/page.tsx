'use client';

import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, ChevronDown, LayoutGrid, Lock } from 'lucide-react';
import { isAuthenticated } from '@/services/auth';
import api from '@/services/api';
import { useAcessos } from '@/hooks/useAcessos';
import { useNexusPortal } from '@/hooks/useNexusPortal';
import { produtoPorId } from '@/lib/produtos';
import Logo from '@/components/Logo/Logo';
import NexusBanner from '@/components/NexusBanner/NexusBanner';
import {
  novaPropostaItem, lerContaItem, lojaItem, nexusItem, papeladaItems, outrosDocsItems,
  hrefVendaDoProduto, organizarMenu, type ItemMenu,
} from '@/components/Sidebar/itensMenu';
import { paletaDaMarca, type PaletaMarca } from '@/utils/corMarca';
import './inicio.css';

// ── Tela de atalho (launcher) — SÓ no celular ──────────────────────────────────
// Abre quando o app abre (start_url do PWA). No PC redireciona pra plataforma
// normal (comportamento inalterado). Mostra os MESMOS itens do menu lateral (as
// definições moram em Sidebar/itensMenu.ts) e veste o app com a marca do assinante:
// a cor e a logo que ele escolheu na tela Empresa. O menu lateral NÃO pega a cor.
// Dá pra intercalar: "Plataforma" entra no app; o botão de grade no topo do app
// (mobileHeader) volta pra cá.

// Entrada padrão da plataforma (o Gerador é o carro-chefe).
const PLATAFORMA = '/documentos?tipo=proposta';

interface DadosEmpresa {
  /** Tem CNPJ: o mesmo critério do layout do app (`hasCompany`). Sem CNPJ, o app é o da SolarDoc. */
  temEmpresa: boolean;
  nome: string;
  logo: string | null;
  /** Texto cru do banco: só vira cor depois de passar por paletaDaMarca. */
  corMarca: unknown;
  corSecundaria: unknown;
}

interface Pessoa {
  id: string | null;
  nome: string | null;
  admin: boolean;
}

const SEM_PESSOA: Pessoa = { id: null, nome: null, admin: false };

// Só imagem de verdade vira <img>: data URI de imagem ou endereço http(s).
const LOGO_VALIDA = /^(data:image\/|https?:\/\/)/i;

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function lerEmpresa(c: Record<string, unknown> | null | undefined): DadosEmpresa {
  if (!c || !texto(c.cnpj)) {
    return { temEmpresa: false, nome: 'SolarDoc', logo: null, corMarca: null, corSecundaria: null };
  }
  const logo = texto(c.logo_base64);
  return {
    temEmpresa: true,
    nome: texto(c.nome_fantasia) || texto(c.nome) || 'Minha Empresa',
    logo: LOGO_VALIDA.test(logo) ? logo : null,
    corMarca: c.cor_marca,
    corSecundaria: c.cor_secundaria,
  };
}

/**
 * O nome do atalho, com a palavra que tem hífen (Off-Grid) inteira: se o nome quebra, quebra no
 * espaço ("Kit" e "Off-Grid"), não no hífen ("Kit Off-" e "Grid"). O texto continua o mesmo.
 */
function rotulo(texto: string) {
  return texto.split(' ').map((palavra, i) => (
    <Fragment key={i}>
      {i > 0 && ' '}
      {palavra.includes('-') ? <span className="ini-semQuebra">{palavra}</span> : palavra}
    </Fragment>
  ));
}

function primeiroNome(nome: unknown): string | null {
  return texto(nome).split(/\s+/)[0] || null;
}

/** Duas letras para o círculo da empresa sem logo: "Sol Forte Energia" vira "SF"; "Sunlight" vira "SU". */
function iniciais(nome: string): string {
  const letra = (p: string) => (p.match(/[0-9A-Za-zÀ-ɏ]/) || [''])[0];
  const palavras = nome.split(/\s+/).filter((p) => letra(p));
  const uteis = palavras.filter((p) => !/^(de|da|do|das|dos|e)$/i.test(p));
  const base = uteis.length ? uteis : palavras;
  const s = base.length >= 2
    ? letra(base[0]) + letra(base[1])
    : (base[0] || '').replace(/[^0-9A-Za-zÀ-ɏ]/g, '').slice(0, 2);
  return s.toLocaleUpperCase('pt-BR');
}

/** Cada cor entra como variável CSS já validada (paletaDaMarca); o CSS só consome. */
function variaveis(p: PaletaMarca): CSSProperties {
  return {
    '--ini-cor': p.principal,
    '--ini-sobre': p.sobrePrincipal,
    '--ini-pressionada': p.pressionada,
    '--ini-icone': p.icone,
    '--ini-marca-texto': p.textoSobreBranco,
    '--ini-sombra': p.sombra,
    '--ini-titulo': p.titulo,
    '--ini-anel': p.anel,
  } as CSSProperties;
}

export default function InicioPage() {
  const router = useRouter();
  const [falhou, setFalhou] = useState(false);
  const [dados, setDados] = useState<DadosEmpresa | null>(null);
  // null = a conta ainda não respondeu. Se falhar, vira SEM_PESSOA: a tela não depende desta chamada.
  const [pessoa, setPessoa] = useState<Pessoa | null>(null);
  const [logoQuebrada, setLogoQuebrada] = useState(false);
  const [maisAberto, setMaisAberto] = useState(false);

  // Quem decide o cadeado é o servidor (uma chamada, cacheada no módulo), como no menu lateral. O admin vem
  // das duas chamadas (/auth/me e /produtos/acessos): se uma falhar, a outra ainda o livra do cadeado.
  const {
    carregando: carregandoServidor, tem: temServidor, bastidor: bastidorServidor, isAdmin: adminServidor, previa,
  } = useAcessos();
  const nexusLigado = useNexusPortal();

  // Só vale pra quem tem empresa cadastrada; sem CNPJ a tela mostra o convite pra cadastrar.
  // Falha de servidor ou de rede NÃO é "sem CNPJ": antes qualquer erro mandava pra
  // /empresa, e quem tem empresa caía na tela de cadastrar durante uma instabilidade.
  // Só mexe em estado dentro do retorno da chamada: o efeito da montagem chama isto, e
  // setState síncrono dentro de efeito renderiza em cascata.
  const carregar = useCallback(() => {
    api.get('/company', { timeout: 12000 }).then(({ data }) => {
      setDados(lerEmpresa(data?.company as Record<string, unknown> | null | undefined));
    }).catch((err) => {
      // 401: o interceptor do api.ts já apagou a sessão e mandou pro login.
      if ((err as { response?: { status?: number } }).response?.status === 401) return;
      setFalhou(true);
    });
  }, []);

  // O nome da saudação, o id do banner do Portal NEXUS (fechar lembrado por usuário) e o admin.
  // Se falhar, sem saudação e sem banner: não derruba a tela. Estado só dentro do retorno da chamada.
  const carregarUsuario = useCallback(() => {
    api.get('/auth/me', { timeout: 12000 })
      .then(({ data }) => {
        const u = data?.user;
        setPessoa({
          id: u?.id ? String(u.id) : null,
          nome: primeiroNome(u?.nome),
          admin: !!u?.is_admin,
        });
      })
      .catch(() => { setPessoa(SEM_PESSOA); });
  }, []);

  useEffect(() => {
    // No PC, nada muda: cai direto na plataforma (o atalho é só de celular).
    if (typeof window !== 'undefined' && window.innerWidth > 768) {
      router.replace('/empresa');
      return;
    }
    if (!isAuthenticated()) { router.replace('/auth?mode=login'); return; }
    carregar();
    carregarUsuario();
  }, [router, carregar, carregarUsuario]);

  // Sem empresa (ou sem dados ainda) a tela é a da SolarDoc, no laranja de sempre.
  const paleta = useMemo(
    () => (dados?.temEmpresa ? paletaDaMarca(dados.corMarca, dados.corSecundaria) : paletaDaMarca(null, null)),
    [dados],
  );
  const pronta = dados !== null;

  // Barra do navegador na cor principal enquanto a tela está aberta; ao sair volta ao que era.
  // Hoje não existe a tag (o manifest é quem dá o laranja): então ela é criada aqui e removida na saída.
  const corBarra = paleta.principal;
  useEffect(() => {
    if (!pronta) return;
    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const criada = !meta;
    const anterior = meta ? meta.getAttribute('content') : null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', corBarra);
    const alvo = meta;
    return () => {
      if (criada) alvo.remove();
      else if (anterior === null) alvo.removeAttribute('content');
      else alvo.setAttribute('content', anterior);
    };
  }, [pronta, corBarra]);

  if (falhou) {
    return (
      <div role="alert" style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 12, padding: '0 24px', textAlign: 'center', background: 'var(--color-bg)',
      }}>
        <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>
          O SolarDoc não respondeu agora.
        </p>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--color-text-muted)', maxWidth: 340 }}>
          Sua conta está normal. É uma instabilidade momentânea, tente de novo em instantes.
        </p>
        <button type="button" onClick={() => { setFalhou(false); carregar(); }} style={{
          marginTop: 8, minHeight: 44, padding: '0 24px', border: 'none', borderRadius: 10,
          background: 'var(--color-primary)', color: '#0f172a', fontSize: 15, fontWeight: 700,
          fontFamily: 'inherit', cursor: 'pointer',
        }}>
          Tentar de novo
        </button>
      </div>
    );
  }

  if (!dados) {
    return <div className="ini-loading"><div className="ini-spin" /></div>;
  }

  // Mesma regra do menu lateral: a prévia do cache só desenha; item de produto só aparece depois
  // que o servidor (e a conta) respondem; admin nunca tem cadeado.
  const acessosCarregando = (previa ? false : carregandoServidor) || pessoa === null;
  const bastidor = previa ? previa.bastidor : bastidorServidor;
  const tem = (produto: string) => (previa ? previa.produtos.has(produto) : temServidor(produto));
  const { principal, paraLiberar, mostrarLoja, travado: travadoNoMenu } = organizarMenu({
    bastidor, carregando: acessosCarregando, isAdmin: !!pessoa?.admin || adminServidor, tem,
  });
  // Sem a ficha do produto no catálogo não há para onde levar o cadeado: fica o link normal.
  const travado = (item: ItemMenu) => travadoNoMenu(item) && !!item.produto && !!produtoPorId(item.produto);

  const { temEmpresa, nome, logo } = dados;
  const semLogo = !logo || logoQuebrada;
  const marcaDaEmpresa = temEmpresa && semLogo ? iniciais(nome) : '';
  const saudacao = pessoa === null ? '' : pessoa.nome ? `Olá, ${pessoa.nome}` : 'Olá';
  // Sem logo ou sem cor, o convite discreto pra personalizar. Some quando as duas estão preenchidas.
  const faltaMarca = temEmpresa && (semLogo || !paleta.personalizada);

  const bloco = (item: ItemMenu) => <Bloco key={item.id} item={item} travado={travado(item)} />;

  return (
    <div className="ini-page" style={variaveis(paleta)}>
      <header className="ini-faixa">
        <div className="ini-faixaInterna">
          {logo && !logoQuebrada ? (
            <span className="ini-logo">
              {/* O nome da empresa já está no título ao lado: a logo é só enfeite para quem lê a tela. */}
              {/* eslint-disable-next-line @next/next/no-img-element -- logo em data URI: o next/image não otimiza */}
              <img src={logo} alt="" onError={() => setLogoQuebrada(true)} />
            </span>
          ) : marcaDaEmpresa ? (
            <span className="ini-iniciais" aria-hidden="true">{marcaDaEmpresa}</span>
          ) : (
            <span className="ini-logo"><Logo className="ini-logoSvg" /></span>
          )}
          <div className="ini-quem">
            <h1 className="ini-empresa">{nome}</h1>
            <p className="ini-ola">{saudacao}</p>
          </div>
          <Link href={PLATAFORMA} className="ini-plataforma">Plataforma <ArrowRight size={15} strokeWidth={2.4} aria-hidden="true" /></Link>
        </div>
      </header>

      <div className="ini-corpo">
        {/* Convite ao Portal do Parceiro NEXUS: só com o portal ligado, fechável por usuário */}
        <div className="ini-nexus"><NexusBanner userId={pessoa?.id ?? null} /></div>

        {temEmpresa ? (
          <main>
            {/* O mesmo bloco da grade, em 2 colunas: só o tamanho os distingue */}
            <div className="ini-destaques">{[novaPropostaItem, lerContaItem].map(bloco)}</div>

            <div className="ini-grid">
              {principal.map(bloco)}
              {nexusLigado && bloco(nexusItem)}
            </div>

            <h2 className="ini-grupo">Papelada</h2>
            <div className="ini-grid">{papeladaItems.map(bloco)}</div>
            <button
              type="button"
              className="ini-mais"
              aria-expanded={maisAberto}
              aria-controls="ini-mais-docs"
              onClick={() => setMaisAberto((aberto) => !aberto)}
            >
              <span>Mais documentos</span>
              <ChevronDown size={18} strokeWidth={2.2} className={maisAberto ? 'ini-seta ini-setaAberta' : 'ini-seta'} aria-hidden="true" />
            </button>
            {/* Sempre no DOM (o aria-controls aponta para ele); fechado, fica hidden. */}
            <div id="ini-mais-docs" className="ini-grid ini-gridMais" hidden={!maisAberto}>
              {outrosDocsItems.map(bloco)}
            </div>

            {paraLiberar.length > 0 && (
              <>
                <h2 className="ini-grupo">Para liberar</h2>
                <div className="ini-grid">{paraLiberar.map(bloco)}</div>
                {mostrarLoja && (
                  <Link href={lojaItem.href} className="ini-loja">
                    <LayoutGrid size={18} strokeWidth={2} aria-hidden="true" />
                    <span>{lojaItem.label}</span>
                  </Link>
                )}
              </>
            )}

            {faltaMarca && (
              <section className="ini-cartao ini-cartaoMarca" aria-labelledby="ini-marca-titulo">
                <div>
                  <h2 id="ini-marca-titulo" className="ini-cartaoTitulo">Deixe o app com a sua marca</h2>
                  <p className="ini-cartaoTexto">Escolha a sua logo e a sua cor na tela Empresa.</p>
                </div>
                <Link href="/empresa" className="ini-cartaoLink">Personalizar</Link>
              </section>
            )}
          </main>
        ) : (
          <main>
            <section className="ini-cartao ini-cartaoCadastro" aria-labelledby="ini-cadastro-titulo">
              <h2 id="ini-cadastro-titulo" className="ini-cartaoTitulo">Cadastre a sua empresa e o app fica com a sua cara</h2>
              <p className="ini-cartaoTexto">A sua logo e a sua cor aqui, nas propostas e nos relatórios.</p>
              <Link href="/empresa" className="ini-botao">Cadastrar empresa</Link>
            </section>
          </main>
        )}

        <footer className="ini-rodape">Feito com SolarDoc</footer>
      </div>
    </div>
  );
}

/**
 * Um atalho da grade (e os dois de cima, em 2 colunas). Produto que a pessoa ainda não tem: cadeado e
 * link para onde o produto vende (`hrefVendaDoProduto`, a mesma regra do menu lateral: a página de
 * venda ou, no Kit Off-Grid, a própria ferramenta). Página estática (NEXUS): <a> comum, de página
 * inteira.
 */
function Bloco({ item, travado }: { item: ItemMenu; travado: boolean }) {
  const prod = travado && item.produto ? produtoPorId(item.produto) : null;
  const conteudo = (
    <>
      <span className="ini-tileIcon"><item.icon size={22} strokeWidth={2} aria-hidden="true" /></span>
      <span className="ini-tileLabel">{rotulo(item.label)}</span>
      {prod && <Lock className="ini-tileLock" size={14} strokeWidth={2} aria-label="Bloqueado" />}
      {item.badge && <span className="ini-tileBadge">{item.badge}</span>}
    </>
  );
  if (prod) {
    return (
      <Link href={hrefVendaDoProduto(prod)} className="ini-tile" title={`${prod.nome}: ver o que tem dentro`}>
        {conteudo}
      </Link>
    );
  }
  if (item.paginaInteira) {
    return <a href={item.href} className="ini-tile">{conteudo}</a>;
  }
  return <Link href={item.href} className="ini-tile">{conteudo}</Link>;
}
