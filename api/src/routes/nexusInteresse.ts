import { Request, Response } from 'express';
import { supabaseGerador } from '../utils/supabaseGerador';
import { cidadeParaGravar } from '../services/io/cidadeCanonica';

// Cadastro de intenção da NEXUS (link da bio do Instagram): a pessoa diz o que
// quer importar da China e deixa o contato. SÓ GRAVA: nenhuma mensagem de
// WhatsApp (lead ou equipe), nenhum card de agenda, nenhum evento no Meta.
// Banco: Gerador (gerador-propostas), tabela nexus_interesse.

export const ITENS_VALIDOS = [
  'carro_compacto', 'carro_familia', 'utilitario', 'moto', 'wallbox', 'eletroposto', 'bateria', 'outro',
] as const;
const USOS = new Set(['proprio', 'empresa', 'revenda']);
const UTM_CHAVES = ['source', 'medium', 'campaign', 'content', 'term'] as const;
const ERRO_SALVAR = 'Não deu para salvar agora. Tente de novo em instantes.';

const soDigitos = (s: string) => (s || '').replace(/\D/g, '');
// Só string passa: objeto, número ou array no corpo viram vazio e caem na validação (400), nunca em 500.
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const txt = (v: unknown, max: number): string | null => str(v).trim().slice(0, max) || null;
const vazio = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '') ||
  (typeof v === 'object' && Object.keys(v as object).length === 0);

function erro(res: Response, frase: string): void {
  res.status(400).json({ ok: false, erro: frase });
}

function utmDe(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of UTM_CHAVES) {
    const s = txt(o[k], 200);
    if (s) out[k] = s;
  }
  return Object.keys(out).length ? out : null;
}

async function posicaoDe(id: number | null): Promise<number> {
  let q = supabaseGerador
    .from('nexus_interesse')
    .select('id', { count: 'exact', head: true })
    .eq('teste', false);
  if (id !== null) q = q.lte('id', id);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

type Linha = {
  id: number; itens: string[] | null; nome: string | null; cidade: string | null; uso: string | null;
  outro: string | null; origem: string | null; utm: unknown; teste: boolean | null;
};
const COLUNAS = 'id, itens, nome, cidade, uso, outro, origem, utm, teste';

export async function cadastrarInteresse(req: Request, res: Response): Promise<void> {
  const b = (req.body || {}) as Record<string, unknown>;

  // Honeypot: robô preenche, gente não vê. Responde como se tivesse dado certo.
  const armadilha = typeof b.site === 'string' ? b.site.trim() !== '' : Boolean(b.site);
  if (armadilha) {
    // Mesma cara de um cadastro novo (contagem atual + 1), sem gravar nada.
    let posicao = 1;
    try { posicao = (await posicaoDe(null)) + 1; } catch { /* resposta igual mesmo se a contagem falhar */ }
    res.json({ ok: true, posicao, novo: true });
    return;
  }

  const itens = [...new Set(
    (Array.isArray(b.itens) ? b.itens.slice(0, 20) : [])
      .map((i) => str(i))
      .filter((i): i is typeof ITENS_VALIDOS[number] => (ITENS_VALIDOS as readonly string[]).includes(i)),
  )];
  if (itens.length === 0) return erro(res, 'Escolha pelo menos um item.');

  const uso = str(b.uso).trim();
  if (!USOS.has(uso)) return erro(res, 'Diga se é para uso próprio, empresa ou revenda.');

  const nome = str(b.nome).trim();
  if (nome.length < 2 || nome.length > 80) return erro(res, 'Informe seu nome, de 2 a 80 letras.');

  const telefone = soDigitos(str(b.telefone));
  if (telefone.length < 12 || telefone.length > 13 || !telefone.startsWith('55')) {
    return erro(res, 'Confira o WhatsApp, com DDD.');
  }

  const cidadeBruta = txt(b.cidade, 120);
  const cidade = cidadeBruta ? cidadeParaGravar(cidadeBruta, telefone) : null;
  const outro = txt(b.outro, 300);
  const origem = txt(b.origem, 60);
  const utm = utmDe(b.utm);
  const teste = b.teste === true;

  try {
    const { data: atual, error: eLer } = await supabaseGerador
      .from('nexus_interesse')
      .select(COLUNAS)
      .eq('telefone', telefone)
      .maybeSingle();
    if (eLer) throw eLer;

    // Cadastro repetido NÃO sobrescreve quem já está: une os itens e só preenche
    // o que está vazio no banco. Teste nunca converte lead real; chamada real tira o teste.
    const atualizar = async (antes: Linha): Promise<number> => {
      const patch: Record<string, unknown> = {
        itens: [...new Set([...(antes.itens || []), ...itens])],
        atualizado_em: new Date().toISOString(),
      };
      const novos: Record<string, unknown> = { nome, cidade, uso, outro, origem, utm };
      for (const [k, v] of Object.entries(novos)) {
        if (v && vazio((antes as Record<string, unknown>)[k])) patch[k] = v;
      }
      if (!teste) patch.teste = false;
      const { data, error } = await supabaseGerador
        .from('nexus_interesse').update(patch).eq('id', antes.id).select('id').single();
      if (error) throw error;
      return (data as { id: number }).id;
    };

    let id: number;
    let novo: boolean;
    if (atual) {
      id = await atualizar(atual as Linha);
      novo = false;
    } else {
      const { data, error } = await supabaseGerador
        .from('nexus_interesse')
        .insert({ nome, telefone, cidade, itens, outro, uso, origem, utm, teste })
        .select('id')
        .single();
      if (error && (error as { code?: string }).code === '23505') {
        // Duas requisições do mesmo número ao mesmo tempo: a outra gravou primeiro.
        const { data: de, error: e2 } = await supabaseGerador
          .from('nexus_interesse').select(COLUNAS).eq('telefone', telefone).single();
        if (e2) throw e2;
        id = await atualizar(de as Linha);
        novo = false;
      } else {
        if (error) throw error;
        id = (data as { id: number }).id;
        novo = true;
      }
    }

    const posicao = await posicaoDe(id);
    res.json({ ok: true, posicao, novo });
  } catch (err) {
    console.error(`[nexus-interesse] falha gravando ${telefone}`, err);
    res.status(500).json({ ok: false, erro: ERRO_SALVAR });
  }
}
