/**
 * Lectura del estado de habilitación DIAN de una configuración.
 *
 * POR QUÉ EXISTE: la misma regla estaba escrita dos veces, en dos `computed`
 * paralelos —la guía de tiendas y la de plataforma— y cada copia estaba mal de
 * una forma distinta:
 *
 *   · Tiendas marcaba «Set de pruebas completado» con `testing`, que significa
 *     EN CURSO. Un tenant con la DIAN sin haber juzgado nada veía el paso en
 *     verde. Y `test_set_passed` no aparecía, así que el único estado que sí
 *     significa aprobado se pintaba gris.
 *   · Plataforma exigía `enabled`, así que el paso se quedaba gris DESPUÉS de
 *     que la DIAN aprobara el set, hasta habilitar producción.
 *
 * Dos defectos opuestos sobre la misma regla es lo que produce una regla
 * duplicada. Vive acá, con un solo dueño, y las dos guías la consumen.
 */

/**
 * Espejo de `dian_enablement_status_enum` (Prisma).
 *
 * `test_set_passed` es el estado que deja la aprobación de la DIAN y el único
 * que desbloquea el paso a producción; `enabled` es el que deja ese paso ya
 * dado. Cualquier mapeo que trate `testing` como terminal está mal.
 */
export type DianEnablementStatus =
  | 'not_started'
  | 'testing'
  | 'test_set_passed'
  | 'enabled'
  | 'suspended'
  | 'expired';

/** Variantes de `app-badge`. Se replica el literal para no acoplar `core` a `shared`. */
export type DianEnablementVariant =
  | 'neutral'
  | 'warning'
  | 'success'
  | 'error';

const LABELS: Record<DianEnablementStatus, string> = {
  not_started: 'Sin iniciar',
  testing: 'En habilitación',
  test_set_passed: 'Set aprobado',
  enabled: 'Habilitado',
  suspended: 'Suspendido',
  expired: 'Vencido',
};

const VARIANTS: Record<DianEnablementStatus, DianEnablementVariant> = {
  not_started: 'neutral',
  testing: 'warning',
  test_set_passed: 'success',
  enabled: 'success',
  suspended: 'error',
  expired: 'error',
};

/**
 * Los dos estados en los que la DIAN ya emitió veredicto favorable sobre el set.
 *
 * `testing` está fuera A PROPÓSITO: es el estado de un lote enviado y sin
 * juzgar. Marcarlo como aprobado fue el bug.
 */
const APPROVED: ReadonlySet<string> = new Set<DianEnablementStatus>([
  'test_set_passed',
  'enabled',
]);

function normalize(status: string | null | undefined): DianEnablementStatus {
  return status && status in LABELS
    ? (status as DianEnablementStatus)
    : 'not_started';
}

/**
 * Etiqueta legible. Un estado desconocido cae a `not_started` en vez de
 * imprimir la cadena cruda del enum, que es lo que hacían ambas guías con
 * `test_set_passed`, `suspended` y `expired`.
 */
export function dianEnablementLabel(status: string | null | undefined): string {
  return LABELS[normalize(status)];
}

export function dianEnablementVariant(
  status: string | null | undefined,
): DianEnablementVariant {
  return VARIANTS[normalize(status)];
}

/** ¿La DIAN aprobó el set de habilitación? */
export function isTestSetApproved(status: string | null | undefined): boolean {
  return APPROVED.has(normalize(status));
}

/** ¿La emisión en producción ya está habilitada por la DIAN? */
export function isProductionEnabled(
  status: string | null | undefined,
): boolean {
  return normalize(status) === 'enabled';
}
