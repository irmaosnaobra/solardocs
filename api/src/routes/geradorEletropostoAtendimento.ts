import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { exigeConsultor } from './geradorDossie';
import { lerAtendimentos } from '../services/io/investidorAtendimento';

// Situação de cada investidor na conversa com a Helena, para as colunas
// "Situação" e "Consultor" da aba Investidores (cadastros do eletroposto no
// /gerador). Só consultor logado; só a chave do contato sai, nunca o telefone.
export function mountEletropostoAtendimento(router: Router): void {
  router.get('/eletroposto/atendimento', exigeConsultor, async (_req: Request, res: Response) => {
    try {
      const itens = await lerAtendimentos();
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, gerado_em: new Date().toISOString(), itens });
    } catch (err: any) {
      logger.error('gerador-eletroposto', 'atendimento dos investidores falhou', String(err?.message || err));
      res.status(500).json({ ok: false, error: 'não consegui ler o atendimento agora. Tente de novo em instantes.' });
    }
  });
}
