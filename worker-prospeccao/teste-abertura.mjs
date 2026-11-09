#!/usr/bin/env node
/* Teste da abertura do Instagram (abertura.mjs). Node puro, sem rede, sem Chrome, sem banco.
   Rode:  node teste-abertura.mjs
   Lê o worker.mjs só como texto (nunca o importa: ele liga o robô no import). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  SAUDACOES, APRESENTACOES, PERGUNTAS, saudacoesDaHora, saudacaoDoPeriodo, montarTexto, obsDe, lerObs, chaveDe,
  combosDaVersao, escolherVersao, chavesUsadas, escolherAbertura, totalDoContentRange, usaAberturaNova, nomeCurto, nomeCidade,
} from './abertura.mjs';
import { relogioBRT } from './ritmo.mjs';

let falhas = 0, n = 0;
const ok = (cond, nome) => { n++; if (!cond) { falhas++; console.log('  FALHOU: ' + nome); } else console.log('  ok  ' + nome); };
const em = iso => new Date(iso + '-03:00');
let sem = 99; const rnd = () => (sem = (sem * 1103515245 + 12345) % 2147483648) / 2147483648;

console.log('\nsaudação pela hora de Brasília (a máquina está em UTC)');
{
  const horaDe = iso => relogioBRT(new Date(iso)).hora;
  ok(saudacoesDaHora(horaDe('2026-11-09T11:00:00Z')).join() === '1,2,3', '08h BRT (11:00Z): Oi, Olá, Bom dia');
  ok(saudacaoDoPeriodo(horaDe('2026-11-09T14:59:00Z')) === 3, '11h59 BRT (14:59Z): Bom dia');
  ok(saudacaoDoPeriodo(horaDe('2026-11-09T15:00:00Z')) === 4, '12h00 BRT (15:00Z): Boa tarde');
  ok(saudacaoDoPeriodo(horaDe('2026-11-09T20:59:00Z')) === 4, '17h59 BRT (20:59Z): Boa tarde');
  ok(saudacaoDoPeriodo(horaDe('2026-11-09T21:00:00Z')) === 5, '18h00 BRT (21:00Z): Boa noite');
  ok(horaDe('2026-11-10T02:30:00Z') === 23 && saudacaoDoPeriodo(horaDe('2026-11-10T02:30:00Z')) === 5, '23h30 BRT (02:30Z do dia seguinte): Boa noite');
  ok(saudacaoDoPeriodo(0) === 3, '0h: Bom dia (de 0h a 11h59)');
  let tres = true, validas = true;
  for (let h = 0; h < 24; h++) {
    const l = saudacoesDaHora(h);
    if (l.length !== 3 || new Set(l).size !== 3) tres = false;
    if (!l.includes(1) || !l.includes(2)) validas = false;
  }
  ok(tres && validas, 'em cada uma das 24 horas valem 3 saudações, e "Oi," e "Olá," sempre entre elas');
  ok(SAUDACOES[1] === 'Oi,' && SAUDACOES[2] === 'Olá,' && SAUDACOES[3] === 'Bom dia,' && SAUDACOES[4] === 'Boa tarde,' && SAUDACOES[5] === 'Boa noite,', 'índices s: 1 Oi, 2 Olá, 3 Bom dia, 4 Boa tarde, 5 Boa noite');
  const t14 = escolherAbertura({ empresa: 'X', cidade: 'Y', hora: 14, versao: 'A', rnd });
  const t09 = escolherAbertura({ empresa: 'X', cidade: 'Y', hora: 9, versao: 'A', rnd });
  ok(/^(Oi|Olá|Boa tarde),/.test(t14.texto) && /^(Oi|Olá|Bom dia),/.test(t09.texto), 'a abertura escolhida às 14h só diz Oi/Olá/Boa tarde, e às 9h só Oi/Olá/Bom dia');
}

console.log('\nmontagem: texto exato e campo vazio');
{
  ok(montarTexto({ v: 'A', s: 3, a: 1, p: 1, empresa: 'Solar Norte', cidade: 'Belém' }) === 'Bom dia, aqui é da equipe do SolarDoc. Quantas horas por mês a Solar Norte gasta montando proposta, tempo que podia estar virando venda?', 'A1 com empresa: texto exato');
  ok(montarTexto({ v: 'A', s: 3, a: 1, p: 1, empresa: '', cidade: 'Belém' }) === 'Bom dia, aqui é da equipe do SolarDoc. Quantas horas por mês vocês gastam montando proposta, tempo que podia estar virando venda?', 'A1 sem empresa: usa a versão "sem"');
  ok(montarTexto({ v: 'B', s: 1, a: 4, p: 3, empresa: 'Solar Norte', cidade: 'Belém' }) === 'Oi, aqui quem escreve é da equipe do SolarDoc. Pra vocês aí em Belém, quem manda a proposta primeiro: vocês ou o concorrente?', 'B3 com cidade: texto exato');
  ok(montarTexto({ v: 'B', s: 2, a: 2, p: 3, empresa: 'Solar Norte', cidade: null }) === 'Olá, sou da equipe do SolarDoc. Quem manda a proposta primeiro pro cliente: vocês ou o concorrente?', 'B3 sem cidade (null): usa a versão "sem"');
  ok(montarTexto({ v: 'A', s: 1, a: 1, p: 1, empresa: '   ', cidade: 'X' }).includes('vocês gastam'), 'campo só com espaços conta como vazio');
  ok(montarTexto({ v: 'A', s: 1, a: 1, p: 9, empresa: 'X' }) === null && montarTexto({ v: 'C', s: 1, a: 1, p: 1 }) === null, 'peça inexistente devolve null, não texto quebrado');
}

console.log('\nnunca sai chave, quebra de linha, link nem preço');
{
  let ruim = 0, total = 0;
  const entradas = [
    { empresa: 'Solar Norte', cidade: 'Belém' }, { empresa: '', cidade: '' }, { empresa: null, cidade: undefined },
    { empresa: '  ', cidade: '  ' }, { empresa: '{empresa}', cidade: '{cidade}' }, { empresa: 'Sol {socio} LTDA', cidade: 'Sen. {Canedo}' },
    { empresa: 'X', cidade: '' }, { empresa: '', cidade: 'Y' },
  ];
  for (let h = 0; h < 24; h++) for (const v of ['A', 'B']) for (const combo of combosDaVersao(v, h)) for (const e of entradas) {
    const t = montarTexto({ ...combo, ...e }); total++;
    if (t === null || /[{}]/.test(t) || /\n/.test(t) || /https?:|www\.|R\$|\.com|\.app/i.test(t) || t.trim() !== t) ruim++;
  }
  ok(ruim === 0, `${total} textos montados (24 h x 96 combinações x 8 entradas): nenhum com "{", "}", quebra de linha, link ou preço`);
  ok(Object.values(PERGUNTAS.A).concat(Object.values(PERGUNTAS.B)).every(([com, sem_]) => !/[{}]/.test(sem_) && /\{(empresa|cidade)\}/.test(com)), 'a versão "sem" de cada pergunta não tem molde, e a "com" tem exatamente o seu');
  ok(Object.keys(APRESENTACOES).length === 4 && Object.keys(PERGUNTAS.A).length === 4 && Object.keys(PERGUNTAS.B).length === 4, '4 apresentações, 4 perguntas A, 4 perguntas B');
  const e = escolherAbertura({ empresa: '{empresa}', cidade: '{x', hora: 10, versao: 'B', rnd });
  ok(e && !/[{}]/.test(e.texto), 'empresa/cidade com chave dentro não vazam chave');
}

console.log('\ncontrato do obs');
{
  const RE = /^worker instagram v=[AB] s=[1-5] a=[1-4] p=[1-4]$/;
  const REI = /^worker instagram incerto v=[AB] s=[1-5] a=[1-4] p=[1-4]$/;
  let todos = true;
  for (let h = 0; h < 24; h++) for (const v of ['A', 'B']) for (const c of combosDaVersao(v, h)) {
    if (!RE.test(obsDe(c)) || !REI.test(obsDe(c, true)) || !obsDe(c).startsWith('worker instagram') || !obsDe(c, true).startsWith('worker instagram')) todos = false;
    const volta = lerObs(obsDe(c)); const voltaI = lerObs(obsDe(c, true));
    if (!volta || chaveDe(volta) !== chaveDe(c) || !voltaI || chaveDe(voltaI) !== chaveDe(c)) todos = false;
  }
  ok(todos, 'toda combinação gera "worker instagram v=<A|B> s=<1-5> a=<1-4> p=<1-4>" e a versão incerto, e dá para ler de volta');
  ok(obsDe({ v: 'B', s: 4, a: 2, p: 3 }) === 'worker instagram v=B s=4 a=2 p=3' && obsDe({ v: 'A', s: 1, a: 1, p: 1 }, true) === 'worker instagram incerto v=A s=1 a=1 p=1', 'formato exato, sem nada a mais');
  const ab = escolherAbertura({ empresa: 'X', cidade: 'Y', hora: 15, versao: 'B', rnd });
  ok(RE.test(ab.obs) && REI.test(ab.obsIncerto) && ab.combo.v === 'B' && ab.combo.s >= 1 && ab.combo.s <= 4, 'a abertura escolhida devolve obs e obsIncerto no contrato');
  ok(lerObs('worker instagram') === null && lerObs('worker instagram incerto') === null && lerObs(null) === null && lerObs('worker whatsapp') === null, 'obs antigo ou de outro canal não vira peça');
  // quem lê o obs hoje (ritmo.mjs e worker.mjs) continua enxergando o sufixo
  const canal = o => (/worker\s+instagram/.test(String(o).toLowerCase()) ? 'instagram' : 'x');
  ok(canal(obsDe({ v: 'A', s: 1, a: 1, p: 1 })) === 'instagram' && canal(obsDe({ v: 'A', s: 1, a: 1, p: 1 }, true)) === 'instagram' && /^worker /.test(obsDe({ v: 'B', s: 5, a: 4, p: 4 })), 'canalDoToque e o marcador do piso (/^worker /) continuam casando com o obs novo');
}

console.log('\nversão A/B pela contagem do banco');
{
  ok(escolherVersao(10, 3) === 'B' && escolherVersao(3, 10) === 'A', 'vai a versão com MENOS toques');
  ok(escolherVersao(5, 5) === 'A' && escolherVersao(0, 0) === 'A', 'empate vai a A');
  ok(escolherVersao(null, 3) === 'A' && escolherVersao(3, null) === 'A' && escolherVersao(undefined, undefined) === 'A', 'banco falhou (null/undefined): A');
  ok(escolherVersao(NaN, 2) === 'A' && escolherVersao(9, NaN) === 'A' && escolherVersao('7', 2) === 'A' && escolherVersao(-1, 2) === 'A', 'contagem ilegível (NaN, texto, negativa): A');
  // alternância: cada envio incrementa a contagem da versão escolhida
  let a = 0, b = 0; const seq = [];
  for (let i = 0; i < 10; i++) { const v = escolherVersao(a, b); seq.push(v); if (v === 'A') a++; else b++; }
  ok(seq.join('') === 'ABABABABAB', 'com contagem do banco a cada envio, as versões se alternam: ' + seq.join(''));
  // se uma versão ficou para trás, ela recupera antes de alternar
  ok(escolherVersao(7, 2) === 'B' && escolherVersao(7, 6) === 'B' && escolherVersao(7, 7) === 'A', 'versão atrasada recupera até empatar');
  const w = readFileSync(fileURLToPath(new URL('./worker.mjs', import.meta.url)), 'utf8');
  ok(/async function versaoAgora\(\) \{\s*\n\s*try \{[\s\S]{0,300}escolherVersao\(a, b\);\s*\n\s*\} catch \(e\) \{[^\n]*return 'A'; \}/.test(w), 'worker.mjs: versaoAgora lê o banco e, se falhar, devolve A');
  ok(totalDoContentRange('0-0/57') === 57 && totalDoContentRange('*/0') === 0 && totalDoContentRange('0-0/0') === 0, 'content-range: "0-0/57" = 57, "*/0" = 0 (conjunto vazio, qualquer status)');
  ok(totalDoContentRange('0-0/*') === null && totalDoContentRange('') === null && totalDoContentRange(null) === null && totalDoContentRange('lixo') === null, 'content-range ilegível ("0-0/*", vazio, null, lixo): null');
  ok(escolherVersao(totalDoContentRange('0-0/57'), totalDoContentRange('*/0')) === 'B' && escolherVersao(totalDoContentRange('0-0/*'), 3) === 'A' && escolherVersao(3, totalDoContentRange('')) === 'A', 'B com zero toques (*/0) recebe o primeiro; total ilegível vai a A');
  ok(/&limit=1\`;\s*\n\s*const r = await fetch\(q, \{ headers: \{ \.\.\.H, Prefer: 'count=exact' \} \}\);/.test(w) && !/Range: '0-0'/.test(w) && /totalDoContentRange\(r\.headers\.get\('content-range'\)\)/.test(w), 'worker.mjs: a contagem não usa Range (sem 416), usa limit=1 e lê o content-range de qualquer status');
  ok(/Prefer: 'count=exact'/.test(w) && /obs=like\.\*\$\{encodeURIComponent\(`v=\$\{versao\} s=`\)\}\*/.test(w), 'worker.mjs: a contagem é exata (content-range), não puxa linhas, e pega também o incerto');
  ok(!/let (contadorVersao|versaoAtual|ultimaVersao)\b/.test(w) && !/% limpos\.length/.test(w.split('async function escolherMensagem')[1] || ''), 'worker.mjs: nenhum contador de versão em memória; a escolha por empresa.length % n não vale para o Instagram');
}

console.log('\nnenhuma repetição no mesmo dia, na mesma conta');
{
  for (const hora of [9, 14, 20]) for (const versao of ['A', 'B']) {
    const usadas = new Set(); const textos = new Set(); let repetiu = false;
    const total = combosDaVersao(versao, hora).length;
    for (let i = 0; i < total; i++) {
      const ab = escolherAbertura({ empresa: 'Solar Norte', cidade: 'Belém', hora, versao, usadas, rnd });
      if (!ab || ab.repetida || usadas.has(chaveDe(ab.combo)) || textos.has(ab.texto)) { repetiu = true; break; }
      usadas.add(chaveDe(ab.combo)); textos.add(ab.texto);
    }
    ok(!repetiu && usadas.size === total, `hora ${hora}, versão ${versao}: ${total} aberturas seguidas, todas diferentes`);
  }
  // o dia tem no máximo 10 envios: leitura do banco (obs do dia) alimenta o sorteio
  const doDia = ['worker instagram v=A s=1 a=1 p=1', 'worker instagram incerto v=A s=2 a=3 p=4', 'worker instagram v=B s=1 a=1 p=1', 'lixo'];
  const chaves = chavesUsadas(doDia);
  ok(chaves.size === 3 && chaves.has('A1' + '11') && chaves.has('A234') && chaves.has('B111'), 'os obs do dia (inclusive incerto) viram chaves usadas; lixo é ignorado');
  let repete = false;
  for (let i = 0; i < 300; i++) {
    const ab = escolherAbertura({ empresa: 'X', cidade: 'Y', hora: 10, versao: 'A', usadas: chaves, rnd });
    if (chaves.has(chaveDe(ab.combo))) repete = true;
  }
  ok(!repete, 'o sorteio evita as combinações que o banco diz que já saíram hoje (300 sorteios)');
  // tudo usado: repete (e avisa) em vez de travar
  const todas = new Set(combosDaVersao('A', 10).map(chaveDe));
  const forcada = escolherAbertura({ empresa: 'X', cidade: 'Y', hora: 10, versao: 'A', usadas: todas, rnd });
  ok(forcada && forcada.repetida === true, 'se as 48 combinações já saíram, repete uma e avisa (repetida: true) em vez de travar');
  // cada peça aparece no sorteio
  const vistas = { s: new Set(), a: new Set(), p: new Set(), v: new Set() };
  for (let i = 0; i < 600; i++) { const ab = escolherAbertura({ empresa: 'X', cidade: 'Y', hora: 15, versao: i % 2 ? 'A' : 'B', rnd }); for (const k of ['s', 'a', 'p', 'v']) vistas[k].add(ab.combo[k]); }
  ok(vistas.s.size === 3 && vistas.a.size === 4 && vistas.p.size === 4 && vistas.v.size === 2, 'o sorteio usa as 3 saudações da hora, as 4 apresentações, as 4 perguntas e as 2 versões');
}

console.log('\ntrava de alegações');
{
  const soB = t => /horas por mês/.test(t);   // a trava barra a versão A inteira
  const ab = escolherAbertura({ empresa: 'X', cidade: 'Y', hora: 10, versao: 'A', bloqueia: soB, rnd });
  ok(ab && ab.combo.v === 'B' && !soB(ab.texto), 'versão A toda barrada: cai para a B, e o texto que sai nunca é o barrado');
  ok(escolherAbertura({ empresa: 'X', cidade: 'Y', hora: 10, versao: 'A', bloqueia: () => true, rnd }) === null, 'tudo barrado: devolve null (o worker pula, não inventa)');
  let bateu = false;
  for (let i = 0; i < 200; i++) { const x = escolherAbertura({ empresa: 'X', cidade: 'Y', hora: 10, versao: 'B', bloqueia: t => /concorrente/.test(t) && /Aí em/.test(t), rnd }); if (/Aí em/.test(x.texto)) bateu = true; }
  ok(!bateu, 'combinação barrada nunca sai, as livres continuam saindo');
}

console.log('\nimportar o módulo não tem efeito colateral');
{
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import('${new URL('./abertura.mjs', import.meta.url).href}').then(m => { console.log(typeof m.escolherAbertura); })`], { encoding: 'utf8', timeout: 15000 });
  ok(r.status === 0 && r.stdout.trim() === 'function' && !r.stderr, 'import de abertura.mjs: só exporta, não liga nada');
}

