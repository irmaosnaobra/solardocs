'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  FileText, Send, Download, Copy, Check, Lock, ArrowRight, ArrowLeft, Sun,
} from 'lucide-react';
import api from '@/services/api';
import { useAcessos } from '@/hooks/useAcessos';
import { prewarmPdf, sharePrewarmedPdf, type PdfAsset } from '@/services/downloadPdf';
import { cpfValido, cnpjValido, maskCnpj } from '@/utils/documento';
import { dimensionar, entradaPadrao, type EntradaOffGrid } from '@/lib/offgrid/engine';
import { hspPiorMes } from '@/lib/offgrid/catalogo';
import { compararAlternativas, type ResultadoComparativo } from '@/lib/offgrid/comparativo';
import { ALTERNATIVAS } from '@/lib/offgrid/constantes';
import { avaliarKitProprio } from '@/lib/offgrid/kitProprio';
import {
  itensIniciais, itensEfetivos, kitDosItens, kitCompleto, custoTotal, precoSugerido,
  itensParaProposta, conferenciaDoKit, type ItemProprio,
} from '@/lib/offgrid/meuEquipamento';
import { pagamentoInicial } from '@/lib/offgrid/pagamento';
import { lerDinheiro, lerNumero, formatarDinheiro } from '@/lib/offgrid/dinheiro';
import { camposDaProposta, type AssinaturaCampos } from '@/lib/offgrid/campos';
import PassoCliente, { type DadosCliente } from './_componentes/PassoCliente';
import PassoConsumo from './_componentes/PassoConsumo';
import KitCasa, { ResumoDoKit, AvisosDoKit } from './_componentes/KitCasa';
import MeuEquipamento from './_componentes/MeuEquipamento';
import FormasPagamento from './_componentes/FormasPagamento';
import MaisOpcoes, { type OpcoesProposta } from './_componentes/MaisOpcoes';
import OfertaAddon from './_componentes/OfertaAddon';
import { useComprar } from '@/components/CheckoutAdicional/useComprar';
import { brl, nb, tempoHumano, TODOS_BANCOS, type Orcamento, type DocGerado } from './_componentes/util';
import './offgrid.css';
import './offgrid-passos.css';

// Analytics de uso (NÃO abate crédito). Fail-silent: nunca trava a UX.
function logUso(event_type: string) {
  api.post('/feature-events', { feature: 'offgrid', event_type }).catch(() => {});
}

const PASSOS = ['Cliente e CEP', 'O que vai ligar', 'Kit, preço e proposta'] as const;

type Acesso = 'desconhecido' | 'liberado' | 'trancado';
type Equip = 'kit' | 'proprio';

const errosDe = (err: unknown) =>
  err as { response?: { status?: number; data?: { error?: string; motivo?: string; preco_addon?: number } } };

