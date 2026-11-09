#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────────
   WORKER DE PROSPECÇÃO — dirige o SEU Chrome, um contato por vez.

   ZERO DEPENDÊNCIA. Não instala nada. Fala com o Chrome pelo protocolo nativo
   (CDP) usando o WebSocket que já vem no Node 22+. Não precisa de Playwright,
   não baixa navegador, não pede npm install.

   ── COMO SUBIR ──────────────────────────────────────────────────────────────
   1) Feche o Chrome. Abra um DEDICADO à automação (perfil separado do seu):

      & "C:\Program Files\Google\Chrome\Application\chrome.exe" `
        --remote-debugging-port=9222 `
        --user-data-dir="$env:USERPROFILE\.chrome-prospeccao"

      (Instagram: porta 9222. WhatsApp do chip: porta 9223 e perfil
       .chrome-wa-prospeccao, para rodar junto sem disputar o Chrome.)

   2) NESSA janela, faça login no WhatsApp Web (ou no Instagram). Uma vez só —
      a sessão fica salva no perfil.

   3) Rode em outro terminal:

        node worker.mjs --dry --canal=instagram   # ensaio: mostra tudo, não envia nada
        node worker.mjs --canal=whatsapp          # envia de verdade
        node worker.mjs --canal=instagram         # idem, por DM

   --canal é OBRIGATÓRIO (sem padrão): sem ele o worker sai com erro, para nenhum
   comando esquecido prospectar pela conta errada.

   COMECE PELO --dry. Ele percorre a fila inteira e imprime a mensagem exata que
   sairia pra cada empresa, sem tocar em ninguém.

   ── O QUE ELE NÃO FAZ ───────────────────────────────────────────────────────
   Não escolhe quem receber: lê a view `prospeccao_fila_worker`, que já aplica
   bloqueado / lista ativa / não-tocado-hoje. Não decide quantos: lê o teto da
   rampa em `prospeccao_teto_hoje`. Não ignora reclamação: para sozinho se o
   disjuntor de opt-out passar de 8% em `prospeccao_saude`.

   Essas três travas moram no banco de propósito. Mexer nelas aqui não adianta —
   o worker relê a cada envio.
   ───────────────────────────────────────────────────────────────────────────── */

import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { semearHistoricoAntigo, podeVoltar, freioPendente, registrarFreio, registrarVolta, liberarPeloDono, contarEnvioDeProva, provaAtiva, avisoDoEstado, jaVoltouDepoisDoFreio, ARQ_LIBERAR_NOME, PROVA_ENVIOS, jaTratada, marcarTratada, lerTratadas, emAlmoco, ajustarInstante, esperaParaMinutoBom, registrarFalhaCaixa, aposEnvioConfirmado, enviosConfirmados, planoDigitacao, duracaoRolagemMs, passosRolagem, cfgDe, podeEnviar, calcularEspera, tetoEfetivo, avaliarToques, contaProibida, arquivoUltimo, faltaPiso, decidirAbordagem, canalValido, restamComPendente, gravarComRetentativa, respiroAposFalha, parseBloqueio, decidirRampa, diaAnteriorUtil, limitesDoDia, relogioBRT, RAMPA_INICIAL, tetoManualInstagram, parseHistorico, diaDeIso, maxInstagramEfetivo, historicoPrecisaSincronizar } from './ritmo.mjs';
import { escolherAbertura, escolherVersao, chavesUsadas, totalDoContentRange, usaAberturaNova } from './abertura.mjs';

const ARG = process.argv.slice(2);
const DRY   = ARG.includes('--dry');
const CANAL = ARG.find(a => a.startsWith('--canal='))?.split('=')[1];
if (!canalValido(CANAL)) {
  console.error('Informe o canal: --canal=instagram ou --canal=whatsapp. Não há padrão, de propósito.');
  process.exit(2);
}

// ═══ CONFIGURAÇÃO ════════════════════════════════════════════════════════════
const RITMO = cfgDe(process.env);
const CFG = {
  // Cada canal tem o SEU Chrome: Instagram na 9222, WhatsApp do chip na 9223.
  cdp:        process.env.CHROME_CDP || (CANAL === 'whatsapp' ? 'http://127.0.0.1:9223' : 'http://127.0.0.1:9222'),
  supa:       'https://ancecdfqfwlaujknizof.supabase.co/rest/v1',
  key:        process.env.SUPA_KEY || 'sb_publishable_IK5RV-I0PlQNpb7-cXBQFg_-pSYscO6',
  consultor:  process.env.CONSULTOR || 'Thiago',
  // Quem ASSINA a mensagem. Separado do consultor de propósito: o consultor é a
  // conta que gasta o teto (pode ser um @, como "irmaosnaobra__"), e ninguém
  // escreve "Oi! irmaosnaobra__ aqui" pra outro ser humano.
  assinatura: process.env.NOME || process.env.CONSULTOR || 'Thiago',

  // RITMO (anti-ban, 05/11/2026). Tudo vem de ritmo.mjs, e a env só APERTA:
  //   • ENVIO só de segunda a sábado, das 8h às 21h (horário de Brasília). HORA_INI
  //     nunca abaixo de 8, HORA_FIM nunca acima de 21; domingo fechado;
  //   • piso de 45 min entre dois envios da mesma conta: MIN_SEG nunca abaixo de
  //     2700, e MAX_SEG e TETO_ESPERA nunca abaixo do piso (padrão 3600);
  //   • Instagram: rampa de 5 a 10 por dia (rampaDoDia), chip no máximo 10 (ver travas()).
  // Em 11/09 a conta quebrou com DMs de 3 em 3 min, e em 09/10 saíram 12 DMs em
  // 41 min porque a espera calculada só ia para o log e nunca valia.
  // A LISTA continua sendo montada 24h: só o ENVIO obedece a janela.
  minSeg:     RITMO.minSeg,
  maxSeg:     RITMO.maxSeg,
  tetoEspera: RITMO.tetoEspera,
  tetoIgMax:  RITMO.tetoInstagramMax,   // Instagram: máximo 10/dia, a env só desce
  // De quanto em quanto tempo ela olha se alguém respondeu. LER é de graça e
  // não tem risco nenhum — o que custa é enviar. Então ela olha o tempo todo.
  olharSeg:   Number(process.env.OLHAR_SEG || 150), // 2min30
  horaIni:    RITMO.horaIni,
  horaFim:    RITMO.horaFim,
};

// UM CANAL, UMA IDENTIDADE. Instagram e WhatsApp rodam como duas agentes
// separadas, cada uma com seu pulso, seu teto e sua fila. Foi o que o bloqueio
// de 11/09 ensinou: 40 por dia não sai de uma conta forçando, sai de várias
// contas mandando pouco. E uma cair não pode levar a outra junto.
const PULSO_ID = CANAL === 'instagram' ? 1 : 2;
// abordar = primeira mensagem (fila fria) · responder = quem respondeu e está esperando
const MODO  = (ARG.find(a => a.startsWith('--modo='))?.split('=')[1]) || 'abordar';
const API   = process.env.API_BASE || 'https://solardocs-api.vercel.app';

const H = { apikey: CFG.key, Authorization: 'Bearer ' + CFG.key, 'Content-Type': 'application/json' };
const dorme = ms => new Promise(r => setTimeout(r, ms));
const agora = () => new Date().toLocaleTimeString('pt-BR');
const log = (...a) => console.log(`[${agora()}]`, ...a);

// ═══ CDP: o mínimo pra dirigir uma aba ═══════════════════════════════════════
// Um id por mensagem, uma Promise por id. Sem biblioteca: o protocolo é
// "manda json com id, recebe json com o mesmo id".
class Aba {
  constructor(ws) { this.ws = ws; this.id = 0; this.esperando = new Map(); }

  static async abrir(cdpBase) {
    const v = await (await fetch(`${cdpBase}/json/version`)).json();
    if (!v.webSocketDebuggerUrl) throw new Error('Chrome sem porta de debug aberta');
    // Abre uma aba PRÓPRIA do worker. Nunca adota aba sua: o Chrome continua seu.
    const br = await Aba.conectar(v.webSocketDebuggerUrl);
    // background: true é o que impede a janela de pular na frente. Sem ele, cada
    // aba nova tirava o Chrome da agente do minimizado e roubava a tela de quem
    // usava o computador, a cada 2 ou 3 minutos ("o Instagram fica abrindo toda
    // hora", 14/09). Testado num Chrome descartável: com background a janela
    // continua minimizada; sem, ela volta pra frente.
    const { targetId } = await br.enviar('Target.createTarget', { url: 'about:blank', background: true });
    br.fechar();
    const alvos = await (await fetch(`${cdpBase}/json/list`)).json();
    const alvo = alvos.find(t => t.id === targetId);
    if (!alvo) throw new Error('não achei a aba que acabei de criar');
    const aba = await Aba.conectar(alvo.webSocketDebuggerUrl);
    aba.targetId = targetId;
    aba.cdpBase = cdpBase;
    await aba.enviar('Page.enable', {});
    await aba.enviar('Runtime.enable', {});
    return aba;
  }

  static conectar(url) {
    return new Promise((ok, erro) => {
      const ws = new WebSocket(url);
      const aba = new Aba(ws);
      ws.onopen = () => ok(aba);
      ws.onerror = e => erro(new Error('WebSocket falhou: ' + (e.message || 'sem detalhe')));
      ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        const p = aba.esperando.get(m.id);
        if (!p) return;
        aba.esperando.delete(m.id);
        m.error ? p.erro(new Error(m.error.message)) : p.ok(m.result);
      };
    });
  }

  enviar(method, params) {
    const id = ++this.id;
    return new Promise((ok, erro) => {
      this.esperando.set(id, { ok, erro });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.esperando.delete(id)) erro(new Error(`${method} não respondeu em 30s`));
      }, 30000);
    });
  }

  /** Avalia JS na página. Uma nova tentativa de propósito: a causa mais comum de
   *  falha aqui é a página estar navegando na hora — o contexto morre no meio e
   *  volta "Uncaught" sem dizer nada. Meio segundo depois costuma funcionar.
   *  E o erro carrega um pedaço da expressão, senão não dá pra saber qual quebrou. */
  async js(expr, tentativa = 1) {
    const r = await this.enviar('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) {
      if (tentativa < 2) { await dorme(600); return this.js(expr, tentativa + 1); }
      const det = r.exceptionDetails.exception?.description
        || r.exceptionDetails.text || 'erro no JS da página';
      const primeira = String(det).split(/[\r\n]/)[0];
      throw new Error(`${primeira} — em: ${expr.replace(/\s+/g, ' ').slice(0, 70)}`);
    }
    return r.result?.value;
  }

  async ir(url) {
    await this.enviar('Page.navigate', { url });
    await dorme(1200);
  }

  /** Espera uma condição na página. Devolve false em vez de explodir: página que
   *  não carregou é motivo de PULAR o contato, não de derrubar o worker. */
  async esperar(exprBool, ms = 25000, passo = 700) {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      try { if (await this.js(exprBool)) return true; } catch { /* navegando */ }
      await dorme(passo);
    }
    return false;
  }

  /** Digita caractere a caractere, com pausa humana. Não é disfarce: é o que
   *  evita que o React da página perca metade do texto num paste. */
  async digitar(texto) {
    for (const ch of texto) {
      await this.enviar('Input.insertText', { text: ch });
      await dorme(18 + Math.floor(45 * ((Date.now() % 97) / 97)));
    }
  }

  /** Digitação do envio FRIO do Instagram: atraso variável por caractere (60 a 220 ms) e uma pausa
   *  mais longa (1 a 3 s) de vez em quando (a cada 15 a 40 caracteres). Os planos vêm de ritmo.mjs. */
  async digitarHumano(texto) {
    const chars = [...texto];
    const plano = planoDigitacao(chars.length);
    for (let i = 0; i < chars.length; i++) {
      await this.enviar('Input.insertText', { text: chars[i] });
      await dorme(plano[i].atraso + plano[i].pausa);
    }
  }

  /** Rola o perfil por 4 a 12 s (sorteados) antes de abrir a conversa, e volta ao topo. */
  async rolarPerfil() {
    const total = duracaoRolagemMs();
    for (const p of passosRolagem(total)) {
      await this.js(`window.scrollBy({ top: ${p.dy}, behavior: 'smooth' })`).catch(() => {});
      await dorme(p.pausaMs);
    }
    await this.js(`window.scrollTo({ top: 0, behavior: 'smooth' })`).catch(() => {});
    await dorme(600);
    return total;
  }

  /** Fecha a aba do worker — mas NUNCA a ultima do navegador. Fechar a ultima
   *  mata o Chrome inteiro, e num turno de 16 horas isso derruba a operacao no
   *  meio da madrugada sem ninguem pra reabrir. Se for a unica, so navega pra
   *  longe e deixa viva. */
  async fechar() {
    try {
      const abas = await (await fetch(`${this.cdpBase}/json/list`)).json();
      const paginas = (abas || []).filter(t => t.type === 'page');
      if (paginas.length <= 1) {
        await this.enviar('Page.navigate', { url: 'https://www.instagram.com/' }).catch(() => {});
      } else {
        await fetch(`${this.cdpBase}/json/close/${this.targetId}`);
      }
    } catch {}
    try { this.ws.close(); } catch {}
  }
}

