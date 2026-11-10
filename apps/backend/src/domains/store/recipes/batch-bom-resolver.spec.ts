import { resolveBatchComponent } from './batch-bom-resolver';

describe('resolveBatchComponent (QUI-1000)', () => {
  const explode = jest.fn(async (recipeId: number, units: number) => [
    { component_product_id: 901, quantity: 200 * units, depth: 1, path_recipe_ids: [recipeId] },
  ]);
  const withStock = (available: number) => ({ getAvailable: jest.fn().mockResolvedValue(available), explode });

  beforeEach(() => explode.mockClear());

  it('takes the preparation own stock and explodes nothing when it covers the units', async () => {
    const out = await resolveBatchComponent(900, 90, 2, new Map(), withStock(5));
    expect(out).toEqual([{ component_product_id: 900, quantity: 2 }]);
    expect(explode).not.toHaveBeenCalled();
  });

  it('explodes only the shortfall when the stock is partial', async () => {
    const out = await resolveBatchComponent(900, 90, 3, new Map(), withStock(1));
    expect(out).toEqual([
      { component_product_id: 900, quantity: 1 },
      { component_product_id: 901, quantity: 400 },
    ]);
    expect(explode).toHaveBeenCalledWith(90, 2);
  });

  it('explodes the full recipe when there is no stock', async () => {
    const out = await resolveBatchComponent(900, 90, 2, new Map(), withStock(0));
    expect(out).toEqual([{ component_product_id: 901, quantity: 400 }]);
  });
});
