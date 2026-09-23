import { AutoEntryService } from './auto-entry.service';

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
  } = {}) => {
    const codes = opts.codes ?? CODES;
    const unscoped = {
      invoices: {
        findFirst: jest.fn(async (args: any) =>
          args?.select?.related_invoice
            ? (opts.creditNote ?? null)
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
    const service = new AutoEntryService(
      prisma as any,
      accountMapping as any,
      { resolveAccountingEntityForFiscal: jest.fn() } as any,
      {
        isAreaEnabled: jest.fn().mockResolvedValue(true),
        isSubflowEnabled: jest.fn().mockResolvedValue(true),
      } as any,
      {
        recordFailure: jest.fn(),
        recordSkip: jest.fn().mockResolvedValue(undefined),
      } as any,
    );
    const createAutoEntry = jest
      .spyOn(service, 'createAutoEntry')
      .mockResolvedValue({ id: 999 } as any);
    return { service, createAutoEntry, unscoped };
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

  it('asiento de venta que NO cubre el total de la factura ⇒ se contabiliza la factura completa', async () => {
    const { service, createAutoEntry } = build({
      entries: [
        {
          id: 800,
          source_type: 'payment.received',
          total_credit: 5000,
          accounting_entry_lines: [
            { credit_amount: 5000, account: { code: '4135' } },
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
        order_id: SALE.order_id,
        accounting_status: 'not_applicable',
      },
    };

    it('sin refund: reversa ingreso/impuestos contra la caja que recibió el cobro, nunca 1305', async () => {
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
        expect.objectContaining({ account_code: '1105', credit_amount: 5950 }),
      );
      expect(lines.some((l) => l.account_code === '1305')).toBe(false);
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
  });
});
