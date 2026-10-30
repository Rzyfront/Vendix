import { RequestContextService } from '@common/context/request-context.service';
import { ProductOptionsService } from './product-options.service';
import { ProductOptionGroupInputDto } from './dto/product-options.dto';

/**
 * Validación de componentes al guardar un grupo: la variante del componente
 * debe ser una variante de ESE producto y de la tienda (el cliente scoped
 * filtra por `products.store_id`, así que una variante ajena no aparece).
 */
describe('ProductOptionsService.create — component_variant_id', () => {
  const variantsOfStore = [{ id: 701, product_id: 101 }];

  function build() {
    const prisma: any = {
      products: {
        findMany: jest.fn(async ({ where }: any) =>
          [{ id: 101 }, { id: 102 }].filter((p) => where.id.in.includes(p.id)),
        ),
      },
      product_variants: {
        findMany: jest.fn(async ({ where }: any) =>
          variantsOfStore.filter((v) => where.id.in.includes(v.id)),
        ),
      },
      recipes: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async () => ({ id: 1 })),
      product_option_groups: { findFirst: jest.fn(async () => ({ id: 1, options: [], assignments: [] })) },
    };
    return { service: new ProductOptionsService(prisma), prisma };
  }

  function dto(component_product_id: number, component_variant_id: number | null): ProductOptionGroupInputDto {
    return {
      name: 'Frutas',
      min_select: 0,
      max_select: 1,
      is_required: false,
      scope: 'per_unit',
      options: [
        {
          name: 'Fresas',
          price_delta: 5000,
          component_type: 'ingredient',
          component_product_id,
          component_variant_id,
          quantity: 80,
        },
      ],
    } as ProductOptionGroupInputDto;
  }

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 1 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('acepta la variante que pertenece al producto componente', async () => {
    const { service, prisma } = build();
    await service.create(dto(101, 701));
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('rechaza una variante de otro producto de la tienda', async () => {
    const { service, prisma } = build();
    await expect(service.create(dto(102, 701))).rejects.toMatchObject({
      errorCode: 'OPT_COMPONENT_REQUIRED',
      message: 'La variante elegida no pertenece al componente de la adición.',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rechaza una variante inexistente o de otra tienda', async () => {
    const { service, prisma } = build();
    await expect(service.create(dto(101, 999))).rejects.toMatchObject({
      errorCode: 'OPT_COMPONENT_REQUIRED',
      message: 'La variante elegida no pertenece al componente de la adición.',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('sin variante sigue igual que hoy', async () => {
    const { service, prisma } = build();
    await service.create(dto(101, null));
    expect(prisma.product_variants.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
