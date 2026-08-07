
const puppeteer=require('puppeteer');const fs=require('fs');
const { PAGINAS } = require('C:/Users/55349/Desktop/CLAUDE/plugcash/aulas/aula-05-carga.js');
const p = PAGINAS.find(x=>x.titulo.includes('conta de luz'));
const html=`<html><head><meta charset=utf-8><style>
*{box-sizing:border-box;margin:0}
body{width:500px;height:760px;background:#F6F8F6;display:grid;place-items:center;font-family:Inter,Segoe UI,Arial,sans-serif}
.fone{width:376px;height:712px;background:#0A0A0A;border-radius:44px;padding:10px;box-shadow:0 22px 54px rgba(0,0,0,.26)}
.tela{width:100%;height:100%;background:#F5F5F5;border-radius:35px;overflow:hidden;position:relative;display:flex;flex-direction:column}
.notch{position:absolute;top:8px;left:50%;transform:translateX(-50%);width:104px;height:24px;background:#0A0A0A;border-radius:99px;z-index:5}
.top{height:58px;background:#1B2129;display:flex;align-items:flex-end;padding:0 15px 9px;gap:9px;flex:none}
.marca{display:flex;align-items:center;gap:7px;font-weight:800;font-size:15px;color:#fff}
.marca svg{width:20px;height:20px}.cash{color:#00C853}
.chip{margin-left:auto;font-size:8.5px;font-weight:800;letter-spacing:.06em;color:#00C853;border:1px solid #2E3742;border-radius:999px;padding:3px 8px}
.corpo{padding:14px 13px;flex:1;overflow:hidden}
.h1{font-size:17px;font-weight:800;letter-spacing:-.02em;line-height:1.2}
.sub{color:#6B6B6B;font-size:12px;margin:3px 0 12px}
.leitor{background:#fff;border:1px solid #D9D9D9;border-radius:15px;overflow:hidden}
.barra{height:3px;background:#F5F5F5}.barra i{display:block;height:100%;width:18%;background:#00C853}
.palco{padding:16px 14px 12px;display:flex;flex-direction:column;gap:11px}
.num{font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#009B40}
.tit{font-size:16px;font-weight:800;letter-spacing:-.02em;line-height:1.22}
.diag{background:#F5F5F5;border:1px solid #D9D9D9;border-radius:8px;padding:9px}
.diag svg{width:100%;height:auto;display:block}
.leg{font-size:10px;color:#6B6B6B;line-height:1.45}
.pe{display:flex;align-items:center;justify-content:space-between;padding:10px 13px;border-top:1px solid #D9D9D9;font-size:11px;color:#6B6B6B}
.btn{background:#00C853;color:#fff;padding:7px 12px;border-radius:9px;font-weight:700;font-size:11px}
.tab{height:60px;background:#1B2129;border-top:1px solid #2E3742;display:flex;flex:none}
.ti{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:9.5px;font-weight:600;color:#7E8794}
.ti.on{color:#00C853}
.ic{width:18px;height:18px;border:1.8px solid currentColor;border-radius:5px}
</style></head><body>
<div class=fone><div class=tela>
  <div class=notch></div>
  <div class=top>
    <span class=marca><svg viewBox='0 0 80 80'><rect width=80 height=80 rx=21 fill='#00C853'/><rect x=38.5 y=11 width=3.6 height=58 rx=1.8 fill='#fff'/><path d='M45 19 L27 51 L39 51 L36 69 L55 39 L42 39 Z' fill='#fff'/></svg><span><span style='color:#fff'>Plug</span><span class=cash>Cash</span></span></span>
    <span class=chip>BASE</span>
  </div>
  <div class=corpo>
    <div class=h1>Fundamentos do Eletroposto</div>
    <div class=sub>18% concluído · aula 5 de 14</div>
    <div class=leitor>
      <div class=barra><i></i></div>
      <div class=palco>
        <div class=num>Página 2 de 11</div>
        <div class=tit>${p.titulo}</div>
        <div class=diag>${p.svg}</div>
        <div class=leg>${p.legenda.slice(0,74)}…</div>
      </div>
      <div class=pe><span>Anterior</span><span>2 / 11</span><span class=btn>Próxima</span></div>
    </div>
  </div>
  <div class=tab>
    <span class=ti><span class=ic></span>Painel</span>
    <span class='ti on'><span class=ic></span>A trilha</span>
    <span class=ti><span class=ic></span>Serviços</span>
    <span class=ti><span class=ic></span>Conta</span>
  </div>
</div></div>
</body></html>`;
(async()=>{const b=await puppeteer.launch({headless:'new'});const pg=await b.newPage();
await pg.setViewport({width:500,height:760,deviceScaleFactor:2});
await pg.setContent(html,{waitUntil:'domcontentloaded'});
await pg.screenshot({path:'C:/Users/55349/Desktop/CLAUDE/dashboard/public/plugcash/img/mockup-celular.png'});
await b.close();
console.log('celular:',(fs.statSync('C:/Users/55349/Desktop/CLAUDE/dashboard/public/plugcash/img/mockup-celular.png').size/1024).toFixed(0)+' KB');})();
