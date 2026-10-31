import { CallHandler, ExecutionContext } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { lastValueFrom, of } from 'rxjs';
import { RequestContextService } from '../context/request-context.service';
import { DomainResolverMiddleware } from '../middleware/domain-resolver.middleware';
import { RequestContextInterceptor } from './request-context.interceptor';

const STORE_A = 1;
const STORE_B = 2;
const HOSTNAME_STORE = 9;

function makeReq(originalUrl: string, over: Record<string, any> = {}) {
  const [path, search = ''] = originalUrl.split('?');
  return {
    originalUrl,
    baseUrl: '',
    path,
    query: Object.fromEntries(new URLSearchParams(search)),
    headers: { host: 'tienda.com' },
    ...over,
  } as any;
}

function userOf(store_id: number | null) {
  return {
    id: 50,
    organization_id: 1,
    store_id,
    roles: ['owner'],
    permissions: [],
  };
}

describe('RequestContextInterceptor tenant precedence', () => {
  const publicDomains = {
    resolveByStoreId: jest.fn(async (store_id: number) => ({
      store_id,
      organization_id: 1,
    })),
    resolveDomain: jest.fn(async () => ({
      store_id: HOSTNAME_STORE,
      organization_id: 1,
    })),
  };
  const cache = { get: jest.fn(async () => undefined), set: jest.fn() };
  const res = { setHeader: jest.fn() };
  let middleware: DomainResolverMiddleware;
  let interceptor: RequestContextInterceptor;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    middleware = new DomainResolverMiddleware(
      publicDomains as any,
      cache as any,
    );
    interceptor = new RequestContextInterceptor();
    warn = jest
      .spyOn((interceptor as any).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  /** Runs the middleware, then the interceptor, and returns the store id the handler sees. */
  async function storeSeenByHandler(req: any): Promise<number | undefined> {
    await middleware.use(
      req as Request,
      res as unknown as Response,
      jest.fn() as unknown as NextFunction,
    );
    const context = {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext;
    const handler: CallHandler = {
      handle: () => of(RequestContextService.getStoreId()),
    };
    return lastValueFrom(interceptor.intercept(context, handler));
  }

  it('usuario de la tienda A con ?store_id=B en una ruta store/* opera sobre A', async () => {
    const req = makeReq(
      `/api/store/customers?store_id=${STORE_B}&x=/ecommerce/`,
      {
        user: userOf(STORE_A),
      },
    );

    await expect(storeSeenByHandler(req)).resolves.toBe(STORE_A);
    expect(publicDomains.resolveByStoreId).not.toHaveBeenCalled();
  });

  it('usuario de la tienda A con ?store_id=B en una ruta /ecommerce/ sigue en A y se avisa', async () => {
    const req = makeReq(`/api/ecommerce/cart?store_id=${STORE_B}`, {
      user: userOf(STORE_A),
    });

    await expect(storeSeenByHandler(req)).resolves.toBe(STORE_A);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('usuario sin tienda en el token no hereda la del dominio', async () => {
    const req = makeReq(`/api/ecommerce/cart?store_id=${STORE_B}`, {
      user: userOf(null),
    });

    await expect(storeSeenByHandler(req)).resolves.toBeNull();
  });

  it('usuario de la tienda A en el dominio de A: A, sin aviso', async () => {
    const req = makeReq(`/api/ecommerce/cart?store_id=${STORE_A}`, {
      user: userOf(STORE_A),
    });

    await expect(storeSeenByHandler(req)).resolves.toBe(STORE_A);
    expect(warn).not.toHaveBeenCalled();
  });

  it('visitante sin sesión en ruta pública con ?store_id=B opera sobre B', async () => {
    const req = makeReq(`/api/ecommerce/catalog?store_id=${STORE_B}`);

    await expect(storeSeenByHandler(req)).resolves.toBe(STORE_B);
  });

  it('visitante sin sesión y sin store_id resuelve por hostname', async () => {
    const req = makeReq('/api/ecommerce/catalog');

    await expect(storeSeenByHandler(req)).resolves.toBe(HOSTNAME_STORE);
    expect(publicDomains.resolveDomain).toHaveBeenCalledWith('tienda.com');
  });
});
