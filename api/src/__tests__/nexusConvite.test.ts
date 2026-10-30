import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { banco } from './_bancoFalso';
import { OP1, PARTNER, PRO_COM_TERMO, U1, U2, U3, app, bearer, equipeAuth, naoSocioAuth, receita, semearParceiro, tokensDeConsultor } from './_nexusAjuda';

// Duas saídas de e-mail do portal (v3): o e-mail ao parceiro quando recebe uma oportunidade (uma vez por oportunidade e
// parceiro, env 0 desliga, nunca com o contato do cliente) e o convite em lote às contas do SolarDoc com CNPJ (só sócio,
// trava antes de cada envio, lote de 40, para no primeiro erro). Mais as regras de oferta: obra só com montagem aprovada
// e oportunidade só com o Termo aceito. Nenhum e-mail sai de verdade: o `enviador` é trocado por um espião.

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const consultor = vi.hoisted(() => ({ tokens: {} as Record<string, { email: string; confirmado: boolean }> }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    auth: {
      getUser: vi.fn(async (token: string) => {
        const u = consultor.tokens[token];
        if (!u) return { data: { user: null }, error: { message: 'jwt inválido' } };
        return { data: { user: { email: u.email, email_confirmed_at: u.confirmado ? '2026-01-01T00:00:00Z' : null } }, error: null };
      }),
    },
    from: () => {
      const q: any = { select: () => q, eq: () => q, ilike: () => q, gte: () => q, order: () => q, range: () => Promise.resolve({ data: [], error: null }), limit: () => Promise.resolve({ data: [], error: null }) };
      return q;
    },
  },
}));

const enviadosZap: Array<{ phone: string; texto: string; linha: string }> = [];
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (phone: string, texto: string, linha: string) => { enviadosZap.push({ phone, texto, linha }); }),
}));
vi.mock('../utils/mailer', () => ({ sendOpsAlert: vi.fn(async () => undefined) }));

import { ASSUNTO_CONVITE, ASSUNTO_OPORTUNIDADE, ID_CONVITE_TESTE, PREVIA_CONVITE, enviador, htmlConvite, htmlOportunidade, primeiroNome } from '../services/nexus/email';
import { mascararEmail, resetLimiteTesteConvite } from '../routes/geradorNexusConvite';
import { formatarBRT } from '../services/nexus/tempo';
import { resetSondaPortal } from '../services/nexus/repositorio';

type Envio = { to: string; subject: string; html: string; headers?: Record<string, string> };
const saiu: Envio[] = [];
let travaNoEnvio: boolean[] = [];

beforeEach(() => {
  banco.reset();
  banco.projeta = true;
  resetSondaPortal();
  resetLimiteTesteConvite();
  saiu.length = 0;
  travaNoEnvio = [];
  enviadosZap.length = 0;
  consultor.tokens = tokensDeConsultor();
  delete process.env.NEXUS_EMAIL_OPORTUNIDADE;
  delete process.env.SOLAR_SOCIOS;
  process.env.NEXUS_CONVITE_INTERVALO_MS = '0';
  vi.spyOn(enviador, 'enviar').mockImplementation(async (e: Envio) => {
    // Registra se a trava do convite JÁ existia no instante do envio (a trava vem antes).
    const dono = banco.linhas('users').find((u) => u.email === e.to);
    travaNoEnvio.push(!dono || banco.linhas('system_state').some((s) => String(s.key) === `nexus_convite_email:${dono.id}`) || e.subject === ASSUNTO_OPORTUNIDADE);
    saiu.push(e);
  });
  receita('ativa');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete process.env.NEXUS_CONVITE_INTERVALO_MS; delete process.env.SOLAR_SOCIOS; });

const futuro = () => new Date(Date.now() + 3 * 24 * 3_600_000).toISOString();
const conta = (n: number) => `00000000-0000-4000-b000-${String(n).padStart(12, '0')}`;
const cnpjDe = (n: number) => String(10_000_000_000_000 + n);

/** Conta do SolarDoc com empresa e CNPJ de 14 dígitos. */
function semearConta(n: number, extra: { email?: string | null; optOut?: boolean; cnpj?: string; nome?: string; nomeUsuario?: string } = {}) {
  const id = conta(n);
  banco.poe('users', { id, email: extra.email === undefined ? `conta${n}@exemplo.com` : extra.email, nome: extra.nomeUsuario ?? null, email_opt_out: extra.optOut ?? false });
  banco.poe('company', { id: `c${n}`, user_id: id, nome: extra.nome ?? `Empresa ${n} LTDA`, nome_fantasia: null, cnpj: extra.cnpj ?? cnpjDe(n) });
  return id;
}

// ── Oportunidade ─────────────────────────────────────────────────────────────

function semearOportunidade(extra: Record<string, unknown> = {}) {
  banco.poe('nexus_oportunidades', {
    id: OP1, tipo: 'cliente', cidade: 'Araguari', uf: 'MG', descricao: 'Posto com 2 vagas pede um carregador de 80 kW.', valor_servico: null,
    prazo_aceite: futuro(), parceiro_user_id: null, status: 'rascunho', etapas: [{ status: 'rascunho', em: '2026-10-20T10:00:00Z', obs: null }],
    contato: { nome: 'Posto do Zé', telefone: '34988887777' }, origem_ref: '123', criado_por: 'thiago@irmaosnaobra.app',
    created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z', ...extra,
  });
}
const oferecer = (parceiro: string | null = U1, extra: Record<string, unknown> = {}) =>
  request(app()).patch(`/gerador/nexus/equipe/oportunidades/${OP1}`).set(equipeAuth).send({ parceiro_user_id: parceiro, status: 'oferecida', ...extra });
const proApto = (uid = U1, extra: Record<string, unknown> = {}) => {
  semearParceiro(uid, { ...PRO_COM_TERMO, montagem_aprovada_em: '2026-10-02T10:00:00Z', ...extra });
  banco.poe('users', { id: uid, email: `parceiro-${uid.slice(-1)}@exemplo.com`, email_opt_out: false });
};

