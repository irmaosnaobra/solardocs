'use client';

import { useId, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { portfolioApi } from '@/services/api';
import docStyles from '../documentos.module.css';
import styles from './GaleriaPortfolio.module.css';

/** Item de uma galeria. Obra usa `legenda`, empresa usa `nome`, banco usa `nome` (obrigatório)
 *  e a imagem é opcional. `path` é o que o servidor guarda; `url` é só a miniatura da tela. */
export interface ItemGaleria {
  path?: string;
  url?: string;
  legenda?: string;
  nome?: string;
}
export type ImagemObra = { path: string; url?: string; legenda?: string };
export type ImagemEmpresa = { path: string; url?: string; nome?: string };
export type BancoParceiro = { nome: string; path?: string; url?: string };

type Tipo = 'obra' | 'empresa' | 'banco';

interface Props<T extends ItemGaleria> {
  tipo: Tipo;
  titulo: string;
  itens: T[];
  onChange: (itens: T[]) => void;
  max: number;
}

const ACEITOS = ['image/jpeg', 'image/png', 'image/webp'];
const MSG_ERRO = 'Não foi possível enviar a imagem. Tente de novo.';
const MSG_GRANDE = 'Imagem muito grande. Envie uma de até 20 MB.';
const LIMITE_BYTES = 20 * 1024 * 1024;

class ArquivoGrandeError extends Error {}
const mensagemDoErro = (e: unknown) => (e instanceof ArquivoGrandeError ? MSG_GRANDE : MSG_ERRO);

/** Redimensiona pelo maior lado e exporta JPEG. Desenha sobre FUNDO BRANCO antes: logo PNG com
 *  transparência viraria fundo preto no JPEG. */
function comprimir(file: File, maxLado: number, qualidade: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maior = Math.max(img.width, img.height);
        const ratio = maior > maxLado ? maxLado / maior : 1;
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('canvas')); return; }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', qualidade));
      };
      img.onerror = () => reject(new Error('img load'));
      img.src = String(e.target?.result || '');
    };
    reader.onerror = () => reject(new Error('reader'));
    reader.readAsDataURL(file);
  });
}

/** Comprime e envia. Obra: até 1600 px, jpeg 0,82. Empresa e banco (logos): até 600 px, jpeg 0,9. */
async function enviarArquivo(tipo: Tipo, file: File): Promise<{ path: string; url: string }> {
  // Antes de ler e comprimir: arquivo enorme trava celular fraco.
  if (file.size > LIMITE_BYTES) throw new ArquivoGrandeError('grande');
  if (!ACEITOS.includes(file.type)) throw new Error('tipo');
  const dataUrl = tipo === 'obra' ? await comprimir(file, 1600, 0.82) : await comprimir(file, 600, 0.9);
  const { data } = await portfolioApi.enviarImagem(tipo, dataUrl);
  const path = typeof data?.path === 'string' ? data.path : '';
  const url = typeof data?.url === 'string' ? data.url : '';
  if (!path || !url) throw new Error('resposta');
  return { path, url };
}

