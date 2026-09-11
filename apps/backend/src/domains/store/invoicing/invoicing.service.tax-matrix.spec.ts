import { Prisma } from '@prisma/client';
import {
  aggregateOrderTaxes,
  InvoicingService,
  needsOrderLineTaxSplit,
  orderTaxFractionToInvoiceRate,
} from './invoicing.service';
import { InvoiceFlowService } from './invoice-flow/invoice-flow.service';
import {
  InvoiceCalculatorService,
  type InvoiceCalculatorInput,
} from './services/invoice-calculator.service';
import {
  FiscalDocumentValidator,
  type FiscalDocumentFindingCode,
  type FiscalDocumentValidationInput,
} from './validators/fiscal-document.validator';
import {
  dianAmount,
  dianArithmetic,
  dianLineExtension,
  dianLineExtensionTotal,
  dianSum,
  toDecimal,
} from './utils/dian-money.util';
import { resolveLineTotals } from '../taxes/utils/tax-inclusive-math.util';

/**
 * MATRIZ FISCAL — `createFromOrder` + split + prevalidador.
 *
 * La factura electrónica de venta NUNCA puede fallar la validación con
 * NINGUNA combinación de impuestos. El motor (`InvoiceCalculatorService`)
 * ya tiene su propia cobertura y NO se re-testea acá: lo que se fija es el
 * camino orden→documento→prevalidador, que es donde nació el incidente
 * factura #81 (FAU02, P0 2026-09-10): con un solo tributo INCLUSIVO se
 * persistía la fila agregada de cabecera sin `invoice_item_id`, el
 * prevalidador no podía usar la base persistida y recomputaba
 * `bruto − impuesto` sobre unidades que los canales ya persisten NETAS
 * (doble despeje: 4629.62 → 4259.26, venta cobrada sin documento fiscal).
 *
 * Por forma se construyen DOS verdades, igual que en producción:
 *
 * · VERDAD CANAL (brutos + flags `is_inclusive` por asignación) → motor
 *   REAL (`InvoiceCalculatorService`, sin mocks). De acá salen base,
 *   cuota y totales de referencia.
 * · ORDEN PERSISTIDA (unidades NETAS despejadas a 2 dec, `total_price`,
 *   filas `order_item_taxes` con tarifa en FRACCIÓN + flag por fila) →
 *   espejo documentado del mapeo de `createFromOrder` (agregación por
 *   línea, `taxGroups`, decisión con `needsOrderLineTaxSplit` REAL y
 *   conversión de tarifa con `orderTaxFractionToInvoiceRate` REAL).
 *
 * El espejo es deliberado y acotado: `createFromOrder` exige Prisma +
 * contexto + DB, así que un e2e por forma no es un test unitario sino un
 * seed. Lo que NO se espeja —la agregación orden→filas, la decisión de
 * split, la conversión de tarifa, el mapeo fila→input Prisma, el despeje de
 * líneas inclusivas, el juicio aritmético— corre con el código REAL:
 * `aggregateOrderTaxes`, `needsOrderLineTaxSplit`,
 * `orderTaxFractionToInvoiceRate`, `buildInvoiceTaxCreateInput`,
 * `InvoiceFlowService.resolveInclusiveLineOverrides` (vía instancia con
 * deps stub: el método sólo lee campos + `Logger`) y
 * `FiscalDocumentValidator`. Sólo las sumas flotantes de cabecera y el
 * mapeo orden→ítem (5 expresiones) se replican; todo lo fiscal es real.
 *
 * Por forma se ASSERT:
 * (a) `total_before_tax` == Σ `line_extension_amount` truncados (vía
 *     `dianSum` independiente) y la cabecera flotante de `createFromOrder`
 *     (redondeada a `numeric(12,2)` como la escribe Postgres) cae dentro
 *     de la tolerancia de un centavo del prevalidador;
 * (b) el split decidido persiste bases por línea cuando el prevalidador
 *     las necesita: toda línea inclusiva emitida tiene override despejado
 *     desde la base persistida (nunca el fallback `bruto − impuesto`);
 * (c) `FiscalDocumentValidator` no reporta FAU02 (`HEADER_LINE_EXTENSION_
 *     MISMATCH`), TaxSubtotal (`HEADER_TAX_TOTAL_MISMATCH`,
 *     `TAX_SUBTOTAL_MISMATCH`, `TAX_RATE_MISSING`,
 *     `TAX_SCHEME_RATE_COLLISION`) ni PayableAmount
 *     (`PAYABLE_AMOUNT_MISMATCH`, `PAYABLE_NETS_*`).
 */

