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
 *
 * ─── CENTAVOS ENTEROS (CP-facturacion-impuesto-incluido-redondeo, A.3) ──────
 *
 * El preview espeja el desglose del motor en centavos enteros con la MISMA
 * regla trunc+absorb: `B0 = trunc(G / (1 + Σr))`, cuotas
 * `trunc(base × r)`, y si `base + Σcuotas < bruto` se sube la base de a 1¢
 * recalculando cada cuota hasta que cierra contra el bruto. La cuota siempre
 * se deriva de la base final por truncado, así la regla DIAN
 * (`TaxAmount = TaxableAmount × Percent`) se cumple por construcción.
 *
 * F-002/F-011/F-012: la paridad es de DESGLOSE, no solo de total. El caso
 * discriminante es $100 con IVA 19 %: redondear daría base 84.03/cuota 15.97;
 * truncar+absorber da base 84.04/cuota 15.96, igual que el motor.
 *
 * F-040: el loop vive en centavos enteros con cota fija y fallback
 * `<= bruto` (closest-below, jamás overshoot — ADR-04), así que termina por
 * construcción. Los resultados se memoizan por firma de entrada: costo O(1)
 * por keystroke para las filas no editadas.
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
  /**
   * Los mismos cinco importes en centavos enteros. Los agregados del documento
   * (`totals()`, `taxBreakdown()`) DEBEN sumar estos enteros, nunca los
   * `number` de arriba con `+=`: sumar floats en N líneas acumula residuo
   * binario ≥ 1¢ (F-015) contra el `dianSum` del servidor.
   */
  grossCents: number;
  baseCents: number;
  inclusiveCents: number;
  additionalCents: number;
  totalCents: number;
  /**
   * Cuota truncada por impuesto, en centavos, sobre la base FINAL. Es lo que
   * `taxBreakdown()` agrega por cubeta para igualar `invoice_taxes`
   * (cabecera = Σ líneas truncadas, DB-03).
   */
  taxes: ReadonlyArray<InvoiceLineTaxCents>;
  /**
   * Residuo no absorbible en centavos (`bruto − (base + Σcuotas inclusivas)`),
   * 0 cuando cierra. Espejo del `unclosed_residual_cents` del motor (ADR-04):
   * con multi-tasa la función salta el bruto por escalón y el cierre exacto es
   * inalcanzable; el preview lo expone en vez de colgar o sobrecobrar.
   */
  unclosedResidualCents: number;
}

/** Cuota de UN impuesto de la línea, ya truncada a centavos enteros. */
export interface InvoiceLineTaxCents {
  tax_rate_id: number | null;
  /** Tarifa normalizada a PORCENTAJE (ver `normalizeRatePercent`). */
  ratePercent: number;
  /** Estricto `=== true`: cualquier otro valor es adicional (F-035). */
  isInclusive: boolean;
  /** `trunc(baseFinal × tarifa)` en centavos. */
  cents: number;
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
   * como $28.000 el gramo). Llega aquí como DATO DEL CATÁLOGO adjunto al ítem,
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
 * Cota del loop de absorción, en pasos de 1¢.
 *
 * Rango que fija F-033 (8–16 iteraciones); se toma el techo. El residuo real
 * está acotado por el número de tasas + 1 (cada paso gana ≥ 1¢ y el residuo
 * inicial es de 1–2¢ en tasa única), así que 16 sobra con margen y sigue
 * siendo una terminación probada. A.2 usa la MISMA cota en el kernel del
 * motor: cambiarla aquí sin cambiarla allá re-diverge el preview (ADR-01).
 */
export const INCLUSIVE_ABSORB_CAP_CENTS = 16;

/** Escala entera para fracciones de tarifa (partes por millón). */
const RATE_PPM_SCALE = 1_000_000;
/**
 * Denominador entero de `cuota_cents = base_cents × ppm / RATE_PPM_DIVISOR`.
 * Es la MISMA escala (10⁶): la base ya viene en centavos y la fracción en
 * millonésimas, así que el cociente sale directo en centavos.
 */
