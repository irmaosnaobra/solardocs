#!/usr/bin/env node
/* Teste das travas de ritmo do worker. Node puro, sem rede, sem Chrome, sem banco.
   Rode:  node teste-ritmo.mjs
   NUNCA importa o worker.mjs (ele liga o robô no import): testa o ritmo.mjs e lê o
   worker.mjs só como texto, para conferir que a espera calculada é aplicada. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  cfgDe, podeEnviar, calcularEspera, tetoEfetivo, faltaParaPiso, avaliarToques, contaProibida,
  arquivoUltimo, faltaPiso, decidirAbordagem, canalValido, restamComPendente, gravarComRetentativa,
  respiroAposFalha, parseBloqueio, RESPIRO_MIN_SEG,
  decidirRampa, diaAnteriorUtil, ehDomingo, limitesDoDia, tetoManualInstagram, TETO_INSTAGRAM, RAMPA_INICIAL,
  parseHistorico, maxInstagramEfetivo, historicoPrecisaSincronizar, diaDeIso,
  relogioBRT, emAlmoco, segUteisAte, ajustarInstante, esperaParaMinutoBom, inicioDoDia, ESPERA_MAX_SEG,
  registrarFalhaCaixa, aposEnvioConfirmado, enviosConfirmados, contaParaFreio, ehIncerto, LIMITE_PERFIS_FREIO,
  planoDigitacao, duracaoRolagemMs, passosRolagem,
  chaveTratada, lerTratadas, jaTratada, marcarTratada, TRATADAS_DIAS,
} from './ritmo.mjs';
import { spawnSync } from 'node:child_process';

let falhas = 0, n = 0;
const ok = (cond, nome) => { n++; if (!cond) { falhas++; console.log('  FALHOU: ' + nome); } else console.log('  ok  ' + nome); };
const em = iso => new Date(iso + '-03:00');   // horário de Brasília

// 05/11/2026 é quinta; 07/11 sábado; 08/11 domingo.
const padrao = cfgDe({});
ok(padrao.horaIni === 8 && padrao.horaFim === 21, 'padrão é 8h-21h');
ok(padrao.minSeg === 2700 && padrao.maxSeg >= 2700 && padrao.tetoEspera >= 2700, 'padrão de espera: mínimo 2700, máximo e teto >= mínimo');

console.log('\njanela');
ok(!podeEnviar(em('2026-11-05T07:59:00'), padrao), 'quinta 07:59 não envia');
ok(podeEnviar(em('2026-11-05T08:00:00'), padrao), 'quinta 08:00 envia');
ok(podeEnviar(em('2026-11-05T20:59:59'), padrao), 'quinta 20:59 envia');
ok(!podeEnviar(em('2026-11-05T21:00:00'), padrao), 'quinta 21:00 não envia');
ok(!podeEnviar(em('2026-11-05T03:00:00'), padrao), 'quinta 03:00 (madrugada) não envia');
ok(podeEnviar(em('2026-11-07T10:00:00'), padrao), 'sábado 10:00 envia');
ok(!podeEnviar(em('2026-11-08T10:00:00'), padrao), 'domingo 10:00 não envia');
ok(!podeEnviar(em('2026-11-08T15:00:00'), padrao), 'domingo 15:00 não envia');
// o relógio do servidor pode estar em UTC: 23:30 UTC de sábado = 20:30 BRT de sábado
ok(podeEnviar(new Date('2026-11-07T23:30:00Z'), padrao), 'instante em UTC é lido em Brasília (sáb 20:30 BRT envia)');
ok(!podeEnviar(new Date('2026-11-08T00:30:00Z'), padrao), 'instante em UTC é lido em Brasília (sáb 21:30 BRT não envia)');

console.log('\na env não abre a janela');
const aberta = cfgDe({ HORA_INI: '0', HORA_FIM: '24' });
ok(aberta.horaIni === 8 && aberta.horaFim === 21, 'HORA_INI=0 e HORA_FIM=24 continuam em 8-21');
ok(!podeEnviar(em('2026-11-05T07:59:00'), aberta), 'com env aberta, 07:59 continua fechado');
ok(!podeEnviar(em('2026-11-05T21:00:00'), aberta), 'com env aberta, 21:00 continua fechado');
ok(!podeEnviar(em('2026-11-08T12:00:00'), aberta), 'com env aberta, domingo continua fechado');
const lixo = cfgDe({ HORA_INI: 'abc', HORA_FIM: '', MIN_SEG: 'x', MAX_SEG: 'NaN' });
ok(lixo.horaIni === 8 && lixo.horaFim === 21 && lixo.minSeg === 2700, 'env ilegível cai no padrão seguro');
const aperta = cfgDe({ HORA_INI: '10', HORA_FIM: '18' });
ok(podeEnviar(em('2026-11-05T10:00:00'), aperta) && !podeEnviar(em('2026-11-05T09:59:00'), aperta) && !podeEnviar(em('2026-11-05T18:00:00'), aperta), 'a env pode APERTAR (10h-18h)');
const invertida = cfgDe({ HORA_INI: '22', HORA_FIM: '6' });
ok(![0, 3, 8, 12, 20, 21, 22, 23].some(h => podeEnviar(em(`2026-11-05T${String(h).padStart(2, '0')}:30:00`), invertida)), 'janela invertida FECHA, não abre');

console.log('\nespera mínima de 2700 s');
const baixa = cfgDe({ MIN_SEG: '10', MAX_SEG: '20', TETO_ESPERA: '30' });
ok(baixa.minSeg === 2700 && baixa.maxSeg >= 2700 && baixa.tetoEspera >= 2700, 'MIN_SEG/MAX_SEG/TETO_ESPERA baixos não baixam o piso');
const manha = em('2026-11-05T08:00:00');
for (const [nome, cfg] of [['padrão', padrao], ['env baixa', baixa]]) {
  for (const restam of [1, 5, 12, 40, 500]) {
    for (const jitter of [0.75, 1, 1.25]) {
      const e = calcularEspera({ agora: manha, cfg, restam, jitter });
      if (e < 2700) ok(false, `${nome}: restam ${restam} jitter ${jitter} deu ${e}s`);
    }
  }
}
ok(true, 'calcularEspera nunca abaixo de 2700 s (config padrão e config com env baixa, 30 combinações)');
ok(calcularEspera({ agora: em('2026-11-05T20:50:00'), cfg: padrao, restam: 9, jitter: 1 }) === 2700, 'sobrando 10 min e 9 envios, ainda 2700 s (nunca rajada no fim do dia)');
ok(calcularEspera({ agora: manha, cfg: padrao, restam: 1, jitter: 1 }) <= padrao.tetoEspera, 'com 1 envio restante, não passa do teto de espera (1 h)');

console.log('\ndois envios seguidos respeitam o mínimo');
{
  // Simula o laço: proximaAbordagem só vale se for gravado após o cálculo.
  let relogio = em('2026-11-05T08:00:00').getTime();
  let proxima = 0;
  const envios = [];
  for (let passo = 0; passo < 12 * 3600 / 30; passo++) {          // 12 h em passos de 30 s
    relogio += 30_000;
    if (relogio < proxima) continue;
    const agora = new Date(relogio);
    if (!podeEnviar(agora, padrao)) continue;
    if (envios.length >= 5) break;                                 // teto do Instagram
    envios.push(relogio);
    const espera = calcularEspera({ agora, cfg: padrao, restam: 5 - envios.length, jitter: 0.75 });
    proxima = relogio + espera * 1000;
  }
  const dif = envios.slice(1).map((t, i) => (t - envios[i]) / 1000);
  ok(envios.length >= 2 && dif.every(d => d >= 2700), `intervalos entre envios: ${dif.join(', ')} s (todos >= 2700)`);
  ok(envios.every(t => podeEnviar(new Date(t), padrao)), 'todos os envios simulados caíram dentro da janela');
}
ok(faltaParaPiso(Date.now() - 60_000, Date.now(), padrao) > 2600_000, 'reinício 1 min depois de um envio ainda espera ~44 min (piso vence o reinício)');
ok(faltaParaPiso(Date.now() - 2800_000, Date.now(), padrao) === 0, 'reinício 46 min depois já pode');
ok(faltaParaPiso(NaN, Date.now(), padrao) === 2700_000, 'não sabe quando foi o último envio: espera o piso inteiro');
ok(faltaParaPiso(Date.now() + 3600_000, Date.now(), padrao) === 2700_000, 'data do último envio no futuro não vale: espera o piso');

console.log('\npiso: decisão pura (decidirAbordagem), com reinício e banco fora');
{
  // Mundo simulado: o banco e o arquivo local. O "processo" não guarda NADA: a cada passo a decisão
  // nasce só das duas fontes, como no worker depois de um reinício do COMECAR.ps1.
  const mundo = { banco: [], arquivo: null, bancoFora: false, bancoNaoGrava: false, arquivoPerdido: false };
  const lerBanco = () => mundo.bancoFora ? { ok: false, ms: null } : { ok: true, ms: mundo.banco.length ? Math.max(...mundo.banco) : null };
  const lerArq = () => mundo.arquivoPerdido ? { ok: false, ms: null } : arquivoUltimo(mundo.arquivo === null ? null : JSON.stringify({ ms: mundo.arquivo }));
  const decide = (ms, restam = 5) => decidirAbordagem({ agora: new Date(ms), cfg: padrao, restam, banco: lerBanco(), arquivo: lerArq() });
  // tentativa: o marcador local grava ANTES de enviar; o banco só grava se estiver no ar
  const tenta = (ms, desfecho) => {
    mundo.arquivo = ms;
    if ((desfecho === 'enviou' || desfecho === 'incerto') && !mundo.bancoFora && !mundo.bancoNaoGrava) mundo.banco.push(ms);
  };
  const T0 = em('2026-11-05T09:00:00').getTime();
  const reset = () => { mundo.banco = []; mundo.arquivo = null; mundo.bancoFora = false; mundo.bancoNaoGrava = false; mundo.arquivoPerdido = false; };

  for (const desfecho of ['enviou', 'incerto']) {
    reset();
    ok(decide(T0).enviar, desfecho + ': sem histórico nas duas fontes, a primeira tentativa pode');
    tenta(T0, desfecho);
    ok(!decide(T0 + 60_000).enviar && decide(T0 + 60_000).motivo === 'piso', desfecho + ': reinício 60 s depois é barrado pelo piso');
    ok(!decide(T0 + 2699_000).enviar, desfecho + ': 2699 s depois ainda barra');
    ok(decide(T0 + 2700_000).enviar, desfecho + ': 2700 s depois libera');
  }

  reset(); tenta(T0, 'incerto'); mundo.banco = [];
  ok(!decide(T0 + 60_000).enviar, 'incerto cujo toque NÃO gravou no banco: o arquivo local segura o piso');

  reset(); tenta(T0, 'enviou'); mundo.bancoFora = true;
  ok(!decide(T0 + 60_000).enviar && decide(T0 + 2700_000).enviar, 'banco FORA depois de um envio: o arquivo local vale (barra em 60 s, libera em 2700 s)');

  reset(); mundo.bancoFora = true;
  ok(!decide(T0).enviar && decide(T0).motivo === 'piso', 'banco fora e sem arquivo: não sei quando foi o último, espera o piso inteiro');

  reset(); mundo.banco = [T0]; mundo.arquivoPerdido = true;
  ok(!decide(T0 + 60_000).enviar && decide(T0 + 2700_000).enviar, 'arquivo corrompido, banco com o envio: vale o banco');

  reset(); mundo.banco = [T0 - 6 * 3600_000]; mundo.arquivo = T0;
  ok(!decide(T0 + 60_000).enviar, 'vale a MAIOR hora: banco antigo + arquivo recente barra');
  reset(); mundo.banco = [T0]; mundo.arquivo = T0 - 6 * 3600_000;
  ok(!decide(T0 + 60_000).enviar, 'vale a MAIOR hora: banco recente + arquivo antigo barra');

  reset();
  ok(!decide(T0, 0).enviar && decide(T0, 0).motivo === 'teto', 'teto zerado barra');
  ok(decide(em('2026-11-05T21:00:00').getTime()).motivo === 'janela', 'decisão: 21:00 é janela fechada');
  ok(decide(em('2026-11-08T10:00:00').getTime()).motivo === 'janela', 'decisão: domingo é janela fechada');
  ok(arquivoUltimo('lixo{').ok === false && arquivoUltimo(null).ok && arquivoUltimo(null).ms === null, 'arquivo ilegível = ok:false; ausente = nunca enviou');

}

console.log('\npiso em sequência, tentativa a tentativa (enviou, incerto, banco fora, reinício)');
{
  const mundo = { banco: [], arquivo: null, bancoFora: false };
  const lerBanco = () => mundo.bancoFora ? { ok: false, ms: null } : { ok: true, ms: mundo.banco.length ? Math.max(...mundo.banco) : null };
  const lerArq = () => arquivoUltimo(mundo.arquivo === null ? null : JSON.stringify({ ms: mundo.arquivo }));
  let sem = 777; const rnd = () => (sem = (sem * 1103515245 + 12345) % 2147483648) / 2147483648;
  let t = em('2026-11-05T08:00:00').getTime();
  const envios = [];
  for (let i = 0; i < 12 * 120; i++) {
    t += 30_000;
    mundo.bancoFora = rnd() < 0.3;
    const d = decidirAbordagem({ agora: new Date(t), cfg: padrao, restam: 5, banco: lerBanco(), arquivo: lerArq() });
    if (!d.enviar) continue;
    envios.push(t);
    mundo.arquivo = t;                                  // marcador local antes de enviar
    // enviou e incerto contam igual: o marcador local já gravou; o banco às vezes está fora ou não grava
    if (!mundo.bancoFora && rnd() < 0.7) mundo.banco.push(t);
  }
  const gaps = envios.slice(1).map((x, i) => (x - envios[i]) / 1000);
  ok(envios.length >= 4 && envios.length <= 17, 'em 12 h saíram ' + envios.length + ' tentativas (o piso de 45 min limita a no máximo 17)');
  ok(gaps.every(g => g >= 2700), 'intervalos entre tentativas: ' + gaps.join(', ') + ' s (todos >= 2700, com reinício a cada passo e banco fora em 30%)');
  ok(envios.every(x => podeEnviar(new Date(x), padrao)), 'todas as tentativas dentro da janela');
}

console.log('\nenvio saiu e o toque não grava (pendência)');
{
  // O envio saiu. A gravação falha 3 vezes: vira pendência (memória + arquivo) e ninguém mais é abordado,
  // nem depois de horas, nem depois de reinício. Quando a gravação volta, a pendência some e a abordagem segue.
  const T0 = em('2026-11-05T09:00:00').getTime();
  let bancoNoAr = false, chamadas = 0;
  const gravar = async () => { chamadas++; if (!bancoNoAr) throw new Error('500'); };
  const semEspera = { vezes: 3, esperaMs: 0, dorme: async () => {} };
  const ok3 = await gravarComRetentativa(gravar, semEspera);
  ok(ok3 === false && chamadas === 3, 'a gravação falha 3 vezes: tentou exatamente 3 e devolveu false');

  // estado persistido: o arquivo local com a pendência (o que o worker grava em registrarPendente)
  const arquivoTexto = JSON.stringify({ ms: T0, canal: 'instagram', pendente_gravar: { id: 'empresa-1', pid: 'solardoc', ms: T0 } });
  const arq = arquivoUltimo(arquivoTexto);
  ok(arq.ok && arq.pendente && arq.pendente.id === 'empresa-1', 'o arquivo local guarda pendente_gravar com o id da empresa');
  const banco = { ok: true, ms: null };          // o banco está no ar para ler, mas o toque nunca entrou
  const d = (ms, extra = {}) => decidirAbordagem({ agora: new Date(ms), cfg: padrao, restam: 5, banco, arquivo: arq, ...extra });
  ok(d(T0 + 60_000).motivo === 'pendente' && !d(T0 + 60_000).enviar, 'com pendência, 1 min depois: não aborda ninguém');
  ok(d(T0 + 3 * 3600_000).motivo === 'pendente' && !d(T0 + 3 * 3600_000).enviar, 'com pendência, 3 h depois (piso já vencido): continua sem abordar');
  ok(d(T0 + 3 * 3600_000, { arquivo: arquivoUltimo(null), pendente: { id: 'empresa-1', ms: T0 } }).motivo === 'pendente', 'pendência só em memória também barra');
  ok(restamComPendente(5, arq.pendente) === 4 && restamComPendente(5, null) === 5 && restamComPendente(0, arq.pendente) === 0, 'o teto do dia conta a pendência como envio');
  ok(faltaPiso({ agoraMs: T0 + 60_000, cfg: padrao, banco, arquivo: arquivoUltimo(null), pendente: arq.pendente }) > 0, 'a pendência também vale como último envio para o piso');

  // o banco volta: a gravação funciona, a pendência é limpa (o arquivo perde pendente_gravar) e segue
  bancoNoAr = true;
  const gravouDepois = await gravarComRetentativa(gravar, semEspera);
  ok(gravouDepois === true, 'a gravação volta: gravou');
  const arqLimpo = arquivoUltimo(JSON.stringify({ ms: T0, canal: 'instagram' }));
  ok(arqLimpo.pendente === null, 'pendência limpa no arquivo');
  const bancoComToque = { ok: true, ms: T0 };
  const dep = (ms) => decidirAbordagem({ agora: new Date(ms), cfg: padrao, restam: 4, banco: bancoComToque, arquivo: arqLimpo });
  ok(!dep(T0 + 60_000).enviar && dep(T0 + 60_000).motivo === 'piso', 'gravou: ainda vale o piso de 45 min');
  ok(dep(T0 + 2700_000).enviar, 'gravou e passou o piso: volta a abordar');

  // 2ª tentativa na hora: falha, falha, grava na 3ª = não vira pendência
  let n = 0;
  const g3 = await gravarComRetentativa(async () => { if (++n < 3) throw new Error('504'); }, semEspera);
  ok(g3 === true && n === 3, 'falha 2 vezes e grava na 3ª: sem pendência');
  ok(arquivoUltimo('{"ms":1,"pendente_gravar":{"ms":5}}').pendente === null, 'pendente_gravar sem id é ignorado');
}

console.log('\nregra 25: respiro, bloqueio no disco, teto sem linha');
{
  const amostras = [0, 0.001, 0.25, 0.5, 0.75, 0.999, 1, NaN, -3, 7].map(respiroAposFalha);
  ok(RESPIRO_MIN_SEG === 300 && amostras.every(x => x >= 300 && x <= 599), 'respiro após perfil que não abre: sempre entre 300 e 599 s (' + Math.min(...amostras) + ' a ' + Math.max(...amostras) + ')');
  ok(respiroAposFalha(0) === 300, 'respiro mínimo é exatamente 300 s');

  const hoje = em('2026-11-05T10:00:00');
  const semBloqueio = parseBloqueio(null);
  ok(semBloqueio.bloqueado === false, 'sem arquivo de bloqueio: canal livre');
  const comArquivo = parseBloqueio('{"desde":"2026-11-03T16:34:00-03:00","motivo":"x","perfis":["a","b","c"]}');
  ok(comArquivo.bloqueado && comArquivo.desde === '2026-11-03T16:34:00-03:00' && comArquivo.perfis.length === 3, 'arquivo de bloqueio lido (desde, motivo, perfis)');
  ok(parseBloqueio('{lixo').bloqueado && parseBloqueio('{lixo').corrompido, 'arquivo de bloqueio ilegível também bloqueia (falha segura)');
  ok(parseBloqueio('{}').bloqueado, 'arquivo vazio {} também bloqueia: a existência é o que vale');

  // teto de frio 0 com o arquivo presente, mesmo com banco liberando 12
  for (const canal of ['instagram', 'whatsapp']) {
    const t = tetoEfetivo(canal, { teto: 12, usados: 0, restam: 12 }, comArquivo.bloqueado);
    ok(t.teto === 0 && t.restam === 0, canal + ': arquivo de bloqueio presente = teto de frio 0, restam 0');
  }
  ok(tetoEfetivo('instagram', { teto: 12, usados: 0, restam: 12 }, semBloqueio.bloqueado).restam === 10, 'sem bloqueio o teto do Instagram é limitado a 10 (limite duro)');
  const dec = decidirAbordagem({ agora: hoje, cfg: padrao, restam: 5, banco: { ok: true, ms: null }, arquivo: arquivoUltimo(null), bloqueio: comArquivo });
  ok(!dec.enviar && dec.motivo === 'bloqueio', 'decidirAbordagem: bloqueio presente barra a abordagem fria');
  ok(decidirAbordagem({ agora: hoje, cfg: padrao, restam: 5, banco: { ok: true, ms: null }, arquivo: arquivoUltimo(null), bloqueio: semBloqueio }).enviar, 'decidirAbordagem: sem bloqueio, dentro da janela, libera');

  // sem linha em prospeccao_teto_hoje (teto/usados/restam indefinidos) = 0, nunca 5
  for (const canal of ['instagram', 'whatsapp']) {
    const t = tetoEfetivo(canal, { teto: undefined, usados: undefined, restam: undefined });
    ok(t.teto === 0 && t.restam === 0, canal + ': sem linha de teto = teto 0 e restam 0');
    const t2 = tetoEfetivo(canal, { teto: undefined, usados: 0, restam: 5 });
    ok(t2.teto === 0 && t2.restam === 0, canal + ': sem teto mas view dizendo restam 5 = ainda 0');
  }
}

console.log('\nrampa do Instagram: 5 a 10, +1 por dia cheio');
{
  ok(TETO_INSTAGRAM === 10 && RAMPA_INICIAL === 5, 'limite duro 10, rampa começa em 5');
  // --- teto lido do teto_manual (a rampa da VIEW, 25 a 100, nunca vale) ---
  const ig = (extra, bloq = false, max = 10) => tetoEfetivo('instagram', { teto: 25, usados: 0, restam: 25, ...extra }, bloq, max);
  ok(ig({ tetoManual: 5 }).teto === 5 && ig({ tetoManual: 5 }).restam === 5, 'teto_manual 5 vale 5, mesmo com a view dizendo 25');
  ok(ig({ tetoManual: 8 }).teto === 8, 'teto_manual 8 vale 8');
  ok(ig({ tetoManual: 12 }).teto === 10, 'teto_manual 12 posto à mão é cortado em 10');
  ok(ig({ tetoManual: null }).teto === 5 && ig({ tetoManual: null }).restam === 5, 'teto_manual NULO vale 5 (não cai nos 25 da view)');
  ok(tetoManualInstagram(null) === 5 && tetoManualInstagram('x') === 0 && tetoManualInstagram(0) === 0, 'nulo vale 5; lixo vale 0; 0 continua 0 (congelado)');
  ok(ig({ tetoManual: 8 }, false, 6).teto === 6, 'a env só DESCE: máximo 6 corta o manual 8');
  ok(cfgDe({ TETO_INSTAGRAM_MAX: '50' }).tetoInstagramMax === 10 && cfgDe({ TETO_INSTAGRAM_MAX: '3' }).tetoInstagramMax === 3 && cfgDe({}).tetoInstagramMax === 10, 'TETO_INSTAGRAM_MAX nunca sobe de 10');
  ok(ig({ tetoManual: 8 }, true).restam === 0, 'bloqueio: frio 0 mesmo com manual 8');

  // --- a rampa dia a dia ---
  const dias = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];   // qui sex sáb seg ter qua qui sex (sem domingo)
  let manual = 5, marca = null, atualizado = null;
  const subidas = [];
  for (const hoje of dias) {
    // ontem saiu o teto INTEIRO daquele dia (o gravado na marca de ontem)
    const d = decidirRampa({ hoje, marca, atualizadoDia: atualizado, atualManual: manual, enviadosDiaAnterior: marca ? marca.teto : 0, bloqueado: false });
    if (d.gravar) { manual = d.novo; atualizado = hoje; }
    if (d.marcar) marca = { dia: hoje, teto: Math.min(manual, 10), bloqueio: false };
    subidas.push(manual);
  }
  ok(subidas.join(',') === '5,6,7,8,9,10,10,10', 'dia cheio todo dia (o 1º dia só marca, sem prova de ontem): ' + subidas.join(', ') + ' e para em 10');
  ok(Math.max(...subidas) === 10, 'nunca passa de 10');

  const base = { hoje: '2026-11-10', marca: { dia: '2026-11-09', teto: 5, bloqueio: false }, atualizadoDia: null, atualManual: 5, bloqueado: false };
  ok(!decidirRampa({ ...base, enviadosDiaAnterior: 4 }).gravar, 'dia NÃO cheio (4 de 5): não sobe');
  ok(!decidirRampa({ ...base, enviadosDiaAnterior: 0 }).gravar, 'dia sem envio: não sobe');
  ok(decidirRampa({ ...base, enviadosDiaAnterior: 5 }).novo === 6, 'dia cheio (5 de 5): sobe para 6');
  ok(!decidirRampa({ ...base, enviadosDiaAnterior: 5, bloqueado: true }).gravar, 'canal bloqueado: não sobe nem com dia cheio');
  ok(decidirRampa({ ...base, atualManual: 12, enviadosDiaAnterior: 0 }).novo === 10, 'manual 12 posto à mão é trazido para 10');
  ok(decidirRampa({ ...base, enviadosDiaAnterior: 5, maxIg: 5 }).novo === undefined || !decidirRampa({ ...base, enviadosDiaAnterior: 5, maxIg: 5 }).gravar, 'com máximo de env 5, dia cheio não passa de 5');

  // --- reinício no mesmo dia não soma ---
  const primeira = decidirRampa({ ...base, enviadosDiaAnterior: 5 });
  ok(primeira.gravar && primeira.novo === 6, 'primeira volta do dia: 5 -> 6');
  ok(!decidirRampa({ ...base, marca: { dia: base.hoje, teto: 6, bloqueio: false }, atualManual: 6, enviadosDiaAnterior: 6 }).gravar, 'reinício com a marca local de hoje: não soma de novo');
  ok(!decidirRampa({ ...base, atualizadoDia: base.hoje, atualManual: 6, enviadosDiaAnterior: 6 }).gravar, 'reinício com a marca perdida mas atualizado_em de hoje no banco: não soma de novo');

  // --- domingo não conta ---
  ok(ehDomingo('2026-11-08') && !ehDomingo('2026-11-07'), '08/11/2026 é domingo, 07/11 sábado');
  const dom = decidirRampa({ ...base, hoje: '2026-11-08', enviadosDiaAnterior: 5 });
  ok(!dom.gravar && !dom.marcar, 'domingo: a rampa não roda');
  ok(diaAnteriorUtil('2026-11-09') === '2026-11-07' && diaAnteriorUtil('2026-11-10') === '2026-11-09', 'na segunda, "ontem" é o sábado (domingo pulado)');
  ok(limitesDoDia('2026-11-07').ini === '2026-11-07T03:00:00.000Z' && limitesDoDia('2026-11-07').fim === '2026-11-08T03:00:00.000Z', 'o dia de Brasília vai de 03:00Z a 03:00Z');

  // --- nulo e congelado ---
  const nulo = decidirRampa({ ...base, atualManual: null, enviadosDiaAnterior: 99 });
  ok(nulo.gravar && nulo.novo === 5, 'teto_manual nulo na rampa: grava 5 (e não sobe nesse dia)');
  const zero = decidirRampa({ ...base, atualManual: 0, enviadosDiaAnterior: 99 });
  ok(!zero.gravar, 'teto_manual 0 (congelado à mão) nunca é levantado pela rampa');

  // --- bloqueio volta a 5 (texto do worker e do testar-bloqueio) ---
  const wsrc = readFileSync(fileURLToPath(new URL('./worker.mjs', import.meta.url)), 'utf8');
  ok(/async function garantirRebaixe[\s\S]{0,2500}patchRampa\(RAMPA_INICIAL/.test(wsrc) && /gravarBloqueio\([^\n]*\n\s*await rebaixarRampa\(\);/.test(wsrc), 'worker.mjs: quando o detector dispara, grava o bloqueio E volta o teto_manual a 5 na rampa');
  ok(/await rampaDoDia\(\);/.test(wsrc) && /decidirRampa\(\{/.test(wsrc), 'worker.mjs: o laço chama rampaDoDia, que usa decidirRampa');
  ok(/tetoManual: rampa === null \? undefined : \(rampa\[0\] \? rampa\[0\]\.teto_manual : 0\)/.test(wsrc), 'worker.mjs: travas lê o teto_manual (nulo=5 no ritmo.mjs, sem linha=0)');
  const tsrc = readFileSync(fileURLToPath(new URL('./testar-bloqueio.mjs', import.meta.url)), 'utf8');
  ok(/tetoAoVoltar: 5,/.test(tsrc) && !/teto_manual \?\? null\) === 0/.test(tsrc) && /teto_manual: CFG\.tetoAoVoltar/.test(tsrc), 'testar-bloqueio.mjs: ao destravar devolve o teto_manual a 5 SEMPRE (não só quando era 0)');
}

console.log('\nbloqueio: rebaixe com prova, dia do bloqueio, teto de ontem');
{
  const ig = (tetoManual, max) => tetoEfetivo('instagram', { teto: 25, usados: 0, restam: 25, tetoManual }, false, max);
  const hRuim = parseHistorico('{"ultimo":"2026-11-03T19:34:00.000Z","dia":"2026-11-03","rebaixado":false}');
  const hBom = parseHistorico('{"ultimo":"2026-11-03T19:34:00.000Z","dia":"2026-11-03","rebaixado":true}');
  const semBloq = parseBloqueio(null);
  const comBloqFalso = parseBloqueio('{"desde":"2026-11-03T16:34:00-03:00","motivo":"x","perfis":[],"rebaixado":false}');
  const comBloqMao = parseBloqueio('{"desde":"2026-11-03T16:34:00-03:00","motivo":"x","perfis":[]}');

  // 1. PATCH do rebaixe falhou (histórico rebaixado:false) e o destrave apagou o arquivo: o teto NÃO sobe
  const maxSemProva = maxInstagramEfetivo({ bloqueio: semBloq, historico: hRuim, maxIg: 10 });
  ok(maxSemProva === 5, 'PATCH do rebaixe falhou e o arquivo de bloqueio sumiu: máximo do Instagram = 5');
  ok(ig(8, maxSemProva).teto === 5 && ig(12, maxSemProva).teto === 5 && ig(null, maxSemProva).teto === 5, 'banco com teto_manual 8, 12 ou nulo: o worker usa 5 sem a prova');
  ok(maxInstagramEfetivo({ bloqueio: comBloqFalso, historico: hRuim, maxIg: 10 }) === 5, 'arquivo de bloqueio com rebaixado:false: máximo 5');
  ok(maxInstagramEfetivo({ bloqueio: comBloqMao, historico: null, maxIg: 10 }) === 5, 'arquivo de bloqueio criado à mão (sem rebaixado): máximo 5');
  ok(historicoPrecisaSincronizar(comBloqMao, null) && !historicoPrecisaSincronizar(semBloq, null), 'o arquivo de bloqueio à mão gera o histórico (e o rebaixe é refeito no banco)');

  // 2. arquivo apagado à mão não sobe acima de 5 enquanto não houver a prova; com a prova, volta ao normal
  ok(maxInstagramEfetivo({ bloqueio: semBloq, historico: hRuim, maxIg: 10 }) === 5, 'bloqueio apagado à mão, histórico sem prova: continua 5');
  ok(maxInstagramEfetivo({ bloqueio: semBloq, historico: hBom, maxIg: 10 }) === 10 && ig(8, 10).teto === 8, 'com a prova do rebaixe gravada, o teto da rampa volta a valer (8 vale 8)');
  ok(maxInstagramEfetivo({ bloqueio: semBloq, historico: null, maxIg: 10 }) === 10, 'conta que nunca foi bloqueada: sem limite extra');
  ok(maxInstagramEfetivo({ bloqueio: semBloq, historico: parseHistorico('{lixo'), maxIg: 10 }) === 5, 'histórico ilegível: 5 por segurança');
  ok(maxInstagramEfetivo({ bloqueio: semBloq, historico: hRuim, maxIg: 3 }) === 3, 'a env de máximo 3 continua mandando mais que os 5');
  ok(diaDeIso('2026-11-03T19:34:00.000Z') === '2026-11-03' && diaDeIso('2026-11-04T01:00:00.000Z') === '2026-11-03', 'o dia do bloqueio é o de Brasília');

  // 3. o dia do bloqueio nunca conta como cheio
  const b = { hoje: '2026-11-10', atualizadoDia: null, atualManual: 5, bloqueado: false, enviadosDiaAnterior: 8 };
  ok(!decidirRampa({ ...b, marca: { dia: '2026-11-09', teto: 8, bloqueio: true } }).gravar, 'marca de ontem com bloqueio: 8 de 8 não conta como cheio');
  ok(!decidirRampa({ ...b, marca: { dia: '2026-11-09', teto: 8, bloqueio: false }, ultimoBloqueioDia: '2026-11-09' }).gravar, 'histórico diz que ontem teve bloqueio: não conta como cheio');
  ok(!decidirRampa({ ...b, marca: { dia: '2026-11-09', teto: 8, bloqueio: false }, ultimoBloqueioDia: '2026-11-10' }).gravar, 'bloqueio hoje (depois de ontem): não conta como cheio');
  ok(decidirRampa({ ...b, marca: { dia: '2026-11-09', teto: 8, bloqueio: false }, ultimoBloqueioDia: '2026-11-03' }).novo === 6, 'bloqueio de uma semana atrás não impede: ontem cheio (8 de 8) sobe de 5 para 6');
  ok(!decidirRampa({ ...b, marca: { dia: '2026-11-09', teto: 8, bloqueio: false }, bloqueado: true }).gravar, 'sem prova de rebaixe (bloqueado:true para a rampa): não sobe');

  // 4. ontem comparado com o teto de ONTEM, não com o de hoje (já rebaixado para 5)
  const m8 = { dia: '2026-11-09', teto: 8, bloqueio: false };
  ok(!decidirRampa({ ...b, marca: m8, enviadosDiaAnterior: 5 }).gravar, 'ontem o teto era 8 e saíram 5: NÃO é dia cheio (mesmo hoje valendo 5)');
  ok(decidirRampa({ ...b, marca: m8, enviadosDiaAnterior: 8 }).novo === 6, 'ontem o teto era 8 e saíram 8: dia cheio, sobe de 5 para 6');
  ok(!decidirRampa({ ...b, marca: { dia: '2026-11-07', teto: 5, bloqueio: false }, enviadosDiaAnterior: 99 }).gravar, 'marca de outro dia (sem prova do teto de ontem): não sobe');
  ok(!decidirRampa({ ...b, marca: null, enviadosDiaAnterior: 99 }).gravar, 'sem marca nenhuma: não sobe, só marca o dia');

  // 5. texto do worker e do testar-bloqueio
  const wsrc2 = readFileSync(fileURLToPath(new URL('./worker.mjs', import.meta.url)), 'utf8');
  ok(/maxInstagramEfetivo\(\{ bloqueio: lerBloqueio\(\), historico: lerHistorico\(\)/.test(wsrc2) && /if \(CANAL === 'instagram'\) await garantirRebaixe\(\)/.test(wsrc2), 'worker.mjs: travas repete o rebaixe e limita a 5 sem a prova');
  ok(/const rebaixeOk = await garantirRebaixe\(\)/.test(wsrc2), 'worker.mjs: rampaDoDia repete o rebaixe pendente');
  ok(/rebaixado: false/.test(wsrc2) && /historico-bloqueio-/.test(wsrc2), 'worker.mjs: o bloqueio grava rebaixado:false e o histórico que não se apaga');
  ok(/gravarMarcaRampa\(relogioBRT\(\)\.dia, RAMPA_INICIAL, true\)/.test(wsrc2), 'worker.mjs: o dia do bloqueio fica marcado na marca da rampa');
  ok(/criado_em: criadoEm/.test(wsrc2) && /new Date\(p\.ms\)\.toISOString\(\)/.test(wsrc2), 'worker.mjs: o incerto pendente gravado depois leva a data em que a DM saiu');
  const ts2 = readFileSync(fileURLToPath(new URL('./testar-bloqueio.mjs', import.meta.url)), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
  const iPatch = ts2.indexOf("method: 'PATCH', headers: H,\n    body: JSON.stringify({\n      teto_manual");
  const iRm = ts2.indexOf("rmSync(fileURLToPath(new URL('./bloqueio-instagram.json'");
  const iOk = ts2.indexOf('if (!rr.ok) {');
  ok(iPatch > 0 && iOk > iPatch && iRm > iOk && /if \(!rr\.ok\) \{[\s\S]{0,400}return;/.test(ts2.replace(/\r\n/g, '\n')), 'testar-bloqueio.mjs: PATCH primeiro; se falhar, mantém o arquivo e sai; só com rr.ok apaga');
  ok(/historico-bloqueio-instagram\.json/.test(ts2) && !/rmSync\(fileURLToPath\(new URL\('\.\/historico/.test(ts2), 'testar-bloqueio.mjs: o histórico não é apagado no destrave');
}

console.log('\ncanal obrigatório');
ok(canalValido('instagram') && canalValido('whatsapp') && !canalValido(undefined) && !canalValido('') && !canalValido('x'), 'canalValido só aceita instagram ou whatsapp');
{
  // O worker sai ANTES de qualquer rede quando falta --canal (o exit está no topo do módulo).
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./worker.mjs', import.meta.url)), '--dry'], { encoding: 'utf8', timeout: 15000 });
  ok(r.status === 2 && /--canal/.test(r.stderr), 'node worker.mjs --dry (sem --canal) sai com código 2 e mensagem');
}

console.log('\nteto');
ok(tetoEfetivo('instagram', { teto: 12, usados: 0, restam: 12 }).restam === 10, 'Instagram: teto 12 do banco vira 10');
ok(tetoEfetivo('instagram', { teto: 12, usados: 10, restam: 7 }).restam === 0, 'Instagram: 10 enviados fecha o dia mesmo com restam=7 na view');
ok(tetoEfetivo('instagram', { teto: 3, usados: 1, restam: 2 }).restam === 2, 'Instagram: teto menor do banco continua valendo');
ok(tetoEfetivo('instagram', { teto: undefined, usados: undefined, restam: undefined }).restam === 0, 'Instagram: dado ausente = restam 0 (falha segura)');
ok(tetoEfetivo('whatsapp', { teto: 50, usados: 0, restam: 50 }).teto === 10, 'chip: teto máximo 10');

console.log('\nfila única entre os canais');
const dias = d => new Date(Date.now() - d * 86400_000).toISOString();
const t = (canalObs, d, resultado = 'enviei') => ({ resultado, obs: canalObs, consultor: 'x', criado_em: dias(d) });
ok(avaliarToques([], 'instagram').ok, 'sem toque: libera');
ok(!avaliarToques([t('worker instagram', 20)], 'instagram').ok, 'já recebeu por instagram: não manda a 2ª fria no mesmo canal');
ok(!avaliarToques([t('worker instagram', 5)], 'whatsapp').ok, 'instagram há 5 dias: whatsapp espera 14');
ok(avaliarToques([t('worker instagram', 15)], 'whatsapp').ok, 'instagram há 15 dias sem retorno: whatsapp libera (2º toque)');
ok(!avaliarToques([t('worker instagram', 15), t('worker respondeu', 14, 'respondeu')], 'whatsapp').ok, 'quem respondeu não é abordado');
ok(!avaliarToques([t('', 30)], 'whatsapp').ok, 'toque de canal desconhecido: não aborda (falha segura)');
ok(!avaliarToques([t('worker instagram', 40), t('worker whatsapp', 20), t('worker instagram', 10)], 'whatsapp').ok, '3 toques em 60 dias: não aborda');
ok(!avaliarToques(null, 'whatsapp').ok, 'histórico ilegível: não aborda');

console.log('\nconta do WhatsApp');
ok(contaProibida(null) && contaProibida(''), 'número ilegível: bloqueia');
ok(contaProibida('5534998165040') && contaProibida('553498165040'), 'a linha 5040 é recusada (com e sem o 9)');
ok(!contaProibida('5511999990000'), 'número qualquer (chip) passa');

console.log('\nliga no laço (texto do worker.mjs)');
const src = readFileSync(fileURLToPath(new URL('./worker.mjs', import.meta.url)), 'utf8');
const iCalc = src.indexOf('espera = calcularEspera({ agora: new Date(), cfg: CFG, restam: t2.restam');
const iGrava = src.indexOf('proximaAbordagem = Date.now() + espera * 1000;');
ok(iCalc > 0 && iGrava > iCalc, 'worker.mjs: proximaAbordagem recebe a espera logo depois do cálculo');
ok(/if \(desfecho === 'enviou' \|\| desfecho === 'incerto'\) proximaAbordagem = Date\.now\(\) \+ CFG\.minSeg \* 1000;/.test(src), 'worker.mjs: o piso vale antes de qualquer leitura que possa estourar');
ok(!/Number\(process\.env\.(HORA_INI|HORA_FIM|MIN_SEG)/.test(src), 'worker.mjs: nenhuma env lida direto para janela ou piso');
ok(/podeEnviar\(new Date\(\), CFG\)/.test(src), 'worker.mjs: usa podeEnviar');
ok(!/10 \+ Math\.floor\(10 \* \(\(Date\.now\(\) % 997\)/.test(src) && /respiroAposFalha\(\(Date\.now\(\) % 997\) \/ 997\)/.test(src), 'worker.mjs: o respiro após falha é o de 300-600 s (respiroAposFalha), não 10-20 s');
ok(/let bloqueadaParaNovas = lerBloqueio\(\)\.bloqueado;/.test(src) && /gravarBloqueio\(/.test(src), 'worker.mjs: o bloqueio nasce do arquivo na partida e é gravado quando o detector dispara');
ok(/teto: teto\[0\]\?\.teto,\s/.test(src) && !/teto\[0\]\?\.teto \?\? 5/.test(src), 'worker.mjs: sem linha de teto não vira 5');
ok(/await decidirAgora\(\);\s*\n\s*if \(!dec\.enviar\)/.test(src), 'worker.mjs: umaAbordagem chama decidirAbordagem a cada abordagem (piso lido do banco e do arquivo)');
ok(/if \(!r\.ok\) throw new Error\(`prospeccao_toques/.test(src), 'worker.mjs: gravarToque lança em 4xx/5xx');
ok(/const obs = obsIncerto \|\| `worker \$\{CANAL\} incerto`;[\s\S]{0,200}'enviei', obs, true\)/.test(src), 'worker.mjs: envio incerto grava toque com a marca incerto (e as peças da abertura no Instagram)');
{
  const idx = [...src.matchAll(/await enviarWhatsApp\(/g)].map(m => m.index);
  const conferes = idx.map(i => src.lastIndexOf('await contaDoChipOk()', i));
  ok(idx.length === 2 && conferes.every((c, k) => c > 0 && idx[k] - c < 3500), 'worker.mjs: contaDoChipOk antes de CADA enviarWhatsApp (contínuo e avulso)');
  ok(src.indexOf("log('  conta do WhatsApp conferida") > 0, 'worker.mjs: o avulso confere a conta antes do laço');
}
ok(/if \(MODO === 'responder'\) \{[\s\S]{0,400}podeEnviar\(new Date\(\), CFG\)[\s\S]{0,400}return await modoResponder\(\)/.test(src), 'worker.mjs: --modo=responder confere a janela antes de modoResponder()');
ok(/pularNaSessao\.add\(alvoAtual\.id\);\s*\n\s*if \(alvoAtual\) await gravarIncerto/.test(src), 'worker.mjs: o catch põe alvoAtual.id em pularNaSessao antes de gravarIncerto');
ok(/tentouEnviar = false;\s*\n\s*alvoAtual = null;[\s\S]{0,400}\/\/ 1ª coisa: tentar gravar um toque pendente/.test(src), 'worker.mjs: umaAbordagem zera tentouEnviar e alvoAtual e resolve a pendência primeiro');
ok(!/ciclo % 20 === 0\) \{\s*\n\s*const s = await sessaoZap/.test(src), 'worker.mjs: a conta do chip não é mais conferida só a cada 20 voltas');


console.log('\n--- 09/11/2026: ritmo humano, freio e rampa honesta ---');
const textoWorker = readFileSync(fileURLToPath(new URL('./worker.mjs', import.meta.url)), 'utf8');

console.log('\nespera de 45 a 75 min, com o piso sempre por último');
{
  ok(ESPERA_MAX_SEG === 4500 && padrao.tetoEspera === 4500 && padrao.maxSeg === 4500 && padrao.minSeg === 2700, 'padrão: espera de 2700 a 4500 s (45 a 75 min)');
  const manha = em('2026-11-05T08:30:00');
  const folgado = [0, 0.25, 0.5, 0.75, 0.999].map(sorteio => calcularEspera({ agora: manha, cfg: padrao, restam: 5, sorteio }));
  ok(folgado[0] === 2700 && folgado[4] >= 4490 && folgado[4] <= 4500 && folgado.every(e => e >= 2700 && e <= 4500), 'dia folgado: o sorteio cobre de 45 a 75 min (' + folgado.join(', ') + ')');
  ok(new Set(folgado).size === 5, 'sorteios diferentes dão esperas diferentes (sem metrônomo)');
  const aperta = [0, 0.5, 0.999].map(sorteio => calcularEspera({ agora: em('2026-11-05T20:00:00'), cfg: padrao, restam: 9, sorteio }));
  ok(aperta.every(e => e === 2700), 'dia apertado (20h, 9 restando): sempre 2700 s');
  const meio = [0, 0.999].map(sorteio => calcularEspera({ agora: em('2026-11-05T14:00:00'), cfg: padrao, restam: 10, sorteio }));
  ok(meio[0] === 2700 && meio[1] === 2700, 'à tarde com 10 restando (42 min de ideal): encolhe para 2700');
  const justo = calcularEspera({ agora: em('2026-11-05T13:30:00'), cfg: padrao, restam: 8, sorteio: 0.999 });
  ok(justo > 2700 && justo <= 3375, 'sobra pouco (7,5 h úteis para 8): o teto do sorteio é o ideal (56 min), não os 75: deu ' + justo);
  let menor = Infinity;
  for (const cfg of [padrao, cfgDe({ MIN_SEG: '10', MAX_SEG: '20', TETO_ESPERA: '30' })]) {
    for (const hh of ['08:00', '09:13', '11:40', '12:10', '13:30', '15:00', '20:30']) {
      for (const restam of [0, 1, 3, 10, 40]) {
        for (const sorteio of [0, 0.1, 0.5, 0.9, 0.999, NaN, undefined]) {
          const agora = em('2026-11-05T' + hh + ':00');
          const e = calcularEspera({ agora, cfg, restam, sorteio, jitter: 0.75 });
          menor = Math.min(menor, e);
          const alvo = ajustarInstante(agora.getTime() + e * 1000, 0.3);
          menor = Math.min(menor, (alvo - agora.getTime()) / 1000);
        }
      }
    }
  }
  ok(menor >= 2700, 'nenhuma espera nem instante-alvo (com almoço e minuto ajustados) abaixo de 2700 s; menor: ' + menor);
  ok(/Math\.max\(cfg\.minSeg, bruto\)/.test(readFileSync(fileURLToPath(new URL('./ritmo.mjs', import.meta.url)), 'utf8')), 'ritmo.mjs: o Math.max(minSeg) continua sendo a última operação de calcularEspera');
  ok(/sorteio: Math\.random\(\) \}\);/.test(textoWorker), 'worker.mjs: a espera do laço é sorteada');
}

console.log('\nalmoço de 12h00 às 13h30 (BRT), descontado do tempo útil');
{
  ok(!emAlmoco(em('2026-11-05T11:59:59')) && emAlmoco(em('2026-11-05T12:00:00')) && emAlmoco(em('2026-11-05T13:29:59')) && !emAlmoco(em('2026-11-05T13:30:00')), 'almoço vale de 12h00 a 13h29 e acaba às 13h30');
  ok(emAlmoco(new Date('2026-11-05T15:00:00Z')) && !emAlmoco(new Date('2026-11-05T11:00:00Z')), 'o relógio da máquina em UTC é lido em Brasília (15:00Z = 12:00 BRT)');
  const fim = em('2026-11-05T21:00:00');
  ok(segUteisAte(em('2026-11-05T08:00:00'), fim) === 13 * 3600 - 5400, 'de 8h às 21h: 13 h menos 1h30 de almoço');
  ok(segUteisAte(em('2026-11-05T12:30:00'), fim) === 8.5 * 3600 - 3600, 'começando no meio do almoço (12h30) desconta só o que falta dele (1 h)');
  ok(segUteisAte(em('2026-11-05T14:00:00'), fim) === 7 * 3600, 'depois do almoço nada é descontado');
  const d = (hh, extra = {}) => decidirAbordagem({ agora: em('2026-11-05T' + hh), cfg: padrao, restam: 5, banco: { ok: true, ms: null }, arquivo: arquivoUltimo(null), ...extra });
  ok(!d('12:00:00').enviar && d('12:00:00').motivo === 'almoco', 'decidirAbordagem: 12h00 é almoço, não envia');
  ok(!d('13:29:59').enviar && d('13:29:59').motivo === 'almoco', 'decidirAbordagem: 13h29 ainda é almoço');
  ok(d('13:30:00').enviar && d('11:59:59').enviar, 'decidirAbordagem: 11h59 e 13h30 liberam');
  ok(podeEnviar(em('2026-11-05T12:30:00'), padrao), 'o podeEnviar não muda (o responder do WhatsApp continua na janela de 8h-21h)');
  const ra = relogioBRT(new Date(ajustarInstante(em('2026-11-05T12:20:00').getTime(), 0)));
  ok(ra.hora === 13 && ra.min === 31, 'alvo às 12h20 vai para 13h31 (13h30 empurrado 1 min para sair do minuto 0): ' + ra.hora + ':' + ra.min);
  ok(/\['piso', 'almoco', 'inicio'\]\.includes\(dec\.motivo\)/.test(textoWorker), 'worker.mjs: almoço e início do dia esperam como o piso (sem abrir perfil)');
}

console.log('\nprimeiro envio do dia entre 8h10 e 9h30, minuto nunca 0/5');
{
  let todosDentro = true, nenhum05 = true; const difere = new Set();
  for (let i = 0; i < 400; i++) {
    const dia = new Date(Date.UTC(2026, 10, 1 + (i % 60))).toISOString().slice(0, 10);
    const ms = inicioDoDia(dia, 'irmaosnaobra__' + (i % 7));
    const r = relogioBRT(new Date(ms)); const m = r.hora * 60 + r.min;
    if (r.dia !== dia || m < 8 * 60 + 10 || m >= 9 * 60 + 30) todosDentro = false;
    if (r.min % 5 === 0) nenhum05 = false;
    difere.add(m);
  }
  ok(todosDentro, 'em 400 sorteios, o 1º envio cai sempre entre 8h10 e 9h29');
  ok(nenhum05, 'o minuto do 1º envio nunca termina em 0 ou 5');
  ok(difere.size > 20, 'o horário varia de um dia para outro (' + difere.size + ' minutos diferentes)');
  ok(inicioDoDia('2026-11-10', 'x') === inicioDoDia('2026-11-10', 'x'), 'o horário do dia é estável (reinício no meio da manhã não sorteia outro)');
  const ini = inicioDoDia('2026-11-10', 'irmaosnaobra__');
  const dec = (ms, extra = {}) => decidirAbordagem({ agora: new Date(ms), cfg: padrao, restam: 10, sorteioDia: 'irmaosnaobra__', banco: { ok: true, ms: null }, arquivo: arquivoUltimo(null), ...extra });
  ok(!dec(em('2026-11-10T08:00:00').getTime()).enviar && dec(em('2026-11-10T08:00:00').getTime()).motivo === 'inicio', 'sem envio hoje, às 8h00 não manda');
  ok(!dec(ini - 1000).enviar && dec(ini - 1000).motivo === 'inicio', '1 s antes do horário sorteado não manda');
  ok(dec(ini).enviar, 'no horário sorteado manda');
  const ontem = em('2026-11-09T15:00:00').getTime();
  ok(dec(em('2026-11-10T08:00:00').getTime(), { banco: { ok: true, ms: ontem } }).motivo === 'inicio', 'o último envio foi ONTEM: hoje ainda é o 1º do dia');
  ok(dec(em('2026-11-10T09:45:00').getTime(), { banco: { ok: true, ms: em('2026-11-10T08:50:00').getTime() } }).enviar, 'já enviou hoje (8h50): a regra do 1º envio não atrapalha, vale o piso');
  ok(dec(em('2026-11-10T08:00:00').getTime(), { sorteioDia: undefined }).enviar, 'sem sorteioDia a regra fica desligada (WhatsApp e testes antigos)');
  ok(/sorteioDia: CANAL === 'instagram' \? CFG\.consultor : undefined/.test(textoWorker), 'worker.mjs: o Instagram passa o sorteioDia para decidirAbordagem');
}

console.log('\nminuto final nunca em 0 ou 5 (só para frente)');
{
  let ok05 = true, soFrente = true, ate4 = true;
  const base = em('2026-11-05T09:00:00').getTime();
  for (let seg = 0; seg < 3600; seg += 7) {
    for (const f of [0, 0.3, 0.6, 0.999]) {
      const ms = base + seg * 1000;
      const aj = ajustarInstante(ms, f);
      if (relogioBRT(new Date(aj)).min % 5 === 0) ok05 = false;
      if (aj < ms) soFrente = false;
      if (aj - ms > 4 * 60_000) ate4 = false;
    }
  }
  ok(ok05, 'o instante-alvo ajustado nunca termina em 0 ou 5');
  ok(soFrente, 'nunca empurra para trás');
  ok(ate4, 'empurra no máximo 4 min');
  ok(ajustarInstante(em('2026-11-05T09:07:20').getTime(), 0.5) === em('2026-11-05T09:07:20').getTime(), 'minuto 7 fica como está');
  ok(ajustarInstante(em('2026-11-05T09:10:20').getTime(), 0) === em('2026-11-05T09:11:20').getTime(), 'minuto 10 vai 1 min para a frente (frac 0)');
  ok(ajustarInstante(em('2026-11-05T09:15:20').getTime(), 0.999) === em('2026-11-05T09:19:20').getTime(), 'minuto 15 vai 4 min para a frente (frac 0.999)');
  ok(esperaParaMinutoBom(em('2026-11-05T09:07:20').getTime(), 0.5) === 0, 'antes do Enter: minuto 7 envia já');
  const e = esperaParaMinutoBom(em('2026-11-05T09:20:30').getTime(), 0.5);
  ok(e >= 60_000 && e <= 240_000 && relogioBRT(new Date(em('2026-11-05T09:20:30').getTime() + e)).min % 5 !== 0, 'antes do Enter: minuto 20 espera de 1 a 4 min e cai em minuto bom');
  let todos = true;
  for (let m = 0; m < 60; m++) for (const f of [0, 0.5, 0.999]) {
    const ms = em('2026-11-05T10:' + String(m).padStart(2, '0') + ':10').getTime();
    if (relogioBRT(new Date(ms + esperaParaMinutoBom(ms, f))).min % 5 === 0) todos = false;
  }
  ok(todos, 'esperaParaMinutoBom: nos 60 minutos da hora, o Enter nunca cai em 0 ou 5');
  ok(/esperaParaMinutoBom\(Date\.now\(\), Math\.random\(\)\);\s*\n\s*const quando = new Date\(Date\.now\(\) \+ esp\);\s*\n\s*if \(!podeEnviar\(quando, CFG\) \|\| emAlmoco\(quando\)\) \{/.test(textoWorker), 'worker.mjs: a janela e o almoço são conferidos SEMPRE no instante do Enter (fora do if da espera)');
  ok(/esperaParaMinutoBom\(Date\.now\(\), Math\.random\(\)\);[\s\S]{0,1200}await aba\.enviar\('Input\.dispatchKeyEvent', \{ type: 'keyDown', key: 'Enter'/.test(textoWorker), 'worker.mjs: a espera do minuto 0/5 vem logo antes do Enter');
  ok(/proximaAbordagem = ajustarInstante\(proximaAbordagem, Math\.random\(\)\)/.test(textoWorker), 'worker.mjs: o alvo do próximo envio sai do almoço e do minuto 0/5');
}

console.log('\ndigitação e rolagem humanas');
{
  let sem = 4242; const rnd = () => (sem = (sem * 1103515245 + 12345) % 2147483648) / 2147483648;
  const plano = planoDigitacao(400, rnd);
  ok(plano.length === 400 && plano.every(p => p.atraso >= 60 && p.atraso <= 220), 'atraso por caractere sempre de 60 a 220 ms');
  const pausas = plano.map((p, i) => ({ ...p, i })).filter(p => p.pausa > 0);
  ok(pausas.length >= 8 && pausas.every(p => p.pausa >= 1000 && p.pausa <= 3000), 'pausas longas de 1 a 3 s (' + pausas.length + ' em 400 caracteres)');
  const dist = pausas.slice(1).map((p, k) => p.i - pausas[k].i);
  ok(dist.every(x => x >= 15 && x <= 40), 'uma pausa a cada 15 a 40 caracteres');
  ok(new Set(plano.map(p => p.atraso)).size > 50, 'o atraso varia de verdade');
  let dentro = true;
  for (let i = 0; i < 300; i++) { const x = duracaoRolagemMs(rnd); if (x < 4000 || x > 12000) dentro = false; }
  ok(dentro, 'a rolagem dura de 4 a 12 s');
  const tot = duracaoRolagemMs(rnd); const ps = passosRolagem(tot, rnd);
  ok(ps.reduce((s, p) => s + p.pausaMs, 0) === tot && ps.length >= 3, 'os passos de rolagem somam exatamente a duração sorteada (' + ps.length + ' passos)');
  ok(/await aba\.digitarHumano\(msg\);/.test(textoWorker) && /abrirConversa\(aba, handle, 'instagram', \{ rolar: true \}\)/.test(textoWorker) && /if \(rolar\) await aba\.rolarPerfil\(\);/.test(textoWorker), 'worker.mjs: o envio frio do Instagram rola o perfil e digita no ritmo humano');
  ok(/async digitar\(texto\) \{\s*\n\s*for \(const ch of texto\) \{\s*\n\s*await this\.enviar\('Input\.insertText', \{ text: ch \}\);\s*\n\s*await dorme\(18 \+/.test(textoWorker), 'worker.mjs: o digitar antigo (WhatsApp, bolhas) continua como era');
}

console.log('\nfreio: "ficou na caixa" conta, e só conversa nova zera');
{
  ok(contaParaFreio('caixa de DM não abriu (em x). Tela dizia: "..."') && contaParaFreio('texto ficou na caixa — não saiu') && contaParaFreio('x não saiu'), 'os dois sintomas contam: caixa não abriu e texto que ficou na caixa');
  ok(!contaParaFreio('perfil não carregou') && !contaParaFreio('perfil não existe mais (ou foi renomeado)') && !contaParaFreio('a espera do minuto 0/5 passaria da janela; nada saiu') && !contaParaFreio(undefined), 'perfil que não carrega ou não existe não conta');
  const perfis = new Set();
  const m = 'texto ficou na caixa — não saiu';
  ok(!registrarFalhaCaixa(perfis, 'a', m).liga && !registrarFalhaCaixa(perfis, 'a', m).liga, 'o MESMO perfil duas vezes conta uma só');
  ok(!registrarFalhaCaixa(perfis, 'b', m).liga, '2 perfis distintos: ainda não liga');
  const r3 = registrarFalhaCaixa(perfis, 'c', m);
  ok(r3.liga && r3.perfis === 3 && LIMITE_PERFIS_FREIO === 3, '3 perfis distintos com "ficou na caixa": LIGA o freio');
  const mix = new Set();
  registrarFalhaCaixa(mix, 'p1', 'caixa de DM não abriu (em x)');
  registrarFalhaCaixa(mix, 'p2', 'texto ficou na caixa — não saiu');
  ok(registrarFalhaCaixa(mix, 'p3', 'caixa de DM não abriu (em y)').liga, 'caixa não abriu + ficou na caixa + caixa não abriu: o mesmo contador, liga no 3º');
  const c = new Set(['a', 'b']);
  ok(aposEnvioConfirmado(c, { conversaAntiga: true }) === false && c.size === 2, 'envio confirmado numa conversa ANTIGA não zera o contador');
  ok(aposEnvioConfirmado(c, { conversaAntiga: null }) === false && c.size === 2, 'conversa que não deu para medir (null) também não zera');
  ok(aposEnvioConfirmado(c, {}) === false && c.size === 2, 'sem a medida: não zera');
  ok(aposEnvioConfirmado(c, { conversaAntiga: false }) === true && c.size === 0, 'envio confirmado numa conversa NOVA zera o contador');
  ok(/registrarFalhaCaixa\(caixaNaoAbriuEm, c\.instagram, r\.motivo\)/.test(textoWorker) && /aposEnvioConfirmado\(caixaNaoAbriuEm, \{ conversaAntiga: r\.conversaAntiga \}\)/.test(textoWorker), 'worker.mjs: usa as duas regras (contar a falha, zerar só com conversa nova)');
  ok(/const conversaAntiga = \(linhas1 > 0 \|\| linhas2 > 0\) \? true\s*\n\s*: \(linhas1 === 0 && linhas2 === 0\) \? false : null;/.test(textoWorker) && /await dorme\(1500\);\s*\n\s*const linhas1 = await contarLinhas\(\);\s*\n\s*await dorme\(1000\);\s*\n\s*const linhas2/.test(textoWorker) && /\{ ok: true, conversaAntiga \} : \{ ok: false, motivo: 'texto ficou na caixa/.test(textoWorker), 'worker.mjs: o envio mede a conversa antes de digitar e devolve conversaAntiga');
  ok(!/caixaNaoAbriu = 0;\s*\/\/ uma que sai limpa zera a suspeita/.test(textoWorker), 'worker.mjs: o envio confirmado não zera mais sem olhar a conversa');
}

console.log('\nenvio incerto não conta como confirmado (rampa e dia limpo)');
{
  const tq = (obs, resultado = 'enviei') => ({ resultado, obs });
  ok(ehIncerto('worker instagram incerto v=A s=1 a=1 p=1') && ehIncerto('worker instagram incerto pendente') && !ehIncerto('worker instagram v=A s=1 a=1 p=1') && !ehIncerto(null), 'ehIncerto reconhece a marca');
  const dia06 = [tq('worker instagram incerto'), tq('worker instagram incerto v=A s=3 a=2 p=1'), tq('worker instagram incerto v=B s=3 a=1 p=4')];
  ok(enviosConfirmados(dia06) === 0, '06/11: 3 toques incertos = ZERO confirmados (o log dizia "3 envios")');
  ok(enviosConfirmados([...dia06, tq('worker instagram v=A s=1 a=1 p=1'), tq('worker instagram v=B s=4 a=3 p=2'), tq('x', 'respondeu')]) === 2, 'só os sem a marca contam (2), e resultado diferente de enviei fica de fora');
  ok(enviosConfirmados(null) === 0 && enviosConfirmados([]) === 0, 'lista ilegível ou vazia = 0');
  const base = { hoje: '2026-11-10', marca: { dia: '2026-11-09', teto: 5, bloqueio: false }, atualizadoDia: null, atualManual: 5, bloqueado: false };
  const ontem = [...Array(3)].map(() => tq('worker instagram v=A s=1 a=1 p=1')).concat([tq('worker instagram incerto v=A s=1 a=1 p=2'), tq('worker instagram incerto v=B s=1 a=1 p=2')]);
  ok(decidirRampa({ ...base, enviadosDiaAnterior: ontem.length }).gravar === true, 'contando tudo (5 de 5) a rampa SUBIRIA (o erro antigo)');
  ok(!decidirRampa({ ...base, enviadosDiaAnterior: enviosConfirmados(ontem) }).gravar, 'contando só os confirmados (3 de 5) a rampa NÃO sobe');
  ok(decidirRampa({ ...base, enviadosDiaAnterior: enviosConfirmados([...ontem, tq('worker instagram v=A s=2 a=2 p=2'), tq('worker instagram v=B s=2 a=2 p=2')]) }).novo === 6, '5 confirmados de 5: sobe para 6');
  ok(/select=id,resultado,obs[^`]*resultado=eq\.enviei/.test(textoWorker) && /enviosConfirmados\(toquesOntem\)/.test(textoWorker) && /enviadosDiaAnterior: env\.length/.test(textoWorker), 'worker.mjs: rampaDoDia lê o obs e conta só confirmados');
  const pend = arquivoUltimo('{"ms":1,"pendente_gravar":{"id":"x","ms":5,"obs":"worker instagram incerto v=A s=1 a=1 p=1"}}').pendente;
  ok(pend && pend.obs === 'worker instagram incerto v=A s=1 a=1 p=1', 'a pendência guarda o obs do contrato (arquivoUltimo repassa)');
  ok(arquivoUltimo('{"ms":1,"pendente_gravar":{"id":"x","ms":5}}').pendente.obs === null, 'pendência antiga, sem obs, continua legível');
  ok(/gravarIncerto\(alvoAtual\.id, alvoAtual\.pid, alvoAtual\.obsIncerto\)/.test(textoWorker) && /alvoAtual = \{ id: c\.id, pid, obsIncerto, instagram: /.test(textoWorker) && /p\.obs \|\| `worker \$\{CANAL\} incerto pendente`/.test(textoWorker), 'worker.mjs: todo caminho de incerto (retorno, catch do laço, pendência) leva o obs com as peças');
}

console.log('\nbusca de @ por /web/search saiu de vez');
{
  ok(!/web\/search|topsearch/.test(textoWorker), 'worker.mjs: nenhuma chamada à busca de @ (web/search, topsearch)');
  ok(!/reabastecer\(|descobrir\(|sobramBuscas|gastarBusca/.test(textoWorker), 'worker.mjs: reabastecer, descobrir e o orçamento de busca não existem mais');
  ok(!/vou procurar mais endereço/.test(textoWorker), 'worker.mjs: o log da fila vazia não promete mais procurar @');
  ok(/escolherMensagem\(c, scripts, alegacoes, pid, preco\);\s*\n\s*if \(!escolhida\) \{ log\(`PULOU/.test(textoWorker) && (textoWorker.match(/await escolherMensagem\(/g) || []).length === 2, 'worker.mjs: os dois caminhos (contínuo e avulso) montam a mensagem por escolherMensagem');
  ok(/fazBloqueia\(alegacoes, pid\)/.test(textoWorker) && /const bloqueia = fazBloqueia\(alegacoes, produtoId\);/.test(textoWorker), 'worker.mjs: a trava de alegações vale para a abertura nova e para os scripts do WhatsApp');
}

console.log('\nresposta automática já tratada (não consulta a API de novo)');
{
  const T = em('2026-11-10T10:00:00').getTime();
  let mapa = lerTratadas(null, T);
  ok(!jaTratada(mapa, 'c1', 'Obrigado pelo contato! Em breve retornamos.'), 'sem marca: não está tratada');
  mapa = marcarTratada(mapa, 'c1', 'Obrigado pelo contato! Em breve retornamos.', T);
  ok(jaTratada(mapa, 'c1', 'Obrigado pelo contato! Em breve retornamos.'), 'depois de marcar: a mesma última mensagem do mesmo contato está tratada');
  ok(jaTratada(mapa, 'c1', '  Obrigado pelo contato!   Em breve retornamos. '), 'espaços a mais não mudam a chave');
  ok(!jaTratada(mapa, 'c1', 'Oi, quanto custa?'), 'mensagem NOVA do lead libera de novo');
  ok(!jaTratada(mapa, 'c2', 'Obrigado pelo contato! Em breve retornamos.'), 'o mesmo texto em OUTRO contato não vale');
  ok(chaveTratada('c1', 'x') === chaveTratada('c1', 'x') && chaveTratada('c1', 'x') !== chaveTratada('c1', 'y'), 'a chave é estável e depende do texto');
  const arq = JSON.stringify(mapa);
  ok(jaTratada(lerTratadas(arq, T + 6 * 86400_000), 'c1', 'Obrigado pelo contato! Em breve retornamos.'), 'no 6º dia a marca ainda vale (lida do arquivo)');
  ok(!jaTratada(lerTratadas(arq, T + (TRATADAS_DIAS * 86400_000) + 1000), 'c1', 'Obrigado pelo contato! Em breve retornamos.') && TRATADAS_DIAS === 7, 'depois de 7 dias a marca é podada');
  ok(Object.keys(marcarTratada(lerTratadas(arq, T), 'c9', 'y', T + 8 * 86400_000)).length === 1, 'ao marcar, o que passou de 7 dias sai do arquivo');
  ok(Object.keys(lerTratadas('lixo{', T)).length === 0 && Object.keys(lerTratadas('[1,2]', T)).length === 0 && Object.keys(lerTratadas('{"a":"x"}', T)).length === 0, 'arquivo ilegível ou com valor inválido = vazio (sem quebrar)');
  ok(/if \(jaTratada\(lerTratadasArq\(\), c\.contato_id, hist\[hist\.length - 1\]\.texto\)\) \{ semNovidade\+\+; continue; \}/.test(textoWorker) && (textoWorker.match(/marcarTratadaArq\(c\.contato_id/g) || []).length === 2 && /Respostas automáticas já tratadas/.test(textoWorker), 'worker.mjs: modoResponder e responderZap pulam a mensagem já tratada ANTES da API e marcam quando vem nao_enviar');
}

console.log(`\n${n - falhas}/${n} verificações ok${falhas ? ` · ${falhas} FALHOU` : ''}`);
process.exit(falhas ? 1 : 0);
