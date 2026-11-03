import {
  saleUomsOf,
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

describe('saleUomsOf (PR #1062 menor — proyección única)', () => {
  it('proyecta filas con su UoM y convierte el factor Decimal a número', () => {
    const decimal = { toString: () => '1000.000000' };
    expect(
      saleUomsOf({
        product_sale_uoms: [
          { uom_id: 2, is_principal: true, uom: { code: 'kg', name: 'Kilogramo', factor_to_base: decimal } },
          { uom_id: 1, is_principal: null, uom: null },
        ],
      }),
    ).toEqual([
      { uom_id: 2, code: 'kg', name: 'Kilogramo', factor_to_base: 1000, is_principal: true },
      { uom_id: 1, code: null, name: null, factor_to_base: null, is_principal: false },
    ]);
  });

  it('sin relación incluida devuelve []', () => {
    expect(saleUomsOf({ id: 1 })).toEqual([]);
    expect(saleUomsOf(null)).toEqual([]);
  });
});
