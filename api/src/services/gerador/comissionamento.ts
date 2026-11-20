// ─────────────────────────────────────────────────────────────────────────────
// O COMISSIONAMENTO (19/11/2026): as etapas 7 (Entrega) e 8 (Liberação) numa aba só, com UM botão final, "Concluir e preencher a planilha".
// PURO: sem banco, sem rota e sem relógio. O botão faz o que antes faziam "Concluir a 7" e "Finalizar a obra" (8) juntos: conclui o que ainda não
// estava concluído (o que já passou continua passado), abre a 8 junto com a conclusão da 7 e FECHA A CONTA (`fechada`). O histórico leva as MESMAS
// ações de antes (`concluir` 7, `abrir` 8, `concluir` 8 e `fechar`), porque são elas que os robôs leem (liberação ao cliente, aniversários, avisos).
// ─────────────────────────────────────────────────────────────────────────────
import { etapaAtualCompleta, type EstadoObra } from './jornadaObra';

export type RecusaComissionamento = { recusa: string; http: number };

export function concluirComissionamento(e: EstadoObra, por: string, agora: string): EstadoObra | RecusaComissionamento {
  if (e.fechada) return { recusa: 'A conta desta obra está fechada. Só o Thiago reabre.', http: 409 };
  const atual = etapaAtualCompleta(null, e, null);
  if (atual !== 7 && atual !== 8) return { recusa: 'Esta obra ainda não está no Comissionamento.', http: 409 };
  const etapas = { ...e.etapas };
  const hist: EstadoObra['historico'] = [];
  if (!etapas[7].concluida_em) {
    etapas[7] = { aberta_em: etapas[7].aberta_em ?? agora, concluida_em: agora, concluida_por: por };
    hist.push({ em: agora, por, acao: 'concluir', etapa: 7 });
    if (!etapas[8].aberta_em) { etapas[8] = { ...etapas[8], aberta_em: agora }; hist.push({ em: agora, por, acao: 'abrir', etapa: 8 }); }
  }
  etapas[8] = { aberta_em: etapas[8].aberta_em ?? agora, concluida_em: agora, concluida_por: por };
  hist.push({ em: agora, por, acao: 'concluir', etapa: 8 }, { em: agora, por, acao: 'fechar', etapa: 8 });
  return {
    ...e, etapas, esperando: e.esperando && (e.esperando.etapa === 7 || e.esperando.etapa === 8) ? null : e.esperando,
    fechada: { em: agora, por }, historico: [...e.historico, ...hist].slice(-50),
  };
}
