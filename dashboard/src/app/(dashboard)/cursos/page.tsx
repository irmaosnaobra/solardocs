import { redirect } from 'next/navigation';
import { CURSO } from './_conteudo/curso';

// Hoje existe um curso só, então /cursos leva direto pra trilha dele — tela de
// listagem com um item só é passo a mais sem função. Quando houver o segundo,
// este arquivo vira o hub (o card do curso já está desenhado em curso.module.css).
export default function CursosPage() {
  redirect(`/cursos/${CURSO.slug}`);
}