describe('regras de oferta: Termo aceito e montagem aprovada', () => {
  it('Pro com o Termo aceito recebe a oportunidade do tipo cliente e do tipo obra (com montagem aprovada)', async () => {
    proApto();
    semearOportunidade();
    expect((await oferecer()).status).toBe(200);
    banco.reset(); banco.projeta = true; resetSondaPortal();
    proApto();
    semearOportunidade({ tipo: 'obra' });
    const r = await oferecer();
    expect(r.status).toBe(200);
    expect(r.body.oportunidade).toMatchObject({ status: 'oferecida', parceiro_user_id: U1 });
  });

  it('obra para parceiro sem montagem aprovada: 409 sem_montagem_aprovada, nada muda e nenhum e-mail sai', async () => {
    proApto(U1, { montagem_aprovada_em: null });
    semearOportunidade({ tipo: 'obra' });
    const r = await oferecer();
    expect(r.status).toBe(409);
    expect(r.body.erro).toBe('sem_montagem_aprovada');
    expect(banco.linhas('nexus_oportunidades')[0]).toMatchObject({ status: 'rascunho', parceiro_user_id: null });
    expect(saiu).toHaveLength(0);
  });

  it('cliente vai para qualquer Pro com Termo, mesmo sem montagem aprovada', async () => {
    proApto(U1, { montagem_aprovada_em: null, papel_montagem: false });
    semearOportunidade({ tipo: 'cliente' });
    expect((await oferecer()).status).toBe(200);
    expect(saiu).toHaveLength(1);
  });

  it('Pro sem o Termo aceito: 409 sem_termo_aceito (mesmo com montagem aprovada), sem e-mail', async () => {
    proApto(U1, { termo_versao: null, termo_aceito_em: null });
    semearOportunidade({ tipo: 'cliente' });
    const r = await oferecer();
    expect(r.status).toBe(409);
    expect(r.body.erro).toBe('sem_termo_aceito');
    expect(banco.linhas('nexus_oportunidades')[0]!.status).toBe('rascunho');
    expect(saiu).toHaveLength(0);
  });

  it('Termo aceito em versão antiga também é sem_termo_aceito', async () => {
    proApto(U1, { termo_versao: 'v0' });
    semearOportunidade();
    expect((await oferecer()).body.erro).toBe('sem_termo_aceito');
  });

  it('quem ainda não comprou (Partner) continua recusado com parceiro_sem_nivel', async () => {
    semearParceiro(U1, { ...PARTNER, montagem_aprovada_em: '2026-10-02T10:00:00Z', termo_versao: 'v1', termo_aceito_em: '2026-10-03T10:00:00Z' });
    semearOportunidade();
    const r = await oferecer();
    expect(r.status).toBe(409);
    expect(r.body.erro).toBe('parceiro_sem_nivel');
  });

  it('sugestões: obra só traz Pro com Termo E montagem aprovada; cliente traz qualquer Pro com Termo', async () => {
    proApto(U1);                                         // obra e cliente
    proApto(U2, { montagem_aprovada_em: null });         // só cliente
    proApto(U3, { termo_aceito_em: null, termo_versao: null }); // sem termo: nenhum
    semearOportunidade({ tipo: 'obra' });
    const obra = await request(app()).get(`/gerador/nexus/equipe/oportunidades/${OP1}/sugestoes`).set(equipeAuth);
    expect(obra.body.sugestoes.map((s: any) => s.user_id)).toEqual([U1]);
    expect(obra.body.sugestoes[0].montagem_aprovada).toBe(true);

    banco.linhas('nexus_oportunidades')[0]!.tipo = 'cliente';
    const cliente = await request(app()).get(`/gerador/nexus/equipe/oportunidades/${OP1}/sugestoes`).set(equipeAuth);
    expect(cliente.body.sugestoes.map((s: any) => s.user_id).sort()).toEqual([U1, U2].sort());
  });
});

