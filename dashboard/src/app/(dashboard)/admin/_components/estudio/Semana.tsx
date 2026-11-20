'use client';

// Fábrica com pauta semanal (Irmãos na Obra): personagem, régua, onde está cada
// vídeo e a grade da semana, 7 dias por 2 horários.
import type { CSSProperties } from 'react';
import Image from 'next/image';
import {
  AudioLines, Box, CalendarClock, FilePenLine, FileSearch, RadioTower, ScanEye, type LucideIcon,
} from 'lucide-react';
import type { ItemPauta, Pauta, Personagem } from './tipos';
import { hojeChave, NOME_ETAPA, nota, partesDia } from './formato';
import { ArteVideo, LINHAS } from './Ilustracoes';
import Dica from './Dica';
import f from './fabricas.module.css';

const ICONE: Record<string, LucideIcon> = {
  fatos: FileSearch,
  roteiro: FilePenLine,
  voz: AudioLines,
  visual: Box,
  avaliacao: ScanEye,
  agendado: CalendarClock,
  publicado: RadioTower,
};

const REGUA = 9;

function Etapas({ pauta }: { pauta: Pauta }) {
  const total = pauta.itens.length;
  return (
    <div className={f.bloco}>
      <div className={f.blocoTopo}>
        <h4 className={f.blocoTitulo}>Onde está cada vídeo</h4>
        <Dica texto="Cada vídeo passa pelas 7 etapas, da checagem dos fatos até o post. O número é quantos estão parados em cada uma agora." />
      </div>
      <ol className={f.etapas} style={{ '--n': pauta.etapas.length } as CSSProperties}>
        {pauta.etapas.map((et) => {
          const Icone = ICONE[et] ?? Box;
          const qtd = pauta.itens.filter((i) => i.etapa === et).length;
          return (
            <li key={et} className={f.etapa} data-cheia={qtd > 0 || undefined} data-etapa={et}>
              <span className={f.etapaIcone}><Icone size={18} strokeWidth={1.7} aria-hidden="true" /></span>
              <span className={f.etapaQtd}>{qtd}</span>
              <span className={f.etapaNome}>{NOME_ETAPA[et] ?? et}</span>
              <span className={f.etapaBarra} aria-hidden="true"><span style={{ width: `${total ? (qtd / total) * 100 : 0}%` }} /></span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Regua({ itens }: { itens: ItemPauta[] }) {
  const notas = itens.filter((i) => i.nota != null);
  const abaixo = notas.filter((i) => (i.nota ?? 0) < REGUA).length;
  const pos = (n: number) => `${Math.min(100, Math.max(0, ((n - 5) / 5) * 100))}%`;
  return (
    <div className={`${f.bloco} ${f.regua}`}>
      <div className={f.blocoTopo}>
        <h4 className={f.blocoTitulo}>A régua</h4>
        <Dica lado="direita" texto="Só vai para a fila o vídeo que o avaliador nota 9 ou mais e que não tem nenhuma reprovação automática. Sempre 2 a 3 dias prontos na frente." />
      </div>
      <p className={f.reguaFrase}><b>Nota 9+</b> e <b>zero defeito</b></p>
      <div className={f.reguaEscala} role="img" aria-label={`Escala de 5 a 10. Faixa aprovada de 9 a 10. ${notas.length} vídeo(s) com nota, ${abaixo} abaixo de 9.`}>
        <span className={f.reguaFaixa} style={{ left: pos(REGUA) }} />
        {[5, 6, 7, 8, 9, 10].map((n) => (
          <span key={n} className={f.reguaMarca} style={{ left: pos(n) }} data-forte={n === REGUA || undefined}>
            <i />
            <small>{n}</small>
          </span>
        ))}
        {notas.map((i) => (
          <span key={i.slug} className={f.reguaPonto} style={{ left: pos(i.nota ?? 0) }} data-ok={(i.nota ?? 0) >= REGUA || undefined} title={`${i.tema}: ${nota(i.nota ?? 0)}`} />
        ))}
      </div>
      <p className={f.reguaRodape}>
        {notas.length === 0 ? 'Nenhum vídeo avaliado ainda.' : abaixo > 0 ? `${abaixo} de ${notas.length} avaliado${notas.length > 1 ? 's' : ''} abaixo de 9.` : `${notas.length} avaliado${notas.length > 1 ? 's' : ''}, todos 9+.`}
      </p>
    </div>
  );
}

function CartaoPersonagem({ personagem }: { personagem: Personagem }) {
  const img = personagem.imagemUrl ?? '/admin/estudio/protagonista.png';
  return (
    <div className={`${f.bloco} ${f.personagem}`}>
      <span className={f.persFoto}>
        <Image src={img} alt={`${personagem.nome ?? 'Personagem'}, o protagonista animado da série`} width={114} height={298} className={f.persImg} />
      </span>
      <span className={f.persTexto}>
        <span className={f.persOlho}>Personagem fixo</span>
        <span className={f.persNome}>{personagem.nome ?? 'Protagonista'}</span>
        <span className={f.persDesc}>{personagem.descricao ?? 'O mesmo em todo vídeo.'}</span>
        <Dica texto="Capacete branco, bigode escuro e colete laranja com o emblema Irmãos na Obra nas costas. Só animação, nunca rosto real." />
      </span>
    </div>
  );
}

function Video({ item, etapas }: { item: ItemPauta; etapas: string[] }) {
  const pos = etapas.indexOf(item.etapa);
  const okNota = item.nota != null && item.nota >= REGUA;
  return (
    <article className={f.video} data-etapa={item.etapa}>
      <span className={f.videoArte}>
        <ArteVideo linha={item.linha} capaUrl={item.capaUrl} titulo={item.tema} />
        <span className={f.videoHora}>{item.hora}</span>
        {item.nota != null ? (
          <span className={f.videoNota} data-ok={okNota || undefined} title={okNota ? 'Nota dentro da régua' : 'Nota abaixo da régua de 9'}>
            {nota(item.nota)}
            {!okNota ? <span className={f.sr}> abaixo da régua</span> : null}
          </span>
        ) : null}
      </span>
      <span className={f.videoCorpo}>
        <span className={f.videoLinha} data-linha={item.linha}>{LINHAS[item.linha] ?? item.linha}</span>
        <h5 className={f.videoTema} title={item.tema}>{item.tema}</h5>
        <span className={f.videoEtapa}>
          <span className={f.trilha} aria-hidden="true">
            {etapas.map((et, i) => <i key={et} data-feita={i <= pos || undefined} />)}
          </span>
          <span className={f.videoEtapaNome}>{NOME_ETAPA[item.etapa] ?? item.etapa}</span>
        </span>
      </span>
    </article>
  );
}

export default function Semana({ pauta, personagem, agora }: { pauta: Pauta; personagem?: Personagem; agora: number }) {
  const dias = [...new Set(pauta.itens.map((i) => i.dia))].sort();
  const horas = [...new Set(pauta.itens.map((i) => i.hora))].sort();
  const hoje = hojeChave(agora);
  const amanha = hojeChave(agora + 86400000);
  const ini = partesDia(dias[0] ?? pauta.semana).data;
  const fim = partesDia(dias[dias.length - 1] ?? pauta.semana).data;

  return (
    <>
      <div className={f.semTopo}>
        {personagem ? <CartaoPersonagem personagem={personagem} /> : null}
        <Etapas pauta={pauta} />
        <Regua itens={pauta.itens} />
      </div>

      <div className={f.bloco}>
        <div className={f.blocoTopo}>
          <h4 className={f.blocoTitulo}>Semana de {ini} a {fim}</h4>
          <span className={f.blocoInfo}>{pauta.itens.length} vídeos · {horas.join(' e ')}</span>
          <Dica texto="A pauta que o dono aprovou para a semana. Vale como confirmação de cada vídeo." />
          <ul className={f.legenda} aria-label="Linhas de conteúdo">
            {['solar', 'energia', 'historia', 'eletroposto'].map((l) => (
              <li key={l} data-linha={l}><i aria-hidden="true" />{LINHAS[l]}</li>
            ))}
          </ul>
        </div>
        <ol className={f.grade} style={{ '--dias': dias.length } as CSSProperties}>
          {dias.map((d) => {
            const p = partesDia(d);
            const marca = d === hoje ? 'Hoje' : d === amanha ? 'Amanhã' : null;
            return (
              <li key={d} className={f.dia} data-hoje={d === hoje || undefined}>
                <span className={f.diaCab}>
                  <span className={f.diaSemana}>{p.semana}</span>
                  <span className={f.diaData}>{p.data}</span>
                  {marca ? <span className={f.diaMarca}>{marca}</span> : null}
                </span>
                {horas.map((h) => {
                  const item = pauta.itens.find((i) => i.dia === d && i.hora === h);
                  return item ? (
                    <Video key={h} item={item} etapas={pauta.etapas} />
                  ) : (
                    <span key={h} className={f.videoVazio}>{h} · livre</span>
                  );
                })}
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}
