import { Prisma } from '@prisma/client';

/**
 * Canonical monetary/rate formatting for every DIAN artifact.
 *
 * WHY THIS EXISTS — the defect it closes:
 *
 * `Prisma.Decimal` (decimal.js) drops trailing zeros on `toString()`:
 *
 *   new Prisma.Decimal('1000.00').toString()  // => '1000'   ← scale lost
 *   new Prisma.Decimal('119000.00').toString() // => '119000'
 *
 * The provider payload used to be built with `.toString()`, so the CUFE hashed
 * `'1000'` while the UBL XML emitted `parseFloat(...).toFixed(2)` = `'1000.00'`.
 * The DIAN recomputes the CUFE **from the XML it receives**, so the two hashes
 * never matched and every invoice whose subtotal or total landed on whole pesos
 * — the overwhelming majority in COP — was rejected. Taxes were already padded
 * (`.toFixed(2)`) inside the very same CUFE call, which is what made the bug
 * look like a rounding nuance instead of a scale mismatch.
 *
 * On top of that, Anexo Técnico 1.9 §11.2 (p.655-658) requires amounts
 * **TRUNCATED** to 2 decimals, not rounded. `.toFixed(2)` rounds
 * (`1000.005 -> '1000.01'`), so a half-cent could still diverge from the DIAN's
 * own recomputation.
 *
 * Both problems collapse into one rule: every value that reaches a CUFE/CUDE/CUDS
 * hash or a UBL element goes through this module, and nothing else formats money.
 *
 * @see docs/facturacion-electronica-dian-software-propio.md §20.0-bis
 */

/** Truncate toward zero — Anexo 1.9 §11.2 forbids rounding. */
const TRUNCATE = Prisma.Decimal.ROUND_DOWN;

/** DIAN emits monetary values and tax rates with exactly 2 decimals. */
const DIAN_SCALE = 2;

/**
 * `cac:Price/cbc:PriceAmount` admite hasta 6 decimales.
 *
 * No es una licencia estética: el anexo declara el formato del campo como
 * `p (0-6)` (Anexo Técnico 1.9, filas FAW03 / FBB02 / DAW03 / CAW03), mientras
 * que todo importe monetario del documento va a 2. La diferencia existe porque
 * el precio unitario no siempre es representable a 2 decimales — y el caso que
 * lo obliga es exactamente el precio con impuesto incluido: $1.000 con IVA
 * dentro son 840,336134… de base, y truncar eso a 840,33 multiplica el error
 * por la cantidad de la línea.
 *
 * Sólo se usan los 6 decimales cuando el valor los necesita (ver
 * {@link dianUnitPrice}): un precio redondo sigue emitiéndose como siempre.
 */
const DIAN_PRICE_SCALE = 6;

export type DianNumericInput =
  | string
  | number
  | Prisma.Decimal
  | null
  | undefined;

/**
 * Formats a monetary value exactly as the DIAN expects it, in the CUFE string
 * and in the XML alike: dot separator, exactly 2 decimals, truncated (never
 * rounded), no thousands separator, no currency symbol.
 *
 * Non-finite or unparseable input yields `'0.00'` rather than `'NaN'`, because a
 * `NaN` inside a CUFE concatenation produces a silently invalid hash instead of
 * a loud failure.
 *
 * ```ts
 * dianAmount(new Prisma.Decimal('1000.00')) // '1000.00'  (was '1000')
 * dianAmount('1000')                        // '1000.00'
 * dianAmount(1000.005)                      // '1000.00'  (truncated, not '1000.01')
 * dianAmount(null)                          // '0.00'
 * ```
 */
export function dianAmount(value: DianNumericInput): string {
  return formatWithScale(value, DIAN_SCALE);
}

/**
 * Formatea `cac:Price/cbc:PriceAmount`.
 *
 * Emite 2 decimales cuando el precio los agota —que es todo el catálogo
 * histórico, así que ningún documento existente cambia— y 6 sólo cuando el
 * valor tiene más precisión que esa. El campo lo permite (`p (0-6)`) y hace
 * falta para el precio despejado de una línea con impuesto incluido.
 *
 * POR QUÉ IMPORTA QUE NO SE TRUNQUE A 2 — la regla FAV06 es de RECHAZO y
 * compara `cbc:LineExtensionAmount` contra el precio unitario por la cantidad,
 * menos los descuentos de la línea. Con el precio despejado truncado a 2
 * decimales, esa igualdad se separa un centavo por unidad: una línea de 100
 * unidades se desvía un peso, y el descuadre viaja además al
 * `LineExtensionAmount` de la cabecera y al `ValFac` del CUFE.
 *
 * ```ts
 * dianUnitPrice('1000')          // '1000.00'      (sin cambio)
 * dianUnitPrice('840.336134')    // '840.336134'
 * ```
 */
