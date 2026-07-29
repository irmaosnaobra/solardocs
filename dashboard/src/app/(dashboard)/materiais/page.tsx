import { redirect } from 'next/navigation';

// A área de materiais virou o curso gamificado em /cursos/kit-fechamento.
// Este redirect existe porque o link antigo circula em e-mail e em conversa.
export default function MateriaisPage() {
  redirect('/cursos/kit-fechamento');
}
