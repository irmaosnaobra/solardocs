// ─────────────────────────────────────────────────────────────────────────────
// VARREDURA DAS CIDADES NOVAS → "Município-UF"
//
// A gravação já normaliza na entrada (cidadeParaGravar). Esta varredura pega o
// que escapou: ficha criada por caminho que não passa por lá (agente, lote do
// cadastro, gerador, nexus) e qualquer coisa que o desempate pelo DDD ainda não
// resolvia. Roda no /cron/master, olha só os últimos 3 dias e é idempotente:
// linha já no formato, ou que a gente não consegue resolver com segurança, não
// é tocada.
//
// Atenção: o update de `cidade` em `eletroposto_nota1` dispara o trigger
// `trg_eletroposto_nota1_estruturar`, que preenche slugs e `motivo_descarte` nulos com a
// mesma lógica de ficha nova. É esperado, mas quer dizer que a varredura não mexe só na
// coluna `cidade` dessa tabela.
//
// Nunca lança erro. O master roda dezenas de passos juntos, e esta limpeza
// cosmética não pode derrubar nenhum deles.
// ─────────────────────────────────────────────────────────────────────────────
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { lerPaginado } from '../../utils/lerPaginado';
import { cidadeCanonica } from './cidadeCanonica';
import { TABELAS_DE_CIDADE, type TabelaDeCidade } from './cidadeTabelas';

export { TABELAS_DE_CIDADE };

export const JANELA_DIAS = 3;
export const MAX_ATUALIZACOES = 500;
const LOTE = 200;

export interface ResumoCidades {
  lidas: number;
  atualizadas: number;
  falhas: number;
  porTabela: Record<string, { lidas: number; atualizadas: number }>;
}

/** `original` é o valor CRU lido do banco: o update só vale se a coluna ainda estiver assim. */
type Pendente = { tabela: TabelaDeCidade; id: string | number; original: string; valor: string };

export async function normalizarCidadesRecentes(agora: Date = new Date()): Promise<ResumoCidades> {
  const resumo: ResumoCidades = { lidas: 0, atualizadas: 0, falhas: 0, porTabela: {} };
  try {
    const desde = new Date(agora.getTime() - JANELA_DIAS * 24 * 3600 * 1000).toISOString();
    const pendentes: Pendente[] = [];

    for (const t of TABELAS_DE_CIDADE) {
      resumo.porTabela[t.nome] = { lidas: 0, atualizadas: 0 };
      try {
        const linhas = await lerPaginado<Record<string, any>>(`cidades ${t.nome}`, (de, ate) =>
          supabaseGerador.from(t.nome)
            .select(`${t.chave},cidade,${t.telefone}`)
            .gte(t.criada, desde)
            .not('cidade', 'is', null)
            .order(t.chave, { ascending: true })
            .range(de, ate) as any);
        resumo.porTabela[t.nome].lidas = linhas.length;
        resumo.lidas += linhas.length;
        for (const l of linhas) {
          const c = cidadeCanonica(l.cidade, l[t.telefone]);
          if ((c.status === 'ok' || c.status === 'ddd') && c.valor !== l.cidade) {
            pendentes.push({ tabela: t, id: l[t.chave], original: l.cidade, valor: c.valor });
          }
        }
      } catch (err) {
        resumo.falhas++;
        logger.error('cidades-varredura', `leitura de ${t.nome} falhou`, err);
      }
    }

    // Teto da rodada: o resto fica para a próxima, que roda daqui a uma hora.
    const lote = pendentes.slice(0, MAX_ATUALIZACOES);
    const grupos = new Map<string, { tabela: TabelaDeCidade; original: string; valor: string; ids: Array<string | number> }>();
    for (const p of lote) {
      const k = `${p.tabela.nome}\u0000${p.original}\u0000${p.valor}`;
      const g = grupos.get(k) || { tabela: p.tabela, original: p.original, valor: p.valor, ids: [] };
      g.ids.push(p.id);
      grupos.set(k, g);
    }
    for (const g of grupos.values()) {
      for (let i = 0; i < g.ids.length; i += LOTE) {
        const ids = g.ids.slice(i, i + LOTE);
        try {
          // Só mexe onde a cidade ainda é a que a gente leu (um consultor pode ter editado no meio)
          // e conta só as linhas devolvidas: update que a RLS nega volta sem erro e sem linha.
          const { data, error } = await supabaseGerador.from(g.tabela.nome)
            .update({ cidade: g.valor })
            .eq('cidade', g.original)
            .in(g.tabela.chave, ids)
            .select(g.tabela.chave);
          if (error) throw error;
          const feitas = Array.isArray(data) ? data.length : 0;
          resumo.atualizadas += feitas;
          resumo.porTabela[g.tabela.nome].atualizadas += feitas;
        } catch (err) {
          resumo.falhas++;
          logger.error('cidades-varredura', `update em ${g.tabela.nome} falhou`, err);
        }
      }
    }

    logger.info('cidades-varredura',
      `lidas ${resumo.lidas}, atualizadas ${resumo.atualizadas}, falhas ${resumo.falhas}` +
      (pendentes.length > lote.length ? `, ${pendentes.length - lote.length} ficam para a próxima` : '') +
      ` · ${Object.entries(resumo.porTabela).map(([n, v]) => `${n} ${v.atualizadas}/${v.lidas}`).join(' · ')}`);
  } catch (err) {
    resumo.falhas++;
    try { logger.error('cidades-varredura', 'varredura falhou', err); } catch { /* o master segue */ }
  }
  return resumo;
}