const RATE_PPM_DIVISOR = 1_000_000;

/**
 * Tarifa a PORCENTAJE, con guarda de unidad.
 *
 * Contrato real: el `tax-selector` ya entrega `TaxSelection.rate` en
 * porcentaje (8 = 8 %), pero del catálogo pueden colarse fracciones legadas
 * (0.08). Misma regla que `toPercent`
 * (`invoice-create/invoice-tax-catalog.service.ts`) y coherente con el
 * default de `resolveRateBasis` (`invoice-calculator.service.ts`: sin
 * `rate_basis` explícito todo lo no-ICA va en porcentaje). `> 1 ⇒
 * porcentaje`, `<= 1 ⇒ fracción × 100`. La ambigüedad de una tarifa sub-1 %
 * guardada como `1` no existe en el catálogo (se guardaría como `0.01`), así
 * que la regla es total.
 */
export function normalizeRatePercent(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const percent = value > 1 ? value : value * 100;
  return Math.round(percent * 100) / 100;
}

/**
 * Fracción de una tarifa en partes por millón (entero).
 *
 * Espejo del default de `resolveRateBasis` (`invoice-calculator.service.ts`):
 * sin `rate_basis` explícito —`TaxSelection` no lo trae— el ICA (y su
 * retención) van POR MIL y todo lo demás en porcentaje. Un ICA de 9.66 ‰ es
 * fracción 0.00966, no 0.0966: dividirlo entre 100 cobraría diez veces el
 * tributo debido (F-032).
 */
function rateFractionPpm(ratePercent: number, taxType: unknown): number {
  const type = String(taxType ?? '').trim().toLowerCase();
  const perMil = type === 'ica' || type === 'reteica';
  return Math.round(ratePercent * (perMil ? 1000 : 10000));
}

/** `true` solo con el booleano `true` (F-035: tres predicados distintos). */
function isInclusiveTax(tax: TaxSelection | null | undefined): boolean {
  return (tax?.is_inclusive as unknown) === true;
}

/**
 * Saneo de tarifa del espejo (`sanitizeRate` en `tax-inclusive-math.util.ts`):
 * finita y positiva, o 0. Nunca lanza, nunca negativiza el despeje.
 */
function sanitizeRatePpm(ppm: number): number {
  return Number.isFinite(ppm) && ppm > 0 ? Math.round(ppm) : 0;
}

/**
 * Cuota truncada DIAN en centavos: `floor(base × fracción)`, todo entero.
 *
 * `baseCents × ppm` es exacto en doubles para importes realistas (< $10M por
 * línea); la división redondea ≤ ½ ulp, muy por debajo de la granularidad de
 * 10⁻⁸ del cociente exacto, así que el `floor` cae del lado correcto.
 */
function quotaCents(baseCents: number, ppm: number): number {
  if (baseCents <= 0 || ppm <= 0) return 0;
  return Math.floor((baseCents * ppm) / RATE_PPM_DIVISOR);
}

/**
 * Bruto a centavos con TRUNCADO DIAN (Anexo 1.9 §11.2), nunca redondeo.
 *
 * El `+ 1e-6` no es redondeo: es el épsilon que devuelve el artefacto binario
 * (`19.99 × 100 = 1998.9999999999998`) a su entero, cien veces por debajo de
 * la granularidad real del neto (10⁻⁴ ¢ con precios de 6 decimales).
 */
function truncNetToCents(net: number): number {
  if (!Number.isFinite(net) || net <= 0) return 0;
  return Math.floor(net * 100 + 1e-6);
}

/** Núcleo en centavos: despeje + cuotas + absorción acotada + fallback. */
interface LineCents {
  grossCents: number;
  baseCents: number;
  taxes: InvoiceLineTaxCents[];
  inclusiveCents: number;
  additionalCents: number;
  totalCents: number;
  unclosedResidualCents: number;
}

