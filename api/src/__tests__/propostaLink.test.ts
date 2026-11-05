import { describe, it, expect } from 'vitest';
import { ehRobo, dispositivo, geo, linkExpiraEm, linkVencido, dataBR, chaveAbertura } from '../services/propostaLink';
import { paginaVencida, telefoneWa, corSegura } from '../services/propostaVencida';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

describe('ehRobo', () => {
  it.each([
    'WhatsApp/2.23.20.0 A',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Facebot', 'TelegramBot (like TwitterBot)', 'Twitterbot/1.0', 'Slackbot-LinkExpanding 1.0',
    'Mozilla/5.0 (compatible; Discordbot/2.0)', 'LinkedInBot/1.0', 'Skype for Business SkypeUriPreview Preview/0.5',
    'Mozilla/5.0 (compatible; Googlebot/2.1)', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'Mozilla/5.0 (Macintosh) Applebot/0.1',
    'Pinterest/0.2', 'Mozilla/5.0 (compatible; Embedly/0.2)', 'Iframely/1.3.1', 'curl/8.4.0', 'Wget/1.21', 'python-requests/2.31',
    'axios/1.6.0', 'node-fetch/1.0', 'Go-http-client/2.0', 'AlgumaCoisa-bot/1.0', 'Mozilla/5.0 (compatible; SomeBot/2.1)', 'meu bot', 'Bot', 'meu crawler', 'um spider qualquer', 'link-preview',
  ])('%s é robô', (ua) => {
    expect(ehRobo(ua)).toBe(true);
  });

  it('UA vazio ou ausente é robô', () => {
    expect(ehRobo('')).toBe(true);
    expect(ehRobo('   ')).toBe(true);
    expect(ehRobo(undefined)).toBe(true);
  });

  it('navegador de gente não é robô', () => {
    for (const ua of [IPHONE, ANDROID, ANDROID_TABLET, IPAD, WINDOWS]) expect(ehRobo(ua)).toBe(false);
  });

  it('celular CUBOT e navegadores dentro de app (Instagram, Facebook) não são robô', () => {
    for (const ua of [
      'Mozilla/5.0 (Linux; Android 11; CUBOT_X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Linux; Android 12; CUBOT KingKong) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21A329 Instagram 310.0.0.37.109 (iPhone14,5; iOS 17_0; pt_BR; pt-BR; scale=3.00; 1170x2532; 541234567)',
      'Mozilla/5.0 (Linux; Android 13; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 Instagram 310.0.0.37.109 Android',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21A329 [FBAN/FBIOS;FBAV/440.0.0.0;FBBV/123;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.0;FBLC/pt_BR;FBOP/5]',
      'Mozilla/5.0 (Linux; Android 13; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440.0.0.0;]',
    ]) expect(ehRobo(ua), ua).toBe(false);
  });

  it('WhatsApp, Telegram e facebookexternalhit continuam robôs', () => {
    expect(ehRobo('WhatsApp/2.24.1.1 i')).toBe(true);
    expect(ehRobo('TelegramBot (like TwitterBot)')).toBe(true);
    expect(ehRobo('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)')).toBe(true);
  });
});

