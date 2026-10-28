'use client';

import api from '@/services/api';
import Assinatura from '../manutencao/Assinatura';
import '../manutencao/manutencao.css';
import { TEXTOS, ehMigracaoPendente, type AssinaturasEstado } from './tipos';

// Seção "Assinaturas" da vistoria: técnico (nome obrigatório) e cliente (opcional).
// Usa o quadro de assinatura da Manutenção, só com os textos da vistoria. A API espera o PNG
// como data URL, então o prefixo é posto aqui (o quadro devolve só o base64).

function msg(err: unknown, padrao: string): string {
  if (ehMigracaoPendente(err)) return TEXTOS.statusLiberando;
  const e = err as { response?: { data?: { error?: string } } };
  return e?.response?.data?.error || padrao;
}

export default function Assinaturas({
  vistoriaId, valor, onMudou, onSalvou, onIndisponivel, nomeSugerido,
}: {
  vistoriaId: string;
  valor: AssinaturasEstado;
  onMudou: (novo: AssinaturasEstado) => void;
  onSalvou: () => void;
  /** A API respondeu 503 migracao_pendente: a tela esconde status e assinatura. */
  onIndisponivel: () => void;
  nomeSugerido: string;
}) {
  async function salvar(papel: 'tecnico' | 'cliente', png: string, nome: string, registro: string): Promise<string | null> {
    try {
      const r = await api.post(`/vistorias/${vistoriaId}/assinatura`, {
        papel, nome, ...(papel === 'tecnico' ? { registro } : {}), png: `data:image/png;base64,${png}`,
      });
      onMudou({ ...valor, [papel]: { url: r.data.url ?? undefined, nome, ...(papel === 'tecnico' ? { registro } : {}) } });
      onSalvou();
      return null;
    } catch (err) {
      if (ehMigracaoPendente(err)) onIndisponivel();
      return msg(err, 'Não consegui salvar a assinatura. Tente de novo.');
    }
  }

  async function remover(papel: 'tecnico' | 'cliente'): Promise<string | null> {
    try {
      await api.delete(`/vistorias/${vistoriaId}/assinatura`, { params: { papel } });
      const novo = { ...valor };
      delete novo[papel];
      onMudou(novo);
      return null;
    } catch (err) {
      if (ehMigracaoPendente(err)) onIndisponivel();
      return msg(err, 'Não consegui remover a assinatura. Tente de novo.');
    }
  }

  return (
    // .mnt-page traz as variáveis de cor do quadro; o respiro de baixo é desta tela, não dele.
    <section className="mnt-page vst-assinaturas" style={{ paddingBottom: 0 }} aria-labelledby="vst-ass-t">
      <h2 className="vst-secTitulo" id="vst-ass-t">{TEXTOS.assinaturasTitulo}</h2>

      <Assinatura
        key={`tec-${valor.tecnico?.url ? 'ok' : 'novo'}`}
        rotulo={TEXTOS.tecnicoTitulo}
        url={valor.tecnico?.url}
        nomeInicial={valor.tecnico?.nome ?? ''}
        registroInicial={valor.tecnico?.registro ?? ''}
        comRegistro
        aviso={TEXTOS.instrucao}
        avisarFalta
        textos={{
          nome: TEXTOS.tecnicoNome,
          registro: TEXTOS.tecnicoRegistro,
          registroPlaceholder: TEXTOS.tecnicoRegistroPlaceholder,
          limpar: TEXTOS.limpar,
          salvar: TEXTOS.salvar,
          salva: TEXTOS.assinaturaSalva,
          semDesenho: TEXTOS.semDesenho,
          semNome: TEXTOS.semNomeTecnico,
        }}
        onSalvar={(png, nome, registro) => salvar('tecnico', png, nome, registro)}
        onRemover={() => remover('tecnico')}
      />

      <Assinatura
        key={`cli-${valor.cliente?.url ? 'ok' : 'novo'}`}
        rotulo={TEXTOS.clienteTitulo}
        url={valor.cliente?.url}
        nomeInicial={valor.cliente?.nome ?? nomeSugerido}
        aviso={`${TEXTOS.instrucao} ${TEXTOS.avisoCliente}`}
        avisarFalta
        nomeObrigatorio={false}
        textos={{
          nome: TEXTOS.clienteNome,
          limpar: TEXTOS.limpar,
          salvar: TEXTOS.salvar,
          salva: TEXTOS.assinaturaSalva,
          semDesenho: TEXTOS.semDesenho,
        }}
        onSalvar={(png, nome) => salvar('cliente', png, nome, '')}
        onRemover={() => remover('cliente')}
      />
    </section>
  );
}
