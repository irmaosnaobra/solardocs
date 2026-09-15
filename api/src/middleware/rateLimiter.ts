import rateLimit from 'express-rate-limit';

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 500,
  message: { error: 'Muitas requisições. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
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

// Rua e satélite do estudo passam por proxy, e cada imagem é paga no Google.
export const estudoImgLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 120,
  message: { error: 'Muitas imagens em pouco tempo.' },
  standardHeaders: true,
  legacyHeaders: false,
});