// --- Fixtures: la orden tal como la persisten los canales -------------------

/** Fila de `order_item_taxes`: tarifa SIEMPRE en fracción, flag por fila. */
interface OrderTaxFixture {
  tax_name: string;
  /** Fracción (`0.19` = 19 %, `0.007` = 7 ‰). */
  tax_rate: number;
  tax_type: string;
  /** Cuota de TODA la línea (no por unidad). */
  tax_amount: number;
  is_inclusive: boolean;
  tax_rate_id?: number | null;
}

/** Línea de `orders` con sus impuestos, como la lee `createFromOrder`. */
interface OrderLineFixture {
  description: string;
  quantity: number;
  /** Unidad NETA ya despejada (2 dec), como persisten POS y checkout. */
  unit_price: number;
  discount_amount: number;
  /** `total_price`: base neta de descuento de TODA la línea. */
  total_price: number;
  /** Snapshot de impuesto POR UNIDAD (`tax_amount_item`, `Decimal(12,2)`). */
  tax_amount_item: number;
  taxes: OrderTaxFixture[];
  /**
   * Sólo líneas inclusivas con decimales periódicos: el canal trunca la
   * base POR UNIDAD (`resolveLineTotals`) y el total es unidad×qty, así
   * que la base persistida queda 1c bajo la del motor (que trunca el
   * total). Con esto el test fija la convención DEL CANAL —bruto unitario
   * + tarifas en fracción— en vez de copiar la del motor.
   */
  channel_gross?: {
    unit_price: number;
    rates: { rate: number; is_inclusive: boolean }[];
  };
}

/** Una forma del documento: verdad canal (brutos) + orden persistida. */
interface TaxMatrixShape {
  name: string;
  /** Input al motor: precios BRUTOS con flags, como se capturan al vender. */
  channel_input: InvoiceCalculatorInput;
  /** La misma venta ya persistida: netos + filas con fracción. */
  order_lines: OrderLineFixture[];
  /** Decisión de split esperada (documenta el criterio, no lo re-deriva). */
  expect_split: boolean;
}

// --- Formas -----------------------------------------------------------------

const IVA_ID = 1;
const INC_ID = 68;
const ICA_ID = 5;

