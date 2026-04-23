import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { getPrompt } from '../prompts/documentPrompts';

interface Company {
  nome: string;
  cnpj: string;
  endereco?: string;
}

interface Client {
  nome: string;
  cpf_cnpj?: string;
  endereco?: string;
  cep?: string;
}

export async function generateDocumentWithAI(
  type: string,
  company: Company,
  client: Client,
  fields: Record<string, unknown>
): Promise<string> {
  const prompt = getPrompt(type, company, client, fields);
  const systemPrompt = 'Você é um especialista jurídico brasileiro. Gere documentos completos, formais e utilizáveis sem edição adicional.';

  if (process.env.OPENAI_API_KEY) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 4000,
    });
    return response.choices[0].message.content || '';
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = response.content[0];
    if (content.type === 'text') return content.text;
    return '';
  }

  throw new Error('Nenhuma chave de API configurada. Configure OPENAI_API_KEY ou ANTHROPIC_API_KEY no .env');
}
