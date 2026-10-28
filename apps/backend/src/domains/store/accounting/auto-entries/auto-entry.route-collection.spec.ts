import { AutoEntryService } from './auto-entry.service';

/**
 * S11 — route (dispatch) collection of a COD order. The route event has no
 * order_id; accounting resolves the real order (accounting_order_id) and, when
 * the order is invoiced, books cash against CxC instead of "venta directa".
 */
describe('AutoEntryService.onPaymentReceived — route collection (S11)', () => {
  const build = (invoiced: boolean) => {
    const prisma = {
      invoices: { findFirst: jest.fn().mockResolvedValue(invoiced ? { id: 1 } : null) },
      withoutScope: jest.fn().mockReturnValue({
        accounting_entries: { findFirst: jest.fn().mockResolvedValue(null) },
      }),
    };
    // account_code === mapping key, so assertions read by key.
    const mapping = {
      getMapping: jest.fn(async (_o: number, key: string) => ({ account_code: key, source: 'default' })),
    };
    const service = new AutoEntryService(
      prisma as any,
      mapping as any,
      { resolveAccountingEntityForFiscal: jest.fn() } as any,
      { isAreaEnabled: jest.fn().mockResolvedValue(true), isSubflowEnabled: jest.fn().mockResolvedValue(true) } as any,
      { recordFailure: jest.fn(), recordSkip: jest.fn() } as any,
    );
    const create = jest.spyOn(service, 'createAutoEntry').mockResolvedValue({ id: 1 } as any);
    return { service, create };
  };

  const wh = (type: string, amount: number) => ({
    code: type, amount, withholding_type: type, concept_code: type, rate: 0, base: 0,
    role: 'suffered', account_role: `withholding.suffered.${type}_receivable`,
  });

  const base = {
    payment_id: null as any,
    organization_id: 1,
    store_id: 2,
    order_id: 55,
    payment_method: 'cash',
    amount: 100,
    route_collection: true,
  };

  const totals = (lines: any[]) => {
    const l = lines.filter(Boolean);
    return {
      debit: Math.round(l.reduce((a, x) => a + x.debit_amount, 0) * 100) / 100,
      credit: Math.round(l.reduce((a, x) => a + x.credit_amount, 0) * 100) / 100,
    };
  };

  it('invoiced COD, W>0: DR Caja C + DR retención W / CR CxC C+W, sin ingreso, balanceado', async () => {
    const { service, create } = build(true);

    await service.onPaymentReceived({
      ...base,
      withholding_breakdown: [wh('retefuente', 15), wh('reteiva', 5)] as any,
    });

    const lines = (create.mock.calls[0][0] as any).lines.filter(Boolean);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account_code: 'payment.received.cash', debit_amount: 100 }),
        expect.objectContaining({ account_code: 'withholding.suffered.retefuente_receivable', debit_amount: 15 }),
        expect.objectContaining({ account_code: 'withholding.suffered.reteiva_receivable', debit_amount: 5 }),
        expect.objectContaining({ account_code: 'payment.received.accounts_receivable', credit_amount: 120 }),
      ]),
    );
    expect(lines.some((l: any) => l.account_code === 'payment.received.revenue')).toBe(false);
    expect(totals(lines)).toEqual({ debit: 120, credit: 120 });
  });

  it('invoiced COD, W=0: DR Caja / CR CxC por C (como el cobro con factura)', async () => {
    const { service, create } = build(true);

    await service.onPaymentReceived({ ...base, withholding_breakdown: [] });

    const lines = (create.mock.calls[0][0] as any).lines.filter(Boolean);
    expect(totals(lines)).toEqual({ debit: 100, credit: 100 });
    expect(lines.some((l: any) => l.account_code === 'payment.received.revenue')).toBe(false);
  });

  it('no invoice, W=0: asiento "venta directa" idéntico al actual (caja / ingreso)', async () => {
    const { service, create } = build(false);

    await service.onPaymentReceived({ ...base, order_id: undefined, subtotal_amount: 100, withholding_breakdown: [] });

    const lines = (create.mock.calls[0][0] as any).lines.filter(Boolean);
    expect(lines).toEqual([
      expect.objectContaining({ account_code: 'payment.received.cash', debit_amount: 100 }),
      expect.objectContaining({ account_code: 'payment.received.revenue', credit_amount: 100 }),
    ]);
  });

  it('no invoice, W>0: sin crash y balanceado (DR caja C + DR retención W / CR ingreso C+W)', async () => {
    const { service, create } = build(false);

    await service.onPaymentReceived({
      ...base,
      order_id: undefined,
      subtotal_amount: 120,
      withholding_breakdown: [wh('retefuente', 20)] as any,
    });

    const lines = (create.mock.calls[0][0] as any).lines.filter(Boolean);
    expect(totals(lines)).toEqual({ debit: 120, credit: 120 });
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account_code: 'withholding.suffered.retefuente_receivable', debit_amount: 20 }),
      ]),
    );
  });

  it('pago no-ruta con factura: sigue ignorando withholding_breakdown (sin cambio)', async () => {
    const { service, create } = build(true);

    await service.onPaymentReceived({
      ...base,
      route_collection: undefined,
      withholding_breakdown: [wh('retefuente', 15)] as any,
    });

    const lines = (create.mock.calls[0][0] as any).lines.filter(Boolean);
    expect(totals(lines)).toEqual({ debit: 100, credit: 100 });
  });
});
