'use client';

// Quem pode abrir o curso. A decisão é do servidor (GET /kit/meu-acesso): a tela
// só obedece. Os quatro estados são separados de propósito:
//
//   carregando  esperando a resposta
//   erro        a rede ou o servidor falhou. NUNCA vira "ainda não está na sua
//               conta": quem pagou e está sem sinal não pode ser trancado.
//   bloqueado   o servidor respondeu e disse que não liberou
//   liberado    pode abrir

import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';

export interface Acesso {
  temKit: boolean;
  liberado?: boolean;
  /** compra, assinatura, vitalicio ou legado */
  motivoAcesso?: string | null;
  itens?: string[];
  plano: string;
  packTrialUntil: string | null;
  progresso: string[];
}

export type EstadoAcesso = 'carregando' | 'erro' | 'bloqueado' | 'liberado';

export function useCursoAcesso() {
  const [estado, setEstado] = useState<EstadoAcesso>('carregando');
  const [acesso, setAcesso] = useState<Acesso | null>(null);

  const buscar = useCallback(() => {
    api.get('/kit/meu-acesso')
      .then(({ data }) => {
        setAcesso(data);
        setEstado(data?.liberado === true ? 'liberado' : 'bloqueado');
      })
      .catch(() => setEstado('erro'));
  }, []);

  useEffect(() => { buscar(); }, [buscar]);

  const tentarDeNovo = useCallback(() => {
    setEstado('carregando');
    buscar();
  }, [buscar]);

  return { estado, acesso, tentarDeNovo };
}
