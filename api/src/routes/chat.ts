import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { globalLimiter } from '../middleware/rateLimiter';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const WHATSAPP_LINK = 'https://wa.me/5534991360223';

const SYSTEM_PROMPT = `Você é a assistente virtual do SolarDoc Pro, plataforma brasileira de documentação para integradores de energia solar.

SOBRE A PLATAFORMA:
- SolarDoc Pro gera contratos, propostas, procurações e documentos de prestação de serviço para integradores solares em segundos
- Os documentos são gerados com IA ou via modelos prontos, com logo e dados da empresa do integrador
- Acesso via navegador e celular (funciona como app — pode instalar na tela inicial)

PLANOS E PREÇOS:
- Iniciante: R$27/mês — 30 documentos/mês, sem histórico salvo
- PRO: R$47/mês — 90 documentos/mês, histórico dos últimos 30 dias
- VIP: R$97/mês — documentos ilimitados, histórico completo, suporte prioritário, participa da expansão da plataforma
- Garantia de 7 dias — devolução total sem perguntas

DOCUMENTOS DISPONÍVEIS:
- Contrato Solar (instalação fotovoltaica)
- Proposta Bancária
- Procuração
- Prestação de Serviço
- Contrato PJ Vendas

COMO FUNCIONA:
1. Integrador cadastra empresa e clientes
2. Escolhe o tipo de documento
3. Preenche os dados (potência, valor, prazos, garantias)
4. Sistema gera o documento em segundos
5. Baixa em PDF com logo da empresa

LIMITES DO PLANO:
- O contador de documentos reseta todo mês automaticamente
- PRO: histórico apagado após 30 dias
- VIP: histórico permanente

SUPORTE / ESCALADA:
- Se a pergunta for muito específica, técnica, sobre problemas de acesso ou pagamento → indique o WhatsApp: ${WHATSAPP_LINK}
- Se o usuário pedir para falar com humano → indique o WhatsApp: ${WHATSAPP_LINK}

REGRAS DE RESPOSTA:
- Seja direto e objetivo
- Máximo 3 frases por resposta
- Use linguagem simples, sem jargões técnicos
- Nunca invente funcionalidades que não existem
- Se não souber → encaminhe para o WhatsApp`;

router.use(globalLimiter);

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, history = [] } = req.body as {
      message: string;
      history: { role: 'user' | 'assistant'; content: string }[];
    };

    if (!message?.trim()) {
      res.status(400).json({ error: 'Mensagem obrigatória' });
      return;
    }

    const messages = [
      ...history.slice(-6), // mantém últimas 6 trocas para economizar tokens
      { role: 'user' as const, content: message.trim() },
    ];

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300, // respostas curtas = menos custo
      system: SYSTEM_PROMPT,
      messages,
    });

    const reply = (response.content[0] as { type: string; text: string }).text;
    res.json({ reply, whatsapp: WHATSAPP_LINK });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Erro ao processar mensagem' });
  }
});

export default router;
