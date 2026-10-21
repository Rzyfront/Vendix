/**
 * Pre-verificación guiada de discrepancias (Vex y Vexi).
 *
 * Cuando una escritura que CIERRA, CONSOLIDA o AJUSTA algo recibe un valor
 * real distinto del esperado (arqueo de caja, conteo de inventario…), el
 * preview no propone la escritura: devuelve al modelo una señal estructurada
 * `discrepancy_detected` con la diferencia, las causas típicas a revisar, las
 * lecturas que la explican y las preguntas guía. El modelo acompaña a la
 * persona en esa revisión y solo después vuelve a llamar la escritura con
 * `discrepancy_reviewed=true` y el motivo, que queda registrado.
 *
 * La señal es para el modelo: nombres de herramientas y el código
 * `discrepancy_detected` nunca se le muestran a la persona.
 *
 * No es una barrera de seguridad sino de acompañamiento: si la persona insiste
 * en ejecutar ya, el modelo lo respeta y registra la diferencia con su motivo.
 */

export const DISCREPANCY_SIGNAL = 'discrepancy_detected' as const;

/** Motivo registrado cuando la persona decide seguir sin conocer la causa. */
export const DISCREPANCY_UNKNOWN_REASON =
  'La persona decidió continuar sin identificar el motivo de la diferencia.';

export interface DiscrepancySignal {
  signal: typeof DISCREPANCY_SIGNAL;
  /** Proceso de negocio: `cash_close`, `inventory_count`… */
  process: string;
  /** Unidad de las cifras: código de moneda o `unidades`. */
  unit: string;
  expected: number;
  actual: number;
  /** actual − expected. */
  difference: number;
  direction: 'shortage' | 'surplus';
  /** Diferencia absoluta que se tolera sin guía. */
  tolerance: number;
  /** Frase lista para explicar la diferencia en lenguaje simple. */
  plain_summary: string;
  /** Causas típicas a revisar, en lenguaje de la operación. */
  causes_to_check: string[];
  /** Lecturas que ayudan a encontrar la causa (uso interno del modelo). */
  reads_to_run: string[];
  /** Preguntas guía para la persona, en el orden en que conviene hacerlas. */
  guide_questions: string[];
  /** Cómo continuar una vez revisado o si la persona insiste. */
  how_to_proceed: string;
}

/**
 * Tolerancia monetaria: redondeo de monedas, no faltantes reales. El 0,1 % del
 * esperado con piso de 1 unidad: en un turno de $500.000 tolera $500.
 */
export function moneyTolerance(expected: number): number {
  return Math.max(1, Math.round(Math.abs(expected) * 0.001 * 100) / 100);
}

export function exceedsTolerance(
  difference: number,
  tolerance: number,
): boolean {
  return Math.abs(difference) > tolerance;
}

/** Lectura de los argumentos de reconocimiento de una escritura con discrepancia. */
export function readDiscrepancyAck(args: Record<string, any> | undefined): {
  reviewed: boolean;
  reason: string | null;
} {
  const reviewed = args?.discrepancy_reviewed === true;
  const reason =
    typeof args?.discrepancy_reason === 'string' &&
    args.discrepancy_reason.trim()
      ? args.discrepancy_reason.trim()
      : null;
  return { reviewed, reason };
}

/** Propiedades JSON-schema que toda escritura con pre-verificación expone. */
export const DISCREPANCY_ACK_PARAMETERS = {
  discrepancy_reviewed: {
    type: 'boolean',
    description:
      'true SOLO después de haber guiado a la persona por la revisión de la diferencia (o si ella insiste en continuar sin revisar). Nunca lo pongas en la primera llamada.',
  },
  discrepancy_reason: {
    type: 'string',
    description:
      'Motivo de la diferencia en palabras de la persona (o que decidió continuar sin conocerlo). Obligatorio con discrepancy_reviewed=true; queda registrado. No lo inventes.',
  },
} as const;

