// ─────────────────────────────────────────────────────────────────────────────
// AVISO DE VENDA E RENOVAÇÃO DA SOLARDOC AO DIEGO (08/11/2026)
//
// Desde 08/11/2026 os avisos de venda e renovação que iam só para o Thiago vão
// TAMBÉM para o Diego. O do Thiago continua exatamente como era e sai ANTES: este
// envio é sempre um a mais, isolado, e nunca lança. Se a tabela `consultores` não
// puder ser lida (ou o Diego não estiver nela), o aviso fica só com o Thiago e o
// motivo vai para o log.
//
// Sem trava própria de propósito: quem chama já está atrás da trava da venda
// (`aviso_dono_em`, `venda_aviso_invoice:<id>`, event_id do Asaas), então uma
// reentrega do webhook nunca chega aqui de novo. Criar outra trava só faria o
// Diego perder o aviso quando o primeiro envio falhasse.
//
// O telefone vem da tabela `consultores` (o mesmo caminho da ficha do 5040), nunca
// de número escrito aqui. Linha: 'solardoc', a mesma do aviso ao Thiago.
// ─────────────────────────────────────────────────────────────────────────────

import { sendWhatsApp } from './agents/zapiClient';
import { carregarTelefonesConsultores, telefoneDoConsultor } from './agentes5040/fichaEnvio';
import { logger } from '../utils/logger';

export async function avisarDiegoDaVenda(texto: string, origem: string): Promise<'enviado' | 'sem_telefone' | 'falhou'> {
  try {
    const t = await carregarTelefonesConsultores();
    if (!t.ok) {
      logger.warn('aviso-venda-diego', `${origem}: não consegui ler os consultores (${t.codigo}); o aviso ficou só com o Thiago`);
      return 'sem_telefone';
    }
    const tel = telefoneDoConsultor(t.mapa, 'Diego');
    if (!tel) {
      logger.warn('aviso-venda-diego', `${origem}: o Diego não tem telefone na tabela de consultores; o aviso ficou só com o Thiago`);
      return 'sem_telefone';
    }
    await sendWhatsApp(tel, texto, 'solardoc');
    return 'enviado';
  } catch (err) {
    logger.error('aviso-venda-diego', `${origem}: o aviso ao Diego falhou (o do Thiago já saiu)`, err);
    return 'falhou';
  }
}
