import { print_format_type_enum } from '@prisma/client';

/**
 * Formatos que NINGUNA tienda puede desactivar. Decisión del dueño: el
 * reporte de cierre de caja debe poder imprimirse siempre.
 *
 * Fuente única de la regla: la leen el gateway (config efectiva y compuerta de
 * render), el servicio (listado, detalle, update) y, vía `always_active`, el
 * frontend. Una fila guardada con `is_active=false` se ignora al leer.
 */
export const ALWAYS_ACTIVE_FORMAT_TYPES: ReadonlySet<print_format_type_enum> =
  new Set<print_format_type_enum>(['cash_session_close']);

export function isAlwaysActiveFormat(
  formatType: print_format_type_enum,
): boolean {
  return ALWAYS_ACTIVE_FORMAT_TYPES.has(formatType);
}
