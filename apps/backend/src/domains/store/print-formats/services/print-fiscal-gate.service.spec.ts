import { PrintFiscalGateService } from './print-fiscal-gate.service';

/**
 * Rule (Rafael): an order prints as electronic invoice only with a sales
 * invoice ACCEPTED by the DIAN; anything else prints the POS ticket.
 */
describe('PrintFiscalGateService.resolvePosPrintTarget — order → document', () => {
  const STORE = 3;
  const ORG = 1;
  const ORDER = 4312;

  function build(opts: { invoice?: { id: number; invoice_number: string } | null; canEmit?: boolean }) {
    const findFirst = jest.fn().mockResolvedValue({
      id: ORDER,
      invoices: opts.invoice ? [opts.invoice] : [],
    });
    const storePrisma = { orders: { findFirst } } as any;
    const findMany = jest.fn().mockResolvedValue(opts.canEmit ? [{ id: 9, accounting_entity_id: 1, store_id: STORE }] : []);
    const orgPrisma = { withoutScope: () => ({ dian_configurations: { findMany } }) } as any;
    const readiness = { resolveOwnSoftwareConfig: jest.fn().mockResolvedValue({}) } as any;
    const service = new PrintFiscalGateService(storePrisma, orgPrisma, readiness);
    return { service, findFirst };
  }

  it('prints the accepted sales invoice as electronic invoice', async () => {
    const { service } = build({ invoice: { id: 77, invoice_number: 'FE-10' } });
    const target = await service.resolvePosPrintTarget({ storeId: STORE, organizationId: ORG, orderId: ORDER });
    expect(target).toEqual({
      formatType: 'pos_electronic_invoice',
      documentId: 77,
      reason: 'electronic_invoice_already_issued',
      requiresInvoiceEmission: false,
    });
  });

  it('looks only at accepted sales invoices or POS equivalent documents of the order itself', async () => {
    const { service, findFirst } = build({ invoice: { id: 77, invoice_number: 'FE-10' } });
    await service.resolvePosPrintTarget({ storeId: STORE, organizationId: ORG, orderId: ORDER });
    const where = findFirst.mock.calls[0][0].select.invoices.where;
    expect(where).toEqual({
      invoice_type: { in: ['sales_invoice', 'pos_equivalent_document'] },
      dian_status: 'accepted',
      financial_account_id: null,
    });
  });

  it('prints the POS ticket when no accepted invoice remains (pending, rejected, credit note only)', async () => {
    const { service } = build({ invoice: null, canEmit: false });
    const target = await service.resolvePosPrintTarget({ storeId: STORE, organizationId: ORG, orderId: ORDER });
    expect(target).toEqual({
      formatType: 'pos_sale_ticket',
      documentId: ORDER,
      reason: 'no_fiscal_activation',
      requiresInvoiceEmission: false,
    });
  });

  it('keeps the explicit invoice id path unchanged', async () => {
    const { service, findFirst } = build({});
    const target = await service.resolvePosPrintTarget({ storeId: STORE, organizationId: ORG, invoiceId: 55 });
    expect(target.formatType).toBe('pos_electronic_invoice');
    expect(target.documentId).toBe(55);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
