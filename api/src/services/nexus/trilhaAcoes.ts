// O que cada ação da EQUIPE faz na trilha, como função PURA: recebe o estado e devolve o patch e os eventos (ou a recusa).
// A rota só grava o que esta função mandar. Toda ação vira evento com o e-mail de quem agiu (autor).

import type { AcaoEquipe } from './trilhaEntradas';
import { COLUNA_DO_PATAMAR, ENCONTROS_META, LinhaTrilha, patamarEmCurso } from './trilha';
import type { EventoDaTrilha } from './trilhaRepo';

export type Plano =
  | { ok: true; patch: Record<string, unknown>; eventos: EventoDaTrilha[] }
  | { ok: false; erro: string };

export interface ContextoAcao {
  t: LinhaTrilha;
  comprados: number;
  termo_aceito: boolean;
  agora: string;
  /** E-mail da equipe (req.equipe.email): vira o autor dos eventos. */
  autor: string;
}

const recusa = (erro: string): Plano => ({ ok: false, erro });
const fecha = (n: number): EventoDaTrilha => ({ tipo: 'patamar_concluido', dados: { patamar: n }, autor: 'sistema' });

export function planejarAcao(a: AcaoEquipe, c: ContextoAcao): Plano {
  const { t, agora, autor } = c;
  const ev = (tipo: string, dados: Record<string, unknown> = {}): EventoDaTrilha => ({ tipo, dados, autor });

  switch (a.acao) {
    case 'agendar_diagnostico':
      if (!t.diag_pedido_em || t.diag_feito_em) return recusa('sem_pedido_pendente');
      return { ok: true, patch: { diag_agendado_para: a.quando, diag_link: a.link }, eventos: [ev('diagnostico_agendado', { quando: a.quando, com_link: !!a.link })] };

    case 'diagnostico_feito': {
      if (!t.diag_pedido_em) return recusa('sem_pedido');
      if (t.p2_em) return recusa('ja_concluido');
      const patch: Record<string, unknown> = { diag_feito_em: agora, diag_resultado: a.resultado, diag_plano: a.plano ?? t.diag_plano ?? null };
      const eventos = [ev('diagnostico_feito', { resultado: a.resultado })];
      if (a.resultado === 'aprovado') {
        if (!t.p1_em) return recusa('etapa_anterior');
        patch.p2_em = agora;
        eventos.push(fecha(2));
      }
      return { ok: true, patch, eventos };
    }

    case 'mentoria_paga':
      if (t.preparo_formato !== 'mentoria') return recusa('formato_invalido');
      if (t.mentoria_paga_em) return recusa('ja_registrado');
      return { ok: true, patch: { mentoria_paga_em: agora }, eventos: [ev('mentoria_paga')] };

    case 'mentoria_encontro': {
      if (t.preparo_formato !== 'mentoria') return recusa('formato_invalido');
      const n = (Number(t.mentoria_encontros) || 0) + 1;
      if (t.p3_em || n > ENCONTROS_META) return recusa('encontros_completos');
      const patch: Record<string, unknown> = { mentoria_encontros: n };
      const eventos = [ev('mentoria_encontro', { numero: n })];
      if (n >= ENCONTROS_META) {
        if (!t.p2_em) return recusa('etapa_anterior');
        patch.p3_em = agora;
        eventos.push(fecha(3));
      }
      return { ok: true, patch, eventos };
    }

    case 'agendar_reuniao':
      if (!t.reuniao_pedida_em || t.reuniao_feita_em) return recusa('sem_pedido_pendente');
      return { ok: true, patch: { reuniao_agendada_para: a.quando }, eventos: [ev('reuniao_agendada', { quando: a.quando })] };

    case 'reuniao_feita':
      if (!t.reuniao_pedida_em) return recusa('sem_pedido');
      if (t.reuniao_feita_em) return recusa('ja_registrado');
      if (!t.p3_em) return recusa('etapa_anterior');
      if (!c.termo_aceito) return recusa('termo_pendente');
      return {
        ok: true,
        patch: { reuniao_feita_em: agora, p4_em: t.p4_em ?? agora },
        eventos: [ev('reuniao_feita', a.obs ? { obs: a.obs } : {}), fecha(4)],
      };

    case 'promover_regional': {
      const p = patamarEmCurso(t, c.comprados);
      if (p === 7) return recusa('ja_concluido');
      if (p !== 6) return recusa('etapa_anterior');
      return { ok: true, patch: { regional_em: agora }, eventos: [ev('promover_regional'), fecha(6)] };
    }

    case 'avancar': {
      const p = patamarEmCurso(t, c.comprados);
      if (p === 7) return recusa('ja_concluido');
      const coluna = COLUNA_DO_PATAMAR[p];
      if (!coluna) return recusa('patamar_automatico'); // o 5 fecha sozinho com o primeiro pedido confirmado
      return { ok: true, patch: { [coluna]: agora }, eventos: [ev('avancar', { patamar: p, motivo: a.motivo })] };
    }

    case 'responsavel':
      return { ok: true, patch: { responsavel_email: a.email }, eventos: [ev('responsavel', { email: a.email })] };

    case 'obs':
      return { ok: true, patch: { obs_equipe: a.texto }, eventos: [ev('obs', { texto: a.texto })] };
  }
}
