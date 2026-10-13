import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DocumentEmailInboxService } from './document-email-inbox.service';
import { ActivateDocumentEmailInboxDto, DocumentEmailEmptyQueryDto, RotateDocumentEmailAddressDto, UpdateDocumentEmailInboxDto } from '../dto/document-email-reception.dto';
import type { ReceivedDocumentsReadContext } from './received-documents-context.service';
import { StoreDocumentEmailReceptionController } from '../store-document-email-reception.controller';
import { DOCUMENT_EMAIL_REASON_CODES, DOCUMENT_EMAIL_STATES } from '../interfaces/document-email-reception.interface';

const ctx: ReceivedDocumentsReadContext = { organization_id: 3, store_id: 21, accounting_entity_id: 8, actor_id: 55, fiscal_scope: 'ORGANIZATION', is_organization: false };
const address = 'facturas-0123456789abcdef0123456789abcdef';
const record = (overrides = {}) => ({
  id: 4, organization_id: 3, store_id: 21, accounting_entity_id: 8, local_part: address,
  domain: 'recepcion-stg.vendix.online', environment: 'staging', enabled: true, version: 1,
  created_by: 55, updated_by: 55, policy_version: '2026-10-13-v1', policy_accepted_at: new Date(),
  first_valid_received_at: null, last_email_at: null, last_valid_received_at: null, last_error_code: null,
  created_at: new Date(), updated_at: new Date(), ...overrides,
});
const snapshot = () => ({ inbox_id: 4, organization_id: 3, store_id: 21, accounting_entity_id: 8, local_part: address, domain: 'recepcion-stg.vendix.online', environment: 'staging' });
function harness(overrides: Record<string, string> = {}) {
  const env = { EMAIL_RECEPTION_ENABLED: 'true', EMAIL_RECEPTION_STORE_ALLOWLIST: '21', ...overrides };
  const config = { get: jest.fn((key: keyof typeof env, fallback: string) => env[key] ?? fallback) };
  let current: ReturnType<typeof record> | null = null;
  const inbox = {
    findFirst: jest.fn(async () => current), count: jest.fn().mockResolvedValue(0),
    create: jest.fn(async ({ data }) => { current = record(data); return current; }),
    updateMany: jest.fn(async ({ where, data }) => {
      if (!current || current.version !== where.version) return { count: 0 };
      current = { ...current, ...data, version: current.version + 1 }; return { count: 1 };
    }),
  };
  const messages = { count: jest.fn().mockResolvedValue(0), updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
  const db = {
    organizations: { findFirst: jest.fn().mockResolvedValue({ id: 3, fiscal_scope: 'ORGANIZATION', operating_scope: 'ORGANIZATION' }) },
    stores: { findFirst: jest.fn().mockResolvedValue({ id: 21, nit_type: 'NIT' }) },
    accounting_entities: { findFirst: jest.fn().mockResolvedValue({ id: 8, legal_name: 'Example', fiscal_scope: 'ORGANIZATION',
      organization: { name: 'Example', document_type: 'NIT', organization_settings: { settings: { fiscal_data: { nit: '900123456', nit_type: 'NIT' } } } }, store: null }) },
    dian_configurations: { findFirst: jest.fn().mockResolvedValue({ nit: '900123456', name: 'Example' }) },
  };
  const prisma = {
    ...db, document_reception_email_inboxes: inbox, document_reception_email_messages: messages,
    audit_logs: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    withoutScope: jest.fn(() => db), $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
  const fiscal = { findFiscalAccountingEntityId: jest.fn().mockResolvedValue(8), assertValidScopeCombination: jest.fn() };
  const subscriptions = { canUseModule: jest.fn().mockResolvedValue({ allowed: true, has_record: true }) };
  const service = new DocumentEmailInboxService(prisma as never, config as unknown as ConfigService, fiscal as never, subscriptions as never);
  return { service, prisma, inbox, messages, db, fiscal, subscriptions, setInbox: (row: ReturnType<typeof record> | null) => { current = row; } };
}
const activate = { consent: true, policy_version: '2026-10-13-v1' };

describe('DocumentEmailInboxService', () => {
  it('defaults disabled and requires an explicit numeric store allowlist', () => {
    expect(harness({ EMAIL_RECEPTION_ENABLED: 'false' }).service.isPilotAvailable(21)).toBe(false);
    expect(harness({ EMAIL_RECEPTION_STORE_ALLOWLIST: '*' }).service.isPilotAvailable(21)).toBe(false);
    expect(harness({ EMAIL_RECEPTION_STORE_ALLOWLIST: ' 21,22 ' }).service.isPilotAvailable(21)).toBe(true);
  });
  it('activates once under a store lock and returns no record internals', async () => {
    const h = harness();
    const first = await h.service.activate(ctx, activate);
    const second = await h.service.activate(ctx, activate);
    expect(second.address).toBe(first.address);
    expect(first.address).toMatch(/^facturas-[0-9a-f]{32}@recepcion-stg\.vendix\.online$/);
    expect(h.inbox.create).toHaveBeenCalledTimes(1);
    expect(h.prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(h.prisma.audit_logs.create).toHaveBeenCalledTimes(1);
    expect(h.inbox.create).toHaveBeenCalledWith({ data: expect.objectContaining({ organization_id: 3, store_id: 21, accounting_entity_id: 8, created_by: 55, updated_by: 55 }) });
    expect(Object.keys(first).sort()).toEqual(['address', 'configured', 'enabled', 'policy_version', 'version']);
  });
  it('converges a P2002 only on the existing same-store inbox', async () => {
    const h = harness(); h.setInbox(record());
    h.prisma.$transaction.mockRejectedValueOnce({ code: 'P2002' });
    expect((await h.service.activate(ctx, activate)).address).toBe(`${address}@recepcion-stg.vendix.online`);
    expect(h.inbox.findFirst).toHaveBeenLastCalledWith({ where: { organization_id: 3, store_id: 21 } });
  });
  it('requires explicit consent and a current policy version before creating anything', async () => {
    const h = harness();
    await expect(h.service.activate(ctx, { ...activate, consent: false })).rejects.toMatchObject({ errorCode: 'EMAIL_RECEPTION_CONSENT_REQUIRED' });
    await expect(h.service.activate(ctx, { ...activate, policy_version: 'old' })).rejects.toMatchObject({ errorCode: 'EMAIL_RECEPTION_CONSENT_REQUIRED' });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('rejects absent actor and organization controller contexts', async () => {
    const h = harness();
    await expect(h.service.activate({ ...ctx, actor_id: undefined }, activate)).rejects.toMatchObject({ errorCode: 'SYS_FORBIDDEN_001' });
    await expect(h.service.configuration({ ...ctx, is_organization: true })).rejects.toMatchObject({ errorCode: 'SYS_FORBIDDEN_001' });
  });
  it.each(['organization', 'store', 'entity', 'dian'] as const)('fails closed for missing active %s', async (target) => {
    const h = harness();
    const delegate = target === 'organization' ? h.db.organizations : target === 'store' ? h.db.stores : target === 'entity' ? h.db.accounting_entities : h.db.dian_configurations;
    delegate.findFirst.mockResolvedValue(null);
    await expect(h.service.activate(ctx, activate)).rejects.toMatchObject({ errorCode: 'EMAIL_RECEPTION_FISCAL_GATE' });
    expect(h.inbox.create).not.toHaveBeenCalled();
  });
  it('rejects wrong fiscal binding, disabled pilot and blocked subscription', async () => {
    const h = harness(); h.fiscal.findFiscalAccountingEntityId.mockResolvedValue(9);
    await expect(h.service.activate(ctx, activate)).rejects.toMatchObject({ errorCode: 'EMAIL_RECEPTION_FISCAL_GATE' });
    const off = harness({ EMAIL_RECEPTION_STORE_ALLOWLIST: '22' });
    await expect(off.service.activate(ctx, activate)).rejects.toMatchObject({ errorCode: 'EMAIL_RECEPTION_UNAVAILABLE' });
    const blocked = harness(); blocked.subscriptions.canUseModule.mockResolvedValue({ allowed: false, has_record: true });
    await expect(blocked.service.activate(ctx, activate)).rejects.toMatchObject({ errorCode: 'EMAIL_RECEPTION_SUBSCRIPTION_BLOCKED' });
  });
  it.each([
    { allowed: true, has_record: false },
    { allowed: false, has_record: false, reason: 'SUBSCRIPTION_INTERNAL_ERROR' },
  ])('propagates resolver fallback %j as a technical 503, not a subscription business rejection', async (access) => {
    const h = harness(); h.subscriptions.canUseModule.mockResolvedValueOnce(access);
    await expect(h.service.activate(ctx, activate)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(h.inbox.create).not.toHaveBeenCalled();
  });
  it('propagates a thrown subscription resolver error as a technical 503', async () => {
    const h = harness(); h.subscriptions.canUseModule.mockRejectedValueOnce(new Error('resolver offline'));
    await expect(h.service.activate(ctx, activate)).rejects.toMatchObject({ status: 503 });
  });
  it('still rejects a genuine missing subscription as a business gate', async () => {
    const h = harness(); h.subscriptions.canUseModule.mockResolvedValueOnce({ allowed: false, has_record: false, reason: 'SUBSCRIPTION_004' });
    await expect(h.service.activate(ctx, activate)).rejects.toMatchObject({ errorCode: 'EMAIL_RECEPTION_SUBSCRIPTION_BLOCKED' });
  });
  it('reads configuration and historical status with no create/ensure/subscription side effects', async () => {
    const h = harness({ EMAIL_RECEPTION_ENABLED: 'false' }); h.setInbox(record());
    expect((await h.service.configuration(ctx)).address).toBe(`${address}@recepcion-stg.vendix.online`);
    const status = await h.service.status(ctx);
    expect(status).toMatchObject({ pilot_available: false, configured: true, active_inboxes: 0, state: 'paused' });
    expect(JSON.stringify(status)).not.toMatch(/facturas-|actor|gmail|bucket|raw_key/);
    expect(h.fiscal.findFiscalAccountingEntityId).not.toHaveBeenCalled();
    expect(h.subscriptions.canUseModule).not.toHaveBeenCalled();
    expect(h.inbox.create).not.toHaveBeenCalled();
  });
  it('returns organization counts only with an explicit fiscal organization predicate', async () => {
    const h = harness(); h.inbox.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    expect(await h.service.status({ ...ctx, store_id: null })).toMatchObject({ configured: true, active_inboxes: 2, last_email_at: null });
    expect(h.inbox.findFirst).not.toHaveBeenCalled();
    expect(h.inbox.count).toHaveBeenNthCalledWith(1, { where: { organization_id: 3, accounting_entity_id: 8 } });
  });
  it('pauses while the pilot is disabled without losing the address; stale CAS is 409', async () => {
    const h = harness({ EMAIL_RECEPTION_ENABLED: 'false' }); h.setInbox(record());
    expect(await h.service.update(ctx, { enabled: false, expected_version: 1 })).toMatchObject({ enabled: false, version: 2, address: `${address}@recepcion-stg.vendix.online` });
    await expect(h.service.update(ctx, { enabled: false, expected_version: 1 })).rejects.toMatchObject({ errorCode: 'EMAIL_RECEPTION_VERSION_CONFLICT' });
    expect(h.subscriptions.canUseModule).not.toHaveBeenCalled();
  });
  it('rotates via CAS, revokes Gmail code and keeps already-accepted address snapshots valid', async () => {
    const h = harness(); h.setInbox(record());
    const next = await h.service.rotateAddress(ctx, { expected_version: 1, confirmed: true });
    expect(next.address).not.toBe(`${address}@recepcion-stg.vendix.online`);
    expect(next.version).toBe(2);
    expect(h.messages.updateMany).toHaveBeenCalledWith({ where: { inbox_id: 4, organization_id: 3, store_id: 21 }, data: { gmail_code_encrypted: null, gmail_code_expires_at: null, gmail_challenge_alias: null } });
    const resolved = await h.service.revalidateSnapshot(snapshot());
    expect(resolved).toMatchObject({ local_part: address, fiscal_scope: 'ORGANIZATION', fiscal_identity: { nit: '900123456', nit_type: 'NIT' } });
    expect(resolved).not.toHaveProperty('actor_id');
  });
  it('looks up a paused alias without gates or actor, so its rejection can be registered durably', async () => {
    const h = harness({ EMAIL_RECEPTION_ENABLED: 'false' }); h.setInbox(record({ enabled: false }));
    expect(await h.service.lookupByAlias(`${address}@recepcion-stg.vendix.online`)).toEqual(snapshot());
    expect(h.fiscal.findFiscalAccountingEntityId).not.toHaveBeenCalled();
    expect(h.subscriptions.canUseModule).not.toHaveBeenCalled();
    h.setInbox(null);
    expect(await h.service.lookupByAlias(`${address}@recepcion-stg.vendix.online`)).toBeNull();
  });
  it('does not resolve unknown, uppercase, cross-domain or forged envelope aliases', async () => {
    const h = harness();
    expect(await h.service.resolveByAlias('attacker@example.com')).toBeNull();
    expect(await h.service.resolveByAlias(`${address.toUpperCase()}@recepcion-stg.vendix.online`)).toBeNull();
    expect(await h.service.resolveByAlias(`${address}@recepcion.vendix.online`)).toBeNull();
    expect(await h.service.resolveByAlias(`${address}@recepcion-stg.vendix.online`)).toBeNull();
    expect(h.fiscal.findFiscalAccountingEntityId).not.toHaveBeenCalled();
  });
  it('resolves system identity without impersonating the configuring actor and validates production DIAN', async () => {
    const h = harness(); h.setInbox(record());
    const result = await h.service.resolveByAlias(`${address}@recepcion-stg.vendix.online`);
    expect(result).not.toHaveProperty('actor_id');
    expect(h.db.dian_configurations.findFirst).toHaveBeenCalledWith({ where: { organization_id: 3, accounting_entity_id: 8, store_id: null, configuration_type: 'invoicing', environment: 'production', enablement_status: 'enabled' }, select: { nit: true, name: true } });
    expect(h.subscriptions.canUseModule).toHaveBeenCalledWith(21, 'received_documents');
    expect(h.fiscal.findFiscalAccountingEntityId).toHaveBeenCalledWith({ organization_id: 3, store_id: 21, tx: expect.any(Object) });
  });
  it('rejects paused and cross-tenant snapshot work', async () => {
    const h = harness(); h.setInbox(record({ enabled: false }));
    await expect(h.service.revalidateSnapshot(snapshot())).rejects.toMatchObject({ errorCode: 'EMAIL_RECEPTION_PAUSED' });
    h.inbox.findFirst.mockResolvedValueOnce(null);
    await expect(h.service.revalidateSnapshot({ ...snapshot(), organization_id: 99 })).rejects.toMatchObject({ errorCode: 'EMAIL_RECEPTION_FISCAL_GATE' });
    expect(h.inbox.findFirst).toHaveBeenLastCalledWith({ where: { id: 4, organization_id: 99, store_id: 21, accounting_entity_id: 8 }, select: { enabled: true } });
  });
});

describe('email DTO/controller contracts', () => {
  const options = { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: false };
  it('rejects store_id overrides on GET/body and literal false/string booleans', () => {
    expect(validateSync(plainToInstance(DocumentEmailEmptyQueryDto, { store_id: 999 }), options)).not.toHaveLength(0);
    expect(validateSync(plainToInstance(ActivateDocumentEmailInboxDto, { ...activate, store_id: 999 }), options)).not.toHaveLength(0);
    expect(validateSync(plainToInstance(ActivateDocumentEmailInboxDto, { ...activate, consent: 'false' }, { enableImplicitConversion: true }), options)).not.toHaveLength(0);
    expect(validateSync(plainToInstance(UpdateDocumentEmailInboxDto, { expected_version: 1, enabled: 'false' }, { enableImplicitConversion: true }), options)).not.toHaveLength(0);
    expect(validateSync(plainToInstance(RotateDocumentEmailAddressDto, { expected_version: 0, confirmed: false }), options)).not.toHaveLength(0);
  });
  it('controller always resolves read-only context before activation', async () => {
    const contexts = { resolveStoreRead: jest.fn().mockResolvedValue(ctx), resolveStore: jest.fn() };
    const inboxes = { activate: jest.fn().mockResolvedValue({ configured: true }) };
    const response = { success: jest.fn((value) => value) };
    const controller = new StoreDocumentEmailReceptionController(inboxes as never, contexts as never, response as never);
    await controller.activate(activate, {});
    expect(contexts.resolveStoreRead).toHaveBeenCalledTimes(1);
    expect(contexts.resolveStore).not.toHaveBeenCalled();
  });
  it('exports exactly seven states and the complete stable plan reasons', () => {
    expect(DOCUMENT_EMAIL_STATES).toHaveLength(7);
    expect(DOCUMENT_EMAIL_REASON_CODES).toHaveLength(32);
    expect(new Set(DOCUMENT_EMAIL_REASON_CODES).size).toBe(32);
  });
});
