jest.mock('../../../../messaging/messaging.service', () => ({ MessagingService: class {} }));
jest.mock('../../../../email/email.service', () => ({ EmailService: class {} }));

import { RequestContextService } from '@common/context/request-context.service';
import { WORKFLOW_CONNECTOR_CATALOG } from '@common/workflows/contract';
import { VendixHttpException } from '@common/errors';
import { WorkflowConnectorsService } from './connectors.service';

const inStore = <T>(store_id: number, fn: () => Promise<T>) =>
  RequestContextService.runIsolated(
    { store_id, organization_id: 1, user_id: 7, is_super_admin: false, is_owner: false, permissions: [] },
    fn,
  );

interface World {
  secrets?: number;
  hooks?: number;
  mailboxes?: number;
  channel?: { id: number; display_phone_number: string | null } | null;
  dian?: Record<string, unknown> | null;
  resolution?: Record<string, unknown> | null;
  fiscalScope?: string;
  userEmail?: string | null;
}

function build(world: World = {}) {
  const wheres: Record<string, unknown[]> = { channel: [], dian: [] };
  const scoped = {
    workflow_secrets: { count: jest.fn().mockResolvedValue(world.secrets ?? 0) },
    workflow_inbound_hooks: { count: jest.fn().mockResolvedValue(world.hooks ?? 0) },
    workflow_mailboxes: {
      count: jest.fn().mockResolvedValue(world.mailboxes ?? 0),
      findFirst: jest.fn().mockResolvedValue(world.mailboxes ? { domain: 'in.vendix.test' } : null),
    },
  };
  const global = {
    social_channels: {
      findFirst: jest.fn(async (args: unknown) => {
        wheres.channel.push(args);
        return world.channel ?? null;
      }),
    },
    organizations: {
      findUnique: jest.fn().mockResolvedValue({ fiscal_scope: world.fiscalScope ?? 'STORE' }),
    },
    dian_configurations: {
      findFirst: jest.fn(async (args: unknown) => {
        wheres.dian.push(args);
        return world.dian ?? null;
      }),
    },
    invoice_resolutions: { findFirst: jest.fn().mockResolvedValue(world.resolution ?? null) },
    users: { findFirst: jest.fn().mockResolvedValue(world.userEmail === null ? null : { email: world.userEmail ?? 'admin@tienda.co' }) },
    stores: { findFirst: jest.fn().mockResolvedValue({ name: 'Mi Tienda' }) },
  };
  const prisma = { ...scoped, withoutScope: () => global };
  const email = {
    isConfigured: jest.fn().mockReturnValue(true),
    getProviderName: jest.fn().mockReturnValue('ses'),
    sendEmail: jest.fn().mockResolvedValue({ success: true }),
  };
  const messaging = {
    isDryRun: jest.fn().mockReturnValue(false),
    sendTemplate: jest.fn().mockResolvedValue({ status: 'sent', provider: 'meta_cloud', retryable: false }),
  };
  const service = new WorkflowConnectorsService(prisma as never, email as never, messaging as never);
  return { service, prisma, global, email, messaging, wheres };
}

const futureDate = new Date(Date.now() + 90 * 86_400_000);
const readyDian = {
  accounting_entity_id: 4,
  enablement_status: 'enabled',
  environment: 'production',
  certificate_s3_key: 'certs/x.p12',
  certificate_kms_key_id: null,
  certificate_expiry: futureDate,
};
const goodResolution = { id: 1, current_number: 10, range_to: 1000 };

