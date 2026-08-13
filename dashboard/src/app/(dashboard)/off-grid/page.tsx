'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import {
  BatteryCharging, Package, FileText, Send, AlertTriangle,
  Info, CircleAlert, Download, Copy, Check, Search, ChevronDown, Scale, Lock,
} from 'lucide-react';
import api from '@/services/api';
import { useAcessos } from '@/hooks/useAcessos';
import { prewarmPdf, sharePrewarmedPdf, type PdfAsset } from '@/services/downloadPdf';
import {
  dimensionar, entradaPadrao,
  type EntradaOffGrid, type ResultadoOffGrid, type CargaLivre,
} from '@/lib/offgrid/engine';
import {
  CARGAS, GRUPOS_CARGA, ORDEM_GRUPOS, PERFIS, UFS, hspPiorMes,
  type Carga, type GrupoCarga,
} from '@/lib/offgrid/catalogo';
import {
  compararAlternativas, parcelaCartao, parcelaFinanciamento,
  type ResultadoComparativo,
} from '@/lib/offgrid/comparativo';
import { CONST, CARGAS_BLOQUEADAS, ALTERNATIVAS } from '@/lib/offgrid/constantes';
import './offgrid.css';
import { useRouter } from 'next/navigation';

// Analytics de uso (NÃO abate crédito). Fail-silent: nunca trava a UX.
function logUso(event_type: string) {
  api.post('/feature-events', { feature: 'offgrid', event_type }).catch(() => {});
}

const brl = (n: number) =>
  'R$ ' + Math.round(n || 0).toLocaleString('pt-BR');
