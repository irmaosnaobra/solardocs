import { Router, Request, Response } from 'express';
import { supabaseGerador } from '../utils/supabaseGerador';

// ─────────────────────────────────────────────────────────────────────────────
// GET /orc/:codigo — página de compartilhamento do orçamento do Gerador.
//
// Existe por um motivo só: a prévia do WhatsApp. O crawler dele (e o do
// Facebook, Telegram, iMessage) lê o HTML e NÃO roda JavaScript — então um link
// direto pro /gerador, que é um arquivo estático único, mostra sempre o mesmo
// título de solar, mesmo quando o orçamento é de eletroposto.
//
// Aqui a gente lê o `tipo` da proposta no banco e devolve ~20 linhas de HTML com
// as og: tags do produto certo + redirect imediato pro app. O humano nem vê esta
// página; o crawler nunca vê o app.
//
// Por que não servir o /gerador dinamicamente: o index.html dele tem ~1 MB
// (imagens em base64). Passar isso por uma função a cada abertura de link
// trocaria uma prévia errada por um app lento.
//
// O contrato antigo continua valendo: /gerador?p=CODIGO é para onde este
// redirect aponta, e links já enviados por aí seguem abrindo normalmente.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

const BASE = (process.env.GERADOR_BASE_URL || 'https://solardoc.app/gerador').replace(/\/+$/, '');
const SITE = BASE.replace(/\/gerador$/, '');

const esc = (s: string) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);

type Preview = { titulo: string; descricao: string; imagem: string; tema: string; siteName: string };

function previewDoProduto(tipo: string, cliente: string, completo = false): Preview {
  const paraQuem = cliente ? ` — proposta para ${cliente}` : '';
  if (completo) {
    return {
      titulo: 'Seu eletroposto, em números · NEXUS Eletropostos',
      descricao: `Quanto o seu ponto passa a render${paraQuem}, em quanto tempo o investimento volta e o que está incluído no valor.`,
      imagem: `${SITE}/gerador/nexus-og.png`,
      tema: '#0B1A2B',
      siteName: 'NEXUS Eletropostos',
    };
  }
  if (tipo === 'eletroposto') {
    return {
      titulo: 'Orçamento de Eletroposto · NEXUS Eletropostos',
      descricao: `Orçamento do seu eletroposto${paraQuem}. Equipamento, projeto, instalação e homologação — chave na mão.`,
      imagem: `${SITE}/gerador/nexus-og.png`,
      tema: '#0B1A2B',
      siteName: 'NEXUS Eletropostos',
    };
  }
  return {
    titulo: 'Proposta de Energia Solar — Irmãos na Obra',
    descricao: `Orçamento do seu sistema de energia solar${paraQuem}. Economia, retorno e composição do sistema.`,
    imagem: `${SITE}/gerador/logo.png`,
    tema: '#1E3A8A',
    siteName: 'Irmãos na Obra',
  };
}

function paginaDeRedirect(codigo: string, p: Preview, completo = false): string {
  // O ORÇAMENTO COMPLETO é outro documento e mora em outra página. O app do
  // /gerador só sabe montar o orçamento de 1 página; mandar a apresentação pra
  // lá faz o cliente abrir um documento vazio, sem erro nenhum na tela.
  const destino = completo
    ? `${SITE}/gerador/premium-deck.html?p=${encodeURIComponent(codigo)}`
    : `${BASE}?p=${encodeURIComponent(codigo)}&v=orc`;
  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(p.titulo)}</title>
<meta name="description" content="${esc(p.descricao)}"/>
<meta name="theme-color" content="${p.tema}"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="${esc(p.siteName)}"/>
<meta property="og:title" content="${esc(p.titulo)}"/>
<meta property="og:description" content="${esc(p.descricao)}"/>
<meta property="og:image" content="${esc(p.imagem)}"/>
<meta property="og:image:width" content="512"/>
<meta property="og:image:height" content="512"/>
<meta property="og:url" content="${esc(`${SITE}/orc/${codigo}`)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(p.titulo)}"/>
<meta name="twitter:description" content="${esc(p.descricao)}"/>
<meta name="twitter:image" content="${esc(p.imagem)}"/>
<link rel="canonical" href="${esc(destino)}"/>
<meta http-equiv="refresh" content="0;url=${esc(destino)}"/>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#EEF1F5;color:#5C6470;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;font-size:14px}</style>
</head><body>
<p>Abrindo seu orçamento… <a href="${esc(destino)}">toque aqui se não abrir</a>.</p>
<script>location.replace(${JSON.stringify(destino)});</script>
</body></html>`;
}

router.get('/:codigo', async (req: Request, res: Response): Promise<void> => {
  const codigo = String(req.params.codigo || '').trim();
  // Mesma validação do generateGeradorPdf — código do gerador é só dígito.
  if (!/^\d{8,12}$/.test(codigo)) {
    res.status(400).type('text/plain').send('Código inválido.');
    return;
  }

  try {
    const { data } = await supabaseGerador
      .from('propostas')
      .select('tipo, cliente_nome, dados')
      .eq('codigo', codigo)
      .maybeSingle();

    // Proposta apagada (a purga de 7 dias) ou código errado: ainda redireciona.
    // Quem decide o que mostrar ao cliente é o app — ele tem a tela de expirado
    // e a de "não encontrada", e não é aqui que a gente duplica essa decisão.
    const tipo = String((data as { tipo?: string } | null)?.tipo || 'solar');
    const cliente = String((data as { cliente_nome?: string } | null)?.cliente_nome || '');
    // O marcador mora DENTRO do jsonb porque a coluna `tipo` tem CHECK travado
    // em ('solar','eletroposto') e a apresentação não é um terceiro produto: é
    // outro DOCUMENTO do mesmo produto.
    const dados = (data as { dados?: Record<string, unknown> } | null)?.dados || {};
    const completo = String(dados.doc || '') === 'completo';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Curto de propósito: o consultor pode reeditar e reenviar o mesmo código.
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
    res.send(paginaDeRedirect(codigo, previewDoProduto(tipo, cliente, completo), completo));
  } catch (err) {
    console.error('[orcamento-share] erro:', err);
    // Falha de banco não pode impedir o cliente de abrir o orçamento: manda pro
    // app com a prévia genérica do solar em vez de devolver erro.
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(paginaDeRedirect(codigo, previewDoProduto('solar', '')));
  }
});

export default router;