export default function GaleriaPortfolio<T extends ItemGaleria>({ tipo, titulo, itens, onChange, max }: Props<T>) {
  const base = useId();
  const inputArquivo = useRef<HTMLInputElement>(null);
  const inputLogo = useRef<HTMLInputElement>(null);
  // O envio é assíncrono: duas fotos enviadas juntas terminam em momentos diferentes, e
  // cada uma precisa somar na lista MAIS RECENTE, não na que existia quando ela começou.
  const atual = useRef<T[]>(itens);
  atual.current = itens;
  const commit = (prox: T[]) => { atual.current = prox; onChange(prox); };

  const [pendentes, setPendentes] = useState(0);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [quebradas, setQuebradas] = useState<Set<string>>(new Set());
  // Banco
  const [nomeBanco, setNomeBanco] = useState('');
  const [logoEmEnvio, setLogoEmEnvio] = useState<T[]>([]);
  const alvoLogo = useRef<T | null>(null);

  const ehBanco = tipo === 'banco';
  const textoCampo = tipo === 'obra' ? 'legenda' : 'nome';
  const rotuloCampo = tipo === 'obra' ? 'Legenda' : 'Nome';
  const placeholderCampo = tipo === 'obra' ? 'Ex: Residência em Uberlândia, 8 kWp' : 'Ex: Supermercado Silva';
  const rotuloBotao = tipo === 'obra' ? 'Adicionar foto' : 'Adicionar logo';
  const vagas = max - itens.length - pendentes;

  function evitaEnvioDoFormulario(e: React.KeyboardEvent, acao?: () => void) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    acao?.();
  }

  async function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(e.target.files ?? []);
    e.target.value = ''; // permite escolher o mesmo arquivo de novo
    if (arquivos.length === 0) return;
    setErro('');
    setAviso('');
    if (arquivos.length > vagas) setAviso(`Até ${max} imagens.`);
    const aEnviar = arquivos.slice(0, Math.max(0, vagas));
    if (aEnviar.length === 0) return;
    setPendentes(p => p + aEnviar.length);
    await Promise.all(aEnviar.map(async (file) => {
      try {
        const img = await enviarArquivo(tipo, file);
        const novo = (ehBanco ? { nome: '', ...img } : img) as unknown as T;
        // Nunca passa do limite, mesmo que outro envio tenha terminado antes.
        if (atual.current.length < max) commit([...atual.current, novo]);
      } catch (e) {
        setErro(mensagemDoErro(e));
      } finally {
        setPendentes(p => p - 1);
      }
    }));
  }

  function remover(i: number) {
    setAviso('');
    commit(atual.current.filter((_, j) => j !== i));
  }

  function editarTexto(i: number, valor: string) {
    commit(atual.current.map((it, j) => (j === i ? { ...it, [textoCampo]: valor } : it)));
  }

  // ── Banco ──
  function adicionarBanco() {
    const nome = nomeBanco.trim();
    if (!nome) { setAviso('Informe o nome do banco.'); return; }
    if (atual.current.length + pendentes >= max) { setAviso(`Até ${max} imagens.`); return; }
    setAviso('');
    commit([...atual.current, { nome } as unknown as T]);
    setNomeBanco('');
  }

  function pedirLogo(b: T) {
    alvoLogo.current = b;
    inputLogo.current?.click();
  }

  async function aoEscolherLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const alvo = alvoLogo.current;
    e.target.value = '';
    alvoLogo.current = null;
    if (!file || !alvo) return;
    setErro('');
    setAviso('');
    setLogoEmEnvio(l => [...l, alvo]);
    try {
      const img = await enviarArquivo('banco', file);
      // O nome do banco não é editável, então o objeto continua o mesmo até aqui. Se a
      // pessoa removeu o banco enquanto o logo subia, o logo é descartado.
      const i = atual.current.indexOf(alvo);
      if (i >= 0) commit(atual.current.map((it, j) => (j === i ? { ...it, ...img } : it)));
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setLogoEmEnvio(l => l.filter(x => x !== alvo));
    }
  }

  const idArquivo = `${base}-arquivo`;
  const idNomeBanco = `${base}-nome-banco`;
  const marcarQuebrada = (chave: string) => setQuebradas(q => (q.has(chave) ? q : new Set(q).add(chave)));

  return (
    <div className={styles.raiz}>
      <div className={styles.cabecalho}>
        <h3 className={styles.titulo}>{titulo}</h3>
        <span className={styles.contagem}>{itens.length} de {max}</span>
      </div>

      {ehBanco ? (
        <>
          <div className={styles.novoBanco}>
            <div className={styles.campo}>
              <label htmlFor={idNomeBanco} className={docStyles.label}>Nome do banco</label>
              <input
                id={idNomeBanco}
                type="text"
                value={nomeBanco}
                onChange={e => setNomeBanco(e.target.value)}
                onKeyDown={e => evitaEnvioDoFormulario(e, adicionarBanco)}
                placeholder="Ex: Sicredi"
                maxLength={40}
                className={`input-field ${styles.alvo}`}
              />
            </div>
            <button type="button" className={styles.botao} onClick={adicionarBanco} disabled={vagas <= 0}>
              Adicionar banco
            </button>
          </div>
          <input
            ref={inputLogo}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className={styles.escondido}
            onChange={aoEscolherLogo}
            tabIndex={-1}
            aria-hidden="true"
          />
          {itens.length > 0 && (
            <ul className={styles.listaBancos}>
              {itens.map((b, i) => {
                const enviando = logoEmEnvio.includes(b);
                const temLogo = !!b.url && !quebradas.has(`${tipo}-${b.path ?? i}`);
                return (
                  <li key={`${b.path ?? 'sem'}-${b.nome ?? ''}-${i}`} className={styles.linhaBanco}>
                    <div className={styles.logoBanco}>
                      {enviando ? (
                        <span className={styles.enviando}>Enviando...</span>
                      ) : temLogo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={b.url} alt={`Logo ${b.nome ?? ''}`.trim()} className={styles.imgContida} onError={() => marcarQuebrada(`${tipo}-${b.path ?? i}`)} />
                      ) : (
                        <span className={styles.semLogo}>{b.path ? 'Indisponível' : 'Sem logo'}</span>
                      )}
                    </div>
                    <span className={styles.nomeBanco}>{b.nome || 'Sem nome'}</span>
                    <button type="button" className={styles.botao} onClick={() => pedirLogo(b)} disabled={enviando}>
                      {b.path ? 'Trocar logo' : 'Enviar logo'}
                    </button>
                    <button type="button" className={styles.remover} onClick={() => remover(i)} aria-label={`Remover imagem ${i + 1}`}>
                      <X size={16} aria-hidden="true" /> Remover
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <>
          {(itens.length > 0 || pendentes > 0) && (
            <ul className={styles.grade}>
              {itens.map((it, i) => {
                const idTexto = `${base}-texto-${i}`;
                const chave = `${tipo}-${it.path ?? i}`;
                return (
                  <li key={`${it.path ?? 'sem'}-${i}`} className={styles.cartao}>
                    <div className={`${styles.miniatura} ${tipo === 'empresa' ? styles.contida : styles.coberta}`}>
                      {quebradas.has(chave) || !it.url ? (
                        <span className={styles.semLogo}>Indisponível</span>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.url} alt={`Imagem ${i + 1}`} className={tipo === 'empresa' ? styles.imgContida : styles.imgCoberta} onError={() => marcarQuebrada(chave)} />
                      )}
                      <button type="button" className={styles.remover} onClick={() => remover(i)} aria-label={`Remover imagem ${i + 1}`}>
                        <X size={18} aria-hidden="true" />
                      </button>
                    </div>
                    <div className={styles.campo}>
                      <label htmlFor={idTexto} className={docStyles.label}>{rotuloCampo}</label>
                      <input
                        id={idTexto}
                        type="text"
                        value={it[textoCampo] ?? ''}
                        onChange={e => editarTexto(i, e.target.value)}
                        onKeyDown={e => evitaEnvioDoFormulario(e)}
                        placeholder={placeholderCampo}
                        maxLength={80}
                        className={`input-field ${styles.alvo}`}
                      />
                    </div>
                  </li>
                );
              })}
              {Array.from({ length: pendentes }, (_, k) => (
                <li key={`pendente-${k}`} className={styles.cartao}>
                  <div className={`${styles.miniatura} ${styles.contida}`} role="status">
                    <span className={styles.enviando}>Enviando...</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <input
            id={idArquivo}
            ref={inputArquivo}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className={styles.escondido}
            onChange={aoEscolher}
            tabIndex={-1}
            aria-hidden="true"
          />
          <button type="button" className={styles.adicionar} onClick={() => inputArquivo.current?.click()}>
            <ImagePlus size={18} aria-hidden="true" /> {rotuloBotao}
          </button>
        </>
      )}

      <div aria-live="polite">
        {aviso && <p className={styles.aviso}>{aviso}</p>}
        {erro && <p className={styles.erro} role="alert">{erro}</p>}
      </div>
    </div>
  );
}
