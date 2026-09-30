/**
 * Descuento general (de pie) de la precarga — QUI-855.
 *
 * UNA sola regla de unidad, compartida por el modal y por `pop.component`:
 *
 *  - Si alguna línea vigente entra por el camino multi-impuesto (BRUTO
 *    impreso) y la factura trae el descuento tal como se imprimió
 *    (`discount_amount_printed`), el descuento general se trabaja en BRUTO.
 *  - En cualquier otro caso se trabaja en NETO (`discount_amount`, aplanado
 *    por el backend).
 *
 * El modal siembra la señal en la unidad que corresponde y, al confirmar,
 * emite la cifra EDITADA en el campo de esa unidad. `pop.component` sólo lee:
 * `discount_amount_printed` (si es número, incluso 0) cuando hay líneas con
 * `taxes`; si no, `discount_amount`. Así el carrito recibe siempre lo que el
 * operador vio.
 */
import type {
  InvoiceScanResult,
  MatchedLineItem,
} from '../interfaces/invoice-scanner.interface';
import { scanLineHasTaxes } from './scan-line-to-cart.util';

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number): number => Math.round(n * 100) / 100;

type HeaderDiscountFields = Pick<
  InvoiceScanResult,
  'discount_amount' | 'discount_amount_printed'
>;

/** ¿El descuento general debe trabajarse en BRUTO (impreso)? */
export function isHeaderDiscountGross(
  scan: HeaderDiscountFields | null | undefined,
  keptItems: readonly Pick<MatchedLineItem, 'taxes'>[],
): boolean {
  return (
    num(scan?.discount_amount_printed) > 0 &&
    keptItems.some((i) => scanLineHasTaxes(i))
  );
}

/** Valor inicial del descuento general y su unidad. */
export function seedHeaderDiscount(
  scan: HeaderDiscountFields | null | undefined,
  keptItems: readonly Pick<MatchedLineItem, 'taxes'>[],
): { value: number; gross: boolean } {
  const gross = isHeaderDiscountGross(scan, keptItems);
  const value = gross
    ? num(scan?.discount_amount_printed)
    : num(scan?.discount_amount);
  return { value: Math.max(0, value), gross };
}

/**
 * Cifra editada → los dos campos del `scanResult` que se emite. En BRUTO:
 * `discount_amount_printed` = la cifra y `discount_amount` = su equivalente
 * neto (proporción original neto/impreso). En NETO: `discount_amount` = la
 * cifra e `discount_amount_printed` = null.
 */
export function editedHeaderDiscountFields(
  scan: HeaderDiscountFields,
  value: number,
  gross: boolean,
  seed?: number,
): { discount_amount: number | null; discount_amount_printed: number | null } {
  // Sin descuento de origen y sin edición: no se emite cifra alguna (null), así
  // un escaneo sin descuento no pisa el que el usuario tecleó en el carrito.
  if (seed !== undefined && !(seed > 0) && !(value > 0)) {
    return { discount_amount: null, discount_amount_printed: null };
  }
  if (!gross) {
    return { discount_amount: value, discount_amount_printed: null };
  }
  const printed = num(scan.discount_amount_printed);
  const ratio = printed > 0 ? num(scan.discount_amount) / printed : 1;
  return {
    discount_amount: round2(value * ratio),
    discount_amount_printed: value,
  };
}

/**
 * Lo que `pop.component` entrega a `setDiscountAmount`; `null` ⇒ no hay cifra
 * que aplicar (no se toca el descuento del carrito). Un 0 EXPLÍCITO es una
 * edición del operador y sí se aplica.
 */
export function resolveCartHeaderDiscount(
  scan: HeaderDiscountFields | null | undefined,
  items: readonly Pick<MatchedLineItem, 'taxes'>[],
): number | null {
  const isNum = (v: unknown): v is number =>
    v != null && Number.isFinite(Number(v));
  const hasTaxes = items.some((i) => scanLineHasTaxes(i));
  const printed = scan?.discount_amount_printed;
  if (hasTaxes && isNum(printed)) return Math.max(0, Number(printed));
  const net = scan?.discount_amount;
  return isNum(net) ? Math.max(0, Number(net)) : null;
}
