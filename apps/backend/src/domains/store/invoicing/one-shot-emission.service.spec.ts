import { VendixHttpException, FinancialSplitErrors } from 'src/common/errors';
import { OneShotEmissionService } from './one-shot-emission.service';
import { PosFiscalEmissionService } from './pos/pos-fiscal-emission.service';

/**
 * Facturación en un solo paso: el documento es una fila con estado propio
 * (`inv`) que los mocks de create/validate/send van moviendo, para probar el
 * reintento contra el estado real y no contra respuestas enlatadas.
 */
describe('OneShotEmissionService', () => {
  const build = (opts: { order?: any } = {}) => {
    let inv: any = null;
    const prisma: any = {
      orders: {
        findFirst: jest.fn().mockResolvedValue(
          opts.order ?? { id: 1, active_financial_split_id: null },
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      order_financial_accounts: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 7, split: { source_order_id: 1 } }),
      },
      invoices: {
        findFirst: jest.fn(async () => inv),
      },
      invoice_data_requests: { findFirst: jest.fn().mockResolvedValue(null) },
      fiscal_operation_events: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      order_events: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const fresh = (status: string) => ({
      id: 50,
      invoice_number: null,
      status,
      transmission_status: null,
      cufe: null,
      pdf_url: null,
      contingency_deadline: null,
      organization_id: 1,
      store_id: 1,
    });
    const invoicing: any = {
      getElectronicEmissionEligibility: jest
        .fn()
        .mockResolvedValue({ eligible: true, reason: null }),
      getPosInvoicingSettings: jest.fn().mockResolvedValue({ on_failure: 'block' }),
      createFromOrder: jest.fn(async () => {
        inv = fresh('draft');
        return inv;
      }),
      createFromFinancialAccount: jest.fn(async () => {
        inv = inv ?? fresh('draft');
        return inv;
      }),
    };
    const invoice_flow: any = {
      validate: jest.fn(async () => {
        inv = { ...inv, status: 'validated', invoice_number: 'FE-1' };
      }),
      send: jest.fn(async () => {
        inv = { ...inv, status: 'accepted', cufe: 'abc' };
      }),
      getEmitReadiness: jest.fn().mockResolvedValue({ blockers: [] }),
    };
    const retry_queue: any = {
      getRetryStatusByInvoiceIds: jest.fn().mockResolvedValue(new Map()),
      recordBlocked: jest.fn().mockResolvedValue(undefined),
    };
    const emission = new PosFiscalEmissionService(
      prisma,
      invoicing,
      invoice_flow,
      retry_queue,
      { findFiscalAccountingEntityId: jest.fn().mockResolvedValue(77) } as any,
      { record: jest.fn() } as any,
    );
    const service = new OneShotEmissionService(prisma, emission);
    return { service, invoicing, invoice_flow, retry_queue, setInv: (v: any) => (inv = v) };
  };

  it('orden: crea + valida + transmite y devuelve issued', async () => {
    const { service, invoicing, invoice_flow } = build();
    const r = await service.emitOrder(1);
    expect(r).toEqual({
      state: 'issued',
      invoice_id: 50,
      invoice_number: 'FE-1',
      dian_status: 'accepted',
      message: 'Documento aceptado por la DIAN.',
    });
    expect(invoicing.createFromOrder).toHaveBeenCalledTimes(1);
    expect(invoice_flow.validate).toHaveBeenCalledWith(50);
    expect(invoice_flow.send).toHaveBeenCalledWith(50);
  });

  it('orden con reparto activo: SPLIT_ACCOUNT_LOCKED y no emite nada', async () => {
    const { service, invoicing } = build({
      order: { id: 1, active_financial_split_id: 3 },
    });
    await expect(service.emitOrder(1)).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'SPLIT_ACCOUNT_LOCKED' }),
    });
    expect(invoicing.createFromOrder).not.toHaveBeenCalled();
  });

  it('fallo DIAN: failed con mensaje; reintentar no duplica ni crea otra factura', async () => {
    const { service, invoicing, invoice_flow } = build();
    invoice_flow.send.mockImplementationOnce(async () => {
      throw new Error('La DIAN rechazó: NIT inválido');
    });
    const first = await service.emitOrder(1);
    expect(first.state).toBe('failed');
    expect(first.message).toContain('NIT inválido');
    expect(first.invoice_id).toBe(50);

    const second = await service.emitOrder(1);
    expect(second.state).toBe('issued');
    expect(invoicing.createFromOrder).toHaveBeenCalledTimes(1);
    expect(invoice_flow.validate).toHaveBeenCalledTimes(1);
    expect(invoice_flow.send).toHaveBeenCalledTimes(2);
  });

  it('factura rejected se retransmite con la misma fila', async () => {
    const { service, invoicing, invoice_flow, setInv } = build();
    setInv({
      id: 50,
      invoice_number: 'FE-1',
      status: 'rejected',
      transmission_status: null,
      cufe: null,
      pdf_url: null,
      contingency_deadline: null,
    });
    const r = await service.emitOrder(1);
    expect(r.state).toBe('issued');
    expect(invoicing.createFromOrder).not.toHaveBeenCalled();
    expect(invoice_flow.send).toHaveBeenCalledWith(50);
  });

  it('cuenta: crea + valida + transmite; ya aceptada devuelve issued sin re-emitir', async () => {
    const { service, invoicing, invoice_flow } = build();
    const r = await service.emitFinancialAccount(7);
    expect(r.state).toBe('issued');
    expect(invoicing.createFromFinancialAccount).toHaveBeenCalledWith(7);

    const again = await service.emitFinancialAccount(7);
    expect(again.state).toBe('issued');
    expect(invoice_flow.send).toHaveBeenCalledTimes(1);
    expect(invoicing.createFromFinancialAccount).toHaveBeenCalledTimes(1);
  });

  it('cuenta sin cobrar con borrador viejo: SPLIT_ACCOUNT_UNPAID_INVOICE se propaga y no se emite', async () => {
    const { service, invoicing, invoice_flow, setInv } = build();
    setInv({
      id: 50,
      invoice_number: null,
      status: 'draft',
      transmission_status: null,
      cufe: null,
      pdf_url: null,
      contingency_deadline: null,
    });
    invoicing.createFromFinancialAccount.mockRejectedValue(
      new VendixHttpException(FinancialSplitErrors.SPLIT_ACCOUNT_UNPAID_INVOICE),
    );
    await expect(service.emitFinancialAccount(7)).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'SPLIT_ACCOUNT_UNPAID_INVOICE' }),
    });
    expect(invoice_flow.validate).not.toHaveBeenCalled();
    expect(invoice_flow.send).not.toHaveBeenCalled();
  });
});
