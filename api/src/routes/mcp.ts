import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';

const router = Router();
const STATIC_TOKEN = process.env.MCP_TOKEN || 'solardoc-mcp-token-2026';

function authMiddleware(req: Request, res: Response, next: () => void) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (token !== STATIC_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE_ID;
const ZAPI_TOKEN    = process.env.ZAPI_TOKEN;
const ZAPI_CLIENT   = process.env.ZAPI_CLIENT_TOKEN;

// ─── Ferramentas disponíveis ─────────────────────────────────────
const TOOLS = [
  {
    name: 'enviar_mensagem_whatsapp',
    description: 'Envia uma mensagem WhatsApp para um número via Z-API',
    inputSchema: {
      type: 'object',
      properties: {
        phone:   { type: 'string', description: 'Número no formato 5511999999999' },
        message: { type: 'string', description: 'Texto da mensagem' },
      },
      required: ['phone', 'message'],
    },
  },
  {
    name: 'listar_usuarios',
    description: 'Lista todos os usuários cadastrados no SolarDoc Pro com seus dados',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'listar_fila_mensagens',
    description: 'Mostra mensagens WhatsApp recebidas aguardando resposta',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ver_conversa',
    description: 'Mostra o histórico de conversa WhatsApp de um usuário',
    inputSchema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Número do usuário' },
      },
      required: ['phone'],
    },
  },
  {
    name: 'listar_contatos_zapi',
    description: 'Lista os contatos conectados na instância Z-API',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'responder_fila',
    description: 'Processa e responde as mensagens pendentes na fila',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ─── Execução das ferramentas ─────────────────────────────────────
async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {

    case 'enviar_mensagem_whatsapp': {
      const res = await fetch(
        `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT! },
          body: JSON.stringify({ phone: args.phone, message: args.message }),
        }
      );
      const data = await res.json() as any;
      return data.messageId ? `✅ Mensagem enviada (ID: ${data.messageId})` : `❌ Erro: ${JSON.stringify(data)}`;
    }

    case 'listar_usuarios': {
      const { data: users } = await supabase
        .from('users')
        .select('email, plano, whatsapp, created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      const { data: companies } = await supabase.from('company').select('user_id, nome, cnpj');
      const companyMap = new Map(companies?.map(c => [c.user_id, c]));
      const { data: allUsers } = await supabase.from('users').select('id, email');
      const result = users?.map(u => {
        const uid = allUsers?.find(x => x.email === u.email)?.id;
        const co  = uid ? companyMap.get(uid) : null;
        return `📧 ${u.email} | 📱 ${u.whatsapp || '—'} | Plano: ${u.plano} | Empresa: ${co ? co.nome : 'Sem CNPJ'}`;
      });
      return result?.join('\n') || 'Nenhum usuário';
    }

    case 'listar_fila_mensagens': {
      const { data } = await supabase
        .from('message_queue')
        .select('*')
        .eq('processed', false)
        .order('created_at', { ascending: true })
        .limit(20);
      if (!data?.length) return '✅ Fila vazia — nenhuma mensagem pendente';
      return data.map(m => `📱 ${m.phone} | "${m.text}" | ${m.created_at}`).join('\n');
    }

    case 'ver_conversa': {
      const { data } = await supabase
        .from('whatsapp_sessions')
        .select('messages, updated_at')
        .eq('phone', String(args.phone).replace(/\D/g, ''))
        .single();
      if (!data) return 'Nenhuma conversa encontrada para esse número';
      const msgs = (data.messages as any[]).slice(-10);
      return msgs.map((m: any) => `[${m.role}]: ${m.content}`).join('\n\n');
    }

    case 'listar_contatos_zapi': {
      const res = await fetch(
        `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/contacts?page=1&pageSize=20`,
        { headers: { 'Client-Token': ZAPI_CLIENT! } }
      );
      const data = await res.json() as any[];
      return data.slice(0, 20).map((c: any) => `${c.name} | ${c.phone}`).join('\n');
    }

    case 'responder_fila': {
      const res = await fetch(
        `https://solardocs-api.vercel.app/cron/process-messages`,
        { headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET}` } }
      );
      const data = await res.json() as any;
      return `Processadas: ${data.processed || 0} mensagens`;
    }

    default:
      return `Ferramenta '${name}' não encontrada`;
  }
}

// ─── Endpoint MCP (JSON-RPC 2.0) ─────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { jsonrpc, id, method, params } = req.body as any;

  res.setHeader('Content-Type', 'application/json');

  try {
    if (method === 'initialize') {
      res.json({
        jsonrpc, id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'SolarDoc Z-API MCP', version: '1.0.0' },
        },
      });
      return;
    }

    if (method === 'tools/list') {
      res.json({ jsonrpc, id, result: { tools: TOOLS } });
      return;
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params;
      const text = await executeTool(name, args || {});
      res.json({
        jsonrpc, id,
        result: { content: [{ type: 'text', text }] },
      });
      return;
    }

    if (method === 'notifications/initialized' || method?.startsWith('notifications/')) {
      res.json({ jsonrpc, id: id ?? null, result: {} });
      return;
    }

    res.json({
      jsonrpc, id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  } catch (err) {
    res.json({
      jsonrpc, id,
      error: { code: -32603, message: String(err) },
    });
  }
});

// ─── SSE para clientes que precisam de streaming ──────────────────
router.get('/', (req: Request, res: Response): void => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.write('data: {"type":"ping"}\n\n');
  res.end();
});

export default router;
