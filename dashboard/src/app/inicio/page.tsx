'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Files } from 'lucide-react';
import { isAuthenticated } from '@/services/auth';
import api from '@/services/api';
import { useAcessos } from '@/hooks/useAcessos';
import { useNexusPortal } from '@/hooks/useNexusPortal';
import { produtoPorId } from '@/lib/produtos';
import Logo from '@/components/Logo/Logo';
import NexusBanner from '@/components/NexusBanner/NexusBanner';
import PrimeirosPassos from '@/components/PrimeirosPassos/PrimeirosPassos';
import { usuarioComum } from '@/utils/usuarioComum';
import {
  novaPropostaItem, lerContaItem, lojaItem, nexusItem, papeladaItems, outrosDocsItems,
  hrefVendaDoProduto, organizarMenu, type ItemMenu,
} from '@/components/Sidebar/itensMenu';
import { comAlfa, escurecerAteContraste, paletaDaMarca, type PaletaMarca } from '@/utils/corMarca';
import Recentes, { useRecentes } from './Recentes';
import './inicio.css';

// Tela de atalho (launcher), SÓ no celular.
// Abre quando o app abre (start_url do PWA). No PC redireciona pra plataforma normal
// (comportamento inalterado). De cima para baixo: a faixa da marca, as duas ações principais, os Recentes,
// o convite da NEXUS, as Ferramentas (com os produtos na mesma grade), a Papelada em lista e o rodapé. Os itens
// são os MESMOS do menu lateral (as definições moram em Sidebar/itensMenu.ts) e a tela se veste com a marca
// do assinante: a cor e a logo que ele escolheu na tela Empresa. O menu lateral NÃO pega a cor.
// Dá pra intercalar: "Plataforma" entra no app; o botão de grade no topo do app
// (mobileHeader) volta pra cá.

// Entrada padrão da plataforma (o Gerador é o carro-chefe).
const PLATAFORMA = '/documentos?tipo=proposta';

// O cinza do fundo da tela. É o mesmo valor de --ini-fundo no inicio.css: aqui ele serve para recalcular a cor
// dos textos que ficam direto sobre ele.
const FUNDO_PAGINA = '#F4F5F7';

// A linha de apoio dos dois cartões grandes.
const APOIO_DA_ACAO: Record<string, string> = {
  'nova-proposta': 'Monte e envie em minutos',
  'ler-conta': 'Tire uma foto da conta',
};

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
  /** Usuário comum (não admin, não comprador avulso): o único que vê o quadro "Primeiros passos". */
  comum: boolean;
}

const SEM_PESSOA: Pessoa = { id: null, nome: null, admin: false, comum: false };

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