describe('WorkflowConnectorsService.list', () => {
  it('returns one card per catalog connector with its action schema and triggers', async () => {
    const { service } = build();
    const list = await inStore(1, () => service.list());
    expect(list.map((c) => c.key)).toEqual(Object.keys(WORKFLOW_CONNECTOR_CATALOG));
    const email = list.find((c) => c.key === 'email_out')!;
    expect(email.actions[0]).toMatchObject({
      name: 'vendix.email.send',
      permission: 'store:workflows:manage',
    });
    expect(email.actions[0].inputs.map((i) => i.key)).toEqual(['to', 'subject', 'body']);
    expect(email.actions[0].inputs.every((i) => i.required)).toBe(true);
    expect(list.find((c) => c.key === 'email_in')!.triggers).toEqual(['email']);
    expect(list.filter((c) => c.testable).map((c) => c.key).sort()).toEqual(['dian', 'email_out', 'whatsapp']);
  });

  it('reports a connected store from its own rows', async () => {
    const { service } = build({
      secrets: 2,
      hooks: 3,
      mailboxes: 1,
      channel: { id: 1, display_phone_number: '+57 300 111 2222' },
      dian: readyDian,
      resolution: goodResolution,
    });
    const status = Object.fromEntries(
      (await inStore(1, () => service.list())).map((c) => [c.key, c.status]),
    );
    expect(status.http).toMatchObject({ state: 'connected', details: { secrets: 2 } });
    expect(status.inbound_webhook).toMatchObject({ state: 'connected', details: { flows: 3 } });
    expect(status.email_out.state).toBe('available');
    expect(status.email_in).toMatchObject({ state: 'connected', details: { mailboxes: 1, domain: 'in.vendix.test' } });
    expect(status.whatsapp).toMatchObject({ state: 'connected', details: { phone: '+57 300 111 2222' } });
    expect(status.dian).toMatchObject({ state: 'connected', missing: null });
  });

  it('reports what is missing for an empty store', async () => {
    const { service } = build();
    const status = Object.fromEntries(
      (await inStore(1, () => service.list())).map((c) => [c.key, c.status]),
    );
    expect(status.http.state).toBe('available');
    expect(status.inbound_webhook.state).toBe('not_connected');
    expect(status.email_in.state).toBe('not_connected');
    expect(status.whatsapp).toMatchObject({ state: 'not_connected', missing: expect.any(String) });
    expect(status.dian.missing).toContain('configuración de facturación electrónica');
  });

  it('reads WhatsApp and DIAN of the requesting store only (isolation)', async () => {
    const a = build({ channel: { id: 1, display_phone_number: null }, dian: readyDian, resolution: goodResolution });
    await inStore(11, () => a.service.list());
    expect(a.wheres.channel[0]).toMatchObject({ where: { store_id: 11, channel_type: 'whatsapp', provider: 'meta_cloud', status: 'connected' } });
    expect(a.wheres.dian[0]).toMatchObject({ where: { store_id: 11, configuration_type: 'invoicing' } });
    const b = build();
    await inStore(22, () => b.service.list());
    expect(b.wheres.channel[0]).toMatchObject({ where: { store_id: 22 } });
    expect(b.wheres.dian[0]).toMatchObject({ where: { store_id: 22 } });
  });

  it('uses the organization configuration when the fiscal scope is ORGANIZATION', async () => {
    const k = build({ fiscalScope: 'ORGANIZATION', dian: readyDian, resolution: goodResolution });
    await inStore(11, () => k.service.list());
    expect(k.wheres.dian[0]).toMatchObject({ where: { organization_id: 1, store_id: null } });
  });

  it('DIAN is not connected with an expired certificate or no resolution', async () => {
    const expired = build({
      dian: { ...readyDian, certificate_expiry: new Date(Date.now() - 86_400_000) },
      resolution: goodResolution,
    });
    const s1 = (await inStore(1, () => expired.service.list())).find((c) => c.key === 'dian')!.status;
    expect(s1.state).toBe('not_connected');
    expect(s1.missing).toContain('vencido');
    const noRes = build({ dian: readyDian, resolution: null });
    const s2 = (await inStore(1, () => noRes.service.list())).find((c) => c.key === 'dian')!.status;
    expect(s2.missing).toContain('resolución');
  });

  it('email_out is not connected when the platform has no provider', async () => {
    const k = build();
    k.email.isConfigured.mockReturnValue(false);
    const s = (await inStore(1, () => k.service.list())).find((c) => c.key === 'email_out')!.status;
    expect(s.state).toBe('not_connected');
  });
});

