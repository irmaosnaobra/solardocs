import { redirect } from 'next/navigation';
import { CURSOS } from './_conteudo/cursos.config';

// Com um curso só, /cursos leva direto pra trilha dele — listagem de um item é
// passo a mais sem função. Quando entrar o segundo, este arquivo vira o hub
// (basta percorrer CURSOS; a casca da trilha já serve qualquer um).
export default function CursosPage() {
  redirect(`/cursos/${CURSOS[0].slug}`);
}
