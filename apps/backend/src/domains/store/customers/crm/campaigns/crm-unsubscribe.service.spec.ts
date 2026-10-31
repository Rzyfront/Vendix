import { Logger } from '@nestjs/common';
import { CrmUnsubscribeService } from './crm-unsubscribe.service';
import { CrmUnsubscribeController } from './crm-unsubscribe.controller';

function setup(env: Record<string, string> = { CRM_UNSUBSCRIBE_SECRET: 'test-secret' }) {
  const prisma = {
    store_users: {
      findFirst: jest.fn().mockResolvedValue({ id: 70, email_consent: 'unknown' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const config = { get: jest.fn((key: string) => env[key]) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new CrmUnsubscribeService(prisma as never, config as never, audit as never);
  return { service, prisma, audit, controller: new CrmUnsubscribeController(service) };
}

const payload = { store_id: 1, customer_id: 41, channel: 'email' as const };

describe('CrmUnsubscribeService', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('round-trips a signed token', () => {
    const { service } = setup();
    expect(service.verify(service.token(payload))).toEqual(payload);
  });

  it('rejects tampered, foreign and malformed tokens', () => {
    const { service } = setup();
    const token = service.token(payload);
    const [, signature] = token.split('.');
    const other = Buffer.from('2.41.email').toString('base64url');
    expect(service.verify(`${other}.${signature}`)).toBeNull();
    expect(service.verify(`${token}x`)).toBeNull();
    expect(service.verify(setup({ CRM_UNSUBSCRIBE_SECRET: 'other' }).service.token(payload))).toBeNull();
    expect(service.verify('')).toBeNull();
    expect(service.verify('a.b.c')).toBeNull();
    const badChannel = Buffer.from('1.41.push').toString('base64url');
    expect(service.verify(`${badChannel}.x`)).toBeNull();
  });

  it('refuses to sign without a secret in production', () => {
    const { service } = setup({ NODE_ENV: 'production' });
    expect(() => service.token(payload)).toThrow('CRM_UNSUBSCRIBE_SECRET');
  });

  it('opts the customer out of the channel in that store, once, and audits it', async () => {
    const { service, prisma, audit } = setup();
    await expect(service.optOut(payload, 'email_link')).resolves.toBe(true);
    expect(prisma.store_users.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { store_id: 1, user_id: 41 } }),
    );
    expect(prisma.store_users.updateMany).toHaveBeenCalledWith({
      where: { id: 70 },
      data: { email_consent: 'opted_out', consent_updated_at: expect.any(Date) },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 1, resource: 'store_users', metadata: { reason: 'crm_marketing_opt_out', source: 'email_link' } }),
    );

    prisma.store_users.findFirst.mockResolvedValue({ id: 70, email_consent: 'opted_out' });
    prisma.store_users.updateMany.mockClear();
    await expect(service.optOut(payload, 'email_link')).resolves.toBe(true);
    expect(prisma.store_users.updateMany).not.toHaveBeenCalled();
  });

  it('the public link answers without revealing anything for an invalid token', async () => {
    const { controller, service, prisma } = setup();
    await expect(controller.open('nope')).resolves.toContain('Enlace no válido');
    expect(prisma.store_users.updateMany).not.toHaveBeenCalled();
    await expect(controller.open(service.token(payload))).resolves.toContain('te diste de baja');
    await expect(controller.oneClick(service.token(payload))).resolves.toEqual({ unsubscribed: true });
  });
});