/** "A, B e C": os nomes dos documentos dobrados em "Mais documentos", lidos da própria lista do menu. */
function listaPt(nomes: string[]): string {
  if (nomes.length <= 1) return nomes.join('');
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

function primeiroNome(nome: unknown): string | null {
  return texto(nome).split(/\s+/)[0] || null;
}

/** Duas letras para o quadrado da empresa sem logo: "Sol Forte Energia" vira "SF"; "Sunlight" vira "SU". */
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
  // O quadradinho translúcido dos cartões grandes clareia a cor da marca: um pouco mais forte quando o texto
  // do cartão é escuro (marca clara), como na referência.
  const textoClaro = p.sobrePrincipal === '#ffffff';
  return {
    '--ini-cor': p.principal,
    '--ini-sobre': p.sobrePrincipal,
    '--ini-pressionada': p.pressionada,
    // A cor escura da marca sobre o BRANCO (ícones das Ferramentas, das linhas e as iniciais).
    '--ini-escura': p.textoSobreBranco,
    // Para o texto que fica direto no cinza da página ("Ver todos"): recalculada contra o cinza, onde a de cima
    // dá uns 4,1:1 em vez de 4,5:1.
    '--ini-escura-pagina': escurecerAteContraste(p.principal, 4.5, FUNDO_PAGINA),
    '--ini-tinta': comAlfa(p.principal, 0.12),
    '--ini-chip': textoClaro ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.4)',
    '--ini-sombra': p.sombra,
    '--ini-titulo': p.titulo,
    // O anel de foco usa a secundária já escurecida até 4,5:1 sobre o branco: sobre o cinza da página dá mais
    // de 4:1, acima dos 3:1 que o anel pede.
    '--ini-anel': p.titulo,
    // Sem contorno, "none" e 0: o cartão fica sem borda, como sempre. Só a marca quase branca ganha 1 px, e o CSS
    // desconta a mesma espessura do padding do cartão para ele não mudar de tamanho por dentro.
    '--ini-borda': p.contorno ? `1px solid ${p.contorno}` : 'none',
    '--ini-borda-w': p.contorno ? '1px' : '0px',
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
  // O quadro "Primeiros passos" substitui os cartões de cadastro e de marca. Se a primeira carga dele falhar, os
  // cartões antigos voltam: sem isso, quem não tem empresa ficaria sem nenhum convite para cadastrar.
  const [quadroFalhou, setQuadroFalhou] = useState(false);
  const aoFalharQuadro = useCallback(() => setQuadroFalhou(true), []);
  const { itens: recentes, pronto: recentesProntos, reserva: reservaRecentes, buscar: buscarRecentes } = useRecentes();

  // Quem decide a etiqueta COMPRAR é o servidor (uma chamada, cacheada no módulo), como no menu lateral. O admin
  // vem das duas chamadas (/auth/me e /produtos/acessos): se uma falhar, a outra ainda o livra da etiqueta.
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
          comum: usuarioComum(u),
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
    buscarRecentes();
  }, [router, carregar, carregarUsuario, buscarRecentes]);

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
  // que o servidor (e a conta) respondem; admin nunca tem etiqueta.
  const acessosCarregando = (previa ? false : carregandoServidor) || pessoa === null;
  const bastidor = previa ? previa.bastidor : bastidorServidor;
  const tem = (produto: string) => (previa ? previa.produtos.has(produto) : temServidor(produto));
  const { principal, paraLiberar, mostrarLoja, travado: travadoNoMenu } = organizarMenu({
    bastidor, carregando: acessosCarregando, isAdmin: !!pessoa?.admin || adminServidor, tem,
  });
  // Sem a ficha do produto no catálogo não há para onde levar a etiqueta: fica o link normal.
  const travado = (item: ItemMenu) => travadoNoMenu(item) && !!item.produto && !!produtoPorId(item.produto);

  const { temEmpresa, nome, logo } = dados;
  const semLogo = !logo || logoQuebrada;
  const marcaDaEmpresa = temEmpresa && semLogo ? iniciais(nome) : '';
  const saudacao = pessoa === null ? '' : pessoa.nome ? `Olá, ${pessoa.nome}` : 'Olá';
  // Sem logo ou sem cor, o convite discreto pra personalizar. Some quando as duas estão preenchidas.
  const faltaMarca = temEmpresa && (semLogo || !paleta.personalizada);
  // Usuário comum tem o quadro no lugar dos cartões de cadastro e de marca; fechado ou com tudo pronto, eles não voltam.
  const cartoesAntigos = !pessoa?.comum || quadroFalhou;
  const quadro = <PrimeirosPassos mostrar={!!pessoa?.comum} userId={pessoa?.id} onFalhou={aoFalharQuadro} />;

  // As Ferramentas: a lista principal do menu, mais o Parceiro NEXUS quando o portal está no ar.
  const ferramentas = nexusLigado ? [...principal, nexusItem] : principal;

  // O convite da NEXUS: o mesmo componente de antes, agora depois dos Recentes. Sem convite ele não ocupa lugar.
  const convite = <div className="ini-nexus"><NexusBanner userId={pessoa?.id ?? null} /></div>;

  return (
    <div className="ini-page" style={variaveis(paleta)}>
      <header className="ini-faixa">
        <div className="ini-faixaInterna">
          {logo && !logoQuebrada ? (
            <span className="ini-logo">
              {/* O nome da empresa já está no título ao lado: a logo é só enfeite para quem lê a tela. */}
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
          <Link href={PLATAFORMA} className="ini-plataforma">Plataforma</Link>
        </div>
      </header>

      <div className="ini-corpo">
        {temEmpresa ? (
          <main>
            {quadro}

            {/* As duas ações principais */}
            <div className="ini-acoes">
              {[novaPropostaItem, lerContaItem].map((item) => <Acao key={item.id} item={item} />)}
            </div>

            {/* Os 3 últimos documentos: reserva o lugar enquanto a lista não chega e some se vier vazia */}
            <Recentes itens={recentes} pronto={recentesProntos} reserva={reservaRecentes} />

            {/* Convite ao Portal do Parceiro NEXUS: só com o portal ligado, fechável por usuário */}
            {convite}

            <section className="ini-secao" aria-labelledby="ini-ferramentas-titulo">
              <h2 id="ini-ferramentas-titulo" className="ini-titulo">Ferramentas</h2>
              <GradeDeFerramentas
                ferramentas={ferramentas}
                produtos={paraLiberar}
                travado={travado}
                mostrarLoja={mostrarLoja}
                carregando={acessosCarregando}
              />
            </section>

            <section className="ini-secao" aria-labelledby="ini-papelada-titulo">
              <h2 id="ini-papelada-titulo" className="ini-titulo">Papelada</h2>
              <div className="ini-cartaoLista">
                <ul className="ini-lista ini-linhas" role="list">
                  {papeladaItems.map((item) => <li key={item.id}><LinhaDeDocumento item={item} /></li>)}
                  <li>
                    <button
                      type="button"
                      className="ini-linha ini-linhaMais"
                      aria-expanded={maisAberto}
                      aria-controls="ini-mais-docs"
                      onClick={() => setMaisAberto((aberto) => !aberto)}
                    >
                      <span className="ini-linhaIcone"><Files size={20} strokeWidth={2} aria-hidden="true" /></span>
                      <span className="ini-linhaTextos">
                        <span className="ini-linhaNome">Mais documentos</span>
                        {!maisAberto && (
                          <span className="ini-linhaApoio">{listaPt(outrosDocsItems.map((item) => item.label))}</span>
                        )}
                      </span>
                      <ChevronDown
                        className={maisAberto ? 'ini-chevron ini-seta ini-setaAberta' : 'ini-chevron ini-seta'}
                        size={18}
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                </ul>
                {/* Sempre no DOM (o aria-controls aponta para ele); fechado, fica hidden. */}
                <ul id="ini-mais-docs" className="ini-lista ini-linhas ini-linhasMais" role="list" hidden={!maisAberto}>
                  {outrosDocsItems.map((item) => <li key={item.id}><LinhaDeDocumento item={item} /></li>)}
                </ul>
              </div>
            </section>

            {faltaMarca && cartoesAntigos && (
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
          <>
            <main>
              {quadro}
              {cartoesAntigos && (
                <section className="ini-cartao ini-cartaoCadastro" aria-labelledby="ini-cadastro-titulo">
                  <h2 id="ini-cadastro-titulo" className="ini-cartaoTitulo">Cadastre a sua empresa e o app fica com a sua cara</h2>
                  <p className="ini-cartaoTexto">A sua logo e a sua cor aqui, nas propostas e nos relatórios.</p>
                  <Link href="/empresa" className="ini-botao">Cadastrar empresa</Link>
                </section>
              )}
            </main>
            {convite}
          </>
        )}

        <footer className="ini-rodape">Feito com SolarDoc</footer>
      </div>
    </div>
  );
}

/** Um dos dois cartões grandes do alto: na cor da marca, com o ícone num quadrado translúcido e a linha de apoio. */
function Acao({ item }: { item: ItemMenu }) {
  return (
    <Link href={item.href} className="ini-acao">
      <span className="ini-acaoIcone"><item.icon size={22} strokeWidth={2.2} aria-hidden="true" /></span>
      <span className="ini-acaoTextos">
        <span className="ini-acaoNome">{item.label}</span>
        <span className="ini-acaoApoio">{APOIO_DA_ACAO[item.id]}</span>
      </span>
    </Link>
  );
}

/**
 * Quanto a grade de Ferramentas ocupou da última vez neste aparelho: quantos cartões e a altura em px. Enquanto
 * a resposta de /produtos/acessos não chega, os cartões de produto ainda não podem ser desenhados (nada de
 * etiqueta piscando para quem pagou); a grade guarda o lugar deles com cartões vazios e com esta altura, para a
 * Papelada não pular quando a resposta chega. Sem registro, vale o caso mais comum (loja aberta, nada comprado):
 * 11 cartões. Opcional: sem localStorage, só os cartões vazios guardam o lugar.
 */
const CHAVE_RESERVA_GRADE = 'ini-ferramentas-reserva';
const RESERVA_PADRAO = { n: 11, h: 0 };

function lerReservaGrade(): { n: number; h: number } {
  try {
    const d = JSON.parse(window.localStorage.getItem(CHAVE_RESERVA_GRADE) || 'null');
    const n = Number(d?.n);
    const h = Number(d?.h);
    if (Number.isInteger(n) && n >= 1 && n <= 30) return { n, h: Number.isFinite(h) && h > 0 && h < 3000 ? h : 0 };
  } catch { /* sem armazenamento ou registro estragado: vale o padrão */ }
  return RESERVA_PADRAO;
}

function guardarReservaGrade(n: number, h: number) {
  try { window.localStorage.setItem(CHAVE_RESERVA_GRADE, JSON.stringify({ n, h: Math.round(h) })); } catch { /* sem armazenamento: sem reserva */ }
}

interface PropsGrade {
  /** A lista principal do menu, mais o Parceiro NEXUS quando o portal está no ar. */
  ferramentas: ItemMenu[];
  /** O grupo "Para liberar" de organizarMenu, na ordem que a função devolve. */
  produtos: ItemMenu[];
  travado: (item: ItemMenu) => boolean;
  mostrarLoja: boolean;
  carregando: boolean;
}

/**
 * Uma grade só, 3 por linha: as ferramentas, depois do Parceiro NEXUS os produtos (quem não tem vê COMPRAR
 * embaixo do nome e o toque leva para onde o produto vende) e, por último, "Ver todos os produtos" tracejado,
 * só quando falta algum produto.
 */
function GradeDeFerramentas({ ferramentas, produtos, travado, mostrarLoja, carregando }: PropsGrade) {
  const grade = useRef<HTMLUListElement>(null);
  const [reserva] = useState(lerReservaGrade);
  const total = ferramentas.length + produtos.length + (mostrarLoja ? 1 : 0);

  // Com tudo desenhado, guarda o tamanho para a próxima abertura.
  useEffect(() => {
    if (carregando || !grade.current) return;
    guardarReservaGrade(total, grade.current.getBoundingClientRect().height);
  }, [carregando, total]);

  const vazios = carregando ? Math.max(0, reserva.n - ferramentas.length) : 0;
  const estilo = carregando && reserva.h ? { minHeight: reserva.h } : undefined;

  return (
    <ul ref={grade} className="ini-lista ini-ferramentas" role="list" aria-busy={carregando || undefined} style={estilo}>
      {ferramentas.map((item) => <li key={item.id}><Ferramenta item={item} /></li>)}
      {produtos.map((item) => <li key={item.id}><Ferramenta item={item} comprar={travado(item)} /></li>)}
      {mostrarLoja && (
        <li>
          <Link href={lojaItem.href} className="ini-ferramenta ini-ferramentaTodos">
            <span className="ini-ferramentaIcone"><lojaItem.icon size={22} strokeWidth={2} aria-hidden="true" /></span>
            <span className="ini-ferramentaNome">{lojaItem.label}</span>
          </Link>
        </li>
      )}
      {Array.from({ length: vazios }, (_, i) => (
        <li key={`vazio-${i}`} aria-hidden="true">
          <span className="ini-ferramenta ini-ferramentaVazia">
            <span className="ini-ferramentaIcone ini-osso" />
            <span className="ini-osso ini-ossoRotulo" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Um cartão da grade de Ferramentas. Produto que a pessoa ainda não tem (`comprar`): o cartão normal, com a
 * etiqueta COMPRAR embaixo do nome, e o toque vai para onde o produto vende (`hrefVendaDoProduto`, a mesma regra
 * do menu lateral: a página de venda ou, no Venda Off-Grid, a própria ferramenta). Com acesso, ou admin: o
 * cartão normal, sem etiqueta. Página estática (NEXUS): <a> comum, de página inteira.
 */
function Ferramenta({ item, comprar = false }: { item: ItemMenu; comprar?: boolean }) {
  // Sem a ficha do produto no catálogo não há para onde levar a etiqueta: fica o link normal.
  const prod = comprar && item.produto ? produtoPorId(item.produto) : null;
  const conteudo = (
    <>
      <span className="ini-ferramentaIcone"><item.icon size={22} strokeWidth={2} aria-hidden="true" /></span>
      <span className="ini-ferramentaNome">{rotulo(item.label)}</span>
      {prod ? <span className="ini-etiqueta ini-comprar">COMPRAR</span>
        : item.badge && <span className="ini-etiqueta ini-selo">{item.badge}</span>}
    </>
  );
  if (prod) {
    return (
      <Link href={hrefVendaDoProduto(prod)} className="ini-ferramenta" title={`${prod.nome}: ver o que tem dentro`}>
        {conteudo}
      </Link>
    );
  }
  if (item.paginaInteira) {
    return <a href={item.href} className="ini-ferramenta">{conteudo}</a>;
  }
  return <Link href={item.href} className="ini-ferramenta">{conteudo}</Link>;
}

/** Uma linha da Papelada (e do "Mais documentos" aberto): ícone na cor escura da marca, nome e seta. */
function LinhaDeDocumento({ item }: { item: ItemMenu }) {
  return (
    <Link href={item.href} className="ini-linha">
      <span className="ini-linhaIcone"><item.icon size={20} strokeWidth={2} aria-hidden="true" /></span>
      <span className="ini-linhaNome">{item.label}</span>
      <ChevronRight className="ini-chevron" size={18} strokeWidth={2} aria-hidden="true" />
    </Link>
  );
}
