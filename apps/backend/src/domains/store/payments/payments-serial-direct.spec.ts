import { PaymentsService } from './payments.service';
import { OrderStockCommitService } from '../inventory/shared/services/order-stock-commit.service';

describe('PaymentsService E.1 immediate serial preflight', () => {
  const line = {
    id: 501, product_id: 77, product_variant_id: null,
    quantity: 2, stock_units_consumed: 2, product_name: 'Teléfono',
  };
  const order = { id: 88, store_id: 10, order_items: [line] };
  const selection = (serial_ids: number[] = [], serial_numbers: string[] = []) => [{
    product_id: 77, product_variant_id: null, serial_ids, serial_numbers,
  }];
  const serial = (overrides: Record<string, unknown> = {}) => ({
    id: 1, serial_number: 'IMEI-1', product_id: 77, product_variant_id: null,
    status: 'in_stock', inventory_locations: { store_id: 10 }, ...overrides,
  });
  const setup = (rows = [serial()]) => {
    const service = Object.create(PaymentsService.prototype) as PaymentsService;
    const tx = {
      products: { findMany: jest.fn().mockResolvedValue([{
        id: 77, store_id: 10, track_inventory: true, product_type: 'physical',
      }]) },
      inventory_serial_numbers: { findMany: jest.fn().mockResolvedValue(rows) },
      sales_document_serials: { count: jest.fn().mockResolvedValue(0) },
    };
    const validate = (items: ReturnType<typeof selection>) =>
      (service as any).assertImmediatePosSerials(tx, order, items);
    return { tx, validate };
  };

  it('requires one distinct serial per stock unit before payment', async () => {
    const { validate, tx } = setup();
    await expect(validate(selection([1]))).rejects.toMatchObject({
      errorCode: 'SERIAL_REQUIRED_001',
    });
    await expect(validate(selection([1, 1]))).rejects.toThrow();
    expect(tx.sales_document_serials.count).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'reserved', overrides: { status: 'reserved' } },
    { name: 'other store', overrides: { inventory_locations: { store_id: 11 } } },
    { name: 'other product', overrides: { product_id: 78 } },
  ])('rejects $name serial even with a matching count', async ({ overrides }) => {
    const { validate } = setup([serial(overrides)]);
    await expect(validate(selection([1], ['IMEI-2']))).rejects.toThrow();
  });

  it('rejects reused document links and duplicate free text', async () => {
    const { validate, tx } = setup();
    tx.sales_document_serials.count.mockResolvedValue(1);
    await expect(validate(selection([1], ['IMEI-2']))).rejects.toThrow();
    await expect(validate(selection([], ['IMEI-2', 'IMEI-2']))).rejects.toThrow();
  });

  it('rejects the same serial selected by id and text across two order lines', async () => {
    const { tx } = setup();
    const service = Object.create(PaymentsService.prototype) as PaymentsService;
    const splitOrder = {
      ...order,
      order_items: [
        { ...line, id: 501, quantity: 1, stock_units_consumed: 1 },
        { ...line, id: 502, quantity: 1, stock_units_consumed: 1 },
      ],
    };
    await expect((service as any).assertImmediatePosSerials(tx, splitOrder, [
      selection([1])[0], selection([], ['IMEI-1'])[0],
    ])).rejects.toThrow();
  });

  it('accepts owned pool plus free-text serials for transactional stock commit', async () => {
    const { validate } = setup();
    await expect(validate(selection([1], ['IMEI-2']))).resolves.toBeUndefined();
  });

  it('fails closed for serialized products whose stock seam would skip them', async () => {
    const { tx, validate } = setup();
    tx.products.findMany.mockResolvedValue([{
      id: 77, store_id: 10, track_inventory: false, product_type: 'physical',
    }]);
    await expect(validate(selection([1], ['IMEI-2']))).rejects.toThrow();
  });

  it('reuses stock commit to mark chosen serials sold and link/snapshot the order item', async () => {
    const stockCommit = Object.create(OrderStockCommitService.prototype) as OrderStockCommitService;
    const serialEnforcement = {
      isSerialized: jest.fn().mockResolvedValue(true),
      resolveOrCreateFromFreeText: jest.fn().mockResolvedValue([2]),
      requireConfirmedSerials: jest.fn().mockResolvedValue(undefined),
    };
    const serialNumbers = {
      transition: jest.fn().mockImplementation(async (id: number) => ({
        serial_number: `IMEI-${id}`,
      })),
      linkToDocument: jest.fn().mockResolvedValue(undefined),
    };
    Object.assign(stockCommit, { serialEnforcement, serialNumbers });
    const tx = { order_items: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };

    await (stockCommit as any).consumeSerialsForLine(
      77, undefined, 2, 501, [{ location_id: 4, quantity: 2 }],
      { serial_ids: [1], serial_numbers: ['IMEI-2'] }, tx,
    );

    expect(serialEnforcement.requireConfirmedSerials).toHaveBeenCalledWith(77, 2, [1, 2], tx);
    expect(serialNumbers.transition).toHaveBeenCalledTimes(2);
    expect(serialNumbers.linkToDocument).toHaveBeenCalledWith(1, 'order_item', 501, tx);
    expect(serialNumbers.linkToDocument).toHaveBeenCalledWith(2, 'order_item', 501, tx);
    expect(tx.order_items.updateMany).toHaveBeenCalledWith({
      where: { id: 501 }, data: { serial_numbers_snapshot: 'IMEI-1, IMEI-2' },
    });
  });
});
