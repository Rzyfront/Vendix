import {
  syncProductSaleUoms,
  SaleUomsWriter,
} from './sale-uoms-sync.util';

describe('syncProductSaleUoms (QUI-978)', () => {
  function makeClient(): SaleUomsWriter & {
    product_sale_uoms: {
      deleteMany: jest.Mock;
      createMany: jest.Mock;
    };
  } {
    return {
      product_sale_uoms: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
    };
  }

  it('reemplaza el conjunto completo (borra todo y recrea)', async () => {
    const client = makeClient();

    await syncProductSaleUoms(client, 7, [
      { uom_id: 3, is_principal: true },
      { uom_id: 4 },
    ]);

    expect(client.product_sale_uoms.deleteMany).toHaveBeenCalledWith({
      where: { product_id: 7 },
    });
    expect(client.product_sale_uoms.createMany).toHaveBeenCalledWith({
      data: [
        { product_id: 7, uom_id: 3, is_principal: true },
        { product_id: 7, uom_id: 4, is_principal: false },
      ],
      skipDuplicates: true,
    });
  });

  it('una lista vacía limpia todo y no crea nada', async () => {
    const client = makeClient();

    await syncProductSaleUoms(client, 7, []);

    expect(client.product_sale_uoms.deleteMany).toHaveBeenCalledWith({
      where: { product_id: 7 },
    });
    expect(client.product_sale_uoms.createMany).not.toHaveBeenCalled();
  });

  it('pliega duplicados y conserva la marca de principal', async () => {
    const client = makeClient();

    await syncProductSaleUoms(client, 7, [
      { uom_id: 3 },
      { uom_id: 3, is_principal: true },
    ]);

    expect(client.product_sale_uoms.createMany).toHaveBeenCalledWith({
      data: [{ product_id: 7, uom_id: 3, is_principal: true }],
      skipDuplicates: true,
    });
  });
});
