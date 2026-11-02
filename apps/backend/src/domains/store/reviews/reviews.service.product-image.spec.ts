import { ReviewsService } from './reviews.service';

// QUI-697: `products` no tiene columna `image_url` (las fotos viven en
// `product_images`). Pedirla hacía fallar `findMany` y el listado de
// Clientes → Reseñas quedaba vacío aunque las estadísticas mostraban datos.
describe('ReviewsService: imagen de producto en reseñas', () => {
  let findMany: jest.Mock;
  let findFirst: jest.Mock;
  let signUrl: jest.Mock;
  let service: ReviewsService;

  const row = (images: Array<{ image_url: string }>) => ({
    id: 7,
    rating: 5,
    products: { id: 3, name: 'Airpods 3', product_images: images },
  });

  beforeEach(() => {
    findMany = jest.fn();
    findFirst = jest.fn();
    // Mismo contrato que S3Service.signUrl: sin key devuelve undefined.
    signUrl = jest.fn(async (key?: string) =>
      key ? `https://signed/${key}` : undefined,
    );
    const prisma: any = {
      reviews: { findMany, findFirst, count: jest.fn().mockResolvedValue(1) },
    };
    service = new ReviewsService(prisma, { emit: jest.fn() } as any, {
      signUrl,
    } as any);
  });

  it('findAll pide la imagen principal en product_images, no products.image_url', async () => {
    findMany.mockResolvedValue([]);
    await service.findAll({} as any);
    const productsSelect = findMany.mock.calls[0][0].include.products.select;
    expect(productsSelect.image_url).toBeUndefined();
    expect(productsSelect.product_images).toEqual({
      select: { image_url: true },
      orderBy: [{ is_main: 'desc' }, { sort_order: 'asc' }],
      take: 1,
    });
  });

  it('findAll devuelve products.image_url firmada y sin product_images', async () => {
    findMany.mockResolvedValue([row([{ image_url: 'p/3.jpg' }]), row([])]);
    const result = await service.findAll({} as any);
    expect(result.data[0].products).toEqual({
      id: 3,
      name: 'Airpods 3',
      image_url: 'https://signed/p/3.jpg',
    });
    expect(result.data[1].products.image_url).toBeNull();
    expect(result.meta.total).toBe(1);
  });

  it('findOne devuelve la misma forma de producto', async () => {
    findFirst.mockResolvedValue(row([{ image_url: 'p/3.jpg' }]));
    const review = await service.findOne(7);
    expect(findFirst.mock.calls[0][0].include.products.select.image_url).toBeUndefined();
    expect(review.products.image_url).toBe('https://signed/p/3.jpg');
  });
});
