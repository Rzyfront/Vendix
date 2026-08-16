import type { TaxSelection } from '../../../../../shared/components/tax-selector';

/**
 * ARITMÉTICA DE UNA LÍNEA DE FACTURA — UNA SOLA VEZ, PARA TODAS LAS PANTALLAS.
 *
 * Vivía dentro de `invoice-create.component.ts` como un `computed` privado. Se
 * extrae porque el modal de configuración avanzada de un ítem tiene que enseñar
 * EL MISMO total que va a aparecer en la tabla de líneas: dos copias de esta
 * fórmula divergen a la primera corrección, y la divergencia no da error — da
 * dos cifras distintas para el mismo renglón, una en el modal y otra en la
 * factura.
 *
 * ─── LO QUE ESTO NO ES ──────────────────────────────────────────────────────
 *
 * NO es el cálculo definitivo. El servidor recalcula el documento entero con
 * `Prisma.Decimal` y su resultado es el que se declara a la DIAN. Esto es la
 * PREVISIÓN que ve el usuario mientras captura; el payload viaja con
 * `tax_amount: 0` a propósito para que no exista una segunda verdad.
 */

export interface InvoiceLineMath {
  /** `cantidad × precio − descuento`, tal como lo teclea el usuario. */
  gross: number;
  /** Base gravable (`cbc:LineExtensionAmount`): el bruto sin impuesto incluido. */
  base: number;
  taxInclusive: number;
  taxAdditional: number;
  total: number;
}

/**
 * Forma mínima que necesita la fórmula. Se declara laxa (`number | string`)
 * porque los valores llegan de un `FormControl` y un `<input type="number">`
 * entrega string mientras el usuario teclea.
 */
export interface InvoiceLineMathInput {
  quantity?: number | string | null;
  unit_price?: number | string | null;
  discount_amount?: number | string | null;
  taxes?: TaxSelection[] | null;
}

/**
 * Desglose de una línea.
 *
 * El bruto que se teclea NO es la base gravable: cuando el impuesto va incluido
 * en el precio, la base es el bruto despejado (`bruto / (1 + Σtarifas
 * incluidas)`). El backend persiste exactamente eso en `subtotal_amount` —la Σ
 * de los `cbc:LineExtensionAmount`—, así que el panel de totales tiene que
 * hablar el mismo idioma o el usuario ve una cifra en pantalla y otra en la
 * factura.
 */
export function computeLineMath(line: InvoiceLineMathInput): InvoiceLineMath {
  const gross = lineGross(line);
  const taxes = Array.isArray(line?.taxes) ? line.taxes : [];

  let inclusiveRate = 0;
  let additionalRate = 0;
  for (const tax of taxes) {
    const rate = Number(tax?.rate) || 0;
    if (tax?.is_inclusive) inclusiveRate += rate;
    else additionalRate += rate;
  }

  const base = inclusiveRate > 0 ? gross / (1 + inclusiveRate / 100) : gross;
  const taxInclusive = gross - base;
  const taxAdditional = (base * additionalRate) / 100;

  return {
    gross,
    base,
    taxInclusive,
    taxAdditional,
    total: base + taxInclusive + taxAdditional,
  };
}

/**
 * Bruto de la línea, RECORTADO A CERO.
 *
 * El recorte es la razón por la que existe `lineDiscountExceedsSubtotal`: un
 * descuento mayor que `cantidad × precio` no produce ni un error ni un número
 * negativo — produce una línea de cero que la DIAN acepta y que nadie cobra.
 */
export function lineGross(line: InvoiceLineMathInput): number {
  const quantity = Number(line?.quantity) || 0;
  const price = Number(line?.unit_price) || 0;
  const discount = Number(line?.discount_amount) || 0;
  return Math.max(quantity * price - discount, 0);
}

/**
 * `true` cuando el descuento se come la línea entera o más.
 *
 * Se pregunta explícitamente porque `computeLineMath` ya no lo puede delatar:
 * después del recorte, «descuento igual al subtotal» y «descuento del triple
 * del subtotal» son el mismo cero.
 */
export function lineDiscountExceedsSubtotal(line: InvoiceLineMathInput): boolean {
  const quantity = Number(line?.quantity) || 0;
  const price = Number(line?.unit_price) || 0;
  const discount = Number(line?.discount_amount) || 0;
  const subtotal = quantity * price;
  return discount > 0 && subtotal > 0 && discount >= subtotal;
}
