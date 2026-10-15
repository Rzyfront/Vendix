import { GuestOrderAccessService } from './guest-order-access.service';
describe('GuestOrderAccessService', () => {
  const token = '550e8400-e29b-41d4-a716-446655440000';
  let prisma: any, service: GuestOrderAccessService;
  beforeEach(() => {
    prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ order_id: 4, store_id: 2, organization_id: 1 }]),
    };
    service = new GuestOrderAccessService(prisma);
  });
  it('resolves new UUID without a fiscal request and projects only binding', async () => {
    expect(await service.resolve(token)).toEqual({
      order_id: 4,
      store_id: 2,
      organization_id: 1,
    });
    expect(prisma.$queryRaw.mock.calls[0][0].values).toEqual([token, token]);
  });
  it('legacy fallback has no fiscal expiry predicate, preserving support', async () => {
    await service.resolve(token);
    expect(prisma.$queryRaw.mock.calls[0][0].strings.join('')).toContain(
      'invoice_data_requests',
    );
    expect(prisma.$queryRaw.mock.calls[0][0].strings.join('')).not.toContain(
      'expires_at',
    );
  });
  it('rejects mismatched store without exposing order', async () => {
    expect(await service.resolve(token, 99)).toBeNull();
  });
  it.each(['cfh1.jwt-v1.abc.def', 'not-uuid', '', null])(
    'rejects non-guest capability %s before query',
    async (token) => {
      expect(await service.resolve(token as any)).toBeNull();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    },
  );
  it('fails closed for missing or ambiguous legacy mappings', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    expect(await service.resolve(token)).toBeNull();
    prisma.$queryRaw.mockResolvedValue([
      { order_id: 1, store_id: 2 },
      { order_id: 3, store_id: 4 },
    ]);
    expect(await service.resolve(token)).toBeNull();
  });
});
