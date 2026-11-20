import {
  loadLinePromotionLabels,
  resolveLinePromotionLabels,
} from './line-promotion-label.util';

/**
 * La etiqueta es display-only: nombra la promoción que produjo el
 * `discount_amount` de la línea. Estos casos fijan el orden de resolución
 * (registrada > motor > sin etiqueta) y que las líneas sin descuento no se
 * etiquetan.
 */
describe('loadLinePromotionLabels', () => {
  const prismaMock = () => ({
    order_promotions: { findMany: jest.fn().mockResolvedValue([]) },
    product_categories: { findMany: jest.fn().mockResolvedValue([]) },
  });

  it('nombra la promo de producto registrada en la orden', async () => {
    const prisma = prismaMock();
    prisma.order_promotions.findMany.mockResolvedValue([
      {
        discount_amount: '1500.00',
        promotions: {
          name: 'Martes de pollo',
          scope: 'product',
          promotion_products: [{ product_id: 10 }],
          promotion_categories: [],
        },
      },
    ]);
    const lookup = jest.fn();

    const labels = await loadLinePromotionLabels(
      prisma as any,
      900,
      [{ id: 1, product_id: 10, discount_amount: '1500.00' }],
      lookup,
    );

    expect(labels.get(1)).toBe('Martes de pollo');
    // Registrada: no hace falta preguntarle al motor.
    expect(lookup).not.toHaveBeenCalled();
  });

  it('nombra la promo de categoría cuando el producto pertenece a ella', async () => {
    const prisma = prismaMock();
    prisma.order_promotions.findMany.mockResolvedValue([
      {
        discount_amount: '900.00',
        promotions: {
          name: 'Bebidas -20%',
          scope: 'category',
          promotion_products: [],
          promotion_categories: [{ category_id: 7 }],
        },
      },
    ]);
    prisma.product_categories.findMany.mockResolvedValue([
      { product_id: 20, category_id: 7 },
    ]);

    const labels = await loadLinePromotionLabels(
      prisma as any,
      900,
      [{ id: 2, product_id: 20, discount_amount: 900 }],
      null,
    );

    expect(labels.get(2)).toBe('Bebidas -20%');
  });

  it('en cuenta abierta sin order_promotions usa el motor vigente', async () => {
    const prisma = prismaMock();
    const lookup = jest.fn().mockResolvedValue(
      new Map([[30, { name: 'Promo del día' }]]),
    );

    const labels = await loadLinePromotionLabels(
      prisma as any,
      901,
      [{ id: 3, product_id: 30, discount_amount: 500, unit_price: 5000 }],
      lookup,
    );

    expect(labels.get(3)).toBe('Promo del día');
    expect(lookup).toHaveBeenCalledWith([
      { product_id: 30, category_ids: [], unit_price: 5000 },
    ]);
  });

  it('deja sin etiqueta la línea cuyo descuento no viene de una promo', async () => {
    const prisma = prismaMock();
    const lookup = jest.fn().mockResolvedValue(new Map());

    const labels = await loadLinePromotionLabels(
      prisma as any,
      902,
      [{ id: 4, product_id: 40, discount_amount: 100, unit_price: 1000 }],
      lookup,
    );

    // Descuento manual / promo vencida: no se afirma "Promoción".
    expect(labels.has(4)).toBe(false);
    expect(labels.size).toBe(0);
  });

  it('un fallo del motor no rompe la respuesta: línea sin etiqueta', async () => {
    const prisma = prismaMock();
    const lookup = jest.fn().mockRejectedValue(new Error('boom'));

    const labels = await loadLinePromotionLabels(
      prisma as any,
      903,
      [{ id: 5, product_id: 50, discount_amount: 100, unit_price: 1000 }],
      lookup,
    );

    expect(labels.has(5)).toBe(false);
  });

  it('no etiqueta líneas sin descuento ni consulta nada', async () => {
    const prisma = prismaMock();
    const lookup = jest.fn();

    const labels = await loadLinePromotionLabels(
      prisma as any,
      904,
      [{ id: 6, product_id: 60, discount_amount: 0 }],
      lookup,
    );

    expect(labels.size).toBe(0);
    expect(prisma.order_promotions.findMany).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('una promo de orden cubre todas las líneas con descuento', async () => {
    const labels = await resolveLinePromotionLabels(
      [
        { id: 7, product_id: 70, discount_amount: 200 },
        { id: 8, product_id: 71, discount_amount: 300 },
      ],
      [
        {
          discount_amount: 500,
          name: 'Compra mayorista',
          scope: 'order',
          product_ids: [],
          category_ids: [],
        },
      ],
      null,
    );

    expect(labels.get(7)).toBe('Compra mayorista');
    expect(labels.get(8)).toBe('Compra mayorista');
  });
});
