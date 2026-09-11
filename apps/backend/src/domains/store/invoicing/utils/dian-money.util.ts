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
 * `cac:Price/cbc:PriceAmount` — el precio de UNA unidad de las facturadas.
 *
 * ## Qué es `cbc:BaseQuantity` en el perfil colombiano
 *
 * En el perfil DIAN, `cbc:BaseQuantity` **es la cantidad facturada**, no un
 * divisor de escala. La regla de rechazo FAV06 es una multiplicación, sin
 * división en ninguna parte:
 *
 *   cbc:LineExtensionAmount = PriceAmount × BaseQuantity
 *                             − Σ AllowanceCharge[ChargeIndicator=false]
 *                             + Σ AllowanceCharge[ChargeIndicator=true]
 *
 * Verificado sobre los 27 renglones de los XMLs oficiales de la Caja de
 * Herramientas: los 27 reconcilian con esta lectura y ninguno con la de
 * divisor. Los dos únicos ejemplos con cantidad ≠ 1 lo fijan sin ambigüedad —
 * `Transporte de Carga.xml` factura 10 KGM a 200.000 y declara
 * `BaseQuantity=10` con `LineExtensionAmount=2.000.000`; bajo la lectura de
 * divisor ese renglón valdría 200.000. (`Consumidor Final.xml` aporta además el
 * término de recargos: 1.410.000 = 1.400.000 × 1 + 10.000.)
 *
 * Es la lectura contraria a la de PEPPOL EN16931-R120, donde `BaseQuantity` sí
 * escala el precio. Esa regla no es de la DIAN y no aplica acá.
 *
 * ## Por qué existe esta función
 *
 * Porque `price_unit_quantity` (QUI-648) **no es representable** en este perfil:
 * el campo que serviría para declarar "este precio es por N unidades" está
 * ocupado por la cantidad. Así que la escala se consume ANTES del XML, en el
 * precio: se emite el precio por unidad facturada, y `BaseQuantity` lleva la
 * cantidad. El queso a $28.000 el kilo con la venta en gramos sale como 500 GRM
 * a $28 el gramo — mismo importe, y ahora sí derivable de sus propios campos.
 *
 * El valor se deriva de {@link dianLineExtension} dividido por la cantidad, no
 * de una expresión aparte, para que la igualdad de FAV06 se cumpla por
 * construcción. El redondeo sube en la sexta cifra por el mismo motivo que en
 * {@link clearInclusiveLine}: un precio periódico truncado deja el producto un
 * centavo por debajo del importe que la línea declara.
 */
