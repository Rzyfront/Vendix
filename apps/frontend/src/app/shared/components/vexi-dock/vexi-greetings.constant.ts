/**
 * One proactive line Vexi can offer on its own initiative.
 *
 * The pose used to be picked per greeting. It is not any more: every proactive
 * offer wears the same face (`wow`), because a greeting is one behaviour and
 * nine different expressions for it read as nine different moods rather than
 * as Vexi offering to help. Leaving the field in place would have let a data
 * constant quietly override a rule the dock is supposed to own.
 */
export interface VexiGreeting {
  readonly message: string;
}

/**
 * Static catalogue — deliberately *not* model-generated.
 *
 * A proactive greeting is decorative: it opens a door, it does not answer a
 * question. Spending a model call (and its latency, its cost and its quota) on
 * a line the user may never read would make every session more expensive
 * without making any of them better. A hand-written catalogue gives the same
 * warmth for free and stays predictable.
 *
 * Keep the lines short: the bubble caps at `min(240px, 100vw - 24px)`, so
 * anything much longer than one sentence wraps into a paragraph that reads as
 * an interruption rather than an offer.
 */
export const VEXI_GREETINGS: readonly VexiGreeting[] = [
  { message: '¿Te echo una mano con algo?' },
  { message: '¿Quieres un resumen de cómo va el mes?' },
  { message: '¿Reviso el stock bajo antes de que se agote?' },
  { message: 'Mantén pulsado y dime qué necesitas.' },
  { message: 'Si algo no cuadra, pregúntame y lo busco.' },
  { message: 'Puedo explicarte cualquier cifra del panel.' },
  { message: '¿Miramos qué productos se están moviendo?' },
  { message: '¿Te preparo un informe rápido de ventas?' },
  { message: 'Estoy aquí; háblame cuando quieras.' },
  { message: '¿Reviso si hay pedidos pendientes de despacho?' },
];
