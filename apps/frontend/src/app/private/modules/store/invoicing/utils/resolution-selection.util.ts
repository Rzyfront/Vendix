import { InvoiceResolution } from '../interfaces/invoice.interface';
import { isHabilitationNumbering } from '../../../../../shared/utils/habilitation-numbering.util';

/**
 * Vigencia y orden de las resoluciones de numeración, en UN solo lugar.
 *
 * ## Por qué compartido y no copiado en cada pantalla
 *
 * Dos pantallas deciden sobre el mismo rango autorizado: la creación de factura
 * —qué resolución puede numerar HOY— y el editor de perfiles —cuál se prefiere
 * para el futuro—. Son preguntas distintas sobre el MISMO predicado de
 * vigencia, y una segunda implementación de un predicado fiscal es una grieta
 * invisible: cada lado pasa sus propias pruebas y la divergencia sólo aparece
 * el día en que una vigencia empieza o termina.
 *
 * Acá viven los predicados; la POLÍTICA de cada pantalla (filtrar, marcar,
 * preseleccionar) se queda en la pantalla, que es donde cambia.
 */

/**
 * Recorta un valor de fecha a su parte `YYYY-MM-DD`.
 *
 * `valid_from` / `valid_to` / `resolution_date` son fechas-sola guardadas en
 * columnas de marca de tiempo: llegan como `2026-01-01T00:00:00.000Z` y hay que
 * leerlas por su componente UTC. Convertirlas a `Date` local haría que una
 * vigencia que termina el día 31 se declarara vencida la tarde del 30 en
 * cualquier huso al oeste de Greenwich.
 */
export function toDateOnly(value: string | null | undefined): string {
  return value ? String(value).slice(0, 10) : '';
}

/** `true` cuando `today` (YYYY-MM-DD local) cae dentro de la vigencia declarada. */
export function isWithinValidity(
  res: InvoiceResolution,
  today: string,
): boolean {
  const from = toDateOnly(res.valid_from);
  const to = toDateOnly(res.valid_to);
  // Una vigencia sin declarar no descalifica: la resolución existe y el backend
  // la acepta. Lo que descalifica es una vigencia declarada que ya no cubre hoy.
  if (from && today < from) return false;
  if (to && today > to) return false;
  return true;
}

/** `true` cuando al rango todavía le queda consecutivo por gastar. */
export function hasRemainingRange(res: InvoiceResolution): boolean {
  return Number(res.current_number) < Number(res.range_to);
}

/** El siguiente consecutivo que gastaría este rango. */
export function nextConsecutive(res: InvoiceResolution): number {
  return (
    Math.max(
      Number(res.current_number) || 0,
      (Number(res.range_from) || 0) - 1,
    ) + 1
  );
}

/**
 * Orden TOTAL de las resoluciones, de la más antigua a la más nueva.
 *
 * El desempate encadenado existe porque el empate es un caso real, no teórico:
 * dos resoluciones de factura de venta pueden compartir `resolution_date`. Sin
 * un criterio que llegue hasta el `id`, `Array.sort` conservaría el orden en que
 * llegó el arreglo y la preselección cambiaría sola entre recargas.
 */
export function compareResolutionsByAge(
  a: InvoiceResolution,
  b: InvoiceResolution,
): number {
  const aDate = toDateOnly(a.resolution_date) || toDateOnly(a.valid_from);
  const bDate = toDateOnly(b.resolution_date) || toDateOnly(b.valid_from);
  if (aDate !== bDate) return aDate < bDate ? -1 : 1;

  const aFrom = toDateOnly(a.valid_from);
  const bFrom = toDateOnly(b.valid_from);
  if (aFrom !== bFrom) return aFrom < bFrom ? -1 : 1;

  const aCreated = String(a.created_at ?? '');
  const bCreated = String(b.created_at ?? '');
  if (aCreated !== bCreated) return aCreated < bCreated ? -1 : 1;

  return (Number(a.id) || 0) - (Number(b.id) || 0);
}

/**
 * El orden con el que se PINTA un selector: producción primero, pruebas al
 * final, y dentro de cada grupo de la más antigua a la más nueva.
 *
 * El grupo va ANTES que la antigüedad a propósito. La numeración de habilitación
 * es de 2019 en la mayoría de los tenants, así que ordenar solo por antigüedad
 * la dejaría siempre primera — encabezando la lista y quedando preseleccionada
 * justo el rango que jamás debe emitir una factura real.
 */
export function compareResolutionsForSelection(
  a: InvoiceResolution,
  b: InvoiceResolution,
): number {
  const aTest = isHabilitationNumbering(a) ? 1 : 0;
  const bTest = isHabilitationNumbering(b) ? 1 : 0;
  if (aTest !== bTest) return aTest - bTest;
  return compareResolutionsByAge(a, b);
}
