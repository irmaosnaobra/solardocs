// Ajudas dos testes de rota do Portal do Parceiro NEXUS. Não é arquivo de teste (não termina em .test.ts).
// Os vi.mock ficam em cada arquivo de teste (supabase, supabaseGerador, zapiClient, mailer, logger).

import express, { Router } from 'express';
import { vi } from 'vitest';
import { banco } from './_bancoFalso';
import { mountNexus } from '../routes/geradorNexus';
import { signToken } from '../utils/jwt';

export const CNPJ = '11222333000181';
export const CNPJ2 = '11444777000161';
export const U1 = '00000000-0000-4000-8000-000000000001';
export const U2 = '00000000-0000-4000-8000-000000000002';
export const U3 = '00000000-0000-4000-8000-000000000003';
export const LOGO = 'data:image/png;base64,iVBORw0KGgo=';

export const bearer = (uid: string) => ({ Authorization: `Bearer ${signToken(uid)}` });
export const equipeAuth = { Authorization: 'Bearer tc' };

export function app() {
  const router = Router();
  mountNexus(router);
  const a = express();
  a.use(express.json({ limit: '10mb' }));
  a.use('/gerador', router);
  return a;
}

/** BrasilAPI simulada: ATIVA, BAIXADA, ou fora do ar. */
export function receita(modo: 'ativa' | 'baixada' | 'fora') {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (modo === 'fora') throw new Error('rede');
    return {
      ok: true, status: 200,
      json: async () => ({
        descricao_situacao_cadastral: modo === 'ativa' ? 'ATIVA' : 'BAIXADA',
        razao_social: 'SOLAR EXEMPLO LTDA', nome_fantasia: 'Solar Exemplo',
      }),
    };
  }));
}

export function empresaDaConta(uid = U1, extra: Record<string, unknown> = {}) {
  banco.poe('company', {
    id: `c-${uid}`, user_id: uid, nome: 'SOLAR EXEMPLO LTDA', nome_fantasia: 'Solar Exemplo', cnpj: uid === U1 ? CNPJ : CNPJ2,
    cidade: 'Uberlândia', whatsapp: '34999990000', logo_base64: null, ...extra,
  });
}

/** Põe direto no banco um parceiro com perfil completo (e a empresa com logo). `extra` ajusta o nível. */
export function semearParceiro(uid = U1, extra: Record<string, unknown> = {}, empresa: Record<string, unknown> = {}) {
  empresaDaConta(uid, { logo_base64: LOGO, ...empresa });
  const linha = {
    id: `00000000-0000-4000-9000-${uid.slice(-12)}`,
    user_id: uid, empresa: 'Solar Exemplo', cnpj: uid === U1 ? CNPJ : CNPJ2, cnpj_situacao: 'ativa',
    cidade: 'Uberlândia', uf: 'MG', raio_km: 150, papel_revenda: true, papel_montagem: true,
    cap_eletrica_bt: false, cap_eletrica_mt: false, cap_engenharia_art: false, cap_obra_civil: false, cap_homologacao: false, cap_ja_instala: false,
    origem: 'portal', status: 'novo', carregadores_comprados: 0,
    perfil_completo_em: null, primeira_proposta_em: null, conversa_pedida_em: null, conversa_feita_em: null,
    partner_em: null, montagem_aprovada_em: null, notas_equipe: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    ...extra,
  };
  banco.poe('nexus_parceiros', linha);
  return linha;
}

export const propostaOk = (saida: 'simulador' | 'basico' | 'completo' = 'simulador') => ({
  saida,
  cliente: { nome: 'Posto Exemplo', doc: '', cidade: 'Araguari', uf: 'MG', telefone: '34988880000', email: '', tipo_local: 'posto' },
  equipamento: { modelo: 'nexus-dc-80', quantidade: 2, preco_unitario: 69990 },
  valor_total: 139980,
  dados: { form: { a: 1 } },
});

export const PED1 = '00000000-0000-4000-a000-0000000000d1';
export const PED2 = '00000000-0000-4000-a000-0000000000d2';
export const SOL1 = '00000000-0000-4000-a000-0000000000e1';
export const OP1 = '00000000-0000-4000-a000-000000000001';

/** Partner: a equipe marcou partner_em. Perfil completo (semearParceiro). */
export const PARTNER = { partner_em: '2026-10-01T10:00:00Z', primeira_proposta_em: '2026-09-30T10:00:00Z' };
/** Pro com o Termo aceito: primeira compra confirmada e termo v1 aceito. */
export const PRO_COM_TERMO = { ...PARTNER, carregadores_comprados: 1, termo_versao: 'v1', termo_aceito_em: '2026-10-03T10:00:00Z' };

/** Simula o consultor da equipe: 'tc' = Thiago (sócio), 'tn' = Ana (consultora que não é sócia). */
export function tokensDeConsultor(): Record<string, { email: string; confirmado: boolean }> {
  return {
    tc: { email: 'Thiago@irmaosnaobra.app', confirmado: true },
    tn: { email: 'ana@irmaosnaobra.app', confirmado: true },
  };
}
export const naoSocioAuth = { Authorization: 'Bearer tn' };
