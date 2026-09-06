import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ConstructionIndustryGuard } from '../construction-industry.guard';
import { VendixHttpException } from '../../errors';

/**
 * A.2 (ADR-02, ERR-03) — industry gate regression coverage.
 *
 * The guard MUST refuse the contracts flow for any store whose `industries`
 * do not include `construction` (403 `CONTRACT_INDUSTRY_001`), and MUST let
 * `construction` (including multi-industry `construction` + other) through.
 * Pass-through without DB work when there is no store in context; unknown
 * stores are left to the domain's own NOT_FOUND.
 */
describe('ConstructionIndustryGuard (A.2 industry gate)', () => {
  let guard: ConstructionIndustryGuard;
  let prisma: {
    stores: { findUnique: jest.Mock };
  };

  function makeContext(req: any): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
        getNext: () => undefined,
      }),
      getHandler: () => undefined as any,
      getClass: () => undefined as any,
      getArgs: () => [] as any,
      getArgByIndex: () => undefined as any,
      switchToRpc: () => undefined as any,
      switchToWs: () => undefined as any,
      getType: () => 'http',
    } as unknown as ExecutionContext;
  }

  async function expectForbidden(req: any): Promise<VendixHttpException> {
    const ctx = makeContext(req);
    try {
      await guard.canActivate(ctx);
    } catch (e) {
      const ex = e as VendixHttpException;
      expect(ex).toBeInstanceOf(VendixHttpException);
      expect(ex.errorCode).toBe('CONTRACT_INDUSTRY_001');
      expect(ex.getStatus()).toBe(403);
      return ex;
    }
    fail('expected CONTRACT_INDUSTRY_001 throw');
    throw new Error('unreachable');
  }

  beforeEach(async () => {
    prisma = {
      stores: { findUnique: jest.fn() },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ConstructionIndustryGuard,
        { provide: GlobalPrismaService, useValue: prisma },
      ],
    }).compile();

    guard = moduleRef.get(ConstructionIndustryGuard);
  });

  it('returns true without DB work when there is no store in context', async () => {
    const ctx = makeContext({ headers: {}, user: {} });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(prisma.stores.findUnique).not.toHaveBeenCalled();
  });

  it('returns true for a construction store', async () => {
    prisma.stores.findUnique.mockResolvedValue({
      industries: ['construction'],
    });
    const ctx = makeContext({ headers: {}, user: { store_id: 5 } });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(prisma.stores.findUnique).toHaveBeenCalledWith({
      where: { id: 5 },
      select: { industries: true },
    });
  });

  it('returns true for a multi-industry store that includes construction (OR semantics)', async () => {
    prisma.stores.findUnique.mockResolvedValue({
      industries: ['retail', 'construction'],
    });
    const ctx = makeContext({ headers: {}, user: { store_id: 7 } });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
  });

  it('throws CONTRACT_INDUSTRY_001 (403) for a retail store', async () => {
    prisma.stores.findUnique.mockResolvedValue({ industries: ['retail'] });

    await expectForbidden({ headers: {}, user: { store_id: 9 } });
  });

  it('throws CONTRACT_INDUSTRY_001 (403) for restaurant/service/gym/manufacturing', async () => {
    for (const industries of [
      ['restaurant'],
      ['service'],
      ['gym'],
      ['manufacturing'],
    ]) {
      prisma.stores.findUnique.mockResolvedValue({ industries });
      await expectForbidden({ headers: {}, user: { store_id: 11 } });
    }
  });

  it('throws CONTRACT_INDUSTRY_001 (403) when industries is empty', async () => {
    prisma.stores.findUnique.mockResolvedValue({ industries: [] });

    await expectForbidden({ headers: {}, user: { store_id: 13 } });
  });

  it('returns true for an unknown store (domain NOT_FOUND owns that error)', async () => {
    prisma.stores.findUnique.mockResolvedValue(null);
    const ctx = makeContext({ headers: {}, user: { store_id: 999 } });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
  });
});