function computeLineCents(
  grossCents: number,
  taxes: TaxSelection[],
): LineCents {
  const normalized = taxes.map((tax) => ({
    tax_rate_id:
      Number.isFinite(Number(tax?.tax_rate_id)) && Number(tax?.tax_rate_id) > 0
        ? Number(tax?.tax_rate_id)
        : null,
    ratePercent: normalizeRatePercent(tax?.rate),
    isInclusive: isInclusiveTax(tax),
    ppm: sanitizeRatePpm(
      rateFractionPpm(normalizeRatePercent(tax?.rate), tax?.tax_type),
    ),
  }));

  const inclusive = normalized.filter((t) => t.isInclusive && t.ppm > 0);

  let baseCents = grossCents;
  if (inclusive.length > 0 && grossCents > 0) {
    const divisor = 1 + inclusive.reduce((sum, t) => sum + t.ppm / RATE_PPM_SCALE, 0);
    // B0 en float y AJUSTE hacia abajo: si el error binario del divisor dejó
    // B0 1–2¢ por encima, `f(B0) > bruto` y se baja hasta volver al rango.
    // Termina porque `baseCents` decrece estricto hasta 0 (`f(0) = 0`).
    baseCents = Math.floor(grossCents / divisor);
    const f = (b: number): number =>
      b + inclusive.reduce((sum, t) => sum + quotaCents(b, t.ppm), 0);
    while (baseCents > 0 && f(baseCents) > grossCents) baseCents -= 1;
    // Absorción: se sube de a 1¢ recalculando cada cuota por truncado hasta
    // cerrar contra el bruto. Cota fija (F-033/F-040) y NUNCA overshoot: al
    // agotar la cota se queda la mejor base con `f ≤ bruto` (ADR-04).
    let steps = 0;
    while (
      steps < INCLUSIVE_ABSORB_CAP_CENTS &&
      f(baseCents + 1) <= grossCents
    ) {
      baseCents += 1;
      steps += 1;
    }
    const closed = f(baseCents);
    const residual = grossCents - closed;
    return finishLine(grossCents, baseCents, normalized, residual);
  }

  return finishLine(grossCents, baseCents, normalized, 0);
}

/** Cuotas sobre la base FINAL + total que cierra por construcción. */
function finishLine(
  grossCents: number,
  baseCents: number,
  normalized: Array<{
    tax_rate_id: number | null;
    ratePercent: number;
    isInclusive: boolean;
    ppm: number;
  }>,
  unclosedResidualCents: number,
): LineCents {
  const taxes: InvoiceLineTaxCents[] = normalized.map((t) => ({
    tax_rate_id: t.tax_rate_id,
    ratePercent: t.ratePercent,
    isInclusive: t.isInclusive,
    cents: quotaCents(baseCents, t.ppm),
  }));
  let inclusiveCents = 0;
  let additionalCents = 0;
  for (const q of taxes) {
    if (q.isInclusive) inclusiveCents += q.cents;
    else additionalCents += q.cents;
  }
  // Sin inclusivo el total es el bruto + lo adicional (idéntico a ayer cuando
  // no hay inclusivo: base = bruto). Con inclusivo, base + cuotas = bruto
  // cuando cierra, o closest-below con el residuo expuesto (jamás overshoot).
  const totalCents = baseCents + inclusiveCents + additionalCents;
  return {
    grossCents,
    baseCents,
    taxes,
    inclusiveCents,
    additionalCents,
    totalCents,
    unclosedResidualCents: Math.max(0, Math.round(unclosedResidualCents)),
  };
}

/**
 * Firma de memoización: todo lo que entra a la fórmula, normalizado. `8` y
 * `0.08` dan la misma firma porque la unidad se normaliza ANTES (F-013); el
 * nombre del impuesto no entra porque no mueve ni un centavo.
 */
