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
  /**
   * Bruto NETO de la línea: `(cantidad × precio) ÷ price_unit_quantity −
   * descuento`, recortado a cero. Es el espejo exacto de
   * `lineExtensionDecimal` (`dian-money.util.ts`): primero se escala el precio,
   * DESPUÉS se resta el descuento — el descuento es un importe absoluto de la
   * línea y no se divide.
   */
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
  /**
   * Escala del precio publicado (`products.price_unit_quantity`, QUI-648): a
   * cuántas unidades de la cantidad declarada corresponde `unit_price`. Un
   * producto a $18.000 la docena con escala 12 y cantidad 1 vale **$1.500**,
   * no $18.000 — sin el divisor la pantalla enseña N veces el importe que el
   * servidor declara en `cbc:LineExtensionAmount`.
   *
   * NO se captura por formulario: el backend ni siquiera lo acepta del request
   * (`invoicing.service.ts` lo resuelve del producto a propósito, porque
   * permitirlo por el cuerpo dejaría facturar un producto a $28.000 el kilo
   * como $28.000 el gramo). Llega aquí como DATO DEL CATÁLIGO adjunto al ítem,
   * igual que `product_name`.
   *
   * Fallback idéntico al del backend (`priceUnitDivisor`, `dian-money.util.ts`):
   * ausente, 0, 1, negativo o no numérico ⇒ divisor 1, la aritmética histórica
   * de todo el catálogo por pieza.
   */
  price_unit_quantity?: number | string | null;
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
 * Bruto NETO de la línea, RECORTADO A CERO.
 *
 * Espejo de `lineExtensionDecimal` (`dian-money.util.ts`): el precio se escala
 * por la *price unit* ANTES de restar el descuento. Invertir el orden —dividir
 * `(cantidad × precio − descuento)`— declararía un importe que el servidor no
 * calcula y el usuario volvería a ver una cifra en pantalla y otra en la
 * factura.
 *
 * El recorte es la razón por la que existe `lineDiscountExceedsSubtotal`: un
 * descuento mayor que el bruto escalado no produce ni un error ni un número
 * negativo — produce una línea de cero que la DIAN acepta y que nadie cobra.
 */
export function lineGross(line: InvoiceLineMathInput): number {
  const quantity = Number(line?.quantity) || 0;
  const price = Number(line?.unit_price) || 0;
  const discount = Number(line?.discount_amount) || 0;
  return Math.max((quantity * price) / priceUnitDivisor(line?.price_unit_quantity) - discount, 0);
}

/**
 * Divisor de la *price unit*: un número > 1, o 1.
 *
 * ESPEJO EXACTO de `priceUnitDivisor` (`dian-money.util.ts`) — idéntico, no
 * parecido: ausente, 0, 1, negativo o no numérico ⇒ 1. Se sanea aquí y no en
 * los llamadores para que ningún camino pueda dividir por cero ni por un
 * negativo y convertir una previsión en basura.
 */
function priceUnitDivisor(value: number | string | null | undefined): number {
  const n = Number(value);
  return n > 1 ? n : 1;
}

/**
 * `true` cuando el descuento se come la línea entera o más.
 *
 * Decide sobre el BRUTO YA ESCALADO — `(cantidad × precio) ÷
 * price_unit_quantity` — porque es contra ese importe contra el que el servidor
 * compara: un descuento que con el bruto inflado parece holgado tumba la línea
 * con `LINE_AMOUNT_NEGATIVE` en cuanto la escala entra a la fórmula.
 *
 * Se pregunta explícitamente porque `computeLineMath` ya no lo puede delatar:
 * después del recorte, «descuento igual al subtotal» y «descuento del triple
 * del subtotal» son el mismo cero.
 */
export function lineDiscountExceedsSubtotal(line: InvoiceLineMathInput): boolean {
  const quantity = Number(line?.quantity) || 0;
  const price = Number(line?.unit_price) || 0;
  const discount = Number(line?.discount_amount) || 0;
  const subtotal = (quantity * price) / priceUnitDivisor(line?.price_unit_quantity);
  return discount > 0 && subtotal > 0 && discount >= subtotal;
}
