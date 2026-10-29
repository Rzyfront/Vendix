import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import { LodgingCheckOutService } from './check-out.service';

/**
 * H3.7 — check-out of H-0001 (reservation 7, folio 40 on order 500, holder
 * customer 9, room 101 = unit 11): total $595.000.
 */
function build(
  options: {
    status?: string;
    folioStatus?: string;
    total?: number;
    paid?: number;
    deposit?: number;
    verified?: boolean;
    verificationSetting?: boolean;
    invoice?: { invoice_id: number | null; state: string };
    closeCount?: number;
    split?: boolean;
    online?: number;
    eInvoicing?: boolean;
    verifiedTotal?: number;
    repeatOrder?: { payment_form: string; remaining_balance: number };
    frozenNights?: string[];
  } = {},
) {
  const total = options.total ?? 595000;
  const state = {
    paid: options.paid ?? 0,
    deposit: options.deposit ?? 0,
    online: options.online ?? 0,
    verified: options.verified ?? true,
    reservation: options.status ?? 'checked_in',
  };
  const folioRow = { id: 40, status: options.folioStatus ?? 'open', reservation_id: 7, order_id: 500 };
  const folioView = () => ({
    id: 40,
    total,
    paid: state.paid,
    balance: Math.max(0, total - state.paid),
    deposit_available: state.deposit,
    online_payment_available: state.online,
    verified_at: state.verified ? new Date() : null,
    verified_current: state.verified,
  });

  const folios = {
    findFolio: jest.fn(async () => folioRow),
    getFolio: jest.fn(async () => folioView()),
    postNightsThrough: jest.fn(async () => 0),
    assertVatExemptionHolds: jest.fn(async () => undefined),
    applyOnlinePayments: jest.fn(async () => {
      state.paid += state.online;
      state.online = 0;
      return folioView();
    }),
    applyDeposit: jest.fn(async () => {
      state.paid += state.deposit;
      state.deposit = 0;
      return folioView();
    }),
    registerPayment: jest.fn(async (_id: number, dto: { amount: number }) => {
      state.paid += dto.amount;
      return folioView();
    }),
  };

  const tx = {
    $queryRaw: jest.fn(async () => [{ id: 500 }]),
    orders: {
      findUnique: jest.fn(async () => ({
        id: 500,
        order_number: 'F-H-0001',
        customer_id: 9,
        grand_total: total,
        payments: state.paid > 0 ? [{ amount: state.paid, state: 'succeeded' }] : [],
      })),
      update: jest.fn(async () => ({})),
    },
    lodging_folios: {
      updateMany: jest.fn(async () => ({ count: options.closeCount ?? 1 })),
      findUnique: jest.fn(async () => ({ verified_total: options.verifiedTotal ?? total })),
    },
    lodging_room_nights: { updateMany: jest.fn(async () => ({ count: 2 })) },
    lodging_reservations: {
      updateMany: jest.fn(async () => {
        state.reservation = 'checked_out';
        return { count: 1 };
      }),
    },
    lodging_reservation_events: { create: jest.fn(async () => ({})) },
    lodging_reservation_rooms: { findMany: jest.fn(async () => [{ unit_id: 11 }]) },
    lodging_units: { updateMany: jest.fn(async () => ({ count: 1 })) },
    lodging_room_charges: { aggregate: jest.fn(async () => ({ _sum: { cost_amount: 12000 } })) },
  };

  const prisma = {
    lodging_reservations: {
      findFirst: jest.fn(async () => ({ id: 7, status: state.reservation, customer_id: 9 })),
    },
    users: { findFirst: jest.fn(async ({ where }: any) => (where.id === 77 ? { id: 77 } : null)) },
    orders: {
      findFirst: jest.fn(async () => ({
        id: 500,
        order_number: 'F-H-0001',
        customer_id: 9,
        grand_total: total,
        subtotal_amount: 500000,
        tax_amount: 95000,
        tip_amount: 0,
        active_financial_split_id: options.split ? 90 : null,
        payment_form: options.repeatOrder?.payment_form ?? '1',
        remaining_balance: options.repeatOrder?.remaining_balance ?? 0,
      })),
    },
    order_items: {
      findMany: jest.fn(async () => [
        {
          total_price: 500000,
          quantity: 1,
          tax_amount_item: 95000,
          weight: null,
          price_unit_quantity: null,
          item_type: 'service',
          order_item_taxes: [{ tax_type: 'IVA', tax_amount: 95000, tax_rate: 0.19 }],
        },
      ]),
    },
    // H3.8 — split folio: lodging to the company, consumptions to the guest.
    order_financial_accounts: {
      findMany: jest.fn(async () => [
        { id: 301, label: 'Empresa ABC', grand_total: 476000 },
        { id: 302, label: 'Juan', grand_total: 119000 },
      ]),
    },
    lodging_folios: { updateMany: jest.fn(async () => ({ count: 1 })) },
    stores: { findFirst: jest.fn(async () => ({ timezone: 'America/Bogota' })) },
    store_settings: { findFirst: jest.fn(async () => null) },
    // Nights still unposted after posting through today: only the frozen ones
    // of a closed business day (H7.1) remain.
    lodging_room_nights: {
      findMany: jest.fn(async () =>
        (options.frozenNights ?? []).map((d) => ({ night_date: new Date(`${d}T00:00:00.000Z`) })),
      ),
    },
    // Without e-invoicing no document is ever created for the order.
    invoices: { findFirst: jest.fn(async () => (options.eInvoicing === false ? null : { id: 120 })) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };

  const issued = { order_id: 500, state: 'issued', invoice_id: 120, invoice_number: 'FE-120', message: 'ok' };
  const fiscal = {
    getStatusForOrder: jest.fn(async () =>
      options.invoice
        ? { ...issued, ...options.invoice }
        : { order_id: 500, state: 'pending', invoice_id: null, invoice_number: null, message: '' },
    ),
    emitForOrder: jest.fn(async () => issued),
    emitForFinancialAccount: jest.fn(async (account_id: number) => ({
      ...issued,
      invoice_id: account_id + 1000,
      invoice_number: `FE-${account_id}`,
    })),
  };
  const receivables = { createCreditSaleFromEvent: jest.fn(async () => ({ id: 1 })) };
  const settings = {
    getSettings: jest.fn(async () => ({
      hospitality: { folio_invoice_verification: options.verificationSetting ?? true },
    })),
  };
  const events = { emit: jest.fn() };
  const reservations = { findOne: jest.fn(async () => ({ id: 7, status: state.reservation })) };
  const history = { record: jest.fn(async () => ({ id: 1 })) };
  const pdf = { getPdf: jest.fn(async () => 'https://signed/fe-120.pdf') };
  const invoicing = {
    getElectronicEmissionEligibility: jest.fn(async () => ({
      eligible: options.eInvoicing ?? true,
      reason: options.eInvoicing === false ? 'sin habilitación' : null,
    })),
  };
  const cashSessions = { assertSessionForSales: jest.fn(async () => undefined) };

  const service = new LodgingCheckOutService(
    prisma as any,
    folios as any,
    reservations as any,
    history as any,
    settings as any,
    receivables as any,
    fiscal as any,
    pdf as any,
    events as any,
    invoicing as any,
    cashSessions as any,
  );
  return { service, prisma, tx, folios, fiscal, receivables, events, state, pdf, cashSessions };
}

const VERIFIER = { permissions: [{ name: 'store:lodging:folio:verify', status: 'active' }] };
const DESK = { permissions: [{ name: 'store:lodging:folio:close', status: 'active' }] };
const REQUEST = 'req-12345678';

describe('LodgingCheckOutService (H3.7)', () => {
  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 3, user_id: 5, organization_id: 1 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('cobra el saldo con tarjeta, cierra todo y emite UNA factura', async () => {
    const { service, tx, folios, fiscal, events } = build();

    const result = await service.checkOut(7, { store_payment_method_id: 2, request_id: REQUEST }, DESK);

    expect(folios.postNightsThrough).toHaveBeenCalled();
    expect(folios.registerPayment).toHaveBeenCalledWith(7, {
      amount: 595000,
      store_payment_method_id: 2,
      request_id: REQUEST,
    });
    expect(tx.lodging_folios.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 40, status: 'open' },
        data: expect.objectContaining({ status: 'closed', closed_by_user_id: 5 }),
      }),
    );
    expect(tx.orders.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'finished', payment_form: '1', remaining_balance: 0, customer_id: 9 }),
      }),
    );
    expect(tx.lodging_reservations.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7, status: 'checked_in' }, data: expect.objectContaining({ status: 'checked_out' }) }),
    );
    expect(tx.lodging_units.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [11] }, housekeeping_status: { in: ['clean', 'inspected'] } },
        data: expect.objectContaining({ housekeeping_status: 'dirty' }),
      }),
    );
    expect(fiscal.emitForOrder).toHaveBeenCalledTimes(1);
    expect(fiscal.emitForOrder).toHaveBeenCalledWith(500);
    // COGS of the POS/table consumptions charged to the room (H3.6).
    expect(events.emit).toHaveBeenCalledWith(
      'order.completed',
      expect.objectContaining({ order_id: 500, total_cost: 12000 }),
    );
    expect(result.invoice).toMatchObject({ state: 'issued', invoice_number: 'FE-120' });
    expect(result.reservation).toMatchObject({ status: 'checked_out' });
  });

  it('con noches sin cobrar en un día cerrado no hace check-out ni mueve dinero', async () => {
    const { service, tx, folios, fiscal, prisma } = build({ frozenNights: ['2026-10-25'] });

    await expect(
      service.checkOut(7, { store_payment_method_id: 2, request_id: REQUEST }, DESK),
    ).rejects.toMatchObject({
      errorCode: 'LODGING_CHECKOUT_FROZEN_NIGHTS_001',
      message: expect.stringContaining('25-oct'),
    });
    expect(prisma.lodging_room_nights.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          store_id: 3,
          is_active: true,
          posted_order_item_id: null,
          reservation_room: { reservation_id: 7, cancelled_at: null },
        }),
      }),
    );
    expect(folios.registerPayment).not.toHaveBeenCalled();
    expect(folios.applyDeposit).not.toHaveBeenCalled();
    expect(tx.lodging_folios.updateMany).not.toHaveBeenCalled();
    expect(fiscal.emitForOrder).not.toHaveBeenCalled();
  });

  it('con saldo y sin medio ni crédito no hace check-out', async () => {
    const { service, tx, fiscal } = build();

    await expect(service.checkOut(7, { request_id: REQUEST }, DESK)).rejects.toMatchObject({
      errorCode: ErrorCodes.LODGING_CHECKOUT_BALANCE_001.code,
    });
    expect(tx.lodging_folios.updateMany).not.toHaveBeenCalled();
    expect(fiscal.emitForOrder).not.toHaveBeenCalled();
  });

  it('H3.9 — con noches exentas y un titular que ya no califica no cobra ni factura', async () => {
    const { service, tx, folios, fiscal } = build();
    folios.assertVatExemptionHolds.mockRejectedValueOnce(
      new VendixHttpException(ErrorCodes.LODGING_VAT_EXEMPT_001, 'La exención de IVA ya no aplica'),
    );

    await expect(
      service.checkOut(7, { store_payment_method_id: 2, request_id: REQUEST }, DESK),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.LODGING_VAT_EXEMPT_001.code });
    expect(folios.registerPayment).not.toHaveBeenCalled();
    expect(tx.lodging_folios.updateMany).not.toHaveBeenCalled();
    expect(fiscal.emitForOrder).not.toHaveBeenCalled();
  });

  it('aplica primero el anticipo retenido y cobra solo el resto', async () => {
    const { service, folios } = build({ deposit: 200000 });

    await service.checkOut(7, { store_payment_method_id: 2, request_id: REQUEST }, DESK);

    expect(folios.applyDeposit).toHaveBeenCalledWith(7);
    expect(folios.registerPayment).toHaveBeenCalledWith(7, expect.objectContaining({ amount: 395000 }));
  });

  it('H6.6 — aplica el pago en línea de la reserva, luego el anticipo, y cobra solo el resto', async () => {
    const { service, folios } = build({ online: 150000, deposit: 100000 });

    await service.checkOut(7, { store_payment_method_id: 2, request_id: REQUEST }, DESK);

    expect(folios.applyOnlinePayments).toHaveBeenCalledWith(7);
    expect(folios.applyOnlinePayments.mock.invocationCallOrder[0]).toBeLessThan(
      folios.applyDeposit.mock.invocationCallOrder[0],
    );
    expect(folios.registerPayment).toHaveBeenCalledWith(7, expect.objectContaining({ amount: 345000 }));
  });

  it('"Cargar a crédito de la empresa": factura a la empresa, forma 2 y CxC por el saldo', async () => {
    const { service, tx, folios, receivables, fiscal } = build({ paid: 100000 });

    await service.checkOut(7, { charge_to_credit: true, bill_to_customer_id: 77, request_id: REQUEST }, DESK);

    expect(folios.registerPayment).not.toHaveBeenCalled();
    expect(tx.orders.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payment_form: '2', remaining_balance: 495000, customer_id: 77 }),
      }),
    );
    expect(receivables.createCreditSaleFromEvent).toHaveBeenCalledWith({
      order_id: 500,
      total_amount: 495000,
      store_id: 3,
    });
    expect(fiscal.emitForOrder).toHaveBeenCalledTimes(1);
  });

  it('el crédito exige una empresa distinta del huésped y de la tienda', async () => {
    const { service } = build();

    await expect(
      service.checkOut(7, { charge_to_credit: true, request_id: REQUEST }, DESK),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.LODGING_CHECKOUT_BILL_TO_001.code });
    await expect(
      service.checkOut(7, { charge_to_credit: true, bill_to_customer_id: 999, request_id: REQUEST }, DESK),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.LODGING_CHECKOUT_BILL_TO_001.code });
  });

  it('un check-out repetido no emite una segunda factura', async () => {
    const { service, fiscal, tx, folios } = build({
      status: 'checked_out',
      folioStatus: 'closed',
      invoice: { invoice_id: 120, state: 'issued' },
    });

    const result = await service.checkOut(7, { store_payment_method_id: 2, request_id: REQUEST }, DESK);

    expect(fiscal.emitForOrder).not.toHaveBeenCalled();
    expect(folios.registerPayment).not.toHaveBeenCalled();
    expect(tx.lodging_folios.updateMany).not.toHaveBeenCalled();
    expect(result.invoice).toMatchObject({ invoice_id: 120 });
  });

  it('un check-out repetido reintenta la MISMA factura si falló', async () => {
    const { service, fiscal } = build({
      status: 'checked_out',
      folioStatus: 'closed',
      invoice: { invoice_id: 120, state: 'failed' },
    });

    await service.checkOut(7, { request_id: REQUEST }, DESK);

    expect(fiscal.emitForOrder).toHaveBeenCalledTimes(1);
  });

  it('el doble clic que pierde el cierre no emite', async () => {
    const { service, fiscal, receivables } = build({ closeCount: 0 });

    await service.checkOut(7, { store_payment_method_id: 2, request_id: REQUEST }, DESK);

    expect(fiscal.emitForOrder).not.toHaveBeenCalled();
    expect(receivables.createCreditSaleFromEvent).not.toHaveBeenCalled();
  });

  describe('verificación previa (D11)', () => {
    it('sin verificar y sin permiso no cobra ni factura', async () => {
      const { service, folios, fiscal } = build({ verified: false });

      await expect(
        service.checkOut(7, { store_payment_method_id: 2, verify: true, request_id: REQUEST }, DESK),
      ).rejects.toMatchObject({ errorCode: ErrorCodes.LODGING_CHECKOUT_VERIFY_001.code });
      expect(folios.registerPayment).not.toHaveBeenCalled();
      expect(fiscal.emitForOrder).not.toHaveBeenCalled();
    });

    it('quien tiene el permiso verifica en el mismo check-out', async () => {
      const { service, prisma, fiscal } = build({ verified: false });

      await service.checkOut(7, { store_payment_method_id: 2, verify: true, request_id: REQUEST }, VERIFIER);

      expect(prisma.lodging_folios.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 40, status: 'open' },
          data: expect.objectContaining({ verified_by_user_id: 5, verified_total: 595000 }),
        }),
      );
      expect(fiscal.emitForOrder).toHaveBeenCalledTimes(1);
    });

    it('con el ajuste apagado no se exige', async () => {
      const { service, fiscal } = build({ verified: false, verificationSetting: false });

      await service.checkOut(7, { store_payment_method_id: 2, request_id: REQUEST }, DESK);

      expect(fiscal.emitForOrder).toHaveBeenCalledTimes(1);
    });

    it('"Verificar folio" registra quién y a qué total', async () => {
      const { service, prisma, folios } = build({ verified: false });

      await service.verify(7);

      expect(folios.postNightsThrough).toHaveBeenCalled();
      expect(prisma.lodging_folios.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ verified_total: 595000 }) }),
      );
    });
  });

  it('solo hace check-out de una reserva en casa', async () => {
    const { service } = build({ status: 'confirmed' });

    await expect(service.checkOut(7, { request_id: REQUEST }, DESK)).rejects.toMatchObject({
      errorCode: ErrorCodes.LODGING_CHECKOUT_001.code,
    });
  });

  it('entrega el PDF de la factura del folio', async () => {
    const { service, pdf } = build();

    await expect(service.invoicePdf(7)).resolves.toEqual({ url: 'https://signed/fe-120.pdf' });
    expect(pdf.getPdf).toHaveBeenCalledWith(120);
  });

  describe('H3.8 — folio dividido', () => {
    it('con las dos cuentas cobradas cierra y emite UNA factura por cuenta, no la del folio', async () => {
      const { service, folios, fiscal, tx } = build({ split: true, paid: 595000 });

      const result = await service.checkOut(7, { request_id: REQUEST }, DESK);

      expect(folios.applyDeposit).not.toHaveBeenCalled();
      expect(folios.registerPayment).not.toHaveBeenCalled();
      expect(tx.lodging_folios.updateMany).toHaveBeenCalled();
      expect(fiscal.emitForOrder).not.toHaveBeenCalled();
      expect(fiscal.emitForFinancialAccount).toHaveBeenCalledTimes(2);
      expect(fiscal.emitForFinancialAccount).toHaveBeenNthCalledWith(1, 301);
      expect(fiscal.emitForFinancialAccount).toHaveBeenNthCalledWith(2, 302);
      expect(result.invoice).toBeNull();
      expect((result as any).invoices).toEqual([
        expect.objectContaining({ account_id: 301, label: 'Empresa ABC', grand_total: 476000, invoice_number: 'FE-301', status: 'issued' }),
        expect.objectContaining({ account_id: 302, label: 'Juan', grand_total: 119000, invoice_number: 'FE-302', status: 'issued' }),
      ]);
      expect(result.reservation).toMatchObject({ status: 'checked_out' });
    });

    it('con una cuenta sin cobrar no hace check-out ni aplica el anticipo', async () => {
      const { service, folios, tx, fiscal } = build({ split: true, paid: 476000, deposit: 50000 });

      await expect(service.checkOut(7, { request_id: REQUEST }, DESK)).rejects.toMatchObject({
        errorCode: ErrorCodes.LODGING_CHECKOUT_BALANCE_001.code,
      });
      expect(folios.applyDeposit).not.toHaveBeenCalled();
      expect(folios.registerPayment).not.toHaveBeenCalled();
      expect(tx.lodging_folios.updateMany).not.toHaveBeenCalled();
      expect(fiscal.emitForFinancialAccount).not.toHaveBeenCalled();
    });

    it('no admite crédito ni "facturar a": cada cuenta se factura a su titular', async () => {
      const { service, tx } = build({ split: true, paid: 595000 });

      await expect(
        service.checkOut(7, { bill_to_customer_id: 77, charge_to_credit: true, request_id: REQUEST }, DESK),
      ).rejects.toMatchObject({ errorCode: ErrorCodes.LODGING_CHECKOUT_BILL_TO_001.code });
      await expect(
        service.checkOut(7, { bill_to_customer_id: 77, request_id: REQUEST }, DESK),
      ).rejects.toMatchObject({ errorCode: ErrorCodes.LODGING_CHECKOUT_BILL_TO_001.code });
      expect(tx.lodging_folios.updateMany).not.toHaveBeenCalled();
    });

    it('un check-out repetido reintenta la misma factura de cada cuenta (idempotente)', async () => {
      const { service, tx, fiscal } = build({
        split: true,
        paid: 595000,
        status: 'checked_out',
        folioStatus: 'closed',
      });

      const result = await service.checkOut(7, { request_id: REQUEST }, DESK);

      expect(tx.lodging_folios.updateMany).not.toHaveBeenCalled();
      expect(fiscal.emitForFinancialAccount).toHaveBeenCalledTimes(2);
      expect((result as any).invoices).toHaveLength(2);
    });

    it('el PDF se pide por cuenta', async () => {
      const { service, prisma } = build({ split: true });

      await service.invoicePdf(7, 302);

      expect(prisma.invoices.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ order_id: 500, financial_account_id: 302 }) }),
      );
    });
  });

  describe('decisión 3 — reconocimiento del ingreso según la facturación de la tienda', () => {
    it('sin facturación electrónica: el check-out reconoce la venta (ingreso + impuestos y cruce 2805) sin bloquear', async () => {
      const { service, events } = build({ eInvoicing: false });

      const result = await service.checkOut(7, { store_payment_method_id: 2, request_id: REQUEST }, DESK);

      expect(events.emit).toHaveBeenCalledWith(
        'lodging.folio.sale_recognized',
        expect.objectContaining({
          order_id: 500,
          store_id: 3,
          order_number: 'F-H-0001',
          total_amount: 595000,
          tax_amount: 95000,
          customer: expect.objectContaining({ id: 9 }),
        }),
      );
      expect(result.reservation).toMatchObject({ status: 'checked_out' });
    });

    it('con facturación electrónica: no reconoce en el check-out; lo hace la factura aceptada', async () => {
      const { service, events, fiscal } = build({ eInvoicing: true });

      await service.checkOut(7, { store_payment_method_id: 2, request_id: REQUEST }, DESK);

      expect(fiscal.emitForOrder).toHaveBeenCalledTimes(1);
      expect(events.emit).not.toHaveBeenCalledWith('lodging.folio.sale_recognized', expect.anything());
    });

    it('sin FE pero con un documento ya iniciado para la orden: no reconoce dos veces', async () => {
      const { service, events, prisma } = build({ eInvoicing: false });
      prisma.invoices.findFirst.mockResolvedValue({ id: 120 });

      await service.checkOut(7, { store_payment_method_id: 2, request_id: REQUEST }, DESK);

      expect(events.emit).not.toHaveBeenCalledWith('lodging.folio.sale_recognized', expect.anything());
    });

    it('si el reconocimiento falla, el check-out igual termina', async () => {
      const { service, prisma } = build({ eInvoicing: false });
      prisma.order_items.findMany.mockRejectedValueOnce(new Error('db down'));

      const result = await service.checkOut(7, { store_payment_method_id: 2, request_id: REQUEST }, DESK);

      expect(result.reservation).toMatchObject({ status: 'checked_out' });
    });

    it('un check-out repetido sin FE reintenta el reconocimiento (idempotente por orden)', async () => {
      const { service, events } = build({ eInvoicing: false, status: 'checked_out', folioStatus: 'closed' });

      await service.checkOut(7, { request_id: REQUEST }, DESK);

      expect(events.emit).toHaveBeenCalledWith('lodging.folio.sale_recognized', expect.objectContaining({ order_id: 500 }));
    });
  });

  it('salida anticipada: desactiva las noches no posteadas desde hoy', async () => {
    const { service, tx } = build();

    await service.checkOut(7, { store_payment_method_id: 2, request_id: REQUEST }, DESK);

    expect(tx.lodging_room_nights.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          reservation_room: { reservation_id: 7 },
          posted_order_item_id: null,
          is_active: true,
          night_date: { gte: expect.any(Date) },
        }),
        data: expect.objectContaining({ is_active: false }),
      }),
    );
  });

  it('D11 bajo el lock: un cargo que entró después de verificar bloquea el cierre', async () => {
    const { service, tx, fiscal } = build({ verifiedTotal: 500000 });

    await expect(
      service.checkOut(7, { store_payment_method_id: 2, request_id: REQUEST }, DESK),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.LODGING_CHECKOUT_VERIFY_001.code });
    expect(tx.lodging_folios.updateMany).not.toHaveBeenCalled();
    expect(fiscal.emitForOrder).not.toHaveBeenCalled();
  });

  it('el check-out a crédito exige caja abierta como toda venta POS', async () => {
    const { service, cashSessions, tx } = build({ paid: 100000 });
    cashSessions.assertSessionForSales.mockRejectedValueOnce(
      new VendixHttpException(ErrorCodes.LODGING_CHECKOUT_001, 'Abre la caja'),
    );

    await expect(
      service.checkOut(7, { charge_to_credit: true, bill_to_customer_id: 77, request_id: REQUEST }, DESK),
    ).rejects.toBeInstanceOf(VendixHttpException);
    expect(cashSessions.assertSessionForSales).toHaveBeenCalledWith(5);
    expect(tx.lodging_folios.updateMany).not.toHaveBeenCalled();
  });

  it('un check-out repetido a crédito reintenta la cuenta por cobrar', async () => {
    const { service, receivables } = build({
      status: 'checked_out',
      folioStatus: 'closed',
      invoice: { invoice_id: 120, state: 'issued' },
      repeatOrder: { payment_form: '2', remaining_balance: 495000 },
    });

    await service.checkOut(7, { request_id: REQUEST }, DESK);

    expect(receivables.createCreditSaleFromEvent).toHaveBeenCalledWith({
      order_id: 500,
      total_amount: 495000,
      store_id: 3,
    });
  });
});