const SHAPES: TaxMatrixShape[] = [
  {
    // 1. Excluido sin impuesto: 2+ líneas, qty>1. Cero grupos → cabecera
    // (sin filas), y el prevalidador no tiene nada que despejar.
    name: 'sin impuesto (excluido, 2 líneas, qty>1)',
    channel_input: {
      items: [
        { description: 'Pan', quantity: 3, unit_price: 10000 },
        { description: 'Café', quantity: 2, unit_price: 25000 },
      ],
    },
    order_lines: [
      { description: 'Pan', quantity: 3, unit_price: 10000, discount_amount: 0, total_price: 30000, tax_amount_item: 0, taxes: [] },
      { description: 'Café', quantity: 2, unit_price: 25000, discount_amount: 0, total_price: 50000, tax_amount_item: 0, taxes: [] },
    ],
    expect_split: false,
  },
  {
    // 2. IVA 19 % agregado en varias líneas: UN grupo, todo exclusivo →
    // fila agregada de cabecera, como siempre.
    name: 'agregado simple (IVA 19 %, varias líneas)',
    channel_input: {
      items: [
        { description: 'Camisa', quantity: 2, unit_price: 50000, taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }] },
        { description: 'Pantalón', quantity: 1, unit_price: 100000, taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }] },
      ],
    },
    order_lines: [
      { description: 'Camisa', quantity: 2, unit_price: 50000, discount_amount: 0, total_price: 100000, tax_amount_item: 9500, taxes: [{ tax_name: 'IVA', tax_rate: 0.19, tax_type: 'iva', tax_amount: 19000, is_inclusive: false, tax_rate_id: IVA_ID }] },
      { description: 'Pantalón', quantity: 1, unit_price: 100000, discount_amount: 0, total_price: 100000, tax_amount_item: 19000, taxes: [{ tax_name: 'IVA', tax_rate: 0.19, tax_type: 'iva', tax_amount: 19000, is_inclusive: false, tax_rate_id: IVA_ID }] },
    ],
    expect_split: false,
  },
  {
    // 3. INC 8 % incluido, qty>1, con decimales que TRUNCAN.
    // El canal trunca la base POR UNIDAD (`resolveLineTotals`): 1000/1.08
    // → 925.92 (no 925.9259…), y el total es unidad×qty = 2777.76 — UN
    // centavo bajo la base del motor (2777.77, que trunca el total). El
    // centavo lo absorbe la BASE (y la cuota, 222.21 vs 222.22): el
    // documento queda internamente exacto y valida limpio. Fijar acá la
    // base del motor (2777.77) con la unidad truncada (925.92) sería una
    // orden INCOHERENTE (total ≠ qty×precio) que ningún canal persiste:
    // `checkout.service.ts` escribe `total_net = base×qty` con la misma
    // base truncada que `unit_price`.
    name: 'incluido simple (INC 8 %, qty>1, trunca)',
    channel_input: {
      items: [
        { description: 'Postre', quantity: 3, unit_price: 1000, is_inclusive: true, taxes: [{ tax_name: 'INC', tax_rate: 8, tax_type: 'inc', is_inclusive: true }] },
        { description: 'Jugo', quantity: 2, unit_price: 499.99, is_inclusive: true, taxes: [{ tax_name: 'INC', tax_rate: 8, tax_type: 'inc', is_inclusive: true }] },
      ],
    },
    order_lines: [
      { description: 'Postre', quantity: 3, unit_price: 925.93, discount_amount: 0, total_price: 2777.79, tax_amount_item: 74.07, taxes: [{ tax_name: 'INC', tax_rate: 0.08, tax_type: 'inc', tax_amount: 222.21, is_inclusive: true, tax_rate_id: INC_ID }], channel_gross: { unit_price: 1000, rates: [{ rate: 0.08, is_inclusive: true }] } },
      { description: 'Jugo', quantity: 2, unit_price: 462.96, discount_amount: 0, total_price: 925.92, tax_amount_item: 37.03, taxes: [{ tax_name: 'INC', tax_rate: 0.08, tax_type: 'inc', tax_amount: 74.06, is_inclusive: true, tax_rate_id: INC_ID }], channel_gross: { unit_price: 499.99, rates: [{ rate: 0.08, is_inclusive: true }] } },
    ],
    expect_split: true,
  },
  {
    // 4. MISMA línea mixta: IVA 19 % INCLUIDO + ICA 7 ‰ AGREGADO.
    // El motor despeja sólo con el inclusivo (divisor 1.19) y liquida el
    // ICA sobre la base despejada; las dos filas comparten base, así que
    // el override por línea es único. Dos grupos → parte.
    // REGRESIÓN DE TARIFA: la fracción ICA `0.007` persiste `7` (por mil),
    // no `0.7` — ver `orderTaxFractionToInvoiceRate`.
    name: 'mixto misma línea (IVA 19 % incl + ICA 7 ‰ agr)',
    channel_input: {
      items: [
        {
          description: 'Servicio gravado',
          quantity: 1,
          unit_price: 119000,
          is_inclusive: true,
          taxes: [
            { tax_name: 'IVA', tax_rate: 19, tax_type: 'iva', is_inclusive: true },
            { tax_name: 'ICA', tax_rate: 7, tax_type: 'ica', is_inclusive: false, rate_basis: 'per_mil' },
          ],
        },
      ],
    },
    order_lines: [
      {
        description: 'Servicio gravado',
        quantity: 1,
        unit_price: 100000,
        discount_amount: 0,
        total_price: 100000,
        tax_amount_item: 19700,
        taxes: [
          { tax_name: 'IVA', tax_rate: 0.19, tax_type: 'iva', tax_amount: 19000, is_inclusive: true, tax_rate_id: IVA_ID },
          { tax_name: 'ICA', tax_rate: 0.007, tax_type: 'ica', tax_amount: 700, is_inclusive: false, tax_rate_id: ICA_ID },
        ],
      },
    ],
    expect_split: true,
  },
  {
    // 5. DISTINTAS líneas mixtas: A agregada (IVA), B incluida (INC).
    // Dos grupos → parte; la línea A emite qty×precio tal cual y la B
    // despejada desde su base persistida.
    name: 'mixto distintas líneas (A agregada, B incluida)',
    channel_input: {
      items: [
        { description: 'Camisa', quantity: 1, unit_price: 50000, taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }] },
        { description: 'Licor', quantity: 2, unit_price: 540, is_inclusive: true, taxes: [{ tax_name: 'INC', tax_rate: 8, tax_type: 'inc', is_inclusive: true }] },
      ],
    },
    order_lines: [
      { description: 'Camisa', quantity: 1, unit_price: 50000, discount_amount: 0, total_price: 50000, tax_amount_item: 9500, taxes: [{ tax_name: 'IVA', tax_rate: 0.19, tax_type: 'iva', tax_amount: 9500, is_inclusive: false, tax_rate_id: IVA_ID }] },
      { description: 'Licor', quantity: 2, unit_price: 500, discount_amount: 0, total_price: 1000, tax_amount_item: 40, taxes: [{ tax_name: 'INC', tax_rate: 0.08, tax_type: 'inc', tax_amount: 80, is_inclusive: true, tax_rate_id: INC_ID }] },
    ],
    expect_split: true,
  },
  {
    // 6. Multi-tasa AGREGADO (IVA 19 % + INC 8 %, distintos esquemas DIAN)
    // con descuento POR LÍNEA. Dos grupos → parte; el descuento vive en
    // la línea, así que el allowance de pie es cero.
    // (Dos tarifas del MISMO esquema no entran acá a propósito: el emisor
    // las fusiona en un `TaxSubtotal` y el prevalidador las frena con
    // `TAX_SCHEME_RATE_COLLISION` por diseño, no por aritmética.)
    name: 'agregado multi-tasa (IVA 19 % + INC 8 %) + descuento por línea',
    channel_input: {
      items: [
        { description: 'Camisa', quantity: 2, unit_price: 50000, discount_amount: 5000, taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }] },
        { description: 'Licor', quantity: 1, unit_price: 100000, discount_amount: 10000, taxes: [{ tax_name: 'INC', tax_rate: 8, tax_type: 'inc' }] },
      ],
    },
    order_lines: [
      { description: 'Camisa', quantity: 2, unit_price: 50000, discount_amount: 5000, total_price: 95000, tax_amount_item: 9025, taxes: [{ tax_name: 'IVA', tax_rate: 0.19, tax_type: 'iva', tax_amount: 18050, is_inclusive: false, tax_rate_id: IVA_ID }] },
      { description: 'Licor', quantity: 1, unit_price: 100000, discount_amount: 10000, total_price: 90000, tax_amount_item: 7200, taxes: [{ tax_name: 'INC', tax_rate: 8e-2, tax_type: 'inc', tax_amount: 7200, is_inclusive: false, tax_rate_id: INC_ID }] },
    ],
    expect_split: true,
  },
];