export const DISCREPANCY_HOW_TO_PROCEED =
  'No propongas todavía la escritura. 1) Explica la diferencia con las cifras en lenguaje simple, sin regañar. 2) Pregunta si conoce el motivo. 3) Revisa con lecturas las causas típicas y muéstrale candidatos concretos. 4) Guíala a registrar lo que falte. 5) Cuando haya revisado, o si insiste en continuar ya, vuelve a llamar esta misma acción con discrepancy_reviewed=true y discrepancy_reason con el motivo en sus palabras. No menciones nombres de herramientas ni este aviso.';

const formatAmount = (value: number, unit: string): string => {
  const rounded = Math.round(value * 100) / 100;
  const text = rounded.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return unit === 'unidades' ? `${text} unidades` : `$${text}`;
};

export function buildDiscrepancySignal(input: {
  process: string;
  unit: string;
  expected: number;
  actual: number;
  tolerance: number;
  subject: string;
  causes_to_check: string[];
  reads_to_run: string[];
  guide_questions: string[];
}): DiscrepancySignal {
  const difference = Math.round((input.actual - input.expected) * 100) / 100;
  const direction = difference < 0 ? 'shortage' : 'surplus';
  const gap = formatAmount(Math.abs(difference), input.unit);
  const plain_summary =
    direction === 'shortage'
      ? `${input.subject}: se esperaban ${formatAmount(input.expected, input.unit)} y hay ${formatAmount(input.actual, input.unit)}; faltan ${gap}.`
      : `${input.subject}: se esperaban ${formatAmount(input.expected, input.unit)} y hay ${formatAmount(input.actual, input.unit)}; sobran ${gap}.`;
  return {
    signal: DISCREPANCY_SIGNAL,
    process: input.process,
    unit: input.unit,
    expected: input.expected,
    actual: input.actual,
    difference,
    direction,
    tolerance: input.tolerance,
    plain_summary,
    causes_to_check: input.causes_to_check,
    reads_to_run: input.reads_to_run,
    guide_questions: input.guide_questions,
    how_to_proceed: DISCREPANCY_HOW_TO_PROCEED,
  };
}

/** Mensaje del preview rechazado: el modelo lo lee junto a `preview.discrepancy`. */
export function discrepancyPreviewMessage(signal: DiscrepancySignal): string {
  return `${signal.plain_summary} Antes de registrar esta diferencia hay que acompañar a la persona a revisar las causas. ${DISCREPANCY_HOW_TO_PROCEED}`;
}

/**
 * Principio general del agente. Bloque de sistema estático (cacheable) que el
 * bucle agrega cuando hay herramientas operativas.
 */
export const DISCREPANCY_GUIDANCE_BLOCK = [
  'Pre-verificación de discrepancias (aplica a Vex y Vexi). Cuando vayas a cerrar, consolidar, conciliar o ajustar algo y lo real no coincide con lo esperado (faltante o sobrante de caja, conteo de inventario distinto al sistema, stock negativo, saldos o conciliaciones que no cuadran, facturas vs pagos), esta regla manda sobre la de proponer directo:',
  '1) Explica la diferencia en lenguaje simple con las cifras. 2) Pregunta si conoce el motivo. 3) Investiga con lecturas las causas típicas y muéstrale candidatos concretos (en caja: órdenes canceladas o no registradas, reembolsos olvidados, entradas y salidas de efectivo sin registrar, pagos con otro método mal clasificados, ventas fuera del sistema; en inventario: ventas, compras, traslados o devoluciones sin registrar y conteo en otra bodega o variante). 4) Guíala paso a paso a registrar lo que falte. 5) Solo entonces propone la acción, dejando el motivo registrado.',
  'Si una escritura responde con una diferencia detectada, sigue esos pasos antes de reintentarla. Si la persona insiste en ejecutar ya, respétalo sin discutir y registra la diferencia con su motivo (o que decidió seguir sin conocerlo). Si todo cuadra dentro de la tolerancia, no la molestes: propone directo.',
  'Tono cercano, de acompañamiento, como un compañero que ayuda a revisar: sin regañar, sin jerga técnica, sin nombres de herramientas ni códigos internos.',
].join(' ');
