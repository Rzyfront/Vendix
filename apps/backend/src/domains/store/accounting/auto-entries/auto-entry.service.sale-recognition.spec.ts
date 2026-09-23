import { AutoEntryService } from './auto-entry.service';
import { buildOrderSaleTaxPayload } from '../../payments/utils/order-sale-tax-payload.util';

/**
 * Doble conteo de la venta POS facturada.
 *
 * `payment.received` sale antes de que exista la factura (POS_SALE_COMPLETED
 * la crea después), así que el asiento del pago reconoce ingreso + impuestos
 * en la rama «sin factura». Al aceptar la DIAN, `onInvoiceValidated` NO debe
 * volver a reconocerlos. Lo mismo con `credit_sale.created`.
 *
 * Y la devolución con envío: la base neta del envío reversa 414505
 * (`refund.completed.shipping_income_reversal`), con fallback a la cuenta de
 * ingreso si la organización no tiene la cuenta.
 */
describe('AutoEntryService · reconocimiento único de la venta', () => {
  const CODES: Record<string, string> = {
    'payment.received.cash': '1105',
    'payment.received.revenue': '4135',
    'payment.received.shipping_income': '414505',
    'payment.received.iva_payable': '240802',
    'payment.received.vat_payable': '2408',
    'payment.received.accounts_receivable': '1305',
    'invoice.validated.accounts_receivable': '1305',
    'invoice.validated.revenue': '4135',
    'invoice.validated.shipping_income': '414505',
    'invoice.validated.iva_payable': '240802',
    'invoice.validated.vat_payable': '2408',
    'credit_sale.created.accounts_receivable': '1305',
    'credit_sale.created.revenue': '4135',
    'credit_sale.created.shipping_income': '414505',
    'credit_sale.created.iva_payable': '240802',
    'credit_sale.created.vat_payable': '2408',
    'refund.completed.revenue': '4135',
    'refund.completed.cash': '1105',
    'refund.completed.iva_payable': '240802',
    'refund.completed.vat_payable': '2408',
    'refund.completed.shipping_income_reversal': '414505',
    'refund.completed.bank_transfer': '1110',
    'credit_note.accepted.sales_returns': '4175',
    'credit_note.accepted.iva_payable': '240802',
    'credit_note.accepted.accounts_receivable': '1305',
    'credit_note.accepted.customer_refund_payable': '2805',
    'payment.received.sales_discount': '4175',
    'payment.received.inc_payable': '243605',
    'credit_sale.created.sales_discount': '4175',
    'credit_sale.created.inc_payable': '243605',
    'payment.received.tip_payable': '238005',
    'invoice.validated.retefuente_receivable': '135515',
  };

  // Venta: subtotal 10.000, IVA 19 % = 1.900, flete neto 5.000 → total 16.900.
  const SALE = {
    order_id: 70,
    payment_id: 900,
    invoice_id: 55,
    subtotal: 10000,
    tax: 1900,
    shipping: 5000,
    total: 16900,
  };

  const build = (opts: {
    invoice?: any;
    payments?: any[];
    entries?: any[];
    chartAccount?: any;
    codes?: Record<string, string>;
    /** accounting_entries.findMany cuando el where trae source_type. */
    bySource?: Record<string, any[]>;
    /** accounting_entries.findFirst por source_type. */
    firstBySource?: Record<string, any>;
    creditNote?: any;
    creditNotes?: any[];
    refunds?: any[];
    returnOrders?: any[];
    /** Factura de venta vigente de la orden (re-emisión); sólo si su id está en where.id.in. */
    reissued?: any;
    /** invoice_data_requests de la orden (status + new_invoice_id). */
    dataRequests?: any[];
  } = {}) => {
    const codes = opts.codes ?? CODES;
    const unscoped = {
      invoices: {
        findFirst: jest.fn(async (args: any) =>
          args?.select?.related_invoice
            ? (opts.creditNote ?? null)
            : Array.isArray(args?.where?.id?.in)
              ? opts.reissued && args.where.id.in.includes(opts.reissued.id)
                ? opts.reissued
                : null
            : opts.invoice === undefined
              ? {
                  order_id: SALE.order_id,
                  invoice_type: 'sales_invoice',
                  total_amount: SALE.total,
                }
              : opts.invoice,
        ),
        findMany: jest.fn().mockResolvedValue(opts.creditNotes ?? []),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      refunds: {
        findMany: jest.fn().mockResolvedValue(opts.refunds ?? []),
      },
      return_orders: {
        findMany: jest.fn().mockResolvedValue(opts.returnOrders ?? []),
      },
      invoice_data_requests: {
        findMany: jest.fn(async (args: any) =>
          (opts.dataRequests ?? []).filter((row) =>
            (args?.where?.status?.in ?? [row.status]).includes(row.status),
          ),
        ),
      },
      fiscal_transmissions: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      payments: {
        findMany: jest
          .fn()
          .mockResolvedValue(opts.payments ?? [{ id: SALE.payment_id }]),
      },
      accounting_entries: {
        findMany: jest.fn(async (args: any) => {
          const type = args?.where?.source_type;
          if (typeof type === 'string') return opts.bySource?.[type] ?? [];
          if (Array.isArray(type?.in))
            return type.in.flatMap((t: string) => opts.bySource?.[t] ?? []);
          // Reversas por orden (refunds + devoluciones): OR de source_type.
          const or = args?.where?.OR;
          if (
            Array.isArray(or) &&
            or.every((row: any) =>
              ['refund.completed', 'return_order.refund'].includes(
                row.source_type,
              ),
            )
          )
            return or.flatMap((row: any) => opts.bySource?.[row.source_type] ?? []);
          return opts.entries ?? [];
        }),
        findFirst: jest.fn(
          async (args: any) =>
            opts.firstBySource?.[args?.where?.source_type] ?? null,
        ),
      },
      invoice_items: { findMany: jest.fn().mockResolvedValue([]) },
      chart_of_accounts: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts.chartAccount === undefined ? { id: 1 } : opts.chartAccount,
          ),
      },
    };
    const prisma = {
      // onPaymentReceived: la factura todavía NO existe (orden de eventos real).
      invoices: { findFirst: jest.fn().mockResolvedValue(null) },
      chart_of_accounts: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
      withoutScope: jest.fn().mockReturnValue(unscoped),
    };
    const accountMapping = {
      getMapping: jest.fn(async (_org: number, key: string) =>
        codes[key] ? { account_code: codes[key], source: 'default' } : null,
      ),
    };
    const failures = {
      recordFailure: jest.fn(),
      recordSkip: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AutoEntryService(
      prisma as any,
      accountMapping as any,
      { resolveAccountingEntityForFiscal: jest.fn() } as any,
      {
        isAreaEnabled: jest.fn().mockResolvedValue(true),
        isSubflowEnabled: jest.fn().mockResolvedValue(true),
      } as any,
      failures as any,
    );
    const createAutoEntry = jest
      .spyOn(service, 'createAutoEntry')
      .mockResolvedValue({ id: 999 } as any);
    return { service, createAutoEntry, unscoped, failures };
  };

  const linesOf = (call: any[]) => (call[0].lines as any[]).filter(Boolean);
  const sum = (lines: any[], side: 'debit_amount' | 'credit_amount') =>
    Math.round(lines.reduce((acc, l) => acc + Number(l[side]), 0) * 100) / 100;
  const creditOn = (lines: any[], code: string) =>
    sum(
      lines.filter((l) => l.account_code === code),
      'credit_amount',
    );

  /** Asiento posteado como lo guardaría createAutoEntry, para la búsqueda. */
  const asPostedEntry = (id: number, source_type: string, lines: any[]) => ({
    id,
    source_type,
    total_credit: sum(lines, 'credit_amount'),
    accounting_entry_lines: lines.map((l) => ({
      credit_amount: l.credit_amount,
      account: { code: l.account_code },
    })),
  });

  const invoiceEvent = {
    invoice_id: SALE.invoice_id,
    organization_id: 1,
    store_id: 2,
    subtotal: SALE.subtotal + SALE.shipping,
    shipping_amount: SALE.shipping,
    tax_amount: SALE.tax,
    tax_breakdown: [{ tax_type: 'iva' as const, tax_amount: SALE.tax }],
    total: SALE.total,
  };

  it('venta POS pagada + factura aceptada ⇒ ingreso e impuestos se reconocen UNA vez y el asiento cuadra', async () => {
    const { service, createAutoEntry, unscoped } = build();

    await service.onPaymentReceived({
      payment_id: SALE.payment_id,
      organization_id: 1,
      store_id: 2,
      order_id: SALE.order_id,
      amount: SALE.total,
      subtotal_amount: SALE.subtotal,
      tax_amount: SALE.tax,
      shipping_amount: SALE.shipping,
      tax_breakdown: [{ tax_type: 'iva', tax_amount: SALE.tax }],
    });
    expect(createAutoEntry).toHaveBeenCalledTimes(1);
    const paymentLines = linesOf(createAutoEntry.mock.calls[0]);
    expect(sum(paymentLines, 'debit_amount')).toBe(
      sum(paymentLines, 'credit_amount'),
    );

    unscoped.accounting_entries.findMany.mockResolvedValue([
      asPostedEntry(501, 'payment.received', paymentLines),
    ]);

    const result: any = await service.onInvoiceValidated(invoiceEvent);

    // La factura NO produce otro asiento.
    expect(createAutoEntry).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        skipped: true,
        reason: 'sale_already_recognized',
        covering_entry_ids: [501],
      }),
    );
    // Libro completo: 4135 / 414505 / 240802 una sola vez.
    const all = createAutoEntry.mock.calls.flatMap(linesOf);
    expect(creditOn(all, '4135')).toBe(SALE.subtotal);
    expect(creditOn(all, '414505')).toBe(SALE.shipping);
    expect(creditOn(all, '240802')).toBe(SALE.tax);
    expect(sum(all, 'debit_amount')).toBe(sum(all, 'credit_amount'));
    // La factura queda en estado terminal, no `blocked`.
    expect(unscoped.invoices.updateMany).toHaveBeenCalledWith({
      where: { id: SALE.invoice_id, organization_id: 1 },
      data: { accounting_status: 'not_applicable' },
    });
    // El candidato se busca por la llave real del pago, no por la orden.
    expect(unscoped.accounting_entries.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organization_id: 1,
          status: 'posted',
          OR: expect.arrayContaining([
            { source_type: 'credit_sale.created', source_id: SALE.order_id },
            {
              source_type: 'payment.received',
              source_id: { in: [SALE.payment_id] },
            },
          ]),
        }),
      }),
    );
  });

  it('venta a crédito + factura aceptada ⇒ la factura no duplica el ingreso de credit_sale.created', async () => {
    const { service, createAutoEntry, unscoped } = build({ payments: [] });

    await service.onCreditSaleCreated({
      order_id: SALE.order_id,
      organization_id: 1,
      store_id: 2,
      subtotal_amount: SALE.subtotal,
      tax_amount: SALE.tax,
      shipping_amount: SALE.shipping,
      tax_breakdown: [{ tax_type: 'iva', tax_amount: SALE.tax }],
      total_amount: SALE.total,
    });
    const creditLines = linesOf(createAutoEntry.mock.calls[0]);
    expect(sum(creditLines, 'debit_amount')).toBe(
      sum(creditLines, 'credit_amount'),
    );
    unscoped.accounting_entries.findMany.mockResolvedValue([
      asPostedEntry(601, 'credit_sale.created', creditLines),
    ]);

    const result: any = await service.onInvoiceValidated(invoiceEvent);

    expect(createAutoEntry).toHaveBeenCalledTimes(1);
    expect(result.skipped).toBe(true);
    const all = createAutoEntry.mock.calls.flatMap(linesOf);
    expect(creditOn(all, '4135')).toBe(SALE.subtotal);
    expect(creditOn(all, '240802')).toBe(SALE.tax);
    // Sin pagos, la búsqueda no arma el predicado de payment.received.
    const where = unscoped.accounting_entries.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { source_type: 'credit_sale.created', source_id: SALE.order_id },
    ]);
  });

  it('factura sin venta previa en el libro ⇒ asiento de factura completo, igual que antes', async () => {
    const { service, createAutoEntry, unscoped } = build({ entries: [] });

    await service.onInvoiceValidated(invoiceEvent);

    expect(createAutoEntry).toHaveBeenCalledTimes(1);
    const lines = linesOf(createAutoEntry.mock.calls[0]);
    expect(createAutoEntry.mock.calls[0][0].source_type).toBe(
      'invoice.validated',
    );
    expect(lines).toContainEqual(
      expect.objectContaining({ account_code: '1305', debit_amount: SALE.total }),
    );
    expect(creditOn(lines, '4135')).toBe(SALE.subtotal);
    expect(creditOn(lines, '414505')).toBe(SALE.shipping);
    expect(creditOn(lines, '240802')).toBe(SALE.tax);
    expect(sum(lines, 'debit_amount')).toBe(sum(lines, 'credit_amount'));
    expect(unscoped.invoices.updateMany).not.toHaveBeenCalled();
  });

  it('un «Recaudo factura» (DR caja / CR 1305) no cuenta como venta reconocida', async () => {
    const { service, createAutoEntry } = build({
      entries: [
        {
          id: 700,
          source_type: 'payment.received',
          total_credit: SALE.total,
          accounting_entry_lines: [
            { credit_amount: 0, account: { code: '1105' } },
            { credit_amount: SALE.total, account: { code: '1305' } },
          ],
        },
      ],
    });

    await service.onInvoiceValidated(invoiceEvent);

    expect(createAutoEntry).toHaveBeenCalledTimes(1);
    expect(createAutoEntry.mock.calls[0][0].source_type).toBe(
      'invoice.validated',
    );
  });

  describe('cobertura parcial (A3): orden a medio pagar al aceptarse la factura', () => {
    const HALF = SALE.total / 2; // 8.450

    it('pago 50 + factura 100 + cobro 50 ⇒ ingreso 100 una vez, 1305 en 0, todo cuadrado', async () => {
      // 1) Pago de la mitad sin factura: venta directa por la PORCIÓN del
      //    pago (el emisor manda la cuota de computePaymentSaleShare).
      const first = build();
      await first.service.onPaymentReceived({
        payment_id: SALE.payment_id,
        organization_id: 1,
        store_id: 2,
        order_id: SALE.order_id,
        amount: HALF,
        subtotal_amount: SALE.subtotal / 2,
        tax_amount: SALE.tax / 2,
        shipping_amount: SALE.shipping / 2,
      });
      const payment_lines = linesOf(first.createAutoEntry.mock.calls[0]);
      expect(sum(payment_lines, 'debit_amount')).toBe(HALF);
      expect(sum(payment_lines, 'credit_amount')).toBe(HALF);

      // 2) Factura aceptada por el total: sólo reconoce el saldo no cubierto.
      const second = build({
        payments: [{ id: SALE.payment_id, amount: HALF }],
        entries: [
          {
            ...asPostedEntry(700, 'payment.received', payment_lines),
            source_id: SALE.payment_id,
          },
        ],
      });
      await second.service.onInvoiceValidated(invoiceEvent);
      expect(second.createAutoEntry).toHaveBeenCalledTimes(1);
      expect(second.unscoped.invoices.updateMany).not.toHaveBeenCalled();
      const invoice_lines = linesOf(second.createAutoEntry.mock.calls[0]);
      expect(sum(invoice_lines, 'debit_amount')).toBe(HALF);
      expect(sum(invoice_lines, 'credit_amount')).toBe(HALF);
      expect(invoice_lines).toContainEqual(
        expect.objectContaining({ account_code: '1305', debit_amount: HALF }),
      );

      // 3) Cobro del resto con la factura ya emitida: recaudo contra 1305.
      const third = build();
      third.service['prisma'].invoices.findFirst = jest
        .fn()
        .mockResolvedValue({ id: SALE.invoice_id });
      await third.service.onPaymentReceived({
        payment_id: 901,
        organization_id: 1,
        store_id: 2,
        order_id: SALE.order_id,
        amount: HALF,
        subtotal_amount: SALE.subtotal,
        tax_amount: SALE.tax,
        shipping_amount: SALE.shipping,
      });
      const collection_lines = linesOf(third.createAutoEntry.mock.calls[0]);

      const all = [...payment_lines, ...invoice_lines, ...collection_lines];
      expect(creditOn(all, '4135')).toBe(SALE.subtotal);
      expect(creditOn(all, '414505')).toBe(SALE.shipping);
      // El pago sin desglose tipado acredita 2408 y la factura 240802: el IVA
      // total reconocido es la suma de ambas, una sola vez.
      expect(creditOn(all, '2408') + creditOn(all, '240802')).toBe(SALE.tax);
      const net_1305 =
        sum(
          all.filter((l) => l.account_code === '1305'),
          'debit_amount',
        ) - creditOn(all, '1305');
      expect(net_1305).toBe(0);
      expect(sum(all, 'debit_amount')).toBe(sum(all, 'credit_amount'));
    });

    const netOf = (lines: any[], code: string) =>
      sum(
        lines.filter((l) => l.account_code === code),
        'debit_amount',
      ) - creditOn(lines, code);

    it('con propina: lo reconocido es la porción de VENTA del pago (sin propina); 1305 en 0 al cierre', async () => {
      // Venta 16.900 + propina 1.690 = 18.590, pagada en dos mitades de 9.295.
      const TIP_HALF = 845;
      const first = build();
      await first.service.onPaymentReceived({
        payment_id: SALE.payment_id,
        organization_id: 1,
        store_id: 2,
        order_id: SALE.order_id,
        amount: HALF + TIP_HALF,
        subtotal_amount: SALE.subtotal / 2,
        tax_amount: SALE.tax / 2,
        shipping_amount: SALE.shipping / 2,
        tip_amount: TIP_HALF,
      });
      const payment_lines = linesOf(first.createAutoEntry.mock.calls[0]);
      expect(creditOn(payment_lines, '238005')).toBe(TIP_HALF);

      const second = build({
        entries: [
          {
            ...asPostedEntry(700, 'payment.received', payment_lines),
            source_id: SALE.payment_id,
          },
        ],
      });
      await second.service.onInvoiceValidated(invoiceEvent);
      const invoice_lines = linesOf(second.createAutoEntry.mock.calls[0]);
      // No cubierto = 16.900 − 8.450 (no 16.900 − 9.295).
      expect(sum(invoice_lines, 'debit_amount')).toBe(HALF);
      expect(sum(invoice_lines, 'credit_amount')).toBe(HALF);

      const third = build();
      third.service['prisma'].invoices.findFirst = jest
        .fn()
        .mockResolvedValue({ id: SALE.invoice_id });
      await third.service.onPaymentReceived({
        payment_id: 901,
        organization_id: 1,
        store_id: 2,
        order_id: SALE.order_id,
        amount: HALF + TIP_HALF,
        tip_amount: TIP_HALF,
      });
      const collection_lines = linesOf(third.createAutoEntry.mock.calls[0]);

      const all = [...payment_lines, ...invoice_lines, ...collection_lines];
      expect(creditOn(all, '4135')).toBe(SALE.subtotal);
      expect(creditOn(all, '238005')).toBe(2 * TIP_HALF);
      expect(netOf(all, '1305')).toBe(0);
      expect(sum(all, 'debit_amount')).toBe(sum(all, 'credit_amount'));
    });

    it('con retención: DR 1355 completo en la factura, el resto escala; el cobro final deja 1305 en 0', async () => {
      const W = 250; // retefuente 2,5 % sobre 10.000
      const withholdingInvoice = {
        ...invoiceEvent,
        withholding_breakdown: [
          {
            withholding_type: 'retefuente',
            concept_code: 'RF-SERV',
            rate: 0.025,
            base: SALE.subtotal,
            amount: W,
            account_role: 'invoice.validated.retefuente_receivable',
          } as any,
        ],
      };
      const first = build();
      await first.service.onPaymentReceived({
        payment_id: SALE.payment_id,
        organization_id: 1,
        store_id: 2,
        order_id: SALE.order_id,
        amount: HALF,
        subtotal_amount: SALE.subtotal / 2,
        tax_amount: SALE.tax / 2,
        shipping_amount: SALE.shipping / 2,
      });
      const payment_lines = linesOf(first.createAutoEntry.mock.calls[0]);

      const second = build({
        entries: [
          {
            ...asPostedEntry(700, 'payment.received', payment_lines),
            source_id: SALE.payment_id,
          },
        ],
      });
      await second.service.onInvoiceValidated(withholdingInvoice);
      const invoice_lines = linesOf(second.createAutoEntry.mock.calls[0]);
      expect(invoice_lines).toContainEqual(
        expect.objectContaining({ account_code: '135515', debit_amount: W }),
      );
      expect(invoice_lines).toContainEqual(
        expect.objectContaining({ account_code: '1305', debit_amount: HALF - W }),
      );
      expect(sum(invoice_lines, 'credit_amount')).toBe(HALF);
      expect(sum(invoice_lines, 'debit_amount')).toBe(HALF);

      // El cliente paga el saldo menos lo retenido.
      const third = build();
      third.service['prisma'].invoices.findFirst = jest
        .fn()
        .mockResolvedValue({ id: SALE.invoice_id });
      await third.service.onPaymentReceived({
        payment_id: 901,
        organization_id: 1,
        store_id: 2,
        order_id: SALE.order_id,
        amount: HALF - W,
      });
      const all = [
        ...payment_lines,
        ...invoice_lines,
        ...linesOf(third.createAutoEntry.mock.calls[0]),
      ];
      expect(creditOn(all, '4135')).toBe(SALE.subtotal);
      expect(netOf(all, '1305')).toBe(0);
      expect(netOf(all, '135515')).toBe(W);
      expect(sum(all, 'debit_amount')).toBe(sum(all, 'credit_amount'));
    });

    it('cuenta sin resolver en cobertura parcial ⇒ se omite con registro, nunca la factura completa', async () => {
      const codes: Record<string, string> = { ...CODES };
      delete codes['invoice.validated.shipping_income'];
      const { service, createAutoEntry, failures } = build({
        codes,
        entries: [
          {
            id: 800,
            source_type: 'payment.received',
            source_id: SALE.payment_id,
            total_credit: HALF,
            accounting_entry_lines: [
              { debit_amount: 0, credit_amount: HALF, account: { code: '4135' } },
            ],
          },
        ],
      });

      const result: any = await service.onInvoiceValidated(invoiceEvent);

      expect(result).toEqual(
        expect.objectContaining({
          skipped: true,
          reason: 'partial_coverage_unscalable',
        }),
      );
      expect(createAutoEntry).not.toHaveBeenCalled();
      expect(failures.recordSkip).toHaveBeenCalledWith(
        expect.objectContaining({ cause: 'SKIPPED_MISSING_MAPPING' }),
      );
    });

    it('retención mayor que el saldo no cubierto ⇒ causa propia, no «falta mapeo»', async () => {
      const { service, createAutoEntry, failures } = build({
        entries: [
          {
            id: 800,
            source_type: 'payment.received',
            source_id: SALE.payment_id,
            total_credit: SALE.total - 100,
            accounting_entry_lines: [
              {
                debit_amount: 0,
                credit_amount: SALE.total - 100,
                account: { code: '4135' },
              },
            ],
          },
        ],
      });

      const result: any = await service.onInvoiceValidated({
        ...invoiceEvent,
        withholding_breakdown: [
          {
            withholding_type: 'retefuente',
            concept_code: 'RF-SERV',
            rate: 0.025,
            base: SALE.subtotal,
            amount: 250,
            account_role: 'invoice.validated.retefuente_receivable',
          } as any,
        ],
      });

      expect(result.reason).toBe('partial_coverage_unscalable');
      expect(createAutoEntry).not.toHaveBeenCalled();
      expect(failures.recordSkip).toHaveBeenCalledWith(
        expect.objectContaining({
          cause: 'SKIPPED_PARTIAL_COVERAGE_UNSCALABLE',
          source_type: 'invoice.validated',
          source_id: SALE.invoice_id,
        }),
      );
    });
  });

  it('nota débito nunca se omite aunque la orden tenga venta reconocida', async () => {
    const { service, createAutoEntry, unscoped } = build({
      invoice: {
        order_id: SALE.order_id,
        invoice_type: 'debit_note',
        total_amount: SALE.total,
      },
    });

    await service.onInvoiceValidated(invoiceEvent);

    expect(unscoped.accounting_entries.findMany).not.toHaveBeenCalled();
    expect(createAutoEntry).toHaveBeenCalledTimes(1);
  });

  describe('devolución con envío', () => {
    // Devuelve 5.000 de producto + IVA 950 + envío bruto 1.190 (IVA 190).
    const refund = {
      refund_id: 31,
      organization_id: 1,
      store_id: 2,
      amount: 7140,
      tax_amount: 1140,
      tax_breakdown: [{ tax_type: 'iva' as const, tax_amount: 1140 }],
      subtotal: 5000,
      shipping: 1190,
      refund_method: 'cash',
    };

    it('reversa la base neta del envío contra 414505 y el resto contra 4135', async () => {
      const { service, createAutoEntry } = build();

      await service.onRefundCompleted(refund);

      const lines = linesOf(createAutoEntry.mock.calls[0]);
      expect(lines).toContainEqual(
        expect.objectContaining({
          account_code: '414505',
          debit_amount: 1000,
          credit_amount: 0,
        }),
      );
      expect(lines).toContainEqual(
        expect.objectContaining({
          account_code: '4135',
          debit_amount: 5000,
          credit_amount: 0,
        }),
      );
      expect(lines).toContainEqual(
        expect.objectContaining({ account_code: '1105', credit_amount: 7140 }),
      );
      expect(sum(lines, 'debit_amount')).toBe(sum(lines, 'credit_amount'));
    });

    it('FALLBACK: la organización no tiene la cuenta 414505 ⇒ todo contra el ingreso, como antes', async () => {
      const { service, createAutoEntry } = build({ chartAccount: null });

      await service.onRefundCompleted(refund);

      const lines = linesOf(createAutoEntry.mock.calls[0]);
      expect(lines.some((l) => l.account_code === '414505')).toBe(false);
      expect(lines).toContainEqual(
        expect.objectContaining({ account_code: '4135', debit_amount: 6000 }),
      );
      expect(sum(lines, 'debit_amount')).toBe(sum(lines, 'credit_amount'));
    });

    it('FALLBACK: la clave no resuelve ⇒ todo contra el ingreso', async () => {
      const codes = { ...CODES };
      delete codes['refund.completed.shipping_income_reversal'];
      const { service, createAutoEntry } = build({ codes });

      await service.onRefundCompleted(refund);

      const lines = linesOf(createAutoEntry.mock.calls[0]);
      expect(lines).toContainEqual(
        expect.objectContaining({ account_code: '4135', debit_amount: 6000 }),
      );
      expect(sum(lines, 'debit_amount')).toBe(sum(lines, 'credit_amount'));
    });

    it('evento sin subtotal/envío (return-orders, ruta) ⇒ asiento histórico', async () => {
      const { service, createAutoEntry } = build();

      await service.onRefundCompleted({
        refund_id: 32,
        organization_id: 1,
        store_id: 2,
        amount: 5950,
        tax_amount: 950,
      });

      const lines = linesOf(createAutoEntry.mock.calls[0]);
      expect(lines.some((l) => l.account_code === '414505')).toBe(false);
      expect(lines).toContainEqual(
        expect.objectContaining({ account_code: '4135', debit_amount: 5000 }),
      );
    });
  });
  describe('cobro posterior de una venta a crédito sin factura', () => {
    it('payment.received va por recaudo (DR caja / CR 1305) y no reconoce ingreso otra vez', async () => {
      const { service, createAutoEntry } = build({
        firstBySource: { 'credit_sale.created': { id: 601 } },
      });

      await service.onPaymentReceived({
        payment_id: 901,
        organization_id: 1,
        store_id: 2,
        order_id: SALE.order_id,
        amount: 8000,
        subtotal_amount: SALE.subtotal,
        tax_amount: SALE.tax,
        shipping_amount: SALE.shipping,
      });

      const lines = linesOf(createAutoEntry.mock.calls[0]);
      expect(lines).toEqual([
        expect.objectContaining({ account_code: '1105', debit_amount: 8000 }),
        expect.objectContaining({ account_code: '1305', credit_amount: 8000 }),
      ]);
      expect(lines.some((l) => l.account_code.startsWith('4'))).toBe(false);
      expect(sum(lines, 'debit_amount')).toBe(sum(lines, 'credit_amount'));
    });

    it('sin credit_sale.created ni factura sigue siendo venta directa', async () => {
      const { service, createAutoEntry } = build();

      await service.onPaymentReceived({
        payment_id: 902,
        organization_id: 1,
        store_id: 2,
        order_id: SALE.order_id,
        amount: SALE.total,
        subtotal_amount: SALE.subtotal,
        tax_amount: SALE.tax,
        shipping_amount: SALE.shipping,
      });

      const lines = linesOf(createAutoEntry.mock.calls[0]);
      expect(creditOn(lines, '4135')).toBe(SALE.subtotal);
      expect(sum(lines, 'debit_amount')).toBe(sum(lines, 'credit_amount'));
    });
  });

  describe('nota crédito sobre venta POS ya reconocida (carril único)', () => {
    const NC = {
      invoice_id: 77,
      organization_id: 1,
      store_id: 2,
      subtotal: 5000,
      tax_amount: 950,
      tax_breakdown: [{ tax_type: 'iva' as const, tax_amount: 950 }],
      total: 5950,
    };
    const posPaymentEntry = {
      id: 501,
      accounting_entry_lines: [
        { debit_amount: SALE.total, credit_amount: 0, account: { code: '1105' } },
        { debit_amount: 0, credit_amount: SALE.subtotal, account: { code: '4135' } },
        { debit_amount: 0, credit_amount: SALE.shipping, account: { code: '414505' } },
        { debit_amount: 0, credit_amount: SALE.tax, account: { code: '240802' } },
      ],
    };
    const skippedOriginal = {
      related_invoice: {
        id: SALE.invoice_id,
        order_id: SALE.order_id,
        accounting_status: 'not_applicable',
        total_amount: SALE.total,
      },
    };

    it('sin refund: reversa ingreso/impuestos contra saldo a favor del cliente (2805), nunca caja ni 1305', async () => {
      const { service, createAutoEntry } = build({
        creditNote: skippedOriginal,
        bySource: { 'payment.received': [posPaymentEntry] },
      });

      await service.onCreditNoteAccepted(NC);

      const lines = linesOf(createAutoEntry.mock.calls[0]);
      expect(lines).toContainEqual(
        expect.objectContaining({ account_code: '4175', debit_amount: 5000 }),
      );
      expect(lines).toContainEqual(
        expect.objectContaining({ account_code: '240802', debit_amount: 950 }),
      );
      expect(lines).toContainEqual(
        expect.objectContaining({ account_code: '2805', credit_amount: 5950 }),
      );
      expect(lines.some((l) => l.account_code === '1305')).toBe(false);
      expect(lines.some((l) => l.account_code === '1105')).toBe(false);
      expect(sum(lines, 'debit_amount')).toBe(sum(lines, 'credit_amount'));
    });

    it('refund.completed ya reversó la venta: la NC no postea segundo reverso', async () => {
      const { service, createAutoEntry, unscoped } = build({
        creditNote: skippedOriginal,
        bySource: {
          'payment.received': [posPaymentEntry],
          'refund.completed': [{ id: 950, total_credit: 5950 }],
        },
        refunds: [{ id: 31 }],
      });

      const result: any = await service.onCreditNoteAccepted(NC);

      expect(createAutoEntry).not.toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          skipped: true,
          reason: 'sale_reversal_already_posted_by_refund',
          covering_entry_ids: [950],
        }),
      );
      expect(unscoped.invoices.updateMany).toHaveBeenCalledWith({
        where: { id: NC.invoice_id, organization_id: 1 },
        data: { accounting_status: 'not_applicable' },
      });
    });

    it('factura de origen de venta a crédito: la 1305 existe y la NC la acredita (histórico)', async () => {
      const { service, createAutoEntry } = build({
        creditNote: skippedOriginal,
        firstBySource: { 'credit_sale.created': { id: 601 } },
      });

      await service.onCreditNoteAccepted(NC);

      const lines = linesOf(createAutoEntry.mock.calls[0]);
      expect(lines).toContainEqual(
        expect.objectContaining({ account_code: '1305', credit_amount: 5950 }),
      );
      expect(sum(lines, 'debit_amount')).toBe(sum(lines, 'credit_amount'));
    });

    const ncLane = {
      creditNotes: [{ id: NC.invoice_id }],
      bySource: {
        'credit_note.accepted': [
          {
            id: 960,
            total_credit: 5950,
            accounting_entry_lines: [
              { credit_amount: 0, account: { code: '4175' } },
              { credit_amount: 5950, account: { code: '1105' } },
            ],
          },
        ],
      },
      refunds: [{ id: 31, amount: 5950 }],
    };
    const refundAfterNc = {
      refund_id: 31,
      order_id: SALE.order_id,
      organization_id: 1,
      store_id: 2,
      amount: 5950,
      tax_amount: 950,
    };

    it('refund posterior por el mismo canal (caja): sin asiento, la NC ya reversó', async () => {
      const { service, createAutoEntry } = build(ncLane);

      const result: any = await service.onRefundCompleted({
        ...refundAfterNc,
        effective_channel: 'cash',
      });

      expect(createAutoEntry).not.toHaveBeenCalled();
      expect(result.reason).toBe('sale_reversal_already_posted_by_credit_note');
    });

    it('refund posterior por banco: sólo reclasifica caja → banco, sin tocar ingreso ni impuestos', async () => {
      const { service, createAutoEntry } = build(ncLane);

      await service.onRefundCompleted({
        ...refundAfterNc,
        effective_channel: 'bank_transfer',
      });

      const lines = linesOf(createAutoEntry.mock.calls[0]);
      expect(lines).toEqual([
        expect.objectContaining({ account_code: '1105', debit_amount: 5950 }),
        expect.objectContaining({ account_code: '1110', credit_amount: 5950 }),
      ]);
      // M2 — marca estructurada: la reclasificación no es `refund.completed`,
      // así `sumPostedRefundEntries` nunca la cuenta como reversa de venta.
      expect(createAutoEntry.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          source_type: 'refund.reclassification',
          source_id: 31,
        }),
      );
      expect(sum(lines, 'debit_amount')).toBe(sum(lines, 'credit_amount'));
    });

    it('refund que supera lo reversado por la NC: asiento de devolución completo', async () => {
      const { service, createAutoEntry } = build({
        ...ncLane,
        refunds: [
          { id: 30, amount: 5950 },
          { id: 31, amount: 5950 },
        ],
      });

      await service.onRefundCompleted({
        ...refundAfterNc,
        effective_channel: 'cash',
      });

      const lines = linesOf(createAutoEntry.mock.calls[0]);
      expect(lines).toContainEqual(
        expect.objectContaining({ account_code: '4135', debit_amount: 5000 }),
      );
      expect(sum(lines, 'debit_amount')).toBe(sum(lines, 'credit_amount'));
    });

    describe('re-emisión nominativa (B1)', () => {
      // Venta POS pagada (payment.received reconoció 16.900) facturada con A;
      // el cliente pide factura nominativa: NC espejo de A + factura B.
      const mirrorNc = {
        ...NC,
        subtotal: SALE.subtotal + SALE.shipping,
        tax_amount: SALE.tax,
        tax_breakdown: [{ tax_type: 'iva' as const, tax_amount: SALE.tax }],
        total: SALE.total,
      };
      const paymentLines = posPaymentEntry.accounting_entry_lines.map((l) => ({
        account_code: l.account.code,
        debit_amount: l.debit_amount,
        credit_amount: l.credit_amount,
      }));

      const runReissue = async (opts: { reissued?: any; dataRequests?: any[] }) => {
        const { service, createAutoEntry, unscoped } = build({
          creditNote: skippedOriginal,
          bySource: { 'payment.received': [posPaymentEntry] },
          entries: [asPostedEntry(501, 'payment.received', paymentLines)],
          ...opts,
        });
        const nc: any = await service.onCreditNoteAccepted(mirrorNc);
        const invoiceB: any = await service.onInvoiceValidated({
          ...invoiceEvent,
          invoice_id: 56,
        });
        return { nc, invoiceB, createAutoEntry, unscoped };
      };

      it('NC espejo + factura nueva: ninguna postea; Σ ingreso = venta y caja intacta', async () => {
        const { nc, invoiceB, createAutoEntry, unscoped } = await runReissue({
          reissued: { id: 56 },
          dataRequests: [{ status: 'completed', new_invoice_id: 56 }],
        });
        expect(nc).toEqual(
          expect.objectContaining({ skipped: true, reason: 'reissue_mirror_credit_note' }),
        );
        expect(invoiceB).toEqual(
          expect.objectContaining({ skipped: true, reason: 'sale_already_recognized' }),
        );
        expect(createAutoEntry).not.toHaveBeenCalled();
        // Libro = sólo el asiento del pago: ingreso 10.000 + flete 5.000, caja 16.900.
        expect(creditOn(paymentLines, '4135')).toBe(SALE.subtotal);
        expect(sum(paymentLines.filter((l) => l.account_code === '1105'), 'debit_amount')).toBe(
          SALE.total,
        );
        expect(unscoped.invoices.updateMany).toHaveBeenCalledWith({
          where: { id: NC.invoice_id, organization_id: 1 },
          data: { accounting_status: 'not_applicable' },
        });
      });

      it('NC espejo aceptada antes de crear la factura B (solicitud en curso): tampoco postea', async () => {
        const { nc, createAutoEntry } = await runReissue({
          dataRequests: [{ status: 'processing', new_invoice_id: null }],
        });
        expect(nc.reason).toBe('reissue_mirror_credit_note');
        expect(createAutoEntry).not.toHaveBeenCalled();
      });

      it('factura posterior SIN la solicitud que la originó: no es espejo, la NC postea contra 2805', async () => {
        for (const dataRequests of [
          [],
          [{ status: 'completed', new_invoice_id: 57 }],
          [{ status: 'pending', new_invoice_id: null }],
        ]) {
          const { nc, createAutoEntry } = await runReissue({
            reissued: { id: 56 },
            dataRequests,
          });
          expect(nc?.reason).not.toBe('reissue_mirror_credit_note');
          const lines = linesOf(createAutoEntry.mock.calls[0]);
          expect(lines).toContainEqual(
            expect.objectContaining({ account_code: '2805', credit_amount: SALE.total }),
          );
        }
      });

      it('crédito + re-emisión: NC espejo y factura B omitidas; el cobro deja la 1305 en 0', async () => {
        const creditSaleLines = [
          { account_code: '1305', debit_amount: SALE.total, credit_amount: 0 },
          { account_code: '4135', debit_amount: 0, credit_amount: SALE.subtotal },
          { account_code: '414505', debit_amount: 0, credit_amount: SALE.shipping },
          { account_code: '240802', debit_amount: 0, credit_amount: SALE.tax },
        ];
        const { service, createAutoEntry } = build({
          creditNote: skippedOriginal,
          payments: [],
          firstBySource: { 'credit_sale.created': { id: 601 } },
          entries: [asPostedEntry(601, 'credit_sale.created', creditSaleLines)],
          reissued: { id: 56 },
          dataRequests: [{ status: 'completed', new_invoice_id: 56 }],
        });

        const nc: any = await service.onCreditNoteAccepted(mirrorNc);
        const invoiceB: any = await service.onInvoiceValidated({
          ...invoiceEvent,
          invoice_id: 56,
        });
        expect(nc).toEqual(
          expect.objectContaining({ skipped: true, reason: 'reissue_mirror_credit_note' }),
        );
        expect(invoiceB).toEqual(
          expect.objectContaining({ skipped: true, reason: 'sale_already_recognized' }),
        );
        expect(createAutoEntry).not.toHaveBeenCalled();

        await service.onPaymentReceived({
          payment_id: 905,
          organization_id: 1,
          store_id: 2,
          order_id: SALE.order_id,
          amount: SALE.total,
          subtotal_amount: SALE.subtotal,
          tax_amount: SALE.tax,
          shipping_amount: SALE.shipping,
        });
        const all = [...creditSaleLines, ...linesOf(createAutoEntry.mock.calls[0])];
        expect(creditOn(all, '4135')).toBe(SALE.subtotal);
        const net1305 =
          sum(all.filter((l) => l.account_code === '1305'), 'debit_amount') -
          creditOn(all, '1305');
        expect(net1305).toBe(0);
        expect(sum(all, 'debit_amount')).toBe(sum(all, 'credit_amount'));
      });

      it('NC parcial sin re-emisión: saldo a favor 2805 y el refund posterior lo cruza', async () => {
        const { service, createAutoEntry } = build({
          creditNotes: [{ id: NC.invoice_id }],
          bySource: {
            'credit_note.accepted': [
              {
                id: 961,
                total_credit: 5950,
                accounting_entry_lines: [
                  { credit_amount: 0, account: { code: '4175' } },
                  { credit_amount: 5950, account: { code: '2805' } },
                ],
              },
            ],
          },
          refunds: [{ id: 32, amount: 5950 }],
        });
        await service.onRefundCompleted({
          refund_id: 32,
          order_id: SALE.order_id,
          organization_id: 1,
          store_id: 2,
          amount: 5950,
          tax_amount: 950,
          effective_channel: 'cash',
        });
        const lines = linesOf(createAutoEntry.mock.calls[0]);
        expect(lines).toEqual([
          expect.objectContaining({ account_code: '2805', debit_amount: 5950 }),
          expect.objectContaining({ account_code: '1105', credit_amount: 5950 }),
        ]);
      });
    });

    describe('devolución de return-orders (A1)', () => {
      const returnAfterNc = {
        refund_id: 31, // return_orders.id: choca a propósito con refunds.id 31
        source: 'return_order' as const,
        order_id: SALE.order_id,
        organization_id: 1,
        store_id: 2,
        amount: 5950,
        tax_amount: 950,
      };

      it('NC primero ⇒ la devolución no reversa otra vez (mismo canal) y no se confunde con el refund 31', async () => {
        const { service, createAutoEntry } = build({
          ...ncLane,
          refunds: [],
          returnOrders: [{ id: 31 }],
        });
        const result: any = await service.onRefundCompleted({
          ...returnAfterNc,
          effective_channel: 'cash',
        });
        expect(createAutoEntry).not.toHaveBeenCalled();
        expect(result.reason).toBe('sale_reversal_already_posted_by_credit_note');
      });

      it('NC primero y devolución por otro canal ⇒ sólo reclasificación, con source_type propio', async () => {
        const { service, createAutoEntry } = build({
          ...ncLane,
          refunds: [],
          returnOrders: [{ id: 31 }],
        });
        await service.onRefundCompleted({
          ...returnAfterNc,
          effective_channel: 'bank_transfer',
        });
        expect(createAutoEntry.mock.calls[0][0]).toEqual(
          expect.objectContaining({
            source_type: 'return_order.reclassification',
            source_id: 31,
          }),
        );
        const lines = linesOf(createAutoEntry.mock.calls[0]);
        expect(lines.some((l) => String(l.account_code).startsWith('4'))).toBe(false);
        expect(sum(lines, 'debit_amount')).toBe(sum(lines, 'credit_amount'));
      });

      it('sin NC ⇒ reversa completa bajo return_order.refund (no refund.completed)', async () => {
        const { service, createAutoEntry } = build({ returnOrders: [{ id: 31 }] });
        await service.onRefundCompleted({
          ...returnAfterNc,
          effective_channel: 'cash',
        });
        expect(createAutoEntry.mock.calls[0][0].source_type).toBe(
          'return_order.refund',
        );
        const lines = linesOf(createAutoEntry.mock.calls[0]);
        expect(sum(lines, 'debit_amount')).toBe(sum(lines, 'credit_amount'));
      });

      it('devolución primero ⇒ la NC no postea segundo reverso', async () => {
        const { service, createAutoEntry } = build({
          creditNote: skippedOriginal,
          bySource: {
            'payment.received': [posPaymentEntry],
            'return_order.refund': [{ id: 970, total_credit: 5950 }],
          },
          returnOrders: [{ id: 31 }],
        });
        const result: any = await service.onCreditNoteAccepted(NC);
        expect(createAutoEntry).not.toHaveBeenCalled();
        expect(result).toEqual(
          expect.objectContaining({
            reason: 'sale_reversal_already_posted_by_refund',
            covering_entry_ids: [970],
          }),
        );
      });
    });
  });

  describe('descuento de orden sin factura: impuesto = proyección de la factura', () => {
    // Caso de invoicing.service.order-discount.spec.ts.
    const order = {
      subtotal_amount: 220000,
      tax_amount: 27000,
      discount_amount: 10000,
      grand_total: 242000,
      shipping_cost: 5000,
      shipping_tax_type: 'iva',
      shipping_tax_rate: 0.19,
      shipping_tax_amount: 798.31,
    };
    const order_items = [
      {
        quantity: 2,
        total_price: 100000,
        tax_amount_item: 9500,
        order_item_taxes: [{ tax_type: 'iva', tax_rate: 0.19, tax_amount: 19000 }],
      },
      {
        quantity: 1,
        total_price: 100000,
        tax_amount_item: 8000,
        order_item_taxes: [{ tax_type: 'inc', tax_rate: 0.08, tax_amount: 8000 }],
      },
      { quantity: 1, total_price: 20000, tax_amount_item: 0, order_item_taxes: [] },
    ];
    const sale_tax = buildOrderSaleTaxPayload({
      product_tax_rows: order_items.flatMap((item) =>
        item.order_item_taxes.map((t) => ({ ...t, taxable_amount: item.total_price })),
      ),
      order,
      order_items,
    });
    const debitOn = (lines: any[], code: string) =>
      sum(
        lines.filter((l) => l.account_code === code),
        'debit_amount',
      );

    const expectInvoiceTaxes = (lines: any[]) => {
      expect(sum(lines, 'debit_amount')).toBe(sum(lines, 'credit_amount'));
      // Factura: IVA 18.230,76 + 798,31 del envío · INC 7.676,11.
      expect(creditOn(lines, '240802')).toBe(19029.07);
      expect(creditOn(lines, '243605')).toBe(7676.11);
      // Ingreso por el subtotal de base; 4175 sólo la parte de base.
      expect(creditOn(lines, '4135')).toBe(220000);
      expect(debitOn(lines, '4175')).toBe(8906.87);
      expect(creditOn(lines, '414505')).toBe(4201.69);
    };

    it('payment.received POS directo con descuento cuadra y declara el IVA/INC de la factura', async () => {
      const { service, createAutoEntry } = build();
      await service.onPaymentReceived({
        payment_id: 910,
        organization_id: 1,
        store_id: 2,
        order_id: 71,
        amount: 242000,
        subtotal_amount: order.subtotal_amount,
        tax_amount: sale_tax.tax_amount,
        shipping_amount: sale_tax.shipping_amount,
        tax_breakdown: sale_tax.tax_breakdown,
        discount_amount: sale_tax.discount_amount,
      });
      const lines = linesOf(createAutoEntry.mock.calls[0]);
      expect(debitOn(lines, '1105')).toBe(242000);
      expectInvoiceTaxes(lines);
    });

    it('credit_sale.created con descuento cuadra y declara el IVA/INC de la factura', async () => {
      const { service, createAutoEntry } = build();
      await service.onCreditSaleCreated({
        order_id: 71,
        organization_id: 1,
        store_id: 2,
        subtotal_amount: order.subtotal_amount,
        tax_amount: sale_tax.tax_amount,
        shipping_amount: sale_tax.shipping_amount,
        tax_breakdown: sale_tax.tax_breakdown,
        discount_amount: sale_tax.discount_amount,
        total_amount: order.grand_total,
      });
      const lines = linesOf(createAutoEntry.mock.calls[0]);
      expect(debitOn(lines, '1305')).toBe(242000);
      expectInvoiceTaxes(lines);
    });
  });
});
