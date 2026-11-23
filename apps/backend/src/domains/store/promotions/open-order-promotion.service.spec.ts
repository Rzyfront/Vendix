import { OpenOrderPromotionService } from './open-order-promotion.service';

describe('OpenOrderPromotionService.registerAppliedInTx — traza de la promo al dividir', () => {
  const line = {
    id: 1,
    product_id: 501,
    product_variant_id: null,
    quantity: 2,
    total_price: 55555.56,
    final_unit_price: 30000,
    order_item_taxes: [],
  };

  function setup(discountAmount: number, snapshot: any[], quoteError?: Error) {
    const engine = {
      quoteDiscounts: jest.fn(async () => {
        if (quoteError) throw quoteError;
        return {
          total_discount: snapshot.reduce((s, p) => s + p.discount_amount, 0),
          order_promotions_snapshot: snapshot,
        };
      }),
      applyPromotion: jest.fn(async () => undefined),
    };
    const tx = {
      orders: {
        findFirst: jest.fn(async () => ({ customer_id: 8, discount_amount: discountAmount })),
      },
      order_items: { findMany: jest.fn(async () => [line]) },
      order_promotions: { findMany: jest.fn(async () => []) },
      product_categories: { findMany: jest.fn(async () => []) },
    };
    const service = new OpenOrderPromotionService(engine as any);
    return { service, engine, tx };
  }

  it('registra cada promo aplicada con su monto y el cliente, dentro de la misma transacción', async () => {
    const { service, engine, tx } = setup(16666.67, [
      { promotion_id: 9, discount_amount: 18000 },
      { promotion_id: 10, discount_amount: 0 },
    ]);
    await expect(service.registerAppliedInTx(tx, 22748)).resolves.toBe(1);
    expect(engine.applyPromotion).toHaveBeenCalledTimes(1);
    expect(engine.applyPromotion).toHaveBeenCalledWith(22748, 9, 18000, 8, tx);
    expect(engine.quoteDiscounts).toHaveBeenCalledWith(
      expect.objectContaining({ exclude_order_id: 22748, customer_id: 8 }),
    );
  });

  it('sin descuento persistido no cotiza ni registra nada', async () => {
    const { service, engine, tx } = setup(0, [{ promotion_id: 9, discount_amount: 18000 }]);
    await expect(service.registerAppliedInTx(tx, 22748)).resolves.toBe(0);
    expect(engine.quoteDiscounts).not.toHaveBeenCalled();
    expect(engine.applyPromotion).not.toHaveBeenCalled();
  });

  it('si el motor falla no rompe la división (degrada a sin registro)', async () => {
    const { service, engine, tx } = setup(16666.67, [], new Error('motor caído'));
    await expect(service.registerAppliedInTx(tx, 22748)).resolves.toBe(0);
    expect(engine.applyPromotion).not.toHaveBeenCalled();
  });
});
