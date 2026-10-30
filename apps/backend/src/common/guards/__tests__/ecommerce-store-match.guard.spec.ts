import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EcommerceStoreMatchGuard } from '../ecommerce-store-match.guard';
import { VendixHttpException } from '../../errors';

/**
 * QUI-966 (S1) — a customer JWT issued for store A must not operate on store
 * B by sending `x-store-id: B` (or hitting B's domain). The domain resolver
 * lets the header override the token's store, so this guard pins them.
 */
describe('EcommerceStoreMatchGuard (QUI-966 S1)', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: EcommerceStoreMatchGuard;

  function makeContext(req: any): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    guard = new EcommerceStoreMatchGuard(reflector as unknown as Reflector);
  });

  it('allows a customer whose token store matches the resolved store', () => {
    const req = { user: { id: 1, store_id: 3 }, domain_context: { store_id: 3 } };
    expect(guard.canActivate(makeContext(req))).toBe(true);
  });

  it('rejects a customer token from another store with 403', () => {
    const req = { user: { id: 1, store_id: 3 }, domain_context: { store_id: 10 } };
    let thrown: unknown;
    try {
      guard.canActivate(makeContext(req));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(VendixHttpException);
    expect((thrown as VendixHttpException).getStatus()).toBe(403);
  });

  it('rejects an authenticated token without store scope', () => {
    const req = { user: { id: 1, store_id: null }, domain_context: { store_id: 3 } };
    expect(() => guard.canActivate(makeContext(req))).toThrow(VendixHttpException);
  });

  it('lets @Public endpoints through even with a foreign token', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const req = { user: { id: 1, store_id: 3 }, domain_context: { store_id: 10 } };
    expect(guard.canActivate(makeContext(req))).toBe(true);
  });

  it('defers to the auth guard when there is no user', () => {
    const req = { domain_context: { store_id: 3 } };
    expect(guard.canActivate(makeContext(req))).toBe(true);
  });

  it('accepts a numeric-string store id from the token', () => {
    const req = { user: { id: 1, store_id: '3' }, domain_context: { store_id: 3 } };
    expect(guard.canActivate(makeContext(req))).toBe(true);
  });
});
