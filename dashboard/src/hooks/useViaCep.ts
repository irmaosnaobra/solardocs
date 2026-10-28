import { useEffect, useState } from 'react';

export type ViaCepAchado = { logradouro: string; bairro: string; cidade: string; uf: string };
export type ViaCepEstado = 'ocioso' | 'buscando' | 'achou' | 'nao-achou';

/**
 * Busca um CEP no ViaCEP. Passe o CEP SÓ quando a pessoa digitou (e '' nos outros
 * casos): assim rascunho, documento em edição e cadastro carregados com CEP não
 * disparam busca nem reescrevem rua e bairro de algo já emitido.
 *
 * A busca roda quando o CEP chega a 8 dígitos. `aoAchar` é chamado uma vez por busca
 * que deu certo. O estado é derivado do que já voltou, sem setState síncrono no efeito.
 */
export function useViaCep(cep: string, aoAchar: (r: ViaCepAchado) => void): ViaCepEstado {
  const digitos = cep.replace(/\D/g, '');
  const [resultado, setResultado] = useState<{ cep: string; achou: boolean } | null>(null);

  useEffect(() => {
    if (digitos.length !== 8) return;
    let cancelado = false;
    // Sem resposta em 6 s, desiste: a pessoa vê a mensagem de falha e preenche à mão.
    const ctl = new AbortController();
    const prazo = setTimeout(() => ctl.abort(), 6000);
    fetch(`https://viacep.com.br/ws/${digitos}/json/`, { signal: ctl.signal })
      .then(r => r.json())
      .then((j: { logradouro?: string; bairro?: string; localidade?: string; uf?: string; erro?: boolean | string }) => {
        if (cancelado) return;
        if (j.erro || !j.localidade) { setResultado({ cep: digitos, achou: false }); return; }
        setResultado({ cep: digitos, achou: true });
        aoAchar({
          logradouro: String(j.logradouro || '').trim(),
          bairro: String(j.bairro || '').trim(),
          cidade: String(j.localidade || '').trim(),
          uf: String(j.uf || '').trim().toUpperCase(),
        });
      })
      .catch(() => { if (!cancelado) setResultado({ cep: digitos, achou: false }); })
      .finally(() => clearTimeout(prazo));
    return () => { cancelado = true; clearTimeout(prazo); ctl.abort(); };
    // aoAchar muda a cada render; a busca só deve reiniciar com um CEP novo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digitos]);

  if (digitos.length !== 8) return 'ocioso';
  if (!resultado || resultado.cep !== digitos) return 'buscando';
  return resultado.achou ? 'achou' : 'nao-achou';
}
