// REGISTRO DAS PERSONAS: Persona -> PersonaDef. Quem monta o pedido (ensaio, replay) pergunta aqui.
// Puro: só junta as três definições que já existem.

import type { Persona, PersonaDef } from '../tipos';
import { CARLA } from './carla';
import { DUDA } from './duda';
import { HELENA } from './helena';

export const PERSONAS: Readonly<Record<Persona, PersonaDef>> = Object.freeze({
  carla: CARLA,
  duda: DUDA,
  helena: HELENA,
});

export function personaDef(p: Persona): PersonaDef {
  return PERSONAS[p];
}