describe('WorkflowConnectorsService.test', () => {
  it('email_out sends a real email to the requesting user and reports the outcome', async () => {
    const k = build({ userEmail: 'admin@tienda.co' });
    const res = await inStore(1, () => k.service.test('email_out'));
    expect(k.email.sendEmail).toHaveBeenCalledTimes(1);
    expect(k.email.sendEmail.mock.calls[0][0]).toBe('admin@tienda.co');
    expect(res).toMatchObject({ ok: true, simulated: false });
    expect(res.message).toContain('admin@tienda.co');
  });

  it('email_out returns the provider error instead of a fake success', async () => {
    const k = build();
    k.email.sendEmail.mockResolvedValue({ success: false, error: 'domain not verified' });
    const res = await inStore(1, () => k.service.test('email_out'));
    expect(res.ok).toBe(false);
    expect(res.message).toContain('domain not verified');
  });

  it('email_out says so when the server only simulates email', async () => {
    const k = build();
    k.email.getProviderName.mockReturnValue('console');
    const res = await inStore(1, () => k.service.test('email_out'));
    expect(res).toMatchObject({ ok: true, simulated: true });
  });

  it('whatsapp sends a real template through the store channel', async () => {
    const k = build({ channel: { id: 1, display_phone_number: '+57 1' } });
    const res = await inStore(9, () =>
      k.service.test('whatsapp', { to: '+57 300 123 4567', template: 'hola', params: 'Ana|12' }),
    );
    expect(k.messaging.sendTemplate.mock.calls[0][0]).toMatchObject({
      store_id: 9,
      to: '+573001234567',
      template: { name: 'hola', language: 'es', variables: ['Ana', '12'] },
    });
    expect(res).toMatchObject({ ok: true, simulated: false });
  });

  it('whatsapp without channel does not send and says why', async () => {
    const k = build({ channel: null });
    const res = await inStore(9, () => k.service.test('whatsapp', { to: '+573001234567', template: 'hola' }));
    expect(k.messaging.sendTemplate).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: false, message: 'La tienda no tiene un canal de WhatsApp conectado.' });
  });

  it('whatsapp returns the provider error', async () => {
    const k = build({ channel: { id: 1, display_phone_number: null } });
    k.messaging.sendTemplate.mockResolvedValue({ status: 'failed', error_code: 'TEMPLATE_INVALID', error_message: 'not approved', retryable: false });
    const res = await inStore(9, () => k.service.test('whatsapp', { to: '+573001234567', template: 'hola' }));
    expect(res.ok).toBe(false);
    expect(res.message).toContain('TEMPLATE_INVALID');
  });

  it('whatsapp rejects a missing or malformed body with 422 and sends nothing', async () => {
    const k = build({ channel: { id: 1, display_phone_number: null } });
    await expect(inStore(9, () => k.service.test('whatsapp'))).rejects.toMatchObject({ status: 422 });
    await expect(inStore(9, () => k.service.test('whatsapp', { to: '12', template: 'hola' }))).rejects.toBeInstanceOf(VendixHttpException);
    expect(k.messaging.sendTemplate).not.toHaveBeenCalled();
  });

  it('dian checks the configuration without emitting anything', async () => {
    const k = build({ dian: { ...readyDian, enablement_status: 'testing' }, resolution: goodResolution });
    const res = await inStore(1, () => k.service.test('dian'));
    expect(res.ok).toBe(false);
    expect(res.checks!.find((c) => c.key === 'enablement')!.ok).toBe(false);
    expect(res.message).toContain('Falta:');
    const ok = build({ dian: readyDian, resolution: goodResolution });
    expect(await inStore(1, () => ok.service.test('dian'))).toMatchObject({ ok: true });
  });

  it.each(['http', 'inbound_webhook', 'email_in'])('%s is tested from its flow (422)', async (key) => {
    const k = build();
    await expect(inStore(1, () => k.service.test(key))).rejects.toMatchObject({
      status: 422,
      response: { message: 'Este conector se prueba desde su flujo.' },
    });
  });

  it('an unknown key is 404 (also prototype names)', async () => {
    const k = build();
    await expect(inStore(1, () => k.service.test('nope'))).rejects.toMatchObject({ status: 404 });
    await expect(inStore(1, () => k.service.test('constructor'))).rejects.toMatchObject({ status: 404 });
  });
});
