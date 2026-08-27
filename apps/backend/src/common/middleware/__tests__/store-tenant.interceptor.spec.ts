import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { StoreTenantInterceptor } from '../store-tenant.interceptor';
import { VendixHttpException } from '../../errors';

/**
 * CP-DTLP-20260827 — IDOR fix (H-1) regression coverage.
 *
 * The interceptor MUST refuse any `x-store-id` whose owning `organization_id`
 * differs from the JWT's `organization_id`, and MUST let everything else
 * through. These four cases are the minimal matrix that proves the gate.
 */
describe('StoreTenantInterceptor (CP-DTLP H-1 IDOR gate)', () => {
  const JWT_ORG_ID = 42;
  const OTHER_ORG_ID = 99;

  let interceptor: StoreTenantInterceptor;
  let prisma: {
    stores: { findUnique: jest.Mock };
  };

  /**
   * Build a minimal Nest ExecutionContext stub. We only need
   * `switchToHttp().getRequest()` to return our fake request, which is what
   * the interceptor actually reads.
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

  function makeNext(): CallHandler & { handle: jest.Mock } {
    const handle = jest.fn(() => of('downstream-ok')) as any;
    return { handle } as any;
  }

  beforeEach(async () => {
    prisma = {
      stores: { findUnique: jest.fn() },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        StoreTenantInterceptor,
        { provide: GlobalPrismaService, useValue: prisma },
      ],
    }).compile();

    interceptor = moduleRef.get(StoreTenantInterceptor);
  });

  it('passes through when x-store-id is missing (DTO/ValidationPipe owns shape errors)', async () => {
    const next = makeNext();
    const ctx = makeContext({
      headers: {},
      user: { id: 7, organization_id: JWT_ORG_ID },
    });

    const result = await new Promise((resolve, reject) => {
      interceptor.intercept(ctx, next).subscribe({
        next: resolve,
        error: reject,
      });
    });

    expect(result).toBe('downstream-ok');
    expect(next.handle).toHaveBeenCalledTimes(1);
    expect(prisma.stores.findUnique).not.toHaveBeenCalled();
  });

  it('passes through when x-store-id matches the JWT organization', async () => {
    prisma.stores.findUnique.mockResolvedValue({
      organization_id: JWT_ORG_ID,
    });
    const next = makeNext();
    const ctx = makeContext({
      headers: { 'x-store-id': '5' },
      user: { id: 7, organization_id: JWT_ORG_ID },
    });

    const result = await new Promise((resolve, reject) => {
      interceptor.intercept(ctx, next).subscribe({
        next: resolve,
        error: reject,
      });
    });

    expect(result).toBe('downstream-ok');
    expect(next.handle).toHaveBeenCalledTimes(1);
    expect(prisma.stores.findUnique).toHaveBeenCalledWith({
      where: { id: 5 },
      select: { organization_id: true },
    });
  });

  it('throws PRINT_RENDER_TENANT_MISMATCH_001 when x-store-id belongs to a different org', async () => {
    prisma.stores.findUnique.mockResolvedValue({
      organization_id: OTHER_ORG_ID,
    });
    const next = makeNext();
    const ctx = makeContext({
      headers: { 'x-store-id': '5' },
      user: { id: 7, organization_id: JWT_ORG_ID },
    });

    let caught: unknown;
    try {
      await new Promise((resolve, reject) => {
        interceptor.intercept(ctx, next).subscribe({
          next: resolve,
          error: reject,
        });
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(VendixHttpException);
    const ex = caught as VendixHttpException;
    expect(ex.errorCode).toBe('PRINT_RENDER_TENANT_MISMATCH_001');
    expect(ex.getStatus()).toBe(403);
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('throws STORE_FIND_001 when the store does not exist', async () => {
    prisma.stores.findUnique.mockResolvedValue(null);
    const next = makeNext();
    const ctx = makeContext({
      headers: { 'x-store-id': '5' },
      user: { id: 7, organization_id: JWT_ORG_ID },
    });

    let caught: unknown;
    try {
      await new Promise((resolve, reject) => {
        interceptor.intercept(ctx, next).subscribe({
          next: resolve,
          error: reject,
        });
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(VendixHttpException);
    const ex = caught as VendixHttpException;
    expect(ex.errorCode).toBe('STORE_FIND_001');
    expect(ex.getStatus()).toBe(404);
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('does NOT query the DB when x-store-id is a non-numeric string (shape error is DTO/ValidationPipe concern)', async () => {
    const next = makeNext();
    const ctx = makeContext({
      headers: { 'x-store-id': 'not-a-number' },
      user: { id: 7, organization_id: JWT_ORG_ID },
    });

    const result = await new Promise((resolve, reject) => {
      interceptor.intercept(ctx, next).subscribe({
        next: resolve,
        error: reject,
      });
    });

    expect(result).toBe('downstream-ok');
    expect(next.handle).toHaveBeenCalledTimes(1);
    expect(prisma.stores.findUnique).not.toHaveBeenCalled();
  });
});