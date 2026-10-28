import { VendixHttpException, FinancialSplitErrors, ErrorCodes } from 'src/common/errors';
import { OrderLeaseService } from 'src/common/locks/order-lease.service';
import { RequestContextService } from 'src/common/context/request-context.service';
import {
  CREDIT_FINAL_CONSUMER_MESSAGE,
  OneShotEmissionService,
} from './one-shot-emission.service';
import { PosFiscalEmissionService } from './pos/pos-fiscal-emission.service';
import { PaymentsService } from '../payments/payments.service';
import { OrderFlowService } from '../orders/order-flow/order-flow.service';


const customerRow = (over: Record<string, unknown> = {}) => ({
  document_type: 'CC',
  document_number: '1020304050',
  legal_name: null,
  first_name: 'Juan',
  last_name: 'Pérez',
  verification_digit: null,
  ...over,
});
const baseOrder = (over: Record<string, unknown> = {}) => ({
  id: 1,
  store_id: 1,
  state: 'processing',
  customer_id: 5,
  payment_form: null,
  grand_total: 100,
  active_financial_split_id: null,
  payments: [{ state: 'succeeded', amount: 100 }],
  users: customerRow(),
  invoice_data_requests: [],
  ...over,
});
const incompleteOrder = (over: Record<string, unknown> = {}) =>
  baseOrder({ users: customerRow({ last_name: '' }), ...over });

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
        findFirst: jest.fn(async (args?: any) => {
          if (args?.where?.status === 'draft' && inv?.status !== 'draft') return null;
          return inv;
        }),
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
      refreshDraftAcquirer: jest.fn().mockResolvedValue(false),
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
      cancel: jest.fn(async () => {
        inv = { ...inv, status: 'cancelled' };
      }),
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
    const payments: any = {
      updateOrderPaymentStatus: jest.fn().mockResolvedValue(undefined),
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    const module_ref: any = {
      get: jest.fn((token: unknown) => {
        if (token === OrderFlowService) return order_flow;
        if (token === PaymentsService) return payments;
        throw new Error('unexpected token');
      }),
    };
    const lease_keys = new Map<string, string>();
    const lease = new OrderLeaseService({
      set: jest.fn(async (key: string, value: string) => {
        if (lease_keys.has(key)) return null;
        lease_keys.set(key, value);
        return 'OK';
      }),
      get: jest.fn(async (key: string) => lease_keys.get(key) ?? null),
      eval: jest.fn(async (_s: string, _n: number, key: string, token: string) => {
        if (lease_keys.get(key) === token) lease_keys.delete(key);
        return 1;
      }),
    } as any);
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(1);
    const service = new OneShotEmissionService(
      prisma,
      emission,
      receivables,
      module_ref,
      invoicing,
      lease,
      invoice_flow,
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
      payments,
      emitSpy,
      lease_keys,
      setInv: (v: any) => (inv = v),
    };
  };

  describe('S10 sin borradores colgados', () => {
    const hanging = () => ({
      id: 50,
      invoice_number: null,
      status: 'draft',
      transmission_status: null,
      cufe: null,
      pdf_url: null,
      contingency_deadline: null,
    });

    it('falla tras crear el borrador en ESTE intento: se descarta por InvoiceFlowService.cancel', async () => {
      const { service, invoice_flow } = build();
      invoice_flow.validate.mockRejectedValueOnce(new Error('prevalidación'));
      const r = await service.emitOrder(1);
      expect(r.state).toBe('failed');
      expect(invoice_flow.cancel).toHaveBeenCalledTimes(1);
      expect(invoice_flow.cancel).toHaveBeenCalledWith(50);
    });

    it('borrador preexistente que falla: NO se descarta', async () => {
      const { service, invoice_flow, setInv } = build();
      setInv(hanging());
      invoice_flow.validate.mockRejectedValueOnce(new Error('prevalidación'));
      const r = await service.emitOrder(1);
      expect(r.state).toBe('failed');
      expect(invoice_flow.cancel).not.toHaveBeenCalled();
    });

    it('borrador preexistente: se re-sincroniza el titular y se emite hasta accepted', async () => {
      const { service, invoicing, invoice_flow, setInv } = build();
      setInv(hanging());
      const r = await service.emitOrder(1);
      expect(invoicing.refreshDraftAcquirer).toHaveBeenCalledWith(50, 1, undefined);
      expect(invoicing.createFromOrder).not.toHaveBeenCalled();
      expect(invoice_flow.validate).toHaveBeenCalledWith(50);
      expect(r).toMatchObject({ state: 'issued', dian_status: 'accepted' });
    });

    it('éxito: no se descarta nada', async () => {
      const { service, invoice_flow } = build();
      await service.emitOrder(1);
      expect(invoice_flow.cancel).not.toHaveBeenCalled();
    });

    it('reintento tras un borrador descartado: se crea uno nuevo (no responde «anulado»)', async () => {
      const { service, invoicing, setInv } = build();
      setInv({ ...hanging(), status: 'cancelled' });
      const r = await service.emitOrder(1);
      expect(invoicing.createFromOrder).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ recreate_after_discard: true }),
      );
      expect(r.state).toBe('issued');
    });
  });

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

    describe('S8 crédito deja la orden en pending_payment', () => {
      it('orden created sin pagos: pasa a pending_payment con credit_type free e historial', async () => {
        const { service, prisma, payments, receivables } = build({
          order: unpaid({ state: 'created' }),
        });
        await service.emitOrder(1, { due_date: tomorrow() });
        expect(prisma.orders.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ id: 1, state: 'created' }),
          }),
        );
        expect(prisma.orders.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ id: 1, credit_type: null }),
            data: expect.objectContaining({ credit_type: 'free' }),
          }),
        );
        expect(payments.updateOrderPaymentStatus).toHaveBeenCalledTimes(1);
        expect(payments.updateOrderPaymentStatus).toHaveBeenCalledWith(
          expect.anything(),
          1,
          'pending_payment',
          false,
          false,
          expect.objectContaining({ fromState: 'created', storeId: 1 }),
        );
        expect(receivables.createCreditSaleFromEvent).toHaveBeenCalledTimes(1);
      });

      it('orden draft: se promueve y luego pasa a pending_payment', async () => {
        const { service, order_flow, payments } = build({
          order: unpaid({ state: 'draft' }),
        });
        await service.emitOrder(1, { due_date: tomorrow() });
        expect(order_flow.promoteDraftForCreditInvoicing).toHaveBeenCalled();
        expect(payments.updateOrderPaymentStatus).toHaveBeenCalledTimes(1);
      });

      it('orden ya a crédito (payment_form 2) todavía en created: pasa a pending_payment sin duplicar cartera', async () => {
        const { service, payments, receivables } = build({
          order: unpaid({ state: 'created', payment_form: '2' }),
        });
        await service.emitOrder(1);
        expect(payments.updateOrderPaymentStatus).toHaveBeenCalledTimes(1);
        expect(receivables.createCreditSaleFromEvent).not.toHaveBeenCalled();
      });

      it.each(['pending_payment', 'processing'])(
        'orden ya en %s: no cambia de estado ni escribe historial',
        async (state) => {
          const { service, payments } = build({ order: unpaid({ state }) });
          await service.emitOrder(1, { due_date: tomorrow() });
          expect(payments.updateOrderPaymentStatus).not.toHaveBeenCalled();
        },
      );

      it('carrera: si otro ya movió la orden (claim count 0) no duplica la transición', async () => {
        const { service, prisma, payments } = build({
          order: unpaid({ state: 'created' }),
        });
        prisma.orders.updateMany.mockImplementation(async (args: any) => ({
          count: args.where?.state === 'created' ? 0 : 1,
        }));
        await service.emitOrder(1, { due_date: tomorrow() });
        expect(payments.updateOrderPaymentStatus).not.toHaveBeenCalled();
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

  describe('lease por orden (S6b)', () => {
    it('emitOrder con la orden en proceso: ORDERS_BULK_LOCKED_001 y no emite nada', async () => {
      const { service, lease_keys, emitSpy, invoicing } = build();
      lease_keys.set('lease:order:1:1', 'otra-operacion');
      const err: any = await service.emitOrder(1).catch((e) => e);
      expect(err).toBeInstanceOf(VendixHttpException);
      expect(err.errorCode).toBe(ErrorCodes.ORDERS_BULK_LOCKED_001.code);
      expect(emitSpy).not.toHaveBeenCalled();
      expect(invoicing.createFromOrder).not.toHaveBeenCalled();
      expect(lease_keys.get('lease:order:1:1')).toBe('otra-operacion');
    });

    it('libera la lease tras emitir y también tras fallar', async () => {
      const { service, lease_keys } = build();
      await service.emitOrder(1);
      expect(lease_keys.size).toBe(0);
      const { service: s2, lease_keys: k2 } = build({
        order: { id: 9, active_financial_split_id: 5 },
      });
      await s2.emitOrder(9).catch(() => undefined);
      expect(k2.size).toBe(0);
    });

    it('force_final_consumer viaja a createFromOrder cuando hay un titular incompleto sobrescribible', async () => {
      const { service, invoicing } = build({ order: incompleteOrder() });
      await service.emitOrder(1, undefined, { force_final_consumer: true });
      expect(invoicing.createFromOrder).toHaveBeenCalledWith(1, {
        force_final_consumer: true,
      });
    });
    });

  describe('titular incompleto (S7a)', () => {
    const holderError = async (p: Promise<unknown>) => {
      const err: any = await p.catch((e) => e);
      expect(err).toBeInstanceOf(VendixHttpException);
      expect(err.errorCode).toBe(ErrorCodes.INVOICING_HOLDER_INCOMPLETE_001.code);
      expect(err.getStatus()).toBe(409);
      return err.getResponse() as any;
    };

    it('cliente incompleto sin allow: 409 con detalles y no crea nada', async () => {
      const { service, invoicing, emitSpy } = build({ order: incompleteOrder() });
      const body = await holderError(service.emitOrder(1));
      expect(body.message).toBe(
        'El cliente no tiene los datos completos para facturar a su nombre; la factura saldría a Consumidor final.',
      );
      expect(body.details).toMatchObject({
        order_id: 1,
        customer_id: 5,
        customer_name: 'Juan',
        issue_code: 'missing_name',
        missing_fields: ['last_name'],
        cf_overridable: true,
      });
      expect(body.details.message).toContain('Juan');
      expect(invoicing.createFromOrder).not.toHaveBeenCalled();
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('se evalúa ANTES del chequeo de saldo/crédito (orden sin cobrar, sin credit)', async () => {
      const { service, receivables } = build({ order: incompleteOrder({ payments: [] }) });
      await holderError(service.emitOrder(1));
      expect(receivables.createCreditSaleFromEvent).not.toHaveBeenCalled();
    });

    it('document_type_required: no sobrescribible aunque se pida allow', async () => {
      const users = customerRow({ document_type: null, document_number: '900123456', legal_name: 'ACME SAS', first_name: null, last_name: null });
      const { service, invoicing } = build({ order: baseOrder({ users }) });
      const body = await holderError(
        service.emitOrder(1, undefined, { force_final_consumer: true }),
      );
      expect(body.details).toMatchObject({ issue_code: 'document_type_required', cf_overridable: false });
      expect(invoicing.createFromOrder).not.toHaveBeenCalled();
    });

    it('cliente completo: no se bloquea y la bandera allow NO fuerza Consumidor final', async () => {
      const { service, invoicing } = build({ order: baseOrder() });
      await service.emitOrder(1, undefined, { force_final_consumer: true });
      expect(invoicing.createFromOrder).toHaveBeenCalledWith(1);
    });

    it('sin cliente: sale a Consumidor final sin bloqueo', async () => {
      const { service, invoicing } = build({
        order: baseOrder({ customer_id: null, users: null }),
      });
      const r = await service.emitOrder(1);
      expect(r.state).toBe('issued');
      expect(invoicing.createFromOrder).toHaveBeenCalledWith(1);
    });

    it('datos de invitado incompletos también bloquean', async () => {
      const { service } = build({
        order: baseOrder({
          customer_id: null,
          users: null,
          invoice_data_requests: [{ document_type: 'CC', document_number: '123', first_name: 'Ana', last_name: '' }],
        }),
      });
      const body = await holderError(service.emitOrder(1));
      expect(body.details).toMatchObject({ customer_id: null, issue_code: 'missing_name' });
    });

    it('B3: orden ya a crédito (payment_form 2) con titular incompleto: también se bloquea', async () => {
      const { service, emitSpy } = build({
        order: incompleteOrder({ payment_form: '2', payments: [] }),
      });
      const body = await holderError(service.emitOrder(1));
      expect(body.details).toMatchObject({ issue_code: 'missing_name' });
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('A5: orden a crédito + allow_final_consumer: se rechaza, nunca sale a Consumidor final', async () => {
      const { service, emitSpy, invoicing } = build({
        order: incompleteOrder({ payment_form: '2', payments: [] }),
      });
      const body = await holderError(
        service.emitOrder(1, undefined, { force_final_consumer: true }),
      );
      expect(body.message).toBe(CREDIT_FINAL_CONSUMER_MESSAGE);
      expect(body.details).toMatchObject({ cf_overridable: false, cf_blocker: 'credit_sale' });
      expect(emitSpy).not.toHaveBeenCalled();
      expect(invoicing.createFromOrder).not.toHaveBeenCalled();
    });

    it('A5: orden sin cobrar + allow_final_consumer: mismo rechazo', async () => {
      const { service, emitSpy } = build({
        order: incompleteOrder({ payments: [], state: 'created' }),
      });
      const body = await holderError(
        service.emitOrder(
          1,
          { due_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) } as any,
          { force_final_consumer: true },
        ),
      );
      expect(body.message).toBe(CREDIT_FINAL_CONSUMER_MESSAGE);
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('el 409 trae los datos que el cliente YA tiene (`current`) para precargar el formulario', async () => {
      const { service } = build({
        order: baseOrder({
          users: customerRow({ document_type: null, document_number: null, last_name: 'Pérez' }),
        }),
      });
      const body = await holderError(service.emitOrder(1));
      expect(body.details.current).toEqual({
        document_type: null,
        document_number: null,
        verification_digit: null,
        legal_name: null,
        first_name: 'Juan',
        last_name: 'Pérez',
      });
    });

    it('`current` no expone el documento centinela de Consumidor final', async () => {
      const { service } = build({
        order: baseOrder({ users: customerRow({ document_number: '222222222222' }) }),
      });
      const body = await holderError(service.emitOrder(1));
      expect(body.details.current).toMatchObject({ document_type: 'CC', document_number: null });
    });

    it('A5: orden sin cobrar (no es crédito) + allow_final_consumer: sale de contado a Consumidor final con «Acuerdo mutuo»', async () => {
      const { service, invoicing, receivables, order_flow, prisma } = build({
        order: incompleteOrder({ payments: [{ state: 'pending', amount: 100 }], state: 'finished' }),
      });
      const r = await service.emitOrder(1, undefined, { force_final_consumer: true });
      expect(r.state).toBe('issued');
      expect(invoicing.createFromOrder).toHaveBeenCalledWith(1, {
        force_final_consumer: true,
        cash_by_mutual_agreement: true,
      });
      // La orden no se convierte a crédito ni se inventa un pago.
      expect(receivables.createCreditSaleFromEvent).not.toHaveBeenCalled();
      expect(order_flow.promoteDraftForCreditInvoicing).not.toHaveBeenCalled();
      const order_writes = prisma.orders.updateMany.mock.calls.map((c: any[]) => c[0].data);
      expect(order_writes.some((d: any) => 'payment_form' in d || 'state' in d)).toBe(false);
    });

    it('A5: orden sin cobrar con cliente COMPLETO + allow_final_consumer (rechazó el crédito): contado «Acuerdo mutuo» a Consumidor final', async () => {
      const { service, invoicing, receivables } = build({
        order: baseOrder({ payments: [], state: 'finished' }),
      });
      const r = await service.emitOrder(1, undefined, { force_final_consumer: true });
      expect(r.state).toBe('issued');
      expect(invoicing.createFromOrder).toHaveBeenCalledWith(1, {
        force_final_consumer: true,
        cash_by_mutual_agreement: true,
      });
      expect(receivables.createCreditSaleFromEvent).not.toHaveBeenCalled();
    });

    it('A5: orden sin cobrar SIN cliente + allow_final_consumer: contado «Acuerdo mutuo» (antes: «asigna un cliente»)', async () => {
      const { service, invoicing } = build({
        order: baseOrder({ customer_id: null, users: null, payments: [], state: 'finished' }),
      });
      const r = await service.emitOrder(1, undefined, { force_final_consumer: true });
      expect(r.state).toBe('issued');
      expect(invoicing.createFromOrder).toHaveBeenCalledWith(1, {
        force_final_consumer: true,
        cash_by_mutual_agreement: true,
      });
    });

    it('A5: orden sin cobrar con cliente completo SIN allow: sigue ofreciendo crédito (409 ORDER_UNPAID, credit_eligible)', async () => {
      const { service, invoicing } = build({
        order: baseOrder({ payments: [], state: 'finished' }),
      });
      const err: any = await service.emitOrder(1).catch((e) => e);
      expect(err.errorCode).toBe(ErrorCodes.INVOICING_ORDER_UNPAID_001.code);
      expect(err.getResponse().details).toMatchObject({ credit_eligible: true });
      expect(invoicing.createFromOrder).not.toHaveBeenCalled();
    });

    it('A5: orden cancelada + allow_final_consumer: no sale a Consumidor final', async () => {
      const { service, invoicing } = build({
        order: baseOrder({ payments: [], state: 'cancelled' }),
      });
      await service.emitOrder(1, undefined, { force_final_consumer: true }).catch(() => undefined);
      expect(invoicing.createFromOrder).not.toHaveBeenCalled();
    });

    it('A5: orden pagada + allow_final_consumer: Consumidor final con el medio de pago real (sin «Acuerdo mutuo»)', async () => {
      const { service, invoicing } = build({ order: incompleteOrder() });
      await service.emitOrder(1, undefined, { force_final_consumer: true });
      expect(invoicing.createFromOrder).toHaveBeenCalledWith(1, { force_final_consumer: true });
    });

    it('A5: orden sin cobrar SIN allow_final_consumer: sigue ofreciendo crédito primero (409 de titular)', async () => {
      const { service, invoicing } = build({
        order: incompleteOrder({ payments: [], state: 'finished' }),
      });
      const body = await holderError(service.emitOrder(1));
      expect(body.details).toMatchObject({ cf_overridable: true });
      expect(invoicing.createFromOrder).not.toHaveBeenCalled();
    });

    it('factura ya numerada: el reintento no se bloquea (titular congelado)', async () => {
      const { service, setInv, invoicing } = build({ order: incompleteOrder() });
      setInv({ id: 50, status: 'accepted', invoice_number: 'FE-1', cufe: 'x', transmission_status: null, pdf_url: null, contingency_deadline: null, organization_id: 1, store_id: 1 });
      const r = await service.emitOrder(1);
      expect(r.state).toBe('issued');
      expect(invoicing.createFromOrder).not.toHaveBeenCalled();
    });
  });
});