export default function OffGridPage() {
  const [e, setE] = useState<EntradaOffGrid>(entradaPadrao);
  const { carregando: acessosCarregando, bastidor } = useAcessos();
  const router = useRouter();
  useEffect(() => {
    if (!acessosCarregando && !bastidor) router.replace('/dashboard');
  }, [acessosCarregando, bastidor, router]);

  const [passo, setPasso] = useState<1 | 2 | 3>(1);
  const [equip, setEquip] = useState<Equip>('kit');

  // ── Passo 1: cliente e obra ──
  const [cli, setCli] = useState<DadosCliente>({ nome: '', doc: '', tel: '', cep: '', endereco: '' });
  const [cepErro, setCepErro] = useState(false);
  const [cepInfo, setCepInfo] = useState<{ cidade: string; uf: string } | null>(null);
  const [buscandoCep, setBuscandoCep] = useState(false);

  // ── Preço da casa: vem do servidor ──
  const [orc, setOrc] = useState<Orcamento | null>(null);
  const [acesso, setAcesso] = useState<Acesso>('desconhecido');
  const [precoAddon, setPrecoAddon] = useState(97);
  const [orcando, setOrcando] = useState(false);
  // O orçamento falhou por outro motivo que não o 402 (rede, servidor): sem isso o botão ficaria em "Confirmando..." para sempre.
  const [falhaAcesso, setFalhaAcesso] = useState(false);
  const [releitura, setReleitura] = useState(0);
  // O checkout mora AQUI, fora do `(trancado || oferta)`: quando o Pix cai o acesso libera e a oferta desmonta, e o modal
  // tem que sobreviver para mostrar "Pagamento confirmado" e o upsell. Ao confirmar, relê o acesso e solta o cadeado.
  const { abrir: abrirCheckout, modal: modalCheckout } = useComprar(() => setReleitura((n) => n + 1));
  const [txtKit, setTxtKit] = useState({ inst: '', extras: '', margem: String(entradaPadrao().margemPct) });

  // ── Meu equipamento ──
  const [itens, setItens] = useState<ItemProprio[]>(itensIniciais);
  const [pf, setPf] = useState<{ auto: boolean; texto: string }>({ auto: true, texto: '' });

  // ── Pagamento e opções da proposta ──
  const [pag, setPag] = useState(pagamentoInicial);
  const [op, setOp] = useState<OpcoesProposta>({
    validadeDias: 7,
    incluirComparativo: true,
    distancia: '',
    precoMetro: formatarDinheiro(ALTERNATIVAS.REDE_POR_METRO),
    tarifa: '1,05',
    transformador: false,
    dadosBancarios: false,
    bancos: [...TODOS_BANCOS],
    aceite: false,
    emp: { razao_social: '', cnpj: '', representante: '', cargo: 'Sócio administrador' },
    local: '',
  });
  // A página do comparativo é opcional de propósito: quando a rede ganha a conta, imprimir isso mata a venda. Some a
  // página, o número nunca é maquiado. Sugere incluir quando o off-grid ganha, até a pessoa mexer.
  const tocouComparativo = useRef(false);

  // ── Envio ──
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ txt: string; ok: boolean } | null>(null);
  const [oferta, setOferta] = useState<string | null>(null);
  const [doc, setDoc] = useState<DocGerado | null>(null);
  const [pdfAsset, setPdfAsset] = useState<PdfAsset | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [pedido, setPedido] = useState(false);
  const [obs, setObs] = useState('');

  const r = useMemo(() => dimensionar(e), [e]);
  const set = <K extends keyof EntradaOffGrid>(k: K, v: EntradaOffGrid[K]) => setE((prev) => ({ ...prev, [k]: v }));

  // ── Soltar o cadeado sozinho: quem foi pagar noutra aba e volta repete o orçamento (que devolve 402 ou 200), no
  // máximo a cada 10 s e só enquanto estiver trancado. O webhook da Kiwify chega alguns segundos depois do pagamento,
  // então depois da volta repete a cada 15 s por até 2 minutos.
  const trancado = acesso === 'trancado';
  useEffect(() => {
    if (!trancado) return;
    let ultima = Date.now();
    let timer: ReturnType<typeof setInterval> | null = null;
    const parar = () => { if (timer) { clearInterval(timer); timer = null; } };
    const reler = () => { ultima = Date.now(); setReleitura((n) => n + 1); };
    const voltou = () => {
      if (document.visibilityState === 'hidden') { parar(); return; }
      if (Date.now() - ultima < 10_000) return;
      reler();
      parar();
      let vezes = 0;
      timer = setInterval(() => {
        vezes += 1;
        if (vezes > 8 || document.visibilityState === 'hidden') { parar(); return; }
        reler();
      }, 15_000);
    };
    document.addEventListener('visibilitychange', voltou);
    window.addEventListener('focus', voltou);
    return () => {
      parar();
      document.removeEventListener('visibilitychange', voltou);
      window.removeEventListener('focus', voltou);
    };
  }, [trancado]);

  // ── O orçamento roda nos DOIS modos: é ele que devolve o 402 e diz se o acesso existe. O preço da casa só é usado no
  // modo kit, mas o acesso vale para os dois.
  const cepDigitos = cli.cep.replace(/\D/g, '');
  const chaveOrc = JSON.stringify({
    rl: releitura,
    i: r.itens.map((x) => [x.id, x.qtd]), uf: e.uf, p: r.pesoTotal, cep: cepDigitos,
    m: e.margemPct, mo: e.maoDeObra, ex: e.extras, b: r.bancoNominal,
  });
  useEffect(() => {
    if (r.itens.length === 0) { setOrc(null); return; }
    let cancelado = false;
    setOrcando(true);
    setFalhaAcesso(false);
    const t = setTimeout(() => {
      api.post('/offgrid/orcar', {
        itens: r.itens.map((x) => ({ id: x.id, nome: x.nome, qtd: x.qtd })),
        cep: cepDigitos,
        uf: e.uf, peso_kg: r.pesoTotal, margem_pct: e.margemPct,
        mao_de_obra: e.maoDeObra, extras: e.extras, banco_kwh: r.bancoNominal,
      })
        .then(({ data }) => {
          if (cancelado) return;
          setAcesso('liberado');
          setFalhaAcesso(false);
          setOferta(null);
          // `itens` chega normalizado AQUI. Uma resposta 200 sem a lista (deploy desencontrado, proxy devolvendo {})
          // fazia o .find estourar e a tela inteira cair. O dimensionamento não depende de preço nenhum.
          setOrc({
            ...data,
            itens: Array.isArray(data?.itens) ? data.itens : [],
            creditoPedido: data?.credito_pedido ?? 0,
          });
        })
        .catch((err: unknown) => {
          if (cancelado) return;
          const x = errosDe(err);
          if (x.response?.status === 402) {
            setAcesso('trancado');
            setOrc(null);
            if (x.response.data?.preco_addon) setPrecoAddon(x.response.data.preco_addon);
          } else {
            setFalhaAcesso(true);
          }
        })
        .finally(() => { if (!cancelado) setOrcando(false); });
    }, 450);
    return () => { cancelado = true; clearTimeout(t); setOrcando(false); };
    // A chave serializa tudo que o orçamento lê; listar cada campo aqui só repetiria a chave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveOrc]);

  // ── CEP completo: ViaCEP preenche estado e cidade. O frete o servidor recalcula por conta própria.
  useEffect(() => {
    if (cepDigitos.length !== 8) { setCepInfo(null); return; }
    let cancelado = false;
    setBuscandoCep(true);
    fetch(`https://viacep.com.br/ws/${cepDigitos}/json/`)
      .then((resp) => resp.json())
      .then((j: { localidade?: string; uf?: string; erro?: boolean }) => {
        if (cancelado || j.erro || !j.localidade) { setCepInfo(null); return; }
        setCepInfo({ cidade: j.localidade, uf: j.uf || '' });
        setE((prev) => ({ ...prev, uf: j.uf || prev.uf, cidade: j.localidade }));
      })
      .catch(() => { if (!cancelado) setCepInfo(null); })
      .finally(() => { if (!cancelado) setBuscandoCep(false); });
    return () => { cancelado = true; };
  }, [cepDigitos]);

  // ── Cadastro da empresa: preenche o que está VAZIO na assinatura da empresa ──
  useEffect(() => {
    api.get('/company').then(({ data }) => {
      const c = (data?.company || {}) as Record<string, string>;
      setOp((p) => ({
        ...p,
        emp: {
          razao_social: p.emp.razao_social || String(c.nome || '').trim(),
          cnpj: p.emp.cnpj || maskCnpj(String(c.cnpj || '')),
          representante: p.emp.representante || String(c.socio_adm || '').trim(),
          cargo: p.emp.cargo || 'Sócio administrador',
        },
        local: p.local || String(c.cidade || '').trim(),
      }));
    }).catch(() => {});
  }, []);

  // ── Analytics: 'open' 1× ao abrir ──
  const openLogged = useRef(false);
  useEffect(() => {
    if (openLogged.current) return;
    openLogged.current = true;
    logUso('open');
  }, []);

  // ── Meu equipamento: itens com a sugestão preenchida, o kit dele, a conferência e o preço ──
  const efetivos = useMemo(() => itensEfetivos(itens, r.requisitos), [itens, r.requisitos]);
  const kit = useMemo(() => kitDosItens(efetivos), [efetivos]);
  const av = useMemo(() => (r.requisitos ? avaliarKitProprio(r, kit) : null), [r, kit]);
  const conf = useMemo(
    () => (r.requisitos && av ? conferenciaDoKit(r.requisitos, kit, av) : null),
    [r.requisitos, kit, av],
  );
  const custo = custoTotal(efetivos);
  const precoProprio = pf.auto ? precoSugerido(custo) : lerDinheiro(pf.texto);
  const proprio = equip === 'proprio';

  // ── Preço que vale para a proposta ──
  const precoCasa = !trancado ? (orc?.precoCliente ?? 0) : 0;
  const precoBase = proprio ? precoProprio : precoCasa;
  const bancoParaComparar = proprio && av ? av.bancoNominalKwh : r.bancoNominal;

  const cmp: ResultadoComparativo = useMemo(() => compararAlternativas({
    consumoDiaKwh: r.consumoTotalDia,
    investimentoOffGrid: precoBase,
    bancoKwh: bancoParaComparar,
    distanciaRedeM: lerDinheiro(op.distancia),
    precoMetroRede: lerDinheiro(op.precoMetro) || ALTERNATIVAS.REDE_POR_METRO,
    precisaTransformador: op.transformador,
    tarifaKwh: lerNumero(op.tarifa) || 1.05,
  }), [r.consumoTotalDia, precoBase, bancoParaComparar, op.distancia, op.precoMetro, op.transformador, op.tarifa]);

  useEffect(() => {
    if (tocouComparativo.current) return;
    setOp((p) => (p.incluirComparativo === (cmp.vencedor === 'offgrid') ? p : { ...p, incluirComparativo: cmp.vencedor === 'offgrid' }));
  }, [cmp.vencedor]);

  const calcLogged = useRef(false);
  useEffect(() => {
    if (calcLogged.current) return;
    if (r.consumoTotalDia > 0 && precoBase > 0) {
      calcLogged.current = true;
      logUso('calc');
    }
  }, [r.consumoTotalDia, precoBase]);

  // Pré-aquece o PDF quando a proposta fica pronta (transient activation do iOS).
  useEffect(() => {
    const id = doc?.doc_id;
    if (!id) { setPdfAsset(null); return; }
    let cancelado = false;
    prewarmPdf(id)
      .then((a) => { if (!cancelado) setPdfAsset(a); })
      .catch(() => { if (!cancelado) setPdfAsset(null); });
    return () => { cancelado = true; };
  }, [doc?.doc_id]);

  // ── Aceite: a mesma conferência do servidor, para a frase sair antes de gastar a geração ──
  const docEhCnpj = /[A-Za-z]/.test(cli.doc) || cli.doc.replace(/\D/g, '').length > 11;
  const erroAceite = useMemo((): string | null => {
    if (!op.aceite) return null;
    const nome = cli.nome.trim();
    if (docEhCnpj) {
      if (nome.length < 3) return 'Escreva a razão social do cliente no passo 1.';
      if (!cnpjValido(cli.doc)) return 'CNPJ do cliente inválido. Confira os números no passo 1.';
    } else {
      if (nome.split(' ').filter(Boolean).length < 2) return 'Escreva o nome completo do cliente no passo 1.';
      if (!cpfValido(cli.doc)) return 'CPF do cliente inválido. Confira os números no passo 1.';
    }
    if (op.emp.razao_social.trim().length < 3) return 'Escreva a razão social da sua empresa.';
    if (!cnpjValido(op.emp.cnpj)) return 'CNPJ da sua empresa inválido. Confira os números.';
    if (op.emp.representante.trim().length < 2) return 'Escreva quem assina pela sua empresa.';
    return null;
  }, [op.aceite, op.emp, cli.nome, cli.doc, docEhCnpj]);

  const hsp = hspPiorMes(e.uf, e.cidade);
  const semConsumo = r.consumoTotalDia <= 0;

  // ── Navegação entre os passos ──
  function irPara(n: 1 | 2 | 3) {
    if (n > passo && passo === 1 && cepDigitos.length !== 8) {
      setCepErro(true);
      setTimeout(() => document.getElementById('og-cep')?.focus(), 0);
      return;
    }
    setCepErro(false);
    setMsg(null);
    setPasso(n);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Gerar a proposta do cliente ──
  async function gerarProposta() {
    setMsg(null);
    if (!cli.nome.trim()) { setPasso(1); setMsg({ txt: 'Informe o nome do cliente.', ok: false }); return; }
    if (acesso !== 'liberado') return;
    if (proprio) {
      if (!kitCompleto(kit)) {
        setMsg({ txt: 'Preencha a potência e a quantidade do inversor, das placas e das baterias.', ok: false });
        return;
      }
      if (precoProprio <= 0) { setMsg({ txt: 'Informe o preço final para o cliente.', ok: false }); return; }
    } else if (precoCasa <= 0) {
      setMsg({ txt: 'O preço do kit ainda não chegou. Confira o CEP da obra e tente de novo.', ok: false });
      return;
    }
    if (erroAceite) { setMsg({ txt: erroAceite, ok: false }); return; }

    let assinatura: AssinaturaCampos | null = null;
    if (op.aceite) {
      const t = (s: string) => s.trim();
      assinatura = {
        empresa: { razao_social: t(op.emp.razao_social), cnpj: t(op.emp.cnpj), representante: t(op.emp.representante), cargo: t(op.emp.cargo) || 'Sócio administrador' },
        cliente: { tipo: docEhCnpj ? 'PJ' : 'PF', nome: t(cli.nome), documento: t(cli.doc) },
        ...(t(op.local) ? { local: t(op.local) } : {}),
      };
    }

    const fields = camposDaProposta({
      modo: proprio ? 'proprio' : 'casa',
      r, e,
      cidadeObra: (e.cidade || '').trim(),
      endereco: cli.endereco.trim(),
      validadeDias: op.validadeDias,
      preco: precoBase,
      prazoEntrega: orc?.fretePrazo ?? '',
      itensCliente: proprio
        ? itensParaProposta(efetivos)
        : r.itens.map((i) => ({ nome: i.nome, qtd: i.qtd, garantia: i.garantia })),
      kitProprio: proprio && av ? { kit, av } : undefined,
      comparativo: op.incluirComparativo ? { cmp, distanciaM: lerDinheiro(op.distancia) } : null,
      pagamento: pag,
      bancos: op.bancos,
      mostrarDadosBancarios: op.dadosBancarios,
      assinatura,
    });

    setEnviando(true);
    try {
      const { data } = await api.post('/documents/generate', {
        tipo: 'propostaOffGrid',
        cliente_nome_avulso: cli.nome.trim(),
        useTemplate: true,
        modeloNumero: 2,
        fields,
      });
      setDoc(data);
      setOferta(null);
      setMsg({ txt: 'Proposta gerada.', ok: true });
    } catch (err: unknown) {
      const x = errosDe(err);
      if (x.response?.status === 402) {
        // Sem o acesso: mostra a oferta (não um aviso mudo) e trava o botão até o acesso chegar.
        setAcesso('trancado');
        if (x.response.data?.preco_addon) setPrecoAddon(x.response.data.preco_addon);
        setOferta(x.response.data?.motivo || x.response.data?.error || 'A proposta off-grid faz parte do acesso à Venda Off-Grid.');
      } else {
        setMsg({ txt: x.response?.data?.error || 'Não foi possível gerar a proposta.', ok: false });
      }
    } finally {
      setEnviando(false);
    }
  }

  // ── Pedir o kit da casa ──
  async function pedirKit() {
    setEnviando(true); setMsg(null);
    try {
      const observacao = [obs.trim(), cli.tel.trim() ? `Telefone do cliente: ${cli.tel.trim()}` : ''].filter(Boolean).join('. ');
      await api.post('/offgrid/pedido', {
        cliente_nome: cli.nome.trim() || null,
        cidade: (e.cidade || '').trim() || null,
        uf: e.uf,
        observacao: observacao || null,
        resumo: {
          kwp: r.kwp, modulos: r.qtdModulos, banco_kwh: r.bancoNominal,
          baterias: `${r.qtdBaterias}× ${r.bateria.nome}`, inversor: r.inversor.nome,
          tensao: r.tensao, autonomia_dias: e.diasAutonomia, autonomia_sobre: e.autonomiaSobre,
          consumo_dia: r.consumoTotalDia, essencial_dia: r.consumoEssencialDia,
        },
        itens: orc?.itens ?? [],
        peso_kg: r.pesoTotal,
        frete: orc?.frete ?? 0,
        custo_fornecimento: orc?.custoFornecimento ?? 0,
        tabela_versao: orc?.tabelaVersao ?? '',
      });
      setMsg({ txt: 'Pedido enviado. A gente responde com o prazo e o pagamento.', ok: true });
      setObs('');
    } catch (err: unknown) {
      setMsg({ txt: errosDe(err).response?.data?.error || 'Não foi possível enviar o pedido.', ok: false });
    } finally {
      setEnviando(false);
    }
  }

  async function baixarPdf() {
    if (!doc?.doc_id) return;
    if (pdfAsset) { await sharePrewarmedPdf(pdfAsset); return; }
    try {
      const a = await prewarmPdf(doc.doc_id);
      setPdfAsset(a);
      await sharePrewarmedPdf(a);
    } catch { setMsg({ txt: 'Não foi possível preparar o PDF.', ok: false }); }
  }

  const origem = typeof window !== 'undefined' ? window.location.origin : '';
  const linkPublico = doc
    ? (doc.empresa_slug && doc.codigo_curto
        ? `${origem}/p/${doc.empresa_slug}.${doc.codigo_curto}`
        : `${origem}/p/${doc.doc_id}`)
    : '';

  function copiarLink() {
    if (!linkPublico) return;
    navigator.clipboard.writeText(linkPublico).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    }).catch(() => {});
  }

  const setTextosKit = (
    patch: Partial<{ inst: string; extras: string; margem: string }>,
    valores?: { maoDeObra?: number; extras?: number; margemPct?: number },
  ) => {
    setTxtKit((p) => ({ ...p, ...patch }));
    if (valores) setE((p) => ({ ...p, ...valores }));
  };

  // O botão de gerar fica travado sem consumo, sem o acesso confirmado pelo servidor e durante o envio. A trava lê o
  // acesso do servidor (`acesso`), nunca a prévia de preço.
  const aguardandoAcesso = acesso === 'desconhecido';
  const botaoTravado = semConsumo || enviando || trancado || aguardandoAcesso;

  // ───────────────────────────────────────────────────────────────────────────

  return (
    <div className="og-wrap og2-wrap">
      <header className="og2-topo">
        <div>
          <h1>Venda Off-Grid</h1>
          <p>Monte o kit e a proposta em 3 passos.</p>
        </div>
        {acesso === 'trancado' && <span className="og2-badge">Teste grátis</span>}
        {acesso === 'liberado' && <span className="og2-badge ok"><Check size={13} /> Acesso liberado</span>}
      </header>

      <nav aria-label="Passos">
        <ol className="og2-steps">
          {PASSOS.map((t, i) => {
            const n = (i + 1) as 1 | 2 | 3;
            const cls = n === passo ? 'on' : n < passo ? 'feito' : '';
            return (
              <li key={t}>
                <button type="button" className={cls} aria-current={n === passo ? 'step' : undefined} onClick={() => irPara(n)}>
                  <span className="og2-n">{n < passo ? <Check size={13} strokeWidth={3} /> : n}</span>
                  <span className="og2-t">{t}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="og2-trilha" aria-hidden="true"><i style={{ width: `${(passo / 3) * 100}%` }} /></div>
      </nav>

      {msg && !msg.ok && passo !== 3 && <div className="og-msg og-msg-erro og2-msg" role="alert">{msg.txt}</div>}

      {passo === 1 && (
        <PassoCliente
          d={cli} mudar={(patch) => setCli((p) => ({ ...p, ...patch }))}
          cidade={e.cidade || ''} setCidade={(v) => set('cidade', v)}
          uf={e.uf} setUf={(v) => set('uf', v)}
          cepInfo={cepInfo} buscandoCep={buscandoCep} cepErro={cepErro && cepDigitos.length !== 8} hsp={hsp}
        />
      )}

      {passo === 2 && <PassoConsumo e={e} setE={setE} r={r} />}

      {passo === 3 && (
        <div className="og2-p3">
          <div className="og2-alt" role="group" aria-label="De quem é o equipamento">
            <button type="button" aria-pressed={!proprio} onClick={() => { setEquip('kit'); setMsg(null); }}>Kit Irmãos na Obra</button>
            <button type="button" aria-pressed={proprio} onClick={() => { setEquip('proprio'); setMsg(null); }}>Meu equipamento</button>
          </div>

          {!proprio ? (
            <>
              <ResumoDoKit r={r} />
              <AvisosDoKit r={r} />
              <KitCasa
                r={r} orc={orc} orcando={orcando} trancado={trancado} acessoConhecido={!aguardandoAcesso}
                textos={txtKit} setTextos={setTextosKit} margemPct={e.margemPct}
              />
            </>
          ) : (
            <>
              <MeuEquipamento
                itens={itens} efetivos={efetivos} setItens={setItens} conf={conf}
                custo={custo} preco={precoProprio} pfAuto={pf.auto} pfTexto={pf.texto} setPf={setPf}
              />
              {av && kitCompleto(kit) && !semConsumo && (
                <p className="og-hint og2-mt0">
                  Pelo kit que você lançou, o sistema aguenta <strong>{tempoHumano(av.autonomia.essencialDias)}</strong> sem sol,
                  com o essencial ligado. É esse número que sai na proposta.
                </p>
              )}
            </>
          )}

          <FormasPagamento est={pag} setEst={setPag} preco={precoBase} oculto={trancado && !proprio} />

          <MaisOpcoes
            o={op} setO={setOp} cmp={cmp} onTocouComparativo={() => { tocouComparativo.current = true; }}
            erroAceite={erroAceite} clienteNome={cli.nome} clienteDoc={cli.doc} precoOffGrid={precoBase}
          />

          {(trancado || oferta) && <OfertaAddon preco={precoAddon} motivo={oferta ?? undefined} abrir={abrirCheckout} />}

          {msg && <div className={`og-msg ${msg.ok ? 'og-msg-ok' : 'og-msg-erro'} og2-msg`} role={msg.ok ? 'status' : 'alert'}>{msg.txt}</div>}

          {doc && (
            <section className="og-card og2-pronta" aria-live="polite">
              <h3 className="og2-h3">Proposta pronta</h3>
              <p className="og-hint og2-mt0">Ela fica salva na nuvem, no histórico, por cliente.</p>
              <div className="og2-pronta-bt">
                <button type="button" className="og-btn og-btn-primary" onClick={baixarPdf}><Download size={16} /> Baixar o PDF</button>
                <button type="button" className="og-btn og-btn-ghost" onClick={copiarLink}>
                  {copiado ? <><Check size={16} /> Link copiado</> : <><Copy size={16} /> Copiar o link da proposta</>}
                </button>
                <button type="button" className="og-btn og-btn-ghost" onClick={() => { setDoc(null); setMsg(null); }}>Ajustar e gerar outra</button>
              </div>
            </section>
          )}

          {!doc && (
            <div className="og-acoes og2-acoes">
              <button type="button" className="og-btn og-btn-primary" disabled={botaoTravado} onClick={gerarProposta}>
                {trancado ? <><Lock size={16} /> Gerar proposta Off-grid Completa</>
                  : enviando ? 'Gerando...'
                  : aguardandoAcesso ? 'Confirmando o seu acesso...'
                  : <><FileText size={16} /> Gerar proposta Off-grid Completa</>}
              </button>
              {!proprio && (
                <button type="button" className="og-btn og-btn-ghost" disabled={semConsumo || trancado || aguardandoAcesso || !orc}
                  onClick={() => { setPedido(true); setMsg(null); }}>
                  {trancado ? <><Lock size={16} /> Pedir este kit</> : <><Send size={16} /> Pedir este kit</>}
                </button>
              )}
            </div>
          )}
          {aguardandoAcesso && falhaAcesso && (
            <div className="og-msg og-msg-erro og2-msg" role="alert">
              Não foi possível confirmar o seu acesso agora.{' '}
              <button type="button" className="og2-link" onClick={() => setReleitura((n) => n + 1)}>Tentar de novo</button>
            </div>
          )}
          {trancado && <p className="og-hint og2-centro">Libere o acesso para gerar a proposta{proprio ? '' : ' e pedir o kit'}.</p>}
        </div>
      )}

      <div className="og2-nav">
        <button type="button" className="og-btn og-btn-ghost" disabled={passo === 1} onClick={() => irPara((passo - 1) as 1 | 2 | 3)}>
          <ArrowLeft size={16} /> Voltar
        </button>
        {passo < 3 && (
          <button type="button" className="og-btn og-btn-primary" onClick={() => irPara((passo + 1) as 1 | 2 | 3)}>
            Continuar <ArrowRight size={16} />
          </button>
        )}
      </div>

      {passo === 2 && !semConsumo && (
        <p className="og-hint og2-centro">
          <Sun size={13} /> Pelos aparelhos, o kit da casa aguenta {tempoHumano(r.autonomia.essencialDias)} sem sol, com o essencial ligado
          ({nb(r.consumoEssencialDia)} kWh por dia).
        </p>
      )}

      {/* ═══ PEDIR O KIT ═══ */}
      {pedido && (
        <div className="og-modal-bg" onClick={() => { if (!enviando) { setPedido(false); setMsg(null); } }}>
          <div className="og-modal" role="dialog" aria-modal="true" aria-label="Pedir o kit" onClick={(ev) => ev.stopPropagation()}>
            <h3>Pedir o kit</h3>
            <p>
              Manda para a gente a lista exata deste orçamento. A gente confere a disponibilidade e responde com prazo e
              forma de pagamento.
            </p>
            <div className="og2-resumo-pedido">
              <div className="og-linha"><span>Placas</span><strong>{nb(r.kwp)} kWp · {r.qtdModulos} módulos</strong></div>
              <div className="og-linha"><span>Banco</span><strong>{r.qtdBaterias}× {nb(r.bateria.kwh)} kWh</strong></div>
              <div className="og-linha"><span>Inversor</span><strong>{nb(r.inversor.w / 1000, 1)} kW {r.tensao}V</strong></div>
              <div className="og-linha"><span>Fornecimento + frete</span><strong>{orc ? brl(orc.custoFornecimento) : 'sem preço'}</strong></div>
            </div>
            <div className="og-field og2-mb">
              <label className="og-label" htmlFor="og-ped-cli">Cliente / obra</label>
              <input id="og-ped-cli" className="og-input" type="text" value={cli.nome}
                onChange={(ev) => setCli((p) => ({ ...p, nome: ev.target.value }))} placeholder="para a gente identificar o pedido" />
            </div>
            <div className="og-field">
              <label className="og-label" htmlFor="og-ped-obs">Observação</label>
              <input id="og-ped-obs" className="og-input" type="text" value={obs} onChange={(ev) => setObs(ev.target.value)}
                placeholder="prazo, entrega, troca de marca..." />
            </div>
            {msg && <div className={`og-msg ${msg.ok ? 'og-msg-ok' : 'og-msg-erro'} og2-msg`}>{msg.txt}</div>}
            <div className="og-modal-acoes">
              <button type="button" className="og-btn og-btn-ghost" disabled={enviando} onClick={() => { setPedido(false); setMsg(null); }}>Fechar</button>
              <button type="button" className="og-btn og-btn-primary" disabled={enviando || !!msg?.ok} onClick={pedirKit}>
                {enviando ? 'Enviando...' : 'Enviar pedido'}
              </button>
            </div>
          </div>
        </div>
      )}
      {modalCheckout}
    </div>
  );
}
