import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { exigeConsultor } from './geradorDossie';
import { lerAtendimentos, lerEtiquetasDosCards, lerTiposDosCards } from '../services/io/investidorAtendimento';

// Situação de cada contato na conversa com a Helena, a etiqueta de negócio e o tipo de cada
// card, para a coluna "Atendimento" das listas de cadastros do eletroposto no
// /gerador. Só consultor logado; só a chave do contato sai, nunca o telefone.
export function mountEletropostoAtendimento(router: Router): void {
  router.get('/eletroposto/atendimento', exigeConsultor, async (_req: Request, res: Response) => {
    try {
      const [itens, etiquetas, tipos] = await Promise.all([lerAtendimentos(), lerEtiquetasDosCards(), lerTiposDosCards()]);
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, gerado_em: new Date().toISOString(), itens, etiquetas, tipos });
    } catch (err: any) {
      logger.error('gerador-eletroposto', 'atendimento dos investidores falhou', String(err?.message || err));
      res.status(500).json({ ok: false, error: 'não consegui ler o atendimento agora. Tente de novo em instantes.' });
    }
  });
}