// --- Espejo de `createFromOrder` (mapeo orden→documento, SIN motor) ----------

/**
 * Lo que `createFromOrder` deriva de la orden, sin Prisma ni contexto.
 * La agregación (`aggregateOrderTaxes`) y la decisión (`needsOrderLineTaxSplit`)
 * son el código REAL —una reversión del call-site o del criterio tumba este
 * spec—; sólo las sumas flotantes de cabecera y el mapeo de ítems se
 * replican con sus expresiones exactas (documentadas en cada línea).
 */
function mapOrderToDocument(order_lines: OrderLineFixture[]) {
  const line_inclusive = order_lines.map((line) =>
    line.taxes.some((t) => t.is_inclusive === true),
  );

  // `subtotal/discount/tax/total`: las mismas sumas flotantes del servicio.
  const subtotal = order_lines.reduce(
    (acc, line) => acc + Number(line.quantity) * Number(line.unit_price),
    0,
  );
  const discount = order_lines.reduce(
    (acc, line) => acc + Number(line.discount_amount),
    0,
  );
  const tax = order_lines.reduce(
    (acc, line) => acc + Number(line.tax_amount_item || 0) * Number(line.quantity),
    0,
  );
  const total = subtotal - discount + tax;

  const aggregated = aggregateOrderTaxes(
    order_lines.map((line) => ({
      total_price: line.total_price,
      order_item_taxes: line.taxes.map((t) => ({ ...t })),
    })),
  );
  const split = needsOrderLineTaxSplit(
    aggregated.distinct_group_count,
    aggregated.order_line_taxes,
  );

  return {
    line_inclusive,
    subtotal,
    discount,
    tax,
    total,
    order_line_taxes: aggregated.order_line_taxes,
    header_rows: aggregated.header_rows,
    distinct_group_count: aggregated.distinct_group_count,
    split,
  };
}

