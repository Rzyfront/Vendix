import { VendixHttpException } from '@common/errors';
import { WorkflowInboundReceiverService } from './workflow-inbound-receiver.service';
import { inboundSignature } from './workflow-inbound.rules';

const SECRET = 'whin_test-secret';
const hookRow = {
  id: 7,
  store_id: 3,
  organization_id: 2,
  definition_id: 11,
  public_id: 'wfh_0123456789abcdef',
  secret_enc: 'enc:' + SECRET,
  is_active: true,
  rate_limit_per_minute: 2,
};

function build(overrides: { hook?: any; industries?: string[]; startExternal?: jest.Mock } = {}) {
  const requests: any[] = [];
  const instances = new Map<number, any>([[40, { id: 40, reference: 'FLU-0040' }]]);
  const db: any = {
    workflow_inbound_hooks: {
      findFirst: jest.fn(async ({ where }: any) => {
        const hook = overrides.hook === undefined ? hookRow : overrides.hook;
        return hook && where.public_id === hook.public_id && (!where.is_active || hook.is_active)
          ? hook
          : null;
      }),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    stores: {
      findFirst: jest.fn(async () => ({ industries: overrides.industries ?? ['administration'] })),
    },
    workflow_inbound_requests: {
      findFirst: jest.fn(async ({ where }: any) =>
        requests.find((r) => r.hook_id === where.hook_id && r.idempotency_key === where.idempotency_key) ?? null,
      ),
      count: jest.fn(async ({ where }: any) =>
        requests.filter((r) => r.hook_id === where.hook_id && r.created_at >= where.created_at.gte).length,
      ),
      create: jest.fn(async ({ data }: any) => {
        requests.push({ ...data, created_at: new Date() });
        return data;
      }),
    },
    workflow_instances: {
      findFirst: jest.fn(async ({ where }: any) => instances.get(where.id) ?? null),
    },
  };
  const engine = {
    startExternal:
      overrides.startExternal ??
      jest.fn(async () => ({ instance: { id: 40, reference: 'FLU-0040' }, replayed: false })),
  };
  const service = new WorkflowInboundReceiverService(
    { withoutScope: () => db } as any,
    { decrypt: (v: string) => v.replace(/^enc:/, '') } as any,
    engine as any,
  );
  return { service, db, engine, requests };
}

function call(
  service: WorkflowInboundReceiverService,
  body: string,
  opts: { secret?: string; key?: string | undefined; ts?: number; omitSignature?: boolean } = {},
) {
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  return service.receive('wfh_0123456789abcdef', {
    rawBody: body,
    timestamp: String(ts),
    signature: opts.omitSignature
      ? undefined
      : `sha256=${inboundSignature(opts.secret ?? SECRET, ts, body)}`,
    idempotencyKey: 'key' in opts ? opts.key : 'k-1',
  });
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof VendixHttpException ? e.errorCode : `OTHER:${(e as Error).message}`;
  }
};

const BODY = JSON.stringify({ values: { amount: 10 }, title: 'Pedido web' });

