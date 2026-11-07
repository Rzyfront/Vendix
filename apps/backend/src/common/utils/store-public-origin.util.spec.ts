import { publicPaymentUrl, resolveStorePublicOrigin } from './store-public-origin.util';

describe('resolveStorePublicOrigin', () => {
  const reader = (rows: Array<{ hostname: string; app_type: string }>) => ({
    domain_settings: { findMany: jest.fn(async () => rows) },
  });

  it('prefers the active e-commerce domain over the other public apps', async () => {
    const prisma = reader([
      { hostname: 'reservas.tienda.co', app_type: 'STORE_BOOKING' },
      { hostname: 'tienda.co', app_type: 'STORE_ECOMMERCE' },
    ]);
    await expect(resolveStorePublicOrigin(prisma as never, 7)).resolves.toBe('https://tienda.co');
    expect(prisma.domain_settings.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ store_id: 7, status: 'active' }) }),
    );
  });

  it('falls back to another public app that serves the payment page', async () => {
    const prisma = reader([{ hostname: 'reservas.tienda.co', app_type: 'STORE_BOOKING' }]);
    await expect(resolveStorePublicOrigin(prisma as never, 7)).resolves.toBe('https://reservas.tienda.co');
  });

  it('returns null without a public domain (never the admin host)', async () => {
    await expect(resolveStorePublicOrigin(reader([]) as never, 7)).resolves.toBeNull();
  });

  it('returns null when the lookup fails', async () => {
    const prisma = { domain_settings: { findMany: jest.fn(async () => { throw new Error('db'); }) } };
    await expect(resolveStorePublicOrigin(prisma as never, 7)).resolves.toBeNull();
  });
});

describe('publicPaymentUrl', () => {
  it('joins the origin and the payment path, or null without origin', () => {
    expect(publicPaymentUrl('https://tienda.co', '/pagar/tok-1')).toBe('https://tienda.co/pagar/tok-1');
    expect(publicPaymentUrl(null, '/pagar/tok-1')).toBeNull();
  });
});
