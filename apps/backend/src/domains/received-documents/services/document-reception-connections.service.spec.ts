import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RequestContextService } from '../../../common/context/request-context.service';
import { ErrorCodes } from '../../../common/errors/error-codes';
import { EncryptionService } from '../../../common/services/encryption.service';
import { DocumentReceptionHttpService } from './document-reception-http.service';
import { DocumentReceptionConnectionsService } from './document-reception-connections.service';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';
import { CreateDocumentReceptionConnectionDto, UpdateDocumentReceptionConnectionDto } from '../dto/document-reception-connection.dto';

const orgStoreContext: ReceivedDocumentsContext = {
  organization_id: 3,
  accounting_entity_id: 8,
  store_id: 21,
  actor_id: 55,
  is_organization: true,
};

const connectionRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 41,
  version: 1,
  organization_id: 3,
  store_id: 21,
  accounting_entity_id: 8,
  created_by: 55,
  public_token: 'a-public-hook-token',
  lease_token: null,
  lease_expires_at: null,
  name: 'Supplier inbox',
  connection_type: 'api_poll',
  enabled: true,
  endpoint: 'https://supplier.example.com/api/inbox',
  encrypted_secret: 'ciphertext-not-returned',
  settings: { arbitrary_secret: 'never-return-this' },
  cursor: 'opaque-cursor-secret',
  poll_interval_minutes: 15,
  next_sync_at: new Date('2026-10-01T00:00:00.000Z'),
  last_synced_at: new Date('2026-09-30T00:00:00.000Z'),
  last_error: 'provider token leaked in raw exception',
  created_at: new Date('2026-09-01T00:00:00.000Z'),
  updated_at: new Date('2026-09-30T00:00:00.000Z'),
  ...overrides,
});

