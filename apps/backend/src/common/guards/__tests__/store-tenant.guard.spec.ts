import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { StoreTenantGuard } from '../store-tenant.guard';
import { VendixHttpException } from '../../errors';

/**
 * CP-DTLP-20260827 — IDOR fix (H-1) regression coverage.
 *
 * The guard MUST refuse any `x-store-id` whose owning `organization_id`
 * differs from the JWT's `organization_id`, and MUST let everything else
 * through. These five cases are the minimal matrix that proves the gate.
 *
 * Note: this was originally an Interceptor (`StoreTenantInterceptor`). On
 * 2026-08-28 it was discovered that wrapping `next.handle()` in
 * `switchMap` over a Prisma promise breaks the AsyncLocalStorage scope set
 * up by `RequestContextInterceptor` — `ROLE_SCOPE_003` was thrown for
 * every request hitting the print-formats controller. The fix is to make
 * this a Guard with async `canActivate` so the Prisma lookup happens in
 * the guard's own Promise context, never inside the interceptor chain.
 */
describe('StoreTenantGuard (CP-DTLP H-1 IDOR gate)', () => {
  const JWT_ORG_ID = 42;
  const OTHER_ORG_ID = 99;

  let guard: StoreTenantGuard;
  let prisma: {
    stores: { findUnique: jest.Mock };
  };

  /**
   * Build a minimal Nest ExecutionContext stub. We only need
   * `switchToHttp().getRequest()` to return our fake request, which is what
   * the guard actually reads.
   */
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

  beforeEach(async () => {
    prisma = {
      stores: { findUnique: jest.fn() },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        StoreTenantGuard,
        { provide: GlobalPrismaService, useValue: prisma },
      ],
    }).compile();

    guard = moduleRef.get(StoreTenantGuard);
  });

  it('returns true when x-store-id is missing (DTO/ValidationPipe owns shape errors)', async () => {
    const ctx = makeContext({
      headers: {},
      user: { id: 7, organization_id: JWT_ORG_ID },
    });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(prisma.stores.findUnique).not.toHaveBeenCalled();
  });

  it('returns true when x-store-id matches the JWT organization', async () => {
    prisma.stores.findUnique.mockResolvedValue({
      organization_id: JWT_ORG_ID,
    });
    const ctx = makeContext({
      headers: { 'x-store-id': '5' },
      user: { id: 7, organization_id: JWT_ORG_ID },
    });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(prisma.stores.findUnique).toHaveBeenCalledWith({
      where: { id: 5 },
      select: { organization_id: true },
    });
  });

  it('throws PRINT_RENDER_TENANT_MISMATCH_001 when x-store-id belongs to a different org', async () => {
    prisma.stores.findUnique.mockResolvedValue({
      organization_id: OTHER_ORG_ID,
    });
    const ctx = makeContext({
      headers: { 'x-store-id': '5' },
      user: { id: 7, organization_id: JWT_ORG_ID },
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      VendixHttpException,
    );
    try {
      await guard.canActivate(ctx);
      fail('expected throw');
    } catch (e) {
      const ex = e as VendixHttpException;
      expect(ex.errorCode).toBe('PRINT_RENDER_TENANT_MISMATCH_001');
      expect(ex.getStatus()).toBe(403);
    }
  });

  it('throws STORE_FIND_001 when the store does not exist', async () => {
    prisma.stores.findUnique.mockResolvedValue(null);
    const ctx = makeContext({
      headers: { 'x-store-id': '5' },
      user: { id: 7, organization_id: JWT_ORG_ID },
    });

    try {
      await guard.canActivate(ctx);
      fail('expected throw');
    } catch (e) {
      const ex = e as VendixHttpException;
      expect(ex.errorCode).toBe('STORE_FIND_001');
      expect(ex.getStatus()).toBe(404);
    }
  });

  it('does NOT query the DB when x-store-id is a non-numeric string (shape error is DTO/ValidationPipe concern)', async () => {
    const ctx = makeContext({
      headers: { 'x-store-id': 'not-a-number' },
      user: { id: 7, organization_id: JWT_ORG_ID },
    });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(prisma.stores.findUnique).not.toHaveBeenCalled();
  });
});