describe('WorkflowInboundReceiverService (P3.1)', () => {
  it('a signed call starts the request as the hook and answers the reference', async () => {
    const { service, engine, db } = build();
    const r = await call(service, BODY);
    expect(r).toEqual({ reference: 'FLU-0040', instance_id: 40, replayed: false });
    expect(engine.startExternal).toHaveBeenCalledWith({
      definitionId: 11,
      kind: 'webhook',
      values: { amount: 10 },
      idempotencyKey: '7:k-1',
      started: { hook_id: 7 },
      title: 'Pedido web',
    });
    expect(db.workflow_inbound_requests.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ hook_id: 7, store_id: 3, idempotency_key: 'k-1', status: 'accepted', instance_id: 40 }),
    });
    expect(db.workflow_inbound_hooks.updateMany).toHaveBeenCalled();
  });

  it('runs the engine inside the store of the hook, never one from the body', async () => {
    const seen: any[] = [];
    const { service } = build({
      startExternal: jest.fn(async () => {
        const { RequestContextService } = await import('@common/context/request-context.service');
        seen.push(RequestContextService.getContext());
        return { instance: { id: 40, reference: 'FLU-0040' }, replayed: false };
      }),
    });
    await call(service, JSON.stringify({ values: {}, store_id: 999 }));
    expect(seen[0]).toMatchObject({ store_id: 3, organization_id: 2, is_super_admin: false, is_owner: false });
  });

  it('answers 401 for a missing, wrong or expired signature, and starts nothing', async () => {
    const { service, engine } = build();
    expect(await code(call(service, BODY, { omitSignature: true }))).toBe('WORKFLOW_INBOUND_SIGNATURE_INVALID');
    expect(await code(call(service, BODY, { secret: 'other' }))).toBe('WORKFLOW_INBOUND_SIGNATURE_INVALID');
    expect(
      await code(call(service, BODY, { ts: Math.floor(Date.now() / 1000) - 301 })),
    ).toBe('WORKFLOW_INBOUND_SIGNATURE_INVALID');
    expect(engine.startExternal).not.toHaveBeenCalled();
  });

  it('a tampered body fails the signature', async () => {
    const { service } = build();
    const ts = Math.floor(Date.now() / 1000);
    const signature = `sha256=${inboundSignature(SECRET, ts, BODY)}`;
    const attempt = service.receive('wfh_0123456789abcdef', {
      rawBody: BODY.replace('10', '11'),
      timestamp: String(ts),
      signature,
      idempotencyKey: 'k-1',
    });
    expect(await code(attempt)).toBe('WORKFLOW_INBOUND_SIGNATURE_INVALID');
  });

  it('unknown or inactive hooks answer 404', async () => {
    expect(await code(call(build({ hook: null }).service, BODY))).toBe('WORKFLOW_INBOUND_NOT_FOUND');
    expect(
      await code(call(build({ hook: { ...hookRow, is_active: false } }).service, BODY)),
    ).toBe('WORKFLOW_INBOUND_NOT_FOUND');
  });

  it('a store without the administration industry answers 404', async () => {
    const { service, engine } = build({ industries: ['retail'] });
    expect(await code(call(service, BODY))).toBe('WORKFLOW_INBOUND_NOT_FOUND');
    expect(engine.startExternal).not.toHaveBeenCalled();
  });

  it('requires an Idempotency-Key of 1..120 characters', async () => {
    const { service } = build();
    expect(await code(call(service, BODY, { key: undefined }))).toBe('WORKFLOW_INBOUND_KEY_REQUIRED');
    expect(await code(call(service, BODY, { key: '' }))).toBe('WORKFLOW_INBOUND_KEY_REQUIRED');
    expect(await code(call(service, BODY, { key: 'x'.repeat(121) }))).toBe('WORKFLOW_INBOUND_KEY_REQUIRED');
  });

  it('a repeated key answers the original reference without starting again', async () => {
    const { service, engine } = build();
    await call(service, BODY);
    const again = await call(service, BODY);
    expect(again).toEqual({ reference: 'FLU-0040', instance_id: 40, replayed: true });
    expect(engine.startExternal).toHaveBeenCalledTimes(1);
  });

  it('answers 429 above the per-minute limit and records nothing for it', async () => {
    const { service, engine, requests } = build();
    await call(service, BODY, { key: 'a' });
    await call(service, BODY, { key: 'b' });
    expect(await code(call(service, BODY, { key: 'c' }))).toBe('WORKFLOW_INBOUND_RATE_LIMITED');
    expect(engine.startExternal).toHaveBeenCalledTimes(2);
    expect(requests).toHaveLength(2);
  });

  it('passes the 422 field errors through and records the rejection', async () => {
    const error = new VendixHttpException(
      { code: 'WORKFLOW_FORM_INVALID', httpStatus: 422, devMessage: 'x' } as any,
      undefined,
      { errors: [{ field: 'amount', message: 'Debe ser un número' }] },
    );
    const { service, requests } = build({ startExternal: jest.fn(async () => { throw error; }) });
    await expect(call(service, BODY)).rejects.toBe(error);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ status: 'rejected', error: expect.stringContaining('WORKFLOW_FORM_INVALID') });
    expect(requests[0]).not.toHaveProperty('instance_id');
    expect(requests[0].idempotency_key.startsWith('~rejected-')).toBe(true);
  });

  it('rejects bodies that are not {"values": {...}} and bodies over 64 KB', async () => {
    const { service } = build();
    expect(await code(call(service, 'not json'))).toBe('WORKFLOW_INBOUND_PAYLOAD_INVALID');
    expect(await code(call(service, JSON.stringify({ values: [] })))).toBe('WORKFLOW_INBOUND_PAYLOAD_INVALID');
    expect(await code(call(service, JSON.stringify({ values: { a: 'x'.repeat(70_000) } })))).toBe(
      'WORKFLOW_INBOUND_PAYLOAD_TOO_LARGE',
    );
  });
});
