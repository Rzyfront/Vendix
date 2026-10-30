import { ExecutionContext, Logger } from '@nestjs/common';
import { ServiceIndustryGuard } from './service-industry.guard';

describe('ServiceIndustryGuard', () => {
  const stores = { findUnique: jest.fn() };
  const contextFor = (user: unknown) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;
  const guard = new ServiceIndustryGuard({ stores } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it.each([[['service']], [['retail', 'service']]])('allows stores that include service %j', async (industries) => {
    stores.findUnique.mockResolvedValue({ industries });
    await expect(guard.canActivate(contextFor({ store_id: 3 }))).resolves.toBe(true);
  });

  it.each([[[]], [['retail']], [['restaurant', 'gym']]])(
    'rejects stores without service %j with 403 STATION_INDUSTRY_001',
    async (industries) => {
      stores.findUnique.mockResolvedValue({ industries });
      const error = await guard.canActivate(contextFor({ store_id: 3 })).catch((value) => value);
      expect(error.getStatus()).toBe(403);
      expect(error.errorCode).toBe('STATION_INDUSTRY_001');
    },
  );

  it('passes through without store context (other guards own that error)', async () => {
    await expect(guard.canActivate(contextFor(undefined))).resolves.toBe(true);
    expect(stores.findUnique).not.toHaveBeenCalled();
  });
});
