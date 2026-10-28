import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes } from 'src/common/errors';
import { LodgingFolioSplitService } from './folio-split.service';

/**
 * H3.8 — folio of H-0001 (reservation 7, folio 40 on order 500, holder 9):
 * three nights (lines 1-3, $476.000) and a restaurant charge (line 4,
 * $119.000) = $595.000. The company (customer 77) pays the nights and Juan
 * (the holder) the restaurant.
 */
function build(
  options: {
    status?: string;
    folioStatus?: string;
    paid?: number;
    unposted?: number;
    activeSplit?: boolean;
  } = {},
) {
  const folioRow = { id: 40, status: options.folioStatus ?? 'open', reservation_id: 7, order_id: 500 };
  const lines = [
    { id: 1, kind: 'night', total: 158666.67, cancelled_at: null },
    { id: 2, kind: 'night', total: 158666.67, cancelled_at: null },
    { id: 3, kind: 'night', total: 158666.66, cancelled_at: null },
    { id: 4, kind: 'charge', origin: 'Restaurante', total: 119000, cancelled_at: null },
    { id: 5, kind: 'charge', total: 20000, cancelled_at: new Date() },
  ];
  const folios = {
    findFolio: jest.fn(async () => folioRow),
    postNightsThrough: jest.fn(async () => 0),
    getFolio: jest.fn(async () => ({ id: 40, total: 595000, paid: options.paid ?? 0, lines })),
  };
  const prisma = {
    lodging_reservations: {
      findFirst: jest.fn(async () => ({ status: options.status ?? 'checked_in' })),
    },
    orders: {
      findFirst: jest.fn(async () => ({ active_financial_split_id: options.activeSplit ? 90 : null })),
    },
    lodging_room_nights: { count: jest.fn(async () => options.unposted ?? 0) },
    users: {
      count: jest.fn(async ({ where }: any) =>
        where.id.in.filter((id: number) => [9, 77].includes(id)).length,
      ),
    },
    stores: { findFirst: jest.fn(async () => ({ timezone: 'America/Bogota' })) },
    store_settings: { findFirst: jest.fn(async () => null) },
  };
  const account = (id: number, label: string, total: string, paid = '0.00') => ({
    id,
    label,
    grand_total: total,
    total_paid: paid,
    remaining_balance: (Number(total) - Number(paid)).toFixed(2),
  });
  const result = {
    split_group_id: 90,
    source_version: 'v1',
    original_total: '595000.00',
    accounts: [account(301, 'Empresa ABC', '476000.00'), account(302, 'Juan', '119000.00')],
    undo: { allowed: true, blockers: [] },
  };
  const splits = {
    getSplit: jest.fn(async () => result),
    preview: jest.fn(async () => ({ ...result, split_group_id: null })),
    splitByItems: jest.fn(async () => result),
    cancel: jest.fn(async () => ({ cancelled: true })),
  };
  const splitPayments = { pay: jest.fn(async () => ({})) };
  const service = new LodgingFolioSplitService(
    prisma as any,
    folios as any,
    splits as any,
    splitPayments as any,
  );
  return { service, prisma, folios, splits, splitPayments };
}

const BY_ITEMS = {
  accounts: [
    { label: 'Empresa ABC', customer_id: 77, order_item_ids: [1, 2, 3] },
    { label: 'Juan', customer_id: 9, order_item_ids: [4] },
  ],
};

