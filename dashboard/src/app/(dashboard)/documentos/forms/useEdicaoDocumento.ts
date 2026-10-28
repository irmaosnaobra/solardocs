'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import api from '@/services/api';

// Edição de documento salva no MESMO registro (mesmo id, mesmo número, mesmo link),
// sem gastar cota. O formulário abre com ?doc=<id>: este hook carrega o documento,
// entrega os campos para o formulário preencher e, ao gerar, chama o regenerate em
// vez do generate. É o mesmo desenho que o PropostaSolarForm usa por conta própria
// (PropostaSolarForm.tsx), só que genérico para os outros tipos.

export interface DocEdicao {
  doc_id: string;
  tipo: string;
  cliente_id: string | null;
  terceiro_id: string | null;
  cliente_nome: string | null;
  // Ilimitado e admin trocam o cliente de um documento; plano com limite não
  // (a trava de verdade é a do servidor, que responde 409 cliente_diferente).
  pode_trocar_cliente: boolean;
  dados_json: Record<string, unknown>;
  modelo_numero: 1 | 2 | 3;
  content: string;
  codigo: string | null;
  codigo_curto: string | null;
}

/** Telemetria de uso da tela de documentos (não abate crédito). */
export function logDocumentos(event_type: string, event_data?: Record<string, unknown>) {
  api.post('/feature-events', { feature: 'documentos', event_type, event_data }).catch(() => {});
}

/** A frase de erro que o servidor mandou (message tem prioridade sobre o código em error). */
export function erroDaApi(err: unknown, padrao: string): string {
  const e = err as { response?: { data?: { error?: string; message?: string } } };
  return e.response?.data?.message || e.response?.data?.error || padrao;
}

/**
 * Copia do dados_json salvo só as chaves que o formulário conhece, com o tipo que ele
 * usa (texto continua texto). Chave que o formulário não tem (os cliente_final_* que o
 * servidor injeta na prestação de serviço, por exemplo) fica de fora: o servidor
 * injeta de novo ao salvar.
 */
export function mesclarCampos<T extends Record<string, unknown>>(atual: T, dados: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...atual };
  for (const k of Object.keys(atual)) {
    if (!(k in dados) || dados[k] == null) continue;
    out[k] = typeof atual[k] === 'string' ? String(dados[k]) : dados[k];
  }
  return out as T;
}

interface Opcoes {
  /** tipo gravado no banco (contratoSolar, procuracao...). O documento aberto tem que ser deste tipo. */
  tipoApi: string;
  /** valor do ?tipo= da tela (contrato-solar...), para o "gerar novo" voltar ao formulário em branco. */
  slug: string;
  /** o formulário preenche seus campos com o documento carregado. */
  aoCarregar: (d: DocEdicao) => void;
}

export function useEdicaoDocumento({ tipoApi, slug, aoCarregar }: Opcoes) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const docParam = searchParams.get('doc');
  const [edicao, setEdicao] = useState<DocEdicao | null>(null);
  const [carregando, setCarregando] = useState(!!docParam);
  const [erroCarga, setErroCarga] = useState('');
  const jaCarregou = useRef(false);
  const aoCarregarRef = useRef(aoCarregar);
  useEffect(() => { aoCarregarRef.current = aoCarregar; });

  useEffect(() => {
    if (!docParam || jaCarregou.current) return;
    jaCarregou.current = true;
    api.get(`/documents/${docParam}/edit`).then(({ data }) => {
      const d = data?.document as DocEdicao | undefined;
      if (!d) throw new Error('sem documento');
      if (d.tipo !== tipoApi) throw new Error('tipo diferente');
      // Documento sem os dados do formulário (antigo ou importado): reemitir por cima
      // escreveria um formulário em branco em cima de um documento bom.
      if (!d.dados_json || !Object.keys(d.dados_json).length) throw new Error('sem dados do formulário');
      setEdicao(d);
      aoCarregarRef.current(d);
      logDocumentos('editar_aberto', { tipo: d.tipo });
    }).catch(() => {
      setErroCarga('Não consegui abrir esse documento para edição. Ele pode ter sido removido, ou é antigo e não guardou os dados do formulário.');
    }).finally(() => setCarregando(false));
  }, [docParam, tipoApi]);

  /** Gera (documento novo, gasta cota) ou salva a edição (mesmo registro, sem cota). */
  async function enviar(payload: Record<string, unknown>) {
    if (edicao) {
      const { data } = await api.post(`/documents/${edicao.doc_id}/regenerate`, payload);
      logDocumentos('editar_salvo', { tipo: edicao.tipo });
      return data;
    }
    const { data } = await api.post('/documents/generate', payload);
    return data;
  }

  return {
    docParam,
    edicao,
    editando: !!edicao,
    carregando,
    erroCarga,
    /** plano com limite: o campo de cliente fica travado em modo edição. */
    travaCliente: !!edicao && !edicao.pode_trocar_cliente,
    enviar,
    cancelar: () => router.push('/historico'),
    /** "Gerar novo" depois de salvar uma edição: recarrega o formulário em branco. */
    novoDocumento: () => window.location.assign(`/documentos?tipo=${slug}`),
  };
}