describe('e-mail ao parceiro quando recebe uma oportunidade', () => {
  it('envia uma vez para o e-mail da conta, depois do update, com tipo, cidade, pedido, prazo em Brasília e o botão', async () => {
    proApto();
    semearOportunidade({ prazo_aceite: '2099-10-25T21:30:00Z' }); // 18:30 em Brasília; no futuro para o PATCH aceitar
    const r = await oferecer();
    expect(r.status).toBe(200);
    expect(r.body.email_parceiro).toBe('enviado');
    expect(saiu).toHaveLength(1);
    const e = saiu[0]!;
    expect(e.to).toBe('parceiro-1@exemplo.com');
    expect(e.subject).toBe('Nova oportunidade NEXUS na sua região');
    expect(e.html).toContain('Cliente para atender');
    expect(e.html).toContain('Araguari/MG');
    expect(e.html).toContain('Posto com 2 vagas pede um carregador de 80 kW.');
    expect(e.html).toContain('25/10/2099 às 18:30 (horário de Brasília)');
    expect(e.html).toContain('Ver a oportunidade');
    expect(e.html).toContain('https://solardoc.app/nexus/app#oportunidades');
    expect(banco.linhas('system_state').map((s) => s.key)).toEqual([`nexus_email_op:${OP1}:${U1}`]);
  });

  it('NUNCA leva o contato do cliente final, nem o nome, nem o telefone, nem a origem', async () => {
    proApto();
    semearOportunidade();
    await oferecer();
    const html = saiu[0]!.html;
    for (const proibido of ['Posto do Zé', '34988887777', '988887777', '123', 'thiago@irmaosnaobra.app']) expect(html).not.toContain(proibido);
  });

  it('escapa o texto livre da equipe', async () => {
    proApto();
    semearOportunidade({ descricao: '<script>alert(1)</script> & "aspas"', cidade: 'Araguari<b>' });
    await oferecer();
    expect(saiu[0]!.html).not.toContain('<script>');
    expect(saiu[0]!.html).toContain('&lt;script&gt;');
    expect(saiu[0]!.html).toContain('&amp;');
  });

  it('uma vez por oportunidade e parceiro: oferecer de novo ao mesmo parceiro não reenvia', async () => {
    proApto();
    semearOportunidade();
    await oferecer();
    await request(app()).patch(`/gerador/nexus/equipe/oportunidades/${OP1}`).set(equipeAuth).send({ status: 'recusada' });
    const de_novo = await oferecer();
    expect(de_novo.status).toBe(200);
    expect(de_novo.body.email_parceiro).toBe('duplicado');
    expect(saiu).toHaveLength(1);
  });

  it('reoferecer a OUTRO parceiro manda um e-mail para ele', async () => {
    proApto(U1);
    proApto(U2);
    semearOportunidade();
    await oferecer(U1);
    await request(app()).patch(`/gerador/nexus/equipe/oportunidades/${OP1}`).set(equipeAuth).send({ status: 'recusada' });
    const r = await oferecer(U2);
    expect(r.body.email_parceiro).toBe('enviado');
    expect(saiu.map((e) => e.to)).toEqual(['parceiro-1@exemplo.com', 'parceiro-2@exemplo.com']);
  });

  it('NEXUS_EMAIL_OPORTUNIDADE=0 desliga: o PATCH funciona, nada é enviado e nenhuma trava é tomada', async () => {
    process.env.NEXUS_EMAIL_OPORTUNIDADE = '0';
    proApto();
    semearOportunidade();
    const r = await oferecer();
    expect(r.status).toBe(200);
    expect(r.body.email_parceiro).toBe('desligado');
    expect(saiu).toHaveLength(0);
    expect(banco.linhas('system_state')).toHaveLength(0);
  });

  it('liga por padrão: sem a env, envia', async () => {
    proApto();
    semearOportunidade();
    await oferecer();
    expect(saiu).toHaveLength(1);
  });

  it('conta sem e-mail: não envia e o PATCH segue', async () => {
    semearParceiro(U1, { ...PRO_COM_TERMO, montagem_aprovada_em: '2026-10-02T10:00:00Z' });
    banco.poe('users', { id: U1, email: null });
    semearOportunidade();
    const r = await oferecer();
    expect(r.status).toBe(200);
    expect(r.body.email_parceiro).toBe('sem_email');
    expect(saiu).toHaveLength(0);
  });

  it('a Resend falhando não derruba o PATCH', async () => {
    proApto();
    semearOportunidade();
    vi.mocked(enviador.enviar).mockRejectedValueOnce(new Error('Resend fora'));
    const r = await oferecer();
    expect(r.status).toBe(200);
    expect(r.body.oportunidade.status).toBe('oferecida');
    expect(r.body.email_parceiro).toBe('falhou');
  });

  it('só a transição para oferecida envia: editar a descrição de uma já oferecida não manda nada', async () => {
    proApto();
    semearOportunidade({ status: 'oferecida', parceiro_user_id: U1, etapas: [] });
    const r = await request(app()).patch(`/gerador/nexus/equipe/oportunidades/${OP1}`).set(equipeAuth).send({ descricao: 'Texto novo' });
    expect(r.status).toBe(200);
    expect(r.body.email_parceiro).toBeNull();
    expect(saiu).toHaveLength(0);
  });

  it('o texto do e-mail segue as regras da casa: sem travessão, sem emoji', () => {
    const html = htmlOportunidade({ tipo: 'obra', cidade: 'Araguari', uf: 'MG', descricao: 'Obra', prazo_aceite: '2099-01-02T15:00:00Z' });
    for (const t of [html, ASSUNTO_OPORTUNIDADE, htmlConvite(U1), htmlConvite(U1, 'Maria Souza'), ASSUNTO_CONVITE, PREVIA_CONVITE]) {
      expect(t).not.toMatch(/[—–]/);
      expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('formatarBRT desconta as 3 horas e vira o dia', () => {
    expect(formatarBRT('2026-10-22T01:30:00Z')).toBe('21/10/2026 às 22:30');
    expect(formatarBRT('2027-01-01T02:00:00Z')).toBe('31/12/2026 às 23:00');
    expect(formatarBRT('lixo')).toBe('');
  });
});

// ── Convite por e-mail ───────────────────────────────────────────────────────

/** O que a pessoa lê: tira as tags, e com elas os href e os estilos. */
const textoVisivel = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

describe('convite por e-mail: texto', () => {
  it('assunto, pré-cabeçalho, corpo, lista, botão, assinatura e rodapé seguem o plano, nesta ordem', () => {
    const html = htmlConvite(U1, 'Maria Souza');
    expect(ASSUNTO_CONVITE).toBe('Conheça a NEXUS, a nossa distribuidora');
    expect(PREVIA_CONVITE).toBe('Procuramos parceiros que queiram entrar no mercado de carregadores. Veja o que temos.');
    const texto = textoVisivel(html);
    const ordem = [
      PREVIA_CONVITE,
      'NEXUS ELETROPOSTOS',
      'Olá, Maria.',
      'Você já usa o SolarDoc. Agora queremos apresentar a NEXUS, a nossa distribuidora.',
      'Procuramos parceiros que queiram entrar no mercado de carregadores para veículos elétricos e ter equipamento de qualidade. Estamos formando a rede de parceiros da NEXUS e queremos a sua empresa nela.',
      'Na NEXUS você tem:',
      'Carregadores', 'Mentoria', 'Suporte', 'Engenharia', 'Indicação de clientes', 'E muito mais',
      'Para conhecer, é só entrar no Portal do Parceiro NEXUS com o mesmo login do SolarDoc.',
      'Conhecer a NEXUS',
      'Equipe SolarDoc',
      'Você recebeu este e-mail porque tem uma conta no SolarDoc.',
      'Descadastrar destes e-mails',
    ];
    let pos = -1;
    for (const trecho of ordem) {
      const i = texto.indexOf(trecho, pos + 1);
      expect(i, `fora de ordem ou ausente: ${trecho}`).toBeGreaterThan(pos);
      pos = i;
    }
  });

  it('a lista tem os 6 itens do plano, o botão aponta para o convite de hoje e o descadastro é o da casa', () => {
    const html = htmlConvite(U1, 'Maria');
    expect([...html.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) => m[1])).toEqual(
      ['Carregadores', 'Mentoria', 'Suporte', 'Engenharia', 'Indicação de clientes', 'E muito mais']);
    expect(html).toMatch(/<a href="https:\/\/solardoc\.app\/nexus\/app\?o=convite_email"[^>]*>Conhecer a NEXUS<\/a>/);
    expect(html).toMatch(/<a href="[^"]*\/unsubscribe\?u=00000000-0000-4000-8000-000000000001&amp;t=[0-9a-f]{32}"[^>]*>Descadastrar destes e-mails<\/a>\./);
    expect(html).not.toContain('<h1'); // o plano não tem título: o e-mail abre na saudação
  });

  it('o pré-cabeçalho vai escondido e é o PRIMEIRO texto do HTML (antes da faixa da marca)', () => {
    const html = htmlConvite(U1);
    expect(html).toMatch(/<div style="display:none[^"]*">Procuramos parceiros que queiram entrar no mercado de carregadores\. Veja o que temos\.<\/div>/);
    expect(textoVisivel(html).startsWith(PREVIA_CONVITE)).toBe(true);
    expect(html.indexOf(PREVIA_CONVITE)).toBeLessThan(html.indexOf('NEXUS ELETROPOSTOS'));
  });

  it('com nome: "Olá, Maria." (só o primeiro nome); sem nome ou com nome que não é de gente: só "Olá."', () => {
    const com = htmlConvite(U1, 'Maria Souza');
    expect(com).toContain('<p style="margin:0 0 14px;">Olá, Maria.</p>');
    expect(com).not.toContain('Souza');
    for (const sem of [undefined, null, '', '   ', '11999990000', 'joao@exemplo.com', '<script>alert(1)</script>', '<b>Zé</b>', 'X']) {
      const html = htmlConvite(U1, sem);
      expect(html, String(sem)).toContain('<p style="margin:0 0 14px;">Olá.</p>');
      expect(html, String(sem)).not.toContain('Olá,');
      expect(html, String(sem)).not.toMatch(/<script|<b>/);
    }
  });

  it('primeiroNome: inicial maiúscula no nome todo minúsculo ou maiúsculo, corta em espaço, ponto e sublinhado, preserva nome misturado', () => {
    expect(primeiroNome('thiago')).toBe('Thiago');
    expect(primeiroNome('THIAGO SILVA')).toBe('Thiago');
    expect(primeiroNome('joão pedro')).toBe('João');
    expect(primeiroNome('  Maria da Silva ')).toBe('Maria');
    expect(primeiroNome('ana.paula')).toBe('Ana');
    expect(primeiroNome('maria_clara')).toBe('Maria');
    expect(primeiroNome('McDonald Silva')).toBe('McDonald');
    expect(primeiroNome("O'Neil")).toBe("O'Neil");
    expect(primeiroNome('Ana-Maria Souza')).toBe('Ana-Maria');
    expect(primeiroNome('conta1')).toBe('');
    expect(primeiroNome(undefined)).toBe('');
    expect(primeiroNome(42)).toBe('');
  });

  it('primeiroNome: pula um título no começo (Eng, Engº, Dr, Dra, Sr, Sra, Prof, Profª, com ou sem ponto, em qualquer caixa) e usa o nome que vem depois', () => {
    const casos: Array<[string, string]> = [
      ['Eng Flavio Peetz', 'Flavio'],
      ['Eng. Flavio', 'Flavio'],
      ['Dra. Maria Souza', 'Maria'],
      ['Engº Flavio', 'Flavio'],
      ['Dr. João Pedro', 'João'],
      ['Profª Ana Lima', 'Ana'],
      ['Prof Carlos', 'Carlos'],
      ['Sr. Paulo', 'Paulo'],
      ['Sra Helena', 'Helena'],
      ['ENG FLAVIO', 'Flavio'],
      ['eng.flavio', 'Flavio'],
    ];
    for (const [entrada, esperado] of casos) expect(primeiroNome(entrada), entrada).toBe(esperado);
    // Título sem nome depois, ou com sigla ou lixo depois dele: vazio, e o e-mail diz só "Olá."
    for (const entrada of ['Eng', 'Eng.', 'Dra.', 'Dr. MF', 'Eng 123']) expect(primeiroNome(entrada), entrada).toBe('');
  });

  it('primeiroNome: token sem vogal (a, e, i, o, u, y, com ou sem acento) é sigla e dá vazio, sem passar a vez para o token seguinte', () => {
    // "Mª": o ordinal não vale como a vogal "a" (só o acento é tirado antes de contar as vogais).
    for (const sigla of ['MF Solar', 'VSP Energia', 'Vs', 'CM', 'cm', 'Mª']) expect(primeiroNome(sigla), sigla).toBe('');
    expect(primeiroNome('Ze')).toBe('Ze');
    expect(primeiroNome('Zé')).toBe('Zé');
    expect(primeiroNome('Yuri')).toBe('Yuri');
    expect(primeiroNome('Ly')).toBe('Ly');
  });

  it('primeiroNome: nome comum segue como antes (primeiro token, inicial maiúscula, nada pulado)', () => {
    expect(primeiroNome('Ana Paula')).toBe('Ana');
    expect(primeiroNome('ANA PAULA')).toBe('Ana');
    expect(primeiroNome('Muniz Freire Solar')).toBe('Muniz');
  });

  it('primeiroNome: o ordinal que o ponto separou do título ("Prof.ª", "Eng.º") sai junto com ele, e só do título', () => {
    const casos: Array<[string, string]> = [
      ['Prof.ª Ana', 'Ana'],
      ['Dr.ª Maria', 'Maria'],
      ['Sr.ª Maria', 'Maria'],
      ['Eng.º Flavio', 'Flavio'],
      ['Eng.ª Maria', 'Maria'],
      ['Prof.º Carlos Lima', 'Carlos'],
      // Ordinal depois de ponto que não segue título: o corte em ponto vale como antes e o ordinal fica para trás.
      ['Maria.ª Silva', 'Maria'],
    ];
    for (const [entrada, esperado] of casos) expect(primeiroNome(entrada), entrada).toBe(esperado);
    // Título e ordinal sem nome depois, ou ordinal solto no lugar do nome: vazio.
    for (const entrada of ['Dr.ª', 'Prof.ª 123', 'M.ª']) expect(primeiroNome(entrada), entrada).toBe('');
  });

  it('primeiroNome: Engª, Enga, Profº, Srta e o grau "°" no lugar do ordinal também são título', () => {
    const casos: Array<[string, string]> = [
      ['Engª Maria', 'Maria'],
      ['Enga Maria', 'Maria'],
      ['Enga. Maria', 'Maria'],
      ['Profº Carlos', 'Carlos'],
      ['Srta Maria', 'Maria'],
      ['Srta. Maria', 'Maria'],
      ['SRTA MARIA', 'Maria'],
      ['Eng° Flavio', 'Flavio'],
      ['Prof° Carlos', 'Carlos'],
    ];
    for (const [entrada, esperado] of casos) expect(primeiroNome(entrada), entrada).toBe(esperado);
  });

  it('primeiroNome: pula um título só, e título depois de título dá vazio (o segundo não é nome)', () => {
    const casos = ['Profa. Dra. Maria', 'Prof. Dra. Ana', 'Dr. Prof. Ana', 'Eng Eng Flavio', 'Dr Engª Maria', 'Dr.ª Prof. Ana', 'Eng° Srta Maria'];
    for (const entrada of casos) expect(primeiroNome(entrada), entrada).toBe('');
  });

  it('a saudação do convite acompanha o primeiro nome: título pulado vira "Olá, Flavio."; sigla ou título sozinho vira só "Olá."', () => {
    const casos: Array<[string, string]> = [
      ['Eng Flavio Peetz', 'Olá, Flavio.'],
      ['Eng. Flavio', 'Olá, Flavio.'],
      ['Dra. Maria Souza', 'Olá, Maria.'],
      ['Ana Paula', 'Olá, Ana.'],
      ['Eng', 'Olá.'],
      ['MF Solar', 'Olá.'],
      ['VSP Energia', 'Olá.'],
      ['Vs', 'Olá.'],
      ['CM', 'Olá.'],
      ['Profa. Dra. Maria', 'Olá.'],
      ['Prof.ª Ana', 'Olá, Ana.'],
    ];
    for (const [nome, saudacao] of casos) {
      const html = htmlConvite(U1, nome);
      expect(html, nome).toContain(`<p style="margin:0 0 14px;">${saudacao}</p>`);
      if (saudacao === 'Olá.') expect(html, nome).not.toContain('Olá,');
    }
  });

  it('não fala de preço, prazo, "grátis" nem número no texto que a pessoa lê', () => {
    for (const nome of [undefined, 'Maria']) {
      const texto = textoVisivel(htmlConvite(U1, nome));
      expect(texto).not.toMatch(/\d/);
      expect(texto).not.toMatch(/gr[aá]tis|gratuit|R\$|reais|pre[cç]o|prazo|desconto|promo[cç]/i);
    }
    expect(`${ASSUNTO_CONVITE} ${PREVIA_CONVITE}`).not.toMatch(/\d|gr[aá]tis|pre[cç]o|prazo/i);
  });
});

describe('convite por e-mail: prévia', () => {
  it('conta o público: elegíveis, já enviados, excluídos por descadastro, já parceiros e sem e-mail', async () => {
    semearConta(1); semearConta(2);
    semearConta(3, { optOut: true });
    semearConta(4);                                   // vira parceiro abaixo
    semearConta(5, { email: null });
    semearConta(6, { cnpj: '12345678901' });          // CNPJ de 11 dígitos: fora
    semearConta(7);                                   // já convidada
    banco.poe('nexus_parceiros', { id: 'p4', user_id: conta(4), empresa: 'Empresa 4 LTDA' });
    banco.poe('system_state', { key: `nexus_convite_email:${conta(7)}`, value: {} });
    const r = await request(app()).get('/gerador/nexus/equipe/convites/email/previa').set(equipeAuth);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      total: 3, ja_enviados: 1, a_enviar: 2, excluidos_optout: 1, ja_parceiros: 1, sem_email: 1, lote: 40,
      amostra: ['Empresa 1 LTDA', 'Empresa 2 LTDA'],
    });
    expect(saiu).toHaveLength(0);
  });

  it('a amostra tem no máximo 5 empresas e nunca e-mail', async () => {
    for (let i = 1; i <= 9; i++) semearConta(i);
    const r = await request(app()).get('/gerador/nexus/equipe/convites/email/previa').set(equipeAuth);
    expect(r.body.amostra).toHaveLength(5);
    expect(JSON.stringify(r.body)).not.toContain('@');
  });

  it('só sócio: consultora que não é sócia leva 403 so_socio; sem login, 401', async () => {
    semearConta(1);
    const nao = await request(app()).get('/gerador/nexus/equipe/convites/email/previa').set(naoSocioAuth);
    expect(nao.status).toBe(403);
    expect(nao.body.erro).toBe('so_socio');
    expect((await request(app()).get('/gerador/nexus/equipe/convites/email/previa')).status).toBe(401);
    expect((await request(app()).get('/gerador/nexus/equipe/convites/email/previa').set(bearer(U1))).status).toBe(401);
  });

  it('SOLAR_SOCIOS manda: com "ana", ela passa e o Thiago não', async () => {
    process.env.SOLAR_SOCIOS = 'ana';
    expect((await request(app()).get('/gerador/nexus/equipe/convites/email/previa').set(naoSocioAuth)).status).toBe(200);
    expect((await request(app()).get('/gerador/nexus/equipe/convites/email/previa').set(equipeAuth)).status).toBe(403);
  });

  it('portal desligado: 503', async () => {
    banco.falhas['nexus_solicitacoes.select'] = { erro: { code: '42P01', message: 'x' } };
    const r = await request(app()).get('/gerador/nexus/equipe/convites/email/previa').set(equipeAuth);
    expect(r.status).toBe(503);
    expect(r.body.erro).toBe('portal_desligado');
  });
});