describe('LodgingFolioSplitService (H3.8)', () => {
  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 3, user_id: 5, organization_id: 1 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('divide por ítems: noches a la empresa y restaurante a Juan; las cuentas suman el folio', async () => {
    const { service, folios, splits } = build();

    const preview = await service.preview(7, BY_ITEMS);
    const split = await service.confirm(7, { ...BY_ITEMS, source_version: 'v1', request_id: 'req-12345678' });

    // The nights already slept are charged before splitting.
    expect(folios.postNightsThrough).toHaveBeenCalledWith(expect.objectContaining({ id: 40 }), expect.any(String), false);
    const request = {
      item_groups: [{ order_item_ids: [1, 2, 3] }, { order_item_ids: [4] }],
      accounts: [
        { label: 'Empresa ABC', customer_id: 77 },
        { label: 'Juan', customer_id: 9 },
      ],
    };
    expect(splits.preview).toHaveBeenCalledWith(500, { mode: 'items', ...request });
    expect(splits.splitByItems).toHaveBeenCalledWith(500, {
      ...request,
      source_version: 'v1',
      idempotency_key: 'folio-split-40-req-12345678',
    });
    const sum = split.accounts.reduce((total, a) => total + Number(a.grand_total), 0);
    expect(sum).toBe(Number(split.original_total));
    expect(preview.accounts).toHaveLength(2);
  });

  it('rechaza un cargo sin cuenta, repetido o ajeno/anulado', async () => {
    const { service, splits } = build();
    const reject = (accounts: typeof BY_ITEMS.accounts) =>
      expect(service.preview(7, { accounts })).rejects.toMatchObject({
        errorCode: ErrorCodes.LODGING_FOLIO_SPLIT_001.code,
      });

    await reject([
      { label: 'A', customer_id: 77, order_item_ids: [1, 2] },
      { label: 'B', customer_id: 9, order_item_ids: [4] },
    ]);
    await reject([
      { label: 'A', customer_id: 77, order_item_ids: [1, 2, 3] },
      { label: 'B', customer_id: 9, order_item_ids: [3, 4] },
    ]);
    await reject([
      { label: 'A', customer_id: 77, order_item_ids: [1, 2, 3] },
      { label: 'B', customer_id: 9, order_item_ids: [4, 5] },
    ]);
    expect(splits.preview).not.toHaveBeenCalled();
  });

  it('no divide un folio con pagos o anticipo aplicado (la división va antes de cobrar)', async () => {
    const { service, splits } = build({ paid: 100000 });

    await expect(service.preview(7, BY_ITEMS)).rejects.toMatchObject({
      errorCode: ErrorCodes.LODGING_FOLIO_SPLIT_001.code,
    });
    expect(splits.preview).not.toHaveBeenCalled();
  });

  it('no divide con noches por causar, sin huésped en casa, ya dividido o cerrado', async () => {
    await expect(build({ unposted: 1 }).service.preview(7, BY_ITEMS)).rejects.toMatchObject({
      errorCode: ErrorCodes.LODGING_FOLIO_SPLIT_001.code,
    });
    await expect(build({ status: 'confirmed' }).service.preview(7, BY_ITEMS)).rejects.toMatchObject({
      errorCode: ErrorCodes.LODGING_FOLIO_SPLIT_001.code,
    });
    await expect(build({ activeSplit: true }).service.preview(7, BY_ITEMS)).rejects.toMatchObject({
      errorCode: ErrorCodes.LODGING_FOLIO_SPLIT_001.code,
    });
    await expect(build({ folioStatus: 'closed' }).service.preview(7, BY_ITEMS)).rejects.toMatchObject({
      errorCode: ErrorCodes.LODGING_FOLIO_CLOSED_001.code,
    });
  });

  it('solo factura a clientes de esta tienda', async () => {
    const { service, splits } = build();

    await expect(
      service.preview(7, {
        accounts: [
          { label: 'Otra', customer_id: 555, order_item_ids: [1, 2, 3] },
          { label: 'Juan', customer_id: 9, order_item_ids: [4] },
        ],
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.LODGING_CHECKOUT_BILL_TO_001.code });
    expect(splits.preview).not.toHaveBeenCalled();
  });

  it('"Quitar división" antes de cobrar restaura el folio único', async () => {
    const { service, splits, folios } = build({ activeSplit: true });

    const folio = await service.cancel(7, { source_version: 'v1' });

    expect(splits.cancel).toHaveBeenCalledWith(500, { source_version: 'v1' });
    expect(folio).toMatchObject({ id: 40, total: 595000 });
  });

  it('cobra cada cuenta con su medio y una clave idempotente por intento', async () => {
    const { service, splitPayments } = build({ activeSplit: true });

    await service.pay(7, 301, { store_payment_method_id: 2, amount: 476000, request_id: 'pay-12345678' });

    expect(splitPayments.pay).toHaveBeenCalledWith(500, 301, {
      store_payment_method_id: 2,
      amount: 476000,
      amount_received: undefined,
      idempotency_key: 'folio-split-pay-40-pay-12345678',
    });
  });

  it('no cobra ni quita la división de un folio cerrado', async () => {
    const { service, splitPayments, splits } = build({ folioStatus: 'closed' });

    await expect(
      service.pay(7, 301, { store_payment_method_id: 2, amount: 1, request_id: 'pay-12345678' }),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.LODGING_FOLIO_CLOSED_001.code });
    await expect(service.cancel(7, { source_version: 'v1' })).rejects.toMatchObject({
      errorCode: ErrorCodes.LODGING_FOLIO_CLOSED_001.code,
    });
    expect(splitPayments.pay).not.toHaveBeenCalled();
    expect(splits.cancel).not.toHaveBeenCalled();
  });
});
