import { Prisma } from '@prisma/client';
import {
  aggregateOrderTaxes,
  InvoicingService,
  needsOrderLineTaxSplit,
  normalizeInvoiceTaxRate,
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
import { resolveOrderLineTaxTotal } from '../taxes/utils/final-price.util';
import {
  createPrismaMock,
  mockRequestContext,
  type PrismaMock,
} from '../../../testing/prisma-mock';
import { buildOrder, buildOrderItem } from '../../../testing/money-fixtures';

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
  /**
   * `total_price`: base de TODA la línea. `order_items` NO tiene columna de
   * descuento: el único descuento de una orden es el de cabecera
   * (`orders.discount_amount`), que `createFromOrder` reparte con
   * `projectOrderInvoiceLines` (ver `invoicing.service.order-discount.spec`).
   */
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
      { description: 'Pan', quantity: 3, unit_price: 10000, total_price: 30000, tax_amount_item: 0, taxes: [] },
      { description: 'Café', quantity: 2, unit_price: 25000, total_price: 50000, tax_amount_item: 0, taxes: [] },
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
      { description: 'Camisa', quantity: 2, unit_price: 50000, total_price: 100000, tax_amount_item: 9500, taxes: [{ tax_name: 'IVA', tax_rate: 0.19, tax_type: 'iva', tax_amount: 19000, is_inclusive: false, tax_rate_id: IVA_ID }] },
      { description: 'Pantalón', quantity: 1, unit_price: 100000, total_price: 100000, tax_amount_item: 19000, taxes: [{ tax_name: 'IVA', tax_rate: 0.19, tax_type: 'iva', tax_amount: 19000, is_inclusive: false, tax_rate_id: IVA_ID }] },
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
      { description: 'Postre', quantity: 3, unit_price: 925.93, total_price: 2777.79, tax_amount_item: 74.07, taxes: [{ tax_name: 'INC', tax_rate: 0.08, tax_type: 'inc', tax_amount: 222.21, is_inclusive: true, tax_rate_id: INC_ID }], channel_gross: { unit_price: 1000, rates: [{ rate: 0.08, is_inclusive: true }] } },
      { description: 'Jugo', quantity: 2, unit_price: 462.96, total_price: 925.92, tax_amount_item: 37.03, taxes: [{ tax_name: 'INC', tax_rate: 0.08, tax_type: 'inc', tax_amount: 74.06, is_inclusive: true, tax_rate_id: INC_ID }], channel_gross: { unit_price: 499.99, rates: [{ rate: 0.08, is_inclusive: true }] } },
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
      { description: 'Camisa', quantity: 1, unit_price: 50000, total_price: 50000, tax_amount_item: 9500, taxes: [{ tax_name: 'IVA', tax_rate: 0.19, tax_type: 'iva', tax_amount: 9500, is_inclusive: false, tax_rate_id: IVA_ID }] },
      { description: 'Licor', quantity: 2, unit_price: 500, total_price: 1000, tax_amount_item: 40, taxes: [{ tax_name: 'INC', tax_rate: 0.08, tax_type: 'inc', tax_amount: 80, is_inclusive: true, tax_rate_id: INC_ID }] },
    ],
    expect_split: true,
  },
  {
    // 6. Multi-tasa AGREGADO (IVA 19 % + INC 8 %, distintos esquemas DIAN),
    // qty > 1. Dos grupos → parte. Antes esta forma llevaba un
    // `discount_amount` POR LÍNEA que `order_items` no tiene: el servicio
    // leía esa columna inexistente y el descuento real de la orden
    // desaparecía de la factura (P0-2). El descuento de orden se cubre con el
    // reparto real en `invoicing.service.order-discount.spec`.
    // (Dos tarifas del MISMO esquema se cubren en `ubl-shipping-tax-line.spec`:
    // el emisor abre un `TaxSubtotal` por tarifa y el prevalidador ya no emite
    // `TAX_SCHEME_RATE_COLLISION`.)
    name: 'agregado multi-tasa (IVA 19 % + INC 8 %)',
    channel_input: {
      items: [
        { description: 'Camisa', quantity: 2, unit_price: 50000, taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }] },
        { description: 'Licor', quantity: 1, unit_price: 100000, taxes: [{ tax_name: 'INC', tax_rate: 8, tax_type: 'inc' }] },
      ],
    },
    order_lines: [
      { description: 'Camisa', quantity: 2, unit_price: 50000, total_price: 100000, tax_amount_item: 9500, taxes: [{ tax_name: 'IVA', tax_rate: 0.19, tax_type: 'iva', tax_amount: 19000, is_inclusive: false, tax_rate_id: IVA_ID }] },
      { description: 'Licor', quantity: 1, unit_price: 100000, total_price: 100000, tax_amount_item: 8000, taxes: [{ tax_name: 'INC', tax_rate: 8e-2, tax_type: 'inc', tax_amount: 8000, is_inclusive: false, tax_rate_id: INC_ID }] },
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
/**
 * Impuesto TOTAL de una línea del fixture, con el helper REAL que
 * `createFromOrder` consume (`resolveOrderLineTaxTotal`): Σ `order_item_taxes`
 * cuando hay desglose, y si no el escalar × `resolveLineUnits`. Antes acá se
 * replicaba `tax_amount_item × quantity`, que era el defecto del servicio: el
 * espejo habría seguido afirmando una fórmula que el servicio ya no tiene.
 * Para estas formas (sin `price_unit_quantity` ni peso) el valor es idéntico
 * al que el espejo producía antes — por eso ninguna cambia de número.
 */
const orderLineTaxTotal = (line: OrderLineFixture) =>
  resolveOrderLineTaxTotal({
    quantity: line.quantity,
    tax_amount_item: line.tax_amount_item,
    order_item_taxes: line.taxes,
  });

function mapOrderToDocument(order_lines: OrderLineFixture[]) {
  const line_inclusive = order_lines.map((line) =>
    line.taxes.some((t) => t.is_inclusive === true),
  );

  // `subtotal/discount/tax/total`: las mismas sumas flotantes del servicio.
  const subtotal = order_lines.reduce(
    (acc, line) => acc + Number(line.quantity) * Number(line.unit_price),
    0,
  );
  // Sin columna de descuento en `order_items` (ver `OrderLineFixture`) y sin
  // descuento de orden en estas formas: ninguna línea se proyecta.
  const discount = 0;
  const tax = order_lines.reduce(
    (acc, line) => acc + orderLineTaxTotal(line),
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
      discount_amount: new Prisma.Decimal(0),
      tax_amount: new Prisma.Decimal(orderLineTaxTotal(line)),
      total_amount: new Prisma.Decimal(
        Number(line.quantity) * Number(line.unit_price),
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
          // …y es coherente consigo misma: total == qty×unidad
          // (la incoherencia unidad↔total no la persiste ningún canal).
          expect(dbRound2(order.quantity * order.unit_price)).toBe(
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

  describe('normalizeInvoiceTaxRate — F-212, el escritor deja de poder persistir la fracción de IVA', () => {
    it('IVA fracción (0.19) sin tax_rate_id resoluble se escala a porcentaje (19)', () => {
      expect(normalizeInvoiceTaxRate(0.19, 'iva').toNumber()).toBe(19);
    });

    it('IVA fracción (0.05) también se escala — no es un caso especial de 19', () => {
      expect(normalizeInvoiceTaxRate(0.05, 'iva').toNumber()).toBe(5);
    });

    it('sin tax_type (default contractual iva) también se escala', () => {
      expect(normalizeInvoiceTaxRate(0.19, undefined).toNumber()).toBe(19);
      expect(normalizeInvoiceTaxRate(0.19, null).toNumber()).toBe(19);
    });

    it('IVA ya en porcentaje (19) no se toca', () => {
      expect(normalizeInvoiceTaxRate(19, 'iva').toNumber()).toBe(19);
    });

    it('IVA en 0 (exento) no se toca — el umbral es estrictamente > 0', () => {
      expect(normalizeInvoiceTaxRate(0, 'iva').toNumber()).toBe(0);
    });

    it('IVA en el borde exacto (1) no se toca — el umbral es estrictamente < 1', () => {
      expect(normalizeInvoiceTaxRate(1, 'iva').toNumber()).toBe(1);
    });

    it.each([
      ['ica', 0.4],
      ['ica', 0.966],
      ['reteica', 0.007],
      ['withholding', 0.1],
      ['inc', 0.5],
    ])(
      'NO toca tarifas sub-1%% de tipos distintos de IVA (%s %s) — el ICA municipal colombiano SÍ tiene tarifas legítimas ahí',
      (tax_type, rate) => {
        expect(normalizeInvoiceTaxRate(rate, tax_type).toNumber()).toBe(rate);
      },
    );

    it('REGRESIÓN F-212: la nota de crédito 170 heredó 0.19 de la factura 67 — la próxima vez que ese camino escriba, sale en 19', () => {
      // El camino real es `!known` en `applyTaxCatalogToLine` (tax_rate_id no
      // resuelve contra el catálogo) → `buildInvoiceTaxCreateInput`. Aquí se
      // fija sólo el desambiguador puro; el camino completo lo cubre la
      // matriz fiscal de más arriba con el motor real.
      expect(normalizeInvoiceTaxRate(0.19, 'iva').toNumber()).not.toBe(0.19);
      expect(normalizeInvoiceTaxRate(0.19, 'iva').toNumber()).toBe(19);
    });

    it('acepta el tax_rate como string sin perder precisión (forma en la que llega desde el motor)', () => {
      expect(normalizeInvoiceTaxRate('0.19', 'iva').toNumber()).toBe(19);
    });
  });
});

/**
 * `aggregateOrderTaxes` — POBLACIÓN 3 (F-090, eje de código de F-053).
 *
 * `aggregateOrderTaxes` recorre `item.order_item_taxes || []`: una línea SIN
 * filas no aporta nada, sea cual sea la razón de que no tenga filas. Eso
 * confunde DOS poblaciones opuestas bajo un solo veredicto:
 *
 *   1. exenta correcta — escalar `tax_amount_item` en 0, cero filas.
 *   3. escalar > 0 y CERO filas — nace de carriles que el inventario del
 *      plan no contó (pasarela de pago, split de cuenta, kitchen-fire): la
 *      línea aporta impuesto en su escalar pero `invoiceTaxRows` sale vacío
 *      igual que la exenta, y nada lo señalaba.
 *
 * Estos specs fijan que `tax_scalar_without_breakdown` discrimina las dos
 * (y que la población 2 —con desglose— nunca cuenta, tenga o no escalar
 * coincidente), y que agregar la señal NO mueve un byte del resultado
 * aritmético ya existente (`header_rows`, `order_line_taxes`,
 * `distinct_group_count`).
 */
describe('aggregateOrderTaxes — tax_scalar_without_breakdown (población 3, F-090/F-053)', () => {
  it('(1) línea exenta correcta: escalar en 0 y sin filas ⇒ conteo 0', () => {
    const result = aggregateOrderTaxes([
      { total_price: 30000, tax_amount_item: 0, order_item_taxes: [] },
    ]);
    expect(result.tax_scalar_without_breakdown).toEqual({
      count: 0,
      line_indexes: [],
    });
  });

  it('(2) línea con desglose ⇒ conteo 0, aunque el escalar sea > 0', () => {
    const result = aggregateOrderTaxes([
      {
        total_price: 100000,
        tax_amount_item: 19000,
        order_item_taxes: [
          {
            tax_name: 'IVA',
            tax_rate: 0.19,
            tax_type: 'iva',
            tax_amount: 19000,
            is_inclusive: false,
            tax_rate_id: IVA_ID,
          },
        ],
      },
    ]);
    expect(result.tax_scalar_without_breakdown).toEqual({
      count: 0,
      line_indexes: [],
    });
  });

  it('(3) línea con escalar > 0 y CERO filas ⇒ conteo 1 y el índice correcto', () => {
    const result = aggregateOrderTaxes([
      // índice 0: exenta correcta, no debe contar.
      { total_price: 30000, tax_amount_item: 0, order_item_taxes: [] },
      // índice 1: población 3 — el caso que F-090 dice invisible hoy.
      { total_price: 100000, tax_amount_item: 19000, order_item_taxes: [] },
      // índice 2: con desglose, tampoco cuenta.
      {
        total_price: 90000,
        tax_amount_item: 7200,
        order_item_taxes: [
          {
            tax_name: 'INC',
            tax_rate: 0.08,
            tax_type: 'inc',
            tax_amount: 7200,
            is_inclusive: false,
            tax_rate_id: INC_ID,
          },
        ],
      },
    ]);
    expect(result.tax_scalar_without_breakdown).toEqual({
      count: 1,
      line_indexes: [1],
    });
  });

  it('(4) no-regresión aritmética: la misma entrada mixta produce header_rows y distinct_group_count idénticos con y sin el campo nuevo presente', () => {
    // Misma forma en ambas listas —sólo cambia si declaran `tax_amount_item`—
    // para que la comparación no pueda colarse por otra diferencia.
    const linesWithoutScalarField = [
      {
        total_price: 100000,
        order_item_taxes: [
          {
            tax_name: 'IVA',
            tax_rate: 0.19,
            tax_type: 'iva',
            tax_amount: 19000,
            is_inclusive: false,
            tax_rate_id: IVA_ID,
          },
        ],
      },
      {
        total_price: 90000,
        order_item_taxes: [
          {
            tax_name: 'INC',
            tax_rate: 0.08,
            tax_type: 'inc',
            tax_amount: 7200,
            is_inclusive: false,
            tax_rate_id: INC_ID,
          },
        ],
      },
      // Línea exenta, sin el campo nuevo declarado en absoluto (llamador
      // legado): el comportamiento no puede depender de que exista.
      { total_price: 50000, order_item_taxes: [] },
    ];
    const linesWithScalarField = [
      { ...linesWithoutScalarField[0], tax_amount_item: 19000 },
      { ...linesWithoutScalarField[1], tax_amount_item: 7200 },
      { ...linesWithoutScalarField[2], tax_amount_item: 0 },
    ];

    const withoutScalarField = aggregateOrderTaxes(linesWithoutScalarField);
    const withScalarField = aggregateOrderTaxes(linesWithScalarField);

    expect(withScalarField.header_rows).toEqual(withoutScalarField.header_rows);
    expect(withScalarField.order_line_taxes).toEqual(
      withoutScalarField.order_line_taxes,
    );
    expect(withScalarField.distinct_group_count).toBe(
      withoutScalarField.distinct_group_count,
    );
  });
});

/**
 * `createFromOrder` — EL ESCALAR DE LÍNEA CONTRA EL MULTIPLICADOR DE ESCALA.
 *
 * `order_items.tax_amount_item` es el impuesto POR UNIDAD DE PRECIO (ADR-10),
 * y la unidad de precio NO es siempre la unidad de stock: el propio
 * `schema.prisma` fija que «el total de la línea es
 * `unit_price * quantity / price_unit_quantity`». `createFromOrder` derivaba
 * el escalar de la línea de factura multiplicando ese impuesto por
 * `quantity` a secas, así que una caja x12 vendida como caja —`quantity` 12,
 * `price_unit_quantity` 12, UNA unidad de precio— declaraba DOCE veces el
 * impuesto que se cobró, y una línea por PESO (donde el multiplicador real es
 * `order_items.weight`) declaraba el de un solo kilo.
 *
 * El desglose de cabecera (`aggregateOrderTaxes`, que suma
 * `order_item_taxes.tax_amount`) siempre fue correcto, así que el defecto se
 * manifiesta como una DIVERGENCIA interna del documento: el escalar dice una
 * cosa y los cubos de cabecera otra. `checkTaxInclusiveTotal` (FAU06) la
 * detecta y aborta dentro de `signXml` — pero el consecutivo DIAN ya se
 * consumió en `validate()`, así que la venta queda sin documento fiscal y con
 * un número quemado. Por eso esto es dinero y no cosmética.
 *
 * Estas pruebas corren el código REAL de `createFromOrder` (Prisma mockeado,
 * contexto stub) y afirman el impuesto esperado con VALOR LITERAL calculado a
 * mano — nunca contra otro consumidor del mismo kernel, que sería `f(x)`
 * contra `f(x)`.
 */
describe('InvoicingService.createFromOrder — el escalar de línea escala por unidades de precio, no por quantity', () => {
  const ORDER_ID = 9001;
  const STORE_ID = 100;
  const ORGANIZATION_ID = 1;
  const USER_ID = 7;
  const ACCOUNTING_ENTITY_ID = 3;

  /** Todo importe monetario viaja como `Decimal`, igual que la fila real. */
  const money = (value: number | string) => new Prisma.Decimal(value);

  /** Fila `order_item_taxes` de IVA 19 % agregado, con la cuota de LA LÍNEA. */
  const ivaRow = (tax_amount: number) => ({
    tax_rate_id: IVA_ID,
    tax_name: 'IVA',
    tax_rate: money('0.19'),
    tax_amount: money(tax_amount),
    tax_type: 'iva',
    is_inclusive: false,
  });

  let prisma: PrismaMock;
  let service: InvoicingService;

  beforeEach(() => {
    mockRequestContext({
      store_id: STORE_ID,
      organization_id: ORGANIZATION_ID,
      user_id: USER_ID,
    });

    prisma = createPrismaMock({
      orders: ['findFirst'],
      invoices: ['findFirst', 'create'],
    });
    // Sin factura previa: `assertNotAlreadyInvoiced` deja pasar.
    prisma.invoices.findFirst.mockResolvedValue(null);
    prisma.invoices.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...data,
        id: 7001,
        invoice_number: null,
      }),
    );

    service = new InvoicingService(
      prisma as any,
      // A.1: la factura nacida de orden NO numera al crear — el generador
      // no se toca en este camino.
      {} as any,
      { emit: jest.fn() } as any,
      {
        resolveAccountingEntityForFiscal: jest
          .fn()
          .mockResolvedValue({ id: ACCOUNTING_ENTITY_ID }),
      } as any,
      {} as any, // retry_queue
      {} as any, // fiscalGate
      { assertAreaActive: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any, // fiscalInvoiceThreshold
      {} as any, // calculator
      {} as any, // trm
      {} as any, // withholdingFlow
    );
    // El warn de población 3 (F-090) y el log de creación son ruido acá.
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
    jest
      .spyOn((service as any).logger, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  /** Corre el camino real y devuelve el `data` que se iba a persistir. */
  const persistedInvoiceData = async (order: Record<string, unknown>) => {
    prisma.orders.findFirst.mockResolvedValue(order);
    await service.createFromOrder(ORDER_ID);
    return prisma.invoices.create.mock.calls[0][0].data;
  };

  it('caja x12 CON desglose: declara los $11.400 cobrados, no 12 × $11.400', async () => {
    // Caja de 12 unidades a $60.000 la caja, IVA 19 % agregado.
    //   unidades de precio = quantity / price_unit_quantity = 12 / 12 = 1
    //   impuesto de línea  = $11.400 (el desglose persistido, cuota de la caja)
    //   total de línea     = $60.000 + $11.400 = $71.400
    // El defecto multiplicaba por `quantity`: 11.400 × 12 = $136.800.
    const data = await persistedInvoiceData(
      buildOrder({
        order_items: [
          buildOrderItem({
            quantity: 12,
            price_unit_quantity: 12,
            unit_price: money(60000),
            total_price: money(60000),
            tax_amount_item: money(11400),
            order_item_taxes: [ivaRow(11400)],
          }),
        ],
      }),
    );

    const [line] = data.invoice_items.create;
    expect(line.tax_amount.toString()).toBe('11400');
    expect(line.total_amount.toString()).toBe('71400');
    // La cabecera escalar hereda la suma de las líneas.
    expect(data.tax_amount.toString()).toBe('11400');
    expect(data.total_amount.toString()).toBe('71400');
    // …y coincide con el cubo de cabecera, que SIEMPRE fue correcto: es
    // justo esa divergencia la que FAU06 usaba para abortar la firma.
    const [headerTax] = data.invoice_taxes.create;
    expect(headerTax.tax_amount.toString()).toBe('11400');
    expect(headerTax.taxable_amount.toString()).toBe('60000');
  });

  it('NO-REGRESIÓN price_unit_quantity = 1: la línea ordinaria sigue declarando $28.500', async () => {
    // 3 unidades a $50.000, IVA 19 % ⇒ $9.500 por unidad, $28.500 de línea.
    // Sin escala el multiplicador ES `quantity`: este caso vale lo mismo
    // antes y después del arreglo, y está acá para probarlo.
    const data = await persistedInvoiceData(
      buildOrder({
        order_items: [
          buildOrderItem({
            quantity: 3,
            price_unit_quantity: 1,
            unit_price: money(50000),
            total_price: money(150000),
            tax_amount_item: money(9500),
            order_item_taxes: [ivaRow(28500)],
          }),
        ],
      }),
    );

    const [line] = data.invoice_items.create;
    expect(line.tax_amount.toString()).toBe('28500');
    expect(line.total_amount.toString()).toBe('178500');
    expect(data.tax_amount.toString()).toBe('28500');
  });

  it('caja x24 SIN desglose: el escalar cae al fallback y escala por unidades de precio ($8.000)', async () => {
    // Caja de 24 a $100.000, IVA 19 % ⇒ $8.000 aprox. por caja, UNA caja.
    // Sin filas `order_item_taxes` (población 3, F-090) el único dato es el
    // escalar: el multiplicador correcto sigue siendo 24 / 24 = 1, no 24.
    // El defecto declaraba 8.000 × 24 = $192.000.
    const data = await persistedInvoiceData(
      buildOrder({
        order_items: [
          buildOrderItem({
            quantity: 24,
            price_unit_quantity: 24,
            unit_price: money(100000),
            total_price: money(100000),
            tax_amount_item: money(8000),
            order_item_taxes: [],
          }),
        ],
      }),
    );

    const [line] = data.invoice_items.create;
    expect(line.tax_amount.toString()).toBe('8000');
    expect(line.total_amount.toString()).toBe('108000');
    expect(data.tax_amount.toString()).toBe('8000');
  });

  it('línea por PESO: el multiplicador es `weight` (2,5 kg) ⇒ $9.500, no $3.800', async () => {
    // 2,5 kg a $20.000/kg = $50.000 de base, IVA 19 % ⇒ $3.800 por kilo y
    // $9.500 de línea. `quantity` vale 1 acá, así que el defecto declaraba
    // el impuesto de UN solo kilo ($3.800). Esta es la rama que un helper
    // de sola escala (`quantity / price_unit_quantity`) pierde.
    const data = await persistedInvoiceData(
      buildOrder({
        order_items: [
          buildOrderItem({
            quantity: 1,
            price_unit_quantity: 1,
            weight: money('2.500'),
            weight_unit: 'kg',
            unit_price: money(20000),
            total_price: money(50000),
            tax_amount_item: money(3800),
            order_item_taxes: [],
          }),
        ],
      }),
    );

    const [line] = data.invoice_items.create;
    expect(line.tax_amount.toString()).toBe('9500');
    expect(line.total_amount.toString()).toBe('59500');
    expect(data.tax_amount.toString()).toBe('9500');
  });
});


/**
 * QUI-INC — DÓNDE se resuelve el default de `tax_type`.
 *
 * `buildInvoiceTaxCreateInput` es el ÚNICO mapeador de escritura de
 * `invoice_taxes` y lo comparten TRES productores: el motor
 * (`CalculatedTax.tax_type`, ya normalizado), la agregación de la orden
 * (`aggregateOrderTaxes`, que lee `order_item_taxes.tax_type`) y el carril
 * declarativo (`dto.taxes[]`). Cuando el default vivía ahí (`?? 'iva'`), el
 * mapeador ya no sabía de cuál de los tres venía la fila: una ausencia por
 * PÉRDIDA en el camino se veía igual que una ausencia por DECLARACIÓN, y la
 * primera se convertía en IVA. Así nació el «IVA del 8 %» aceptado por la
 * DIAN (tienda 105).
 *
 * Ahora `InvoiceTaxRowInput.tax_type` es requerido —un cuarto productor que
 * lo olvide no compila— y cada productor lo resuelve contra su propia fila
 * fuente.
 */
describe('InvoicingService · tax_type se resuelve en la fila fuente (QUI-INC)', () => {
  // Los tres métodos bajo prueba son puros respecto del grafo de DI: sólo se
  // llaman entre sí. Se instancia el prototipo para ejercitarlos sin levantar
  // el módulo entero.
  const service = Object.create(InvoicingService.prototype) as any;

  it('el mapeador de escritura NO fabrica: persiste exactamente el tipo que recibe', () => {
    const row = service.buildInvoiceTaxCreateInput({
      tax_rate_id: 68,
      tax_name: 'INC',
      tax_rate: 8,
      taxable_amount: 100000,
      tax_amount: 8000,
      tax_type: 'inc',
      is_inclusive: false,
    });

    expect(row.tax_type).toBe('inc');
    expect(row.tax_name).toBe('INC');
    expect(row.tax_rate.toString()).toBe('8');
  });

  it('el carril declarativo resuelve el default contra el propio DTO (fila fuente)', () => {
    const [row] = service.buildDocumentLevelTaxRows([
      {
        tax_name: 'IVA',
        tax_rate: 19,
        taxable_amount: 100000,
        tax_amount: 19000,
      },
    ]);

    // Sin tipo declarado, la regla «sin tipar significa IVA» aplica AQUÍ, que
    // es donde aún se ve que la ausencia es del cliente y no una pérdida.
    expect(row.tax_type).toBe('iva');
  });

  it('el carril declarativo respeta el tipo que el cliente SÍ declaró', () => {
    const [row] = service.buildDocumentLevelTaxRows([
      {
        tax_name: 'INC',
        tax_rate: 8,
        taxable_amount: 100000,
        tax_amount: 8000,
        tax_type: 'inc',
      },
    ]);

    expect(row.tax_type).toBe('inc');
  });

  it('la agregación de la orden propaga el tipo del snapshot hasta la fila escrita', () => {
    // Reproduce la composición de la fila de producción `order_item_taxes.id=130`
    // pero YA sana: `tax_rate_id=68` / `INC` / 8 % con `tax_type='inc'`. Antes,
    // un `tax_type` nulo en esa misma fila salía como `iva` al lado de un
    // `tax_name='INC'` — el documento se contradecía a sí mismo.
    const { header_rows } = aggregateOrderTaxes([
      {
        total_price: 100000,
        order_item_taxes: [
          {
            tax_rate_id: 68,
            tax_name: 'INC',
            tax_rate: 0.08,
            tax_amount: 8000,
            tax_type: 'inc',
            is_inclusive: false,
          },
        ],
      } as any,
    ]);

    expect(header_rows).toHaveLength(1);
    expect(header_rows[0].tax_type).toBe('inc');

    const written = service.buildInvoiceTaxCreateInput(header_rows[0]);
    expect(written.tax_type).toBe('inc');
    expect(written.tax_name).toBe('INC');
  });

  it('una fila de orden SIN tipar resuelve a iva en la agregación, no en el escritor', () => {
    const { header_rows } = aggregateOrderTaxes([
      {
        total_price: 100000,
        order_item_taxes: [
          {
            tax_rate_id: 1,
            tax_name: 'IVA',
            tax_rate: 0.19,
            tax_amount: 19000,
            tax_type: null,
            is_inclusive: false,
          },
        ],
      } as any,
    ]);

    expect(header_rows[0].tax_type).toBe('iva');
  });
});
