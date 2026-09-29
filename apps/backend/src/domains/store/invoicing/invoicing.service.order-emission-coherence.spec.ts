import { Prisma } from '@prisma/client';
import { InvoicingService } from './invoicing.service';
import { judgeDraftLineSnapshot } from './invoice-flow/invoice-flow.service';
import { InvoiceCalculatorService } from './services/invoice-calculator.service';
import { FiscalDocumentValidator } from './validators/fiscal-document.validator';
import {
  createPrismaMock,
  mockRequestContext,
  type PrismaMock,
} from '../../../testing/prisma-mock';
import { buildOrder, buildOrderItem } from '../../../testing/money-fixtures';

/**
 * `createFromOrder` — coherencia de emisión desde POS/orden (Agente D, tareas
 * 3a/3b/3c). Cubre:
 *
 * 1. F-090 (Task 3a, luego cerrado por Agente E): una línea con
 *    `tax_amount_item > 0` pero sin filas `order_item_taxes` (origen
 *    kitchen-fire / pasarela de pago / split de cuenta) NO rechaza — sigue
 *    facturando su escalar vía `resolveOrderLineTaxTotal` (Σ
 *    `order_item_taxes` → escalar × `resolveLineUnits`), con `logger.warn`
 *    como rastro — pero AHORA su impuesto SÍ llega a `invoice_taxes`: se
 *    resuelve contra un hermano real de la misma orden o contra la
 *    asignación de impuesto del producto (`orphan-line-tax.util.ts`), nunca
 *    inventado. El riesgo que un intento previo de throw fail-closed había
 *    dejado abierto (cabecera con más impuesto del que sus filas
 *    respaldaban) se prueba CERRADO con el validador REAL
 *    (`FiscalDocumentValidator.validate`): `HEADER_TAX_TOTAL_MISMATCH` ya NO
 *    dispara para este documento.
 * 2. Los montos reales de restaurante (3×1300, 10×25000, 1×24500, INC 8 %
 *    inclusivo) cierran dentro de 1 ¢ y la factura resultante pasa el
 *    validador REAL (`FiscalDocumentValidator` vía `judgeDraftLineSnapshot`
 *    y `checkTaxSubtotals`) sin hallazgos bloqueantes.
 * 3. `order_items.price_unit_quantity` (venta por caja/empaque) se copia al
 *    `invoice_items` creado — antes de la corrección, `createFromOrder` era
 *    el único punto de creación de factura que NO lo copiaba.
 */
