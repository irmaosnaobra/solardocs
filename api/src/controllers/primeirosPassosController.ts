import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { logger } from '../utils/logger';
import { carregarPassos } from '../services/solardoc/primeirosPassos';
import { variantesDoTelefone } from '../services/produtos/chaveTelefone';

/** GET /primeiros-passos: o que o usuário já fez e o que falta (a mesma fonte do robô da recepção). */
export async function getPrimeirosPassos(req: Request, res: Response): Promise<void> {
  try {
    const passos = await carregarPassos(req.userId);
    if (!passos) { res.status(404).json({ error: 'Usuário não encontrado' }); return; }
    res.json(passos);
  } catch (err) {
    logger.error('primeiros-passos', 'leitura falhou', err);
    res.status(500).json({ error: 'Não foi possível ler seus primeiros passos agora. Tente de novo em instantes.' });
  }
}

/**
 * PUT /primeiros-passos/whatsapp { whatsapp }: salva o WhatsApp do usuário. Mesma regra do cadastro (authController.register):
 * só dígitos, DDD + 8 ou 9 dígitos (10 ou 11 dígitos).
 */
export async function putPrimeirosPassosWhatsapp(req: Request, res: Response): Promise<void> {
  try {
    const bruto = (req.body as { whatsapp?: unknown } | undefined)?.whatsapp;
    const digitos = typeof bruto === 'string' || typeof bruto === 'number' ? String(bruto).replace(/\D/g, '') : '';
    if (digitos.length !== 10 && digitos.length !== 11) {
      res.status(400).json({ error: 'WhatsApp deve ter DDD + 8 ou 9 dígitos' });
      return;
    }
    // O número já é de OUTRA conta? Procura pelas mesmas variantes com que as compras acham o dono pelo telefone (contaDoComprador). Número que não
    // serve de chave (sequência, lixo) não tem variantes: compara só o valor exato. Erro de leitura não grava.
    const alvos = variantesDoTelefone(digitos);
    const outra = await supabase.from('users').select('id').in('whatsapp', alvos.length ? alvos : [digitos]).neq('id', req.userId).limit(1);
    if (outra.error) {
      logger.error('primeiros-passos', 'conferir o dono do WhatsApp falhou', outra.error);
      res.status(500).json({ error: 'Não foi possível salvar seu WhatsApp agora. Tente de novo em instantes.' });
      return;
    }
    if ((outra.data ?? []).length > 0) {
      res.status(409).json({ error: 'Esse WhatsApp já está em outra conta. Fale com o suporte.' });
      return;
    }
    const { error } = await supabase.from('users').update({ whatsapp: digitos }).eq('id', req.userId);
    if (error) {
      logger.error('primeiros-passos', 'gravar o WhatsApp falhou', error);
      res.status(500).json({ error: 'Não foi possível salvar seu WhatsApp agora. Tente de novo em instantes.' });
      return;
    }
    res.json({ ok: true, whatsapp: digitos });
  } catch (err) {
    logger.error('primeiros-passos', 'gravar o WhatsApp lançou', err);
    res.status(500).json({ error: 'Não foi possível salvar seu WhatsApp agora. Tente de novo em instantes.' });
  }
}