export function dianUnitPrice(value: DianNumericInput): string {
  const decimal = toDecimal(value);
  const two_decimals = applyScale(decimal, DIAN_SCALE);
  // Comparar contra el valor de origen y no contra su longitud de texto: un
  // `Decimal('840.3300')` es representable a 2 decimales aunque se escriba con
  // cuatro.
  return toDecimal(two_decimals).equals(decimal)
    ? two_decimals
    : applyScale(decimal, DIAN_PRICE_SCALE);
}

/**
 * Formats a tax rate for `cac:TaxCategory/cbc:Percent`.
 *
 * Same contract as {@link dianAmount}: `invoice_taxes.tax_rate` is a
 * `Decimal(5,2)`, so `19.00` serialized to `'19'` and reached the XML without
 * decimals. The DIAN validates the percent against `base × tarifa`, and the
 * declared scale is part of the document contract.
 *
 * ```ts
 * dianRate(new Prisma.Decimal('19.00')) // '19.00'  (was '19')
 * ```
 */
export function dianRate(value: DianNumericInput): string {
  return formatWithScale(value, DIAN_SCALE);
}

/**
 * Sums already-formatted or raw amounts and returns the DIAN-formatted total.
 *
 * Used to make `LegalMonetaryTotal/LineExtensionAmount` the exact sum of the
 * line-level `LineExtensionAmount` values (rule `FAU14`). Summing in `Decimal`
 * instead of `number` keeps the header from drifting a cent away from the lines
 * on long invoices.
 */
export function dianSum(values: DianNumericInput[]): string {
  const total = values.reduce<Prisma.Decimal>(
    (acc, value) => acc.plus(toDecimal(value)),
    new Prisma.Decimal(0),
  );
  return applyScale(total);
}

/**
 * Adds/subtracts in `Decimal` space and formats once, so intermediate results
 * never round-trip through `number`.
 */
export function dianArithmetic(
  operands: { value: DianNumericInput; sign: 1 | -1 }[],
): string {
  const total = operands.reduce<Prisma.Decimal>((acc, operand) => {
    const term = toDecimal(operand.value);
    return operand.sign === 1 ? acc.plus(term) : acc.minus(term);
  }, new Prisma.Decimal(0));
  return applyScale(total);
}

/** Minimal shape every UBL line exposes for its net extension amount. */
export interface DianLineAmounts {
  quantity: DianNumericInput;
  unit_price: DianNumericInput;
  discount_amount?: DianNumericInput;
  /**
   * QUI-648 — a cuántas unidades de la cantidad declarada corresponde
   * `unit_price` (`products.price_unit_quantity`, la *price unit* de SAP).
   *
   * Sin esto el importe de la línea es `quantity × unit_price`, que para un
   * queso a $28.000 el kilo con el stock en gramos declara **$70.000.000** por
   * una venta de **$70.000**. Y no se queda en la línea: el mismo cálculo
   * alimenta `dianLineExtensionTotal` —el total legal de la cabecera— y el
   * `ValFac` del CUFE, así que el factor N se propaga al documento entero y a
   * su huella, que es precisamente lo que la DIAN recomputa.
   *
   * Ausente, 0, 1 o no numérico ⇒ divisor 1, la aritmética histórica de todo el
   * catálogo por pieza.
   */
  price_unit_quantity?: DianNumericInput;
}

/**
 * Net `cbc:LineExtensionAmount` of one line: `quantity × unit_price − discount`.
 *
 * UBL defines `LineExtensionAmount` as net of line-level allowances, so the
 * discount is subtracted here and represented once more as the line's
 * `cac:AllowanceCharge` (which is descriptive, not additive).
 */
export function dianLineExtension(line: DianLineAmounts): string {
  return applyScale(lineExtensionDecimal(line));
}

