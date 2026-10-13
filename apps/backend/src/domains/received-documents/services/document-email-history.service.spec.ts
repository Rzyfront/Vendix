import { ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DocumentEmailHistoryService } from './document-email-history.service';
import { DiscardDocumentEmailMessageDto, DocumentEmailMessagesQueryDto, DocumentEmailMessageVersionDto } from '../dto/document-email-reception.dto';
import { VendixHttpException } from '../../../common/errors/vendix-http.exception';
import { ErrorCodes } from '../../../common/errors/error-codes';
import type { ReceivedDocumentsReadContext } from './received-documents-context.service';

const ctx: ReceivedDocumentsReadContext = { organization_id: 3, store_id: 21, accounting_entity_id: 8, is_organization: false, fiscal_scope: 'ORGANIZATION', actor_id: 55 };
const alias = 'facturas-00112233445566778899aabbccddeeff';
const base = (overrides = {}) => ({ id: 10, version: 3, inbox_id: 4, organization_id: 3, store_id: 21, accounting_entity_id: 8, local_part: alias, domain: 'recepcion.vendix.online', environment: 'production', recipient_alias: `${alias}@recepcion.vendix.online`, ses_message_id: 'ses-private', sns_message_id: 'sns-private', raw_bucket: 'private-bucket', raw_key: 'raw/private', raw_sha256: 'a'.repeat(64), gmail_code_encrypted: null, gmail_challenge_alias: null, gmail_code_expires_at: null, sender: 'Supplier', subject: 'Invoice', status: 'failed', reason_code: 'TECHNICAL_PROCESSING_ERROR', retryable: true, attempt_count: 1, processing_token: null, processing_started_at: null, processed_at: null, received_at: new Date(), archived_at: null, archived_by: null,
  parts: [{ message_index: 0, ordinal: 1, filename: 'invoice.xml', kind: 'xml', status: 'processed', document_id: 71, originals_checkpoint: [{ stored: true, sha256: 'a'.repeat(64) }], transport_facts: { virus_status: 'PASS', spam_status: 'PASS', gmail_authenticated: false, retry_requested_version: 3 }, body: 'secret-body', bytes: 'secret-bytes' }], ...overrides });
function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (value && typeof value === 'object') {
      if (value.not !== undefined) return row[key] !== value.not;
      if (value.in) return value.in.includes(row[key]);
      if (value.notIn) return !value.notIn.includes(row[key]);
    }
    return row[key] === value;
  });
}
function harness(overrides = {}) {
  const row: any = base(overrides);
  const messages = { findFirst: jest.fn(async ({ where }) => matches(row, where) ? { ...row } : null), findMany: jest.fn().mockResolvedValue([row]), count: jest.fn().mockResolvedValue(1), updateMany: jest.fn(async ({ where, data }) => { if (!matches(row, where)) return { count: 0 }; Object.assign(row, data, { version: row.version + 1 }); return { count: 1 }; }) };
  const prisma: any = { document_reception_email_messages: messages, received_documents: { findMany: jest.fn().mockResolvedValue([{ id: 71 }]) }, audit_logs: { create: jest.fn().mockResolvedValue({ id: 1 }) }, $transaction: jest.fn() };
  prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
  const consumer = { sendInternalRetry: jest.fn().mockResolvedValue(undefined) };
  const service = new DocumentEmailHistoryService(prisma, consumer as never);
  return { service, prisma, consumer, messages, row };
}
const query = () => new DocumentEmailMessagesQueryDto();