describe('chaveAbertura', () => {
  it('estável, 64 hex, muda com IP, UA e documento, e não contém o IP', () => {
    const k = chaveAbertura('200.201.202.203', IPHONE, 'doc-1');
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(chaveAbertura('200.201.202.203', IPHONE, 'doc-1')).toBe(k);
    expect(chaveAbertura('200.201.202.204', IPHONE, 'doc-1')).not.toBe(k);
    expect(chaveAbertura('200.201.202.203', WINDOWS, 'doc-1')).not.toBe(k);
    expect(chaveAbertura('200.201.202.203', IPHONE, 'doc-2')).not.toBe(k);
    expect(k).not.toContain('200.201');
  });

  it('o segredo é VAPID_PRIVATE_KEY, depois JWT_SECRET, depois uma constante (sem quebrar)', () => {
    const antes = { v: process.env.VAPID_PRIVATE_KEY, j: process.env.JWT_SECRET };
    const args = ['1.2.3.4', IPHONE, 'doc-1'] as const;
    try {
      process.env.VAPID_PRIVATE_KEY = 'vapid-a'; process.env.JWT_SECRET = 'jwt-a-bem-longo-123456';
      const comVapid = chaveAbertura(...args);
      process.env.JWT_SECRET = 'jwt-b-bem-longo-654321';
      expect(chaveAbertura(...args)).toBe(comVapid);          // com VAPID, o JWT_SECRET não entra
      process.env.VAPID_PRIVATE_KEY = 'vapid-b';
      expect(chaveAbertura(...args)).not.toBe(comVapid);      // trocar o VAPID muda a chave
      delete process.env.VAPID_PRIVATE_KEY;
      const comJwt = chaveAbertura(...args);                  // sem VAPID, cai no JWT_SECRET
      process.env.JWT_SECRET = 'jwt-c-bem-longo-000000';
      expect(chaveAbertura(...args)).not.toBe(comJwt);
      delete process.env.JWT_SECRET;
      expect(chaveAbertura(...args)).toMatch(/^[0-9a-f]{64}$/); // sem nenhum: constante, não lança
    } finally {
      if (antes.v === undefined) delete process.env.VAPID_PRIVATE_KEY; else process.env.VAPID_PRIVATE_KEY = antes.v;
      if (antes.j === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = antes.j;
    }
  });
});

describe('dispositivo', () => {
  it('separa celular, tablet e computador', () => {
    expect(dispositivo(IPHONE)).toBe('Celular');
    expect(dispositivo(ANDROID)).toBe('Celular');
    expect(dispositivo(IPAD)).toBe('Tablet');
    expect(dispositivo(ANDROID_TABLET)).toBe('Tablet');
    expect(dispositivo(WINDOWS)).toBe('Computador');
    expect(dispositivo(undefined)).toBe('Computador');
  });
});

describe('geo', () => {
  it('lê cidade (decodificada), UF e país dos headers da Vercel', () => {
    expect(geo({
      'x-vercel-ip-city': 'S%C3%A3o%20Jos%C3%A9%20do%20Rio%20Preto',
      'x-vercel-ip-country-region': 'SP',
      'x-vercel-ip-country': 'BR',
    })).toEqual({ cidade: 'São José do Rio Preto', uf: 'SP', pais: 'BR' });
  });

  it('ausentes viram null, e percent-encoding quebrado não derruba', () => {
    expect(geo({})).toEqual({ cidade: null, uf: null, pais: null });
    expect(geo({ 'x-vercel-ip-city': '', 'x-vercel-ip-country': ['BR'] })).toEqual({ cidade: null, uf: null, pais: 'BR' });
    expect(geo({ 'x-vercel-ip-city': '100%' }).cidade).toBe('100%');
  });
});

describe('linkExpiraEm', () => {
  it('conta o dia em Brasília: 22h30 de 03/11 em BRT já é 04/11 em UTC e a validade não anda', () => {
    // 2026-11-04T01:30Z = 03/11 22:30 em Brasília. +7 dias = 10/11 (em UTC seria 11/11).
    expect(linkExpiraEm({ emitido_em: '2026-11-04T01:30:00.000Z' })).toBe('2026-11-10T23:59:59-03:00');
  });

  it('a virada do dia: 02:59:59Z ainda é o dia anterior, 03:00:00Z já é o novo', () => {
    expect(linkExpiraEm({ emitido_em: '2026-11-04T02:59:59.000Z' })).toBe('2026-11-10T23:59:59-03:00');
    expect(linkExpiraEm({ emitido_em: '2026-11-04T03:00:00.000Z' })).toBe('2026-11-11T23:59:59-03:00');
  });

  it('usa validade_dias, com 7 como padrão (mesma regra do template)', () => {
    expect(linkExpiraEm({ emitido_em: '2026-11-04T15:00:00Z', validade_dias: '15' })).toBe('2026-11-19T23:59:59-03:00');
    expect(linkExpiraEm({ emitido_em: '2026-11-04T15:00:00Z', validade_dias: 3 })).toBe('2026-11-07T23:59:59-03:00');
    expect(linkExpiraEm({ emitido_em: '2026-11-04T15:00:00Z', validade_dias: '0' })).toBe('2026-11-11T23:59:59-03:00');
    expect(linkExpiraEm({ emitido_em: '2026-11-04T15:00:00Z', validade_dias: 'abc' })).toBe('2026-11-11T23:59:59-03:00');
  });

  it('sem emitido_em usa a data de criação; emitido_em ganha dela', () => {
    expect(linkExpiraEm({}, '2026-11-04T15:00:00Z')).toBe('2026-11-11T23:59:59-03:00');
    expect(linkExpiraEm({ emitido_em: '2026-11-01T15:00:00Z' }, '2026-11-04T15:00:00Z')).toBe('2026-11-08T23:59:59-03:00');
    expect(linkExpiraEm({ emitido_em: 'lixo' }, '2026-11-04T15:00:00Z')).toBe('2026-11-11T23:59:59-03:00');
  });

  it('virada de mês e de ano', () => {
    expect(linkExpiraEm({ emitido_em: '2026-12-28T12:00:00Z', validade_dias: 7 })).toBe('2027-01-04T23:59:59-03:00');
  });

  it('dias absurdos não geram data inválida', () => {
    expect(linkExpiraEm({ emitido_em: '2026-11-04T12:00:00Z', validade_dias: '99999999999999' })).toBeNull();
  });

  it('o resultado é um ISO que o Date entende e que cai no último segundo do dia em Brasília', () => {
    const iso = linkExpiraEm({ emitido_em: '2026-11-04T12:00:00Z' }) as string;
    expect(new Date(iso).toISOString()).toBe('2026-11-12T02:59:59.000Z');
    expect(dataBR(iso)).toBe('11/11/2026');
  });
});

describe('linkVencido', () => {
  it('vence depois do último segundo do dia em Brasília', () => {
    const exp = '2026-11-10T23:59:59-03:00';
    expect(linkVencido(exp, new Date('2026-11-11T02:59:58Z'))).toBe(false);
    expect(linkVencido(exp, new Date('2026-11-11T03:00:01Z'))).toBe(true);
  });
  it('sem data ou data ruim não vence', () => {
    expect(linkVencido(null)).toBe(false);
    expect(linkVencido('lixo')).toBe(false);
  });
});

describe('página de proposta vencida', () => {
  const base = { empresaNome: 'CMO <Solar>', vendedor: 'João', telefone: '(17) 99680-3659', codigo: '20260001', vencidaEm: '10/11/2026', corMarca: '#0055aa' };

  it('texto, botão de WhatsApp com a mensagem e botão de ligar', () => {
    const h = paginaVencida(base);
    expect(h).toContain('Esta proposta venceu em 10/11/2026.');
    expect(h).toContain('Os valores podem ter mudado. Fale com João para receber a proposta atualizada.');
    expect(h).toContain('Chamar no WhatsApp');
    expect(h).toContain(`https://wa.me/5517996803659?text=${encodeURIComponent('Olá, João! Abri a proposta 20260001 e ela venceu. Pode me mandar atualizada?')}`);
    expect(h).toContain('href="tel:+5517996803659"');
    expect(h).toContain('>Ligar<');
  });

  it('escapa o nome da empresa e só aceita logo em data URL de imagem', () => {
    const h = paginaVencida({ ...base, logo: 'javascript:alert(1)' });
    expect(h).toContain('CMO &lt;Solar&gt;');
    expect(h).not.toContain('<Solar>');
    expect(h).not.toContain('javascript:');
    expect(paginaVencida({ ...base, logo: 'data:image/png;base64,AAAA' })).toContain('src="data:image/png;base64,AAAA"');
  });

  it('sem telefone válido não mostra botões', () => {
    const h = paginaVencida({ ...base, telefone: '123' });
    expect(h).not.toContain('wa.me');
    expect(h).not.toContain('tel:');
  });

  it('telefoneWa e corSegura', () => {
    expect(telefoneWa('17996803659')).toBe('5517996803659');
    expect(telefoneWa('5517996803659')).toBe('5517996803659');
    expect(telefoneWa('')).toBeNull();
    expect(corSegura('red; background:url(x)')).toBe('#B45309');
    expect(corSegura('#ffff00')).not.toBe('#ffff00'); // amarelo escurece para dar contraste com texto branco
  });
});