// ═══ BANCO ═══════════════════════════════════════════════════════════════════
// Um 504 do Supabase derrubava a rodada inteira: o worker morria antes de
// mandar a primeira mensagem por causa de um soluco de 2 segundos. Tres
// tentativas com espera crescente resolvem o transitorio; erro que persiste
// continua estourando, porque aí é problema de verdade.
const ler = async (q, tentativa = 1) => {
  try {
    const r = await fetch(`${CFG.supa}/${q}`, { headers: H });
    if (r.ok) return await r.json();
    // 4xx é pedido errado — repetir não conserta. 5xx e 429 são transitórios.
    if (r.status < 500 && r.status !== 429) {
      throw new Error(`${q.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    }
    if (tentativa >= 3) throw new Error(`${q.split('?')[0]}: ${r.status} depois de 3 tentativas`);
  } catch (e) {
    if (tentativa >= 3 || /: 4\d\d /.test(e.message)) throw e;
  }
  log(`  banco engasgou em ${q.split('?')[0]} — tentativa ${tentativa + 1} de 3`);
  await dorme(1500 * tentativa);
  return ler(q, tentativa + 1);
};

async function travas() {
  if (CANAL === 'instagram') await garantirRebaixe();   // rebaixe pendente do último bloqueio: repete até gravar
  const [saude, teto, rampa] = await Promise.all([
    ler(`prospeccao_saude?select=*&consultor=eq.${encodeURIComponent(CFG.consultor)}`),
    ler(`prospeccao_teto_hoje?select=*&consultor=eq.${encodeURIComponent(CFG.consultor)}`),
    // Instagram: a alavanca é o teto_manual da rampa (5 a 10). Nulo vale 5; sem linha vale 0.
    CANAL === 'instagram' ? ler(`prospeccao_rampa?select=teto_manual&consultor=eq.${encodeURIComponent(CFG.consultor)}`) : Promise.resolve(null),
  ]);
  const ef = tetoEfetivo(CANAL, {
    teto: teto[0]?.teto,                // sem linha em prospeccao_teto_hoje = teto 0 (falha segura, nunca "5")
    usados: teto[0]?.usados_hoje ?? 0,
    restam: teto[0]?.restam ?? 0,
    tetoManual: rampa === null ? undefined : (rampa[0] ? rampa[0].teto_manual : 0),
  }, bloqueioAtivo(),
  // Sem a prova de teto_manual <= 5 depois do último bloqueio (histórico), o Instagram usa no máximo 5, seja qual for o banco.
  CANAL === 'instagram' ? maxInstagramEfetivo({ bloqueio: lerBloqueio(), historico: lerHistorico(), maxIg: CFG.tetoIgMax }) : CFG.tetoIgMax);
  return {
    // Consultor que não aparece na saúde não tocou ninguém em 14 dias — e quem
    // não tocou ninguém não pode estar queimando linha.
    estado: saude[0]?.estado || 'ok',
    taxa:   saude[0]?.taxa_optout ?? 0,
    // TETO EFETIVO (regra 25): Instagram de 5 a 10/dia pela rampa, chip no máximo 10. O
    // restam da view foi calculado com o teto do banco (12), então é refeito aqui.
    teto:   ef.teto,
    usados: teto[0]?.usados_hoje ?? 0,
    restam: restamComPendente(ef.restam, pendenteAtual()),   // a pendência conta como envio
    porque: teto[0]?.porque || '',
    respostas: teto[0]?.respostas_hoje ?? 0,
  };
}

// ── ÚLTIMO ENVIO, NO DISCO ───────────────────────────────────────────────────
// O piso de 45 min precisa sobreviver a reinício E a banco fora do ar: o laço do
// COMECAR.ps1 religa o node 60 s depois de qualquer queda. Então toda tentativa de
// envio grava a hora neste arquivo ANTES de digitar, e o piso vale a MAIOR hora
// entre o arquivo e o banco (ver faltaPiso em ritmo.mjs).
const ARQ_ULTIMO = fileURLToPath(new URL(`./ultimo-envio-${CANAL}.json`, import.meta.url));
function lerArquivoUltimo() {
  try { return arquivoUltimo(readFileSync(ARQ_ULTIMO, 'utf8')); }
  catch (e) { return e && e.code === 'ENOENT' ? arquivoUltimo(null) : { ok: false, ms: null }; }
}
/** true se gravou. Falha de disco = quem chamou NÃO envia. */
function lerBrutoArquivo() {
  try { return JSON.parse(readFileSync(ARQ_ULTIMO, 'utf8')); } catch { return null; }
}
function gravarArquivoUltimo(ms) {
  try {
    const obj = { ms, em: new Date(ms).toISOString(), canal: CANAL };
    const atual = lerBrutoArquivo();
    if (atual && atual.pendente_gravar) obj.pendente_gravar = atual.pendente_gravar;   // nunca apaga a pendência
    writeFileSync(ARQ_ULTIMO, JSON.stringify(obj));
    return true;
  } catch (e) { log('NÃO consegui gravar ' + ARQ_ULTIMO + ': ' + e.message); return false; }
}

// ── BLOQUEIO DE CONVERSA NOVA, NO DISCO ──────────────────────────────────────
// bloqueio-<canal>.json: { "desde": ISO-8601, "motivo": texto, "perfis": [...] }. Gravado quando o
// detector dispara (3 perfis distintos sem compositor). Na partida, se existir, o canal começa
// bloqueado para conversa NOVA (teto de frio 0); responder quem já conversa segue normal. Só sai à
// mão, ou pelo testar-bloqueio.mjs quando o compositor abre de novo em perfil novo.
const ARQ_BLOQUEIO = fileURLToPath(new URL(`./bloqueio-${CANAL}.json`, import.meta.url));
function lerBloqueio() {
  try { return parseBloqueio(readFileSync(ARQ_BLOQUEIO, 'utf8')); }
  catch (e) { return e && e.code === 'ENOENT' ? parseBloqueio(null) : parseBloqueio('{ilegível'); }
}
function gravarBloqueio(motivo, perfis) {
  try {
    const agoraIso = new Date().toISOString();
    // O histórico PRIMEIRO (freios[], parado no 3º freio em 7 dias), mesclado com o que já existe: se a escrita do
    // arquivo falhar, o robô continua sabendo que há um freio pendente.
    gravarHistorico(registrarFreio(lerHistorico(), agoraIso));
    writeFileSync(ARQ_BLOQUEIO, JSON.stringify({ desde: agoraIso, motivo, perfis: [...perfis], rebaixado: false }, null, 2));
  } catch (e) { log('NÃO consegui gravar ' + ARQ_BLOQUEIO + ': ' + e.message + ' (o bloqueio segue só na memória)'); }
}
const ARQ_RAMPA = fileURLToPath(new URL(`./rampa-${CANAL}.json`, import.meta.url));
const rampaUrl = () => `${CFG.supa}/prospeccao_rampa?consultor=eq.${encodeURIComponent(CFG.consultor)}`;
async function patchRampa(tetoManual, obs) {
  const r = await fetch(rampaUrl(), {
    method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({ teto_manual: tetoManual, atualizado_em: new Date().toISOString(), obs }),
  });
  if (!r.ok) throw new Error('prospeccao_rampa: ' + r.status);
}
const ARQ_HISTORICO = fileURLToPath(new URL(`./historico-bloqueio-${CANAL}.json`, import.meta.url));
/** Histórico do último bloqueio: NÃO se apaga no destrave. */
function lerHistorico() {
  let h;
  try { h = parseHistorico(readFileSync(ARQ_HISTORICO, 'utf8')); }
  catch (e) { return e && e.code === 'ENOENT' ? null : parseHistorico('{ilegível'); }
  // Histórico ANTIGO (sem freios/voltas): semeia UMA vez freios=[ultimo] e voltas=[rebaixadoEm] e grava.
  const s = semearHistoricoAntigo(h, { bloqueado: existsSync(ARQ_BLOQUEIO) });
  if (s.semeou) { log('histórico do bloqueio no formato antigo: semeei freios/voltas a partir de ultimo e rebaixadoEm.'); gravarHistorico(s.h); return s.h; }
  return h;
}
/** true se gravou. */
function gravarHistorico(h) {
  try { writeFileSync(ARQ_HISTORICO, JSON.stringify(h, null, 2)); return true; }
  catch (e) { log('NÃO consegui gravar ' + ARQ_HISTORICO + ': ' + e.message + ' (sem histórico o teto fica em 5 por segurança)'); return false; }
}
function lerMarcaRampa() {
  try { return JSON.parse(readFileSync(ARQ_RAMPA, 'utf8')); } catch { return null; }
}
/** Marca do dia da rampa: { dia, teto (o teto em vigor NAQUELE dia), bloqueio (houve bloqueio nesse dia) }. */
function gravarMarcaRampa(dia, teto, bloqueio = false) {
  const antiga = lerMarcaRampa();
  const bl = bloqueio || Boolean(antiga && antiga.dia === dia && antiga.bloqueio);   // dia de bloqueio fica marcado
  try { writeFileSync(ARQ_RAMPA, JSON.stringify({ dia, teto, bloqueio: bl, em: new Date().toISOString() })); }
  catch (e) { log('NÃO consegui gravar ' + ARQ_RAMPA + ': ' + e.message); }
}
/** Dia do bloqueio: a marca registra (sem gravar PATCH) que hoje foi dia de bloqueio. */
async function rebaixarRampa() {
  if (CANAL !== 'instagram' || DRY) return;
  gravarMarcaRampa(relogioBRT().dia, RAMPA_INICIAL, true);   // o dia do bloqueio nunca conta como cheio, com ou sem PATCH
  await garantirRebaixe(true);
}
let rebaixeTentadoEm = 0;
/**
 * Garante que teto_manual = 5 no banco depois de um bloqueio. Enquanto o histórico estiver com rebaixado:false
 * (PATCH falhou, ou o arquivo de bloqueio foi criado à mão), repete — chamado pelo rampaDoDia e pelo travas.
 * Devolve true se não há rebaixe pendente.
 */
async function garantirRebaixe(forcar = false) {
  if (CANAL !== 'instagram' || DRY) return true;
  const bl = lerBloqueio();
  let h = lerHistorico();
  if (historicoPrecisaSincronizar(bl, h)) {            // arquivo de bloqueio criado à mão (ou mais novo que o histórico)
    // MESCLA com o histórico existente (freios, voltas, testes, parado): um arquivo de bloqueio criado à mão não zera a contagem.
    gravarHistorico({ ...(h || {}), ultimo: bl.desde || new Date().toISOString(), dia: diaDeIso(bl.desde || new Date().toISOString()), rebaixado: bl.rebaixado === true, prova: null });
    h = lerHistorico();
  }
  if (!h || h.rebaixado === true) return true;
  if (!forcar && Date.now() - rebaixeTentadoEm < 60_000) return false;   // no máximo 1 tentativa por minuto
  rebaixeTentadoEm = Date.now();
  try {
    await patchRampa(RAMPA_INICIAL, `RAMPA AUTOMATICA: bloqueio em ${h.dia || 'data desconhecida'}, voltei para ${RAMPA_INICIAL}/dia. Sobe +1 por dia cheio sem bloqueio, teto ${CFG.tetoIgMax}.`);
    gravarHistorico({ ...h, rebaixado: true, rebaixadoEm: new Date().toISOString() });
    if (existsSync(ARQ_BLOQUEIO)) {
      try { const j = JSON.parse(readFileSync(ARQ_BLOQUEIO, 'utf8')); writeFileSync(ARQ_BLOQUEIO, JSON.stringify({ ...j, rebaixado: true }, null, 2)); } catch { /* arquivo ilegível: o histórico já tem a prova */ }
    }
    log(`teto_manual voltou a ${RAMPA_INICIAL} na rampa (prova gravada no histórico).`);
    return true;
  } catch (e) {
    log('não consegui voltar o teto_manual a ' + RAMPA_INICIAL + ' (' + e.message + '). Sigo no máximo 5 no Instagram e tento de novo em 1 min.');
    return false;
  }
}

/** Bloqueado para conversa NOVA? Memória OU arquivo (o arquivo criado à mão vale sem reiniciar). */
const bloqueioAtivo = () => bloqueadaParaNovas || lerBloqueio().bloqueado;

// ── ENVIO PENDENTE DE GRAVAR ─────────────────────────────────────────────────
// A DM saiu (ou pode ter saído) mas o toque NÃO entrou no banco depois de 3 tentativas. Sem o toque
// o banco não enxerga o envio: o teto, a fila única e a view deixariam abordar de novo. Então a
// pendência fica na memória E no arquivo (pendente_gravar: { id, pid, ms }, sobrevive a reinício), e a
// 1ª coisa de cada umaAbordagem é tentar gravar. Enquanto houver pendência, NINGUÉM é abordado.
let pendenteGravar = null;
function pendenteAtual() { return pendenteGravar || lerArquivoUltimo().pendente || null; }
function registrarPendente(id, pid, obs = null) {
  pendenteGravar = { id, pid: pid ?? null, ms: Date.now(), obs };
  try {
    const a = lerBrutoArquivo() || {};
    writeFileSync(ARQ_ULTIMO, JSON.stringify({ ...a, ms: Math.max(Number(a.ms) || 0, pendenteGravar.ms), canal: CANAL, pendente_gravar: pendenteGravar }));
  } catch (e) { log('NÃO consegui gravar a pendência em ' + ARQ_ULTIMO + ': ' + e.message + ' (segue só na memória)'); }
}
function limparPendente() {
  pendenteGravar = null;
  try {
    const a = lerBrutoArquivo();
    if (a && a.pendente_gravar) { delete a.pendente_gravar; writeFileSync(ARQ_ULTIMO, JSON.stringify(a)); }
  } catch { /* sem arquivo, sem pendência */ }
}
/** Tentativa que comprovadamente não enviou nada devolve o arquivo ao que era. */
function restaurarArquivoUltimo(prev) {
  try {
    if (!prev || !prev.ok) return;                       // não sei o que havia: deixo a marca nova (lado seguro)
    if (prev.pendente) return;                           // com pendência o marcador não volta atrás
    if (prev.ms === null) rmSync(ARQ_ULTIMO, { force: true });
    else writeFileSync(ARQ_ULTIMO, JSON.stringify({ ms: prev.ms, canal: CANAL }));
  } catch { /* na dúvida, a marca nova fica */ }
}

async function gravarToque(contatoId, listaId, produtoId, resultado, obs, semMarcador = false, criadoEm = null) {
  if (DRY) return;
  // Envio da fila fria: a hora vai para o disco ANTES do POST, para o piso valer mesmo se o banco estiver fora.
  if (!semMarcador && resultado === 'enviei' && /^worker /.test(obs || '')) gravarArquivoUltimo(Date.now());
  const r = await fetch(`${CFG.supa}/prospeccao_toques`, {
    method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({
      contato_id: contatoId, lista_id: listaId, produto_id: produtoId,
      consultor: CFG.consultor, resultado, valor: 0, obs,
      ...(criadoEm ? { criado_em: criadoEm } : {}),   // pendência gravada depois conta no dia em que a DM saiu
    }),
  });
  // 4xx e 5xx NÃO podem passar calados: toque que não gravou sai da conta do teto, do piso e da fila única.
  if (!r.ok) throw new Error(`prospeccao_toques: ${r.status} ${(await r.text().catch(() => '')).slice(0, 120)}`);
}

// ═══ MENSAGEM ════════════════════════════════════════════════════════════════
// Mesma regra da tela: contexto da empresa escolhe a abertura, e o que a trava
// de alegação bloqueia não sai. Duas definições de "qual mensagem mandar" seria
// a pior coisa que este worker poderia ter.
const CTX = c => Number(c.avaliacoes || 0) >= 20 ? 'movimentada'
              : (c.site || '').trim() ? 'com_site' : 'padrao';

/** A trava de alegações: true = este texto NÃO pode sair. Vale para QUALQUER mensagem, de qualquer canal. */
const fazBloqueia = (alegacoes, produtoId) => t => alegacoes.some(a => {
  if (a.verificada || !a.gatilho) return false;
  if (a.produto_id && a.produto_id !== produtoId) return false;
  try { return new RegExp(a.gatilho, 'i').test(t); } catch { return false; }
});

// WhatsApp (chip): continua nos scripts do banco. O Instagram NÃO passa por aqui: ver escolherMensagem.
function montarMensagem(c, scripts, alegacoes, produtoId, preco) {
  const bloqueia = fazBloqueia(alegacoes, produtoId);
  const doProduto = scripts.filter(s => s.produto_id === produtoId && (s.tipo || 'abertura') === 'abertura');
  const ctx = CTX(c);
  let pool = doProduto.filter(s => (s.contexto || 'padrao') === ctx);
  if (!pool.length) pool = doProduto.filter(s => (s.contexto || 'padrao') === 'padrao');
  if (!pool.length) pool = doProduto;
  const limpos = pool.filter(s => !bloqueia(s.texto));
  if (!limpos.length) return null;                    // tudo bloqueado: não inventa

  // varia pela posição do contato, não por random (random quebra reexecução)
  const s = limpos[(c.empresa || '').length % limpos.length];
  const primeiro = (c.socio || '').trim().split(/\s+/)[0] || '';
  let t = s.texto;
  // Sem nome na ficha, o vocativo SOME — nao vira "voce". "fala voce" e
  // "oi, voce" sao a cara de mensagem automatica que a gente esta evitando.
  // Tira a virgula e o espaco junto, e limpa pontuacao orfa no comeco da linha.
  if (!primeiro) {
    t = t.replace(/[ 	]*,?[ 	]*\{socio\}/g, '')
         .replace(/\{socio\}[ 	]*,?[ 	]*/g, '')
         .replace(/^[ 	]*,[ 	]*/gm, '')
         .replace(/[ 	]+$/gm, '');
    // "fala" sozinho numa linha fica pendurado — gente escreve "fala!" ou
    // emenda na frase. Sem nome, a saudação vira uma linha completa.
    t = t.replace(/^(fala|opa|oi|e aí|e ai|bom dia|boa tarde)$/gim, m => m + '!');
  }
  return t
    .replaceAll('{empresa}', c.empresa || '')
    .replaceAll('{cidade}', c.cidade || '')
    .replaceAll('{consultor}', CFG.assinatura)
    .replaceAll('{socio}', primeiro ? primeiro[0].toUpperCase() + primeiro.slice(1) : 'você')
    .replaceAll('{avaliacoes}', String(c.avaliacoes || '') || 'várias')
    .replaceAll('{nota}', String(c.nota || '') || '—')
    .replaceAll('{preco}', preco);
}

// ── ABERTURA DO INSTAGRAM (peças, ver abertura.mjs) ──────────────────────────
/** Total de toques "worker instagram ... v=<versao> s=" da conta, pelo BANCO (count exato, sem puxar linhas: o PostgREST corta em 1000). */
async function contarToquesDaVersao(versao) {
  const q = `${CFG.supa}/prospeccao_toques?select=id&consultor=eq.${encodeURIComponent(CFG.consultor)}&resultado=eq.enviei&produto_id=eq.solardoc`
    + `&obs=like.*${encodeURIComponent(`v=${versao} s=`)}*&limit=1`;
  const r = await fetch(q, { headers: { ...H, Prefer: 'count=exact' } });
  // O total vem no content-range, seja qual for o status (conjunto vazio pode responder "*/0", até com 416).
  const total = totalDoContentRange(r.headers.get('content-range'));
  if (total === null) throw new Error(`contagem v=${versao}: sem total legível (status ${r.status})`);
  return total;
}
/** A versão com MENOS toques vai agora. Banco falhou: A. Nada de contador em memória. */
async function versaoAgora() {
  try {
    const [a, b] = await Promise.all([contarToquesDaVersao('A'), contarToquesDaVersao('B')]);
    return escolherVersao(a, b);
  } catch (e) { log('  não consegui contar as versões da abertura (' + e.message + '): vai a A'); return 'A'; }
}
/** Combinações (v+s+a+p) que já saíram HOJE nesta conta, lidas dos obs do banco. */
async function combosDeHoje() {
  try {
    const { ini, fim } = limitesDoDia(relogioBRT().dia);
    const t = await ler(`prospeccao_toques?select=obs&consultor=eq.${encodeURIComponent(CFG.consultor)}&resultado=eq.enviei&produto_id=eq.solardoc`
      + `&criado_em=gte.${ini}&criado_em=lt.${fim}&obs=like.${encodeURIComponent('worker instagram')}*`);
    return chavesUsadas(t.map(x => x.obs));
  } catch (e) { log('  não consegui ler as aberturas de hoje (' + e.message + '): sorteio sem o filtro do dia'); return new Set(); }
}

/**
 * A mensagem de UMA abordagem + os obs do toque. Devolve { msg, obs, obsIncerto } ou null (tudo barrado pela trava).
 * Instagram + produto solardoc: abertura montada de peças, em UM balão, versão A/B pela contagem do banco, sem repetir no dia.
 * Outro produto ou WhatsApp: scripts do banco, como sempre.
 */
async function escolherMensagem(c, scripts, alegacoes, pid, preco) {
  // A abertura nova é do SolarDoc no Instagram. Qualquer outro produto (ou o WhatsApp) segue EXATAMENTE o caminho antigo:
  // scripts do banco filtrados por produto_id, montarMensagem e o obs simples.
  if (!usaAberturaNova(CANAL, pid)) {
    const msg = montarMensagem(c, scripts, alegacoes, pid, preco);
    return msg ? { msg, obs: `worker ${CANAL}`, obsIncerto: `worker ${CANAL} incerto` } : null;
  }
  const [versao, usadas] = await Promise.all([versaoAgora(), combosDeHoje()]);
  const ab = escolherAbertura({ empresa: c.empresa, cidade: c.cidade, hora: relogioBRT().hora, versao, usadas, bloqueia: fazBloqueia(alegacoes, pid) });
  if (!ab) return null;
  if (ab.repetida) log('  todas as combinações da versão já saíram hoje; repito uma');
  return { msg: ab.texto, obs: ab.obs, obsIncerto: ab.obsIncerto };
}

// ═══ ENVIO ═══════════════════════════════════════════════════════════════════
async function enviarWhatsApp(aba, tel, msg) {
  const erro = await abrirConversa(aba, tel, 'whatsapp');
  if (erro) return { ok: false, motivo: erro };
  // FRASE POR FRASE. A versão antiga punha a mensagem inteira no &text= do link
  // e apertava Enter uma vez: saía UM balão com todas as linhas grudadas, que no
  // WhatsApp é a cara de disparo. Cada linha do script vira um balão, com a
  // mesma pausa de gente que a resposta já usa.
  // 05/11/2026: abordagem fria é UMA mensagem (rajada de balões derrubou a linha
  // 5040). As linhas viram quebra de linha DENTRO da mensagem (de 7e99c97b).
  const r = await mandarUmaZap(aba, String(msg));
  // Conversa aberta na tela marca como lida o que chega. Fechar é o que deixa a
  // resposta aparecer como "não lida" pra responderZap() achar.
  await fecharConversaZap(aba);
  return r;
}

/** Esvazia a caixa de DM (Ctrl+A, Backspace). Melhor esforço: só roda quando NADA foi enviado. */
async function limparCaixaIG(aba) {
  try {
    await aba.js(`(document.querySelector('div[role="textbox"],textarea[placeholder]')).focus()`);
    for (const type of ['keyDown', 'keyUp']) await aba.enviar('Input.dispatchKeyEvent', { type, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    for (const type of ['keyDown', 'keyUp']) await aba.enviar('Input.dispatchKeyEvent', { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  } catch { /* sem limpar: o rascunho fica numa conversa que não vai ser enviada */ }
}

async function enviarInstagram(aba, handle, msg) {
  // Mesma porta de entrada do modo responder: um lugar só pra consertar quando
  // o Instagram mexer no layout, e o mesmo diagnóstico útil nos dois caminhos.
  // Só o envio frio rola o perfil (4 a 12 s) antes de abrir a conversa.
  const erro = await abrirConversa(aba, handle, 'instagram', { rolar: true });
  if (erro) return { ok: false, motivo: erro };
  // Conversa ANTIGA? Mede ANTES de digitar: linhas de mensagem já na thread. Só uma conversa NOVA
  // (0 linhas) prova que o Instagram deixou abrir conversa nova. Não conseguiu medir = null = tratada como antiga.
  // O histórico pode carregar DEPOIS da caixa: espera 1,5 s (como o lerConversa) e só aceita "0 linhas" se
  // uma 2ª leitura, 1 s depois, também der 0. Qualquer linha em qualquer leitura = antiga; ilegível = null.
  const contarLinhas = () => aba.js(`[...document.querySelectorAll('div[role="row"]')].filter(r => (r.innerText || '').trim().length > 0).length`).catch(() => null);
  await dorme(1500);
  const linhas1 = await contarLinhas();
  await dorme(1000);
  const linhas2 = await contarLinhas();
  const conversaAntiga = (linhas1 > 0 || linhas2 > 0) ? true
    : (linhas1 === 0 && linhas2 === 0) ? false : null;
  log(`  conversa antiga: ${conversaAntiga}`);
  await aba.js(`(document.querySelector('div[role="textbox"],textarea[placeholder]')).focus()`);
  await dorme(700);
  await aba.digitarHumano(msg);
  await dorme(900);
  // Nunca em minuto terminado em 0 ou 5: espera 1 a 4 min PARA FRENTE (nunca para trás). Se a espera
  // empurrar para fora da janela ou para o almoço, NÃO envia e limpa a caixa (nada saiu).
  // A janela (8h-21h, seg-sáb) e o almoço são conferidos SEMPRE no instante do Enter: perfil, rolagem e
  // digitação somam minutos, e uma tentativa começada às 11h59 ou 20h59 chegaria ao Enter já fora.
  const esp = esperaParaMinutoBom(Date.now(), Math.random());
  const quando = new Date(Date.now() + esp);
  if (!podeEnviar(quando, CFG) || emAlmoco(quando)) {
    await limparCaixaIG(aba);
    return { ok: false, motivo: 'no instante do Enter já estaria fora da janela ou no almoço; nada saiu', conversaAntiga };
  }
  if (esp > 0) {
    log(`  minuto terminado em 0 ou 5: espero ${Math.round(esp / 1000)} s antes do Enter`);
    await dorme(esp);
  }
  // O piso conta a partir do Enter, não de quando a tentativa começou (perfil, rolagem, digitação e espera somam minutos).
  gravarArquivoUltimo(Date.now());
  await aba.enviar('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await aba.enviar('Input.dispatchKeyEvent', { type: 'keyUp',   key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await dorme(2500);
  const vazia = await aba.js(
    `((document.querySelector('div[role="textbox"],textarea[placeholder]')?.innerText || '')).trim().length === 0`);
  return vazia ? { ok: true, conversaAntiga } : { ok: false, motivo: 'texto ficou na caixa — não saiu', conversaAntiga };
}

// ═══ OUVIDO: ler a conversa ══════════════════════════════════════════════════
// Dois canais, dois DOMs, um contrato: devolve [{de:'nos'|'lead', texto}].
//
// WhatsApp tem .message-in / .message-out — estáveis há anos.
// Instagram NÃO tem marcador equivalente: a classe é gerada e muda sozinha.
// O que não muda é o LAYOUT — mensagem nossa encosta na direita, dele na
// esquerda. Então o lado é decidido por geometria, não por nome de classe.
// É a única coisa que o Instagram não pode trocar sem virar outro produto.

const SEL_CAIXA = {
  whatsapp:  'footer [contenteditable="true"]',
  instagram: 'div[role="textbox"], textarea[placeholder]',
};

// O que o WhatsApp Web está mostrando agora, numa leitura só. Os seletores vêm
// em lista porque o WhatsApp troca rótulo por idioma e por versão.
//
// Quando outra aba da mesma sessão tomou a frente, ele mostra "Usar aqui". Aí
// clica e segue: a aba da agente é a que tem que valer.
const ESTADO_ZAP = `(() => {
  if (document.querySelector('footer [contenteditable="true"]')) return 'caixa';
  if (document.querySelector('canvas[aria-label*="QR" i], canvas[aria-label*="scan" i], div[data-ref]')) return 'qr';
  const aviso = [...document.querySelectorAll('[role="dialog"], [data-animate-modal-popup]')]
    .map(d => d.innerText || '').join(' ');
  if (/inv[aá]lid|n[aã]o est[aá] no whatsapp|isn.t on whatsapp|not on whatsapp/i.test(aviso)) return 'sem_whatsapp';
  const usarAqui = [...document.querySelectorAll('button, div[role="button"]')]
    .find(b => /^(usar aqui|use here)$/i.test((b.innerText || '').trim()));
  if (usarAqui) { usarAqui.click(); return null; }
  if (document.querySelector('#pane-side, [aria-label="Chat list"], [aria-label="Lista de conversas"]')) return 'lista';
  return null;
})()`;

async function abrirConversa(aba, alvo, canal, { rolar = false } = {}) {
  if (canal === 'instagram') {
    await aba.ir('https://www.instagram.com/' + alvo + '/');
    if (!await aba.esperar('!!document.querySelector("main")', 25000)) return 'perfil não carregou';

    // Perfil que nem existe: o Instagram serve a pagina de erro, nao um perfil.
    const sumiu = await aba.js('/desculpe|sorry|not available|nao esta disponivel/i'
      + '.test((document.querySelector("main")?.innerText || "").slice(0, 400))');
    if (sumiu) return 'perfil não existe mais (ou foi renomeado)';

    // Antes de abrir a conversa, gente olha o perfil: rola por 4 a 12 s (sorteados). Só no envio frio.
    if (rolar) await aba.rolarPerfil();

    // O rotulo do botao muda com idioma, com tema e com o Instagram mudando de
    // ideia. Duas passadas: primeiro o texto exato, depois um "contém". Se as
    // duas falharem, DEVOLVE O QUE VIU — sem isso o erro nao ensina nada e a
    // correcao vira adivinhacao em cima de adivinhacao.
    const r = await aba.js(`(() => {
      const els = [...document.querySelectorAll('div[role="button"],button,a')]
        .map(e => ({ e, t: (e.innerText || '').trim() }))
        .filter(x => x.t && x.t.length < 40);
      const exato = /^(enviar mensagem|mensagem|message|send message)$/i;
      const contem = /(mensagem|message)/i;
      let alvo = els.find(x => exato.test(x.t)) || els.find(x => contem.test(x.t));
      if (alvo) { alvo.e.click(); return { ok: true, usou: alvo.t }; }
      return { ok: false, vistos: [...new Set(els.map(x => x.t))].slice(0, 14) };
    })()`);

    if (!r || !r.ok) {
      const vistos = (r && r.vistos || []).join(' | ') || '(nenhum botão com texto)';
      return 'botão de mensagem não encontrado. Botões visíveis: ' + vistos;
    }
  } else {
    await aba.ir('https://web.whatsapp.com/send?phone=' + alvo);
    // Três finais possíveis, e só esperar a caixa confundia os três: número sem
    // WhatsApp, sessão caída e página lenta viravam o mesmo "não abriu" depois
    // de 45 segundos. Cada um pede uma coisa diferente, então cada um é dito.
    const fim = Date.now() + 60000;
    while (Date.now() < fim) {
      const r = await aba.js(ESTADO_ZAP).catch(() => null);
      if (r === 'caixa') return null;
      if (r === 'qr') return 'WhatsApp deslogado: alguém precisa ler o QR de novo';
      if (r === 'sem_whatsapp') return 'número sem WhatsApp';
      await dorme(1000);
    }
    return 'caixa de mensagem não abriu (a página não terminou de carregar)';
  }

  const ok = await aba.esperar('!!document.querySelector(\'' + SEL_CAIXA[canal] + '\')', 45000);
  if (ok) return null;

  // Mesma ideia na caixa: dizer o que existe na tela em vez de "nao abriu".
  if (canal === 'instagram') {
    const pistas = await aba.js(`(() => {
      const t = (document.body.innerText || '').slice(0, 600);
      return {
        url: location.href,
        limite: /limite|limit|tente novamente|try again|espere/i.test(t),
        trecho: t.replace(/[ \\s]+/g, ' ').slice(0, 180),
      };
    })()`);
    if (pistas?.limite) return 'o Instagram pediu pra esperar — parece limite de envio. Pare por hoje.';
    return 'caixa de DM não abriu (em ' + (pistas?.url || '?') + '). Tela dizia: "' + (pistas?.trecho || '') + '"';
  }
  return 'caixa de mensagem não abriu';
}

async function lerConversa(aba, alvo, canal, quantas = 12) {
  const erro = await abrirConversa(aba, alvo, canal);
  if (erro) return { erro };
  await dorme(1500);

  const js = canal === 'whatsapp'
    ? '(() => {'
      + ' const l = [...document.querySelectorAll(".message-in, .message-out")];'
      + ' return l.slice(-' + quantas + ').map(el => ({'
      + '   de: el.classList.contains("message-in") ? "lead" : "nos",'
      + '   texto: (el.querySelector(".selectable-text")?.innerText || el.innerText || "")'
      + '            .replace(/[ \\s]+/g, " ").trim().slice(0, 600),'
      + ' })).filter(m => m.texto); })()'
    // Instagram: lado por geometria. Pega as linhas da thread, mede o centro de
    // cada uma contra o centro do container. Direita = nossa, esquerda = dele.
    : '(() => {'
      + ' const rows = [...document.querySelectorAll(\'div[role="row"]\')];'
      + ' if (!rows.length) return [];'
      + ' const cont = rows[0].parentElement?.getBoundingClientRect();'
      + ' if (!cont || !cont.width) return [];'
      + ' const meio = cont.left + cont.width / 2;'
      + ' return rows.slice(-' + quantas + ').map(r => {'
      + '   const txt = (r.innerText || "").replace(/[ \\s]+/g, " ").trim().slice(0, 600);'
      + '   if (!txt) return null;'
      + '   const b = r.getBoundingClientRect();'
      + '   const centro = b.left + b.width / 2;'
      + '   return { de: centro > meio ? "nos" : "lead", texto: txt };'
      + ' }).filter(Boolean); })()';

  const msgs = await aba.js(js);
  return { msgs: msgs || [] };
}

// ═══ BOCA: digitar as bolhas, uma mensagem por bolha ═════════════════════════
// UMA MENSAGEM NO WHATSAPP, com as linhas dentro dela (03/10/2026).
//
// Duas lições do Instagram valem aqui:
//   1. o Enter só envia com a janela EM FOCO, e a agente roda escondida
//      (document.hasFocus() = false). Então o envio é CLIQUE no botão de
//      enviar; o Enter fica de reserva.
//   2. "caixa vazia" não prova envio. A prova é o balão nosso (.message-out)
//      com a última linha do texto, procurado por até 20 s.
// Quebra de linha dentro da mensagem é Shift+Enter. NADA DISTO FOI PROVADO COM
// SESSÃO LOGADA: no primeiro dia do chip, conferir os primeiros envios por foto.
async function mandarUmaZap(aba, msg) {
  const CX = 'document.querySelector(\'' + SEL_CAIXA.whatsapp + '\')';
  if (!await aba.esperar('!!' + CX, 20000)) return { ok: false, motivo: 'caixa de mensagem não apareceu' };
  await aba.js(CX + '.focus()');
  await dorme(500);
  const linhas = msg.split(/\r?\n/);
  for (let i = 0; i < linhas.length; i++) {
    if (linhas[i]) await aba.digitar(linhas[i]);
    if (i < linhas.length - 1) {
      for (const type of ['keyDown', 'keyUp']) {
        await aba.enviar('Input.dispatchKeyEvent',
          { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 8 });
      }
      await dorme(120);
    }
  }
  await dorme(900);
  const clicou = await aba.js(`(() => {
    const b = document.querySelector('button[aria-label="Send"],button[aria-label="Enviar"],[data-icon="send"],[data-icon="wds-ic-send-filled"]');
    const alvo = b && (b.closest('button,[role="button"]') || b);
    if (alvo) { alvo.click(); return true; }
    return false;
  })()`);
  if (!clicou) {
    for (const type of ['keyDown', 'keyUp']) {
      await aba.enviar('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    }
  }
  const ultima = msg.split(/\r?\n/).map(x => x.trim()).filter(Boolean).pop() || '';
  const CONFERIR = `(() => {
    const alvo = ${JSON.stringify(ultima.slice(0, 50))};
    return [...document.querySelectorAll('.message-out')].some(e => (e.innerText || '').includes(alvo));
  })()`;
  for (let i = 0; i < 10; i++) {
    if (await aba.js(CONFERIR).catch(() => false)) return { ok: true };
    await dorme(2000);
  }
  return { ok: false, motivo: 'mensagem ficou na caixa — não saiu' };
}

// Uma bolha por Enter. Mandar tudo junto vira parede de texto — a cara de robô
// que a casa evita em todos os outros agentes.
async function mandarBolhas(aba, bolhas, canal) {
  const CX = 'document.querySelector(\'' + SEL_CAIXA[canal] + '\')';
  for (const b of bolhas) {
    if (!await aba.esperar('!!' + CX, 20000)) return { ok: false, motivo: 'caixa sumiu no meio' };
    await aba.js(CX + '.focus()');
    await dorme(400);
    await aba.digitar(b);
    await dorme(500);
    await aba.enviar('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await aba.enviar('Input.dispatchKeyEvent', { type: 'keyUp',   key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await dorme(1800);
    const vazia = await aba.js('(' + CX + '?.innerText || "").trim().length === 0');
    if (!vazia) return { ok: false, motivo: 'bolha ficou na caixa — não saiu' };
    // gente não manda 3 mensagens no mesmo segundo
    await dorme(1200 + Math.floor(1800 * ((Date.now() % 991) / 991)));
  }
  return { ok: true };
}

// ═══ WHATSAPP: UMA ABA FIXA, DO JEITO QUE GENTE USA ══════════════════════════
// No Instagram cada ação abre e fecha a própria aba. No WhatsApp isso seria
// recarregar o aplicativo inteiro a cada conversa: 15 a 30 segundos, centenas
// de MB indo e voltando, e uma sessão "nascendo" dezenas de vezes por dia.
// Ninguém usa WhatsApp Web assim. Aqui fica UMA aba aberta, e quem respondeu é
// achado na lista, pelo contador de não lidas, sem recarregar nada.
//
// Uma aba só também por outro motivo: o WhatsApp Web não aceita duas abas da
// mesma sessão. A segunda mostra "Usar aqui" e derruba a primeira.
let abaZap = null;

async function zap() {
  if (abaZap) {
    try { await abaZap.js('1'); return abaZap; }
    catch { try { abaZap.ws.close(); } catch { } abaZap = null; }
  }
  const aba = await Aba.abrir(CFG.cdp);
  await aba.ir('https://web.whatsapp.com/');
  abaZap = aba;
  return aba;
}

async function fecharConversaZap(aba) {
  for (const type of ['keyDown', 'keyUp']) {
    await aba.enviar('Input.dispatchKeyEvent',
      { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
  }
  await dorme(600);
}

// O telefone como o WhatsApp mostra e como a base guarda nem sempre batem: conta
// antiga aparece sem o 9 na frente. DDD + últimos 8 dígitos casa os dois.
const chaveTel = t => {
  const d = String(t || '').replace(/\D/g, '');
  return d.length >= 12 ? d.slice(2, 4) + d.slice(-8) : d;
};

/** { logado: true | false | null, conta }. null é "não deu pra afirmar", não "deslogado". */
async function sessaoZap() {
  try {
    const aba = await zap();
    const fim = Date.now() + 90000;   // a primeira carga sincroniza as conversas e demora
    while (Date.now() < fim) {
      const r = await aba.js(ESTADO_ZAP).catch(() => null);
      if (r === 'lista' || r === 'caixa') {
        const wid = await aba.js("(() => { try { return localStorage.getItem('last-wid-md')"
          + " || localStorage.getItem('last-wid'); } catch (e) { return null; } })()").catch(() => null);
        return { logado: true, conta: (String(wid || '').match(/\d{10,15}/) || [])[0] || null };
      }
      if (r === 'qr') return { logado: false, conta: null };
      await dorme(1500);
    }
  } catch { /* Chrome engasgado: quem cuida disso é o chromeVivo() */ }
  return { logado: null, conta: null };
}

// A PROVA NO WHATSAPP.
//
// No Instagram as imagens saem pela API da Meta. Aqui não existe API, então sai
// como gente manda: clipe, escolhe o arquivo, envia. Os arquivos são os MESMOS
// que o Instagram manda (dashboard/public/dm), lidos do disco, então as duas
// agentes mostram a mesma prova.
//
// A confirmação é um balão nosso a mais na conversa, não o botão sumir: o
// editor de imagem muda de cara a cada versão do WhatsApp, e "tem uma mensagem
// minha a mais" não muda nunca. Se não der, manda o link da imagem, que é pior
// mas não quebra a promessa que a conversa acabou de fazer.
const PASTA_MATERIAL = fileURLToPath(new URL('../dashboard/public/dm/', import.meta.url));

async function mandarImagemZap(aba, chave) {
  const arquivo = PASTA_MATERIAL + chave + '.jpg';
  const antes = await aba.js('document.querySelectorAll(".message-out").length').catch(() => 0);
  try {
    if (!existsSync(arquivo)) throw new Error('arquivo não existe: ' + arquivo);
    const abriu = await aba.js(`(() => {
      const el = document.querySelector('footer [data-icon="plus-rounded"], footer [data-icon="plus"],'
        + ' footer [data-icon="attach-menu-plus"], footer [data-icon="clip"], footer [aria-label="Anexar"],'
        + ' footer [title="Anexar"], footer [aria-label="Attach"], footer [title="Attach"]');
      if (!el) return false;
      (el.closest('button,[role="button"]') || el).click();
      return true;
    })()`);
    if (!abriu) throw new Error('não achei o clipe');
    await dorme(1500);
    const doc = await aba.enviar('DOM.getDocument', { depth: 1 });
    // "Fotos e vídeos" aceita imagem E vídeo. Só imagem pode ser o de figurinha.
    let campo = await aba.enviar('DOM.querySelector',
      { nodeId: doc.root.nodeId, selector: 'input[type="file"][accept*="image"][accept*="video"]' });
    if (!campo?.nodeId) campo = await aba.enviar('DOM.querySelector',
      { nodeId: doc.root.nodeId, selector: 'input[type="file"][accept*="image"]' });
    if (!campo?.nodeId) throw new Error('não achei o campo de arquivo');
    await aba.enviar('DOM.setFileInputFiles', { nodeId: campo.nodeId, files: [arquivo] });
    await dorme(2500);
    const clicou = await aba.js(`(() => {
      const el = document.querySelector('[data-icon="send"], [data-icon="wds-ic-send-filled"],'
        + ' [aria-label="Enviar"], [aria-label="Send"]');
      if (!el) return false;
      (el.closest('button,[role="button"]') || el).click();
      return true;
    })()`);
    if (!clicou) throw new Error('o editor de imagem não mostrou o botão de enviar');
    if (!await aba.esperar(`document.querySelectorAll(".message-out").length > ${antes}`, 25000, 800)) {
      throw new Error('a imagem não apareceu na conversa');
    }
    return true;
  } catch (e) {
    log('  imagem ' + chave + ' não foi como arquivo (' + e.message + '). Mando o link dela.');
    await fecharConversaZap(aba);   // o Escape fecha o menu ou o editor que ficou aberto
    const r = await mandarBolhas(aba, ['https://solardoc.app/dm/' + chave + '.jpg'], 'whatsapp');
    return r.ok;
  }
}

// QUEM RESPONDEU NO WHATSAPP.
//
// O caminho antigo abria conversa por conversa, recarregando o WhatsApp a cada
// uma, pra ver se a última mensagem era do lead. Com 40 conversas em aberto isso
// é meia hora por volta ANTES da primeira abordagem sair: foi exatamente o que
// travava o Instagram até a resposta ir pro webhook.
//
// Aqui é o que uma pessoa faz: olha a lista, vê o contador de não lidas, abre só
// essas. E só as que ESTA agente começou.
const LER_MSGS_ZAP = '(() => {'
  + ' const l = [...document.querySelectorAll(".message-in, .message-out")];'
  + ' return l.slice(-12).map(el => ({'
  + '   de: el.classList.contains("message-in") ? "lead" : "nos",'
  + '   texto: (el.querySelector(".selectable-text")?.innerText || el.innerText || "")'
  + '            .replace(/\\s+/g, " ").trim().slice(0, 600),'
  + ' })).filter(m => m.texto); })()';

// Abrir a conversa marca como lida. Se a cabeça falhar DEPOIS de abrir, a
// pessoa some da lista de não lidas e a resposta dela se perderia calada. Quem
// cai aqui é conferido de novo na volta seguinte, pelo endereço direto.
const retentarZap = new Set();

// Respostas automáticas já tratadas (a API devolveu nao_enviar): não consulta de novo a mesma última mensagem.
const ARQ_TRATADAS = fileURLToPath(new URL(`./respostas-automaticas-${CANAL}.json`, import.meta.url));
const lerTratadasArq = () => { try { return lerTratadas(readFileSync(ARQ_TRATADAS, 'utf8')); } catch { return {}; } };
function marcarTratadaArq(contatoId, texto) {
  try { writeFileSync(ARQ_TRATADAS, JSON.stringify(marcarTratada(lerTratadasArq(), contatoId, texto))); }
  catch (e) { log('NÃO consegui gravar ' + ARQ_TRATADAS + ': ' + e.message + ' (a API pode ser consultada de novo)'); }
}

async function abrirLinhaZap(aba, chave) {
  const pos = await aba.js(`(() => {
    const lista = document.querySelector('#pane-side, [aria-label="Chat list"], [aria-label="Lista de conversas"]');
    if (!lista) return null;
    for (const l of lista.querySelectorAll('[role="listitem"], [role="row"]')) {
      const d = (l.querySelector('span[title]')?.getAttribute('title') || '').replace(/\\D/g, '');
      const k = d.length >= 12 ? d.slice(2, 4) + d.slice(-8) : d;
      if (k !== ${JSON.stringify(chave)}) continue;
      l.scrollIntoView({ block: 'center' });
      const b = l.getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
    }
    return null;
  })()`);
  if (!pos) return false;
  // Clique de mouse de verdade: a lista do WhatsApp reage a mousedown, e um
  // .click() de JavaScript nem sempre abre a conversa.
  for (const type of ['mousePressed', 'mouseReleased']) {
    await aba.enviar('Input.dispatchMouseEvent', { type, x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
  }
  return await aba.esperar('!!document.querySelector(\'footer [contenteditable="true"]\')', 15000);
}

async function responderZap() {
  const aba = await zap();
  const naoLidas = await aba.js(`(() => {
    const lista = document.querySelector('#pane-side, [aria-label="Chat list"], [aria-label="Lista de conversas"]');
    if (!lista) return null;
    const vistas = new Set();
    for (const l of lista.querySelectorAll('[role="listitem"], [role="row"]')) {
      if (!l.querySelector('[aria-label*="unread" i], [aria-label*="não lida" i], [aria-label*="nao lida" i]')) continue;
      const d = (l.querySelector('span[title]')?.getAttribute('title') || '').replace(/\\D/g, '');
      if (d.length >= 12) vistas.add(d.slice(2, 4) + d.slice(-8));
    }
    return [...vistas];
  })()`).catch(() => null);
  if (naoLidas === null) return;                       // lista não carregou: a sessão é conferida no começo da volta
  if (!naoLidas.length && !retentarZap.size) return;   // ninguém respondeu: nem consulta o banco

  // Só conversa que ESTA agente começou. Número que escreveu por outro motivo
  // não é assunto dela, e responder com IA a quem não foi abordado é pior que
  // não responder.
  const meus = await ler('prospeccao_toques?select=contato_id&consultor=eq.'
    + encodeURIComponent(CFG.consultor) + '&order=criado_em.desc&limit=300');
  const ids = [...new Set(meus.map(t => t.contato_id))];
  if (!ids.length) return;
  const fichas = await ler('prospeccao_contato_estado?select=contato_id,empresa,telefone,lista_id'
    + '&contato_id=in.(' + ids.join(',') + ')');
  const porChave = new Map(fichas.map(f => [chaveTel(f.telefone), f]));

  const aVer = [...new Set([...naoLidas, ...retentarZap])].filter(k => porChave.has(k));
  for (const k of aVer) {
    const c = porChave.get(k);
    let hist = null;
    try {
      if (naoLidas.includes(k)) {
        if (!await abrirLinhaZap(aba, k)) throw new Error('não consegui abrir a conversa pela lista');
        await dorme(1500);
        hist = (await aba.js(LER_MSGS_ZAP)) || [];
      } else {
        const r = await lerConversa(aba, String(c.telefone || '').replace(/\D/g, ''), 'whatsapp');
        if (r.erro) throw new Error(r.erro);
        hist = r.msgs;
      }
    } catch (e) {
      log('  x ' + c.empresa + ': ' + e.message);
      retentarZap.add(k);
      continue;
    }
    if (!hist.length || hist[hist.length - 1].de !== 'lead') {
      retentarZap.delete(k);
      await fecharConversaZap(aba);
      continue;
    }

    // Última mensagem dele já foi tratada como resposta automática: não gasta modelo de novo.
    if (jaTratada(lerTratadasArq(), c.contato_id, hist[hist.length - 1].texto)) {
      retentarZap.delete(k);
      await fecharConversaZap(aba);
      continue;
    }

    let v = null;
    try {
      const r = await fetch(API + '/gerador/prospeccao/responder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa: c.empresa, produto_id: 'solardoc', historico: hist,
          contato_id: c.contato_id, canal: 'whatsapp' }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      v = await r.json();
    } catch (e) {
      log('  x ' + c.empresa + ': a cabeça não respondeu (' + e.message + '). Confiro de novo na próxima volta.');
      retentarZap.add(k);
      await fecharConversaZap(aba);
      continue;
    }

    const material = v.material || [];
    console.log('\n─── ' + c.empresa + ' · WhatsApp ───');
    console.log('  ele: "' + hist[hist.length - 1].texto.slice(0, 110) + '"');
    console.log('  -> ' + v.intencao + ' / ' + v.resultado + (v.escalar ? ' · ESCALAR' : '')
      + (material.length ? ' · material: ' + material.join(',') : '') + (v.mandar_link ? ' · manda link' : ''));
    (v.bolhas || []).forEach(b => console.log('  | ' + b));
    // Resposta automática de perfil: a API manda nao_enviar. Não envia, NÃO grava toque (o contato não trava).
    if (v.nao_enviar === true) {
      log('  ' + c.empresa + ': resposta automática de perfil; segui sem responder (sem toque gravado).');
      if (!DRY) marcarTratadaArq(c.contato_id, hist[hist.length - 1].texto);
      retentarZap.delete(k);
      await fecharConversaZap(aba);
      continue;
    }
    if (DRY) { retentarZap.delete(k); await fecharConversaZap(aba); continue; }

    // A MESMA ORDEM DO INSTAGRAM (planoDeEnvio): fala, prova, link. Prova antes
    // do link faz a pessoa clicar já convencida.
    const link = v.mandar_link ? ((v.envio || [])[(v.bolhas || []).length] || null) : null;
    // Antes de CADA resposta: o número logado ainda é o do chip?
    const ccR = await contaDoChipOk();
    if (!ccR.ok) {
      log('  NÃO respondo: ' + ccR.motivo + '.');
      zapLogado = false;
      await fecharConversaZap(aba);
      break;
    }
    let env = await mandarBolhas(aba, v.bolhas || [], 'whatsapp');
    if (env.ok) for (const m of material) await mandarImagemZap(aba, m);
    if (env.ok && link) env = await mandarBolhas(aba, [link], 'whatsapp');
    await fecharConversaZap(aba);
    if (!env.ok) {
      // Na volta seguinte ela relê: se algum balão nosso saiu, a última mensagem
      // é nossa e ela não repete. Se nada saiu, tenta de novo.
      log('  x ' + c.empresa + ': ' + env.motivo);
      retentarZap.add(k);
      continue;
    }
    retentarZap.delete(k);

    await gravarToque(c.contato_id, c.lista_id, 'solardoc', v.resultado,
      ('IA(zap): ' + v.intencao + (material.length ? ' · material: ' + material.join(',') : '')
        + (v.escalar ? ' · PRECISA DE HUMANO' : '') + ': ' + v.motivo).slice(0, 400));

    if (v.resultado === 'nao_perturbar') {
      await fetch(CFG.supa + '/prospeccao_contatos?id=eq.' + c.contato_id, {
        method: 'PATCH', headers: H, body: JSON.stringify({ bloqueado: true }),
      }).catch(() => {});
      log('  contato bloqueado: não entra mais em fila nenhuma');
    }
    if (v.escalar) log('  ESCALADO: alguém precisa olhar essa conversa');
    await dorme(8000 + Math.floor(12000 * ((Date.now() % 997) / 997)));
  }
}

// ═══ MODO RESPONDER ══════════════════════════════════════════════════════════
// Só chama a IA se a ÚLTIMA mensagem for do lead. Chamar pra conversa onde nós
// falamos por último seria pagar pra descobrir que não há o que responder.
async function modoResponder() {
  // sem_retorno entra junto de proposito. Depois que 'conversa_viva' passou a
  // exigir recencia, quem respondeu ha um mes caiu pra sem_retorno — e essa e
  // exatamente a pessoa cuja resposta talvez nunca tenha sido lida. Ler a
  // conversa e barato; so chama a IA se a ultima mensagem for dela.
  const todas = await ler(
    'prospeccao_contato_estado?select=contato_id,empresa,telefone,canal,lista_id'
    + '&canal=in.(aguardando,conversa_viva,sem_retorno)&order=ultimo_toque_em.desc&limit=200');
  // Instagram só alcança quem tem @. Buscar o handle aqui (e não na view)
  // mantém prospeccao_contato_estado do jeito que a tela já usa.
  let esperando = todas;
  if (CANAL === 'instagram') {
    const ids = todas.map(c => c.contato_id).join(',');
    const arrobas = ids
      ? await ler('prospeccao_contatos?select=id,instagram&id=in.(' + ids + ')&instagram=not.is.null&instagram=neq.')
      : [];
    const porId = new Map(arrobas.map(a => [a.id, a.instagram]));
    esperando = todas.filter(c => porId.has(c.contato_id))
                     .map(c => ({ ...c, instagram: porId.get(c.contato_id) }));
    if (MODO !== 'continuo') log(todas.length + ' conversas em aberto · ' + esperando.length + ' com @ de Instagram');
  } else {
    // Em modo contínuo isto roda a cada 2 min: falar toda vez viraria parede de
  // log e esconderia o que importa. Só avisa quando há algo pra fazer.
  if (MODO !== 'continuo') log(esperando.length + ' conversas em aberto pra conferir');
  }
  if (!esperando.length) return;

  let aba = null;
  try { aba = await Aba.abrir(CFG.cdp); }
  catch (e) {
    log('NÃO CONSEGUI FALAR COM O CHROME:', e.message);
    log('Sem Chrome não dá pra LER conversa nenhuma. Listando quem eu conferiria:');
    todas.slice(0, 20).forEach(c => console.log('  · ' + c.empresa + ' (' + c.telefone + ')'));
    return;
  }
  log(DRY ? 'Chrome conectado — vou LER e mostrar a resposta, sem mandar nada.' : 'Chrome conectado.');

  let respondidas = 0, semNovidade = 0, falhas = 0;
  for (const c of esperando) {
    const alvo = CANAL === 'instagram' ? c.instagram : c.telefone;
    // Uma conversa que quebra nao pode derrubar a rodada inteira: sao 170 e a
    // proxima pode ser justamente a que respondeu.
    let hist = null, erro = null;
    try { ({ msgs: hist, erro } = await lerConversa(aba, alvo, CANAL)); }
    catch (e) { erro = e.message; }
    if (erro || !hist || !hist.length) {
      falhas++; log('  x ' + c.empresa + ': ' + (erro || 'conversa vazia')); continue;
    }
    if (hist[hist.length - 1].de !== 'lead') { semNovidade++; continue; }
    // Última mensagem dele já foi tratada como resposta automática: não gasta modelo de novo.
    if (jaTratada(lerTratadasArq(), c.contato_id, hist[hist.length - 1].texto)) { semNovidade++; continue; }

    let v = null;
    try {
      const r = await fetch(API + '/gerador/prospeccao/responder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa: c.empresa, produto_id: 'solardoc', historico: hist,
          contato_id: c.contato_id, canal: CANAL }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      v = await r.json();
    } catch (e) { falhas++; log('  x ' + c.empresa + ': a cabeça não respondeu (' + e.message + ')'); continue; }

    console.log('\n─── ' + c.empresa + ' · ' + (CANAL === 'instagram' ? '@' + c.instagram : c.telefone) + ' ───');
    console.log('  ele: "' + hist[hist.length - 1].texto.slice(0, 110) + '"');
    console.log('  -> ' + v.intencao + ' / ' + v.resultado
      + (v.escalar ? ' · ESCALAR' : '') + (v.mandar_link ? ' · manda link' : ''));
    (v.envio || []).forEach(b => console.log('  | ' + b));

    // Resposta automática de perfil: a API manda nao_enviar. Não envia, NÃO grava toque (o contato não trava).
    if (v.nao_enviar === true) {
      log('  ' + c.empresa + ': resposta automática de perfil; segui sem responder (sem toque gravado).');
      if (!DRY) marcarTratadaArq(c.contato_id, hist[hist.length - 1].texto);
      continue;
    }

    if (DRY) { respondidas++; continue; }

    if (CANAL === 'whatsapp') {
      const ccR = await contaDoChipOk();
      if (!ccR.ok) { log('  NÃO respondo: ' + ccR.motivo + '.'); break; }
    }
    const env = await mandarBolhas(aba, v.envio, CANAL);
    if (!env.ok) { falhas++; log('  x ' + env.motivo); continue; }
    respondidas++;
    await gravarToque(c.contato_id, c.lista_id, 'solardoc', v.resultado,
      ('IA: ' + v.intencao + (v.escalar ? ' · PRECISA DE HUMANO' : '') + ' — ' + v.motivo).slice(0, 400));

    // 'nao_perturbar' bloqueia o contato, igual a tela faz. Sem isto ele
    // voltaria pra fila fria amanhã depois de ter pedido pra parar.
    if (v.resultado === 'nao_perturbar') {
      await fetch(CFG.supa + '/prospeccao_contatos?id=eq.' + c.contato_id, {
        method: 'PATCH', headers: H, body: JSON.stringify({ bloqueado: true }),
      }).catch(() => {});
      log('  contato bloqueado — não entra mais em fila nenhuma');
    }
    if (v.escalar) log('  ESCALADO: alguém precisa olhar essa conversa');
    await dorme(8000 + Math.floor(12000 * ((Date.now() % 997) / 997)));
  }

  await aba.fechar();
  if (MODO === 'continuo') {
    // Em contínuo só fala quando fez alguma coisa. Silêncio = ninguém respondeu.
    if (respondidas || falhas) log(`respondi ${respondidas}${falhas ? `, ${falhas} falha(s)` : ''}`);
  } else {
    console.log('\n─────────────────────────────────────────');
    console.log('  ' + (DRY ? 'simuladas   ' : 'respondidas ') + respondidas);
    console.log('  sem novidade ' + semNovidade);
    console.log('  falhas       ' + falhas);
    console.log('─────────────────────────────────────────');
    console.log('\nAcompanhe no radar: https://solardoc.app/gerador/radar/\n');
  }
}

// ═══ QUEM CADA CANAL ABORDA ══════════════════════════════════════════════════
// UMA EMPRESA, UM CANAL. O Instagram fica com quem tem @. O WhatsApp fica com
// quem o Instagram não alcança: sem @, nunca tocada por ninguém, com celular (o
// fixo do Google Maps não tem WhatsApp) e sem a marca de número sem WhatsApp.
// Assim ninguém recebe a mesma abordagem duas vezes, uma de cada lado, que é o
// jeito mais rápido de virar denúncia nas duas contas.
const CELULAR = /^55[1-9][0-9]9[0-9]{8}$/;
function alvoDoCanal(c) {
  if (CANAL === 'instagram') return !!(c.instagram || '').trim();
  return c.canal === 'nunca_tocado'
    && !(c.instagram || '').trim()
    && !c.whatsapp_invalido_em
    && CELULAR.test(String(c.telefone || '').replace(/\D/g, ''));
}

// ═══ RAMPA DO DIA (Instagram) ════════════════════════════════════════════════
// Uma vez por dia. A regra é pura (ritmo.mjs/decidirRampa); aqui só se leem as fontes e se grava.
let rampaOlhadaEm = null;
async function rampaDoDia() {
  if (CANAL !== 'instagram' || DRY) return;
  const rebaixeOk = await garantirRebaixe();   // PATCH de rebaixe pendente: repete antes de qualquer coisa
  const hoje = relogioBRT().dia;
  if (rampaOlhadaEm === hoje) return;
  rampaOlhadaEm = hoje;
  try {
    const marca = lerMarcaRampa();
    const r = (await ler(`prospeccao_rampa?select=teto_manual,atualizado_em&consultor=eq.${encodeURIComponent(CFG.consultor)}`))[0];
    if (!r) { log('rampa do dia: sem linha em prospeccao_rampa, não mexo.'); return; }
    const anterior = diaAnteriorUtil(hoje);
    const { ini, fim } = limitesDoDia(anterior);
    // Só envio CONFIRMADO conta para o dia cheio: o toque "incerto" (texto que ficou na caixa) entra no teto e no
    // piso, mas não prova que o Instagram deixou enviar (06/11: o log dizia 3 envios num dia com zero confirmado).
    const toquesOntem = await ler(`prospeccao_toques?select=id,resultado,obs&consultor=eq.${encodeURIComponent(CFG.consultor)}&resultado=eq.enviei&criado_em=gte.${ini}&criado_em=lt.${fim}`);
    const env = { length: enviosConfirmados(toquesOntem) };
    const incertosOntem = toquesOntem.length - env.length;
    const d = decidirRampa({
      hoje, marca,
      // O dia do bloqueio E o dia da volta nunca contam como dia cheio (mesmo que ninguém tenha gravado a marca da rampa).
      ultimoBloqueioDia: [(lerHistorico() || {}).dia, diaDeIso(((lerHistorico() || {}).voltas || []).slice(-1)[0])].filter(Boolean).sort().pop() || null,
      atualizadoDia: r.atualizado_em ? relogioBRT(new Date(r.atualizado_em)).dia : null,
      atualManual: r.teto_manual, enviadosDiaAnterior: env.length,
      bloqueado: bloqueioAtivo() || !rebaixeOk, maxIg: CFG.tetoIgMax,
    });
    log(`rampa do dia: ${d.motivo}${d.gravar ? ' -> teto_manual ' + d.novo : ''} (ontem útil ${anterior}: ${env.length} confirmados, ${incertosOntem} incertos que não contam).`);
    if (d.gravar) {
      await patchRampa(d.novo, `RAMPA AUTOMATICA: ${anterior} saiu ${env.length} confirmados/${r.teto_manual}. Hoje ${d.novo}/dia (de ${RAMPA_INICIAL} a ${CFG.tetoIgMax}, 45 min de piso, envio ${CFG.horaIni}h-${CFG.horaFim}h).`);
    }
    if (d.marcar) gravarMarcaRampa(hoje, Math.min(Number(d.novo ?? tetoManualInstagram(r.teto_manual)), CFG.tetoIgMax));   // o teto em vigor HOJE: amanhã é com ele que o dia é medido
  } catch (e) { log('rampa do dia falhou, sigo com o teto que está: ' + e.message); }
}

// ═══ FILA ÚNICA ENTRE OS DOIS CANAIS ═════════════════════════════════════════
// A view não conhece o outro canal, então o worker confere. A chave é a EMPRESA
// (contato_id), não o telefone nem o @. Regras em ritmo.mjs/avaliarToques. Se a
// consulta falhar, NÃO aborda: sem o histórico não dá para provar que é seguro.
async function filaUnica(c) {
  if (recusadosFila.has(c.id)) return { ok: false, motivo: 'já recusada nesta sessão' };
  let toques;
  try {
    toques = await ler('prospeccao_toques?select=resultado,consultor,obs,criado_em&contato_id=eq.' + encodeURIComponent(c.id) + '&limit=100');
  } catch (e) { return { ok: false, erro: e.message, motivo: 'não consegui ler o histórico de toques' }; }
  const v = avaliarToques(toques, CANAL);
  if (!v.ok) recusadosFila.add(c.id);
  return v;
}

/** Última hora de envio desta conta no banco: { ok, ms }. ok=false é "não consegui ler". */
async function ultimoEnvioNoBanco() {
  try {
    const u = await ler('prospeccao_toques?select=criado_em&consultor=eq.' + encodeURIComponent(CFG.consultor)
      + '&resultado=eq.enviei&order=criado_em.desc&limit=1');
    if (!u[0]) return { ok: true, ms: null };
    const ms = Date.parse(u[0].criado_em);
    return Number.isFinite(ms) ? { ok: true, ms } : { ok: false, ms: null };
  } catch { return { ok: false, ms: null }; }
}

/** A decisão de ritmo (janela, piso, teto) — a regra mora em ritmo.mjs/decidirAbordagem, aqui só se lêem as fontes. */
async function decidirAgora(restam) {
  return decidirAbordagem({
    agora: new Date(), cfg: CFG, restam,
    banco: await ultimoEnvioNoBanco(), arquivo: lerArquivoUltimo(), pendente: pendenteAtual(),
    bloqueio: { bloqueado: bloqueioAtivo() },
    // Instagram: o 1º envio do dia só depois de um horário sorteado entre 8h10 e 9h30 (estável por dia e conta).
    sorteioDia: CANAL === 'instagram' ? CFG.consultor : undefined,
  });
}
/** Ms que faltam para o piso (ignora janela e teto). */
async function faltaDoPiso() {
  return faltaPiso({ agoraMs: Date.now(), cfg: CFG, banco: await ultimoEnvioNoBanco(), arquivo: lerArquivoUltimo() });
}

/** O WhatsApp logado AGORA é o chip da prospecção? Confere a cada envio: o chip pode ser trocado no Chrome a qualquer hora. */
async function contaDoChipOk() {
  const s = await sessaoZap();
  if (s.logado === false) return { ok: false, motivo: 'o WhatsApp está deslogado' };
  if (s.logado !== true) return { ok: false, motivo: 'não consegui confirmar a sessão do WhatsApp' };
  if (contaProibida(s.conta)) return { ok: false, motivo: 'o WhatsApp logado é a linha IO, o celular do dono, ou o número é ilegível' };
  return { ok: true, conta: s.conta };
}

/** Envio incerto ("não saiu", ou estourou depois de tentar): grava como enviado, com a marca incerto, para contar no teto, no piso e na fila única. */
async function gravarIncerto(contatoId, produtoId, obsIncerto = null) {
  if (DRY || !contatoId) return true;
  const obs = obsIncerto || `worker ${CANAL} incerto`;   // Instagram: "worker instagram incerto v=.. s=.. a=.. p=.." (contrato em abertura.mjs)
  const ok = await gravarComRetentativa(
    () => gravarToque(contatoId, null, produtoId, 'enviei', obs, true),
    { vezes: 3, esperaMs: 1500, dorme });
  if (!ok) {
    registrarPendente(contatoId, produtoId, obs);
    log('  NÃO consegui gravar o toque em 3 tentativas. PARO de abordar (Instagram e chip) até um toque gravar.');
    await bater({ fazendo: 'PARADA: envio saiu mas o toque não gravou no banco', ultimo_erro: 'toque pendente de gravar' });
  }
  return ok;
}

/** 1ª coisa de cada abordagem: grava o toque pendente, se houver. true = nada pendente (ou gravou). */
async function resolverPendente() {
  const p = pendenteAtual();
  if (!p) return true;
  try {
    await gravarToque(p.id, null, p.pid, 'enviei', p.obs || `worker ${CANAL} incerto pendente`, true,
      Number.isFinite(p.ms) ? new Date(p.ms).toISOString() : null);
  } catch (e) { log('  o toque pendente ainda não gravou (' + e.message + '); sigo parada de abordar'); return false; }
  limparPendente();
  log('  o toque pendente gravou. Volto a abordar.');
  return true;
}

/** Falha de caixa do Instagram no contador de perfis distintos. Nos envios de PROVA (3 primeiros depois da volta) 1 falha já liga. */
const registrarFalhaIG = (perfil, motivo) => registrarFalhaCaixa(caixaNaoAbriuEm, perfil, motivo, { prova: provaAtiva(lerHistorico()) });

// ── VOLTA AUTOMÁTICA (regras do chefe-antiban, 09/11/2026) ───────────────────
// A flag bloqueadaParaNovas só vira false AQUI, no começo da volta do laço (antes de rampaDoDia e de travas), e só
// quando o arquivo de bloqueio sumiu, o histórico prova o teto 5 e a volta foi autorizada (ver podeVoltar em ritmo.mjs).
const ARQ_LIBERAR = fileURLToPath(new URL(`./${ARQ_LIBERAR_NOME}`, import.meta.url));
/** O dono criou LIBERAR-INSTAGRAM.txt: vale para QUALQUER estado travado. Teto 5 explícito, zera a contagem, conta como volta. */
async function liberarPeloDonoAgora() {
  const agoraIso = new Date().toISOString();
  log(`${ARQ_LIBERAR_NOME} encontrado: o dono liberou o Instagram.`);
  try { await patchRampa(RAMPA_INICIAL, `LIBERADO PELO DONO em ${agoraIso.slice(0, 10)}: volta em ${RAMPA_INICIAL}/dia, rampa recomeça, 3 envios de prova.`); }
  catch (e) { log('  não consegui devolver o teto a 5 (' + e.message + '). Mantenho tudo e tento de novo na próxima volta.'); return false; }
  const h = registrarVolta({ ...liberarPeloDono(lerHistorico(), agoraIso), rebaixado: true, rebaixadoEm: agoraIso }, agoraIso);
  // Só apaga o bloqueio e o LIBERAR se o histórico (com a volta e a prova) gravou: sem ele a flag não baixaria e o dono ficaria sem saída.
  if (!gravarHistorico(h)) { log('  não consegui gravar a volta no histórico. Mantenho o bloqueio e o ' + ARQ_LIBERAR_NOME + ' e tento de novo na próxima volta.'); return false; }
  rmSync(ARQ_BLOQUEIO, { force: true });
  rmSync(ARQ_LIBERAR, { force: true });
  return true;
}
async function verificarVolta() {
  // bloqueioAtivo() (flag OU arquivo): o LIBERAR vale também para um bloqueio que existe só como arquivo feito à mão.
  if (CANAL !== 'instagram' || DRY || !bloqueioAtivo()) return;
  try {
    if (existsSync(ARQ_LIBERAR) && !(await liberarPeloDonoAgora())) return;
    const d = podeVoltar({ bloqueio: lerBloqueio(), historico: lerHistorico() });
    if (!d.volta) return;
    caixaNaoAbriuEm.clear();
    caixaNaoAbriu = 0;                                   // o contador de perfis distintos recomeça vazio
    gravarMarcaRampa(relogioBRT().dia, RAMPA_INICIAL, true);   // o dia da volta nunca conta como dia cheio
    bloqueadaParaNovas = false;                          // a ÚNICA linha que baixa a flag
    log(`VOLTOU SOZINHO: o bloqueio saiu, o teto é ${RAMPA_INICIAL}/dia, a rampa recomeça e os ${PROVA_ENVIOS} primeiros envios são de prova.`);
    await bater({ fazendo: 'VOLTOU SOZINHO' });
  } catch (e) { log('verificação da volta falhou (sigo parada): ' + e.message); }
}

/** Liga o freio (bloqueio de conversa nova) quando o contador de perfis distintos chegou ao limite. */
async function aplicarFreio(freio) {
  if (!freio || !freio.liga || bloqueadaParaNovas) return;
  const n = caixaNaoAbriuEm.size;
  log('');
  log('O INSTAGRAM PAROU DE DEIXAR ABRIR CONVERSA NOVA.');
  log(`${n} perfis distintos seguidos: a caixa não abriu ou o texto ficou na caixa.`);
  log('Insistir nisso transforma bloqueio brando em bloqueio duro. PAREI de abordar.');
  log('Responder quem já respondeu continua normal: aquilo vai pela API da Meta.');
  bloqueadaParaNovas = true;
  gravarBloqueio(`caixa não abriu ou texto ficou na caixa em ${n} perfis distintos seguidos`, caixaNaoAbriuEm);
  await rebaixarRampa();
  // O pulso mostra o estado FIXO (avisoDoEstado: "TRAVOU DE NOVO:" depois de uma volta, "PARADO ATÉ VOCÊ LIBERAR:" no 3º freio em 7 dias).
  await bater({ fazendo: 'PARADA: Instagram bloqueou conversa nova',
                ultimo_erro: `caixa não abriu ou texto ficou na caixa em ${n} perfis seguidos` });
}

// ═══ UMA ABORDAGEM ═══════════════════════════════════════════════════════════
// O modo contínuo manda UMA por rodada, não um lote. É o que espalha os toques
// pelo dia inteiro em vez de despejar o teto numa hora só — e despejar numa
// hora só é exatamente o padrão que derrubou a linha IO em 30/08.
//
// Abre e fecha a aba a cada chamada de propósito: uma aba viva por 16 horas
// acumula estado, memória e sessão velha. Custa 2 segundos e evita a classe
// inteira de bug de "funcionava de manhã".
async function umaAbordagem() {
  // Zera o estado da tentativa ANTES de qualquer coisa que possa estourar: o catch do laço lê estas duas.
  tentouEnviar = false;
  alvoAtual = null;
  // Bloqueio de conversa nova (memória ou arquivo): nenhuma abordagem fria, em nenhum caminho.
  if (!DRY && bloqueioAtivo()) { log('canal bloqueado para conversa nova — não abordo.'); return 'vazio'; }
  // 1ª coisa: tentar gravar um toque pendente. Com pendência, ninguém é abordado.
  if (!DRY && !(await resolverPendente())) {
    pisoFaltaMs = 120_000;
    log('há um envio pendente de gravar no banco — não abordo ninguém até gravar.');
    return 'piso';
  }
  // O piso e a janela valem a CADA abordagem, lidos do banco E do arquivo, e não só na partida:
  // qualquer caminho que chegue aqui cedo demais é barrado antes de abrir perfil ou conversa.
  if (!DRY) {
    const dec = await decidirAgora();
    if (!dec.enviar) {
      pisoFaltaMs = dec.esperaMs;
      log(dec.motivo === 'piso'
        ? `piso de ${Math.round(CFG.minSeg / 60)} min: faltam ${Math.ceil(dec.esperaMs / 60000)} min para a próxima abordagem.`
        : dec.motivo === 'almoco' ? `pausa de almoço (até as 13h30): faltam ${Math.ceil(dec.esperaMs / 60000)} min.`
        : dec.motivo === 'inicio' ? `o 1º envio de hoje só depois do horário sorteado (8h10 a 9h30): faltam ${Math.ceil(dec.esperaMs / 60000)} min.`
        : 'fora da janela de envio — não abordo.');
      return ['piso', 'almoco', 'inicio'].includes(dec.motivo) ? 'piso' : 'vazio';
    }
  }
  // O WhatsApp filtra no banco: a view entrega 200 por vez, e sem o filtro os
  // 200 primeiros podem ser todos de @ ou de fixo, e ela acharia a fila vazia.
  const qFila = CANAL === 'whatsapp'
    ? 'prospeccao_fila_worker?select=*&canal=eq.nunca_tocado&or=(instagram.is.null,instagram.eq.)'
      + '&whatsapp_invalido_em=is.null&telefone=like.55__9*&limit=200'
    : 'prospeccao_fila_worker?select=*&canal=eq.nunca_tocado&instagram=not.is.null&instagram=neq.&limit=200';   // filtra NO BANCO: a view poe os sem_retorno na frente e os 40 candidatos eram todos ja tocados
  const [fila, scripts, alegacoes, produtos] = await Promise.all([
    ler(qFila),
    ler('prospeccao_scripts?select=*'),
    ler('prospeccao_alegacoes?select=*'),
    ler('prospeccao_produtos?select=*&ativo=eq.true&order=ordem.asc'),
  ]);

  const alvos = fila.filter(alvoDoCanal)
    .filter(x => !caixaNaoAbriuEm.has(x.instagram) && !pularNaSessao.has(x.id) && !recusadosFila.has(x.id));
  if (!alvos.length) {
    log(CANAL === 'instagram'
      ? 'ninguém com @ na fila agora (o robô só aborda quem já tem @ na base)'
      : 'ninguém na fila agora');
    return 'vazio';
  }

  // Primeiro da fila que a regra da fila única libera (no máximo 40 consultas).
  let c = null;
  for (const cand of alvos.slice(0, 40)) {
    const v = await filaUnica(cand);
    if (v.erro) { log(`${v.motivo} — não abordo nesta rodada (${v.erro})`); return 'vazio'; }
    if (v.ok) { c = cand; break; }
    log(`  pulei ${cand.empresa}: ${v.motivo}`);
  }
  if (!c) { log('ninguém liberado pela regra da fila única agora'); return 'vazio'; }
  const pid = c.produto_da_lista || (produtos[0] && produtos[0].id);
  const prod = produtos.find(p => p.id === pid);
  const preco = prod ? `R$ ${Number(prod.preco).toLocaleString('pt-BR')}` : '';
  const escolhida = await escolherMensagem(c, scripts, alegacoes, pid, preco);
  if (!escolhida) { log(`PULOU ${c.empresa} — toda abertura de ${pid} está bloqueada pela trava`); return 'falhou'; }
  const { msg, obs: obsToque, obsIncerto } = escolhida;

  const destino = CANAL === 'instagram' ? '@' + c.instagram : c.telefone;
  console.log(`\n─── ${c.empresa} · ${c.cidade || ''} · ${destino} · ${CTX(c)} ───`);
  console.log(msg.split('\n').map(l => '  │ ' + l).join('\n'));
  if (DRY) return 'enviou';

  // WhatsApp: reconfere QUEM está logado imediatamente antes de CADA envio (não a cada N voltas).
  if (CANAL === 'whatsapp') {
    const cc = await contaDoChipOk();
    if (!cc.ok) {
      log(`  NÃO envio: ${cc.motivo}.`);
      zapLogado = false;
      await bater({ logado: false, fazendo: 'PARADA: ' + cc.motivo });
      return 'vazio';
    }
  }
  let aba = null;
  let prevArq = null;
  try {
    aba = CANAL === 'whatsapp' ? await zap() : await Aba.abrir(CFG.cdp);
    // A hora da tentativa vai para o disco ANTES de digitar. Sem conseguir gravar, não envia.
    prevArq = lerArquivoUltimo();
    if (!gravarArquivoUltimo(Date.now())) return 'vazio';
    alvoAtual = { id: c.id, pid, obsIncerto, instagram: CANAL === 'instagram' ? c.instagram : null };
    tentouEnviar = true;   // daqui em diante a DM pode ter saído, mesmo que a função estoure
    const r = CANAL === 'instagram'
      ? await enviarInstagram(aba, c.instagram, msg)
      : await enviarWhatsApp(aba, c.telefone, msg);
    if (r.ok) {
      // Só envio numa conversa NOVA zera a suspeita: numa conversa antiga o compositor abre mesmo com a restrição.
      if (CANAL === 'instagram') {
        if (aposEnvioConfirmado(caixaNaoAbriuEm, { conversaAntiga: r.conversaAntiga })) caixaNaoAbriu = 0;
        else if (caixaNaoAbriuEm.size) log(`  conversa já existia (ou não deu para medir): o contador de bloqueio fica em ${caixaNaoAbriuEm.size}`);
      } else { caixaNaoAbriu = 0; caixaNaoAbriuEm.clear(); }
      if (CANAL === 'instagram') {
        // Envios de PROVA: só os confirmados em conversa NOVA contam; o 3º devolve o limite a 3 perfis.
        const h0 = lerHistorico(), h1 = contarEnvioDeProva(h0, { conversaAntiga: r.conversaAntiga }, new Date().toISOString());
        if (h1 !== h0) { gravarHistorico(h1); log(h1.prova.ativa ? `  envio de prova confirmado: ${h1.prova.confirmados}/${PROVA_ENVIOS}` : `  os ${PROVA_ENVIOS} envios de prova passaram: o freio volta a pedir 3 perfis distintos`); }
      }
      await gravarToque(c.id, null, pid, 'enviei', obsToque);
      log('  ✓ enviado');
      return 'enviou';
    }
    log('  ✗ ' + r.motivo);
    // Este contato sai da frente da fila nesta sessão (salvo página que não
    // carregou ou sessão caída, que não são culpa dele).
    if (!/perfil não carregou|deslogado/.test(r.motivo || '')) pularNaSessao.add(c.id);
    // "Não saiu" não prova que não saiu (Rei da Energia, EJS Solar): conta como envio para o piso.
    const incerto = /não saiu|ficou na caixa/.test(r.motivo || '');
    if (incerto) await gravarIncerto(c.id, pid, obsIncerto);     // conta no teto, no piso e na fila única (mas NÃO como envio confirmado na rampa)
    else restaurarArquivoUltimo(prevArq);             // comprovadamente nada saiu: o marcador volta ao que era

    // Falha passageira (página não carregou, rede caiu) NÃO vira toque: quem
    // não recebeu não pode sair da fila. Mas perfil que não existe mais é
    // PERMANENTE, e aí a regra se vira contra ela: como a fila sempre entrega o
    // primeiro, um @ morto no topo trava todo mundo atrás dele pra sempre.
    // Foi o que aconteceu em 11/09: @bluesun.luz falhou às 11:53 e de novo às
    // 12:10, e entre uma e outra ela não falou com mais ninguém.
    //
    // Apagar o @ (string vazia, não NULL) é o mesmo sinal que o reabastecimento
    // já usa: "procuramos, não serve". A empresa continua na base; o que sai é
    // o endereço errado.
    // RESTRIÇÃO A CONVERSA NOVA: o sintoma é este e não outro.
    //
    // Em 13/09 a conta levou um bloqueio brando. O perfil abre, o botão
    // "Message" está lá, o clique funciona, e o compositor simplesmente NÃO
    // abre. A prova de que é restrição e não bug: no mesmo minuto o compositor
    // ABRIU num contato com quem ela já tinha conversado.
    //
    // Insistir num bloqueio brando é o que o torna duro. Três seguidas e ela
    // para sozinha, avisa no pulso, e espera alguém conferir.
    // 09/11/2026: "texto ficou na caixa / não saiu" é o MESMO sintoma (a restrição deixa o texto na caixa)
    // e conta no mesmo contador, antes de o freio ligar (em 06/11 três deles passaram como "incerto").
    const freio = CANAL === 'instagram' ? registrarFalhaIG(c.instagram, r.motivo) : { conta: false };
    if (freio.conta) {
      // Conta PERFIS DISTINTOS, que é o que a regra diz. O mesmo @ falhando três
      // vezes não prova bloqueio da conta: prova que aquele perfil não abre.
      caixaNaoAbriu = caixaNaoAbriuEm.size;
      await aplicarFreio(freio);
    }
    if (CANAL === 'instagram' && /não existe mais/.test(r.motivo)) {
      await fetch(`${CFG.supa}/prospeccao_contatos?id=eq.${c.id}`, {
        method: 'PATCH', headers: H,
        body: JSON.stringify({ instagram: '', instagram_em: new Date().toISOString() }),
      }).catch(() => {});
      log(`  @${c.instagram} não existe mais — apaguei o endereço, a empresa fica na base`);
    }
    // WHATSAPP: número sem WhatsApp é permanente, igual o @ morto do Instagram.
    // Sem a marca, o mesmo número voltaria pro topo da fila toda volta.
    if (CANAL === 'whatsapp' && /sem WhatsApp/.test(r.motivo)) {
      await fetch(`${CFG.supa}/prospeccao_contatos?id=eq.${c.id}`, {
        method: 'PATCH', headers: H,
        body: JSON.stringify({ whatsapp_invalido_em: new Date().toISOString() }),
      }).catch(() => {});
      log('  esse número não tem WhatsApp. Marquei; a empresa fica na base.');
    }
    if (CANAL === 'whatsapp' && /deslogado/.test(r.motivo)) {
      zapLogado = false;
      await bater({ logado: false, fazendo: 'PARADA: o WhatsApp deslogou, precisa ler o QR' });
    }
    return incerto ? 'incerto' : 'falhou';
  } finally {
    // A aba fixa do WhatsApp fica. Fechar e reabrir é recarregar o aplicativo.
    if (aba && aba !== abaZap) await aba.fechar();
  }
}

// ═══ PULSO ═══════════════════════════════════════════════════════════════════
// "Você está viva?" perguntado de fora.
//
// Esta metade da agente mora no desktop, e desktop dorme, reinicia e é
// desligado. Em 11/09 ela ficou parada das 04h às 11h44 e ninguém soube,
// porque não havia como perguntar de fora.
//
// Duas regras que fazem este pulso valer alguma coisa:
//
// 1. Bate ANTES de trabalhar, não depois. Volta que estoura no meio tem que
//    aparecer como DEGRADADA, com o erro junto. Pulso que só bate quando dá
//    certo vira silêncio na hora exata em que o silêncio engana.
// 2. Carrega SAÚDE, não só vida. Deslogada do Instagram ela continua rodando e
//    continua batendo, e não manda nada. De fora isso é idêntico a um dia
//    quieto, e é o jeito mais fácil de perder um dia inteiro sem perceber.
// Quem sou eu nesta rodada. Serve pra UMA coisa: saber se o pulso que esta no
// banco e meu ou de outra instancia rodando junto.
const EU = `${process.pid}-${Date.now().toString(36)}`;

// Quantos perfis seguidos recusaram abrir o compositor. Ver o comentario longo
// em umaAbordagem(): e assim que a restricao de conversa nova se manifesta.
let caixaNaoAbriu = 0;
/** @ cujo compositor não abriu nesta sessão: o bloqueio só vale com 3 PERFIS DISTINTOS. */
const caixaNaoAbriuEm = new Set();
/** Contatos que falharam nesta sessão: a fila entrega sempre o primeiro, e repetir o mesmo a cada 15 s é gesto de robô. */
const pularNaSessao = new Set();
/** Contatos que a regra da fila única recusou nesta sessão. */
const recusadosFila = new Set();
/** true entre "vou digitar/enviar" e o fim da tentativa: se estourar aí, a DM pode ter saído. */
let tentouEnviar = false;
/** O contato da tentativa em curso (para gravar o toque incerto se a função estourar). */
let alvoAtual = null;
/** Ms que faltavam para o piso quando umaAbordagem devolveu 'piso'. */
let pisoFaltaMs = 0;
// Na partida, o arquivo bloqueio-<canal>.json (se existir) já deixa o canal bloqueado para conversa NOVA.
// Também começa parada se o histórico tem um freio gravado cuja volta não foi autorizada (arquivo apagado à mão não basta).
let bloqueadaParaNovas = lerBloqueio().bloqueado || (CANAL === 'instagram' && freioPendente(lerHistorico()));
// Sessão do WhatsApp na última conferência: true, false ou null (não deu pra afirmar).
let zapLogado = null;

// Quantas voltas seguidas o Chrome nao respondeu. Ver o comentario em
// chromeVivo(): num notebook apertado ele MORRE, e ela precisa perceber.
let chromeMudo = 0;

async function bater(campos) {
  // Estados FIXOS para o cron do servidor: "VOLTOU SOZINHO:", "TRAVOU DE NOVO:", "PARADO ATÉ VOCÊ LIBERAR:" (ver avisoDoEstado).
  if (CANAL === 'instagram') {
    const aviso = avisoDoEstado({ bloqueado: bloqueioAtivo(), historico: lerHistorico(), agoraMs: Date.now() });
    if (aviso) campos = { ...campos, fazendo: aviso.slice(0, 240) };
  }
  try {
    await fetch(`${CFG.supa}/prospeccao_pulso?id=eq.${PULSO_ID}`, {
      method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ batido_em: new Date().toISOString(), consultor: CFG.consultor,
                             instancia: EU, versao: 'worker.mjs', ...campos }),
    });
  } catch { /* pulso que falha não derruba a agente: ele é o termômetro, não o doente */ }
}

/**
 * O Chrome dela ainda existe?
 *
 * Em 13/09 o Windows matou o Chrome por falta de memoria (0,49 GB livres de
 * 15,7 GB, com outro projeto processando video na mesma maquina). A agente
 * continuou viva, batendo o pulso e girando o laco por DOIS DIAS sem conseguir
 * falar com ninguem, porque nada no codigo perguntava "o navegador ainda esta
 * ai?".
 *
 * Ela nao consegue subir o Chrome sozinha: quem faz isso e o COMECAR.ps1, que
 * confere a porta antes de ligar. Entao o certo e SAIR. O laco do COMECAR
 * religa em 60s, passa pelo passo 1, ve a porta muda e sobe o navegador de
 * novo. Morrer de proposito e mais util que insistir viva.
 */
async function chromeVivo() {
  try {
    const r = await fetch(CFG.cdp + '/json/version', { signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch { return false; }
}

/**
 * Fecha aba sobrando no Chrome dela.
 *
 * Cada rodada abre uma aba e fecha no `finally`. Só que fechar depende do
 * Chrome responder, e quando ele está engasgado a chamada falha calada: a aba
 * fica. Em 11/09 havia 6 abas do Instagram abertas, e cada uma custa entre 80 e
 * 150 MB. Num notebook de 16 GB que já vive com 1 GB livre, isso é o que vira
 * "o Windows matou o Chrome" dois dias depois.
 *
 * Caçar a causa exata custa mais que varrer toda volta. Varrer é barato e
 * funciona mesmo quando a causa muda.
 */
async function fecharAbasSobrando(limite = 2) {
  try {
    const alvos = await (await fetch(CFG.cdp + '/json/list')).json();
    // Só mexe no que é DESTE canal. Com duas agentes no mesmo Chrome, a faxina
    // de uma fecharia a aba em que a outra está digitando. E a aba fixa do
    // WhatsApp nunca entra na conta.
    const meu = CANAL === 'instagram' ? /instagram\.com|^about:blank/ : /whatsapp\.com/;
    const paginas = (alvos || []).filter(t => t.type === 'page'
      && meu.test(String(t.url || '')) && t.id !== abaZap?.targetId);
    if (paginas.length <= limite) return 0;
    // Mantém as primeiras e fecha o resto: a que o worker está usando agora
    // está entre as que ficam, e o Chrome nunca fica sem nenhuma.
    let fechadas = 0;
    for (const t of paginas.slice(limite)) {
      const r = await fetch(`${CFG.cdp}/json/close/${t.id}`).catch(() => null);
      if (r?.ok) fechadas++;
    }
    if (fechadas) log(`faxina: fechei ${fechadas} aba(s) esquecida(s) no Chrome`);
    return fechadas;
  } catch { return 0; }
}

/**
 * A sessão do Instagram ainda está de pé?
 *
 * Fala com o Chrome no cru, sem passar pela classe Aba: a Aba abre uma aba
 * NOVA e liga Runtime/Page, o que é caro e desnecessário pra uma pergunta. Aqui
 * só espiamos uma aba que já existe. É o mesmo caminho do checar-sessao.mjs,
 * que é o único jeito que já provou funcionar contra o Instagram real.
 *
 * Devolve logado:null quando não deu pra afirmar (sem aba do Instagram aberta,
 * Chrome fora do ar). Null não é "deslogada": inventar um false aqui faria o
 * vigia gritar à toa, e alarme que grita à toa é alarme que se ignora.
 */
async function sessaoViva() {
  let ws = null;
  try {
    const alvos = await (await fetch(CFG.cdp + '/json/list')).json();
    const pg = (alvos || []).find(t => t.type === 'page' && String(t.url).includes('instagram'));
    if (!pg?.webSocketDebuggerUrl) return { logado: null, conta: null };

    ws = new WebSocket(pg.webSocketDebuggerUrl);
    await new Promise((ok, err) => {
      ws.onopen = ok; ws.onerror = err;
      setTimeout(() => err(new Error('o Chrome não respondeu em 8s')), 8000);
    });

    const r = await new Promise(ok => {
      // Casar pelo id é obrigatório: a aba fica emitindo evento do CDP o tempo
      // todo, e pegar "a primeira mensagem que chegar" devolve um evento
      // qualquer em vez da resposta. Foi isso que fez a conferência de sessão
      // voltar undefined e o pulso registrar logado=null.
      ws.onmessage = e => {
        try {
          const m = JSON.parse(e.data);
          if (m?.id === 1) ok(m.result?.result?.value);
        } catch { /* quadro que não é JSON não me interessa */ }
      };
      ws.send(JSON.stringify({
        id: 1, method: 'Runtime.evaluate',
        params: { returnByValue: true, expression: `(function () {
          if (document.querySelector('input[name="username"]')) return { logado: false };
          var conta = '', l = document.querySelectorAll('a[href^="/"]');
          for (var i = 0; i < l.length; i++) {
            var m = (l[i].getAttribute('href') || '').match(/^\/([A-Za-z0-9._]{3,30})\/$/);
            if (m && l[i].querySelector('img')) { conta = m[1]; break; }
          }
          return { logado: true, conta: conta };
        })()` },
      }));
      setTimeout(() => ok(undefined), 8000);
    });

    return { logado: r ? !!r.logado : null, conta: (r && r.conta) || null };
  } catch {
    return { logado: null, conta: null };
  } finally {
    try { ws && ws.close(); } catch { }
  }
}

// ═══ BUSCA DE @ — REMOVIDA EM 09/11/2026 ═════════════════════════════════════
// A busca de @ pela lupa do Instagram dá 404 desde 13/10 e rodava o dia todo, abrindo uma aba do
// Instagram a cada volta. Saiu de vez: o robô só aborda contato que JÁ TEM @ na base. Quem quiser
// colher @ novo roda, à mão, colher-instagram.mjs (site da empresa), fora do robô.

// ═══ MODO CONTÍNUO ═══════════════════════════════════════════════════════════
// Um dia inteiro de trabalho sem ninguém dar comando. Alterna abordar e
// responder, dorme fora da janela, e acorda sozinho no dia seguinte.
//
// Por que alternar em vez de só abordar: quem respondeu vale mais que quem
// ainda não foi falado. Deixar uma resposta esperando 6 horas porque o worker
// está ocupado mandando mensagem fria é perder o lead mais quente do dia.
//
// O ritmo NÃO é fixo. Cada rodada calcula quanto falta da janela e divide pelo
// que sobra do teto — então ele anda devagar de manhã e acelera se você ligar
// tarde. Isso é o oposto de metrônomo, que é o que denuncia robô.
async function modoContinuo() {
  console.log('\n  MODO CONTÍNUO — trabalha sozinho das '
    + 'ENVIA de segunda a sábado, das ' + CFG.horaIni + 'h às ' + CFG.horaFim + 'h (a lista é montada 24h).');
  console.log('  Espalha o teto do dia até o fim da janela, de ' + Math.round(CFG.minSeg / 60) + ' a '
    + Math.round(CFG.tetoEspera / 60) + ' min entre uma e outra.');
  if (CANAL === 'instagram') {
    console.log('  Quem RESPONDE e o webhook da Meta, no servidor — nao este worker.');
    console.log('  Aqui so sai a primeira mensagem de cada empresa.');
  } else {
    console.log('  Confere resposta a cada ' + Math.round(CFG.olharSeg / 60) + ' min.');
  }
  console.log('  Ctrl+C para parar. Deixe esta janela aberta.\n');

  // DUAS AGENTES AO MESMO TEMPO É PIOR QUE NENHUMA.
  //
  // Elas dirigem o MESMO Chrome: uma navega pro perfil enquanto a outra digita,
  // e as duas quebram. E disputam o mesmo teto do dia, então o dobro de
  // mensagem sai da mesma conta na mesma hora, que é o retrato do robô.
  //
  // Aconteceu em 11/09 assim que a tarefa do Windows entrou: a janela manual
  // ainda estava aberta e as duas subiram. O Windows sozinho não cobre isso
  // (o MultipleInstances só enxerga a tarefa, não a janela que alguém abriu).
  //
  // A trava é o próprio pulso: se tem outra instância batendo agora, eu saio.
  // Quem chegou primeiro continua, que é o que a pessoa quer quando clica duas
  // vezes sem querer.
  if (!DRY) {
    try {
      const p = (await ler('prospeccao_pulso?select=batido_em,instancia,ciclo&id=eq.' + PULSO_ID))[0];
      const idade = p?.batido_em ? (Date.now() - new Date(p.batido_em).getTime()) / 1000 : 1e9;
      if (p?.instancia && p.instancia !== EU && idade < 180) {
        // O relógio sozinho engana: instância que morreu deixa pulso fresco por
        // até 3 minutos, e nesse intervalo a trava barraria a substituta legítima.
        // Como a instância carrega o pid, dá pra PERGUNTAR se ela existe, em vez
        // de supor. Só cai no relógio quando o pid é de outra máquina.
        const pid = Number(String(p.instancia).split('-')[0]);
        let viva = true;
        try { process.kill(pid, 0); } catch (e) { viva = e.code !== 'EPERM'; }
        if (!viva) {
          log(`o pulso era da instância ${p.instancia}, que não existe mais. Assumo o lugar dela.`);
        } else {
          log(`JÁ TEM UMA AGENTE TRABALHANDO (instância ${p.instancia}, pulso de ${Math.round(idade)}s atrás).`);
          log('Não vou subir uma segunda: as duas dirigiriam o mesmo Chrome e dobrariam o envio.');
          log('Se a outra estiver travada, feche-a e espere 3 minutos.');
          return;
        }
      }
    } catch (e) { log('não consegui conferir se já tem outra rodando: ' + e.message); }
  }

  // O piso de 45 min sobrevive a REINÍCIO: o laço do COMECAR religa o node a cada
  // 60 s quando ele cai, e com proximaAbordagem = 0 cada religada mandava uma DM.
  // Parte do último 'enviei' gravado no banco; se não consegue ler, espera o piso.
  let proximaAbordagem = DRY ? 0 : Date.now() + await faltaDoPiso();   // banco E arquivo, vale a maior hora
     // epoch em que pode mandar a próxima fria
  if (!DRY && proximaAbordagem > Date.now()) log(`piso de ${Math.round(CFG.minSeg / 60)} min: a próxima abordagem só depois das ${new Date(proximaAbordagem).toLocaleTimeString('pt-BR')}.`);
  let semAlvo = false;
  let ciclo = 0;
  let ultimoErro = null;

  for (;;) {
    // NENHUM TROPEÇO ENCERRA O DIA.
    //
    // Em 11/09 o Supabase engasgou por alguns segundos, a leitura do teto
    // falhou nas 3 tentativas, o erro subiu até o topo e o processo MORREU.
    // A janela religava e ela morria de novo em 1 minuto, três vezes seguidas.
    //
    // Agente que precisa rodar 24h não pode morrer de soluço de rede: erro de
    // uma volta vira linha de log e a volta seguinte tenta de novo. O que
    // continua derrubando de propósito é Ctrl+C, que é ordem de gente.
    try {
      const agoraMs = Date.now();
      const h = new Date().getHours();
      ciclo++;
      // A flag do bloqueio só cai AQUI, no começo da volta (antes do Chrome, do pulso, da rampa e de travas), nunca no meio de uma abordagem.
      await verificarVolta();

      // ANTES de qualquer trabalho. Se a volta estourar depois daqui, o pulso
      // já disse que ela estava viva e o catch grava o erro por cima.
      // A sessão é conferida na 1a volta e depois a cada 5: ler é barato, mas
      // não é de graça, e deslogar não é coisa que acontece a cada 2 minutos.
      // O navegador ainda está de pé? Sem ele ela não fala com ninguém, e
      // continuar girando só esconde o problema.
      if (!await chromeVivo()) {
        chromeMudo++;
        log(`o Chrome não respondeu (${chromeMudo}ª volta seguida).`);
        await bater({ ciclo, fazendo: 'o Chrome não responde', ultimo_erro: `Chrome mudo há ${chromeMudo} voltas` });
        if (chromeMudo >= 3) {
          log('O CHROME MORREU. Vou sair pra janela subir ele de novo.');
          log('Numa máquina apertada isso é o Windows matando o navegador por falta de memória.');
          process.exit(1);   // o laço do COMECAR.ps1 religa em 60s e passa pelo passo que sobe o Chrome
        }
        await dorme(20000);
        continue;
      }
      chromeMudo = 0;

      // Varre as abas esquecidas antes de tudo: memória sobrando é o que decide
      // se o Chrome dela sobrevive ao dia.
      if (ciclo % 3 === 0) await fecharAbasSobrando(CANAL === 'instagram' ? 2 : 0);
      const sess = CANAL === 'instagram' && (ciclo === 1 || ciclo % 5 === 0) ? await sessaoViva() : null;
      await bater({
        ciclo, fazendo: 'começando a volta', ultimo_erro: ultimoErro,
        ...(sess ? { logado: sess.logado, conta: sess.conta } : {}),
      });

      // ── 0. WHATSAPP: sem sessão, nada adiante funciona ─────────────────────
      // Confere a CADA volta (e de novo antes de cada envio, em umaAbordagem): o chip
      // pode ser trocado no Chrome, e responderZap() também envia. Deslogada ela NÃO tenta mandar: cada
      // tentativa viraria falha, falha vai pro próximo em 15s, e a fila inteira
      // seria queimada em meia hora sem nenhuma mensagem sair.
      if (CANAL === 'whatsapp') {
        {
          const s = await sessaoZap();
          zapLogado = s.logado;
          // Nunca pela linha IO (5040) nem pelo celular do dono. Sem conseguir ler
          // o número, também não: não dá para provar que é o chip.
          const proibida = s.logado === true && contaProibida(s.conta);
          if (proibida) zapLogado = false;
          if (proibida) {
            log('ESTE WHATSAPP NÃO PODE PROSPECTAR (linha IO, celular do dono, ou número ilegível). Parei.');
            await bater({ ciclo, logado: false, fazendo: 'PARADA: o WhatsApp logado não é o chip da prospecção' });
          } else if (s.logado === true) {
            await bater({ ciclo, logado: true, conta: s.conta, ativo: true, fazendo: 'WhatsApp logado, trabalhando' });
          } else if (s.logado === false) {
            log('o WhatsApp está DESLOGADO. Espero alguém ler o QR (LIGAR-WHATSAPP.cmd).');
            await bater({ ciclo, logado: false, fazendo: 'PARADA: o WhatsApp está deslogado, precisa ler o QR' });
          } else {
            log('o WhatsApp Web não terminou de carregar. Tento de novo em 2 min.');
            await bater({ ciclo, fazendo: 'o WhatsApp Web não carregou' });
          }
        }
        if (zapLogado !== true) {
          await dorme((zapLogado === false ? 300 : 120) * 1000);
          continue;
        }
      }

      // A janela de 8h-21h (seg a sáb) vale só para ENVIAR (ver "2. ABORDAR").
      // A lista continua sendo montada 24h.

      // ── 1. RESPONDER ──────────────────────────────────────────────────────
      // No Instagram isto NÃO roda mais: quem responde é o webhook da Meta, que
      // recebe a mensagem pronta no servidor e devolve pela API oficial.
      //
      // Ler pelo navegador aqui era pior que inútil — era o que travava o loop.
      // Cada conversa custa ~8s (navegar + esperar) e são 170: mais de 20 minutos
      // por volta, ANTES da primeira mensagem sair. A tela parecia parada porque
      // estava moendo conversa que o webhook já cobre.
      //
      // No WhatsApp continua rodando: lá não existe webhook, e o navegador é o
      // único jeito de saber que alguém respondeu.
      if (CANAL === 'whatsapp') {
        // Responder também é enviar: só dentro da janela (8h às 21h, seg a sáb).
        if (podeEnviar(new Date(), CFG)) {
          try { await responderZap(); }
          catch (e) { log('rodada de resposta falhou: ' + e.message); }
        }
      }

      // ── 2. ABORDAR, se já passou o intervalo e ainda tem teto ─────────────
      await rampaDoDia();   // 1 vez por dia (marca local + atualizado_em): reinício não soma duas vezes
      if (Date.now() >= proximaAbordagem) {
        const t = await travas();

        if (t.estado === 'travado') {
          log('DISJUNTOR ARMADO — opt-out alto. Paro de abordar; sigo só respondendo.');
          proximaAbordagem = Date.now() + 3600_000;   // reconfere de hora em hora
        } else if (bloqueioAtivo()) {
        if (!semAlvo) {
          log('sigo parada de abordar: o Instagram ainda não deixa abrir conversa nova.');
          semAlvo = true;
        }
        proximaAbordagem = Date.now() + 3600_000;   // reconfere de hora em hora
      } else if (!podeEnviar(new Date(), CFG)) {
        if (!semAlvo) {
          log(`fora da janela de envio (${CFG.horaIni}h–${CFG.horaFim}h, segunda a sábado). Sigo só construindo a lista.`);
          semAlvo = true;
        }
        proximaAbordagem = Date.now() + 600_000;
      } else if (t.restam <= 0) {
          // TETO FECHADO NÃO É FIM DE EXPEDIENTE. O teto limita ENVIAR, não
          // trabalhar. Enquanto não pode mandar, ela constrói a lista de amanhã —
          // é isso que faz nunca faltar empresa de solar pra abordar.
          if (!semAlvo) {
            log(`teto de envio fechado (${t.usados}/${t.teto}). Sigo construindo a lista até 23h59.`);
            semAlvo = true;
          }
          proximaAbordagem = Date.now() + 600_000;   // reconfere de 10 em 10 min
        } else {
          semAlvo = false;
          let desfecho = 'falhou';
          try { desfecho = await umaAbordagem(); }
          catch (e) {
            log('abordagem falhou: ' + e.message);
            // Estourou depois de tentar enviar: a DM pode ter saído, vale como envio.
            if (tentouEnviar) {
              desfecho = 'incerto';
              // SEMPRE, antes de qualquer outra coisa: este contato sai da frente da fila.
              if (alvoAtual) pularNaSessao.add(alvoAtual.id);
              if (alvoAtual) await gravarIncerto(alvoAtual.id, alvoAtual.pid, alvoAtual.obsIncerto);   // se falhar 3x, vira pendência e para tudo
              // O incerto que nasce de EXCEÇÃO também conta no freio (mesmo contador de perfis distintos).
              if (CANAL === 'instagram' && alvoAtual && alvoAtual.instagram) {
                try { await aplicarFreio(registrarFalhaIG(alvoAtual.instagram, 'não saiu')); }
                catch (e2) { log('  não consegui aplicar o freio: ' + e2.message); }
              }
              tentouEnviar = false;
              alvoAtual = null;
            }
          }
          // O PISO VALE JÁ, antes de qualquer leitura que possa falhar logo abaixo:
          // se o travas() estourar, a volta seguinte não pode mandar outra DM em 30 s.
          if (desfecho === 'enviou' || desfecho === 'incerto') proximaAbordagem = Date.now() + CFG.minSeg * 1000;

          // Três desfechos, três esperas:
          //   enviou  o dia inteiro dividido pelo que falta (ver abaixo)
          //   falhou  vai pro PRÓXIMO na hora. Não saiu mensagem e ninguém foi
          //           incomodado, então a vaga não pode ser perdida: o mínimo do
          //           dia é de EMPRESAS FALADAS, não de tentativas
          //   vazio   15 min, porque insistir em fila vazia só gasta consulta
          //
          // O ENVIO SE ESPALHA PELO DIA, não sai em rajada.
          //
          // Com intervalo fixo de 4 a 15 min ela gastava o teto do dia inteiro
          // numa hora: em 11/09 foram 6 mensagens entre 11h44 e 12h56, e depois
          // 23 horas de silêncio. Isso é o retrato do robô — gente não manda 6
          // mensagens numa hora e some até o dia seguinte — e ainda concentra
          // tudo num horário só, em vez de pegar quem está online de manhã E de
          // tarde.
          //
          // Então o espaçamento nasce da conta: quanto falta do dia dividido
          // pelo que falta do teto. Com 6 restando e 12 horas pela frente, dá
          // 2 horas entre uma e outra. Com 25 restando, dá 29 minutos.
          // O piso de MIN_SEG continua valendo: teto grande e dia curto nunca
          // viram rajada.
          const t2 = await travas();
          let espera;
          if (desfecho !== 'enviou' && desfecho !== 'incerto') {
            // "Imediatamente" com um respiro de 10 a 20s, não zero cravado.
            // Falhar ainda significa ter ABERTO um perfil, e perfil atrás de
            // perfil sem pausa nenhuma é exatamente a assinatura de raspador
            // que a conta não pode ter. 15s não atrasa o dia (são segundos numa
            // vaga que valeria 36 minutos) e apaga essa assinatura.
            // REGRA 25: perfil que não abriu espera de 300 a 600 s (respiroAposFalha), não 10 a 20 s.
            espera = desfecho === 'falhou'
              ? respiroAposFalha((Date.now() % 997) / 997)
              : desfecho === 'piso' ? Math.max(60, Math.ceil(pisoFaltaMs / 1000))
              : 900;
          } else {
            // O PRAZO É A MEIA-NOITE DE HOJE, não "daqui a 24 horas".
            //
            // Com janela de 24h a primeira versão olhava sempre 24 horas à
            // frente, então o intervalo só crescia e a conta do dia nunca
            // fechava: com 34 restando dava 42 min, e depois de mandar uma dava
            // 43, e assim por diante. Nunca chegaria em 40 num dia.
            //
            // O teto é por DIA — o mesmo dia brasileiro que a view usa — então
            // o prazo tem que ser o fim desse dia. Assim a conta se conserta
            // sozinha: se ela atrasar, sobra menos tempo pro mesmo tanto de
            // mensagem e o intervalo encurta até dar.
            // +-25% pra não sair de metrônomo. O piso (2700 s) é a operação mais
            // externa em calcularEspera(): nenhum teto de espera o fura.
            // Espera SORTEADA de 45 a 75 min; com o dia apertado o sorteio encolhe para perto de 45
            // (calcularEspera espalha pelo resto do dia útil, sem o almoço).
            espera = calcularEspera({ agora: new Date(), cfg: CFG, restam: t2.restam, sorteio: Math.random() });
          }
          // A ESPERA TEM QUE SER APLICADA. Até 05/11/2026 ela só ia para o log: a
          // variável proximaAbordagem não recebia o valor, e em 09/10 saíram 12 DMs
          // em 41 min com o log dizendo "próxima em 94 min".
          proximaAbordagem = Date.now() + espera * 1000;
          // Quando a espera é de envio (não de falha), o alvo sai do almoço e de minuto 0/5 (sempre PARA FRENTE: o piso só cresce).
          if (desfecho === 'enviou' || desfecho === 'incerto') {
            proximaAbordagem = ajustarInstante(proximaAbordagem, Math.random());
            espera = Math.ceil((proximaAbordagem - Date.now()) / 1000);
          }
          log(`${t2.usados}/${t2.teto} abordagens · ${t2.respostas} respostas hoje`
            + ` · próxima abordagem em ${Math.round(espera / 60)} min`
            + (desfecho === 'incerto' ? ' (o toque incerto conta no teto e no piso, mas não como envio confirmado)' : ''));
          ultimoErro = null;   // uma volta inteira sem tropeço limpa o histórico
          await bater({ ciclo, enviados_hoje: t2.usados, ultimo_erro: null,
            fazendo: `mandei ${t2.usados}/${t2.teto}, próxima em ${Math.round(espera / 60)} min` });
        }
      }

      // ── 3. (sem busca de @) ───────────────────────────────────────────────
      // Antes aqui o robô procurava @ pela lupa e varria cidades. Saiu em 09/11/2026 (ver "BUSCA DE @").

      // ── 4. dorme pouco e volta ────────────────────────────────────────────
      // Chegou aqui sem cair no catch = volta limpa, então o erro é história.
      // Antes só limpava depois de ENVIAR, e com o teto em 0 isso nunca
      // acontece: um "fetch failed" das 20:36 ficou grudado no pulso a noite
      // inteira e virou "A AGENTE PAROU" no WhatsApp às 07:39.
      ultimoErro = null;
      await dorme(CFG.olharSeg * 1000);
    } catch (e) {
      ultimoErro = `${new Date().toISOString().slice(11, 19)} ${e.message}`.slice(0, 200);
      log(`a volta tropeçou (${e.message}) — sigo na próxima`);
      await bater({ ciclo, fazendo: 'tropecei, espero 30s e tento de novo', ultimo_erro: ultimoErro });
      await dorme(30000);
    }
  }
}

// ═══ LOOP ════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  ${(MODO === 'responder' ? 'RESPONDENDO' : 'ABORDANDO').padEnd(11)} · ${CANAL.toUpperCase().padEnd(9)} ${(DRY ? 'ENSAIO (não envia)' : 'ENVIANDO DE VERDADE').padEnd(19)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  if (MODO === 'responder') {
    // Responder também é enviar: janela de 8h-21h (seg a sáb) e conta do chip conferidas antes de começar.
    if (!DRY && !podeEnviar(new Date(), CFG)) {
      log(`fora da janela de envio (${CFG.horaIni}h–${CFG.horaFim}h, segunda a sábado). Não respondo agora.`);
      return;
    }
    if (!DRY && CANAL === 'whatsapp') {
      const cc = await contaDoChipOk();
      if (!cc.ok) { log('NÃO respondo: ' + cc.motivo + '.'); return; }
    }
    return await modoResponder();
  }
  if (MODO === 'continuo')  return await modoContinuo();

  const t0 = await travas();
  log(`conta ${CFG.consultor} · assina como "${CFG.assinatura}" · teto ${t0.usados}/${t0.teto} · opt-out ${t0.taxa}% (${t0.estado})`);
  if (t0.porque) log(`  ${t0.porque}`);
  log(`  janela de envio ${CFG.horaIni}h–${CFG.horaFim}h, segunda a sábado`);
  if (!DRY) {
    const falta = await faltaDoPiso();
    if (falta > 0) { log(`piso de ${Math.round(CFG.minSeg / 60)} min: volte em ${Math.ceil(falta / 60000)} min.`); return; }
  }
  if (t0.estado === 'travado') {
    log('DISJUNTOR ARMADO — a fila está travada por opt-out alto. Nada será enviado.');
    log('Troque a abertura e recomece por uma lista nova antes de voltar.');
    return;
  }
  if (t0.restam <= 0 && !DRY) { log('teto do dia já atingido. Volte amanhã — a rampa continua.'); return; }
  if (!DRY && bloqueioAtivo()) { log('canal bloqueado para conversa nova (bloqueio-' + CANAL + '.json). Não abordo.'); return; }
  if (!DRY && !(await resolverPendente())) { log('há um envio pendente de gravar no banco — não abordo ninguém até gravar.'); return; }
  // WhatsApp: confere QUEM está logado antes de começar (e de novo antes de cada envio, abaixo).
  if (!DRY && CANAL === 'whatsapp') {
    const cc = await contaDoChipOk();
    if (!cc.ok) { log('NÃO envio: ' + cc.motivo + '.'); return; }
    log('  conta do WhatsApp conferida: não é a linha IO nem o celular do dono.');
  }

  const [fila, scripts, alegacoes, produtos] = await Promise.all([
    ler('prospeccao_fila_worker?select=*&limit=200'),
    ler('prospeccao_scripts?select=*'),
    ler('prospeccao_alegacoes?select=*'),
    ler('prospeccao_produtos?select=*&ativo=eq.true&order=ordem.asc'),
  ]);

  // Só quem tem o endereço do canal escolhido.
  const alvos = fila.filter(alvoDoCanal);
  log(`fila: ${fila.length} elegíveis · ${alvos.length} com ${CANAL === 'instagram' ? '@' : 'telefone'}`);
  if (CANAL === 'instagram' && alvos.length < fila.length) {
    log(`  (${fila.length - alvos.length} sem @ — rode "node colher-instagram.mjs" pra colher)`);
  }
  if (!alvos.length) { log('ninguém pra falar agora.'); return; }

  let aba = null;
  if (!DRY) {
    try { aba = await Aba.abrir(CFG.cdp); }
    catch (e) {
      log('NÃO CONSEGUI FALAR COM O CHROME:', e.message);
      log('Suba o Chrome com --remote-debugging-port=' + new URL(CFG.cdp).port + ' e um --user-data-dir próprio.');
      log('Enquanto isso, "node worker.mjs --dry" funciona e mostra tudo que sairia.');
      return;
    }
    log('Chrome conectado, aba própria aberta.');
  }

  let enviados = 0, falhas = 0;
  for (const c of alvos) {
    // As travas são relidas a cada envio, não uma vez no começo: se alguém
    // registrar "não perturbar" na tela enquanto isto roda, o worker para.
    const t = await travas();
    if (t.estado === 'travado') { log('DISJUNTOR ARMOU no meio da fila — parando.'); break; }
    if (!DRY && t.restam <= 0)  { log(`teto do dia atingido (${t.teto}). Parando.`); break; }

    if (!DRY && !podeEnviar(new Date(), CFG)) {
      log(`fora da janela de envio (${CFG.horaIni}h–${CFG.horaFim}h, segunda a sábado). Parando.`); break;
    }

    const vf = await filaUnica(c);
    if (!vf.ok) { log(`  pulei ${c.empresa}: ${vf.motivo}`); if (vf.erro) break; continue; }
    const pid = c.produto_da_lista || (produtos[0] && produtos[0].id);
    const prod = produtos.find(p => p.id === pid);
    const preco = prod ? `R$ ${Number(prod.preco).toLocaleString('pt-BR')}` : '';
    const escolhida = await escolherMensagem(c, scripts, alegacoes, pid, preco);
    if (!escolhida) { log(`PULOU ${c.empresa} — toda abertura de ${pid} está bloqueada pela trava de alegação`); continue; }
    const { msg, obs: obsToque, obsIncerto } = escolhida;

    const destino = CANAL === 'instagram' ? '@' + c.instagram : c.telefone;
    console.log(`\n─── ${c.empresa} · ${c.cidade || ''} · ${destino} · ${CTX(c)} ───`);
    console.log(msg.split('\n').map(l => '  │ ' + l).join('\n'));

    if (DRY) { enviados++; continue; }

    // Antes de CADA envio: conta do chip, piso (banco + arquivo) e marcador local.
    if (CANAL === 'whatsapp') {
      const cc = await contaDoChipOk();
      if (!cc.ok) { log('NÃO envio: ' + cc.motivo + '. Parando.'); break; }
    }
    const decA = await decidirAgora();
    if (!decA.enviar) { log(`parando: ${decA.motivo === 'piso' ? 'piso de 45 min' : decA.motivo}.`); break; }
    const prevArq = lerArquivoUltimo();
    if (!gravarArquivoUltimo(Date.now())) { log('não consegui gravar o marcador local de envio — parando.'); break; }
    const r = CANAL === 'instagram'
      ? await enviarInstagram(aba, c.instagram, msg)
      : await enviarWhatsApp(aba, c.telefone, msg);

    if (r.ok) {
      enviados++;
      try {
        await gravarToque(c.id, null, pid, 'enviei', obsToque);
      } catch (e) {
        // A DM saiu e o toque não gravou: vira pendência, para o teto e a fila única enxergarem.
        log(`  ! toque não gravou (${e?.message || e}); registrando como incerto`);
        await gravarIncerto(c.id, pid, obsIncerto);
      }
      log(`  ✓ enviado (${enviados})`);
    } else {
      falhas++;
      log(`  ✗ ${r.motivo}`);
      if (/não saiu|ficou na caixa/.test(r.motivo || '')) await gravarIncerto(c.id, pid, obsIncerto);
      else restaurarArquivoUltimo(prevArq);
      // Falha NÃO vira toque: gravar "enviei" pra mensagem que não saiu faria a
      // pessoa sumir da fila sem nunca ter sido falada.
      if (falhas >= 5) { log('5 falhas seguidas — algo mudou na página ou a sessão caiu. Parando.'); break; }
    }

    // ── ESPACAMENTO ADAPTATIVO ──────────────────────────────────────────
    // Divide o tempo que sobra da janela pelo que sobra do teto. Manda cedo e
    // o worker anda devagar; entrou tarde e ele acelera ate o piso. Ninguem
    // precisa escolher "quantos segundos entre mensagens": a janela e o teto
    // ja respondem isso, e a resposta e sempre a MENOR densidade possivel.
    // Com janela de 24h nao existe "fim do expediente": o horizonte e sempre as
    // proximas 24h. Sem isto, as 23h50 ela acharia que sobram 10 minutos pra
    // gastar o teto inteiro e despejaria tudo de uma vez.
    const sobramMsg = Math.max(1, (await travas()).restam);
    const jitter = 0.75 + 0.5 * ((Date.now() % 1013) / 1013);   // +-25%, nunca ritmo de metronomo
    const espera = calcularEspera({ agora: new Date(), cfg: CFG, restam: sobramMsg, jitter });
    log(`  aguardando ${espera}s (${sobramMsg} restantes; piso ${CFG.minSeg}s)`);
    await dorme(espera * 1000);
  }

  if (aba) await aba.fechar();
  console.log(`\n─────────────────────────────────────────`);
  console.log(`  ${DRY ? 'simulados' : 'enviados'}  ${enviados}`);
  if (!DRY) console.log(`  falhas     ${falhas}`);
  console.log(`─────────────────────────────────────────`);
  console.log(`\nAcompanhe no radar: https://solardoc.app/gerador/radar/\n`);
}

main().catch(e => { console.error('\nquebrou:', e.message); process.exit(1); });