describe('DocumentEmailHistoryService', () => {
  it('returns bounded stable paging with explicit organization/store/entity and no secrets', async () => {
    const h = harness(); const result = await h.service.list(ctx, { ...query(), page: 2, limit: 50 });
    expect(h.messages.findMany).toHaveBeenCalledWith({ where: { organization_id: 3, store_id: 21, accounting_entity_id: 8, archived_at: null }, orderBy: [{ received_at: 'desc' }, { id: 'desc' }], skip: 50, take: 50 });
    expect(result).toMatchObject({ total: 1, page: 2, limit: 50, data: [{ id: 10, can_retry: true }] });
    expect(JSON.stringify(result)).not.toMatch(/private-bucket|raw\/private|ses-private|sns-private|facturas-|secret-body|secret-bytes|transport_facts|originals_checkpoint|retry_requested_version/);
  });
  it('filters archived-only history explicitly and keeps No procesados unarchived', async () => {
    const h = harness(); await h.service.list(ctx, { ...query(), archived: true });
    expect(h.messages.findMany.mock.calls[0][0].where.archived_at).toEqual({ not: null });
    await h.service.list(ctx, { ...query(), archived: true, view: 'not_processed' });
    expect(h.messages.findMany.mock.calls[1][0].where).toMatchObject({ archived_at: null, status: { in: ['received', 'processing', 'partial', 'not_processed', 'failed'] } });
  });
  it('drops hidden document IDs and validates visibility against all tenant fields', async () => {
    const h = harness(); h.prisma.received_documents.findMany.mockResolvedValueOnce([]);
    const result = await h.service.detail(ctx, 10); expect(result.parts[0]).not.toHaveProperty('document_id');
    expect(h.prisma.received_documents.findMany).toHaveBeenCalledWith({ where: { organization_id: 3, store_id: 21, accounting_entity_id: 8, id: { in: [71] } }, select: { id: true } });
    h.row.parts[0].reason_code = 'DUPLICATE_OTHER_STORE'; expect((await h.service.detail(ctx, 10)).parts[0]).not.toHaveProperty('document_id');
  });
  it('exposes only the two bounded receiver identity details needed for corrective copy', async () => {
    const h = harness(); h.row.parts[0].reason_details = { receiver_tax_id: '900123456-8', expected_receiver_tax_id: '901999999', raw_error: 'private', other_store_id: 99 };
    expect((await h.service.detail(ctx, 10)).parts[0].reason_details).toEqual({ receiver_tax_id: '900123456-8', expected_receiver_tax_id: '901999999' });
    h.row.parts[0].reason_details = { receiver_tax_id: '<script>', expected_receiver_tax_id: '1'.repeat(51) };
    expect((await h.service.detail(ctx, 10)).parts[0]).not.toHaveProperty('reason_details');
  });
  it('Gmail history never exposes codes, even through filename or subject metadata', async () => {
    const h = harness({ reason_code: 'GMAIL_VERIFICATION_CODE', status: 'ignored', gmail_code_encrypted: 'secret-cipher', subject: 'Confirmation code: 123456789', parts: [{ message_index: 0, ordinal: 1, filename: 'code-123456789.txt', kind: 'other', status: 'ignored' }] });
    const result = await h.service.detail(ctx, 10); expect(result.subject).toBe('Confirmación de reenvío de Gmail'); expect(result.parts).toEqual([]); expect(JSON.stringify(result)).not.toMatch(/123456789|secret-cipher/);
  });
  it('read-only expired raw projects RAW_EXPIRED and disables retry without updating records', async () => {
    const h = harness({ received_at: new Date(Date.now() - 31 * 86_400_000) }); const result = await h.service.detail(ctx, 10);
    expect(result).toMatchObject({ reason_code: 'RAW_EXPIRED', can_retry: false }); expect(h.row.reason_code).toBe('TECHNICAL_PROCESSING_ERROR'); expect(h.messages.updateMany).not.toHaveBeenCalled();
  });
  it('rejects IDOR across store/org/entity without returning any metadata', async () => {
    const h = harness();
    for (const other of [{ ...ctx, store_id: 22 }, { ...ctx, organization_id: 99 }, { ...ctx, accounting_entity_id: 9 }]) await expect(h.service.detail(other, 10)).rejects.toMatchObject({ errorCode: 'SYS_NOT_FOUND_001' });
    expect(h.prisma.received_documents.findMany).not.toHaveBeenCalled();
  });
  it('reads do not create/resolve entities or gate subscriptions; missing entity returns empty', async () => {
    const h = harness(); expect(await h.service.list({ ...ctx, accounting_entity_id: null }, query())).toEqual({ data: [], total: 0, page: 1, limit: 25 });
    expect(h.messages.findMany).not.toHaveBeenCalled(); expect(h.consumer.sendInternalRetry).not.toHaveBeenCalled();
    await expect(h.service.detail({ ...ctx, is_organization: true }, 10)).rejects.toMatchObject({ errorCode: 'SYS_FORBIDDEN_001' });
  });
  it('archives with actor/CAS audit, preserves status/originals and is idempotent for an already archived row', async () => {
    const h = harness(); const originalParts = h.row.parts;
    const result = await h.service.discard(ctx, 10, { expected_version: 3 });
    expect(result).toMatchObject({ status: 'failed', version: 4, can_retry: false, archived_at: expect.any(Date) });
    expect(h.row.parts).toBe(originalParts); expect(h.row.raw_key).toBe('raw/private');
    expect(h.prisma.audit_logs.create).toHaveBeenCalledWith({ data: expect.objectContaining({ organization_id: 3, store_id: 21, user_id: 55, resource_id: 10, metadata: { reason: 'Archivado por el usuario' } }) });
    expect((await h.service.discard(ctx, 10, { expected_version: 3 })).version).toBe(4); expect(h.messages.updateMany).toHaveBeenCalledTimes(1);
  });
  it.each([{ status: 'received' }, { status: 'processing' }, { processing_token: 'active-owner' }, { version: 9 }])('rejects non-final or stale archive %j without invalidating worker ownership', async (overrides) => {
    const h = harness(overrides); await expect(h.service.discard(ctx, 10, { expected_version: 3 })).rejects.toMatchObject({ errorCode: 'EMAIL_RECEPTION_VERSION_CONFLICT' }); expect(h.messages.updateMany).not.toHaveBeenCalled();
  });
  it('requests only a technical safe retry via the trusted snapshot and expected CAS version', async () => {
    const h = harness({ status: 'partial' }); expect(await h.service.retry(ctx, 10, { expected_version: 3 })).toEqual({ id: 10, version: 4, requested: true });
    expect(h.consumer.sendInternalRetry).toHaveBeenCalledWith(10, 3, { inbox_id: 4, organization_id: 3, store_id: 21, accounting_entity_id: 8, local_part: alias, domain: 'recepcion.vendix.online', environment: 'production' });
  });
  it.each([{ reason_code: 'TEST_DOCUMENT' }, { processed_at: new Date() }, { archived_at: new Date() }, { received_at: new Date(Date.now() - 31 * 86_400_000) }, { parts: [{ transport_facts: { virus_status: 'FAIL', spam_status: 'PASS' } }] }])('rejects unsafe or ineligible retry %j without enqueue', async (overrides) => {
    const h = harness(overrides); await expect(h.service.retry(ctx, 10, { expected_version: 3 })).rejects.toMatchObject({ errorCode: 'EMAIL_RECEPTION_VERSION_CONFLICT' }); expect(h.consumer.sendInternalRetry).not.toHaveBeenCalled();
  });
  it('preserves real HTTP 409/503 on CAS race or SDK error instead of returning success:false', async () => {
    const h = harness(); h.consumer.sendInternalRetry.mockRejectedValueOnce(new VendixHttpException(ErrorCodes.EMAIL_RECEPTION_VERSION_CONFLICT));
    await expect(h.service.retry(ctx, 10, { expected_version: 3 })).rejects.toMatchObject({ status: 409, errorCode: 'EMAIL_RECEPTION_VERSION_CONFLICT' });
    h.consumer.sendInternalRetry.mockRejectedValueOnce(new Error('SDK pointer secret'));
    await expect(h.service.retry(ctx, 10, { expected_version: 3 })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('requires an actor for archival/retry but not read; rejects oversized paging', async () => {
    const h = harness(); await expect(h.service.discard({ ...ctx, actor_id: undefined }, 10, { expected_version: 3 })).rejects.toMatchObject({ errorCode: 'SYS_FORBIDDEN_001' });
    await expect(h.service.list(ctx, { ...query(), limit: 51 })).rejects.toMatchObject({ errorCode: 'SYS_VALIDATION_001' });
  });
});

describe('email history request DTOs', () => {
  const options = { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: false };
  it('strictly parses archived=true/false and rejects forged scope, pointers and malformed versions', () => {
    expect(plainToInstance(DocumentEmailMessagesQueryDto, { archived: 'false' }, { enableImplicitConversion: true }).archived).toBe(false);
    expect(plainToInstance(DocumentEmailMessagesQueryDto, { archived: 'true' }, { enableImplicitConversion: true }).archived).toBe(true);
    expect(validateSync(plainToInstance(DocumentEmailMessagesQueryDto, { archived: 'yes' }, { enableImplicitConversion: true }), options)).not.toHaveLength(0);
    expect(validateSync(plainToInstance(DocumentEmailMessagesQueryDto, { store_id: 999, limit: 51 }), options)).not.toHaveLength(0);
    expect(validateSync(plainToInstance(DocumentEmailMessageVersionDto, { expected_version: 1, raw_key: 'unsafe' }), options)).not.toHaveLength(0);
    expect(validateSync(plainToInstance(DiscardDocumentEmailMessageDto, { expected_version: 0, reason: 'x'.repeat(256) }), options)).not.toHaveLength(0);
  });
});
