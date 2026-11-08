import { AsyncResource } from 'async_hooks';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { InterceptorsConsumer } from '@nestjs/core/interceptors/interceptors-consumer';
import { Observable, defer, lastValueFrom, throwError } from 'rxjs';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { FakeWorkflowDb } from '../../../../testing/workflows/fake-workflow-prisma';
import { WorkflowAuditRequestContext, WorkflowAuditOrigin } from './workflow-audit.context';
import { classifySecretMutation, WorkflowAuditInterceptor } from './workflow-audit.interceptor';
import { WorkflowAuditService } from './workflow-audit.service';

type Req = { method: string; originalUrl: string; ip?: string; headers?: Record<string, string>; body?: unknown };

function setup() {
  const db = new FakeWorkflowDb();
  const prisma = db.asStorePrisma() as StorePrismaService;
  const audit = new WorkflowAuditService(prisma);
  const interceptor = new WorkflowAuditInterceptor(audit, prisma);
  const seen: { origin: WorkflowAuditOrigin | undefined }[] = [];
  const run = (req: Req, handler: () => Promise<unknown> | Observable<unknown>) => {
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    // Like Nest's own CallHandler: `handle()` binds the async context it is called in.
    const next: CallHandler = {
      handle: () =>
        defer(AsyncResource.bind(async () => {
          seen.push({ origin: WorkflowAuditRequestContext.current() });
          await Promise.resolve();
          seen.push({ origin: WorkflowAuditRequestContext.current() });
          const out = handler();
          return out instanceof Observable ? lastValueFrom(out) : out;
        })),
    };
    return RequestContextService.runIsolated(
      { store_id: 10, organization_id: 1, user_id: 7, email: 'ana@tienda.co', is_super_admin: false, is_owner: false },
      () => lastValueFrom(interceptor.intercept(context, next) as Observable<unknown>),
    );
  };
  const rows = () => db.table('workflow_audit_log');
  return { db, run, rows, seen, audit, interceptor };
}

const dump = (row: unknown) => JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

const secretReq = (method: string, tail = '', body?: unknown): Req => ({
  method,
  originalUrl: `/api/store/workflows/secrets${tail}`,
  ip: '181.50.1.2',
  headers: { 'user-agent': 'Mozilla/5.0' },
  body,
});

describe('classifySecretMutation', () => {
  it.each([
    ['POST', '/api/store/workflows/secrets', 'secret.created'],
    ['PUT', '/api/store/workflows/secrets/5', 'secret.updated'],
    ['PATCH', '/store/workflows/secrets/5', 'secret.updated'],
    ['DELETE', '/api/store/workflows/secrets/5', 'secret.deleted'],
    ['POST', '/api/store/workflows/secrets/5/rotate', 'secret.updated'],
    ['DELETE', '/api/store/workflows/secrets/5/extra', 'secret.updated'],
  ])('%s %s is %s', (method, path, action) => {
    expect(classifySecretMutation(method, path)?.action).toBe(action);
  });

  it.each([
    ['GET', '/api/store/workflows/secrets'],
    ['GET', '/api/store/workflows/secrets/5'],
    ['POST', '/api/store/workflows/definitions'],
    ['POST', '/api/store/workflows/secrets-extra'],
  ])('%s %s is not a secret change', (method, path) => {
    expect(classifySecretMutation(method, path)).toBeNull();
  });
});

