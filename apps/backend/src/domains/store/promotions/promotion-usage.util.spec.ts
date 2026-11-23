import {
  releaseOrderPromotionUsage,
  syncOrderPromotionUsage,
} from './promotion-usage.util';

describe('promotion-usage.util', () => {
  const buildTx = (rows: Array<{ promotion_id: number }> = []) => ({
    order_promotions: { findMany: jest.fn().mockResolvedValue(rows) },
    promotions: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  });

  it('al cancelar devuelve un uso por cada promoción con descuento de la orden', async () => {
    const tx = buildTx([{ promotion_id: 7 }, { promotion_id: 9 }]);
    const ids = await releaseOrderPromotionUsage(tx, 55);
    expect(ids).toEqual([7, 9]);
    expect(tx.order_promotions.findMany).toHaveBeenCalledWith({
      where: { order_id: 55, discount_amount: { gt: 0 } },
      select: { promotion_id: true },
    });
    expect(tx.promotions.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [7, 9] }, usage_count: { gt: 0 } },
      data: { usage_count: { decrement: 1 } },
    });
  });

  it('sin promociones no toca contadores', async () => {
    const tx = buildTx([]);
    await releaseOrderPromotionUsage(tx, 55);
    expect(tx.promotions.updateMany).not.toHaveBeenCalled();
  });

  it('al editar la orden solo ajusta las promociones que entran o salen', async () => {
    const tx = buildTx();
    await syncOrderPromotionUsage(tx, [1, 2], [2, 3]);
    expect(tx.promotions.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [3] } },
      data: { usage_count: { increment: 1 } },
    });
    expect(tx.promotions.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1] }, usage_count: { gt: 0 } },
      data: { usage_count: { decrement: 1 } },
    });
    expect(tx.promotions.updateMany).toHaveBeenCalledTimes(2);
  });
});