function harness() {
  const delegate = {
    create: jest.fn().mockImplementation(async ({ data }: any) => connectionRecord(data)),
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const runDelegate = {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };
  const auditDelegate = { create: jest.fn().mockResolvedValue({ id: 7 }) };
  const prisma: any = {
    document_reception_connections: delegate,
    document_reception_runs: runDelegate,
    audit_logs: auditDelegate,
    $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
  };
  const receivedDocuments = { assertContext: jest.fn().mockResolvedValue(undefined) };
  const encryption = { encrypt: jest.fn((value: string) => `sealed:${value}`), decrypt: jest.fn() };
  const http = { validateEndpoint: jest.fn() };
  const service = new DocumentReceptionConnectionsService(
    prisma,
    receivedDocuments as unknown as ReceivedDocumentsService,
    encryption as unknown as EncryptionService,
    http as unknown as DocumentReceptionHttpService,
  );
  return { service, prisma, delegate, runDelegate, auditDelegate, receivedDocuments, encryption, http };
}

describe('DocumentReceptionConnectionsService', () => {
  it('creates API-poll settings only for the authenticated operational store and returns no secrets', async () => {
    const h = harness();
    const result = await h.service.create(orgStoreContext, {
      name: '  Supplier  ', connection_type: 'api_poll', enabled: true,
      endpoint: 'https://supplier.example.com/api/inbox', secret: 'clear-bearer-secret', poll_interval_minutes: 30,
      organization_id: 999, accounting_entity_id: 888, store_id: 777, cursor: 'attacker-cursor', settings: { forged: true },
    } as any);
    expect(h.receivedDocuments.assertContext).toHaveBeenCalledWith(orgStoreContext);
    expect(h.http.validateEndpoint).toHaveBeenCalledWith('https://supplier.example.com/api/inbox');
    expect(h.encryption.encrypt).toHaveBeenCalledWith('clear-bearer-secret');
    expect(h.delegate.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      organization_id: 3, accounting_entity_id: 8, store_id: 21, created_by: 55,
      name: 'Supplier', connection_type: 'api_poll', endpoint: 'https://supplier.example.com/api/inbox',
      encrypted_secret: 'sealed:clear-bearer-secret', cursor: null, poll_interval_minutes: 30,
      next_sync_at: expect.any(Date),
    }) });
    const data = h.delegate.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('settings');
    expect(data).not.toHaveProperty('cursor', 'attacker-cursor');
    expect(JSON.stringify(result)).not.toContain('clear-bearer-secret');
    expect(JSON.stringify(result)).not.toContain('sealed:clear-bearer-secret');
    expect(JSON.stringify(result)).not.toContain('opaque-cursor-secret');
    expect(JSON.stringify(result)).not.toContain('never-return-this');
    expect(result).toMatchObject({ id: 41, name: 'Supplier', store_id: 21, accounting_entity_id: 8, has_secret: true, endpoint: 'https://supplier.example.com/api/inbox' });
    expect(result).not.toHaveProperty('public_token');
    expect(h.encryption.decrypt).not.toHaveBeenCalled();
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    const audit = h.auditDelegate.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({
      user_id: 55, store_id: 21, organization_id: 3, action: 'CREATE',
      resource: 'document_reception_connections', resource_id: 41,
      new_values: {
        version: 1, connection_type: 'api_poll', enabled: true, poll_interval_minutes: 30,
        has_secret: true, store_id: 21, accounting_entity_id: 8, name: 'Supplier',
      },
    });
    expect(audit.old_values).toBeUndefined();
    const serializedAudit = JSON.stringify(audit);
    for (const privateValue of ['clear-bearer-secret', 'sealed:clear-bearer-secret', 'supplier.example.com', 'opaque-cursor-secret', 'never-return-this']) {
      expect(serializedAudit).not.toContain(privateValue);
    }
  });

  it('writes audit identity from explicit context and bounds request_id from ALS storage', async () => {
    const h = harness();
    await RequestContextService.runIsolated({
      is_super_admin: false, is_owner: false, user_id: 999, organization_id: 999, store_id: 999,
      request_id: 'request-from-als',
    }, () => h.service.create(orgStoreContext, {
      name: 'Inbox', connection_type: 'webhook', secret: 'hmac-secret',
    } as any));
    expect(h.auditDelegate.create.mock.calls[0][0].data).toMatchObject({
      user_id: 55, organization_id: 3, store_id: 21, request_id: 'request-from-als',
    });

    for (const requestId of [undefined, 'x'.repeat(101)]) {
      const h2 = harness();
      await RequestContextService.runIsolated({ is_super_admin: false, is_owner: false, request_id: requestId }, () =>
        h2.service.create(orgStoreContext, { name: 'Inbox', connection_type: 'webhook', secret: 'hmac-secret' } as any));
      expect(h2.auditDelegate.create.mock.calls[0][0].data.request_id).toBeNull();
    }
  });

  it('requires a selected operational store for creation, even under organization fiscal scope', async () => {
    const h = harness();
    await expect(h.service.create({ ...orgStoreContext, store_id: null }, {
      name: 'Inbox', connection_type: 'webhook', enabled: false,
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.delegate.create).not.toHaveBeenCalled();

    const noActor = harness();
    await expect(noActor.service.create({ ...orgStoreContext, actor_id: undefined }, {
      name: 'Webhook', connection_type: 'webhook', secret: 'hmac-secret',
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(noActor.delegate.create).not.toHaveBeenCalled();
  });

  it('requires API endpoint and secret and disallows polling endpoints for webhook configuration', async () => {
    const missingEndpoint = harness();
    await expect(missingEndpoint.service.create(orgStoreContext, {
      name: 'API', connection_type: 'api_poll', secret: 'secret',
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(missingEndpoint.delegate.create).not.toHaveBeenCalled();

    const missingSecret = harness();
    await expect(missingSecret.service.create(orgStoreContext, {
      name: 'API', connection_type: 'api_poll', endpoint: 'https://supplier.example.com/api',
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(missingSecret.delegate.create).not.toHaveBeenCalled();

    const webhookEndpoint = harness();
    await expect(webhookEndpoint.service.create(orgStoreContext, {
      name: 'Webhook', connection_type: 'webhook', endpoint: 'https://supplier.example.com/hook',
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(webhookEndpoint.http.validateEndpoint).not.toHaveBeenCalled();
  });

  it('returns public token and hook path only for webhooks, with no endpoint/settings/secret', async () => {
    const h = harness();
    h.delegate.create.mockImplementationOnce(async ({ data }: any) => connectionRecord({
      ...data, connection_type: 'webhook', endpoint: null,
    }));
    const result = await h.service.create(orgStoreContext, {
      name: 'Webhook', connection_type: 'webhook', enabled: true, secret: 'hmac-secret',
    } as any);
    const persistedToken = h.delegate.create.mock.calls[0][0].data.public_token;
    expect(result).toMatchObject({
      connection_type: 'webhook', public_token: persistedToken,
      webhook_path: `/public/received-documents/webhook/${persistedToken}`, has_secret: true,
      next_sync_at: null,
    });
    expect(persistedToken).toEqual(expect.any(String));
    expect(persistedToken).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result).not.toHaveProperty('endpoint');
    expect(result).not.toHaveProperty('settings');
    expect(result).not.toHaveProperty('encrypted_secret');
  });

  it('lists only the explicit organization/entity/selected-store slice; no-store organization lists the entity', async () => {
    const h = harness();
    h.delegate.findMany.mockResolvedValueOnce([connectionRecord()]);
    await h.service.list(orgStoreContext, { page: 2, limit: 10 } as any);
    expect(h.delegate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organization_id: 3, accounting_entity_id: 8, store_id: 21 }, skip: 10, take: 10,
    }));
    await h.service.list({ ...orgStoreContext, store_id: null }, { page: 1, limit: 25 } as any);
    expect(h.delegate.findMany.mock.calls[1][0].where).toEqual({ organization_id: 3, accounting_entity_id: 8 });
  });

  it('returns the same not-found result for a foreign connection and validates context first', async () => {
    const h = harness();
    h.delegate.findFirst.mockResolvedValue(null);
    await expect(h.service.findOne(orgStoreContext, 999)).rejects.toBeInstanceOf(NotFoundException);
    expect(h.delegate.findFirst).toHaveBeenCalledWith({ where: { id: 999, organization_id: 3, accounting_entity_id: 8, store_id: 21 } });
    expect(h.receivedDocuments.assertContext).toHaveBeenCalledWith(orgStoreContext);
  });

  it('requires a scoped parent connection before returning run history', async () => {
    const h = harness();
    h.delegate.findFirst.mockResolvedValue(null);
    await expect(h.service.listRuns(orgStoreContext, 999, { page: 1, limit: 10 } as any))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(h.delegate.findFirst).toHaveBeenCalledWith({
      where: { id: 999, organization_id: 3, accounting_entity_id: 8, store_id: 21 },
    });
    expect(h.runDelegate.findMany).not.toHaveBeenCalled();
  });

  it('rejects stale versions and actively leased records without mutation', async () => {
    const stale = harness();
    stale.delegate.findFirst.mockResolvedValueOnce(connectionRecord({ version: 4 }));
    await expect(stale.service.update(orgStoreContext, 41, { expected_version: 3, name: 'new' } as any)).rejects.toBeInstanceOf(ConflictException);
    expect(stale.delegate.updateMany).not.toHaveBeenCalled();
    expect(stale.auditDelegate.create).not.toHaveBeenCalled();

    const leased = harness();
    leased.delegate.findFirst.mockResolvedValueOnce(connectionRecord({ lease_token: 'held', lease_expires_at: new Date(Date.now() + 60_000) }));
    await expect(leased.service.update(orgStoreContext, 41, { expected_version: 1, name: 'new' } as any)).rejects.toBeInstanceOf(ConflictException);
    expect(leased.delegate.updateMany).not.toHaveBeenCalled();
    expect(leased.auditDelegate.create).not.toHaveBeenCalled();

    const noActor = harness();
    await expect(noActor.service.update({ ...orgStoreContext, actor_id: undefined }, 41, { expected_version: 1, name: 'new' } as any))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(noActor.delegate.findFirst).not.toHaveBeenCalled();
    expect(noActor.delegate.updateMany).not.toHaveBeenCalled();
  });

  it('rotates secrets encrypted, clears the opaque cursor and schedules an immediate sync', async () => {
    const h = harness();
    h.delegate.findFirst
      .mockResolvedValueOnce(connectionRecord())
      .mockResolvedValueOnce(connectionRecord({ version: 2, cursor: null, encrypted_secret: 'sealed:rotated-secret', next_sync_at: new Date() }));
    const result = await h.service.update(orgStoreContext, 41, { expected_version: 1, secret: 'rotated-secret' } as any);
    expect(h.encryption.encrypt).toHaveBeenCalledWith('rotated-secret');
    expect(h.delegate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 41, organization_id: 3, accounting_entity_id: 8, store_id: 21, version: 1,
        OR: [{ lease_token: null }, { lease_expires_at: { lte: expect.any(Date) } }] }),
      data: expect.objectContaining({ encrypted_secret: 'sealed:rotated-secret', cursor: null, version: { increment: 1 }, next_sync_at: expect.any(Date) }),
    }));
    expect(JSON.stringify(result)).not.toContain('rotated-secret');
    expect(JSON.stringify(result)).not.toContain('sealed:rotated-secret');
    expect(JSON.stringify(result)).not.toContain('opaque-cursor-secret');
    const audit = h.auditDelegate.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({
      action: 'UPDATE', resource: 'document_reception_connections',
      old_values: { version: 1, connection_type: 'api_poll', has_secret: true, name: 'Supplier inbox' },
      new_values: { version: 2, connection_type: 'api_poll', has_secret: true, name: 'Supplier inbox' },
      metadata: { credential_rotated: true, endpoint_changed: false },
    });
    expect(JSON.stringify(audit)).not.toContain('rotated-secret');
    expect(JSON.stringify(audit)).not.toContain('ciphertext-not-returned');
    expect(JSON.stringify(audit)).not.toContain('opaque-cursor-secret');
  });

  it('preserves cursor and next sync on name/interval changes; null secret does not clear credentials', async () => {
    const h = harness();
    h.delegate.findFirst
      .mockResolvedValueOnce(connectionRecord())
      .mockResolvedValueOnce(connectionRecord({ version: 2, name: 'Renamed', poll_interval_minutes: 60 }));
    await h.service.update(orgStoreContext, 41, { expected_version: 1, name: 'Renamed', poll_interval_minutes: 60 } as any);
    const data = h.delegate.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ name: 'Renamed', poll_interval_minutes: 60, version: { increment: 1 } });
    expect(data).not.toHaveProperty('cursor');
    expect(data).not.toHaveProperty('next_sync_at');
    expect(h.encryption.encrypt).not.toHaveBeenCalled();

    const nullSecret = harness();
    nullSecret.delegate.findFirst.mockResolvedValueOnce(connectionRecord());
    await expect(nullSecret.service.update(orgStoreContext, 41, { expected_version: 1, secret: null } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(nullSecret.delegate.updateMany).not.toHaveBeenCalled();
  });

  it('fails config mutations with a generic 503 when durable audit insertion fails', async () => {
    const create = harness();
    create.auditDelegate.create.mockRejectedValueOnce(new Error('secret endpoint and credential in database error'));
    const createFailure = await create.service.create(orgStoreContext, {
      name: 'Inbox', connection_type: 'webhook', secret: 'private-hmac-secret',
    } as any).catch((error) => error);
    expect(createFailure).toBeInstanceOf(ServiceUnavailableException);
    expect(createFailure.message).toBe('No fue posible registrar de forma segura el cambio de configuración.');
    expect(createFailure.message).not.toContain('credential');

    const update = harness();
    update.delegate.findFirst
      .mockResolvedValueOnce(connectionRecord())
      .mockResolvedValueOnce(connectionRecord({ version: 2, name: 'Renamed' }));
    update.auditDelegate.create.mockRejectedValueOnce(new Error('private provider details'));
    const updateFailure = await update.service.update(orgStoreContext, 41, { expected_version: 1, name: 'Renamed' } as any).catch((error) => error);
    expect(updateFailure).toBeInstanceOf(ServiceUnavailableException);
    expect(updateFailure.message).not.toContain('private provider details');
  });

  it('returns only sanitized run summaries and scopes run lookup through the parent connection', async () => {
    const h = harness();
    h.delegate.findFirst.mockResolvedValueOnce(connectionRecord());
    h.runDelegate.findMany.mockResolvedValueOnce([{
      id: 90, connection_id: 41, status: 'completed', trigger: 'scheduler',
      received_count: 3, duplicate_count: 1, error_count: 1,
      cursor_before: 'cursor-secret-a', cursor_after: 'cursor-secret-b',
      summary: {
        counts: { received: 3, errors: 1, secret: 8 },
        document_ids: [50, 0, -1, 51],
        error_codes: [ErrorCodes.SUBSCRIPTION_006.code, 'raw provider secret'],
        bearer_token: 'never expose arbitrary JSON',
      },
      started_at: new Date(), finished_at: new Date(), created_at: new Date(), updated_at: new Date(),
    }]);
    const result = await h.service.listRuns(orgStoreContext, 41, { page: 1, limit: 10 } as any);
    expect(h.runDelegate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { connection_id: 41, connection: { organization_id: 3, accounting_entity_id: 8, store_id: 21 } },
    }));
    expect(result.data[0]).toMatchObject({
      received_count: 3, duplicate_count: 1, error_count: 1,
      cursor_before_present: true, cursor_after_present: true,
      summary: { counts: { received: 3, errors: 1 }, document_ids: [50, 51], error_codes: [ErrorCodes.SUBSCRIPTION_006.code] },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('cursor-secret');
    expect(serialized).not.toContain('bearer_token');
    expect(serialized).not.toContain('raw provider secret');
  });

  it('requires webhook HMAC secrets and DTO validation rejects null writes and tenant mass assignment', async () => {
    const noSecret = harness();
    await expect(noSecret.service.create(orgStoreContext, {
      name: 'Webhook', connection_type: 'webhook', enabled: true,
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(noSecret.delegate.create).not.toHaveBeenCalled();

    const createNulls = plainToInstance(CreateDocumentReceptionConnectionDto, {
      name: 'Inbox', connection_type: 'api_poll', secret: null, endpoint: null,
      enabled: null, poll_interval_minutes: null,
    });
    const createErrors = validateSync(createNulls, { whitelist: true, forbidNonWhitelisted: true });
    expect(createErrors.map((error) => error.property)).toEqual(expect.arrayContaining(['secret', 'endpoint', 'enabled', 'poll_interval_minutes']));

    const updateNulls = plainToInstance(UpdateDocumentReceptionConnectionDto, {
      expected_version: 1, secret: null, endpoint: null, enabled: null,
      poll_interval_minutes: null,
    });
    const updateErrors = validateSync(updateNulls, { whitelist: true, forbidNonWhitelisted: true });
    expect(updateErrors.map((error) => error.property)).toEqual(expect.arrayContaining(['secret', 'endpoint', 'enabled', 'poll_interval_minutes']));

    const forged = plainToInstance(CreateDocumentReceptionConnectionDto, {
      name: 'Inbox', connection_type: 'api_poll', secret: 's', endpoint: 'https://supplier.example.com',
      organization_id: 9, store_id: 99, accounting_entity_id: 88, cursor: 'forged', version: 500,
    });
    const massAssignmentErrors = validateSync(forged, { whitelist: true, forbidNonWhitelisted: true });
    expect(massAssignmentErrors.map((error) => error.property)).toEqual(expect.arrayContaining([
      'organization_id', 'store_id', 'accounting_entity_id', 'cursor', 'version',
    ]));
  });

  it('rejects implicitly coercible booleans and non-string names, endpoints and secrets', () => {
    for (const value of ['false', 'true', 0, 1]) {
      const create = plainToInstance(CreateDocumentReceptionConnectionDto, {
        name: 'Inbox', connection_type: 'api_poll', endpoint: 'https://supplier.example.com', secret: 'secret', enabled: value,
      }, { enableImplicitConversion: true });
      expect(create.enabled).toBe(value);
      expect(validateSync(create).find((error) => error.property === 'enabled')?.constraints).toHaveProperty('isBoolean');

      const update = plainToInstance(UpdateDocumentReceptionConnectionDto, {
        expected_version: 1, enabled: value,
      }, { enableImplicitConversion: true });
      expect(update.enabled).toBe(value);
      expect(validateSync(update).find((error) => error.property === 'enabled')?.constraints).toHaveProperty('isBoolean');
    }

    const create = plainToInstance(CreateDocumentReceptionConnectionDto, {
      name: 123, connection_type: 'api_poll', endpoint: 456, secret: 789,
    }, { enableImplicitConversion: true });
    expect(create.name).toBe(123);
    expect(create.endpoint).toBe(456);
    expect(create.secret).toBe(789);
    expect(validateSync(create).map((error) => error.property)).toEqual(expect.arrayContaining(['name', 'endpoint', 'secret']));

    const update = plainToInstance(UpdateDocumentReceptionConnectionDto, {
      expected_version: 1, name: 123, endpoint: 456, secret: 789,
    }, { enableImplicitConversion: true });
    expect(update.name).toBe(123);
    expect(update.endpoint).toBe(456);
    expect(update.secret).toBe(789);
    expect(validateSync(update).map((error) => error.property)).toEqual(expect.arrayContaining(['name', 'endpoint', 'secret']));
  });
});