describe('InvoicingService.createFromOrder — coherencia de emisión (F-090, cierre 8% inclusivo, price_unit_quantity)', () => {
  const ORDER_ID = 9001;
  const money = (value: number | string) => new Prisma.Decimal(value);

  let prisma: PrismaMock;
  let service: InvoicingService;

  beforeEach(() => {
    mockRequestContext({ store_id: 105, organization_id: 1, user_id: 7 });

    prisma = createPrismaMock({
      orders: ['findFirst'],
      invoices: ['findFirst', 'create', 'update'],
      invoice_items: ['findMany', 'deleteMany'],
      invoice_taxes: ['createMany', 'deleteMany'],
      // F-090 remediación (Agente E) — la línea huérfana (población 3)
      // resuelve su tarifa contra el catálogo del producto vía una
      // consulta APARTE (`this.prisma.products.findMany`, no anidada en el
      // `include` de `orders.findFirst` — ver el comentario en
      // `invoicing.service.ts` sobre el OOM de `backend-typecheck` que
      // motivó separarla). Vacío por defecto: el test F-090 de este
      // archivo resuelve por la SIBLING tier (un hermano real de la misma
      // orden), no por catálogo de producto.
      products: ['findMany'],
    });
    prisma.products.findMany.mockResolvedValue([]);
    prisma.invoices.findFirst.mockResolvedValue(null);
    prisma.invoices.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...data,
        id: 7001,
        invoice_number: null,
      }),
    );
    prisma.invoice_taxes.createMany.mockImplementation(
      async ({ data }: { data: unknown[] }) => ({ count: data.length }),
    );

    service = new InvoicingService(
      prisma as any,
      {} as any,
      { emit: jest.fn() } as any,
      {
        resolveAccountingEntityForFiscal: jest.fn().mockResolvedValue({ id: 3 }),
      } as any,
      {} as any,
      {} as any,
      { assertAreaActive: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
      new InvoiceCalculatorService(),
      {} as any,
      {} as any,
    );
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
    jest
      .spyOn((service as any).logger, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const createDraft = async (
    order: Record<string, unknown>,
    opts: { persisted_items?: number } = {},
  ) => {
    prisma.orders.findFirst.mockResolvedValue(buildOrder(order));
    const lineCount =
      opts.persisted_items ??
      (order.order_items as unknown[]).length +
        (Number(order.shipping_cost || 0) > 0 ? 1 : 0);
    prisma.invoice_items.findMany.mockResolvedValue(
      Array.from({ length: lineCount }, (_, index) => ({ id: 501 + index })),
    );
    await service.createFromOrder(ORDER_ID);
    const data = prisma.invoices.create.mock.calls[0][0].data;
    const line_tax_rows = (prisma.invoice_taxes.createMany.mock.calls[0]?.[0]
      ?.data ?? []) as any[];
    return { data, line_tax_rows };
  };

  /** Fila `order_item_taxes` INC 8 % inclusivo con el `tax_amount` dado. */
  const incLineTax = (amount: string) => ({
    tax_rate_id: 68,
    tax_name: 'INC',
    tax_rate: money('0.08'),
    tax_amount: money(amount),
    tax_type: 'inc',
    is_inclusive: true,
  });

  /** `checkTaxSubtotals` del prevalidador REAL sobre las filas persistidas. */
  const taxSubtotalFindings = (rows: any[]) =>
    (new FiscalDocumentValidator() as any).checkTaxSubtotals(
      rows.map((row) => ({
        tax_name: row.tax_name,
        tax_type: row.tax_type,
        tax_rate: row.tax_rate,
        taxable_amount: row.taxable_amount,
        tax_amount: row.tax_amount,
      })),
    ) as Array<{ code: string; severity: string }>;

  it('F-090: línea con tax_amount_item > 0 y order_item_taxes vacío NO rechaza — usa el escalar vía resolveLineUnits, con logger.warn, y su impuesto SÍ llega a invoice_taxes (resuelto contra un hermano real) — el validador REAL confirma que HEADER_TAX_TOTAL_MISMATCH ya no dispara', async () => {
    // Línea sana (fire-to-kitchen normal, con desglose completo).
    const sane = buildOrderItem({
      id: 1,
      quantity: 3,
      unit_price: money('1203.703333333333333333'),
      total_price: money('3611.11'),
      tax_rate: money('0.08'),
      tax_amount_item: money('288.89'),
      order_item_taxes: [incLineTax('288.89')],
    });
    // Línea huérfana (F-090): declara impuesto escalar pero sin fila de
    // tarifa — origen kitchen-fire / pasarela / split de cuenta.
    const orphan = buildOrderItem({
      id: 2,
      product_id: 202,
      quantity: 1,
      unit_price: money('50000'),
      total_price: money('50000'),
      tax_rate: money('0.08'),
      tax_amount_item: money('4000'),
      order_item_taxes: [], // <- F-090
    });

    const { data, line_tax_rows } = await createDraft({
      shipping_cost: money(0),
      order_items: [sane, orphan],
    });

    // No fail-closed: el borrador SÍ se crea. La línea huérfana factura su
    // escalar tal cual (quantity=1, price_unit_quantity=1 ⇒ `resolveLineUnits`
    // = 1, sin peso ni empaque que lo escale) — exactamente lo que
    // `invoicing.service.tax-matrix.spec.ts` ya prueba para esta población.
    expect(prisma.invoices.create).toHaveBeenCalledTimes(1);
    const [saneLine, orphanLine] = data.invoice_items.create;
    expect(saneLine.tax_amount.toString()).toBe('288.89');
    expect(orphanLine.tax_amount.toString()).toBe('4000');
    expect(orphanLine.total_amount.toString()).toBe('54000');

    // El warn de F-090 es el único rastro contable de la línea huérfana.
    expect((service as any).logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('F-090: 1 línea(s)'),
    );

    // La cabecera SÍ suma el impuesto de ambas líneas (288.89 + 4000)...
    expect(data.tax_amount.toString()).toBe('4288.89');
    // ...y AHORA (Agente E, F-090 remediación) `invoice_taxes` también lo
    // hace: la línea huérfana resuelve su tarifa contra el hermano real de
    // la misma orden (INC 8 %, `tax_rate_id: 68`, la única fila
    // `order_item_taxes` real del documento) y aporta su propia fila —
    // enlazada a su `invoice_item_id` porque el INC inclusivo de la línea
    // sana ya forzaba el camino partido (`persistLineTaxes`/`createMany`).
    // El riesgo que Task 3a había dejado abierto (cabecera sin respaldo de
    // filas) queda cerrado: 2 filas, una por línea, que suman exactamente
    // la cabecera.
    expect(line_tax_rows).toHaveLength(2);
    expect(
      line_tax_rows.reduce(
        (sum: number, row: any) => sum + Number(row.tax_amount),
        0,
      ),
    ).toBeCloseTo(4288.89, 2);

    // Confirmación con el validador REAL, no con aritmética propia del test:
    // el mismo documento que `createFromOrder` acaba de construir YA NO
    // dispara ninguno de los 4 hallazgos de descuadre aritmético — la
    // cabecera declara 4.288,89 y `cac:TaxTotal` ahora sí respalda ese
    // importe. `RESOLUTION_MISSING` sigue siendo blocker aparte (el test
    // pasa `resolution: null` a propósito, algo ortogonal a este fix), así
    // que no se afirma `emittable === true`.
    const report = new FiscalDocumentValidator().validate({
      document_type: 'sales_invoice',
      subtotal_amount: data.subtotal_amount,
      discount_amount: data.discount_amount ?? '0.00',
      tax_amount: data.tax_amount,
      total_amount: data.total_amount,
      items: data.invoice_items.create.map((line: any, index: number) => ({
        line_number: index + 1,
        quantity: line.quantity,
        unit_price: line.unit_price,
        discount_amount: line.discount_amount,
        tax_amount: line.tax_amount,
        price_unit_quantity: line.price_unit_quantity ?? undefined,
      })),
      taxes: line_tax_rows.map((row: any) => ({
        tax_name: row.tax_name,
        tax_type: row.tax_type,
        tax_rate: row.tax_rate,
        taxable_amount: row.taxable_amount,
        tax_amount: row.tax_amount,
      })),
      resolution: null,
    });

    const codes = report.findings.map((f) => f.code);
    expect(codes).not.toContain('HEADER_TAX_TOTAL_MISMATCH');
    expect(codes).not.toContain('HEADER_LINE_EXTENSION_MISMATCH');
    expect(codes).not.toContain('PAYABLE_AMOUNT_MISMATCH');
    expect(codes).not.toContain('TAX_SUBTOTAL_MISMATCH');
    expect(report.computed.tax_total_amount).toBe('4288.89');
  });

  it('restaurante real (3×1300, 10×25000, 1×24500, INC 8% inclusivo): cierra sin drift bloqueante y pasa el validador real', async () => {
    // Bases/impuestos despejados a mano para cada bruto inclusivo (base +
    // impuesto = bruto exacto; impuesto declarado dentro de 1 ¢ de
    // base × 8 %, igual que el patrón ya aceptado por el prevalidador en
    // `invoicing.service.shipping-tax.spec.ts`).
    const l1Total = money('3611.11'); // 3 × 1.300 = 3.900,00 bruto
    const l1Tax = money('288.89');
    const l2Total = money('231481.48'); // 10 × 25.000 = 250.000,00 bruto
    const l2Tax = money('18518.52');
    const l3Total = money('22685.19'); // 1 × 24.500 = 24.500,00 bruto
    const l3Tax = money('1814.81');

    const line1 = buildOrderItem({
      id: 1,
      product_id: 301,
      product_name: 'Limonada de coco (x3)',
      quantity: 3,
      unit_price: l1Total.div(3),
      total_price: l1Total,
      tax_rate: money('0.08'),
      tax_amount_item: l1Tax,
      order_item_taxes: [incLineTax(l1Tax.toString())],
    });
    const line2 = buildOrderItem({
      id: 2,
      product_id: 302,
      product_name: 'Bandeja paisa (x10)',
      quantity: 10,
      unit_price: l2Total.div(10),
      total_price: l2Total,
      tax_rate: money('0.08'),
      tax_amount_item: l2Tax,
      order_item_taxes: [incLineTax(l2Tax.toString())],
    });
    const line3 = buildOrderItem({
      id: 3,
      product_id: 303,
      product_name: 'Sancocho especial',
      quantity: 1,
      unit_price: l3Total,
      total_price: l3Total,
      tax_rate: money('0.08'),
      tax_amount_item: l3Tax,
      order_item_taxes: [incLineTax(l3Tax.toString())],
    });

    const { data, line_tax_rows } = await createDraft({
      shipping_cost: money(0),
      order_items: [line1, line2, line3],
    });

    // Cabecera: Σ bases y Σ impuestos de las 3 líneas, bruto exacto 278.400.
    expect(data.subtotal_amount.toString()).toBe('257777.78');
    expect(data.tax_amount.toString()).toBe('20622.22');
    expect(data.total_amount.toString()).toBe('278400');

    // INC inclusivo con un solo tributo ⇒ split forzado por línea (igual
    // que el caso ya cubierto en shipping-tax.spec para INC).
    expect(line_tax_rows).toHaveLength(3);
    expect(line_tax_rows.every((r) => r.tax_type === 'inc')).toBe(true);

    // FAU06 (Σ filas = impuesto de cabecera) vía el validador real.
    expect(taxSubtotalFindings(line_tax_rows)).toEqual([]);

    // Ninguna línea queda bloqueada por el gate del borrador (drift de
    // cierre 8% inclusivo dentro de tolerancia — confirma Task 3b: los
    // montos reales del enunciado SÍ cierran).
    for (const [index, line] of data.invoice_items.create.entries()) {
      const verdict = judgeDraftLineSnapshot(
        { ...line, id: 501 + index },
        line_tax_rows,
      );
      expect(verdict.kind).not.toBe('block');
    }
  });

  it('price_unit_quantity (venta por caja/empaque) se copia de order_items a invoice_items', async () => {
    const boxed = buildOrderItem({
      id: 1,
      product_id: 401,
      product_name: 'Cerveza artesanal (caja x12)',
      quantity: 1,
      unit_price: money('22685.19'),
      total_price: money('22685.19'),
      tax_rate: money('0.08'),
      tax_amount_item: money('1814.81'),
      price_unit_quantity: 12,
      order_item_taxes: [incLineTax('1814.81')],
    });

    const { data } = await createDraft({
      shipping_cost: money(0),
      order_items: [boxed],
    });

    expect(data.invoice_items.create[0].price_unit_quantity).toBe(12);
  });

  it('línea sin empaque (price_unit_quantity=1, el valor por defecto de la orden): se copia igual, sin degradar a null', async () => {
    const plain = buildOrderItem({
      id: 1,
      product_id: 402,
      quantity: 1,
      unit_price: money('22685.19'),
      total_price: money('22685.19'),
      tax_rate: money('0.08'),
      tax_amount_item: money('1814.81'),
      price_unit_quantity: 1,
      order_item_taxes: [incLineTax('1814.81')],
    });

    const { data } = await createDraft({
      shipping_cost: money(0),
      order_items: [plain],
    });

    expect(data.invoice_items.create[0].price_unit_quantity).toBe(1);
  });
});