describe('convite por e-mail: envio', () => {
  const enviar = (corpo: unknown = { confirmar: true }, auth = equipeAuth) =>
    request(app()).post('/gerador/nexus/equipe/convites/email/enviar').set(auth).send(corpo as object);

  it('sem confirmar:true (ou com confirmar em texto): 400 e nada sai', async () => {
    semearConta(1);
    for (const corpo of [{}, { confirmar: false }, { confirmar: 'true' }, { confirmar: 1 }]) {
      const r = await enviar(corpo);
      expect(r.status).toBe(400);
      expect(r.body.erro).toBe('confirmar_obrigatorio');
    }
    expect(saiu).toHaveLength(0);
    expect(banco.linhas('system_state')).toHaveLength(0);
  });

  it('só sócio dispara: a consultora comum leva 403 e nada sai', async () => {
    semearConta(1);
    const r = await enviar({ confirmar: true }, naoSocioAuth);
    expect(r.status).toBe(403);
    expect(saiu).toHaveLength(0);
  });

  it('portal desligado: 503, nada sai e nenhuma trava é tomada', async () => {
    semearConta(1);
    banco.falhas['nexus_usinas.select'] = { erro: { code: '42P01', message: 'x' } };
    const r = await enviar();
    expect(r.status).toBe(503);
    expect(saiu).toHaveLength(0);
    expect(banco.linhas('system_state')).toHaveLength(0);
  });

  it('envia só ao público: pula descadastrados, já parceiros, sem e-mail, CNPJ inválido e quem já foi convidado', async () => {
    semearConta(1); semearConta(2);
    semearConta(3, { optOut: true });
    semearConta(4); banco.poe('nexus_parceiros', { id: 'p4', user_id: conta(4) });
    semearConta(5, { email: null });
    semearConta(6, { cnpj: '123' });
    semearConta(7); banco.poe('system_state', { key: `nexus_convite_email:${conta(7)}`, value: {} });
    const r = await enviar();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ enviados: 2, restantes: 0, falhas: 0, parou_por_erro: false });
    expect(saiu.map((e) => e.to).sort()).toEqual(['conta1@exemplo.com', 'conta2@exemplo.com']);
    // segunda chamada: ninguém sobrou
    const de_novo = await enviar();
    expect(de_novo.body).toEqual({ enviados: 0, restantes: 0, falhas: 0, parou_por_erro: false });
    expect(saiu).toHaveLength(2);
  });

  it('o e-mail leva o assunto, o botão, o descadastro da casa e os cabeçalhos List-Unsubscribe', async () => {
    semearConta(1);
    await enviar();
    const e = saiu[0]!;
    expect(e.subject).toBe('Conheça a NEXUS, a nossa distribuidora');
    expect(e.html).toContain('Procuramos parceiros que queiram entrar no mercado de carregadores. Veja o que temos.');
    expect(e.html).toContain('Você já usa o SolarDoc. Agora queremos apresentar a NEXUS, a nossa distribuidora.');
    expect(e.html).toContain('Conhecer a NEXUS');
    expect(e.html).toContain('https://solardoc.app/nexus/app?o=convite_email');
    expect(e.html).toContain('Você recebeu este e-mail porque tem uma conta no SolarDoc.');
    expect(e.html).toMatch(/\/unsubscribe\?u=00000000-0000-4000-b000-000000000001&amp;t=[0-9a-f]{32}/);
    expect(e.headers!['List-Unsubscribe']).toMatch(/^<.*\/unsubscribe\?u=00000000-0000-4000-b000-000000000001&t=[0-9a-f]{32}>$/);
    expect(e.headers!['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('o lote saúda pelo primeiro nome do cadastro; conta sem nome recebe só "Olá."', async () => {
    semearConta(1, { nomeUsuario: 'joana pereira' });
    semearConta(2);
    semearConta(3, { nomeUsuario: 'conta3@exemplo.com' }); // nome que é e-mail não vira saudação
    await enviar();
    const html = (email: string) => saiu.find((e) => e.to === email)!.html;
    expect(html('conta1@exemplo.com')).toContain('<p style="margin:0 0 14px;">Olá, Joana.</p>');
    expect(html('conta1@exemplo.com')).not.toContain('Pereira');
    for (const sem of ['conta2@exemplo.com', 'conta3@exemplo.com']) {
      expect(html(sem)).toContain('<p style="margin:0 0 14px;">Olá.</p>');
      expect(html(sem)).not.toContain('Olá,');
    }
  });

  it('a TRAVA vem antes do envio: no instante do envio a chave nexus_convite_email:<user_id> já existe', async () => {
    semearConta(1); semearConta(2);
    await enviar();
    expect(travaNoEnvio).toEqual([true, true]);
    expect(banco.linhas('system_state').map((s) => s.key).sort()).toEqual([`nexus_convite_email:${conta(1)}`, `nexus_convite_email:${conta(2)}`]);
    expect(banco.linhas('system_state')[0]!.key.startsWith('nexus_aviso:')).toBe(false);
  });

  it('lote de 40: 45 contas saem em duas chamadas (40 e 5), restantes 5 e 0', async () => {
    for (let i = 1; i <= 45; i++) semearConta(i);
    const a = await enviar();
    expect(a.body).toEqual({ enviados: 40, restantes: 5, falhas: 0, parou_por_erro: false });
    const b = await enviar();
    expect(b.body).toEqual({ enviados: 5, restantes: 0, falhas: 0, parou_por_erro: false });
    expect(saiu).toHaveLength(45);
    expect(new Set(saiu.map((e) => e.to)).size).toBe(45);
  });

  it('para no primeiro erro de envio, mantém a trava daquela conta e não reenvia sozinho depois', async () => {
    for (let i = 1; i <= 5; i++) semearConta(i);
    vi.mocked(enviador.enviar)
      .mockImplementationOnce(async (e: Envio) => { saiu.push(e); })
      .mockRejectedValueOnce(new Error('429 Too Many Requests'));
    const a = await enviar();
    expect(a.status).toBe(200);
    expect(a.body).toEqual({ enviados: 1, restantes: 3, falhas: 1, parou_por_erro: true });
    expect(saiu).toHaveLength(1);
    expect(banco.linhas('system_state')).toHaveLength(2); // a que saiu e a que falhou
    // a próxima rodada pega só as 3 que sobraram
    const b = await enviar();
    expect(b.body).toEqual({ enviados: 3, restantes: 0, falhas: 0, parou_por_erro: false });
    expect(saiu.map((e) => e.to)).not.toContain('conta2@exemplo.com');
  });

  it('trava que não pôde ser tomada (erro do banco): para o lote sem enviar', async () => {
    semearConta(1);
    banco.falhas['system_state.insert'] = { erro: { code: 'XX000', message: 'banco caiu' } };
    const r = await enviar();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ enviados: 0, parou_por_erro: true });
    expect(saiu).toHaveLength(0);
  });

  it('conta que perdeu a trava para outro disparo é pulada, sem enviar em dobro', async () => {
    semearConta(1); semearConta(2);
    // Outro disparo toma a trava da primeira conta DEPOIS da leitura do público e ANTES do nosso insert (23505).
    banco.falhas['system_state.insert'] = { erro: { code: '23505', message: 'duplicate key' }, uma: true };
    const r = await enviar();
    expect(r.body.enviados).toBe(1);
    expect(r.body.restantes).toBe(0);
    expect(saiu).toHaveLength(1);
  });

  it('nunca manda WhatsApp: convite é só e-mail', async () => {
    semearConta(1);
    await enviar();
    expect(enviadosZap).toHaveLength(0);
  });
});