function lineSignature(line: InvoiceLineMathInput): string {
  const taxes = Array.isArray(line?.taxes) ? line.taxes : [];
  const taxSig = taxes
    .map(
      (t) =>
        `${Number(t?.tax_rate_id) || 0}:${normalizeRatePercent(t?.rate)}:${isInclusiveTax(t) ? 1 : 0}:${String(t?.tax_type ?? '').trim().toLowerCase()}`,
    )
    .join(',');
  return `${Number(line?.quantity) || 0}|${Number(line?.unit_price) || 0}|${Number(line?.discount_amount) || 0}|${Number(line?.price_unit_quantity) || 0}|${taxSig}`;
}

/**
 * Caché por firma. 500 entradas bastan para la factura más larga sin crecer
 * sin cota; al llenarse se vacía entera (recomputar es barato, fugar no).
 */
const lineMathCache = new Map<string, InvoiceLineMath>();
const LINE_MATH_CACHE_MAX = 500;

/** Vacía la caché del preview. Solo para specs. */
export function clearLineMathCache(): void {
  lineMathCache.clear();
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
 *
 * Memoizada por firma de entrada: las filas no editadas salen de caché en O(1)
 * por keystroke (F-040). El objeto devuelto es de solo lectura: mutarlo
 * envenena la caché para todas las pantallas.
 */
export function computeLineMath(line: InvoiceLineMathInput): InvoiceLineMath {
  const signature = lineSignature(line);
  const cached = lineMathCache.get(signature);
  if (cached) return cached;

  const grossCents = truncNetToCents(lineGrossNet(line));
  const taxes = Array.isArray(line?.taxes) ? line.taxes : [];
  const cents = computeLineCents(grossCents, taxes);
  const result: InvoiceLineMath = {
    gross: cents.grossCents / 100,
    base: cents.baseCents / 100,
    taxInclusive: cents.inclusiveCents / 100,
    taxAdditional: cents.additionalCents / 100,
    total: cents.totalCents / 100,
    grossCents: cents.grossCents,
    baseCents: cents.baseCents,
    inclusiveCents: cents.inclusiveCents,
    additionalCents: cents.additionalCents,
    totalCents: cents.totalCents,
    taxes: cents.taxes,
    unclosedResidualCents: cents.unclosedResidualCents,
  };
  if (lineMathCache.size >= LINE_MATH_CACHE_MAX) lineMathCache.clear();
  lineMathCache.set(signature, result);
  return result;
}

/**
 * Neto SIN truncar ni recortar: `(cantidad × precio) ÷ divisor − descuento`.
 * El recorte a cero y el truncado a centavos los hace el núcleo, una sola vez.
 */
function lineGrossNet(line: InvoiceLineMathInput): number {
  const quantity = Number(line?.quantity) || 0;
  const price = Number(line?.unit_price) || 0;
  const discount = Number(line?.discount_amount) || 0;
  return (
    (quantity * price) / priceUnitDivisor(line?.price_unit_quantity) - discount
  );
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
 *
 * Se conserva en `number` para los llamadores históricos (puerta de
 * descuento, resúmenes). El núcleo del despeje usa su propia versión en
 * centavos truncados; para importes cuerdos ambas coinciden al centavo.
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
 * Agregado del documento en centavos enteros (F-015).
 *
 * Suma los `*Cents` ya truncados línea por línea —el espejo de `dianSum`— en
 * vez de acumular los `number` con `+=`: en 40 líneas el residuo binario del
 * float acumula ≥ 1¢ contra la cabecera que el servidor persiste.
 *
 * `shares` escala SOLO el impuesto (Modelo 1 AIU: la línea vale el contrato y
 * grava una porción); fuera del Modelo 1 es `1` y el agregado es la suma
 * exacta. `discounts` son los descuentos por línea en la unidad que vengan
 * (el descuento no entra al despeje, solo resta informativo en el panel).
 */
export interface PreviewTotals {
  base: number;
  discount: number;
  taxInclusive: number;
  taxAdditional: number;
  total: number;
}

export function aggregatePreviewTotals(
  math: ReadonlyArray<InvoiceLineMath>,
  discounts: ReadonlyArray<number | string | null | undefined>,
  shares: ReadonlyArray<number>,
): PreviewTotals {
  let baseCents = 0;
  let discountCents = 0;
  let inclusiveCents = 0;
  let additionalCents = 0;
  let totalCents = 0;
  for (let i = 0; i < math.length; i++) {
    const line = math[i];
    if (!line) continue;
    const share = shares[i] ?? 1;
    baseCents += line.baseCents;
    inclusiveCents += Math.round(line.inclusiveCents * share);
    additionalCents += Math.round(line.additionalCents * share);
    // El importe de la línea NO se escala —es el `line_extension_amount` que
    // el contrato pactó—: solo se mueve el impuesto (misma regla que el
    // `totals()` del que esto sale).
    totalCents +=
      line.baseCents +
      Math.round((line.inclusiveCents + line.additionalCents) * share);
    const discount = Number(discounts[i]) || 0;
    discountCents += Math.round(discount * 100);
  }
  return {
    base: baseCents / 100,
    discount: discountCents / 100,
    taxInclusive: inclusiveCents / 100,
    taxAdditional: additionalCents / 100,
    total: totalCents / 100,
  };
}

/** Fila del desglose agregado por `(impuesto, tarifa, aplicación)`. */
export interface PreviewTaxRow {
  key: string;
  name: string;
  rate: number;
  isInclusive: boolean;
  base: number;
  amount: number;
}

/**
 * Agregado por cubeta igual que `invoice_taxes`: Σ de cuotas YA truncadas por
 * línea (DB-03: cabecera = Σ líneas truncadas). La cuota sale del `taxes[]`
 * del núcleo —truncada sobre la base final—, nunca de `base × tarifa / 100`
 * en float (F-012: eso daba 222.222 contra 222.22 del servidor).
 */
export function aggregatePreviewTaxBreakdown(
  items: ReadonlyArray<{ taxes?: TaxSelection[] | null }>,
  math: ReadonlyArray<InvoiceLineMath>,
): PreviewTaxRow[] {
  const rows = new Map<string, PreviewTaxRow & { baseCents: number; amountCents: number }>();
  for (let i = 0; i < items.length; i++) {
    const taxes = Array.isArray(items[i]?.taxes) ? items[i].taxes : [];
    const details = math[i]?.taxes ?? [];
    const baseCents = math[i]?.baseCents ?? 0;
    for (let j = 0; j < taxes.length; j++) {
      const tax = taxes[j];
      const detail = details[j];
      const rate = normalizeRatePercent(tax?.rate);
      const isInclusive = isInclusiveTax(tax);
      const key = `${Number(tax?.tax_rate_id) || 0}|${rate}|${isInclusive ? 1 : 0}`;
      const cents = detail ? detail.cents : 0;
      const existing = rows.get(key);
      if (existing) {
        existing.baseCents += baseCents;
        existing.amountCents += cents;
        existing.base = existing.baseCents / 100;
        existing.amount = existing.amountCents / 100;
      } else {
        rows.set(key, {
          key,
          name: String(tax?.name ?? ''),
          rate,
          isInclusive,
          base: baseCents / 100,
          amount: cents / 100,
          baseCents,
          amountCents: cents,
        });
      }
    }
  }
  // Proyección explícita (sin `...rest`): ni un campo interno viaja a la fila.
  return [...rows.values()].map((row) => ({
    key: row.key,
    name: row.name,
    rate: row.rate,
    isInclusive: row.isInclusive,
    base: row.base,
    amount: row.amount,
  }));
}

// ─── Total en letras (referencia de comprensión, NO valor legal) ────────────
//
// El valor LEGAL en letras lo compone el servidor con `amountToSpanishWords`
// sobre el snapshot persistido (ver `fiscal-document-print.mapper.ts`). Esto
// es la misma frase calculada en el navegador para que el operador lea las
// letras del total que está por emitir. Espejo intencional y acotado: solo
// forma adjetiva masculina (`pesos`/`centavos`), hasta 10¹² − 1, truncando a
// 2 decimales como el §11.2.

const WORDS_SMALL: readonly string[] = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho',
  'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis',
  'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós',
  'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete',
  'veintiocho', 'veintinueve',
];

const WORDS_TENS: readonly string[] = [
  '', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta',
  'ochenta', 'noventa',
];

const WORDS_HUNDREDS: readonly string[] = [
  '', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos',
];

/** 0–999 en forma adjetiva masculina (`un`, `veintiún`, `ciento un`). */
function wordsBelow1000(n: number): string {
  if (n < 30) {
    if (n === 1) return 'un';
    if (n === 21) return 'veintiún';
    return WORDS_SMALL[n];
  }
  if (n < 100) {
    const ten = Math.floor(n / 10);
    const unit = n % 10;
    if (unit === 0) return WORDS_TENS[ten];
    return `${WORDS_TENS[ten]} y ${unit === 1 ? 'un' : WORDS_SMALL[unit]}`;
  }
  if (n === 100) return 'cien';
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  return rest === 0
    ? WORDS_HUNDREDS[hundred]
    : `${WORDS_HUNDREDS[hundred]} ${wordsBelow1000(rest)}`;
}

/** 0–999 999 (`mil` invariable, sin «un» delante). */
function wordsBelow1e6(n: number): string {
  if (n < 1000) return wordsBelow1000(n);
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const head = thousands === 1 ? 'mil' : `${wordsBelow1000(thousands)} mil`;
  return rest === 0 ? head : `${head} ${wordsBelow1000(rest)}`;
}

/** Entero a letras adjetivas masculinas, hasta 10¹² − 1 (escala larga). */
function wordsInteger(n: number): string {
  if (n < 1e6) return wordsBelow1e6(n);
  const millions = Math.floor(n / 1e6);
  const rest = n % 1e6;
  const head =
    millions === 1 ? 'un millón' : `${wordsBelow1e6(millions)} millones`;
  return rest === 0 ? head : `${head} ${wordsBelow1e6(rest)}`;
}

/** `millón/millones` son sustantivos: llevan «de» (`un millón DE pesos`). */
function countedWords(count: number, singular: string, plural: string): string {
  const numeral = wordsInteger(count);
  const noun = count === 1 ? singular : plural;
  const link =
    numeral === 'un millón' || numeral.endsWith(' millones') ? ' de ' : ' ';
  return `${numeral}${link}${noun}`;
}

/**
 * Total a letras con el mismo contrato visible que el servidor: entero en
 * pesos, fracción no-cero en centavos, sufijo `M/CTE`.
 *
 * Lee el importe como texto decimal y trunca a 2 (nunca `Math.round(x*100)`:
 * la coma flotante reintroduce el error que el truncado quiere evitar).
 * Devuelve `null` con entrada no numérica: el preview nunca rompe el render
 * por una línea de referencia.
 */
export function previewTotalInWords(
  total: number | string | null | undefined,
): string | null {
  const raw = typeof total === 'number'
    ? Number.isFinite(total) ? String(total) : ''
    : String(total ?? '').trim();
  const match = /^([+-]?)(\d*)(?:[.,](\d*))?/.exec(raw);
  if (!match || (!match[2] && !match[3])) return null;
  const integer = Number((match[2] || '0').replace(/^0+(?=\d)/, ''));
  const fraction = Number((match[3] || '').slice(0, 2).padEnd(2, '0'));
  if (!Number.isSafeInteger(integer) || integer >= 1e12) return null;
  if (!Number.isSafeInteger(fraction)) return null;
  const segments: string[] = [];
  if (match[1] === '-' && (integer > 0 || fraction > 0)) segments.push('menos');
  segments.push(countedWords(integer, 'peso', 'pesos'));
  if (fraction > 0) segments.push('con', countedWords(fraction, 'centavo', 'centavos'));
  segments.push('M/CTE');
  return segments.join(' ').toLocaleUpperCase('es-CO');
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
