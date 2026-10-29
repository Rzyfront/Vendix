import { syncEnabledTierAssignments } from './tier-assignments-sync.util';

/**
 * Guardar un producto reenvía siempre `enabled_price_tier_ids`. Antes se
 * borraban TODAS las filas de `product_price_tier_assignments` y se recreaban
 * vacías: la presentación por defecto (`is_default`) y los códigos de barras
 * de presentación (`barcode`) desaparecían con solo renombrar el producto.
 */
describe('syncEnabledTierAssignments', () => {
  function makeClient() {
    return {
      product_price_tier_assignments: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
  }

  it('solo borra las tarifas que dejaron de estar habilitadas', async () => {
    const client = makeClient();

    await syncEnabledTierAssignments(client, 7, 3, [10, 11]);

    expect(client.product_price_tier_assignments.deleteMany).toHaveBeenCalledWith(
      { where: { product_id: 7, price_tier_id: { notIn: [10, 11] } } },
    );
  });

  it('crea las nuevas con store_id sin tocar las existentes', async () => {
    const client = makeClient();

    await syncEnabledTierAssignments(client, 7, 3, [10, 11, 10]);

    expect(client.product_price_tier_assignments.createMany).toHaveBeenCalledWith(
      {
        data: [
          { product_id: 7, price_tier_id: 10, store_id: 3 },
          { product_id: 7, price_tier_id: 11, store_id: 3 },
        ],
        skipDuplicates: true,
      },
    );
  });

  it('una lista vacía deshabilita todas y no crea nada', async () => {
    const client = makeClient();

    await syncEnabledTierAssignments(client, 7, 3, []);

    expect(client.product_price_tier_assignments.deleteMany).toHaveBeenCalledWith(
      { where: { product_id: 7 } },
    );
    expect(client.product_price_tier_assignments.createMany).not.toHaveBeenCalled();
  });
});
