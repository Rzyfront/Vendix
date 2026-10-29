import { RequestContextService } from '@common/context/request-context.service';
import { FormulasService } from './formulas.service';

describe('FormulasService.calculateCost', () => {
  let prisma: any;
  let recipes: any;
  let service: FormulasService;

  const recipe = (over: Record<string, unknown> = {}) => ({
    id: 3,
    yield_quantity: 2,
    waste_percent: 0,
    items: [
      {
        component_product_id: 10,
        quantity: 4,
        waste_percent: 10,
        waste_mode: 'percent',
        waste_absolute: null,
        component_product: { id: 10, name: 'Madera', cost_price: 100 },
      },
      {
        component_product_id: 11,
        quantity: 8,
        waste_percent: 0,
        waste_mode: 'percent',
        waste_absolute: null,
        component_product: { id: 11, name: 'Tornillos', cost_price: 5 },
      },
    ],
    ...over,
  });

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1, organization_id: 1 } as any);
    prisma = {
      recipes: { findFirst: jest.fn(), update: jest.fn() },
      stock_levels: { findMany: jest.fn().mockResolvedValue([]) },
    };
    recipes = { findOne: jest.fn() };
    service = new FormulasService(prisma, recipes);
  });

  afterEach(() => jest.restoreAllMocks());

  it('usa cost_per_unit de stock_levels (ponderado) y cae al costo del producto', async () => {
    prisma.recipes.findFirst.mockResolvedValue(recipe());
    prisma.stock_levels.findMany.mockResolvedValue([
      { product_id: 10, quantity_on_hand: 10, cost_per_unit: 200 },
      { product_id: 10, quantity_on_hand: 30, cost_per_unit: 280 },
    ]);
    const cost = await service.calculateCost(3);

    const madera = cost.lines.find((l) => l.component_product_id === 10)!;
    expect(madera.cost_source).toBe('stock_level');
    expect(madera.unit_cost).toBe(260); // (10*200 + 30*280) / 40
    expect(madera.effective_quantity).toBe(4.4); // 4 * 1.10
    expect(madera.line_cost).toBe(1144);

    const tornillos = cost.lines.find((l) => l.component_product_id === 11)!;
    expect(tornillos.cost_source).toBe('product');
    expect(tornillos.line_cost).toBe(40);

    expect(cost.total_cost).toBe(1184);
    expect(cost.yield_quantity).toBe(2);
    expect(cost.unit_cost).toBe(592);
  });

  it('aplica la merma de la receta y la merma absoluta por línea', async () => {
    prisma.recipes.findFirst.mockResolvedValue(
      recipe({
        waste_percent: 10,
        yield_quantity: 1,
        items: [
          {
            component_product_id: 11,
            quantity: 10,
            waste_percent: 0,
            waste_mode: 'absolute',
            waste_absolute: 2,
            component_product: { id: 11, name: 'Tornillos', cost_price: 5 },
          },
        ],
      }),
    );
    const cost = await service.calculateCost(3);
    expect(cost.lines[0].effective_quantity).toBe(13.2); // (10+2) * 1.10
    expect(cost.total_cost).toBe(66);
    expect(cost.unit_cost).toBe(66);
  });

  it('falla si la fórmula no existe', async () => {
    prisma.recipes.findFirst.mockResolvedValue(null);
    await expect(service.calculateCost(99)).rejects.toMatchObject({
      errorCode: 'RECIPE_NOT_FOUND',
    });
  });

  it('archive hace borrado lógico: is_active=false y status archived', async () => {
    recipes.findOne.mockResolvedValue({ id: 3 });
    await service.archive(3);
    expect(prisma.recipes.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: expect.objectContaining({ is_active: false, status: 'archived' }),
    });
  });
});
