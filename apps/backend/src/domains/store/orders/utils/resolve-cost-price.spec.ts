import { Prisma } from '@prisma/client';
import { pickCostPrice, resolveCostPrice } from './resolve-cost-price';

describe('pickCostPrice', () => {
  it('prefiere el costo de la variante sobre el del producto', () => {
    expect(pickCostPrice(1500, 900)).toBe(1500);
  });

  it('cae al costo del producto cuando la variante no tiene costo', () => {
    expect(pickCostPrice(null, 900)).toBe(900);
  });

  it('devuelve null cuando ni variante ni producto tienen costo', () => {
    expect(pickCostPrice(null, null)).toBeNull();
  });

  // Las dos ramas que un `!variantCost` rompería en silencio: cero es un costo
  // real (producto promocional, insumo donado), no un valor ausente.
  it('respeta un costo de variante de 0 en vez de caer al producto', () => {
    expect(pickCostPrice(0, 900)).toBe(0);
  });

  it('respeta un costo de producto de 0 en vez de devolver null', () => {
    expect(pickCostPrice(null, 0)).toBe(0);
  });

  it('normaliza Decimal de Prisma a number', () => {
    expect(pickCostPrice(new Prisma.Decimal('1234.56'), null)).toBe(1234.56);
    expect(pickCostPrice(undefined, new Prisma.Decimal('0.00'))).toBe(0);
  });
});

describe('resolveCostPrice', () => {
  const buildPrisma = (variantCost: unknown, productCost: unknown) => ({
    product_variants: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          variantCost === undefined ? null : { cost_price: variantCost },
        ),
    },
    products: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          productCost === undefined ? null : { cost_price: productCost },
        ),
    },
  });

  it('no consulta el producto cuando la variante ya resolvió el costo', async () => {
    const prisma = buildPrisma(1500, 900);

    await expect(resolveCostPrice(prisma, 10, 55)).resolves.toBe(1500);
    expect(prisma.products.findUnique).not.toHaveBeenCalled();
  });

  it('no consulta la variante cuando no se pasa product_variant_id', async () => {
    const prisma = buildPrisma(1500, 900);

    await expect(resolveCostPrice(prisma, 10, null)).resolves.toBe(900);
    expect(prisma.product_variants.findUnique).not.toHaveBeenCalled();
  });

  it('cae al producto cuando la variante existe pero su costo es null', async () => {
    const prisma = buildPrisma(null, 900);

    await expect(resolveCostPrice(prisma, 10, 55)).resolves.toBe(900);
    expect(prisma.products.findUnique).toHaveBeenCalledTimes(1);
  });

  it('devuelve 0 —no null— cuando la variante cuesta 0', async () => {
    const prisma = buildPrisma(0, 900);

    await expect(resolveCostPrice(prisma, 10, 55)).resolves.toBe(0);
    expect(prisma.products.findUnique).not.toHaveBeenCalled();
  });

  it('devuelve null cuando ninguna fila existe', async () => {
    const prisma = buildPrisma(undefined, undefined);

    await expect(resolveCostPrice(prisma, 10, 55)).resolves.toBeNull();
  });
});
