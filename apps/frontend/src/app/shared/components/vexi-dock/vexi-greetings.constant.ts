import type { VexiExpression } from './vexi-avatar.component';

/**
 * One proactive line Vexi can offer on its own initiative, paired with the
 * pose it wears while saying it.
 */
export interface VexiGreeting {
  readonly expression: VexiExpression;
  readonly message: string;
}

/**
 * Static catalogue — deliberately *not* model-generated.
 *
 * A proactive greeting is decorative: it opens a door, it does not answer a
 * question. Spending a model call (and its latency, its cost and its quota) on
 * a line the user may never read would make every session more expensive
 * without making any of them better. A hand-written catalogue paired to
 * expressions gives the same warmth for free and stays predictable.
 *
 * Keep the lines short: the bubble caps at `min(240px, 100vw - 24px)`, so
 * anything much longer than one sentence wraps into a paragraph that reads as
 * an interruption rather than an offer.
 */
export const VEXI_GREETINGS: readonly VexiGreeting[] = [
  { expression: 'neutro', message: '¿Te echo una mano con algo?' },
  { expression: 'pensando', message: '¿Quieres un resumen de cómo va el mes?' },
  { expression: 'ok', message: '¿Reviso el stock bajo antes de que se agote?' },
  { expression: 'escuchando', message: 'Mantén pulsado y dime qué necesitas.' },
  { expression: 'neutro', message: 'Si algo no cuadra, pregúntame y lo busco.' },
  { expression: 'hablando', message: 'Puedo explicarte cualquier cifra del panel.' },
  { expression: 'pensando', message: '¿Miramos qué productos se están moviendo?' },
  { expression: 'ok', message: '¿Te preparo un informe rápido de ventas?' },
  { expression: 'escuchando', message: 'Estoy aquí; háblame cuando quieras.' },
  { expression: 'neutro', message: '¿Reviso si hay pedidos pendientes de despacho?' },
];