/**
 * Redondeo de escritura a `numeric(12,2)`: lo que Postgres guarda cuando
 * `createFromOrder` persiste un flotante con polvo binario (p. ej.
 * 3×925.92 = 2777.7599999999998 → 2777.76). El prevalidador lee ESE valor,
 * no el flotante crudo.
 */
const dbRound2 = (n: number) => Math.round(n * 100) / 100;

/** Un centavo en espacio Decimal: la tolerancia del prevalidador (`ONE_CENT`, privado allá). */
const CENT = toDecimal('0.01');

/** Códigos aritméticos que la misión vigila: FAU02, TaxSubtotal, Payable. */
const ARITHMETIC_CODES: FiscalDocumentFindingCode[] = [
  'HEADER_LINE_EXTENSION_MISMATCH',
  'HEADER_TAX_TOTAL_MISMATCH',
  'TAX_SUBTOTAL_MISMATCH',
  'TAX_RATE_MISSING',
  'TAX_SCHEME_RATE_COLLISION',
  'PAYABLE_AMOUNT_MISMATCH',
  'PAYABLE_NETS_WITHHOLDING',
  'PAYABLE_NETS_PREPAID',
];

/** Resolución vigente determinista: el reporte sale limpio del todo. */
const RESOLUTION = {
  id: 7,
  resolution_number: '18760000001',
  prefix: 'FE',
  range_from: 1,
  range_to: 1000,
  current_number: 5,
  valid_from: new Date('2026-01-01T00:00:00Z'),
  valid_to: new Date('2026-12-31T00:00:00Z'),
  is_active: true,
  technical_key: 'a1b2c3d4e5'.repeat(4),
};

