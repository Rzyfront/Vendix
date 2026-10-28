import { ExecutionContext } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { LodgingIndustryGuard } from '../lodging-industry.guard';
import { VendixHttpException } from '../../errors';

describe('LodgingIndustryGuard', () => {
  const findUnique = jest.fn();
  const guard = new LodgingIndustryGuard({
    stores: { findUnique },
  } as unknown as GlobalPrismaService);

  const run = (user: unknown) =>
    guard.canActivate({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext);

  beforeEach(() => findUnique.mockReset());

  it('lets a hospitality store through, also with other industries', async () => {
    findUnique.mockResolvedValue({ industries: ['restaurant', 'hospitality'] });
    await expect(run({ store_id: 1 })).resolves.toBe(true);
  });

  it('refuses a store without hospitality with 403 LODGING_INDUSTRY_001', async () => {
    findUnique.mockResolvedValue({ industries: ['retail'] });
    const error = await run({ store_id: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect((error as VendixHttpException).getStatus()).toBe(403);
    expect((error as VendixHttpException).errorCode).toBe('LODGING_INDUSTRY_001');
  });

  it('passes through without a store in context or with an unknown store', async () => {
    await expect(run({})).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
    findUnique.mockResolvedValue(null);
    await expect(run({ store_id: 9 })).resolves.toBe(true);
  });
});