describe('convite por e-mail: teste para o sócio', () => {
  const URL_TESTE = '/gerador/nexus/equipe/convites/email/teste';
  const URL_PREVIA = '/gerador/nexus/equipe/convites/email/previa';
  const URL_ENVIAR = '/gerador/nexus/equipe/convites/email/enviar';
  const testar = (auth: Record<string, string> = equipeAuth) => request(app()).post(URL_TESTE).set(auth).send({});
  /** Sócio com o login do SolarDoc (o do /nexus/adm): users.is_admin. SEM linha em `company`, para não entrar no público do convite. */
  const semearAdmin = (id: string, email: string | null, nome: string | null) => banco.poe('users', { id, email, nome, is_admin: true });

  it('login do SolarDoc (o do /nexus/adm): UM e-mail só para o e-mail da conta, o mesmo do lote, com o primeiro nome do cadastro', async () => {
    semearAdmin(U1, 'Maria.Dona@Exemplo.com', 'Maria da Silva');
    const r = await testar(bearer(U1));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ enviado_para: 'm***a@exemplo.com' });
    expect(saiu).toHaveLength(1);
    const e = saiu[0]!;
    expect(e.to).toBe('maria.dona@exemplo.com');
    expect(e.subject).toBe('Conheça a NEXUS, a nossa distribuidora');
    expect(e.html).toContain('Olá, Maria.');
    expect(e.html).toContain('Conhecer a NEXUS');
    expect(e.html).toBe(htmlConvite(ID_CONVITE_TESTE, 'Maria da Silva')); // é o MESMO e-mail que o lote monta
    expect(e.headers!['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(enviadosZap).toHaveLength(0);
    // o descadastro do teste NÃO é o da conta do sócio (descadastrar desliga e-mail e WhatsApp)
    expect(e.html).toContain(`u=${ID_CONVITE_TESTE}`);
    expect(e.html).not.toContain(U1);
    expect(JSON.stringify(e.headers)).toContain(`u=${ID_CONVITE_TESTE}`);
    expect(JSON.stringify(e.headers)).not.toContain(U1);
  });

  it('login do Gerador (<nome>@irmaosnaobra.app, domínio sem caixa de e-mail): 409 teste_so_no_adm, nada sai, nada é gravado e a vaga não é gasta', async () => {
    process.env.SOLAR_SOCIOS = 'thiago,ana';
    // Duas seguidas, com sócios diferentes: nenhuma vira 429, então o 409 não gastou o minuto de ninguém.
    for (const auth of [equipeAuth, equipeAuth, naoSocioAuth]) {
      const r = await testar(auth);
      expect(r.status).toBe(409);
      expect(r.body).toEqual({ erro: 'teste_so_no_adm' });
    }
    expect(saiu).toHaveLength(0);
    expect(banco.escritas).toHaveLength(0);
    expect(banco.linhas('system_state')).toHaveLength(0);
  });

  it('a saudação do teste é a que o lote dá à mesma conta: sem nome no cadastro vai só "Olá.", nunca o começo do e-mail', async () => {
    semearAdmin(U1, 'contato@empresa.com', null);
    semearAdmin(U2, 'vendas@empresa.com', '   ');
    expect((await testar(bearer(U1))).status).toBe(200);
    expect((await testar(bearer(U2))).status).toBe(200);
    expect(saiu.map((e) => e.to)).toEqual(['contato@empresa.com', 'vendas@empresa.com']);
    for (const e of saiu) {
      expect(e.html).toContain('<p style="margin:0 0 14px;">Olá.</p>');
      expect(e.html).not.toContain('Olá,');
      expect(e.html).not.toMatch(/Contato|Vendas/);
      expect(e.html).toBe(htmlConvite(ID_CONVITE_TESTE)); // sem nome, igual ao que o lote monta para conta sem nome
    }
  });

  it('o destino NUNCA vem do corpo, da query nem de cabeçalho', async () => {
    semearAdmin(U1, 'dono@exemplo.com', 'Dono');
    const r = await request(app())
      .post(`${URL_TESTE}?email=query@outro.com&to=query@outro.com`)
      .set(bearer(U1))
      .set('X-Email', 'cabecalho@outro.com').set('X-Forwarded-Email', 'cabecalho@outro.com').set('Reply-To', 'cabecalho@outro.com')
      .send({ email: 'corpo@outro.com', to: 'corpo@outro.com', destinatario: ['corpo@outro.com'], nome: 'Invasor' });
    expect(r.status).toBe(200);
    expect(saiu).toHaveLength(1);
    expect(saiu[0]!.to).toBe('dono@exemplo.com');
    expect(JSON.stringify(saiu[0])).not.toContain('outro.com');
    expect(saiu[0]!.html).not.toContain('Invasor');
    expect(JSON.stringify(r.body)).not.toContain('outro.com');
  });

  it('não toma trava, não grava nada, não marca ninguém como convidado e não mexe na prévia nem no lote', async () => {
    semearAdmin(U1, 'dono@exemplo.com', 'Dono');
    semearConta(1); semearConta(2);
    const antes = (await request(app()).get(URL_PREVIA).set(bearer(U1))).body;
    expect(antes).toMatchObject({ total: 2, ja_enviados: 0, a_enviar: 2 });

    const r = await testar(bearer(U1));
    expect(r.status).toBe(200);
    expect(banco.escritas).toHaveLength(0);
    expect(banco.linhas('system_state')).toHaveLength(0);
    expect((await request(app()).get(URL_PREVIA).set(bearer(U1))).body).toEqual(antes);

    // o teste não gastou nenhum convite: o lote ainda manda para as duas contas
    const lote = await request(app()).post(URL_ENVIAR).set(bearer(U1)).send({ confirmar: true });
    expect(lote.body).toEqual({ enviados: 2, restantes: 0, falhas: 0, parou_por_erro: false });
    expect(saiu.map((e) => e.to).sort()).toEqual(['conta1@exemplo.com', 'conta2@exemplo.com', 'dono@exemplo.com']);
    expect(banco.linhas('system_state').map((s) => s.key).sort()).toEqual([`nexus_convite_email:${conta(1)}`, `nexus_convite_email:${conta(2)}`]);
  });

  it('só sócio: consultora comum 403 so_socio, conta do SolarDoc fora da equipe 403, sem login 401, portal desligado 503, e nada sai', async () => {
    const nao = await testar(naoSocioAuth);
    expect(nao.status).toBe(403);
    expect(nao.body.erro).toBe('so_socio');

    banco.poe('users', { id: U2, email: 'qualquer@exemplo.com', nome: 'Qualquer', is_admin: false });
    expect((await testar(bearer(U2))).status).toBe(403);
    expect((await request(app()).post(URL_TESTE).send({})).status).toBe(401);
    expect((await testar(bearer(U3))).status).toBe(401); // conta que não existe

    banco.falhas['nexus_usinas.select'] = { erro: { code: '42P01', message: 'x' } };
    const off = await testar();
    expect(off.status).toBe(503);
    expect(off.body.erro).toBe('portal_desligado');
    expect(saiu).toHaveLength(0);
  });

  it('1 teste por minuto por usuário: o segundo leva 429 {erro:"aguarde"} sem enviar, outro usuário passa, e passado 1 minuto libera', async () => {
    semearAdmin(U1, 'dono1@exemplo.com', 'Dono Um');
    semearAdmin(U2, 'dono2@exemplo.com', 'Dono Dois');
    const agora = Date.now();
    const relogio = vi.spyOn(Date, 'now').mockReturnValue(agora);

    expect((await testar(bearer(U1))).status).toBe(200);
    relogio.mockReturnValue(agora + 59_000);
    const segundo = await testar(bearer(U1));
    expect(segundo.status).toBe(429);
    expect(segundo.body).toEqual({ erro: 'aguarde' });
    expect(segundo.headers['retry-after']).toBe('1');
    expect(saiu).toHaveLength(1);

    expect((await testar(bearer(U2))).status).toBe(200); // outro sócio, outro e-mail: a vaga dele é dele
    expect(saiu.map((e) => e.to)).toEqual(['dono1@exemplo.com', 'dono2@exemplo.com']);

    relogio.mockReturnValue(agora + 61_000);
    expect((await testar(bearer(U1))).status).toBe(200);
    expect(saiu).toHaveLength(3);
  });

  it('dois cliques ao mesmo tempo mandam um e-mail só', async () => {
    semearAdmin(U1, 'dono@exemplo.com', 'Dono');
    const [a, b] = await Promise.all([testar(bearer(U1)), testar(bearer(U1))]);
    expect([a.status, b.status].sort()).toEqual([200, 429]);
    expect(saiu).toHaveLength(1);
  });

  it('a Resend falhando: 502 envio_falhou, nada gravado, e o sócio pode tentar de novo logo em seguida', async () => {
    semearAdmin(U1, 'dono@exemplo.com', 'Dono');
    vi.mocked(enviador.enviar).mockRejectedValueOnce(new Error('Resend fora'));
    const falhou = await testar(bearer(U1));
    expect(falhou.status).toBe(502);
    expect(falhou.body).toEqual({ erro: 'envio_falhou' });
    expect(banco.escritas).toHaveLength(0);
    expect(saiu).toHaveLength(0);

    const de_novo = await testar(bearer(U1));
    expect(de_novo.status).toBe(200);
    expect(saiu).toHaveLength(1);
  });

  it('conta sem e-mail: 409 sem_email e nada sai', async () => {
    banco.poe('users', { id: U1, email: null, nome: 'Sem Email', is_admin: true });
    const r = await testar(bearer(U1));
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ erro: 'sem_email' });
    expect(saiu).toHaveLength(0);
  });

  it('mascararEmail esconde o meio da caixa e mostra o domínio', () => {
    expect(mascararEmail('thiago@irmaosnaobra.app')).toBe('t***o@irmaosnaobra.app');
    expect(mascararEmail('ana@x.com')).toBe('a***a@x.com');
    expect(mascararEmail('ab@x.com')).toBe('a***@x.com');
    expect(mascararEmail('a@x.com')).toBe('a***@x.com');
    expect(mascararEmail('semarroba')).toBe('***');
  });
});
