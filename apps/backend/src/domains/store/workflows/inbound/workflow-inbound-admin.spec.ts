import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { WorkflowInboundHooksService } from './workflow-inbound-hooks.service';
import { WorkflowMailboxService } from './workflow-mailbox.service';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof VendixHttpException ? e.errorCode : `OTHER:${(e as Error).message}`;
  }
};

function world(triggers: Array<{ kind: string }> = [{ kind: 'webhook' }, { kind: 'email' }]) {
  const hooks: any[] = [];
  const boxes: any[] = [];
  const pick = (rows: any[], where: any) =>
    rows.find((r) => Object.entries(where).every(([k, v]) => typeof v === 'object' ? true : r[k] === v));
  const table = (rows: any[]) => ({
    findFirst: jest.fn(async ({ where }: any) => pick(rows, where) ?? null),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: rows.length + 1, created_at: new Date(), last_used_at: null, last_received_at: null, ...data };
      rows.push(row);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const row = pick(rows, where);
      if (row) Object.assign(row, data);
      return { count: row ? 1 : 0 };
    }),
    count: jest.fn(async () => 0),
  });
  const prisma: any = {
    workflow_definitions: {
      // definition 11 belongs to store 3; any other id is foreign.
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === 11 && where.store_id === 3
          ? { id: 11, status: 'active', published_version_id: 21 }
          : null,
      ),
    },
    workflow_versions: { findFirst: jest.fn(async () => ({ definition: { triggers } })) },
    workflow_inbound_hooks: table(hooks),
    workflow_inbound_requests: { count: jest.fn(async () => 4) },
    workflow_mailboxes: table(boxes),
    workflow_mailbox_messages: { count: jest.fn(async () => 2) },
  };
  const encryption = { encrypt: (v: string) => `enc:${v}` };
  const config = {
    get: (key: string, fallback?: string) =>
      ({ EMAIL_RECEPTION_ENVIRONMENT: 'production' } as Record<string, string>)[key] ?? fallback,
  };
  return {
    hooks,
    boxes,
    prisma,
    hookService: new WorkflowInboundHooksService(prisma, encryption as any),
    mailService: new WorkflowMailboxService(prisma, config as any),
  };
}

const asStore = <T>(fn: () => Promise<T>) =>
  RequestContextService.runIsolated(
    { store_id: 3, organization_id: 2, user_id: 9, is_super_admin: false, is_owner: false },
    fn,
  );

describe('Inbound webhook admin (P3.1)', () => {
  it('creates the hook, returns the secret once and never exposes it again', async () => {
    const w = world();
    const created: any = await asStore(() => w.hookService.create(11));
    expect(created.secret).toMatch(/^whin_/);
    expect(created.path).toBe(`/public/workflows/hooks/${created.public_id}`);
    expect(w.hooks[0].secret_enc).toBe(`enc:${created.secret}`);

    const state: any = await asStore(() => w.hookService.state(11));
    expect(state).toMatchObject({ public_id: created.public_id, is_active: true, rate_limit_per_minute: 60, recent_requests_24h: 4 });
    expect(JSON.stringify(state)).not.toContain('secret');
  });

  it('the state is null before activation', async () => {
    expect(await asStore(() => world().hookService.state(11))).toBeNull();
  });

  it('rotate returns a different secret once and keeps the url', async () => {
    const w = world();
    const first: any = await asStore(() => w.hookService.create(11));
    const rotated: any = await asStore(() => w.hookService.rotate(11));
    expect(rotated.secret).not.toBe(first.secret);
    expect(rotated.public_id).toBe(first.public_id);
    expect(w.hooks[0].secret_enc).toBe(`enc:${rotated.secret}`);
  });

  it('a second create while active conflicts; after deactivating it reactivates with a new secret', async () => {
    const w = world();
    const first: any = await asStore(() => w.hookService.create(11));
    expect(await code(asStore(() => w.hookService.create(11)))).toBe('WORKFLOW_INBOUND_ALREADY_ACTIVE');
    await asStore(() => w.hookService.update(11, { is_active: false }));
    const again: any = await asStore(() => w.hookService.create(11));
    expect(again.public_id).toBe(first.public_id);
    expect(again.is_active).toBe(true);
    expect(again.secret).not.toBe(first.secret);
  });

  it('updates the rate limit and the switch; rotate/patch before activation answer 404', async () => {
    const w = world();
    expect(await code(asStore(() => w.hookService.rotate(11)))).toBe('WORKFLOW_INBOUND_NOT_ACTIVATED');
    expect(await code(asStore(() => w.hookService.update(11, { is_active: false })))).toBe('WORKFLOW_INBOUND_NOT_ACTIVATED');
    await asStore(() => w.hookService.create(11));
    const patched: any = await asStore(() => w.hookService.update(11, { rate_limit_per_minute: 5 }));
    expect(patched.rate_limit_per_minute).toBe(5);
  });

  it('a flow whose published version has no webhook trigger answers 422', async () => {
    const w = world([{ kind: 'manual' }]);
    expect(await code(asStore(() => w.hookService.create(11)))).toBe('WORKFLOW_INBOUND_UNAVAILABLE');
    expect(w.hooks).toHaveLength(0);
  });

  it('a definition of another store answers 404 on every endpoint', async () => {
    const w = world();
    for (const call of [
      () => w.hookService.state(99),
      () => w.hookService.create(99),
      () => w.hookService.rotate(99),
      () => w.hookService.update(99, { is_active: false }),
      () => w.mailService.state(99),
      () => w.mailService.activate(99),
      () => w.mailService.update(99, { is_active: false }),
    ]) {
      expect(await code(asStore(call))).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
    }
  });
});

describe('Mailbox admin (P3.3 correo entrante)', () => {
  it('creates flujos-<32 hex>@<reception domain> and keeps the address across off/on', async () => {
    const w = world();
    const created: any = await asStore(() => w.mailService.activate(11));
    expect(created.address).toMatch(/^flujos-[0-9a-f]{32}@recepcion\.vendix\.online$/);
    await asStore(() => w.mailService.update(11, { is_active: false }));
    expect((await asStore(() => w.mailService.state(11)) as any).is_active).toBe(false);
    const back: any = await asStore(() => w.mailService.update(11, { is_active: true }));
    expect(back.address).toBe(created.address);
    expect(back.is_active).toBe(true);
  });

  it('answers 422 without an email trigger and 404 to patch a missing mailbox', async () => {
    const w = world([{ kind: 'webhook' }]);
    expect(await code(asStore(() => w.mailService.activate(11)))).toBe('WORKFLOW_INBOUND_UNAVAILABLE');
    expect(await code(asStore(() => w.mailService.update(11, { is_active: true })))).toBe('WORKFLOW_INBOUND_NOT_ACTIVATED');
  });

  it('is null before activation', async () => {
    expect(await asStore(() => world().mailService.state(11))).toBeNull();
  });
});
