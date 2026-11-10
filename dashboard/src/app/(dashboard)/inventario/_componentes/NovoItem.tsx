'use client';

import { useMemo, useRef, useState } from 'react';
import { lerQuantidade } from '@/lib/estoque/numero';
import { CATALOGO, UNIDADES } from '../catalogo';
import Folha from './Folha';

export interface DadosNovoItem {
  local: string;
  nome: string;
  unidade: string;
  quantidade?: number;
  valor_unitario?: number;
  estoque_minimo?: number;
}

const NOVO = '__novo__';

/**
 * Cadastrar um item. Local novo nasce junto com o primeiro item: o servidor só guarda
 * item (não existe local vazio), então é assim que o local criado à mão não some ao recarregar.
 */
export default function NovoItem({
  locais,
  localInicial,
  onFechar,
  onCriar,
}: {
  locais: string[];
  localInicial?: string;
  onFechar: () => void;
  /** Devolve a mensagem de erro, ou null se deu certo (quem chama fecha a janela). */
  onCriar: (d: DadosNovoItem) => Promise<string | null>;
}) {
  const opcoes = useMemo(() => Array.from(new Set([...CATALOGO.map((l) => l.local), ...locais])), [locais]);
  const [sel, setSel] = useState(localInicial && opcoes.includes(localInicial) ? localInicial : opcoes[0]);
  const [localNovo, setLocalNovo] = useState('');
  const [nome, setNome] = useState('');
  const [unidade, setUnidade] = useState('un');
  const [qtd, setQtd] = useState('');
  const [valor, setValor] = useState('');
  const [min, setMin] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [descartando, setDescartando] = useState(false);
  // Trava síncrona: dois toques rápidos (ou Enter e toque) chegam antes de o estado `enviando` redesenhar.
  const emEnvio = useRef(false);

  const local = sel === NOVO ? localNovo.trim() : sel;
  const sugestoes = CATALOGO.find((l) => l.local === local)?.materiais ?? [];

  const aoDigitarNome = (v: string) => {
    setNome(v);
    const m = sugestoes.find((s) => s.nome === v);
    if (m) setUnidade(m.unidade);
  };

  // Algo preenchido além do que já vinha de fábrica (local inicial e unidade padrão não contam).
  const preenchido = !!(nome.trim() || qtd.trim() || valor.trim() || min.trim() || localNovo.trim());

  // X, Esc e Cancelar passam por aqui. O fundo da tela não fecha este formulário.
  const tentarFechar = () => {
    if (emEnvio.current) return;
    if (preenchido) setDescartando(true);
    else onFechar();
  };

  const enviar = async () => {
    if (emEnvio.current) return;
    if (!local) { setErro('Escolha o local ou digite o nome do novo local.'); return; }
    if (!nome.trim()) { setErro('Digite o nome do item.'); return; }
    const dados: DadosNovoItem = { local: local.slice(0, 60), nome: nome.trim().slice(0, 120), unidade };
    for (const [txt, campo, rotulo] of [
      [qtd, 'quantidade', 'a quantidade'],
      [valor, 'valor_unitario', 'o valor'],
      [min, 'estoque_minimo', 'o mínimo'],
    ] as const) {
      if (!txt.trim()) continue; // vazio: não manda, o servidor usa o padrão
      const n = lerQuantidade(txt);
      if (n == null) { setErro(`Confira ${rotulo}: use só números, por exemplo 1.500 ou 1,5.`); return; }
      dados[campo] = n;
    }
    emEnvio.current = true;
    setEnviando(true);
    setErro('');
    const falha = await onCriar(dados);
    if (falha) { setErro(falha); setEnviando(false); emEnvio.current = false; }
  };

  const enter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') enviar(); };

  return (
    <Folha titulo="Cadastrar um item" subtitulo="Onde está, o que é e quanto tem." onFechar={tentarFechar} fecharNoFundo={false}>
      {descartando ? (
        <>
          <p className="est-dica">Descartar o que você preencheu?</p>
          <div className="est-dois">
            <button type="button" className="est-btn" onClick={() => setDescartando(false)}>Continuar preenchendo</button>
            <button type="button" className="est-btn-sec" onClick={onFechar}>Descartar</button>
          </div>
        </>
      ) : (
      <>
      <label className="est-lbl" htmlFor="est-n-local">Local</label>
      <select id="est-n-local" className="est-in" value={sel} onChange={(e) => setSel(e.target.value)}>
        {opcoes.map((l) => <option key={l} value={l}>{l}</option>)}
        <option value={NOVO}>Novo local ou pessoa...</option>
      </select>
      {sel === NOVO && (
        <>
          <label className="est-lbl" htmlFor="est-n-localnovo">Nome do novo local</label>
          <input id="est-n-localnovo" className="est-in" type="text" maxLength={60} placeholder="Ex.: Almoxarifado, Com o Diego"
            value={localNovo} onChange={(e) => setLocalNovo(e.target.value)} onKeyDown={enter} />
          <p className="est-dica">O local passa a existir junto com este primeiro item.</p>
        </>
      )}

      <label className="est-lbl" htmlFor="est-n-nome">Nome do item</label>
      <input id="est-n-nome" className="est-in" type="text" list="est-sugestoes" maxLength={120} placeholder="Ex.: Parafusadeira"
        value={nome} onChange={(e) => aoDigitarNome(e.target.value)} onKeyDown={enter} />
      <datalist id="est-sugestoes">
        {sugestoes.map((m) => <option key={m.nome} value={m.nome} />)}
      </datalist>

      <div className="est-grade2">
        <div className="est-campo">
          <label className="est-lbl" htmlFor="est-n-qtd">Quantidade</label>
          <input id="est-n-qtd" className="est-in" type="text" inputMode="decimal" autoComplete="off" placeholder="0"
            value={qtd} onChange={(e) => setQtd(e.target.value)} onKeyDown={enter} />
        </div>
        <div className="est-campo">
          <label className="est-lbl" htmlFor="est-n-un">Unidade</label>
          <select id="est-n-un" className="est-in" value={unidade} onChange={(e) => setUnidade(e.target.value)}>
            {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="est-campo">
          <label className="est-lbl" htmlFor="est-n-valor">Valor unitário (R$)</label>
          <input id="est-n-valor" className="est-in" type="text" inputMode="decimal" autoComplete="off" placeholder="0,00"
            value={valor} onChange={(e) => setValor(e.target.value)} onKeyDown={enter} />
        </div>
        <div className="est-campo">
          <label className="est-lbl" htmlFor="est-n-min">Estoque mínimo</label>
          <input id="est-n-min" className="est-in" type="text" inputMode="decimal" autoComplete="off" placeholder="0"
            value={min} onChange={(e) => setMin(e.target.value)} onKeyDown={enter} />
        </div>
      </div>

      {erro && <p className="est-erro-linha" role="alert">{erro}</p>}
      <button type="button" className="est-btn" onClick={enviar} disabled={enviando}>
        {enviando ? 'Salvando...' : 'Cadastrar item'}
      </button>
      <button type="button" className="est-btn-sec cheio" onClick={tentarFechar} disabled={enviando}>
        Cancelar
      </button>
      </>
      )}
    </Folha>
  );
}
