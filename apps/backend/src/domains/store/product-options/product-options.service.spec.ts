import { RequestContextService } from '@common/context/request-context.service';
import { ProductOptionsService } from './product-options.service';
import { ProductOptionGroupInputDto } from './dto/product-options.dto';

/**
 * Validación de componentes al guardar un grupo: la variante del componente
 * debe ser una variante de ESE producto y de la tienda (el cliente scoped
 * filtra por `products.store_id`, así que una variante ajena no aparece).
 */
describe('ProductOptionsService.create — component_variant_id', () => {
  const s3 = { signUrl: jest.fn() };
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
    return { service: new ProductOptionsService(prisma, s3 as any), prisma };
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

describe('ProductOptionsService.isEnabled', () => {
  const s3 = { signUrl: jest.fn() };
  function build(settings: unknown) {
    const prisma: any = {
      store_settings: { findFirst: jest.fn(async () => ({ settings })) },
    };
    return new ProductOptionsService(prisma, s3 as any);
  }

  it('las adiciones se venden solo con pedidos programados activos', async () => {
    expect(
      await build({ product_options: { enabled: true }, scheduled_orders: { enabled: true } }).isEnabled(1),
    ).toBe(true);
    expect(
      await build({ product_options: { enabled: true }, scheduled_orders: { enabled: false } }).isEnabled(1),
    ).toBe(false);
    expect(
      await build({ product_options: { enabled: false }, scheduled_orders: { enabled: true } }).isEnabled(1),
    ).toBe(false);
  });
});

/** QUI-994: cada adición muestra la imagen del producto al que apunta. */
describe('ProductOptionsService — imagen del componente', () => {
  const s3 = { signUrl: jest.fn(async (key?: string) => (key ? `signed:${key}` : undefined)) };
  const group = (images: Array<{ image_url: string }>) => ({
    id: 1,
    store_id: 1,
    name: 'Frutas',
    options: [
      {
        id: 9,
        name: 'Fresas',
        quantity: 80,
        component_product: { id: 101, name: 'Fresas', cost_price: 10, product_images: images },
      },
    ],
    assignments: [],
  });

  it('el detalle del grupo firma la imagen principal del componente (image_url)', async () => {
    const prisma: any = { product_option_groups: { findFirst: jest.fn(async () => group([{ image_url: 'stores/1/fresas.webp' }])) } };
    const service = new ProductOptionsService(prisma, s3 as any);
    const found: any = await service.findOne(1);
    expect(found.options[0].component_product).toEqual({ id: 101, name: 'Fresas', image_url: 'signed:stores/1/fresas.webp' });
    expect(s3.signUrl).toHaveBeenCalledWith('stores/1/fresas.webp');
  });

  it('sin imagen el componente devuelve image_url null', async () => {
    const prisma: any = { product_option_groups: { findFirst: jest.fn(async () => group([])) } };
    const service = new ProductOptionsService(prisma, s3 as any);
    const found: any = await service.findOne(1);
    expect(found.options[0].component_product.image_url).toBeNull();
  });

  it('el feed del POS (applicableForProduct) también trae la imagen firmada', async () => {
    const client: any = {
      product_categories: { findMany: jest.fn(async () => []) },
      product_option_group_assignments: { findMany: jest.fn(async () => [{ group_id: 1 }]) },
      product_option_groups: { findMany: jest.fn(async () => [group([{ image_url: 'k/f.webp' }])]) },
    };
    const prisma: any = { store_settings: { findFirst: jest.fn(async () => ({ settings: { product_options: { enabled: true }, scheduled_orders: { enabled: true } } })) } };
    const service = new ProductOptionsService(prisma, s3 as any);
    const groups: any = await service.applicableForProduct(1, 5, { withCost: false, client });
    expect(groups[0].options[0].component_product.image_url).toBe('signed:k/f.webp');
  });
});