export function dianPriceAmount(line: DianLineAmounts): string {
  const quantity = toDecimal(line.quantity);
  // Cantidad cero o inválida: no hay de qué derivar, y dividir sería NaN. Se
  // cae al precio ya escalado, que es lo que declaraba el emisor histórico.
  const per_unit = quantity.greaterThan(0)
    ? lineGrossDecimal(line).dividedBy(quantity)
    : toDecimal(line.unit_price).dividedBy(
        priceUnitDivisor(line.price_unit_quantity),
      );

  const two_decimals = applyScale(per_unit, DIAN_SCALE);
  return toDecimal(two_decimals).equals(per_unit)
    ? two_decimals
    : per_unit.toFixed(DIAN_PRICE_SCALE, Prisma.Decimal.ROUND_UP);
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
 *
 * SUMA DE TRUNCADOS, no truncado de la suma. Cada línea viaja al XML por
 * `dianLineExtension`, es decir YA truncada a 2 decimales; la DIAN recomputa el
 * total sumando esos valores emitidos, no los originales. Acumular en crudo y
 * truncar al final producía un total que ninguna de las dos partes declara: diez
 * líneas de 10,555 emiten diez 10,55 —105,50— mientras la cabecera afirmaba
 * 105,55. La diferencia crece con el número de líneas y con la precisión del
 * precio, así que se manifiesta justo en las facturas largas, y rechaza por
 * FAU02 quemando el consecutivo. Truncar por línea antes de sumar hace que el
 * total sea, por construcción, el que la DIAN va a obtener.
 */
export function dianLineExtensionTotal(lines: DianLineAmounts[]): string {
  const total = lines.reduce<Prisma.Decimal>(
    (acc, line) => acc.plus(toDecimal(applyScale(lineExtensionDecimal(line)))),
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

// =====================================================================
// Inclusive absorb kernel (CP-facturacion-impuesto-incluido-redondeo, A.2,
// ADR-01 + ADR-04).
//
// Single owner of the centavo-absorb search. Both the engine
// (`InvoiceCalculatorService`) and its pure mirror (`resolveLineTotals`) call
// into this leaf — which both already import, so neither direction creates a
// taxes ↔ invoicing cycle (F-001, F-008).
//
// Contract: given the captured gross G (tax inside when inclusive) and the
// normalized rate fractions, keep the GREATEST base (in cents) with
// f(base) <= G, where f(base) = base + Σ trunc(base × r) over the INCLUSIVE
// rates. Exclusive rates never enter f: they stack ON TOP of the closed
// subtotal. Never overshoots G; when G is unreachable (f jumps over it, e.g.
// $17 @ 8%: 1699 → 1701¢) the closest-below persists and the residual is
// reported for the caller to block on (ADR-04).
//
// Fail-closed (F-033/F-034/F-035/F-036/F-037): every precondition violation is
// REPORTED in `invalid_inputs` while totals keep the legacy coercion values,
// so no caller silently changes money and no caller has to guess. The absorb
// search runs ONLY on clean inputs; anything invalid takes the legacy totals
// + report path.
//
// Decimal-space (F-041): the loop runs on integer cents (`Prisma.Decimal`
// integers, never `number`, never strings). Callers format each TERMINAL
// value once with `dianAmount`, which is idempotent over already-truncated
// Decimals — emitted strings are byte-identical to the legacy path whenever
// the legacy path was already exact.
// =====================================================================

/**
 * Kernel version pinned into every absorb evidence record (F-064). Bump when
 * the search semantics change so an audit can tell which arithmetic produced
 * a persisted base.
 */
export const INCLUSIVE_ABSORB_KERNEL_VERSION = 'inclusive-absorb-v1' as const;

/**
 * Fixed small cap on absorb iterations (F-033).
 *
 * Termination proof: the search starts at B0 = trunc(G / (1 + Σr)) and climbs
 * exactly 1¢/step while f(base) rises ≥ 1¢/step (the base itself rises 1¢ and
 * every quota is monotone non-decreasing in the base). The residual G − f(B0)
 * is bounded by (1 + Σr + k)¢ where k is the inclusive-tax count — each trunc
 * sheds < 1¢ and the B0 trunc sheds < (1 + Σr)¢. Any sane rate set
 * (Σr ≤ 1, k ≤ 6 ⇒ residual < 9¢) closes or overshoot-breaks long before the
 * cap. Hitting the cap means insane rates; the kernel then returns
 * closest-below with `capped: true` and the caller blocks (fail-closed,
 * F-039 — never an open equality loop, never an overshoot).
 */
export const INCLUSIVE_ABSORB_MAX_STEPS = 16;

/** Rate units the absorb kernel understands (F-013, F-032). */
export type AbsorbRateBasis = 'percent' | 'per_mil' | 'fraction';

/**
 * Fiscal whitelist for the kernel preconditions: exactly `TaxFiscalType`
 * (`apps/backend/src/domains/store/taxes/dto`), the 6 values of
 * `tax_type_enum`. Unknown values are reported in `invalid_inputs` while the
 * legacy normalization (lowercase, absent ⇒ `iva`) is kept for the totals.
 */
const ABSORB_TAX_TYPE_WHITELIST: ReadonlySet<string> = new Set([
  'iva',
  'inc',
  'ica',
  'withholding',
  'reteiva',
  'reteica',
]);

/** One rate as the caller captured it; normalization is the kernel's job. */
export interface AbsorbKernelRateInput {
  rate: DianNumericInput;
  /** `percent` (default) | `per_mil` (`per-mil` accepted) | `fraction`. */
  rate_basis?: unknown;
  tax_type?: unknown;
  /** Strict: only `=== true` counts (F-035 — one predicate, here). */
  is_inclusive?: unknown;
}

/** Everything the kernel needs for one line; granularidad canónica = línea. */
export interface AbsorbKernelLineInput {
  /**
   * Captured net (`quantity × unit_price ÷ puq − discount`, tax inside when
   * inclusive). The caller computes it with its own canonical helper; the
   * kernel never re-derives money from qty/price — those raws exist here for
   * precondition REPORTING only.
   */
  gross: DianNumericInput;
  quantity?: DianNumericInput;
  unit_price?: DianNumericInput;
  discount_amount?: DianNumericInput;
  price_unit_quantity?: DianNumericInput;
  rates: AbsorbKernelRateInput[];
}

/** One rate after kernel normalization (Decimal space, unformatted). */
export interface AbsorbKernelQuota {
  /** Normalized fraction: 19 % ⇒ 0.19 · 7 ‰ ⇒ 0.007 · fraction as-is. */
  fraction: Prisma.Decimal;
  rate_basis: AbsorbRateBasis;
  /** Legacy normalization (lowercase, absent ⇒ `iva`); see `invalid_inputs`. */
  tax_type: string;
  is_inclusive: boolean;
  /** `trunc(base_final × fraction)` — the DIAN-valid quota by construction. */
  quota: Prisma.Decimal;
}

export interface AbsorbKernelResult {
  /** {@link INCLUSIVE_ABSORB_KERNEL_VERSION} — audit pin (F-064). */
  kernel: typeof INCLUSIVE_ABSORB_KERNEL_VERSION;
  /** `max(0, gross)`: an over-discount never yields a negative base (F-034). */
  gross: Prisma.Decimal;
  /** Final absorbed base (Decimal, already truncated to cents). */
  base: Prisma.Decimal;
  quotas: AbsorbKernelQuota[];
  /** `base + Σ ALL quotas` (inclusive + exclusive): the line total. */
  closed_total: Prisma.Decimal;
  /** `base_final − B0` in cents: what the absorb moved (0 when already exact). */
  residual_absorbed_cents: number;
  /** `gross − (base + Σ inclusive quotas)` in cents: 0 ⇔ exact close. */
  unclosed_residual_cents: number;
  closed_exactly: boolean;
  /** Search iterations consumed (0 when short-circuited). */
  steps: number;
  /** True only when the cap stopped the search (fail-closed signal). */
  capped: boolean;
  /** False when the line took the no-search path (clean exclusive/zero). */
  searched: boolean;
  /**
   * Precondition violations as `field:reason` codes (F-062). Totals ALWAYS
   * keep the legacy coercion values — this channel reports, never reshapes.
   */
  invalid_inputs: string[];
}

/**
 * Shared rate normalizer (F-013, F-032): `percent` ⇒ ÷100, `per_mil` ⇒ ÷1000,
 * `fraction` ⇒ as-is (the mirror passes fractions like 0.08).
 *
 * Unknown basis is fail-closed: reported via `invalid` while the fraction
 * falls back to `percent` — the legacy coercion (any non-`per_mil` divided by
 * 100) — so compat totals are preserved alongside the report.
 */
export function absorbRateToFraction(
  rate: DianNumericInput,
  rate_basis: unknown,
): { fraction: Prisma.Decimal; basis: AbsorbRateBasis; invalid: string | null } {
  const raw = rate_basis === null || rate_basis === undefined ? 'percent' : String(rate_basis);
  const normalized = raw.trim().toLowerCase().replace('-', '_');
  const basis: AbsorbRateBasis =
    normalized === 'per_mil' || normalized === 'fraction' ? normalized : 'percent';
  const invalid_basis =
    normalized !== 'percent' && normalized !== 'per_mil' && normalized !== 'fraction'
      ? `rate_basis:unknown:${raw}`
      : null;

  if (!isStrictFiniteInput(rate)) {
    return { fraction: new Prisma.Decimal(0), basis, invalid: invalid_basis ?? 'rate:non_finite' };
  }
  const value = toDecimal(rate);
  if (value.isNegative()) {
    // Legacy engine coercion kept the negative (no positivity filter); the
    // mirror clamped to 0. Compat follows the engine (this leaf feeds it) and
    // the violation is reported — the caller blocks on `invalid_inputs`.
    return { fraction: value.dividedBy(basisDivisor(basis)), basis, invalid: invalid_basis ?? 'rate:negative' };
  }
  return {
    fraction: value.dividedBy(basisDivisor(basis)),
    basis,
    invalid: invalid_basis,
  };
}

/** Strict finiteness WITHOUT legacy collapsing (F-036, F-062). */
export function isStrictFiniteInput(value: DianNumericInput): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (value instanceof Prisma.Decimal) return value.isFinite();
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return false;
    try {
      return new Prisma.Decimal(trimmed).isFinite();
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Price-unit divisor with whitelist reporting (F-037): a finite integer ≥ 1,
 * or absent (⇒ 1). Anything else is REPORTED (`price_unit_quantity:*`) while
 * the legacy coercion (`> 1 ? n : 1`) is kept for the totals — never a silent
 * 1, never a reshape.
 */
export function absorbPriceUnitDivisor(
  value: DianNumericInput,
  invalid_inputs: string[],
): Prisma.Decimal {
  if (value === null || value === undefined) return new Prisma.Decimal(1);
  const parsed = toDecimal(value);
  const is_integer = isStrictFiniteInput(value) && parsed.isInteger() && parsed.greaterThanOrEqualTo(1);
  if (!is_integer) {
    invalid_inputs.push('price_unit_quantity:non_integer_or_below_1');
  }
  return parsed.greaterThan(1) ? parsed : new Prisma.Decimal(1);
}

function basisDivisor(basis: AbsorbRateBasis): Prisma.Decimal {
  switch (basis) {
    case 'per_mil':
      return new Prisma.Decimal(1000);
    case 'fraction':
      return new Prisma.Decimal(1);
    default:
      return new Prisma.Decimal(100);
  }
}

/** Truncate to cents in Decimal space — no string round-trip (F-041). */
function truncCents(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(DIAN_SCALE, TRUNCATE);
}

/**
 * Bounded absorb search over integer cents. `f(b) = b + Σ floor(b × rᵢ)`.
 * Returns the greatest base with `f ≤ bruto_cents`, whether it closes
 * exactly, and how many 1¢ steps that took. Pure + total: terminates by
 * closure, overshoot-break, or the fixed cap — never an open loop (F-039).
 */
function searchAbsorbCents(
  bruto_cents: Prisma.Decimal,
  fractions: Prisma.Decimal[],
): { base_cents: Prisma.Decimal; steps: number; capped: boolean; closed: boolean } {
  const rate_sum = fractions.reduce<Prisma.Decimal>(
    (acc, f) => acc.plus(f),
    new Prisma.Decimal(0),
  );
  const quotaOf = (base_cents: Prisma.Decimal, f: Prisma.Decimal): Prisma.Decimal =>
    base_cents.times(f).toDecimalPlaces(0, TRUNCATE);
  const fOf = (base_cents: Prisma.Decimal): Prisma.Decimal =>
    fractions.reduce<Prisma.Decimal>(
      (acc, fraction) => acc.plus(quotaOf(base_cents, fraction)),
      base_cents,
    );

  let best = bruto_cents.dividedBy(new Prisma.Decimal(1).plus(rate_sum)).toDecimalPlaces(0, TRUNCATE);
  if (best.isNegative()) best = new Prisma.Decimal(0);
  if (fOf(best).equals(bruto_cents)) {
    return { base_cents: best, steps: 0, capped: false, closed: true };
  }
  for (let step = 1; step <= INCLUSIVE_ABSORB_MAX_STEPS; step++) {
    const candidate = best.plus(1);
    const total = fOf(candidate);
    if (total.greaterThan(bruto_cents)) {
      return { base_cents: best, steps: step, capped: false, closed: false };
    }
    best = candidate;
    if (total.equals(bruto_cents)) {
      return { base_cents: best, steps: step, capped: false, closed: true };
    }
  }
  return { base_cents: best, steps: INCLUSIVE_ABSORB_MAX_STEPS, capped: true, closed: false };
}

/**
 * The bounded absorb kernel. See the section docblock for the contract.
 *
 * Precondition codes pushed to `invalid_inputs` (all fail-closed, legacy
 * coercion kept for totals):
 * `gross:non_finite` · `net:negative` (over-discount, F-034) ·
 * `quantity:non_finite` · `unit_price:non_finite` ·
 * `discount_amount:non_finite` · `price_unit_quantity:*` (F-037) ·
 * `rates[i].rate:*` · `rates[i].rate_basis:unknown` (F-013/F-032) ·
 * `rates[i].tax_type:unknown` (6-value whitelist).
 *
 * The search runs ONLY when `invalid_inputs` is empty, at least one rate is
 * strictly inclusive with a positive fraction, and the divisor is sane.
 * Otherwise the totals are the legacy coercion (B0 + trunc quotas, no climb).
 */
export function absorbInclusiveLine(input: AbsorbKernelLineInput): AbsorbKernelResult {
  const invalid_inputs: string[] = [];

  // --- Preconditions: report everything, coerce legacy for the totals. ---
  const gross_raw = input.gross;
  const gross_valid = isStrictFiniteInput(gross_raw);
  if (!gross_valid) invalid_inputs.push('gross:non_finite');
  const gross_decimal = toDecimal(gross_raw);
  const negative_net = gross_valid && gross_decimal.isNegative();
  if (negative_net) invalid_inputs.push('net:negative');
  // bruto = max(0, net) — identical in engine, mirror and preview (F-034).
  const gross = gross_valid && !negative_net ? truncCents(gross_decimal) : new Prisma.Decimal(0);

  if (input.quantity !== null && input.quantity !== undefined && !isStrictFiniteInput(input.quantity)) {
    invalid_inputs.push('quantity:non_finite');
  }
  if (input.unit_price !== null && input.unit_price !== undefined && !isStrictFiniteInput(input.unit_price)) {
    invalid_inputs.push('unit_price:non_finite');
  }
  if (
    input.discount_amount !== null &&
    input.discount_amount !== undefined &&
    !isStrictFiniteInput(input.discount_amount)
  ) {
    invalid_inputs.push('discount_amount:non_finite');
  }
  // Validated for the report; the divisor value itself stays legacy-compat.
  // (The caller computes money with its own canonical helper.)
  absorbPriceUnitDivisor(input.price_unit_quantity, invalid_inputs);

  const quotas: AbsorbKernelQuota[] = (input.rates ?? []).map((r, index) => {
    const is_inclusive = r?.is_inclusive === true;
    const { fraction, basis, invalid } = absorbRateToFraction(r?.rate, r?.rate_basis);
    if (invalid) invalid_inputs.push(`rates[${index}].${invalid}`);
    const raw_type = r?.tax_type === null || r?.tax_type === undefined ? '' : String(r.tax_type);
    const tax_type = raw_type.trim().toLowerCase() || 'iva';
    if (raw_type.trim() !== '' && !ABSORB_TAX_TYPE_WHITELIST.has(tax_type)) {
      invalid_inputs.push(`rates[${index}].tax_type:unknown:${raw_type}`);
    }
    // Placeholder quota; recomputed against the final base below.
    return { fraction, rate_basis: basis, tax_type, is_inclusive, quota: new Prisma.Decimal(0) };
  });

  const finish = (
    base: Prisma.Decimal,
    extra: Partial<AbsorbKernelResult>,
  ): AbsorbKernelResult => {
    const settled = quotas.map((q) => ({ ...q, quota: truncCents(base.times(q.fraction)) }));
    const inclusive_sum = settled.reduce<Prisma.Decimal>(
      (acc, q) => (q.is_inclusive ? acc.plus(q.quota) : acc),
      new Prisma.Decimal(0),
    );
    const all_sum = settled.reduce<Prisma.Decimal>((acc, q) => acc.plus(q.quota), new Prisma.Decimal(0));
    const closed_total = base.plus(all_sum);
    const unclosed = gross.minus(base.plus(inclusive_sum)).times(100);
    return {
      kernel: INCLUSIVE_ABSORB_KERNEL_VERSION,
      gross,
      base,
      quotas: settled,
      closed_total,
      residual_absorbed_cents: 0,
      unclosed_residual_cents: Math.max(0, Math.round(unclosed.toNumber())),
      closed_exactly: false,
      steps: 0,
      capped: false,
      searched: false,
      invalid_inputs,
      ...extra,
    };
  };

  const clean = invalid_inputs.length === 0;
  const inclusive_fractions = quotas.filter((q) => q.is_inclusive).map((q) => q.fraction);
  const has_positive_inclusive = inclusive_fractions.some((f) => f.greaterThan(0));
  const divisor = new Prisma.Decimal(1).plus(
    inclusive_fractions.reduce<Prisma.Decimal>((acc, f) => acc.plus(f), new Prisma.Decimal(0)),
  );

  // Legacy B0 WITHOUT climb: the fail-closed totals (F-033). Same despeje the
  // engine always ran — divisor ≤ 0 degrades to gross, exactly like the old
  // formula — so every invalid/zero/exclusive input lands byte where legacy
  // landed, plus the report.
  const sane_divisor = divisor.greaterThan(0) ? divisor : new Prisma.Decimal(1);
  const legacy_b0 = truncCents(gross.dividedBy(sane_divisor));

  if (!clean || !has_positive_inclusive || divisor.lessThanOrEqualTo(0) || gross.isZero()) {
    const closed = finish(legacy_b0, {});
    return {
      ...closed,
      closed_exactly: closed.unclosed_residual_cents === 0,
    };
  }

  const bruto_cents = gross.times(100);
  const found = searchAbsorbCents(bruto_cents, inclusive_fractions);
  const base = found.base_cents.dividedBy(100);
  const b0_cents = bruto_cents
    .dividedBy(divisor)
    .toDecimalPlaces(0, TRUNCATE);
  const closed = finish(base, {
    residual_absorbed_cents: Math.max(0, found.base_cents.minus(b0_cents).toNumber()),
    steps: found.steps,
    capped: found.capped,
    searched: true,
  });
  return {
    ...closed,
    closed_exactly: closed.unclosed_residual_cents === 0 && !found.capped,
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

// ---------------------------------------------------------------------------
// A.2 (CP-facturacion-impuesto-incluido-redondeo, ADR-01 + ADR-04) — kernel
// único del despeje impuesto-incluido con cierre en centavos.
//
// NOTA DE AUTORÍA (run paralelo A.2): el kernel no existía cuando el agente B
// (espejo+checkout) lo necesitó, así que se implementa acá contra el contrato
// de ADR-01 en vez de duplicar el loop en el espejo (F-001). El agente A
// (kernel+motor+gate) es el dueño final: al aterrizar, RECONCILIA con esta
// sección en vez de agregar un segundo loop — dos loops son la divergencia
// que F-001/F-008 prohíben. `git log -S INCLUSIVE_SOLVER_MAX_STEPS` muestra
// quién escribió qué.
//
// Contrato (ADR-01): búsqueda acotada en centavos que conserva la MAYOR base
// con `f(base) <= bruto`, donde `f = base + Σ trunc(base×r_incl)`; jamás
// overshoot. Lo inalcanzable cae en closest-below + residuo declarado
// (ADR-04), nunca cuelga (F-006/F-039) ni sobrecobra.
//
// Precondiciones fail-closed con coerción por compat (F-036/F-062): lo
// inválido (no finito, no parseable, negativo, base desconocida, `''`) se
// COERCIONA a 0 para no romper a los llamadores históricos, pero se REPORTA
// en `invalid_inputs` en vez de colapsar en silencio. El mapeo a divergencia
// tipada / 422 vive en cada llamador (motor) o en warn estructurado
// (espejo/checkout), nunca acá: el kernel es puro y sin logger.
//
// Carve-outs explícitos (quedan FUERA del loop, misma semántica que
// `invoice-calculator.resolveTaxableBase` donde aplica):
// - Base propia (`fixed_base`, motor): su cuota `trunc(base_fija×r)` no
//   depende de B, así que resta del numerador en vez de entrar al divisor y
//   se suma tal cual a `f`. El espejo nunca la envía (sus tasas no traen
//   base propia).
// - Líneas AIU-contrato y `omit_tax_total`: ruteo del MOTOR (hermano), no
//   conocen a este kernel.
// - Granularidad canónica: BRUTO DE LÍNEA (F-009). Quien llama por unidad y
//   escala en floats diverge del motor por diseño.
//
// Unidades de tarifa (F-013/F-032): `rate_basis` normalizada por
// `toFraction` — `percent` ⇒ /100, `per-mil`/`per_mil` ⇒ /1000, `fraction`
// (default) ⇒ tal cual. Basis desconocida ⇒ inválido + fracción 0.
// `is_inclusive` es estricto (`=== true`, F-035): strings/números no despejan
// en ningún lado.
// ---------------------------------------------------------------------------

/**
 * Cota fija del bump de centavos (F-033). Derivación: tras el truncado, el
 * hueco `bruto − f(B0)` es < (1 + k)¢ con k = nº de tasas inclusivas (cada
 * truncado pierde < 1¢ y la base otro < 1¢), y cada paso gana ≥ 1¢ — así que
 * bastan < 1+k pasos. 16 cubre hasta 15 tasas inclusivas por línea, un orden
 * de magnitud sobre cualquier línea real, y mantiene el peor caso en
 * nanosegundos en el path caliente (F-042).
 */
export const INCLUSIVE_SOLVER_MAX_STEPS = 16;

/** Unidad declarada de una tarifa (F-013/F-032). Ausente ⇒ `fraction`. */
export type InclusiveRateBasis = 'percent' | 'per_mil' | 'per-mil' | 'fraction';

/** Entrada cruda por tasa: el kernel sanea Y reporta (F-062). */
export interface InclusiveSolveRateInput {
  rate: unknown;
  is_inclusive: unknown;
  rate_basis?: unknown;
  /**
   * Base propia declarada (carve-out del motor, espejo N/A): su cuota no
   * entra al divisor. Ausente/`''`/null ⇒ sin base propia.
   */
  fixed_base?: unknown;
}

/** Tasa resuelta: fracción normalizada + cuota truncada DIAN sobre B final. */
export interface InclusiveSolvedRate {
  fraction: Prisma.Decimal;
  is_inclusive: boolean;
  has_fixed_base: boolean;
  amount: Prisma.Decimal;
}

export interface InclusiveClearingResult {
  /** Base neta despejada (truncada DIAN, con el bump absorbido). */
  base: Prisma.Decimal;
  /** Cuotas por tasa en orden de entrada (inclusivas + agregadas). */
  rates: InclusiveSolvedRate[];
  /** Total cobrado: `f(B*) + Σ agregadas`. Inalcanzable ⇒ closest-below. */
  total: Prisma.Decimal;
  /** `bruto − f(B*)` en centavos enteros, ≥ 0 (ADR-04). */
  unclosed_residual_cents: number;
  /** Entradas coercionadas (bruto/tasas/basis/base-fija), en crudo. */
  invalid_inputs: unknown[];
  /** Pasos de bump ejecutados (≤ cota; 0 sin inclusivo). */
  iterations: number;
}

const INCLUSIVE_CENT = new Prisma.Decimal('0.01');
const INCLUSIVE_ZERO = new Prisma.Decimal(0);
const INCLUSIVE_ONE = new Prisma.Decimal(1);
const INCLUSIVE_HUNDRED = new Prisma.Decimal(100);
const INCLUSIVE_THOUSAND = new Prisma.Decimal(1000);

/** Predicado único de inclusividad (F-035): solo `true` booleano despeja. */
export function coerceInclusiveStrict(value: unknown): boolean {
  return value === true;
}

/** `true` solo para las cuatro grafías conocidas (F-032). */
export function isInclusiveRateBasis(value: unknown): value is InclusiveRateBasis {
  return (
    value === 'percent' || value === 'per_mil' || value === 'per-mil' || value === 'fraction'
  );
}

/**
 * Tarifa → fracción, compartida por motor y espejo (F-001/F-032). Coerciona
 * a 0 lo inválido/negativo y la basis desconocida (compat: nunca lanza); el
 * REPORTE vive en `resolveInclusiveClearing` (F-062), no acá.
 *
 * ```ts
 * toFraction(19, 'percent')   // 0.19
 * toFraction(9.66, 'per_mil') // 0.00966
 * toFraction(0.19)            // 0.19 (default fraction)
 * ```
 */
export function toFraction(rate: unknown, basis?: unknown): Prisma.Decimal {
  const parsed = parseInclusiveNumeric(rate);
  if (parsed === null || parsed.isNegative()) return INCLUSIVE_ZERO;
  const unit = basis === undefined || basis === null ? 'fraction' : basis;
  switch (unit) {
    case 'percent':
      return parsed.dividedBy(INCLUSIVE_HUNDRED);
    case 'per_mil':
    case 'per-mil':
      return parsed.dividedBy(INCLUSIVE_THOUSAND);
    case 'fraction':
      return parsed;
    default:
      return INCLUSIVE_ZERO;
  }
}

/**
 * Dueño único del despeje con cierre (ADR-01). Puro y síncrono a propósito:
 * sin DB, sin logger, testeable sin mocks. La aserción de cota vive ACÁ
 * dentro (F-004): fachada e importadores directos la heredan por delegación.
 */
export function resolveInclusiveClearing(
  gross: unknown,
  ratesInput: ReadonlyArray<InclusiveSolveRateInput> | null | undefined,
): InclusiveClearingResult {
  const invalid_inputs: unknown[] = [];

  // Bruto: se REDONDEA a centavos (no trunca) para matar el polvo float
  // (59.96999999999999 ⇒ 59.97); el bruto comercial siempre es 2dp.
  // Negativo ⇒ max(0, ·) idéntico en los tres sitios (F-034) + reporte.
  const rawGross = parseInclusiveNumeric(gross);
  let G: Prisma.Decimal;
  if (rawGross === null) {
    invalid_inputs.push(gross);
    G = INCLUSIVE_ZERO;
  } else if (rawGross.isNegative()) {
    invalid_inputs.push(gross);
    G = INCLUSIVE_ZERO;
  } else {
    G = new Prisma.Decimal(rawGross.toFixed(DIAN_SCALE, Prisma.Decimal.ROUND_HALF_UP));
  }

  const parsed = (ratesInput ?? []).map((entry) => {
    const source = (entry ?? {}) as InclusiveSolveRateInput;
    const is_inclusive = coerceInclusiveStrict(source.is_inclusive);
    const basisRaw = source.rate_basis;
    const basis = basisRaw === undefined || basisRaw === null ? 'fraction' : basisRaw;
    let fraction: Prisma.Decimal;
    if (!isInclusiveRateBasis(basis)) {
      invalid_inputs.push(basisRaw);
      fraction = INCLUSIVE_ZERO;
    } else {
      fraction = toFractionWithReport(source.rate, basis, invalid_inputs);
    }
    // Base propia: solo aplica a inclusivas (en agregadas no significa nada
    // y se ignora por documento, no en silencio casual).
    let fixedBase: Prisma.Decimal | null = null;
    if (is_inclusive) {
      fixedBase = parseInclusiveFixedBase(source.fixed_base, invalid_inputs);
    }
    return { is_inclusive, fraction, fixedBase, fixedQuota: INCLUSIVE_ZERO };
  });

  // Cuotas fijas fuera del divisor (misma semántica que el motor: la base se
  // trunca igual que la que usará la cuota emitida).
  let fixedTotal = INCLUSIVE_ZERO;
  for (const p of parsed) {
    if (p.is_inclusive && p.fixedBase !== null) {
      p.fixedQuota = truncInclusive(p.fixedBase.times(p.fraction));
      fixedTotal = fixedTotal.plus(p.fixedQuota);
    }
  }
  if (fixedTotal.greaterThan(G)) {
    // F-034 en carve-out: las fijas ya superan el bruto (descuento mayor que
    // precio con base propia). No hay despeje honesto: base 0, se REPORTA y
    // el llamador lo mapea a divergencia (nunca línea cero silenciosa).
    invalid_inputs.push(fixedTotal.toNumber());
  }
  const netForBase = G.minus(fixedTotal);
  const Gprime = netForBase.isNegative() ? INCLUSIVE_ZERO : netForBase;

  const looping = parsed.filter((p) => p.is_inclusive && p.fixedBase === null);
  let divisor = INCLUSIVE_ONE;
  for (const p of looping) divisor = divisor.plus(p.fraction);
  const hasLoop = looping.length > 0 && divisor.greaterThan(INCLUSIVE_ZERO);

  let base = hasLoop ? truncInclusive(Gprime.dividedBy(divisor)) : truncInclusive(Gprime);
  if (base.isNegative()) base = INCLUSIVE_ZERO;

  // f(B) = B + Σ trunc(B×r_incl) + fijas. Solo lo inclusivo limita el bump;
  // lo agregado se liquida DESPUÉS sobre la base final (idéntico a hoy sin
  // inclusivo).
  const fOf = (candidate: Prisma.Decimal): Prisma.Decimal => {
    let acc = candidate.plus(fixedTotal);
    for (const p of looping) acc = acc.plus(truncInclusive(candidate.times(p.fraction)));
    return acc;
  };

  let iterations = 0;
  while (iterations < INCLUSIVE_SOLVER_MAX_STEPS) {
    const candidate = base.plus(INCLUSIVE_CENT);
    if (fOf(candidate).greaterThan(G)) break;
    base = candidate;
    iterations += 1;
  }

  // Tripwires DENTRO del camino puro (F-004): si un refactor futuro rompe la
  // construcción, esto grita en vez de colgar (F-006) o sobrecobrar (F-039).
  if (iterations > INCLUSIVE_SOLVER_MAX_STEPS) {
    throw new Error(
      `[dian-money] inclusive solver exceeded bound (${iterations} > ${INCLUSIVE_SOLVER_MAX_STEPS})`,
    );
  }
  if (fOf(base).greaterThan(G) && fixedTotal.lessThanOrEqualTo(G)) {
    throw new Error('[dian-money] inclusive solver left an infeasible base');
  }

  const rates: InclusiveSolvedRate[] = parsed.map((p) => ({
    fraction: p.fraction,
    is_inclusive: p.is_inclusive,
    has_fixed_base: p.fixedBase !== null,
    amount: p.fixedBase !== null ? p.fixedQuota : truncInclusive(base.times(p.fraction)),
  }));

  let total = base;
  for (const r of rates) total = total.plus(r.amount);

  const residual = G.minus(fOf(base));
  const unclosed_residual_cents = residual.isNegative()
    ? 0
    : residual.times(INCLUSIVE_HUNDRED).toNumber();

  return { base, rates, total, unclosed_residual_cents, invalid_inputs, iterations };
}

/** Numérico estricto: number/string/Decimal finitos; lo demás es null. */
function parseInclusiveNumeric(value: unknown): Prisma.Decimal | null {
  if (value instanceof Prisma.Decimal) {
    return value.isFinite() ? value : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Prisma.Decimal(value) : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    try {
      const parsed = new Prisma.Decimal(trimmed);
      return parsed.isFinite() ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** `toFraction` con reporte del ofensor (F-062). Negativo ⇒ inválido + 0. */
function toFractionWithReport(
  rate: unknown,
  basis: InclusiveRateBasis,
  invalid_inputs: unknown[],
): Prisma.Decimal {
  const parsed = parseInclusiveNumeric(rate);
  if (parsed === null || parsed.isNegative()) {
    invalid_inputs.push(rate);
    return INCLUSIVE_ZERO;
  }
  return toFraction(parsed, basis);
}

/** Base propia: ausente ⇒ null; basura/negativa ⇒ reporte + null. */
function parseInclusiveFixedBase(
  value: unknown,
  invalid_inputs: unknown[],
): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = parseInclusiveNumeric(value);
  if (parsed === null || parsed.isNegative()) {
    invalid_inputs.push(value);
    return null;
  }
  return truncInclusive(parsed);
}

function truncInclusive(d: Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(d.toFixed(DIAN_SCALE, TRUNCATE));
}
