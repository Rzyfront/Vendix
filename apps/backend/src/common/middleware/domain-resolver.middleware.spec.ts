import type { NextFunction, Request, Response } from 'express';
import {
  DomainResolverMiddleware,
  isValidTenantId,
} from './domain-resolver.middleware';

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: null as any,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as Response & { statusCode: number; body: any };
}

function makeReq(over: Record<string, any> = {}): Request {
  return {
    originalUrl: '/api/ecommerce/catalog?search=cafe',
    headers: {},
    query: {},
    ...over,
  } as unknown as Request;
}

describe('DomainResolverMiddleware tenant validation (D.3 / F-042)', () => {
  const publicDomains = {
    resolveByStoreId: jest.fn(async (store_id: number) => ({
      store_id,
      organization_id: 1,
    })),
    resolveDomain: jest.fn(async () => ({ store_id: 9, organization_id: 1 })),
  };
  const cache = { get: jest.fn(async () => undefined), set: jest.fn() };
  let middleware: DomainResolverMiddleware;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    middleware = new DomainResolverMiddleware(publicDomains as any, cache as any);
    next = jest.fn();
  });

  it('x-store-id válido resuelve y sigue (next, sin 400)', async () => {
    await middleware.use(
      makeReq({ headers: { 'x-store-id': '10', host: 'tienda.com' } }),
      makeRes(),
      next as unknown as NextFunction,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(publicDomains.resolveByStoreId).toHaveBeenCalledWith(10);
  });

  it.each(['abc', '0', '-1', '3.5', '1e3', '0x10', '10;DROP', '  '])(
    'presente-pero-inválido (%s) → 400 directo con SYS_VALIDATION_001',
    async (bad) => {
      const req = makeReq({
        headers: { 'x-store-id': bad, host: 'tienda.com' },
      });
      const res = makeRes();

      await middleware.use(req, res, next as unknown as NextFunction);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.body.error_code).toBe('SYS_VALIDATION_001');
      expect(res.body.statusCode).toBe(400);
      expect(publicDomains.resolveByStoreId).not.toHaveBeenCalled();
      expect(publicDomains.resolveDomain).not.toHaveBeenCalled();
    },
  );

  it('array (?store_id=1&store_id=2) → 400 ambiguo, sin resolver', async () => {
    const req = makeReq({ query: { store_id: ['1', '2'] } });
    const res = makeRes();

    await middleware.use(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(publicDomains.resolveByStoreId).not.toHaveBeenCalled();
  });

  it('ausente/vacío cae a hostname (intacto, sin 400)', async () => {
    for (const headers of [{}, { 'x-store-id': '' }]) {
      jest.clearAllMocks();
      const req = makeReq({ headers: { ...headers, host: 'tienda.com' } });
      const res = makeRes();

      await middleware.use(req, res, next as unknown as NextFunction);

      expect(res.statusCode).toBe(0);
      expect(next).toHaveBeenCalledTimes(1);
      expect(publicDomains.resolveDomain).toHaveBeenCalledWith('tienda.com');
      expect((req as any).domain_context).toEqual({
        store_id: 9,
        organization_id: 1,
      });
    }
  });

  it('rutas no-ecommerce pasan sin tocar (early exit)', async () => {
    const req = makeReq({
      originalUrl: '/api/store/products?search=cafe',
      headers: { 'x-store-id': 'abc' },
    });
    const res = makeRes();

    await middleware.use(req, res, next as unknown as NextFunction);

    expect(res.statusCode).toBe(0);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('isValidTenantId: solo dígitos, > 0, entero seguro', () => {
    for (const good of ['1', '10', '007']) expect(isValidTenantId(good)).toBe(true);
    for (const bad of ['', '0', '-1', '3.5', 'abc', '1e3', '0x10', '1 ']) {
      expect(isValidTenantId(bad)).toBe(false);
    }
    expect(isValidTenantId(String(Number.MAX_SAFE_INTEGER))).toBe(true);
    expect(isValidTenantId(String(Number.MAX_SAFE_INTEGER + 1))).toBe(false);
  });
});
