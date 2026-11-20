/**
 * Apps Script da planilha "CONTRATOS FECHADOS" (aba "Clientes Geral"), 19/11/2026.
 * Recebe o POST da API do SolarDoc (api/src/services/gerador/planilhaEnvio.ts) e escreve SÓ as células vazias da linha da venda.
 *
 * COMO LIGAR (uma vez, feito pelo dono):
 *   1. Na planilha: Extensões > Apps Script. Cole este arquivo inteiro no Código.gs.
 *   2. Configurações do projeto > Propriedades do script > Adicionar: nome SEGREDO, valor = um segredo novo e longo (não escreva o valor em arquivo nenhum).
 *   3. Implantar > Nova implantação > Tipo: App da Web. Executar como: Eu. Quem tem acesso: Qualquer pessoa (o segredo é a trava).
 *   4. Copie o endereço /exec e ponha na Vercel do projeto da API, com o MESMO segredo do passo 2:
 *        PLANILHA_SCRIPT_URL      = o endereço /exec
 *        PLANILHA_SCRIPT_SEGREDO  = o segredo do passo 2
 *      (env nova só vale com redeploy da API)
 *
 * O QUE ELE FAZ
 *   - Confere o segredo (Script Properties). Segredo errado: { ok: false, erro: "nao_autorizado" } e nada é escrito.
 *   - A linha é código + 1. Confere que a coluna A da linha é o código; se não for, procura o código na coluna A inteira.
 *   - Escreve SÓ célula vazia. Célula com valor, coluna interna ou coluna desconhecida: pulada, com o motivo.
 *   - Responde { ok, linha, gravadas: ["F", ...], puladas: [{ coluna, motivo }] }.
 */

var ABA = 'Clientes Geral';
// Colunas que nenhuma venda escreve (interno): consultor, origem do lead, recebido, depoimento, datas de material e montagem, status, outro equip, obs.
var INTERNAS = ['A', 'D', 'E', 'H', 'I', 'K', 'P', 'Q', 'R', 'S', 'W', 'AA', 'AC', 'AD', 'AG'];

function colunaNumero_(c) {
  var n = 0;
  for (var i = 0; i < c.length; i++) n = n * 26 + (c.charCodeAt(i) - 64);
  return n;
}

function interna_(c) {
  return INTERNAS.indexOf(c) >= 0 || colunaNumero_(c) >= colunaNumero_('AQ');   // AQ em diante: custos, kit, comissão, lucro
}

function codigoDaCelula_(v) {
  var m = /(\d+)/.exec(String(v));
  return m ? parseInt(m[1], 10) : null;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function acharLinha_(sheet, codigo) {
  var esperada = codigo + 1;
  if (esperada <= sheet.getLastRow() && codigoDaCelula_(sheet.getRange(esperada, 1).getValue()) === codigo) return esperada;
  var colunaA = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1).getValues();
  for (var i = 0; i < colunaA.length; i++) {
    if (codigoDaCelula_(colunaA[i][0]) === codigo) return i + 1;
  }
  return null;
}

// Texto que começa com = + - ou @ viraria fórmula: a apóstrofe na frente força texto.
function textoSeguro_(v) {
  var texto = String(v);
  return /^[=+\-@]/.test(texto) ? "'" + texto : texto;
}

function valorDaCelula_(c) {
  if (c.tipo === 'numero') return Number(c.valor);
  if (c.tipo === 'data') {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(c.valor));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : textoSeguro_(c.valor);
  }
  return textoSeguro_(c.valor);
}

function doPost(e) {
  try {
    var corpo = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var segredo = PropertiesService.getScriptProperties().getProperty('SEGREDO');
    if (!segredo || corpo.segredo !== segredo) return json_({ ok: false, erro: 'nao_autorizado' });
    var codigo = parseInt(corpo.codigo, 10);
    if (!codigo || codigo < 1) return json_({ ok: false, erro: 'codigo_invalido' });
    var sheet = SpreadsheetApp.getActive().getSheetByName(ABA);
    if (!sheet) return json_({ ok: false, erro: 'aba_nao_achada' });

    var lock = LockService.getScriptLock();
    lock.waitLock(5000);   // a API desiste em 8 s: o script não pode esperar mais que isso
    try {
      var linha = acharLinha_(sheet, codigo);
      if (!linha) return json_({ ok: false, erro: 'linha_nao_achada' });
      var gravadas = [];
      var puladas = [];
      var celulas = Array.isArray(corpo.colunas) ? corpo.colunas : [];
      for (var i = 0; i < celulas.length; i++) {
        var c = celulas[i];
        var col = String(c.coluna || '').toUpperCase();
        if (!/^[A-Z]{1,2}$/.test(col) || interna_(col)) { puladas.push({ coluna: col, motivo: 'coluna_interna' }); continue; }
        var celula = sheet.getRange(col + linha);
        // Célula com fórmula é preenchida mesmo que o resultado seja vazio: nunca se sobrescreve a fórmula.
        if (celula.getFormula() !== '' || String(celula.getValue()) !== '') { puladas.push({ coluna: col, motivo: 'ja_preenchida' }); continue; }
        celula.setValue(valorDaCelula_(c));
        gravadas.push(col);
      }
      SpreadsheetApp.flush();
      return json_({ ok: true, linha: linha, gravadas: gravadas, puladas: puladas });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, erro: 'falha_interna' });
  }
}