/**
 * Importe de la línea ANTES del descuento: `cantidad × precio ÷ price unit`.
 *
 * Es el `cbc:BaseAmount` del `cac:AllowanceCharge` de línea — sobre qué importe
 * se calculó el descuento. Existe como función y no como expresión suelta
 * porque el builder la escribía sin el divisor de la *price unit*: una línea
 * que publica su precio por N unidades de stock declaraba una base N veces
 * mayor que su propio `cbc:LineExtensionAmount`, o sea un descuento aplicado
 * sobre un importe que la línea nunca afirma. Derivarla del mismo helper que el
 * importe neto hace ese desacuerdo irrepresentable.
 */
export function dianLineGross(line: DianLineAmounts): string {
  return applyScale(lineGrossDecimal(line));
}

/**
 * Sum of every line's net extension amount — the value that
 * `cac:LegalMonetaryTotal/cbc:LineExtensionAmount` **must** equal (rule
 * `FAU14`).
 *
 * This exists so the CUFE's `ValFac` and the XML's header amount are computed by
 * the SAME function instead of two independent expressions. The header used to
 * carry the gross subtotal while the lines carried net amounts, so any invoice
 * with a discount violated FAU14; deriving both from here makes that divergence
 * unrepresentable.
 */
export function dianLineExtensionTotal(lines: DianLineAmounts[]): string {
  const total = lines.reduce<Prisma.Decimal>(
    (acc, line) => acc.plus(lineExtensionDecimal(line)),
    new Prisma.Decimal(0),
  );
  return applyScale(total);
}

/** Importes ya despejados de una línea con precio impuesto-incluido. */
export interface DianClearedLineAmounts {
  /** Precio unitario SIN impuesto, con la precisión que haga falta (0-6 dec). */
  unit_price: string;
  /** Descuento SIN impuesto, 2 decimales. */
  discount_amount: string;
}

/**
 * Despeja el impuesto del precio de una línea capturada con IVA incluido, de
 * modo que el XML declare la base gravable sin contradecirse a sí mismo.
 *
 * ## El defecto que cierra
 *
 * Con `invoice_items.is_inclusive`, `unit_price` lleva el impuesto DENTRO. El
 * emisor escribía ese importe tal cual en `cbc:LineExtensionAmount`, así que el
 * documento declaraba $1.000 de base y $190 de IVA sobre una venta de $1.000:
 *
 * · `TaxExclusiveAmount` = 1000,00 contra un `cac:TaxSubtotal` cuya
 *   `cbc:TaxableAmount` es 840,34 — la base imponible no cuadra.
 * · `PayableAmount` = 1000,00 + 159,66 = 1159,66 cuando el cliente pagó 1.000.
 * · `ValFac` y `ValTot` del CUFE toman esas dos cifras, así que el descuadre
 *   viaja dentro de la huella.
 *
 * En la práctica esas facturas ni siquiera llegaban a la DIAN: el prevalidador
 * las frenaba con `HEADER_LINE_EXTENSION_MISMATCH` —lo cual es lo correcto, no
 * se quemó ningún consecutivo— pero ninguna tienda con precios impuesto-incluido
 * podía emitir.
 *
 * ## Por qué se despeja el PRECIO y no sólo el total de la línea
 *
 * Porque la regla FAV06 (RECHAZO) valida la línea contra su propio precio:
 * `LineExtensionAmount = PriceAmount × cantidad − descuentos + recargos`.
 * Bajar la base sin bajar el precio cambia un descuadre por otro. Por eso acá se
 * devuelven las dos cifras y el importe de la línea vuelve a derivarse de ellas
 * con {@link dianLineExtension}, que es la misma función que usan la cabecera y
 * el CUFE: la igualdad se cumple por construcción y no por coincidencia.
 *
 * ## La base NO se recalcula: se recibe
 *
 * `taxable_base` es la base que YA persistió el motor de cálculo
 * (`invoice_taxes.taxable_amount` de la línea). Despejarla otra vez acá con la
 * tarifa produciría un segundo valor, y la suma de esos segundos valores no
 * sería `invoices.subtotal_amount` — que es contra lo que el prevalidador
 * compara la cabecera. Un solo origen para la base, igual que hay un solo
 * origen para el importe de la línea.
 *
 * ## El redondeo del precio va HACIA ARRIBA, a propósito
 *
 * El precio exacto suele ser periódico (2.521,00 entre 3 unidades =
 * 840,333333…). Truncando, `3 × 840,333333 = 2.520,999999` y el importe de la
 * línea sale un centavo por debajo de la base persistida. Se redondea hacia
 * arriba en la sexta cifra para que el producto quede apenas por encima y el
 * truncado a 2 devuelva exactamente la base. El exceso es de 10⁻⁶ por unidad:
 * irrelevante mientras `cantidad / BaseQuantity` no llegue a 10.000, y si
 * llegara, el prevalidador lo ve antes de transmitir.
 *
 * Devuelve `null` cuando no hay nada que despejar o los datos no lo permiten
 * (cantidad cero, base ausente, base mayor que el bruto). El llamador deja la
 * línea como está — el comportamiento histórico— y la validación decide.
 */
