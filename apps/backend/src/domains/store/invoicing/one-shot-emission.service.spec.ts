import { VendixHttpException, FinancialSplitErrors } from 'src/common/errors';
import { OneShotEmissionService } from './one-shot-emission.service';
import { PosFiscalEmissionService } from './pos/pos-fiscal-emission.service';
import { OrderFlowService } from '../orders/order-flow/order-flow.service';

/**
 * Facturación en un solo paso: el documento es una fila con estado propio
 * (`inv`) que los mocks de create/validate/send van moviendo, para probar el
 * reintento contra el estado real y no contra respuestas enlatadas.
 */
describe('OneShotEmissionService', () => {
  const build = (opts: { order?: any } = {}) => {
    let inv: any = null;
    const prisma: any = {
      store_settings: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ settings: {}, stores: { timezone: 'America/Bogota' } }),
      },
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
    const receivables: any = {
      createCreditSaleFromEvent: jest.fn().mockResolvedValue({ id: 1 }),
    };
    const order_flow: any = {
      promoteDraftForCreditInvoicing: jest.fn().mockResolvedValue(true),
    };
    const module_ref: any = {
      get: jest.fn((token: unknown) => {
        if (token === OrderFlowService) return order_flow;
        throw new Error('unexpected token');
      }),
    };
    const service = new OneShotEmissionService(
      prisma,
      emission,
      receivables,
      module_ref,
      invoicing,
    );
    const emitSpy = jest.spyOn(emission, 'emitForOrder');
    return {
      service,
      prisma,
      invoicing,
      invoice_flow,
      retry_queue,
      receivables,
      order_flow,
      emitSpy,
      setInv: (v: any) => (inv = v),
    };
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

  describe('facturar a crédito una orden sin cobrar (S1/S2)', () => {
    const unpaid = (over: Record<string, unknown> = {}) => ({
      id: 1,
      store_id: 1,
      state: 'draft',
      customer_id: 12,
      payment_form: null,
      grand_total: '1000.00',
      active_financial_split_id: null,
      payments: [],
      ...over,
    });
    const tomorrow = () => {
      const d = new Date(Date.now() + 2 * 86400000);
      return d.toISOString().slice(0, 10);
    };

    it('sin credit: 409 INVOICING_ORDER_UNPAID_001 con details y sin crear factura', async () => {
      const { service, invoicing, receivables, emitSpy } = build({ order: unpaid() });
      await expect(service.emitOrder(1)).rejects.toMatchObject({
        response: expect.objectContaining({
          error_code: 'INVOICING_ORDER_UNPAID_001',
          details: {
            order_id: 1,
            remaining_balance: '1000.00',
            credit_eligible: true,
            credit_blocker: null,
          },
        }),
      });
      expect(invoicing.createFromOrder).not.toHaveBeenCalled();
      expect(receivables.createCreditSaleFromEvent).not.toHaveBeenCalled();
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('pago en vuelo (pending/authorized): blocker partial_payment, no se convierte', async () => {
      const { service, receivables } = build({
        order: unpaid({ payments: [{ state: 'pending', amount: '1000.00' }] }),
      });
      await expect(service.emitOrder(1)).rejects.toMatchObject({
        response: expect.objectContaining({
          details: expect.objectContaining({
            credit_eligible: false,
            credit_blocker: 'partial_payment',
          }),
        }),
      });
      await expect(
        service.emitOrder(1, { due_date: tomorrow() } as any),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error_code: 'INVOICING_CREDIT_PARTIAL_PAYMENT_001',
        }),
      });
      expect(receivables.createCreditSaleFromEvent).not.toHaveBeenCalled();
    });

    it('tienda sin facturación electrónica: con credit NO convierte ni crea cartera', async () => {
      const { service, prisma, invoicing, receivables, order_flow } = build({
        order: unpaid(),
      });
      invoicing.getElectronicEmissionEligibility.mockResolvedValue({
        eligible: false,
        reason: 'disabled',
      });
      await service.emitOrder(1, { due_date: tomorrow() } as any);
      expect(order_flow.promoteDraftForCreditInvoicing).not.toHaveBeenCalled();
      expect(prisma.orders.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ payment_form: '2' }),
        }),
      );
      expect(receivables.createCreditSaleFromEvent).not.toHaveBeenCalled();
      expect(invoicing.createFromOrder).not.toHaveBeenCalled();
    });

    it('sin credit y sin cliente: credit_eligible=false, blocker customer_required', async () => {
      const { service } = build({ order: unpaid({ customer_id: null }) });
      await expect(service.emitOrder(1)).rejects.toMatchObject({
        response: expect.objectContaining({
          details: expect.objectContaining({
            credit_eligible: false,
            credit_blocker: 'customer_required',
          }),
        }),
      });
    });

    it('sin credit con abono parcial: blocker partial_payment', async () => {
      const { service } = build({
        order: unpaid({ payments: [{ state: 'succeeded', amount: '400.00' }] }),
      });
      await expect(service.emitOrder(1)).rejects.toMatchObject({
        response: expect.objectContaining({
          details: expect.objectContaining({
            remaining_balance: '600.00',
            credit_eligible: false,
            credit_blocker: 'partial_payment',
          }),
        }),
      });
    });

    it('orden cancelada: blocker order_state', async () => {
      const { service } = build({ order: unpaid({ state: 'cancelled' }) });
      await expect(service.emitOrder(1)).rejects.toMatchObject({
        response: expect.objectContaining({
          details: expect.objectContaining({ credit_blocker: 'order_state' }),
        }),
      });
    });

    it('con credit sin cliente: 409 INVOICING_CREDIT_CUSTOMER_REQUIRED_001 y no toca la orden', async () => {
      const { service, prisma, emitSpy } = build({ order: unpaid({ customer_id: null }) });
      await expect(
        service.emitOrder(1, { due_date: tomorrow() }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error_code: 'INVOICING_CREDIT_CUSTOMER_REQUIRED_001',
        }),
      });
      expect(prisma.orders.updateMany).not.toHaveBeenCalled();
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('con credit y abono: 409 INVOICING_CREDIT_PARTIAL_PAYMENT_001', async () => {
      const { service } = build({
        order: unpaid({ payments: [{ state: 'captured', amount: '1.00' }] }),
      });
      await expect(
        service.emitOrder(1, { due_date: tomorrow() }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error_code: 'INVOICING_CREDIT_PARTIAL_PAYMENT_001',
        }),
      });
    });

    it('due_date anterior al hoy de la tienda: 400 INVOICING_CREDIT_DUE_DATE_001 y nada se persiste', async () => {
      const { service, prisma, order_flow, emitSpy } = build({ order: unpaid() });
      await expect(
        service.emitOrder(1, { due_date: '2020-01-01' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error_code: 'INVOICING_CREDIT_DUE_DATE_001',
        }),
      });
      expect(order_flow.promoteDraftForCreditInvoicing).not.toHaveBeenCalled();
      expect(prisma.orders.updateMany).not.toHaveBeenCalled();
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('fecha imposible (2026-02-31): 400 INVOICING_CREDIT_DUE_DATE_001', async () => {
      const { service } = build({ order: unpaid() });
      await expect(
        service.emitOrder(1, { due_date: '2099-02-31' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error_code: 'INVOICING_CREDIT_DUE_DATE_001',
        }),
      });
    });

    it('con credit: promueve el borrador, marca crédito, crea la cartera y emite con due_date y medio', async () => {
      const { service, prisma, order_flow, receivables, emitSpy, invoicing } = build({
        order: unpaid(),
      });
      const due = tomorrow();
      const r = await service.emitOrder(1, {
        due_date: due,
        payment_means_code: '47',
      });
      expect(r.state).toBe('issued');
      expect(order_flow.promoteDraftForCreditInvoicing).toHaveBeenCalledWith(1, 1);
      expect(prisma.orders.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 1,
            OR: [{ payment_form: null }, { payment_form: { not: '2' } }],
          },
          data: expect.objectContaining({
            payment_form: '2',
            remaining_balance: 1000,
          }),
        }),
      );
      expect(receivables.createCreditSaleFromEvent).toHaveBeenCalledWith({
        order_id: 1,
        total_amount: 1000,
        store_id: 1,
        due_date: new Date(`${due}T00:00:00.000Z`),
      });
      expect(emitSpy).toHaveBeenCalledWith(1, {
        due_date: new Date(`${due}T00:00:00.000Z`),
        payment_means_code: '47',
      });
      expect(invoicing.createFromOrder).toHaveBeenCalledWith(1, {
        due_date: new Date(`${due}T00:00:00.000Z`),
        payment_means_code: '47',
      });
    });

    it('orden ya en created: no vuelve a promover', async () => {
      const { service, order_flow } = build({ order: unpaid({ state: 'created' }) });
      await service.emitOrder(1, { due_date: tomorrow() });
      expect(order_flow.promoteDraftForCreditInvoicing).not.toHaveBeenCalled();
    });

    it('orden que ya es crédito (payment_form 2): va directo a emitir, sin reconvertir ni duplicar cartera', async () => {
      const { service, prisma, receivables, emitSpy } = build({
        order: unpaid({ state: 'created', payment_form: '2' }),
      });
      const r = await service.emitOrder(1);
      expect(r.state).toBe('issued');
      expect(prisma.orders.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ payment_form: '2' }),
        }),
      );
      expect(receivables.createCreditSaleFromEvent).not.toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalledWith(1, undefined);
    });

    it('orden pagada: comportamiento previo, emite sin opciones ni conversión', async () => {
      const { service, prisma, emitSpy } = build({
        order: unpaid({
          state: 'finished',
          payments: [{ state: 'succeeded', amount: '1000.00' }],
        }),
      });
      await service.emitOrder(1);
      expect(emitSpy).toHaveBeenCalledWith(1);
      expect(prisma.orders.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ payment_form: '2' }),
        }),
      );
    });

    it('con factura ya numerada y saldo: reintenta la transmisión sin 409', async () => {
      const { service, setInv, emitSpy } = build({ order: unpaid({ state: 'created' }) });
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
      expect(emitSpy).toHaveBeenCalledWith(1);
    });
  });
});
