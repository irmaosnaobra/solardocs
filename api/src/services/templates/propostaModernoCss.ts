// CSS do Moderno (propostaSolar, modelos 2 e 3): folhas A4 em pé, 794 x 1122 px cada, margem 0 no PDF.
// Uma cor só de destaque (a da empresa, --c1, já escurecida para texto branco por derivePalette); o resto é tinta,
// cinza e papel. Sem crase aqui dentro: este CSS mora num template literal.
import type { Palette } from '../propostaSolarBase';

export function cssModerno(p: Palette): string {
  return `:root{ --c1:${p.c1}; --c2:${p.c2}; --c3:${p.c3}; --ink:#12161E; --mut:#5B6472; --line:#E3E6EB; --soft:#F5F6F8; }
@page{ size:A4; margin:0; }
*,*::before,*::after{ box-sizing:border-box; margin:0; padding:0; }
html,body{ font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; color:var(--ink); background:#E9EBEF; -webkit-font-smoothing:antialiased; font-size:12.5px; line-height:1.5; }
body{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
::selection{ background:var(--c3); color:var(--c1); }
.num{ font-variant-numeric:tabular-nums; }
.page{ width:794px; min-height:1122px; margin:0 auto; background:#fff; display:flex; flex-direction:column; padding:0 54px; position:relative; overflow:hidden; page-break-after:always; break-after:page; }
.page:last-child{ page-break-after:auto; break-after:auto; }
@media screen{ body{ padding:16px 0; } .page{ margin-bottom:16px; box-shadow:0 1px 2px rgba(18,22,30,.06),0 8px 28px rgba(18,22,30,.08); } }
@media print{ html,body{ background:#fff; } .page{ margin:0; box-shadow:none; } }
/* Cabeçalho e rodapé de cada folha */
.hd{ height:64px; display:flex; align-items:center; justify-content:space-between; gap:24px; border-bottom:1px solid var(--line); flex-shrink:0; }
.hd img{ width:auto; height:auto; max-height:34px; max-width:170px; object-fit:contain; object-position:left center; display:block; }
.hd .mk{ font-size:15px; font-weight:800; letter-spacing:-.01em; color:var(--c1); max-width:58%; line-height:1.25; }
.hd .ref{ font-size:10.5px; color:var(--mut); text-align:right; line-height:1.4; max-width:40%; }
.hd .ref b{ color:var(--ink); font-weight:600; }
.ft{ margin-top:auto; height:46px; display:flex; align-items:center; justify-content:space-between; gap:16px; border-top:1px solid var(--line); font-size:10px; line-height:1.3; color:var(--mut); flex-shrink:0; }
.ft span{ min-width:0; }
.ft .pg{ white-space:nowrap; }
.ft .pg{ color:var(--ink); font-weight:600; }
.mn{ padding-top:34px; padding-bottom:26px; }
/* Títulos */
h1,h2,h3{ text-wrap:balance; overflow-wrap:break-word; }
.v,td{ overflow-wrap:break-word; }
h2{ font-size:30px; line-height:1.12; font-weight:700; letter-spacing:-.022em; }
.lead{ font-size:13.5px; color:var(--mut); margin-top:8px; max-width:560px; }
h3{ font-size:14px; font-weight:700; letter-spacing:-.005em; margin-bottom:12px; }
.bl{ margin-top:30px; }
.k{ font-size:11px; color:var(--mut); font-weight:500; }
.v{ font-size:15px; font-weight:700; letter-spacing:-.01em; }
.nota{ font-size:10.5px; color:var(--mut); margin-top:10px; line-height:1.5; }
/* Capa (modelo 3) */
.capa{ padding:0; height:1122px; }
.capa .palco{ height:640px; min-height:480px; flex-shrink:1; display:flex; align-items:center; justify-content:center; padding:44px 24px; background:#fff; }
.capa .palco img{ display:block; width:auto; height:auto; max-width:100%; max-height:100%; object-fit:contain; }
.capa .palco img.vet{ width:100%; height:100%; }
.capa .palco .nm.longo{ font-size:54px; }
.capa .palco .nm{ font-size:76px; line-height:1.02; font-weight:800; letter-spacing:-.03em; color:var(--c1); text-align:center; text-wrap:balance; overflow-wrap:break-word; max-width:720px; }
.capa .cor{ background:var(--c1); color:#fff; flex:1; padding:34px 54px 28px; position:relative; overflow:hidden; display:flex; flex-direction:column; }
.capa .arranjo{ position:absolute; right:-170px; top:-40px; width:440px; height:auto; opacity:.5; }
.capa .tt{ position:relative; max-width:540px; }
.capa .tt p{ font-size:13.5px; color:rgba(255,255,255,.8); }
.capa h1.longo{ font-size:32px; }
.capa h1.muito{ font-size:27px; }
.capa h1{ font-size:42px; line-height:1.06; font-weight:800; letter-spacing:-.025em; margin-top:6px; }
.capa .loc{ font-size:13px; color:rgba(255,255,255,.8); margin-top:10px; }
.capa .eco{ position:relative; margin-top:auto; padding-top:18px; }
.capa .eco .k{ font-size:12.5px; color:rgba(255,255,255,.8); }
.capa .eco .g{ font-size:46px; font-weight:800; letter-spacing:-.03em; line-height:1.05; margin-top:2px; }
.capa .eco .g small{ font-size:19px; font-weight:600; letter-spacing:-.01em; }
.capa .fig{ position:relative; display:flex; gap:40px; margin-top:22px; padding-top:16px; border-top:1px solid rgba(255,255,255,.22); }
.capa .fig .k{ color:rgba(255,255,255,.75); }
.capa .fig .v{ color:#fff; }
.capa .meta{ position:relative; margin-top:22px; padding-top:0; display:flex; justify-content:space-between; align-items:flex-end; gap:24px; font-size:11px; color:rgba(255,255,255,.78); }
.capa .meta b{ color:#fff; font-weight:600; }
.capa .qr{ color:rgba(255,255,255,.8); }
.capa .qr .qb{ border-color:transparent; }
.qr{ display:flex; align-items:center; gap:12px; font-size:10.5px; color:var(--mut); line-height:1.35; }
.qr .qb{ width:78px; height:78px; padding:5px; border:1px solid var(--line); border-radius:8px; background:#fff; flex-shrink:0; }
.qr .qb svg{ width:100%; height:100%; display:block; }
/* Resumo */
.ola h1{ font-size:40px; line-height:1.08; font-weight:800; letter-spacing:-.028em; }
.ola .loc{ font-size:13px; color:var(--mut); margin-top:8px; }
.ola .ids{ display:flex; gap:28px; margin-top:18px; font-size:11px; color:var(--mut); }
.ola .ids b{ display:block; color:var(--ink); font-size:12.5px; font-weight:600; margin-top:1px; }
.frase{ margin-top:34px; padding:30px 32px; background:var(--c1); color:#fff; border-radius:14px; }
.frase .q{ font-size:13px; color:rgba(255,255,255,.8); }
.frase .g{ font-size:46px; font-weight:800; letter-spacing:-.03em; line-height:1.05; margin-top:6px; }
.frase .g small{ font-size:19px; font-weight:600; letter-spacing:-.01em; }
.frase .s{ font-size:13.5px; color:rgba(255,255,255,.88); margin-top:10px; max-width:520px; }
.frase .d{ display:flex; gap:0; margin-top:24px; border-top:1px solid rgba(255,255,255,.22); }
.frase .d>div{ flex:1; padding:14px 18px 0 0; }
.frase .d>div+div{ padding-left:18px; border-left:1px solid rgba(255,255,255,.22); }
.frase .d .k{ color:rgba(255,255,255,.75); }
.frase .d .v{ color:#fff; font-size:17px; margin-top:2px; }
.cf .cap{ display:grid; grid-template-columns:repeat(4,1fr); gap:18px; margin-top:6px; }
.cf .cap b{ display:block; font-size:12.5px; margin-bottom:3px; }
.cf .cap span{ font-size:11.5px; color:var(--mut); line-height:1.45; display:block; }
.cf .cap>div{ text-align:center; }
.idx{ display:grid; grid-template-columns:1fr 1fr; column-gap:32px; }
.idx div{ display:flex; justify-content:space-between; padding:9px 0; border-bottom:1px solid var(--line); font-size:12.5px; }
.idx div span:last-child{ color:var(--mut); }
/* Ficha técnica */
.ficha{ display:grid; grid-template-columns:repeat(3,1fr); border-top:1px solid var(--line); }
.ficha>div{ padding:10px 14px 10px 0; border-bottom:1px solid var(--line); }
.ficha .larga{ grid-column:1/-1; }
.ficha .larga .v{ font-size:13px; font-weight:600; }
.sis{ display:grid; grid-template-columns:268px 1fr; gap:24px; align-items:start; }
.sis .ficha{ grid-template-columns:1fr 1fr; }
.foto{ border-radius:10px; overflow:hidden; background:var(--soft); }
.foto img{ width:268px; height:200px; object-fit:cover; display:block; }
.foto figcaption{ font-size:10.5px; color:var(--mut); padding:7px 10px; }
.graf svg{ width:100%; height:auto; display:block; }
.leg{ display:flex; gap:20px; font-size:11px; color:var(--mut); margin-bottom:6px; }
.leg i{ display:inline-block; width:12px; height:10px; border-radius:2px; background:var(--c1); margin-right:6px; vertical-align:-1px; }
.leg i.tr{ height:0; border-top:2px dashed var(--ink); background:none; border-radius:0; vertical-align:3px; }
.leg i.cz{ background:#9AA0A9; height:2px; vertical-align:3px; }
.leg i.c1{ height:3px; vertical-align:3px; }
/* Tabelas */
table{ width:100%; border-collapse:collapse; }
th{ font-size:10.5px; font-weight:600; color:var(--mut); text-align:left; padding:0 10px 8px 0; border-bottom:1px solid var(--ink); }
td{ padding:8px 10px 8px 0; border-bottom:1px solid var(--line); vertical-align:top; }
th.r,td.r{ text-align:right; }
td .sub{ display:block; font-size:10.5px; color:var(--mut); margin-top:1px; }
.eq td:first-child{ font-weight:600; width:150px; }
.eq td.q{ width:56px; text-align:right; font-variant-numeric:tabular-nums; }
.bat{ margin-top:22px; padding:12px 14px; background:var(--c3); border-radius:8px; font-size:11.5px; color:var(--ink); }
.bat b{ color:var(--c1); }
.inc{ font-size:11.5px; color:var(--mut); margin-top:10px; }
.anos td{ padding:5px 10px 5px 0; font-variant-numeric:tabular-nums; }
.anos td:first-child{ color:var(--mut); width:64px; }
.anos td.sd{ width:250px; }
.anos td.sd span{ display:inline-block; width:104px; text-align:right; margin-right:12px; }
.anos .sb{ vertical-align:-1px; }
.anos tr.vira td{ font-weight:700; color:var(--c1); }
.anos tr.vira td:first-child{ color:var(--c1); }
/* Investimento */
.preco{ display:grid; grid-template-columns:1fr 1fr; border:1px solid var(--line); border-radius:12px; overflow:hidden; }
.preco>div{ padding:22px 24px; }
.preco>div+div{ border-left:1px solid var(--line); background:var(--soft); }
.preco .g{ font-size:38px; font-weight:800; letter-spacing:-.03em; line-height:1.1; margin-top:4px; }
.preco .g.c{ color:var(--c1); }
.preco .s{ font-size:11.5px; color:var(--mut); margin-top:4px; }
.pg-grupo{ margin-top:22px; }
.pg-grupo h3{ display:flex; justify-content:space-between; align-items:baseline; }
.pg-grupo h3 span{ font-size:11px; color:var(--mut); font-weight:500; }
.esp{ font-size:13px; overflow-wrap:break-word; }
.parc{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
.parc>div{ border:1px solid var(--line); border-radius:8px; padding:9px 12px; }
.parc .n{ font-size:11px; color:var(--mut); }
.parc .p{ font-size:15px; font-weight:700; letter-spacing:-.01em; font-variant-numeric:tabular-nums; }
.parc.mini{ grid-template-columns:repeat(6,1fr); gap:6px; }
.parc.mini>div{ padding:6px 9px; }
.parc.mini .n{ font-size:10px; }
.parc.mini .p{ font-size:13px; }
.linha-pg{ display:flex; justify-content:space-between; gap:20px; padding:11px 0; border-bottom:1px solid var(--line); }
.linha-pg:first-of-type{ border-top:1px solid var(--line); }
.linha-pg .v{ font-size:14px; text-align:right; }
.ret{ display:grid; grid-template-columns:repeat(3,1fr); gap:0; border-top:1px solid var(--ink); }
.ret>div{ padding:14px 16px 0 0; }
.ret>div+div{ padding-left:16px; border-left:1px solid var(--line); }
.ret .v{ font-size:21px; margin-top:2px; color:var(--c1); }
.ret .s{ font-size:10.5px; color:var(--mut); margin-top:4px; line-height:1.4; }
/* Como trabalhamos */
.etapas{ position:relative; }
.etapas>div{ display:grid; grid-template-columns:34px 1fr; gap:14px; padding-bottom:18px; position:relative; }
.etapas>div::before{ content:''; position:absolute; left:16px; top:30px; bottom:2px; width:1px; background:var(--line); }
.etapas>div:last-child::before{ display:none; }
.etapas .n{ width:34px; height:34px; border-radius:50%; border:1.5px solid var(--c1); color:var(--c1); font-weight:700; display:flex; align-items:center; justify-content:center; font-size:13px; background:#fff; }
.etapas b{ font-size:13.5px; display:block; padding-top:6px; }
.etapas span{ font-size:12px; color:var(--mut); display:block; margin-top:2px; }
.etapas em{ font-style:normal; font-weight:600; color:var(--ink); }
.prazo{ display:flex; align-items:baseline; gap:14px; padding:18px 22px; background:var(--c3); border-radius:12px; }
.prazo .g{ font-size:40px; font-weight:800; color:var(--c1); letter-spacing:-.03em; line-height:1; }
.prazo span{ font-size:12.5px; color:var(--ink); }
.dois{ display:grid; grid-template-columns:1fr 1fr; gap:28px; }
ul.lst{ list-style:none; }
ul.lst li{ padding:7px 0 7px 22px; border-bottom:1px solid var(--line); font-size:12px; position:relative; }
ul.lst li::before{ content:''; position:absolute; left:2px; top:12px; width:10px; height:6px; border-left:1.6px solid var(--c1); border-bottom:1.6px solid var(--c1); transform:rotate(-45deg); }
ul.lst.nao li::before{ width:10px; height:0; border-left:0; border-bottom:1.6px solid var(--mut); transform:none; top:15px; }
ul.cond li{ font-size:11.5px; color:var(--mut); padding:5px 0 5px 14px; position:relative; }
ul.cond{ list-style:none; }
ul.cond li::before{ content:''; position:absolute; left:2px; top:12px; width:4px; height:4px; border-radius:50%; background:var(--mut); }
/* Garantias e aceite */
.gar{ display:grid; grid-template-columns:repeat(4,1fr); border-top:1px solid var(--ink); }
.gar>div{ padding:12px 12px 12px 0; border-bottom:1px solid var(--line); }
.gar .g{ font-size:26px; font-weight:800; letter-spacing:-.02em; color:var(--c1); line-height:1.1; }
.gar .g small{ font-size:12px; font-weight:600; color:var(--ink); letter-spacing:0; margin-left:3px; }
.gar .k{ margin-top:2px; }
.aceite td{ padding:7px 10px 7px 0; }
.aceite td:first-child{ color:var(--mut); width:170px; }
.aceite td:last-child{ font-weight:600; }
.decl{ font-size:12.5px; margin-top:16px; }
.sigs{ display:grid; grid-template-columns:1fr 1fr; gap:40px; margin-top:46px; }
.sigs .ln{ border-top:1px solid var(--ink); padding-top:8px; }
.sigs b{ display:block; font-size:12.5px; }
.sigs span{ display:block; font-size:11px; color:var(--mut); }
.contato{ display:flex; justify-content:space-between; align-items:center; gap:24px; padding:18px 22px; border:1px solid var(--line); border-radius:12px; }
.contato .v{ font-size:16px; }
.contato a{ display:inline-block; margin-top:10px; background:var(--c1); color:#fff; text-decoration:none; font-weight:600; font-size:12.5px; padding:10px 16px; border-radius:8px; }
.contato a:focus-visible{ outline:2px solid var(--c1); outline-offset:3px; }
@media print{ .contato a{ display:none; } }
.contato-linha{ font-size:12.5px; padding-top:14px; border-top:1px solid var(--line); }
.contato-linha a{ color:var(--ink); font-weight:600; text-decoration:none; }
`;
}
