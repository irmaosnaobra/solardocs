import rateLimit from 'express-rate-limit';

/** A caixa de entrada da linha 5040 (/gerador/caixa/*) consulta a cada poucos segundos e tem limite próprio (abaixo). */
export const ehRotaDaCaixa = (url: string | undefined): boolean => String(url ?? '').startsWith('/gerador/caixa/');

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 500,
  message: { error: 'Muitas requisições. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Fora da conta global: o escritório inteiro sai por um IP só, e a caixa aberta o dia todo gastaria os 500 de todo
  // mundo e derrubaria o resto do /gerador. Quem protege a caixa são os dois limitadores abaixo.
  skip: (req) => ehRotaDaCaixa(req.originalUrl),
});

export const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10,
  message: { error: 'Limite de geração de documentos atingido. Aguarde 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Endpoint público de WRITE (formulário de indicação): alvo de spam. Limite
// apertado por IP — um humano não manda mais que isso de boa fé.
export const indicacaoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 8,
  message: { error: 'Muitas indicações em pouco tempo. Tente novamente mais tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Página pública do estudo do local (link com token de 64 hex). Segura quem tenta
// adivinhar token e página aberta em loop; o consultor abre poucas vezes.
export const estudoPaginaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 60,
  message: { error: 'Muitas aberturas do estudo em pouco tempo. Tente de novo em alguns minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Mapa do Arrendamento: cada chamada geocodifica no máximo 15 endereços novos e
// a tela repete até acabar. Abrir o mapa com o cache cheio é UMA chamada.
export const geoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 120,
  message: { error: 'Muitas consultas ao mapa em pouco tempo. Tente de novo em alguns minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rua e satélite do estudo passam por proxy, e cada imagem é paga no Google.
export const estudoImgLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 120,
  message: { error: 'Muitas imagens em pouco tempo.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Caixa de entrada da linha 5040 (/gerador/caixa/*) ────────────────────────
// Dois limitadores, nesta ordem, só nessas rotas:
//  1) por IP, ANTES do login: teto largo (o escritório todo divide o IP). Só impede que quem não tem sessão
//     use a rota para martelar a validação de token no Supabase.
//  2) por PESSOA, DEPOIS do `exigeConsultor`: a chave é o e-mail do consultor já validado, nunca o token.
//     600 a cada 15 min: a tela consulta no máximo a cada 4 s (225 por 15 min) e sobra folga.
export const caixaIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  message: { ok: false, error: 'Muitas consultas em pouco tempo. Aguarde um pouco.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const caixaPessoaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  keyGenerator: (req) => 'caixa:' + String((req as unknown as { consultor?: { email?: string } }).consultor?.email || 'sem-consultor'),
  message: { ok: false, error: 'Muitas consultas em pouco tempo. Aguarde um pouco.' },
  standardHeaders: true,
  legacyHeaders: false,
});