const brl2 = (n: number) =>
  (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Dias viram a unidade que o cliente entende: 2,4 dias é "2 dias e 10 horas". */
function tempoHumano(dias: number): string {
  if (!isFinite(dias) || dias <= 0) return '—';
  if (dias < 1) return `${Math.round(dias * 24)} horas`;
  const d = Math.floor(dias);
  const h = Math.round((dias - d) * 24);
  if (h === 0) return `${d} ${d === 1 ? 'dia' : 'dias'}`;
  return `${d} ${d === 1 ? 'dia' : 'dias'} e ${h}h`;
}

/** Número em português: 10.24 vira "10,24". O JS interpola com ponto e o
 *  brasileiro lê isso como dez mil e vinte e quatro. */
const nb = (v: number, casas = 2) =>
  (isFinite(v) ? v : 0).toLocaleString('pt-BR', { maximumFractionDigits: casas });

const num = (v: string) => {
  const n = parseFloat((v || '').replace(/\./g, '').replace(',', '.'));
  return isFinite(n) && n > 0 ? n : 0;
};

/**
 * Checkout do add-on. Vem do env porque o produto é criado na Kiwify pelo dono —
 * enquanto não existir, o botão manda pro WhatsApp e ninguém fica sem caminho.
 */
const LINK_CHECKOUT_ADDON =
  process.env.NEXT_PUBLIC_OFFGRID_CHECKOUT_URL || 'https://pay.kiwify.com.br/Je9pKBV';

/** Grupos que têm pelo menos um aparelho marcado — usado pra abrir a lista. */
function gruposDe(qtds: Record<string, number>): Set<GrupoCarga> {
  const s = new Set<GrupoCarga>();
  for (const c of CARGAS) if ((qtds[c.id] || 0) > 0) s.add(c.grupo);
  return s;
}

/**
 * O dinheiro vem do SERVIDOR (POST /offgrid/orcar). O dimensionamento roda aqui
 * e é aberto pra todo mundo; o preço não desce pro browser de quem não tem
 * acesso — nem escondido no bundle. É isso que faz o cadeado ser cadeado.
 */
interface Orcamento {
  itens: { id: string; nome: string; qtd: number; unitario: number; total: number }[];
  custoEquipamentos: number;
  frete: number;
  freteRegiao: string;
  fretePrazo: string;
  /** Uberlândia → destino, km, peso e R$/kg — a conta na cara do integrador. */
  freteDetalhe?: string;
  custoFornecimento: number;
  maoDeObra: number;
  extras: number;
  margemValor: number;
  precoCliente: number;
  custoKwhArmazenado: number;
  tabelaVersao: string;
  creditoPedido: number;
}

interface DocGerado {
  content: string;
  doc_id: string | null;
  codigo?: string | null;
  codigo_curto?: string | null;
  empresa_slug?: string | null;
}

export default function OffGridPage() {
  const [e, setE] = useState<EntradaOffGrid>(entradaPadrao);
  // E-mail da conta pro checkout casar a compra com quem está logado.
  const { email: emailConta, carregando: acessosCarregando, bastidor } = useAcessos();
  const router = useRouter();
  useEffect(() => {
    if (!acessosCarregando && !bastidor) router.replace('/dashboard');
  }, [acessosCarregando, bastidor, router]);
  const [verAparelhos, setVerAparelhos] = useState(false);
  const [modal, setModal] = useState<'' | 'proposta' | 'pedido'>('');
  const [busca, setBusca] = useState('');
  // Com 70 aparelhos, tudo aberto é uma lista sem fim. Começa aberto só onde já
  // tem item marcado; a busca ignora o colapso e mostra tudo que casar.
  const [abertos, setAbertos] = useState<Set<GrupoCarga>>(() => gruposDe(entradaPadrao().qtds));

  // Campos dos modais
  const [clienteNome, setClienteNome] = useState('');
  const [clienteCidade, setClienteCidade] = useState('');
  const [obs, setObs] = useState('');
  const [validadeDias, setValidadeDias] = useState(7);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ txt: string; ok: boolean } | null>(null);
  const [doc, setDoc] = useState<DocGerado | null>(null);
  const [pdfAsset, setPdfAsset] = useState<PdfAsset | null>(null);
  const [copiado, setCopiado] = useState(false);

  // Comparativo e pagamento vivem fora de EntradaOffGrid: não mexem no
  // dimensionamento, só na conversa comercial.
  const [comp, setComp] = useState<{
    distanciaRedeM: number; precoMetroRede: number; precisaTransformador: boolean; tarifaKwh: number;
  }>({
    distanciaRedeM: 0,
    precoMetroRede: ALTERNATIVAS.REDE_POR_METRO,
    precisaTransformador: false,
    tarifaKwh: 1.05,
  });
  const [pag, setPag] = useState({ cartaoN: 12, finN: 48, finJuros: '2,2' });
  // CEP da OBRA: define o frete (sai de Uberlândia) e preenche estado/cidade,
  // que são o que manda na irradiação. Um campo só pra duas coisas que o
  // integrador teria que digitar de qualquer jeito.
  const [cep, setCep] = useState('');
  const [cepInfo, setCepInfo] = useState<{ cidade: string; uf: string } | null>(null);
  const [buscandoCep, setBuscandoCep] = useState(false);
  // A página do comparativo é opcional de propósito: quando a rede ganha a conta
  // (cliente já tem poste na porta e tarifa baixa), imprimir isso mata a venda —
  // e o motivo de comprar ali é independência, não economia. Some a página, o
  // número nunca é maquiado.
  const [incluirComparativo, setIncluirComparativo] = useState(true);

  const r: ResultadoOffGrid = useMemo(() => dimensionar(e), [e]);

  // ── Preço: vem do servidor, com debounce (a lista muda a cada clique) ──
  const [orc, setOrc] = useState<Orcamento | null>(null);
  const [trancado, setTrancado] = useState(false);
  const [precoAddon, setPrecoAddon] = useState(97);
  const [orcando, setOrcando] = useState(false);

  const chaveOrc = JSON.stringify({
    i: r.itens.map((x) => [x.id, x.qtd]), uf: e.uf, p: r.pesoTotal, cep: cep.replace(/\D/g, ''),
    m: e.margemPct, mo: e.maoDeObra, ex: e.extras, b: r.bancoNominal,
  });
  useEffect(() => {
    if (r.itens.length === 0) { setOrc(null); return; }
    let cancelado = false;
    setOrcando(true);
    const t = setTimeout(() => {
      api.post('/offgrid/orcar', {
        itens: r.itens.map((x) => ({ id: x.id, nome: x.nome, qtd: x.qtd })),
        cep: cep.replace(/\D/g, ''),
        uf: e.uf, peso_kg: r.pesoTotal, margem_pct: e.margemPct,
        mao_de_obra: e.maoDeObra, extras: e.extras, banco_kwh: r.bancoNominal,
      })
        .then(({ data }) => {
          if (cancelado) return;
          setTrancado(false);
          setOrc({ ...data, creditoPedido: data.credito_pedido ?? 0 });
        })
        .catch((err: unknown) => {
          if (cancelado) return;
          const x = err as { response?: { status?: number; data?: { preco_addon?: number } } };
          if (x.response?.status === 402) {
            setTrancado(true);
            setOrc(null);
            if (x.response.data?.preco_addon) setPrecoAddon(x.response.data.preco_addon);
          }
        })
        .finally(() => { if (!cancelado) setOrcando(false); });
    }, 450);
    return () => { cancelado = true; clearTimeout(t); setOrcando(false); };
  }, [chaveOrc]);
  /** 0 = ainda não veio do servidor (ou está trancado). */
  const precoCliente = orc?.precoCliente ?? 0;
  const temPreco = !!orc && precoCliente > 0;

  const cmp: ResultadoComparativo = useMemo(() => compararAlternativas({
    consumoDiaKwh: r.consumoTotalDia,
    investimentoOffGrid: precoCliente,
    bancoKwh: r.bancoNominal,
    distanciaRedeM: comp.distanciaRedeM,
    precoMetroRede: comp.precoMetroRede,
    precisaTransformador: comp.precisaTransformador,
    tarifaKwh: comp.tarifaKwh,
  }), [r.consumoTotalDia, precoCliente, r.bancoNominal, comp]);

  // Parcelas: calculadas AQUI e mandadas prontas pro PDF, como todo o resto.
  const parcelaCartaoLabel = pag.cartaoN > 0 && precoCliente > 0
    ? `${pag.cartaoN}× de ${brl(parcelaCartao(precoCliente, pag.cartaoN))} no cartão`
    : '';
  const parcelaFinLabel = pag.finN > 0 && precoCliente > 0
    ? `${pag.finN}× de ${brl(parcelaFinanciamento(precoCliente, num(pag.finJuros) || 2.2, pag.finN))} financiado`
    : '';
  const set = <K extends keyof EntradaOffGrid>(k: K, v: EntradaOffGrid[K]) =>
    setE((prev) => ({ ...prev, [k]: v }));

  // ── Analytics: 'open' 1× ao abrir, 'calc' 1× quando o kit fica válido ──
  const openLogged = useRef(false);
  const calcLogged = useRef(false);
  useEffect(() => {
    if (openLogged.current) return;
    openLogged.current = true;
    logUso('open');
  }, []);
  // Sugere incluir quando o off-grid ganha a conta; o integrador decide depois.
  const tocouComparativo = useRef(false);
  useEffect(() => {
    if (tocouComparativo.current) return;
    setIncluirComparativo(cmp.vencedor === 'offgrid');
  }, [cmp.vencedor]);

  useEffect(() => {
    if (calcLogged.current) return;
    if (r.consumoTotalDia > 0 && precoCliente > 0) {
      calcLogged.current = true;
      logUso('calc');
    }
  }, [r.consumoTotalDia, precoCliente]);

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

  // CEP completo → ViaCEP preenche estado e cidade. O frete o servidor
  // recalcula por conta própria; isto aqui é só pra tela responder na hora.
  useEffect(() => {
    const d = cep.replace(/\D/g, '');
    if (d.length !== 8) { setCepInfo(null); return; }
    let cancelado = false;
    setBuscandoCep(true);
    fetch(`https://viacep.com.br/ws/${d}/json/`)
      .then((r) => r.json())
      .then((j: { localidade?: string; uf?: string; erro?: boolean }) => {
        if (cancelado || j.erro || !j.localidade) { setCepInfo(null); return; }
        setCepInfo({ cidade: j.localidade, uf: j.uf || '' });
        setE((prev) => ({ ...prev, uf: j.uf || prev.uf, cidade: j.localidade }));
      })
      .catch(() => { if (!cancelado) setCepInfo(null); })
      .finally(() => { if (!cancelado) setBuscandoCep(false); });
    return () => { cancelado = true; };
  }, [cep]);

  const qtdDe = (id: string) => e.qtds[id] || 0;
  const mudaQtd = (id: string, delta: number) => {
    const atual = qtdDe(id);
    const novo = Math.max(0, Math.min(99, atual + delta));
    setE((prev) => ({ ...prev, qtds: { ...prev.qtds, [id]: novo } }));
  };
  const mudaHoras = (id: string, v: string) => {
    const h = parseFloat(v.replace(',', '.'));
    setE((prev) => ({ ...prev, horas: { ...prev.horas, [id]: isFinite(h) && h >= 0 ? h : 0 } }));
  };
  const toggleEss = (c: Carga) => {
    const atual = typeof e.essenciais[c.id] === 'boolean' ? e.essenciais[c.id] : !!c.essencial;
    setE((prev) => ({ ...prev, essenciais: { ...prev.essenciais, [c.id]: !atual } }));
  };

  /** Perfil pronto: substitui a lista inteira (não soma na que já estava). */
  const aplicarPerfil = (qtds: Record<string, number>) => {
    setE((prev) => ({ ...prev, modoConsumo: 'cargas', qtds: { ...qtds }, horas: {}, essenciais: {}, personalizados: [] }));
    setAbertos(gruposDe(qtds));
    setBusca('');
  };
  // ── Aparelho fora do catálogo ──
  const [novo, setNovo] = useState({
    nome: '', w: '', h: '', qtd: '1', motor: false, momentanea: false, essencial: false,
  });
  const addLivre = () => {
    const w = num(novo.w);
    if (!novo.nome.trim() || w <= 0) return;
    const item: CargaLivre = {
      id: `livre-${Date.now()}`,
      nome: novo.nome.trim(),
      w,
      h: Math.max(0, parseFloat((novo.h || '1').replace(',', '.')) || 0),
      qtd: Math.max(1, parseInt(novo.qtd || '1', 10) || 1),
      motor: novo.motor, momentanea: novo.momentanea, essencial: novo.essencial,
    };
    setE((prev) => ({ ...prev, personalizados: [...prev.personalizados, item] }));
    setNovo({ nome: '', w: '', h: '', qtd: '1', motor: false, momentanea: false, essencial: false });
  };
  const mudaLivre = (id: string, patch: Partial<CargaLivre>) =>
    setE((prev) => ({
      ...prev,
      personalizados: prev.personalizados.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  const removeLivre = (id: string) =>
    setE((prev) => ({ ...prev, personalizados: prev.personalizados.filter((p) => p.id !== id) }));

  const toggleGrupo = (g: GrupoCarga) => setAbertos((prev) => {
    const n = new Set(prev);
    if (n.has(g)) n.delete(g); else n.add(g);
    return n;
  });

  const termo = busca
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const casaBusca = (c: Carga) =>
    !termo || c.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(termo);

  const kwhDaCarga = (c: Carga) => {
    const q = e.qtds[c.id] || 0;
    const h = typeof e.horas[c.id] === 'number' ? e.horas[c.id] : c.h;
    return (c.w * q * h) / 1000;
  };
  const marcadosNoGrupo = (g: GrupoCarga) =>
    CARGAS.filter((c) => c.grupo === g && (e.qtds[c.id] || 0) > 0);
  const totalMarcados =
    CARGAS.filter((c) => (e.qtds[c.id] || 0) > 0).length + e.personalizados.length;

  const hsp = hspPiorMes(e.uf, e.cidade);
  const semConsumo = r.consumoTotalDia <= 0;

  // ── Gerar a proposta do cliente ────────────────────────────────────────────
  async function gerarProposta() {
    if (!clienteNome.trim()) { setMsg({ txt: 'Informe o nome do cliente.', ok: false }); return; }
    setEnviando(true); setMsg(null);
    try {
      const { data } = await api.post('/documents/generate', {
        tipo: 'propostaOffGrid',
        cliente_nome_avulso: clienteNome.trim(),
        useTemplate: true,
        modeloNumero: 1,
        fields: {
          ...camposDaProposta(r, e, clienteCidade, validadeDias, precoCliente, orc?.fretePrazo ?? ''),
          // Comparativo e parcelas entram JÁ CALCULADOS. O template imprime, não
          // recalcula — e nenhum destes números deriva do custo de fornecimento.
          ...(incluirComparativo ? {
          comp_anos: cmp.anos,
          comp_opcoes: cmp.opcoes.map((o) => ({
            id: o.id, nome: o.nome, entrada: o.entrada, mensal: o.mensalMedio,
            total: o.total, porKwh: Math.round(o.porKwh * 100) / 100,
            linhas: o.linhas, observacao: o.observacao,
          })),
          comp_economia_rede: cmp.economiaContraRede,
          comp_economia_diesel: cmp.economiaContraDiesel,
          comp_equilibrio_m: cmp.equilibrioMetros,
          comp_vence_na_porta: cmp.venceComRedeNaPorta,
          comp_payback_diesel: cmp.paybackVsDiesel,
          comp_vencedor: cmp.vencedor,
          comp_distancia_m: comp.distanciaRedeM,
          } : {}),
          parcela_cartao: parcelaCartaoLabel,
          parcela_financiamento: parcelaFinLabel,
        },
      });
      setDoc(data);
      setMsg({ txt: 'Proposta gerada.', ok: true });
    } catch (err: unknown) {
      const x = err as { response?: { data?: { error?: string } } };
      setMsg({ txt: x.response?.data?.error || 'Não foi possível gerar a proposta.', ok: false });
    } finally {
      setEnviando(false);
    }
  }

  // ── Pedir o kit ao fornecedor ──────────────────────────────────────────────
  async function pedirKit() {
    setEnviando(true); setMsg(null);
    try {
      await api.post('/offgrid/pedido', {
        cliente_nome: clienteNome.trim() || null,
        cidade: clienteCidade.trim() || null,
        uf: e.uf,
        observacao: obs.trim() || null,
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
      const x = err as { response?: { data?: { error?: string } } };
      setMsg({ txt: x.response?.data?.error || 'Não foi possível enviar o pedido.', ok: false });
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

  const linkPublico = doc
    ? (doc.empresa_slug && doc.codigo_curto
        ? `${typeof window !== 'undefined' ? window.location.origin : ''}/p/${doc.empresa_slug}.${doc.codigo_curto}`
        : `${typeof window !== 'undefined' ? window.location.origin : ''}/p/${doc.codigo || doc.doc_id}`)
    : '';

  function copiarLink() {
    if (!linkPublico) return;
    navigator.clipboard.writeText(linkPublico).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    }).catch(() => {});
  }

  // ───────────────────────────────────────────────────────────────────────────

  return (
    <div className="og-wrap">
      <div className="og-hero">
        <div className="og-selo"><BatteryCharging size={13} /> Kit off-grid{orc ? ` · tabela ${orc.tabelaVersao}` : ''}</div>
        <h1>Orçamento de sistema off-grid na hora</h1>
        <p>
          Marque o que o cliente vai ligar, diga quantos dias precisa aguentar sem sol e o kit sai
          dimensionado e orçado. O fornecimento é nosso: você põe a sua margem e leva a proposta com a
          sua marca.
        </p>
      </div>

      <div className="og-grid">
        {/* ═══ ENTRADAS ═══ */}
        <div className="og-col">
          {/* 1. LOCAL */}
          <div className="og-card">
            <div className="og-card-title"><span className="og-num">1</span> Onde vai instalar</div>
            <div className="og-row">
              <div className="og-field" style={{ flex: '0 0 150px' }}>
                <label className="og-label">CEP da obra</label>
                <input className="og-input" inputMode="numeric" value={cep} placeholder="38400-000"
                  maxLength={9}
                  onChange={(ev) => {
                    const d = ev.target.value.replace(/\D/g, '').slice(0, 8);
                    setCep(d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d);
                  }} />
              </div>
              <div className="og-field" style={{ flex: '0 0 110px' }}>
                <label className="og-label">Estado</label>
                <select className="og-select" value={e.uf} onChange={(ev) => set('uf', ev.target.value)}>
                  {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                </select>
              </div>
              <div className="og-field">
                <label className="og-label">Cidade (opcional)</label>
                <input className="og-input" value={e.cidade || ''} placeholder="Ex.: Uberlândia"
                  onChange={(ev) => set('cidade', ev.target.value)} />
              </div>
            </div>
            {cep.replace(/\D/g, '').length === 8 && (
              <p className="og-hint">
                {buscandoCep ? 'Buscando o CEP...'
                  : cepInfo ? <>Entrega em <strong>{cepInfo.cidade}/{cepInfo.uf}</strong> — o frete sai de Uberlândia e entra no orçamento.</>
                  : 'CEP não encontrado. Confira o número ou preencha estado e cidade na mão.'}
              </p>
            )}
            <p className="og-hint">
              Sol em {hsp.porCidade ? e.cidade : e.uf}: <strong>{nb(hsp.anual)} h/dia</strong> na média do ano
              e <strong>{nb(hsp.pior)} h/dia</strong> no mês pior
              {hsp.porCidade ? ' (medição da cidade)' : ' (média do estado — digite a cidade pra afinar)'}.
              Off-grid não tem rede pra compensar o inverno, por isso o mês pior manda no tamanho do arranjo.
            </p>
          </div>

          {/* 2. CONSUMO */}
          <div className="og-card">
            <div className="og-card-title"><span className="og-num">2</span> O que vai ligar</div>
            <div className="og-tabs">
              <button className={`og-tab ${e.modoConsumo === 'cargas' ? 'on' : ''}`}
                onClick={() => set('modoConsumo', 'cargas')}>Marcar os aparelhos</button>
              <button className={`og-tab ${e.modoConsumo === 'conta' ? 'on' : ''}`}
                onClick={() => set('modoConsumo', 'conta')}>Sei o kWh da conta</button>
            </div>

            {e.modoConsumo === 'conta' ? (
              <>
                <div className="og-row">
                  <div className="og-field">
                    <label className="og-label">Consumo do mês (kWh), sem o chuveiro</label>
                    <input className="og-input" inputMode="decimal" value={e.consumoMensalKwh || ''}
                      onChange={(ev) => set('consumoMensalKwh', num(ev.target.value))} />
                  </div>
                  <div className="og-field">
                    <label className="og-label">Quanto disso é essencial</label>
                    <select className="og-select" value={String(e.fracaoEssencial)}
                      onChange={(ev) => set('fracaoEssencial', parseFloat(ev.target.value))}>
                      <option value="0.3">30% — só geladeira e luz</option>
                      <option value="0.45">45% — geladeira, luz, água, internet</option>
                      <option value="0.6">60% — quase tudo menos conforto</option>
                      <option value="1">100% — a casa inteira</option>
                    </select>
                  </div>
                </div>
                <div className="og-field" style={{ marginTop: 12 }}>
                  <label className="og-label">Maior motor da instalação</label>
                  <select className="og-select" value={String(e.maiorMotorW)}
                    onChange={(ev) => set('maiorMotorW', parseFloat(ev.target.value))}>
                    <option value="150">Só geladeira</option>
                    <option value="550">Bomba d&apos;água 1/2 cv</option>
                    <option value="750">Ar-condicionado 9.000 BTU</option>
                    <option value="1100">Bomba de 1 cv</option>
                    <option value="2200">Bomba submersa de 2 cv</option>
                  </select>
                </div>
                <p className="og-hint">
                  Motor puxa de 3 a 5× a potência na partida. Sem esse dado o inversor sai pela média e{' '}
                  <strong>desarma quando a bomba liga</strong> — o defeito mais comum em off-grid mal
                  especificado.
                </p>
                <p className="og-hint">
                  O essencial é o que <strong>não pode faltar</strong> nos dias sem sol. É ele que define o
                  tamanho da bateria — e é o que responde a pergunta que o cliente sempre faz. Marcando os
                  aparelhos um a um o número fica bem mais preciso.
                </p>
              </>
            ) : (
              <>
                <div className="og-perfis">
                  <span className="og-perfis-lb">Começar de um pronto</span>
                  <div className="og-chips">
                    {PERFIS.map((p) => (
                      <button key={p.id} className="og-chip" title={p.desc}
                        onClick={() => aplicarPerfil(p.qtds)}>{p.nome}</button>
                    ))}
                    {totalMarcados > 0 && (
                      <button className="og-chip og-chip-limpar" onClick={() => aplicarPerfil({})}>
                        Limpar
                      </button>
                    )}
                  </div>
                </div>

                <div className="og-buscabar">
                  <Search size={15} />
                  <input className="og-buscainput" value={busca} placeholder="Buscar aparelho (ex.: air fryer, bomba, ar)"
                    onChange={(ev) => setBusca(ev.target.value)} />
                  <span className="og-buscacount">
                    {totalMarcados > 0 ? `${totalMarcados} marcado${totalMarcados > 1 ? 's' : ''}` : `${CARGAS.length} aparelhos`}
                  </span>
                </div>

                {ORDEM_GRUPOS.map((g) => {
                  const doGrupo = CARGAS.filter((c) => c.grupo === g && casaBusca(c));
                  if (!doGrupo.length) return null;
                  const marcados = marcadosNoGrupo(g);
                  const kwhGrupo = marcados.reduce((s, c) => s + kwhDaCarga(c), 0);
                  // Busca ativa força tudo aberto; fora dela vale o clique.
                  const aberto = !!termo || abertos.has(g);
                  return (
                  <div className="og-grupo" key={g}>
                    <button className="og-grupo-nome" onClick={() => toggleGrupo(g)}>
                      <ChevronDown size={14} className={aberto ? 'og-chev og-chev-on' : 'og-chev'} />
                      {GRUPOS_CARGA[g]}
                      {marcados.length > 0 && (
                        <span className="og-grupo-tag">
                          {marcados.length} · {kwhGrupo.toFixed(1).replace('.', ',')} kWh/dia
                        </span>
                      )}
                    </button>
                    {aberto && doGrupo.map((c) => {
                      const q = qtdDe(c.id);
                      const h = typeof e.horas[c.id] === 'number' ? e.horas[c.id] : c.h;
                      const ess = typeof e.essenciais[c.id] === 'boolean' ? e.essenciais[c.id] : !!c.essencial;
                      return (
                        <div className={`og-carga ${q > 0 ? 'ativa' : ''}`} key={c.id}>
                          <div>
                            <div className="og-carga-nome">{c.nome}</div>
                            <div className="og-carga-meta">
                              <span>{c.w} W</span>
                              {c.motor && <span className="og-tag" title="Puxa 3 a 5× na partida">motor</span>}
                              {c.momentanea && <span className="og-tag" title="Uso rápido: pesa no pico, quase nada no consumo">uso rápido</span>}
                              {q > 0 && (
                                <>
                                  <span>·</span>
                                  <input className="og-horas" value={String(h).replace('.', ',')}
                                    onChange={(ev) => mudaHoras(c.id, ev.target.value)} />
                                  <span>{c.continuo ? 'h/dia de motor' : 'h/dia'}</span>
                                  <span>·</span>
                                  <span>{((c.w * q * h) / 1000).toFixed(2).replace('.', ',')} kWh/dia</span>
                                </>
                              )}
                            </div>
                          </div>
                          {q > 0 && (
                            <button className={`og-ess ${ess ? 'on' : ''}`} onClick={() => toggleEss(c)}
                              title="Precisa continuar funcionando nos dias sem sol?">
                              {ess ? 'ESSENCIAL' : 'pode faltar'}
                            </button>
                          )}
                          <div className="og-stepper">
                            <button onClick={() => mudaQtd(c.id, -1)} aria-label="menos">−</button>
                            <span>{q}</span>
                            <button onClick={() => mudaQtd(c.id, +1)} aria-label="mais">+</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  );
                })}

                {/* Nenhum catálogo cobre tudo. Aqui entra o que faltar — pela
                    mesma conta, sem atalho. */}
                <div className="og-livre">
                  <div className="og-grupo-nome" style={{ cursor: 'default' }}>Não achou o aparelho?</div>
                  {e.personalizados.map((p) => (
                    <div className="og-carga ativa" key={p.id}>
                      <div>
                        <div className="og-carga-nome">{p.nome || 'Aparelho sem nome'}</div>
                        <div className="og-carga-meta">
                          <span>{p.w} W</span><span>·</span>
                          <span>{String(p.h).replace('.', ',')} h/dia</span><span>·</span>
                          <span>{((p.w * p.qtd * p.h) / 1000).toFixed(2).replace('.', ',')} kWh/dia</span>
                        </div>
                      </div>
                      <button className={`og-ess ${p.essencial ? 'on' : ''}`}
                        onClick={() => mudaLivre(p.id, { essencial: !p.essencial })}>
                        {p.essencial ? 'ESSENCIAL' : 'pode faltar'}
                      </button>
                      <button className="og-ess" onClick={() => removeLivre(p.id)} title="Remover">✕</button>
                    </div>
                  ))}

                  <div className="og-livre-form">
                    <input className="og-input" placeholder="Nome do aparelho" value={novo.nome}
                      onChange={(ev) => setNovo({ ...novo, nome: ev.target.value })} />
                    <input className="og-input" placeholder="Watts" inputMode="decimal" value={novo.w}
                      onChange={(ev) => setNovo({ ...novo, w: ev.target.value })} />
                    <input className="og-input" placeholder="h/dia" inputMode="decimal" value={novo.h}
                      onChange={(ev) => setNovo({ ...novo, h: ev.target.value })} />
                    <input className="og-input" placeholder="Qtd" inputMode="numeric" value={novo.qtd}
                      onChange={(ev) => setNovo({ ...novo, qtd: ev.target.value })} />
                    <button className="og-btn og-btn-ghost" style={{ padding: '9px 14px', fontSize: 13 }}
                      onClick={addLivre}>Adicionar</button>
                  </div>
                  <p className="og-hint">
                    A potência está na etiqueta do aparelho ou no manual. Marque{' '}
                    <strong>motor</strong> se for compressor, bomba ou qualquer coisa que gire — muda a
                    conta do inversor.
                  </p>
                  <div className="og-chips" style={{ marginTop: 8 }}>
                    <button className={`og-chip ${novo.motor ? 'on' : ''}`}
                      onClick={() => setNovo({ ...novo, motor: !novo.motor })}>tem motor</button>
                    <button className={`og-chip ${novo.momentanea ? 'on' : ''}`}
                      onClick={() => setNovo({ ...novo, momentanea: !novo.momentanea })}>uso rápido</button>
                    <button className={`og-chip ${novo.essencial ? 'on' : ''}`}
                      onClick={() => setNovo({ ...novo, essencial: !novo.essencial })}>essencial</button>
                  </div>
                </div>

                <div className="og-resumo-cargas">
                  <div>
                    <span>Consumo total</span>
                    <strong>{nb(r.consumoTotalDia)} kWh/dia</strong>
                  </div>
                  <div>
                    <span>Do essencial</span>
                    <strong>{nb(r.consumoEssencialDia)} kWh/dia</strong>
                  </div>
                  <div>
                    <span>Pico exigido</span>
                    <strong>{(r.demandaPico / 1000).toFixed(1).replace('.', ',')} kW</strong>
                  </div>
                </div>

                <div className="og-bloq">
                  <div className="og-bloq-titulo"><CircleAlert size={14} /> Não entram em off-grid</div>
                  <ul>
                    {CARGAS_BLOQUEADAS.map((b) => (
                      <li key={b.nome}>
                        <strong>{b.nome}</strong> ({b.w.toLocaleString('pt-BR')} W) — troque por {b.saida.toLowerCase()}
                      </li>
                    ))}
                  </ul>
                  <p className="og-hint" style={{ color: '#7F1D1D', marginTop: 8 }}>
                    Um banho de 15 minutos no chuveiro elétrico come 1,4 kWh — um terço de uma bateria
                    inteira. Quem vende isso entrega uma obra que falha na primeira semana.
                  </p>
                </div>
              </>
            )}
          </div>

          {/* 3. AUTONOMIA */}
          <div className="og-card">
            <div className="og-card-title"><span className="og-num">3</span> Quanto tempo sem sol</div>
            <label className="og-label">Dias que o banco precisa segurar</label>
            <div className="og-chips">
              {[1, 2, 3, 4, 5].map((d) => (
                <button key={d} className={`og-chip ${e.diasAutonomia === d ? 'on' : ''}`}
                  onClick={() => set('diasAutonomia', d)}>{d} {d === 1 ? 'dia' : 'dias'}</button>
              ))}
            </div>

            <label className="og-label" style={{ marginTop: 16 }}>Segurando o quê</label>
            <div className="og-chips">
              <button className={`og-chip ${e.autonomiaSobre === 'essencial' ? 'on' : ''}`}
                onClick={() => set('autonomiaSobre', 'essencial')}>Só o essencial</button>
              <button className={`og-chip ${e.autonomiaSobre === 'tudo' ? 'on' : ''}`}
                onClick={() => set('autonomiaSobre', 'tudo')}>A casa inteira</button>
            </div>
            <p className="og-hint">
              Essa é a escolha que mais mexe no preço. Segurar <strong>a casa inteira</strong> por 3 dias
              pode dobrar o kit; segurar <strong>o essencial</strong>{' '}
              (geladeira, luz, água, internet) atende o que o cliente realmente quer dizer com{' '}
              &ldquo;não quero ficar no escuro&rdquo;.
            </p>

            <label className="og-label" style={{ marginTop: 16 }}>Sombra no telhado</label>
            <div className="og-chips">
              {([['nenhuma', 'Sem sombra'], ['leve', 'Sombra leve'], ['media', 'Sombra média']] as const).map(([id, lb]) => (
                <button key={id} className={`og-chip ${e.sombra === id ? 'on' : ''}`}
                  onClick={() => set('sombra', id)}>{lb}</button>
              ))}
            </div>
            <p className="og-hint">
              Árvore, morro, caixa d&apos;água ou o telhado do vizinho. Sombra leve tira 8% da geração;
              média tira 18% e engorda o kit inteiro. <strong>Na dúvida, escolha o nível de cima</strong> —
              a árvore que hoje é pequena vai crescer.
            </p>

            <label className="og-label" style={{ marginTop: 16 }}>Quanto do consumo roda de dia</label>
            <div className="og-chips">
              {([[0.2, 'Quase tudo à noite'], [0.4, 'Metade a metade'], [0.65, 'Maior parte de dia']] as const).map(([v, lb]) => (
                <button key={v} className={`og-chip ${Math.abs(e.fracaoDiurna - v) < 0.01 ? 'on' : ''}`}
                  onClick={() => set('fracaoDiurna', v)}>{lb}</button>
              ))}
            </div>
            <p className="og-hint">
              Bomba e ar ligados com sol na telha não passam pela bateria. Isso <strong>não muda o tamanho
              do banco</strong> (num dia sem sol tudo cai nele), mas muda o desgaste: hoje o banco gira{' '}
              <strong>{Math.round(r.ciclosDia * 100)}% de um ciclo por dia</strong> — quanto menor, mais anos ele dura.
            </p>

            <label className="og-label" style={{ marginTop: 16 }}>Critério do arranjo</label>
            <div className="og-chips">
              <button className={`og-chip ${e.criterioHsp === 'pior' ? 'on' : ''}`}
                onClick={() => set('criterioHsp', 'pior')}>Mês pior (garantido)</button>
              <button className={`og-chip ${e.criterioHsp === 'media' ? 'on' : ''}`}
                onClick={() => set('criterioHsp', 'media')}>Média do ano (mais barato)</button>
            </div>
            <p className="og-hint">
              Pelo <strong>mês pior</strong> o sistema fecha a conta em junho também. Pela{' '}
              <strong>média</strong> o kit sai mais barato — é o que o kit de prateleira faz — mas no
              inverno o banco não recompõe e o cliente sente.
            </p>
          </div>

          {/* 4. PREÇO */}
          <div className="og-card">
            <div className="og-card-title"><span className="og-num">4</span> O seu preço</div>
            <div className="og-row">
              <div className="og-field">
                <label className="og-label">Sua margem (%)</label>
                <input className="og-input" inputMode="decimal" value={e.margemPct || ''}
                  onChange={(ev) => set('margemPct', num(ev.target.value))} />
              </div>
              <div className="og-field">
                <label className="og-label">Instalação / serviço (R$)</label>
                <input className="og-input" inputMode="decimal" value={e.maoDeObra || ''}
                  onChange={(ev) => set('maoDeObra', num(ev.target.value))} placeholder="0" />
              </div>
              <div className="og-field">
                <label className="og-label">Extras (R$)</label>
                <input className="og-input" inputMode="decimal" value={e.extras || ''}
                  onChange={(ev) => set('extras', num(ev.target.value))} placeholder="obra civil, guindaste" />
              </div>
            </div>
            <p className="og-hint">
              A margem incide sobre fornecimento + frete + serviço. O cliente vê{' '}
              <strong>um preço só</strong> na proposta — custo e margem ficam nesta tela, nunca no PDF.
            </p>

            <label className="og-label" style={{ marginTop: 16 }}>Parcelamento que vai na proposta</label>
            <div className="og-row">
              <div className="og-field">
                <label className="og-label" style={{ fontSize: 11 }}>Cartão até</label>
                <select className="og-select" value={String(pag.cartaoN)}
                  onChange={(ev) => setPag({ ...pag, cartaoN: parseInt(ev.target.value, 10) })}>
                  <option value="0">não mostrar</option>
                  {[6, 10, 12, 18, 21].map((n) => <option key={n} value={n}>{n}×</option>)}
                </select>
              </div>
              <div className="og-field">
                <label className="og-label" style={{ fontSize: 11 }}>Financiamento</label>
                <select className="og-select" value={String(pag.finN)}
                  onChange={(ev) => setPag({ ...pag, finN: parseInt(ev.target.value, 10) })}>
                  <option value="0">não mostrar</option>
                  {[36, 48, 60, 84].map((n) => <option key={n} value={n}>{n} meses</option>)}
                </select>
              </div>
              <div className="og-field">
                <label className="og-label" style={{ fontSize: 11 }}>Juros a.m. (%)</label>
                <input className="og-input" inputMode="decimal" value={pag.finJuros}
                  onChange={(ev) => setPag({ ...pag, finJuros: ev.target.value })} />
              </div>
            </div>
            {(parcelaCartaoLabel || parcelaFinLabel) && (
              <p className="og-hint">
                Sai na proposta: {[parcelaFinLabel, parcelaCartaoLabel].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>

          {/* 5. COMPARATIVO */}
          <div className="og-card">
            <div className="og-card-title"><span className="og-num">5</span> Contra o que você está competindo</div>
            <p className="og-hint" style={{ marginTop: 0, marginBottom: 12 }}>
              Ninguém compara off-grid com o telhado do vizinho. Compara com <strong>puxar poste</strong> ou
              com <strong>queimar diesel</strong>. Preencha e a proposta sai com essa conta na mesa.
            </p>
            <div className="og-row">
              <div className="og-field">
                <label className="og-label">Distância até o poste (m)</label>
                <input className="og-input" inputMode="decimal" value={comp.distanciaRedeM || ''}
                  onChange={(ev) => setComp({ ...comp, distanciaRedeM: num(ev.target.value) })} placeholder="0 = já tem rede" />
              </div>
              <div className="og-field">
                <label className="og-label">R$ por metro de rede</label>
                <input className="og-input" inputMode="decimal" value={comp.precoMetroRede || ''}
                  onChange={(ev) => setComp({ ...comp, precoMetroRede: num(ev.target.value) })} />
              </div>
              <div className="og-field">
                <label className="og-label">Tarifa da região (R$/kWh)</label>
                <input className="og-input" inputMode="decimal"
                  value={String(comp.tarifaKwh).replace('.', ',')}
                  onChange={(ev) => setComp({ ...comp, tarifaKwh: num(ev.target.value) })} />
              </div>
            </div>
            <div className="og-chips" style={{ marginTop: 10 }}>
              <button className={`og-chip ${comp.precisaTransformador ? 'on' : ''}`}
                onClick={() => setComp({ ...comp, precisaTransformador: !comp.precisaTransformador })}>
                precisa de transformador
              </button>
            </div>
            <p className="og-hint">
              Orçamentos reais de extensão rural ficaram entre <strong>R$ 118 e R$ 367 o metro</strong> — a
              diferença é o transformador e o terreno. O número oficial só a concessionária dá; este aqui é
              estimativa e a proposta diz isso com todas as letras.
            </p>
          </div>
        </div>

        {/* ═══ RESULTADO ═══ */}
        <div className="og-col og-col-right">
          {/* HERÓI: AUTONOMIA */}
          <div className="og-autonomia">
            <div className="og-aut-topo">Quanto tempo aguenta sem sol</div>
            <div className="og-aut-num">
              <strong>{semConsumo ? '—' : tempoHumano(r.autonomia.essencialDias).split(' ')[0]}</strong>
              <span>
                {semConsumo ? 'marque os aparelhos' : `${tempoHumano(r.autonomia.essencialDias).replace(/^\S+\s/, '')} com o essencial ligado`}
              </span>
            </div>
            <div className="og-aut-sub">
              Banco de <strong>{nb(r.bancoNominal)} kWh</strong> ({r.qtdBaterias}× {nb(r.bateria.kwh)} kWh,{' '}
              {r.tensao}V) — <strong>{nb(r.bancoUtilizavel)} kWh utilizáveis</strong>. Os{' '}
              {nb(r.bancoReserva)} kWh que sobram são a reserva: o inversor corta antes de zerar, é isso que
              faz a bateria durar {CONST.VIDA_ANOS_LIFEPO4}+ anos.
            </div>

            <div className="og-aut-cenarios">
              <div className="og-cen">
                <div>
                  <div className="og-cen-nome">Só o essencial</div>
                  <div className="og-cen-desc">{nb(r.consumoEssencialDia)} kWh/dia · geladeira, luz, água, internet</div>
                </div>
                <div className="og-cen-val">{tempoHumano(r.autonomia.essencialDias)}</div>
              </div>
              {/* Tudo essencial: repetir o mesmo número duas vezes parece erro de conta. */}
              <div className="og-cen">
                <div>
                  <div className="og-cen-nome">
                    {Math.abs(r.autonomia.tudoDias - r.autonomia.essencialDias) < 0.05
                      ? 'Tudo o que está na lista é essencial'
                      : 'A casa inteira'}
                  </div>
                  <div className="og-cen-desc">{nb(r.consumoTotalDia)} kWh/dia · tudo que está marcado</div>
                </div>
                <div className="og-cen-val">{tempoHumano(r.autonomia.tudoDias)}</div>
              </div>
              <div className="og-cen">
                <div>
                  <div className="og-cen-nome">Chovendo o dia todo</div>
                  <div className="og-cen-desc">
                    o painel não para: ainda entrega ~{nb(r.autonomia.geracaoDiaFechado)} kWh/dia
                    ({Math.round(CONST.GERACAO_DIA_FECHADO_FAIXA[0] * 100)}–{Math.round(CONST.GERACAO_DIA_FECHADO_FAIXA[1] * 100)}% de um dia de sol)
                  </div>
                </div>
                <div className="og-cen-val">
                  {r.autonomia.chuvaInfinita ? 'não acaba' : tempoHumano(r.autonomia.chuvaDias)}
                </div>
              </div>
            </div>

            <div className="og-aut-rodape">
              <div className="og-aut-mini">
                <span>Volta a 100% em</span>
                <strong>{r.autonomia.recargaDias > 0 ? tempoHumano(r.autonomia.recargaDias) + ' de sol' : '—'}</strong>
              </div>
              <div className="og-aut-mini">
                <span>Custo do kWh guardado</span>
                <strong>{orc ? brl2(orc.custoKwhArmazenado) : '— —'}</strong>
              </div>
            </div>

            {r.porAparelho.length > 0 && (
              <>
                <button className="og-aut-toggle" onClick={() => setVerAparelhos((v) => !v)}>
                  {verAparelhos ? 'Esconder' : 'Ver'} quanto tempo o banco segura cada aparelho sozinho
                </button>
                {verAparelhos && (
                  <div className="og-aparelhos">
                    {r.porAparelho.map((a) => (
                      <div className="og-ap" key={a.nome}>
                        <span>{a.nome} ({a.w} W)</span>
                        <strong>{a.horas >= 48 ? `${Math.round(a.horas / 24)} dias` : `${nb(a.horas, 1)} h`}</strong>
                      </div>
                    ))}
                    <div className="og-ap" style={{ marginTop: 6, opacity: 0.7 }}>
                      <span>Um de cada vez, com o banco cheio.</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* AVISOS */}
          {r.avisos.length > 0 && (
            <div>
              {r.avisos.map((a, i) => (
                <div key={i} className={`og-aviso og-aviso-${a.nivel}`}>
                  {a.nivel === 'erro' ? <CircleAlert size={16} color="#DC2626" style={{ flexShrink: 0, marginTop: 1 }} />
                    : a.nivel === 'atencao' ? <AlertTriangle size={16} color="#B45309" style={{ flexShrink: 0, marginTop: 1 }} />
                    : <Info size={16} color="#1D4ED8" style={{ flexShrink: 0, marginTop: 1 }} />}
                  <div>
                    <div className="og-aviso-titulo">{a.titulo}</div>
                    <div className="og-aviso-texto">{a.texto}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* KIT */}
          <div className="og-card">
            <div className="og-card-title"><Package size={14} /> O kit dimensionado</div>
            <div className="og-tec" style={{ marginBottom: 14 }}>
              <div><span>Arranjo</span><strong>{nb(r.kwp)} kWp · {r.qtdModulos} módulos</strong></div>
              <div><span>Banco</span><strong>{nb(r.bancoNominal)} kWh · {r.tensao}V</strong></div>
              <div><span>Inversor</span><strong>{(r.inversor.w / 1000).toString().replace('.', ',')} kW · {r.inversor.saida}</strong></div>
              <div><span>Área de telhado</span><strong>{nb(r.areaM2, 1)} m²</strong></div>
              <div><span>Gera no mês pior</span><strong>{nb(r.geracaoDiaPior, 1)} kWh/dia</strong></div>
              <div><span>Gera na média</span><strong>{nb(r.geracaoMesMedia, 0)} kWh/mês</strong></div>
              <div>
                <span>Ligação dos módulos</span>
                <strong>{r.arranjo.serie} em série × {r.arranjo.paralelo} string{r.arranjo.paralelo > 1 ? 's' : ''}</strong>
              </div>
              <div>
                <span>Tensão da string</span>
                <strong>{nb(r.arranjo.vocFrio, 0)} V no frio · {nb(r.arranjo.vmpQuente, 0)} V no calor</strong>
              </div>
            </div>
            {r.itens.map((it) => {
              const preco = orc?.itens.find((x) => x.id === it.id);
              return (
                <div className="og-item" key={it.id}>
                  <div>
                    <div className="og-item-nome">{it.nome}</div>
                    <div className="og-item-meta">
                      {it.qtd}×{preco ? ` ${brl(preco.unitario)}` : ''}
                      {it.garantia ? ` · garantia ${it.garantia} anos` : ''}
                    </div>
                  </div>
                  <div className="og-item-val">{preco ? brl(preco.total) : ''}</div>
                </div>
              );
            })}
          </div>

          {/* DINHEIRO — só existe pra quem tem o acesso */}
          {trancado ? (
            <div className="og-card og-trancado">
              <div className="og-trancado-selo"><Lock size={13} /> Acesso ao Kit Off-Grid</div>
              <h3>O kit está dimensionado. Falta o preço.</h3>
              <p>
                O dimensionamento e a autonomia são liberados pra todo mundo — é o cálculo que você
                acabou de ver. O <strong>preço de fornecimento</strong>, a <strong>proposta com a sua
                marca</strong> e o <strong>pedido do kit</strong> fazem parte do acesso.
              </p>
              <div className="og-trancado-preco">
                <strong>{brl(precoAddon)}</strong>
                <span>uma vez, sem mensalidade</span>
              </div>
              <ul className="og-trancado-lista">
                <li>Preço de fornecimento de cada item, com frete até a obra</li>
                <li>Proposta em PDF com a sua logo, sua cor e o seu preço</li>
                <li>Pedido do kit direto pra gente, com o orçamento travado</li>
                <li>
                  <strong>Os {brl(precoAddon)} voltam</strong> como abatimento no seu primeiro pedido de kit
                </li>
              </ul>
              <a className="og-btn og-btn-primary" href={emailConta ? `${LINK_CHECKOUT_ADDON}${LINK_CHECKOUT_ADDON.includes('?') ? '&' : '?'}email=${encodeURIComponent(emailConta)}` : LINK_CHECKOUT_ADDON} target="_blank" rel="noopener noreferrer">
                Liberar meu acesso
              </a>
              <p className="og-hint" style={{ textAlign: 'center' }}>
                Acesso vitalício. Depois de pagar, atualize esta página.
              </p>
            </div>
          ) : (
            <div className="og-card">
              <div className="og-card-title">Sua ficha — o cliente não vê isto</div>
              {!orc ? (
                <p className="og-hint" style={{ margin: 0 }}>
                  {orcando ? 'Calculando o orçamento...' : 'Marque os aparelhos pra ver o orçamento.'}
                </p>
              ) : (
                <>
                  <div className="og-linha"><span>Equipamentos (fornecimento)</span><strong>{brl(orc.custoEquipamentos)}</strong></div>
                  <div className="og-linha">
                    <span>{orc.frete > 0 ? `Frete ${orc.freteRegiao}` : 'Frete'} · {nb(r.pesoTotal, 0)} kg</span>
                    <strong>{orc.frete > 0 ? brl(orc.frete) : '—'}</strong>
                  </div>
                  {orc.frete > 0
                    ? <p className="og-hint" style={{ margin: '2px 0 6px' }}>{orc.freteDetalhe}</p>
                    : <p className="og-hint" style={{ margin: '2px 0 6px', color: 'var(--ink-red)' }}>
                        Informe o CEP da obra pra somar o frete — sem ele o orçamento sai incompleto.
                      </p>}
                  <div className="og-sep" />
                  <div className="og-linha"><span>Você paga pra nós</span><strong>{brl(orc.custoFornecimento)}</strong></div>
                  {orc.maoDeObra > 0 && <div className="og-linha"><span>Sua instalação</span><strong>{brl(orc.maoDeObra)}</strong></div>}
                  {orc.extras > 0 && <div className="og-linha"><span>Extras</span><strong>{brl(orc.extras)}</strong></div>}
                  <div className="og-linha destaque"><span>Sua margem ({e.margemPct}%)</span><strong>{brl(orc.margemValor)}</strong></div>
                  <div className="og-linha total"><span>Preço ao cliente</span><strong>{brl(orc.precoCliente)}</strong></div>
                  {orc.creditoPedido > 0 && (
                    <p className="og-hint">
                      Você tem <strong>{brl(orc.creditoPedido)} de crédito</strong> pra abater no seu primeiro
                      pedido de kit — abatemos na hora de faturar.
                    </p>
                  )}
                  <p className="og-hint">
                    Prazo de entrega {orc.fretePrazo}. Preços da tabela {orc.tabelaVersao} — o pedido trava o
                    valor do dia em que é enviado.
                  </p>
                </>
              )}
            </div>
          )}

          {/* COMPARATIVO */}
          <div className="og-card">
            <div className="og-card-title"><Scale size={14} /> Em {cmp.anos} anos, o que sai mais barato</div>
            {cmp.opcoes.map((o) => (
              <div key={o.id} className={`og-opcao ${o.id === cmp.vencedor ? 'vence' : ''} ${o.id === 'offgrid' ? 'nossa' : ''}`}>
                <div className="og-opcao-topo">
                  <span className="og-opcao-nome">{o.nome}</span>
                  <strong className="og-opcao-total">{brl(o.total)}</strong>
                </div>
                <div className="og-opcao-meta">
                  entrada {brl(o.entrada)} · depois {brl(o.mensalMedio)}/mês · {brl2(o.porKwh)}/kWh
                </div>
              </div>
            ))}
            <div className={`og-linha total ${cmp.vencedor !== 'offgrid' ? 'perdeu' : ''}`} style={{ marginTop: 10 }}>
              <span>{cmp.economiaContraRede > 0 ? 'Economia contra a rede' : 'A rede sai mais barata aqui'}</span>
              <strong>
                {cmp.economiaContraRede > 0
                  ? brl(cmp.economiaContraRede)
                  : `+${brl(Math.abs(cmp.economiaContraRede))}`}
              </strong>
            </div>
            <p className="og-hint">
              {cmp.vencedor !== 'offgrid'
                ? 'Nesta conta o off-grid não ganha no dinheiro — o que ele entrega é independência. Vale desmarcar o comparativo na hora de gerar a proposta.'
                : cmp.venceComRedeNaPorta
                ? `Nesta conta o off-grid ganha até com o poste na porta: em ${cmp.anos} anos só a conta de luz passaria do sistema inteiro.`
                : `O off-grid passa a ser mais barato a partir de ${cmp.equilibrioMetros} m de rede a puxar.`}
              {' '}Contra o diesel, se paga em {cmp.paybackVsDiesel > 0 ? `${cmp.paybackVsDiesel} meses` : 'menos de um mês'}.
            </p>
          </div>

          {/* AÇÕES */}
          <div className="og-acoes">
            <button className="og-btn og-btn-primary" disabled={semConsumo || !temPreco}
              onClick={() => { setModal('proposta'); setMsg(null); setDoc(null); }}>
              {trancado ? <><Lock size={16} /> Proposta faz parte do acesso</> : <><FileText size={16} /> Gerar proposta do cliente</>}
            </button>
            <button className="og-btn og-btn-ghost" disabled={semConsumo || !temPreco}
              onClick={() => { setModal('pedido'); setMsg(null); }}>
              {trancado ? <><Lock size={16} /> Pedido faz parte do acesso</> : <><Send size={16} /> Pedir este kit pra nós</>}
            </button>
          </div>
        </div>
      </div>

      {/* ═══ MODAIS ═══ */}
      {modal && (
        <div className="og-modal-bg" onClick={() => { if (!enviando) { setModal(''); setMsg(null); } }}>
          <div className="og-modal" onClick={(ev) => ev.stopPropagation()}>
            {modal === 'proposta' ? (
              <>
                <h3>Proposta do cliente</h3>
                <p>
                  Sai com a sua marca, o preço final e a explicação da autonomia. Custo de fornecimento
                  e margem não entram no documento.
                </p>
                <div className="og-field" style={{ marginBottom: 12 }}>
                  <label className="og-label">Nome do cliente</label>
                  <input className="og-input" value={clienteNome} autoFocus
                    onChange={(ev) => setClienteNome(ev.target.value)} placeholder="Ex.: José Horácio Lima" />
                </div>
                <div className="og-row">
                  <div className="og-field">
                    <label className="og-label">Cidade da obra (opcional)</label>
                    <input className="og-input" value={clienteCidade}
                      onChange={(ev) => setClienteCidade(ev.target.value)} placeholder="Ex.: Araguari" />
                  </div>
                  <div className="og-field" style={{ flex: '0 0 130px' }}>
                    <label className="og-label">Validade</label>
                    <select className="og-select" value={String(validadeDias)}
                      onChange={(ev) => setValidadeDias(parseInt(ev.target.value, 10))}>
                      <option value="7">7 dias</option>
                      <option value="15">15 dias</option>
                      <option value="30">30 dias</option>
                    </select>
                  </div>
                </div>

                {!doc && (<label className="og-check">
                  <input type="checkbox" checked={incluirComparativo}
                    onChange={(ev) => { tocouComparativo.current = true; setIncluirComparativo(ev.target.checked); }} />
                  <span>
                    Incluir a página do comparativo
                    <em>
                      {cmp.vencedor === 'offgrid'
                        ? ` — o off-grid ganha por ${brl(Math.max(cmp.economiaContraRede, cmp.economiaContraDiesel))} em ${cmp.anos} anos`
                        : ' — atenção: nesta conta a rede sai na frente, a página vai dizer isso'}
                    </em>
                  </span>
                </label>)}

                {doc && (
                  <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button className="og-btn og-btn-primary" onClick={baixarPdf}>
                      <Download size={16} /> Baixar o PDF
                    </button>
                    <button className="og-btn og-btn-ghost" onClick={copiarLink}>
                      {copiado ? <><Check size={16} /> Link copiado</> : <><Copy size={16} /> Copiar o link da proposta</>}
                    </button>
                  </div>
                )}

                {msg && <div className={`og-msg ${msg.ok ? 'og-msg-ok' : 'og-msg-erro'}`} style={{ marginTop: 12 }}>{msg.txt}</div>}

                <div className="og-modal-acoes">
                  <button className="og-btn og-btn-ghost" disabled={enviando}
                    onClick={() => { setModal(''); setMsg(null); }}>Fechar</button>
                  {!doc && (
                    <button className="og-btn og-btn-primary" disabled={enviando} onClick={gerarProposta}>
                      {enviando ? 'Gerando...' : 'Gerar'}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <h3>Pedir o kit</h3>
                <p>
                  Manda pra gente a lista exata deste orçamento. A gente confere a disponibilidade e
                  responde com prazo e forma de pagamento.
                </p>
                <div style={{ background: 'var(--color-surface-2)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
                  <div className="og-linha" style={{ padding: '3px 0' }}><span>Arranjo</span><strong>{nb(r.kwp)} kWp · {r.qtdModulos} módulos</strong></div>
                  <div className="og-linha" style={{ padding: '3px 0' }}><span>Banco</span><strong>{r.qtdBaterias}× {nb(r.bateria.kwh)} kWh</strong></div>
                  <div className="og-linha" style={{ padding: '3px 0' }}><span>Inversor</span><strong>{(r.inversor.w / 1000).toString().replace('.', ',')} kW {r.tensao}V</strong></div>
                  <div className="og-linha" style={{ padding: '3px 0' }}><span>Fornecimento + frete</span><strong>{orc ? brl(orc.custoFornecimento) : '—'}</strong></div>
                </div>
                <div className="og-field" style={{ marginBottom: 12 }}>
                  <label className="og-label">Cliente / obra (opcional)</label>
                  <input className="og-input" value={clienteNome}
                    onChange={(ev) => setClienteNome(ev.target.value)} placeholder="pra gente identificar o pedido" />
                </div>
                <div className="og-field">
                  <label className="og-label">Observação</label>
                  <input className="og-input" value={obs} onChange={(ev) => setObs(ev.target.value)}
                    placeholder="prazo, entrega, troca de marca..." />
                </div>

                {msg && <div className={`og-msg ${msg.ok ? 'og-msg-ok' : 'og-msg-erro'}`} style={{ marginTop: 12 }}>{msg.txt}</div>}

                <div className="og-modal-acoes">
                  <button className="og-btn og-btn-ghost" disabled={enviando}
                    onClick={() => { setModal(''); setMsg(null); }}>Fechar</button>
                  <button className="og-btn og-btn-primary" disabled={enviando || !!msg?.ok} onClick={pedirKit}>
                    {enviando ? 'Enviando...' : 'Enviar pedido'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Números que vão pro template do PDF. O backend NÃO recalcula nada: se
 * recalculasse com constantes próprias, a proposta impressa diria uma autonomia
 * e a tela diria outra. Aqui é a única travessia.
 */
function camposDaProposta(
  r: ResultadoOffGrid,
  e: EntradaOffGrid,
  cidadeObra: string,
  validadeDias: number,
  precoCliente: number,
  prazoEntrega: string,
): Record<string, unknown> {
  return {
    cidade: cidadeObra || e.cidade || '',
    uf: e.uf,
    // Consumo e autonomia
    consumo_dia: r.consumoTotalDia,
    consumo_essencial_dia: r.consumoEssencialDia,
    consumo_mes: r.consumoMensal,
    dias_pedidos: e.diasAutonomia,
    autonomia_sobre: e.autonomiaSobre,
    aut_essencial_dias: r.autonomia.essencialDias,
    aut_tudo_dias: r.autonomia.tudoDias,
    aut_chuva_dias: r.autonomia.chuvaDias,
    aut_chuva_infinita: r.autonomia.chuvaInfinita,
    aut_recarga_dias: r.autonomia.recargaDias,
    geracao_dia_fechado: r.autonomia.geracaoDiaFechado,
    // Kit
    kwp: r.kwp,
    qtd_modulos: r.qtdModulos,
    area_m2: r.areaM2,
    banco_kwh: r.bancoNominal,
    banco_utilizavel: r.bancoUtilizavel,
    banco_reserva: r.bancoReserva,
    qtd_baterias: r.qtdBaterias,
    bateria_nome: r.bateria.nome,
    bateria_garantia: r.bateria.garantia,
    inversor_nome: r.inversor.nome,
    inversor_kw: r.inversor.w / 1000,
    inversor_saida: r.inversor.saida,
    tensao: r.tensao,
    // Geração
    hsp_anual: r.hspAnual,
    hsp_pior: r.hspPior,
    criterio_hsp: r.criterioHsp,
    // Arranjo elétrico — o integrador liga por isto, então vai impresso.
    arranjo_serie: r.arranjo.serie,
    arranjo_paralelo: r.arranjo.paralelo,
    arranjo_voc_frio: r.arranjo.vocFrio,
    arranjo_vmp_quente: r.arranjo.vmpQuente,
    arranjo_corrente: r.arranjo.correnteA,
    arranjo_ok: r.arranjo.ok,
    ciclos_dia: r.ciclosDia,
    sombra: e.sombra,
    geracao_dia_pior: r.geracaoDiaPior,
    geracao_mes_media: r.geracaoMesMedia,
    // Itens que o cliente vê (SEM preço unitário — só o que compõe o sistema)
    itens_cliente: r.itens.map((i) => ({ nome: i.nome, qtd: i.qtd, garantia: i.garantia })),
    // Dinheiro: SÓ o preço final. Custo e margem ficam na tela do integrador.
    investimento: precoCliente,
    prazo_entrega: prazoEntrega,
    validade_dias: validadeDias,
  };
}