describe('InvoicingService · matriz fiscal createFromOrder+split+prevalidador', () => {
  const calculator = new InvoiceCalculatorService();
  const validator = new FiscalDocumentValidator();
  // `resolveInclusiveLineOverrides` sólo lee campos + `Logger`: instancia
  // REAL con deps stub, invocada por su nombre vía `as any` (privado).
  const flow = new InvoiceFlowService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const toTaxRow = (Object.create(InvoicingService.prototype) as any)
    .buildInvoiceTaxCreateInput as (row: unknown) => Record<string, unknown>;

  /**
   * Arma el documento persistido + el input del prevalidador para una forma:
   * líneas con ids, filas de impuesto (por línea si `split`, de cabecera si
   * no — UNA sola forma, como `createFromOrder`), overrides REALES y
   * cabecera redondeada a `numeric(12,2)`.
   */
  const buildDocument = (shape: TaxMatrixShape) => {
    const engine = calculator.calculate(shape.channel_input);
    const mapped = mapOrderToDocument(shape.order_lines);

    const persisted_items = shape.order_lines.map((line, index) => ({
      id: 11 + index,
      description: line.description,
      quantity: new Prisma.Decimal(line.quantity),
      unit_price: new Prisma.Decimal(line.unit_price),
      discount_amount: new Prisma.Decimal(line.discount_amount),
      tax_amount: new Prisma.Decimal(
        Number(line.tax_amount_item || 0) * Number(line.quantity),
      ),
      total_amount: new Prisma.Decimal(
        Number(line.quantity) * Number(line.unit_price) -
          Number(line.discount_amount),
      ),
      is_inclusive: mapped.line_inclusive[index],
    }));

    // UNA sola forma, como `createFromOrder`: por línea (vinculadas) si
    // `split`, agregadas de cabecera si no — nunca las dos (`persistLineTaxes`
    // vincula por posición contra `invoice_items`, acá por índice directo).
    const persisted_taxes = mapped.split
      ? mapped.order_line_taxes.flatMap((rows, line_index) =>
          rows.map((row) => ({
            ...toTaxRow(row),
            invoice_item_id: persisted_items[line_index].id,
          })),
        )
      : mapped.header_rows.map((row) => ({
          ...toTaxRow(row),
          invoice_item_id: undefined,
        }));

    const persisted = {
      invoice_items: persisted_items,
      invoice_taxes: persisted_taxes,
    };
    const overrides = (flow as any).resolveInclusiveLineOverrides(
      persisted,
    ) as Map<number, { unit_price: string; discount_amount: string }>;

    const input: FiscalDocumentValidationInput = {
      document_type: 'sales_invoice',
      invoice_number: 'FE6',
      issue_date: new Date('2026-08-14T18:00:00Z'),
      timezone: 'America/Bogota',
      currency: 'COP',
      operation_type: '10',
      subtotal_amount: dbRound2(mapped.subtotal - mapped.discount),
      discount_amount: dbRound2(mapped.discount),
      tax_amount: dbRound2(mapped.tax),
      withholding_amount: '0.00',
      total_amount: dbRound2(mapped.total),
      // Mismo mapeo que `buildValidationInput`: la línea inclusiva emite
      // el precio despejado, la exclusiva tal cual se persistió.
      items: persisted_items.map((item, index) => ({
        line_number: index + 1,
        description: item.description,
        quantity: item.quantity.toString(),
        unit_price:
          overrides.get(Number(item.id))?.unit_price ?? item.unit_price.toString(),
        discount_amount:
          overrides.get(Number(item.id))?.discount_amount ??
          item.discount_amount.toString(),
        unit_code: 'EA',
      })),
      taxes: persisted_taxes.map((tax: any) => ({
        tax_name: String(tax.tax_name),
        tax_type: String(tax.tax_type),
        tax_rate: tax.tax_rate.toString(),
        taxable_amount: tax.taxable_amount.toString(),
        tax_amount: tax.tax_amount.toString(),
      })),
      resolution: RESOLUTION,
    };

    return { engine, mapped, persisted, persisted_items, persisted_taxes, overrides, input };
  };

  describe.each(SHAPES.map((shape) => [shape.name, shape] as const))(
    'forma %s',
    (_name, shape) => {
      it('(fixture) la orden persistida reproduce al motor (o al canal, si trunca)', () => {
        const { engine } = buildDocument(shape);
        expect(engine.lines).toHaveLength(shape.order_lines.length);
        // Sin esta atadura el fixture podría derivar en silencio y el resto
        // del test validaría una ficción.
        engine.lines.forEach((line, index) => {
          const order = shape.order_lines[index];
          if (!order.channel_gross) {
            // Línea exacta: base y cuota son EXACTAMENTE las del motor.
            expect(dianAmount(order.total_price)).toBe(line.line_extension_amount);
            const order_tax_total = dianSum(order.taxes.map((t) => t.tax_amount));
            expect(order_tax_total).toBe(line.tax_amount);
            return;
          }
          // Línea con decimales periódicos: el fixture sigue la convención
          // DEL CANAL (`resolveLineTotals` REAL sobre el bruto unitario),
          // no la del motor — ver `channel_gross`.
          const channel = resolveLineTotals(
            order.channel_gross.unit_price,
            order.channel_gross.rates,
          );
          expect(channel.base).toBe(order.unit_price);
          expect(channel.taxes.map((t) => t.amount)).toEqual(
            order.taxes.map(() => order.tax_amount_item),
          );
          // …y es coherente consigo misma: total == qty×unidad − descuento
          // (la incoherencia unidad↔total no la persiste ningún canal).
          expect(dbRound2(order.quantity * order.unit_price - order.discount_amount)).toBe(
            order.total_price,
          );
          expect(dbRound2(order.tax_amount_item * order.quantity)).toBe(
            Number(dianSum(order.taxes.map((t) => t.tax_amount))),
          );
          // …a lo sumo un centavo del motor (el que absorbe el truncado).
          for (const [persisted, reference] of [
            [dianAmount(order.total_price), line.line_extension_amount],
            [dianSum(order.taxes.map((t) => t.tax_amount)), line.tax_amount],
          ] as const) {
            expect(
              toDecimal(persisted).minus(toDecimal(reference)).abs().greaterThan(CENT),
            ).toBe(false);
          }
        });
      });

      it('(a) total_before_tax es la Σ de line_extension emitidos (truncados)', () => {
        const { engine, input } = buildDocument(shape);
        // Invariante del motor, fuente de la referencia.
        expect(engine.totals.total_before_tax).toBe(
          dianSum(engine.lines.map((line) => line.line_extension_amount)),
        );
        // El documento: la cabecera que `createFromOrder` persiste
        // (flotantes → `numeric(12,2)`) es EXACTAMENTE la Σ de las líneas
        // EMITIDAS —ya despejadas cuando son inclusivas—, que es lo que
        // viaja al XML y lo que FAU02 contrasta. Igualdad exacta, no
        // tolerancia: posible porque la orden es coherente a 2 dec (ver el
        // test de fixture); el centavo de tolerancia del prevalidador queda
        // como red, y (c) lo ejercita contra el mismo input.
        const emitted = (input.items ?? []).map((item) => ({
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_amount: item.discount_amount,
        }));
        // `dianAmount` a la izquierda porque la cabecera viaja como número
        // (`String(38000)` es `'38000'`, no `'38000.00'`): lo que se compara
        // es el VALOR a 2 dec, no su serialización.
        expect(dianAmount(String(input.subtotal_amount))).toBe(
          dianLineExtensionTotal(emitted),
        );
        expect(dianAmount(String(input.tax_amount))).toBe(
          dianSum((input.taxes ?? []).map((tax) => tax.tax_amount)),
        );
        expect(dianAmount(String(input.total_amount))).toBe(
          dianArithmetic([
            { value: String(input.subtotal_amount), sign: 1 },
            { value: String(input.tax_amount), sign: 1 },
          ]),
        );
      });

      it('(b) el split persiste bases por línea cuando el prevalidador las necesita', () => {
        const { mapped, persisted_items, overrides } = buildDocument(shape);
        expect(mapped.split).toBe(shape.expect_split);
        const inclusive_ids = persisted_items
          .filter((item) => item.is_inclusive === true)
          .map((item) => Number(item.id));
        if (inclusive_ids.length === 0) {
          // Sin líneas inclusivas el prevalidador nunca cae al fallback
          // `bruto − impuesto`: no hay nada que partir por esta razón.
          expect(overrides.size).toBe(0);
        } else {
          // Con líneas inclusivas el split es OBLIGATORIO (#81): cada una
          // tiene que despejarse desde su base persistida, no del fallback.
          expect(mapped.split).toBe(true);
          for (const id of inclusive_ids) {
            expect(overrides.has(id)).toBe(true);
          }
        }
      });

      it('(c) el prevalidador no reporta FAU02 / TaxSubtotal / PayableAmount', () => {
        const { input } = buildDocument(shape);
        const report = validator.validate(input);
        const arithmetic = report.findings.filter((finding) =>
          ARITHMETIC_CODES.includes(finding.code),
        );
        expect(
          arithmetic.map((finding) => `${finding.code}: ${finding.problem}`),
        ).toEqual([]);
        expect(report.blockers).toEqual([]);
        expect(report.emittable).toBe(true);
      });
    },
  );

  describe('regresión factura #81 (INC inclusivo 4629.63, un solo tributo)', () => {
    const incl = (base: number) => [
      {
        tax_rate_id: INC_ID,
        tax_name: 'INC',
        tax_rate: 8,
        taxable_amount: base,
        tax_amount: 370.37,
        tax_type: 'inc',
        is_inclusive: true,
      },
    ];

    it('parte por línea aunque haya un solo grupo', () => {
      // Base post-fix A.2 (antes 4629.62/370.36: el corto de 2¢ del bug —
      // «caso del bug», PLAN objetivo 5).
      expect(needsOrderLineTaxSplit(1, [incl(4629.63)] as any)).toBe(true);
    });

    it('el fallback bruto−impuesto sobre netos daría 4259.26 (doble despeje documentado)', () => {
      // La unidad persistida YA es neta (4629.62); recomputar la base como
      // `bruto − impuesto` resta la cuota OTRA vez. Por eso el split no es
      // optimización: es lo que impide facturar 4259.26 en vez de 4629.62.
      const fallback_base = toDecimal(
        dianLineExtension({ quantity: 1, unit_price: 4629.62, discount_amount: 0 }),
      ).minus(toDecimal(370.36));
      expect(dianAmount(fallback_base)).toBe('4259.26');
      expect(dianAmount(fallback_base)).not.toBe('4629.62');
    });

    it('emite la base persistida y valida limpio de punta a punta', () => {
      const shape: TaxMatrixShape = {
        name: '#81',
        channel_input: {
          items: [
            {
              description: 'Plato #81',
              quantity: 1,
              unit_price: 5000,
              is_inclusive: true,
              taxes: [{ tax_name: 'INC', tax_rate: 8, tax_type: 'inc', is_inclusive: true }],
            },
          ],
        },
        order_lines: [
          {
            description: 'Plato #81',
            quantity: 1,
            unit_price: 4629.63,
            discount_amount: 0,
            total_price: 4629.63,
            tax_amount_item: 370.37,
            taxes: [{ tax_name: 'INC', tax_rate: 0.08, tax_type: 'inc', tax_amount: 370.37, is_inclusive: true, tax_rate_id: INC_ID }],
          },
        ],
        expect_split: true,
      };
      const { engine, mapped, persisted_items, overrides, input } =
        buildDocument(shape);
      // Base post-fix A.2 («caso del bug», PLAN objetivo 5): $5.000 INC 8%
      // cierra en 4629.63 + 370.37 = 5000.00.
      expect(engine.totals.total_before_tax).toBe('4629.63');
      expect(mapped.split).toBe(true);
      expect(overrides.has(Number(persisted_items[0].id))).toBe(true);
      const report = validator.validate(input);
      expect(
        report.findings.filter((finding) => ARITHMETIC_CODES.includes(finding.code)),
      ).toEqual([]);
      expect(report.emittable).toBe(true);
    });
  });

  describe('orderTaxFractionToInvoiceRate — la unidad la decide el tipo fiscal', () => {
    it.each([
      [0.19, 'iva', 19],
      [0.08, 'inc', 8],
      [0.05, 'iva', 5],
      [0, 'iva', 0],
    ])('fracción %s (%s) → %s (porcentaje)', (fraction, type, expected) => {
      expect(orderTaxFractionToInvoiceRate(fraction, type)).toBe(expected);
    });

    it.each([
      [0.007, 'ica', 7],
      [0.004, 'ica', 4],
      [0.00966, 'reteica', 9.66],
    ])('fracción %s (%s) → %s (POR MIL, no porcentaje)', (fraction, type, expected) => {
      expect(orderTaxFractionToInvoiceRate(fraction, type)).toBe(expected);
    });

    it('sin tipo persiste porcentaje (histórico)', () => {
      expect(orderTaxFractionToInvoiceRate(0.19, null)).toBe(19);
      expect(orderTaxFractionToInvoiceRate(0.19, undefined)).toBe(19);
    });

    it('REGRESIÓN forma 4: 0.007 ICA persistía 0.7 y tumbaba el TaxSubtotal', () => {
      // 100000 × 0.7 / 1000 = 70 ≠ 700 de cuota real: el prevalidador lo
      // frenaba con TAX_SUBTOTAL_MISMATCH y la factura mixta con ICA nacida
      // de orden no tenía documento fiscal.
      expect(orderTaxFractionToInvoiceRate(0.007, 'ica')).not.toBe(0.7);
      expect(orderTaxFractionToInvoiceRate(0.007, 'ica')).toBe(7);
    });
  });
});
