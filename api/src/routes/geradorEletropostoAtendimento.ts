import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { exigeConsultor } from './geradorDossie';
import { lerAtendimentos, lerEtiquetasDosCards } from '../services/io/investidorAtendimento';

// Situação de cada contato na conversa com a Helena e a etiqueta de negócio de cada
// card, para a coluna "Atendimento" das listas de cadastros do eletroposto no
// /gerador. Só consultor logado; só a chave do contato sai, nunca o telefone.
export function mountEletropostoAtendimento(router: Router): void {
  router.get('/eletroposto/atendimento', exigeConsultor, async (_req: Request, res: Response) => {
    try {
      const [itens, etiquetas] = await Promise.all([lerAtendimentos(), lerEtiquetasDosCards()]);
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, gerado_em: new Date().toISOString(), itens, etiquetas });
    } catch (err: any) {
      logger.error('gerador-eletroposto', 'atendimento dos investidores falhou', String(err?.message || err));
      res.status(500).json({ ok: false, error: 'não consegui ler o atendimento agora. Tente de novo em instantes.' });
    }
  });
}