export function clearInclusiveLine(
  line: DianLineAmounts & { taxable_base: DianNumericInput },
): DianClearedLineAmounts | null {
  const quantity = toDecimal(line.quantity);
  if (quantity.lessThanOrEqualTo(0)) return null;

  // El bruto TAL COMO SE EMITIRÍA, no el de precisión plena: es contra ese
  // valor que se calcula la proporción del descuento.
  const gross = toDecimal(dianLineExtension(line));
  const base = toDecimal(line.taxable_base);
  if (gross.lessThanOrEqualTo(0)) return null;
  if (base.lessThanOrEqualTo(0) || base.greaterThan(gross)) return null;

  // Un descuento sobre un precio con impuesto dentro también lo lleva dentro:
  // se despeja en la misma proporción que la base.
  const discount = toDecimal(line.discount_amount);
  const cleared_discount = discount.isZero()
    ? applyScale(new Prisma.Decimal(0))
    : applyScale(discount.times(base).dividedBy(gross));

  const divisor = priceUnitDivisor(line.price_unit_quantity);
  const exact_unit_price = base
    .plus(toDecimal(cleared_discount))
    .times(divisor)
    .dividedBy(quantity);

  return {
    unit_price: exact_unit_price.toFixed(
      DIAN_PRICE_SCALE,
      Prisma.Decimal.ROUND_UP,
    ),
    discount_amount: cleared_discount,
  };
}

/**
 * Parses any accepted input into a `Decimal`, collapsing invalid values to zero.
 * Exposed so callers doing multi-step math stay in `Decimal` space instead of
 * formatting and re-parsing between operations.
 */
export function toDecimal(value: DianNumericInput): Prisma.Decimal {
  if (value === null || value === undefined || value === '') {
    return new Prisma.Decimal(0);
  }

  if (value instanceof Prisma.Decimal) {
    return value.isFinite() ? value : new Prisma.Decimal(0);
  }

  try {
    const parsed = new Prisma.Decimal(value);
    return parsed.isFinite() ? parsed : new Prisma.Decimal(0);
  } catch {
    return new Prisma.Decimal(0);
  }
}

// --- Private helpers ---

function lineExtensionDecimal(line: DianLineAmounts): Prisma.Decimal {
  return lineGrossDecimal(line).minus(toDecimal(line.discount_amount));
}

function lineGrossDecimal(line: DianLineAmounts): Prisma.Decimal {
  return toDecimal(line.quantity)
    .times(toDecimal(line.unit_price))
    .dividedBy(priceUnitDivisor(line.price_unit_quantity));
}

/**
 * Divisor de la *price unit*: un entero > 1, o 1. Se sanea acá y no en el
 * llamador para que ningún camino pueda dividir por cero ni por un negativo y
 * convertir un importe legal en basura.
 */
function priceUnitDivisor(value: DianNumericInput): Prisma.Decimal {
  const n = toDecimal(value);
  return n.greaterThan(1) ? n : new Prisma.Decimal(1);
}

function formatWithScale(value: DianNumericInput, scale: number): string {
  return applyScale(toDecimal(value), scale);
}

function applyScale(value: Prisma.Decimal, scale: number = DIAN_SCALE): string {
  const formatted = value.toFixed(scale, TRUNCATE);
  // Truncating a tiny negative (-0.001) yields '-0.00'. A signed zero inside a
  // CUFE concatenation changes the hash, so it is normalized away.
  return formatted === '-' + (0).toFixed(scale) ? (0).toFixed(scale) : formatted;
}