describe('WorkflowAuditInterceptor', () => {
  it('leaves requests outside Flows and Documents untouched', async () => {
    const { run, seen, rows } = setup();
    await run({ method: 'POST', originalUrl: '/api/store/orders', ip: '1.1.1.1' }, async () => 'ok');
    expect(seen.every((s) => s.origin === undefined)).toBe(true);
    expect(rows()).toHaveLength(0);
  });

  it.each([
    '/api/store/workflows/instances',
    '/api/store/documents/files/3/download',
    '/api/store/workflow-links/1',
    '/api/public/workflows/hooks/abc',
    '/api/ecommerce/documents/sign/token',
    '/api/ecommerce/workflows/tracking/token',
  ])('gives the handler the client IP and browser on %s, across awaits', async (originalUrl) => {
    const { run, seen } = setup();
    await run(
      { method: 'GET', originalUrl, ip: '181.50.1.2', headers: { 'user-agent': 'Mozilla/5.0' } },
      async () => 'ok',
    );
    for (const s of seen) expect(s.origin).toEqual({ ip_address: '181.50.1.2', user_agent: 'Mozilla/5.0' });
  });

  it('returns the handler response as it is', async () => {
    const { run } = setup();
    await expect(run(secretReq('GET'), async () => ({ data: [1] }))).resolves.toEqual({ data: [1] });
  });

  it('records secret.created with the name from the body and never the value', async () => {
    const { run, rows } = setup();
    await run(secretReq('POST', '', { name: 'API_ERP', value: 'super-secreto', description: 'ERP' }), async () => ({
      data: { id: 5, name: 'API_ERP', value: 'super-secreto' },
    }));

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      action: 'secret.created',
      category: 'secret',
      actor_id: 7,
      ip_address: '181.50.1.2',
      user_agent: 'Mozilla/5.0',
      summary: 'Creó el secreto «API_ERP»',
    });
    expect(rows()[0].details).toEqual({ name: 'API_ERP' });
    expect(dump(rows()[0])).not.toContain('super-secreto');
  });

  it('records secret.updated with the name from the response when the body has none', async () => {
    const { run, rows } = setup();
    await run(secretReq('PATCH', '/5', { value: 'nuevo-valor' }), async () => ({ data: { id: 5, name: 'API_ERP' } }));
    expect(rows()[0]).toMatchObject({ action: 'secret.updated', target_id: '5', summary: 'Actualizó el secreto «API_ERP»' });
    expect(dump(rows()[0])).not.toContain('nuevo-valor');
  });

  it('reads the name of a deleted secret before the handler removes it', async () => {
    const { db, run, rows } = setup();
    db.insert('workflow_secrets', { id: 5, store_id: 10, name: 'API_ERP', value_enc: 'cifrado-xyz' });
    await run(secretReq('DELETE', '/5'), async () => {
      db.table('workflow_secrets').splice(0, 1);
      return { data: null };
    });
    expect(rows()[0]).toMatchObject({ action: 'secret.deleted', target_id: '5', summary: 'Eliminó el secreto «API_ERP»' });
    expect(rows()[0].details).toEqual({ name: 'API_ERP' });
    expect(dump(rows()[0])).not.toContain('cifrado-xyz');
  });

  it('does not take the name of a secret that belongs to another store', async () => {
    const { db, run, rows } = setup();
    db.insert('workflow_secrets', { id: 9, store_id: 20, name: 'AJENO', value_enc: 'x' });
    await run(secretReq('DELETE', '/9'), async () => ({ data: null }));
    expect(dump(rows()[0])).not.toContain('AJENO');
    expect(rows()[0].details).toEqual({ name: null });
  });

  it('logs an unknown POST sub-route as an update with its path, never as a creation', async () => {
    const { run, rows } = setup();
    await run(secretReq('POST', '/5/rotate', {}), async () => ({ data: { name: 'API_ERP' } }));
    expect(rows()[0].action).toBe('secret.updated');
    expect(rows()[0].details).toEqual({ name: 'API_ERP', path: '5/rotate' });
  });

  it('records nothing when the handler fails or the call only reads', async () => {
    const { run, rows } = setup();
    await expect(run(secretReq('POST', '', { name: 'X' }), () => throwError(() => new Error('boom')))).rejects.toThrow('boom');
    await run(secretReq('GET', '/5'), async () => ({ data: { name: 'X' } }));
    expect(rows()).toHaveLength(0);
  });

  it('keeps the response when the audit row cannot be written, and logs it', async () => {
    const { run, audit } = setup();
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(audit, 'recordNow').mockRejectedValue(new Error('db down'));
    await expect(run(secretReq('POST', '', { name: 'X' }), async () => ({ data: { name: 'X' } }))).resolves.toEqual({
      data: { name: 'X' },
    });
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('secret.created'));
  });
});

/**
 * Through Nest's own interceptor chain: the store context is opened around
 * `next.handle()` only (as RequestContextInterceptor does) and the chain is
 * subscribed outside it, so the handler keeps the store only when every
 * interceptor calls `next.handle()` while that context is still open.
 */
describe('WorkflowAuditInterceptor in the real Nest interceptor chain', () => {
  const storeContext: NestInterceptor = {
    intercept: (_ctx, next) =>
      RequestContextService.asyncLocalStorage.run(
        { store_id: 10, organization_id: 1, user_id: 7, email: 'ana@tienda.co', is_super_admin: false, is_owner: false },
        () => next.handle(),
      ),
  };

  async function through(req: Req, handler: () => Promise<unknown>) {
    const ctx = setup();
    const out$ = await new InterceptorsConsumer().intercept(
      [storeContext, ctx.interceptor],
      [req, {}, () => undefined],
      {},
      () => undefined,
      handler,
      'http',
    );
    return { ...ctx, result: await lastValueFrom(out$ as Observable<unknown>) };
  }

  const seenByHandler = async () => {
    const before = RequestContextService.getStoreId();
    await Promise.resolve();
    return { before, after: RequestContextService.getStoreId(), origin: WorkflowAuditRequestContext.current() };
  };

  it.each(['/api/store/workflows/usage', '/api/store/workflows/definitions', '/api/store/documents/files'])(
    'the handler of GET %s still sees the store of the request',
    async (originalUrl) => {
      const { result } = await through(
        { method: 'GET', originalUrl, ip: '181.50.1.2', headers: { 'user-agent': 'Mozilla/5.0' } },
        seenByHandler,
      );
      expect(result).toEqual({
        before: 10,
        after: 10,
        origin: { ip_address: '181.50.1.2', user_agent: 'Mozilla/5.0' },
      });
    },
  );

  it('a secret change keeps the store in the handler and records the row for that store', async () => {
    const { result, rows } = await through(secretReq('POST', '', { name: 'API_ERP' }), async () => ({
      data: { name: 'API_ERP', store: RequestContextService.getStoreId() },
    }));
    expect(result).toEqual({ data: { name: 'API_ERP', store: 10 } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ store_id: 10, action: 'secret.created' });
  });

  it('a deleted secret is named from its own store before the handler, which still sees the store', async () => {
    const ctx = setup();
    ctx.db.insert('workflow_secrets', { id: 4, store_id: 10, name: 'TOKEN_BANCO', value_enc: 'x' });
    const out$ = await new InterceptorsConsumer().intercept(
      [storeContext, ctx.interceptor],
      [secretReq('DELETE', '/4'), {}, () => undefined],
      {},
      () => undefined,
      async () => ({ data: null, store: RequestContextService.getStoreId() }),
      'http',
    );
    await expect(lastValueFrom(out$ as Observable<unknown>)).resolves.toEqual({ data: null, store: 10 });
    expect(ctx.rows()[0]).toMatchObject({ store_id: 10, action: 'secret.deleted', details: { name: 'TOKEN_BANCO' } });
  });
});
