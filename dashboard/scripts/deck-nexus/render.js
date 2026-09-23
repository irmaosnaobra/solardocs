// Gera a apresentação a partir do index.html desta pasta.
//
// O nome dos PDFs sai do NOME DA PASTA de cima (Apresentacao-<Cliente>) — não fica
// cravado em lugar nenhum. Copiou a pasta para outro cliente, os arquivos saem certos.
//
//   cd "Desktop/<Cliente>/Apresentacao-<Cliente>/_fonte"
//   node render.js
//
// Saída — os PDFs vão para a PASTA DE CIMA, que é onde fica só o que está pronto:
//   ../<Pasta>.pdf          alta resolução (imprimir / projetar)
//   ../<Pasta>-leve.pdf     versão leve (WhatsApp / e-mail)
//   ../<Pasta>-celular.pdf  página em pé, para ler no telefone
// E aqui dentro fica o material de trabalho:
//   slides/slide-NN.png            1920x1080 (2880 no render), cada página avulsa
//   slides-celular/slide-NN.png    1080x1920, versão vertical
//
// Os PDFs são montados a partir dos PNGs, e não pelo page.pdf() do Chromium:
// os slides com desfoque viram bitmap gigante nesse caminho e o arquivo passa de
// 50 MB sem nenhum ganho visível.

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch {
  // puppeteer vive no repo CLAUDE; esta pasta não tem node_modules próprio
  puppeteer = require('C:/Users/55349/Desktop/CLAUDE/node_modules/puppeteer');
}

const DIR = __dirname;                    // _fonte
const OUT = path.resolve(DIR, '..');      // pasta da apresentação pronta
const NOME = path.basename(OUT);          // ex.: Apresentacao-Josevaldo

const PY = `
NOME = ${JSON.stringify(NOME)}
import fitz, glob, io, os
from PIL import Image
def build(nome, largura, q, pasta, pw, ph):
    doc = fitz.open()
    for f in sorted(glob.glob(pasta + '/*.png')):
        im = Image.open(f).convert('RGB')
        im.thumbnail((largura, largura), Image.LANCZOS)
        buf = io.BytesIO(); im.save(buf, 'JPEG', quality=q, optimize=True); buf.seek(0)
        doc.new_page(width=pw, height=ph).insert_image(fitz.Rect(0,0,pw,ph), stream=buf.read())
    # grava num temporário e só então troca o definitivo: se o PDF estiver aberto no
    # leitor, o Windows trava a troca — aí sobra o arquivo com prefixo _NOVO_ e o
    # aviso, em vez de perder a rodada inteira de render
    tmp = os.path.join(os.path.dirname(nome), '_NOVO_' + os.path.basename(nome))
    doc.save(tmp, deflate=True, garbage=4)
    tam = round(os.path.getsize(tmp)/1024/1024, 1)
    try:
        os.replace(tmp, nome)
        print(f'  {os.path.basename(nome)}  {tam} MB  ({doc.page_count} paginas)')
    except PermissionError:
        print(f'  !! {os.path.basename(nome)} esta ABERTO no leitor — a versao nova ficou '
              f'como {os.path.basename(tmp)} ({tam} MB). Feche o visualizador e rode de novo.')
build(os.path.join('..', NOME + '.pdf'), 2880, 92, 'slides', 1920, 1080)
build(os.path.join('..', NOME + '-leve.pdf'), 1920, 82, 'slides', 1920, 1080)
build(os.path.join('..', NOME + '-celular.pdf'), 1620, 84, 'slides-celular', 1080, 1920)
`;

(async () => {
  fs.mkdirSync(path.resolve(DIR, 'slides'), { recursive: true });
  fs.mkdirSync(path.resolve(DIR, 'slides-celular'), { recursive: true });

  const file = 'file://' + path.resolve(DIR, 'index.html').replace(/\\/g, '/');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files', '--font-render-hinting=none',
           // deck com muita foto estourava a memória do Chrome no passe vertical
           // e derrubava a sessão com "TargetCloseError: Target closed"
           '--disable-dev-shm-usage', '--disable-gpu'],
  });

  // Cada passe roda numa aba nova: a memória do compositor não acumula entre os dois,
  // que é o que matava o Chrome no meio do passe de celular.
  async function capturar(rotulo, largura, altura, pasta, movel) {
    const page = await browser.newPage();
    await page.setViewport({ width: largura, height: altura, deviceScaleFactor: 1.5 });
    await page.goto(file, { waitUntil: 'networkidle0', timeout: 120000 });
    if (movel) await page.evaluate(() => document.body.classList.add('movel'));
    await page.evaluateHandle('document.fonts.ready');
    await new Promise(r => setTimeout(r, movel ? 1200 : 1500));

    const slides = await page.$$('.slide');
    for (let i = 0; i < slides.length; i++) {
      await slides[i].screenshot({
        path: path.resolve(DIR, `${pasta}/slide-${String(i + 1).padStart(2, '0')}.png`),
      });
      await slides[i].dispose();
    }
    const n = slides.length;
    await page.close();
    console.log(`${n} slides capturados (${rotulo})`);
    return n;
  }

  await capturar('paisagem', 1920, 1080, 'slides', false);
  await capturar('celular', 1080, 1920, 'slides-celular', true);
  await browser.close();

  execFileSync('python', ['-c', PY], { cwd: DIR, stdio: 'inherit' });
  console.log(`PDFs gravados em ${OUT}`);
})();