console.log('\nabertura nova só para o SolarDoc no Instagram');
{
  ok(usaAberturaNova('instagram', 'solardoc') === true, 'instagram + solardoc: abertura nova');
  ok(usaAberturaNova('instagram', 'limpapro') === false && usaAberturaNova('instagram', undefined) === false && usaAberturaNova('instagram', null) === false && usaAberturaNova('instagram', '') === false, 'instagram + outro produto (ou sem produto): caminho antigo');
  ok(usaAberturaNova('whatsapp', 'solardoc') === false, 'whatsapp: caminho antigo');
  const w = readFileSync(fileURLToPath(new URL('./worker.mjs', import.meta.url)), 'utf8');
  ok(/if \(!usaAberturaNova\(CANAL, pid\)\) \{\s*\n\s*const msg = montarMensagem\(c, scripts, alegacoes, pid, preco\);\s*\n\s*return msg \? \{ msg, obs: .worker \$\{CANAL\}., obsIncerto: .worker \$\{CANAL\} incerto. \} : null;/.test(w), 'worker.mjs: outro produto cai em montarMensagem com os scripts do banco e o obs simples, como no origin/main');
  ok(w.split('resultado=eq.enviei&produto_id=eq.solardoc').length - 1 === 2, 'worker.mjs: a contagem A/B e os obs do dia só olham toques do produto solardoc');
}

console.log('\nnome curto da empresa e da cidade (sem slogan do perfil)');
{
  const casos = [
    ['H3 Solar - Excelência em Energia Solar', 'H3 Solar'],
    ['Imperio Solar® - Energias Renováveis', 'Imperio Solar'],
    ['Intti | Energia Solar Fotovoltaica para Residência, Empresa, Agronegócio e Usina de Investimento', 'Intti'],
    ['Energia solar em Goiânia - Solai Brasil Technology', null],
    ['SolarCorp Energia', 'SolarCorp Energia'],
    ['Alfa|Energia Solar', 'Alfa'],
    ['Beta – Energia Limpa', 'Beta'],
    ['Gama — Solar', 'Gama'],
    ['Delta · Solar', 'Delta'],
    ['Épsilon: Energia Solar', 'Épsilon'],
    ['Zeta / Energia', 'Zeta'],
    ['Sol Norte Ltda', 'Sol Norte'],
    ['Sol Norte LTDA ME', 'Sol Norte'],
    ['Sol Norte Eireli', 'Sol Norte'],
    ['Sol Norte S/A', 'Sol Norte'],
    ['Sol Norte S.A.', 'Sol Norte'],
    ['Sol Norte, Ltda.', 'Sol Norte'],
    ['Brilho ☀️ Solar ⚡', 'Brilho Solar'],
    ['Solar™ Max©', 'Solar Max'],
    ['  Solar   Norte  ', 'Solar Norte'],
    ['SOLAR NORTE', 'SOLAR NORTE'],
    ['solar norte', 'solar norte'],
    ['Energia Solar Fotovoltaica', null],
    ['Energia Solar Brasil', null],
    ['Energias Renováveis do Norte', null],
    ['Sistemas de Energia Solar', null],
    ['Nome Muito Grande Demais Para Frase', null],
    ['Uma Duas Tres Quatro Cinco', null],
    ['Abcdefghij Klmnopqrstuvwx', null],
    ['Abcdefghij Klmnopqrstuvw', 'Abcdefghij Klmnopqrstuvw'],
    ['Uma Duas Tres Quatro', 'Uma Duas Tres Quatro'],
    ['®', null], ['  ', null], ['', null], [null, null], [undefined, null], ['- Só slogan', null],
  ];
  for (const [entrada, esperado] of casos) ok(nomeCurto(entrada) === esperado, `nomeCurto(${JSON.stringify(entrada && entrada.length > 45 ? entrada.slice(0, 45) + '...' : entrada)}) = ${JSON.stringify(esperado)}`);

  ok(nomeCidade('Fortaleza - CE') === 'Fortaleza' && nomeCidade('Fortaleza/CE') === 'Fortaleza' && nomeCidade('Fortaleza, CE') === 'Fortaleza' && nomeCidade('Fortaleza – Ceará') === 'Fortaleza', 'cidade: "Fortaleza - CE", "/CE", ", CE" e "– Ceará" viram "Fortaleza"');
  ok(nomeCidade('Goiânia, Goiás') === 'Goiânia' && nomeCidade('São Paulo (SP)') === 'São Paulo' && nomeCidade('Rio de Janeiro RJ') === 'Rio de Janeiro', 'cidade: estado por extenso, (UF) e UF solta no fim saem');
  ok(nomeCidade('Sen. Canedo') === 'Sen. Canedo' && nomeCidade('Ji-Paraná') === 'Ji-Paraná' && nomeCidade('São José dos Campos') === 'São José dos Campos', 'cidade: nome com ponto, hífen sem espaço e várias palavras ficam como estão');
  ok(nomeCidade('') === null && nomeCidade(null) === null && nomeCidade('- CE') === null && nomeCidade('Uma Duas Tres Quatro Cinco Seis') === null, 'cidade vazia, só estado ou comprida demais: null');

  // a frase: usa o nome curto, ou cai na versão SEM nome
  const t1 = montarTexto({ v: 'A', s: 1, a: 1, p: 3, empresa: 'H3 Solar - Excelência em Energia Solar', cidade: 'Fortaleza - CE' });
  ok(t1 === 'Oi, aqui é da equipe do SolarDoc. Chutando, quantas horas por mês a H3 Solar gasta com proposta, tempo que podia ir pra fechar mais cliente?', 'a frase da versão A usa "a H3 Solar", sem o slogan');
  const t2 = montarTexto({ v: 'A', s: 1, a: 1, p: 3, empresa: 'Energia solar em Goiânia - Solai Brasil Technology', cidade: 'Goiânia' });
  ok(t2 === 'Oi, aqui é da equipe do SolarDoc. Chutando, quantas horas por mês vocês gastam com proposta, tempo que podia ir pra fechar mais cliente?', 'nome genérico: a mensagem usa a versão SEM nome ("vocês")');
  const t3 = montarTexto({ v: 'B', s: 2, a: 2, p: 1, empresa: 'X', cidade: 'Fortaleza - CE' });
  ok(t3 === 'Olá, sou da equipe do SolarDoc. Aí em Fortaleza, a proposta de vocês chega ao cliente antes ou depois da do concorrente?', 'a frase da versão B usa "Fortaleza", sem o "- CE"');
  ok(montarTexto({ v: 'B', s: 2, a: 2, p: 1, empresa: 'X', cidade: '- CE' }) === 'Olá, sou da equipe do SolarDoc. A proposta de vocês chega ao cliente antes ou depois da do concorrente?', 'cidade que sobra vazia: versão SEM cidade');
  let vaza = 0;
  for (const e of ['H3 Solar - Excelência em Energia Solar', 'Intti | Energia Solar Fotovoltaica para Residência, Empresa, Agronegócio e Usina de Investimento', 'Imperio Solar® - Energias Renováveis', 'Energia solar em Goiânia - Solai Brasil Technology']) {
    for (const v of ['A', 'B']) for (const c of combosDaVersao(v, 10)) { const t = montarTexto({ ...c, empresa: e, cidade: 'Fortaleza - CE' }); if (/ - |\||®|Excelência|Fotovoltaica para|Renováveis|- CE/.test(t)) vaza++; }
  }
  ok(vaza === 0, 'nenhuma das 4 empresas com slogan, em nenhuma das 96 combinações, vaza slogan, |, ® ou "- CE" para a mensagem');
}

console.log(`\n${n - falhas}/${n} verificações ok${falhas ? ` · ${falhas} FALHOU` : ''}`);
process.exit(falhas ? 1 : 0);
