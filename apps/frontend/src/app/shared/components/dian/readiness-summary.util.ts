import {
  isActionableCheck,
  isBlockingCheck,
  type ProductionReadinessCheck,
  type ProductionReadinessReport,
} from './fiscal-readiness.interface';

/**
 * El checklist de habilitación partido en los TRES registros en los que se
 * puede hablar de él sin mentir. Es la pieza que impide el defecto que más caro
 * sale en esta pantalla, así que vive aquí y no dentro de un componente: los
 * cuatro consumidores (tarjeta de eje, panel de certificado, panel del set de
 * pruebas y el formulario) tienen que partirlo IGUAL.
 *
 * - `todo` — bloqueante y la pelota está de nuestro lado. Esto sí es una tarea.
 * - `waiting` — bloqueante y la DIAN no ha fallado. **No es una tarea.** Pintar
 *   estos junto a los anteriores es lo que hace que un comerciante reenvíe un
 *   set de pruebas que sigue en revisión y queme un segundo bloque de
 *   consecutivos autorizados, que no se recuperan.
 * - `warnings` — nunca bloquean. Un aviso que bloquea la emisión en el momento
 *   en que salta no es un aviso: es la caída que venía a prevenir.
 */
export interface ReadinessSummary {
  /** `false` también cuando no hay informe: sin evaluar no es lo mismo que listo. */
  ready: boolean;
  /** No hay configuración que evaluar todavía. */
  notEvaluated: boolean;
  todo: ProductionReadinessCheck[];
  waiting: ProductionReadinessCheck[];
  warnings: ProductionReadinessCheck[];
  /** Total de puntos del checklist ya satisfechos / totales, para el resumen. */
  satisfiedCount: number;
  totalCount: number;
}

const EMPTY_SUMMARY: ReadinessSummary = Object.freeze({
  ready: false,
  notEvaluated: true,
  todo: [],
  waiting: [],
  warnings: [],
  satisfiedCount: 0,
  totalCount: 0,
});

/**
 * Parte un informe en los tres registros.
 *
 * Los recalcula desde `checks` en vez de confiar ciegamente en `actionable` /
 * `waiting_on_dian` / `warnings`: esos arrays son la vía normal, pero un payload
 * antiguo o un rail que los omita dejaría los tres vacíos y la UI diría «no te
 * falta nada» sobre una configuración que no emite. Cuando el backend los manda,
 * el resultado es idéntico — `isBlockingCheck` e `isActionableCheck` son los
 * mismos predicados con los que los construyó.
 */
export function summarizeReadiness(
  report: ProductionReadinessReport | null | undefined,
): ReadinessSummary {
  if (!report) return EMPTY_SUMMARY;

  const checks = report.checks ?? [];
  const unmet = checks.filter((check) => !check.satisfied);

  const blocking = unmet.filter(isBlockingCheck);

  return {
    ready: report.ready === true,
    notEvaluated: false,
    todo: blocking.filter(isActionableCheck),
    waiting: blocking.filter((check) => !isActionableCheck(check)),
    warnings: unmet.filter((check) => !isBlockingCheck(check)),
    satisfiedCount: checks.filter((check) => check.satisfied).length,
    totalCount: checks.length,
  };
}

/**
 * Texto de apoyo de un aviso, cuando trae la magnitud que lo hace accionable
 * ANTES de que rompa. «Vence pronto» no mueve a nadie; «quedan 7 días» sí, y
 * reexpedir un `.p12` toma días.
 */
export function warningDetail(check: ProductionReadinessCheck): string | null {
  if (typeof check.days_remaining === 'number') {
    const days = check.days_remaining;
    if (days <= 0) return 'Vencido';
    return days === 1 ? 'Queda 1 día' : `Quedan ${days} días`;
  }
  if (typeof check.percent_remaining === 'number') {
    return `Queda ${Math.max(0, Math.round(check.percent_remaining))}% del rango`;
  }
  return null;
}
