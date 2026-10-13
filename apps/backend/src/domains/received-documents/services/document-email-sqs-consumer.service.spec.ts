import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { DocumentEmailSqsConsumerService } from './document-email-sqs-consumer.service';
import type { DocumentEmailProcessorResult, DocumentEmailSnapshot } from '../interfaces/document-email-reception.interface';

const alias = 'facturas-00112233445566778899aabbccddeeff';
const domain = 'recepcion.vendix.online';
const snapshot: DocumentEmailSnapshot = { inbox_id: 4, organization_id: 3, store_id: 21, accounting_entity_id: 8, local_part: alias, domain, environment: 'production' };
const topic = 'arn:aws:sns:us-east-1:123456789012:email-reception-fixture-prod';
const bucket = 'vendix-email-fixture-prod';
const facts = { virus_status: 'PASS', spam_status: 'PASS', gmail_authenticated: false };
const success: DocumentEmailProcessorResult = { status: 'processed', reason_code: null, retryable: false, parts: [], valid_document: true };
const envelope = (change: (notification: any, envelope: any) => void = () => {}) => {
  const notification: any = { notificationType: 'Received', mail: { messageId: 'synthetic-ses-invoice', destination: ['attacker@example.invalid'], commonHeaders: { from: ['Supplier <supplier@example.invalid>'], subject: 'Example', messageId: '<untrusted@example.invalid>' } },
    receipt: { timestamp: new Date().toISOString(), recipients: [`${alias}@${domain}`], virusVerdict: { status: 'PASS' }, spamVerdict: { status: 'PASS' }, dkimVerdict: { status: 'PASS' }, dmarcVerdict: { status: 'PASS' }, action: { type: 'S3', topicArn: topic, bucketName: bucket, objectKey: 'raw/synthetic-ses-invoice' } } };
  const wrapper: any = { Type: 'Notification', MessageId: 'sns-message', TopicArn: topic, Message: '' };
  change(notification, wrapper); wrapper.Message = JSON.stringify(notification); return JSON.stringify(wrapper);
};
function cloneRecord(value: any): any {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(cloneRecord);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneRecord(item)]));
  return value;
}
function matches(record: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([field, wanted]: [string, any]) => {
    if (field === 'AND') return wanted.every((query: any) => matches(record, query));
    if (field === 'OR') return wanted.some((query: any) => matches(record, query));
    const value = record[field];
    if (wanted == null || typeof wanted !== 'object' || wanted instanceof Date) return value === wanted;
    return Object.entries(wanted).every(([operator, operand]: [string, any]) => {
      if (operator === 'not') return value !== operand;
      if (operator === 'in') return operand.includes(value);
      if (operator === 'lte') return value != null && value <= operand;
      if (operator === 'lt') return value != null && value < operand;
      if (operator === 'gte') return value != null && value >= operand;
      return false;
    });
  });
}
function harness(configOverrides = {}) {
  const rows = new Map<number, any>(); let nextId = 1;
  const inboxRow: any = { ...snapshot, id: 4, enabled: true, version: 1, last_email_at: null, first_valid_received_at: null, last_valid_received_at: null };
  const message = {
    findFirst: jest.fn(async ({ where }) => cloneRecord([...rows.values()].find((row) => matches(row, where)) ?? null)),
    findMany: jest.fn(async ({ where }) => [...rows.values()].filter((row) => matches(row, where)).map((row) => cloneRecord(row))),
    create: jest.fn(async ({ data }) => {
      const row = { id: nextId++, version: 1, raw_bytes: null, raw_sha256: null, status: 'received', reason_code: null, retryable: false, attempt_count: 0, processed_at: null, processing_token: null, processing_started_at: null, archived_at: null, ...data };
      rows.set(row.id, row); return cloneRecord(row);
    }),
    aggregate: jest.fn(async ({ where }) => {
      const found = [...rows.values()].filter((row) => matches(row, where));
      return { _count: { _all: found.length }, _sum: { raw_bytes: found.reduce((sum, row) => sum + (row.raw_bytes ?? 0), 0) } };
    }),
    updateMany: jest.fn(async ({ where, data }) => {
      const found = [...rows.values()].filter((row) => matches(row, where));
      for (const row of found) for (const [key, value] of Object.entries(data) as Array<[string, any]>) row[key] = value?.increment != null ? row[key] + value.increment : value;
      return { count: found.length };
    }),
  };
  const inbox = {
    findFirst: jest.fn(async ({ where }) => matches(inboxRow, where) ? cloneRecord(inboxRow) : null),
    updateMany: jest.fn(async ({ where, data }) => { if (!matches(inboxRow, where)) return { count: 0 }; Object.assign(inboxRow, data); return { count: 1 }; }),
  };
  const prisma: any = { document_reception_email_messages: message, document_reception_email_inboxes: inbox, $queryRaw: jest.fn().mockResolvedValue([]), $transaction: jest.fn() };
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
  const configValues: any = { NODE_ENV: 'development', EMAIL_RECEPTION_ENABLED: 'true', EMAIL_RECEPTION_ENVIRONMENT: 'production', EMAIL_RECEPTION_DOMAIN: domain, EMAIL_RECEPTION_SNS_TOPIC_ARN: topic, EMAIL_RECEPTION_RAW_BUCKET: bucket, EMAIL_RECEPTION_SQS_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123456789012/email-reception-production', ...configOverrides };
  const config = { get: jest.fn((key, fallback) => configValues[key] ?? fallback) };
  const inboxes = { lookupByAlias: jest.fn(async (recipient) => recipient === `${alias}@${domain}` ? snapshot : null), revalidateSnapshot: jest.fn().mockResolvedValue({ ...snapshot, recipient_alias: `${alias}@${domain}`, fiscal_scope: 'ORGANIZATION', fiscal_identity: { nit: '900123456', nit_type: 'NIT' } }) };
  const processor = { processEmail: jest.fn().mockResolvedValue(success) };
  const service = new DocumentEmailSqsConsumerService(prisma, config as unknown as ConfigService, inboxes as never, processor);
  const transport = { receipt_handle: 'local-receipt', readRaw: jest.fn().mockImplementation(async () => Readable.from([Buffer.from('synthetic raw')])), delete: jest.fn().mockResolvedValue(undefined), renew: jest.fn().mockResolvedValue(undefined), sendRetry: jest.fn().mockResolvedValue(undefined), tagRaw: jest.fn().mockResolvedValue(undefined) };
  return { rows, inboxRow, message, inbox, prisma, config, configValues, inboxes, processor, service, transport };
}
async function receive(h: ReturnType<typeof harness>, body = envelope()) { return h.service.handleDelivery(body, h.transport); }
const row = (h: ReturnType<typeof harness>) => [...h.rows.values()][0];

describe('DocumentEmailSqsConsumerService durable SQS protocol', () => {
  it('registers before IO, checkpoints actual bytes/hash, then commits complete originals before ACK', async () => {
    const h = harness();
    h.transport.readRaw.mockImplementationOnce(async () => { expect(row(h).status).toBe('processing'); expect(row(h).inbox_id).toBe(4); return Readable.from([Buffer.from('synthetic raw')]); });
    h.transport.delete.mockImplementationOnce(async () => { expect(row(h).processed_at).toBeInstanceOf(Date); expect(h.inboxRow.first_valid_received_at).toBeInstanceOf(Date); });
    expect(await receive(h)).toEqual({ acknowledged: true, handled: 1 });
    expect(row(h)).toMatchObject({ raw_bytes: Buffer.byteLength('synthetic raw'), raw_sha256: createHash('sha256').update('synthetic raw').digest('hex'), status: 'processed', attempt_count: 1, retryable: false, version: 3 });
    expect(h.processor.processEmail).toHaveBeenCalledWith(expect.objectContaining({ message_id: 1, context: expect.not.objectContaining({ actor_id: expect.anything() }), before_write: expect.any(Function), signal: expect.any(AbortSignal) }));
    expect(row(h).parts[0].transport_facts).toEqual(facts);
  });
  it('deduplicates SES+recipient but never uses RFC Message-ID or SNS Message-ID as unique', async () => {
    const h = harness(); await receive(h); await receive(h, envelope((_n, wrapper) => { wrapper.MessageId = 'another-sns-id'; }));
    expect(h.rows.size).toBe(1); expect(h.transport.readRaw).toHaveBeenCalledTimes(1); expect(h.transport.delete).toHaveBeenCalledTimes(2);
    await receive(h, envelope((n) => { n.mail.messageId = 'second-delivery'; n.receipt.action.objectKey = 'raw/second-delivery'; }));
    expect(h.rows.size).toBe(2); expect([...h.rows.values()].map((r) => r.rfc_message_id_hash)).toEqual([row(h).rfc_message_id_hash, row(h).rfc_message_id_hash]);
  });
  it.each(['topic', 'bucket', 'path', 'crossenv', 'action', 'sesid'] as const)('rejects unsafe %s before any GetObject', async (kind) => {
    const h = harness();
    const body = envelope((n, wrapper) => {
      if (kind === 'topic') wrapper.TopicArn = 'arn:aws:sns:us-east-1:999999999999:attacker';
      if (kind === 'bucket') n.receipt.action.bucketName = 'attacker-bucket';
      if (kind === 'path') n.receipt.action.objectKey = 'raw/../outside';
      if (kind === 'crossenv') n.receipt.action.topicArn = 'arn:aws:sns:us-east-1:123456789012:staging';
      if (kind === 'action') n.receipt.action.type = 'SNS';
      if (kind === 'sesid') { n.mail.messageId = '../../outside'; n.receipt.action.objectKey = 'raw/../../outside'; }
    });
    expect((await receive(h, body)).acknowledged).toBe(false); expect(h.rows.size).toBe(0); expect(h.transport.readRaw).not.toHaveBeenCalled();
  });
  it('unknown RCPT alias is ignored without assigning the To/header tenant', async () => {
    const h = harness();
    const body = envelope((n) => { n.receipt.recipients = ['unknown@example.invalid']; n.mail.commonHeaders.to = [`${alias}@${domain}`]; });
    expect(await receive(h, body)).toEqual({ acknowledged: true, handled: 0 }); expect(h.rows.size).toBe(0); expect(h.transport.readRaw).not.toHaveBeenCalled();
  });
  it('fences rotation under the same store lock and keeps accepted pre-rotation snapshots', async () => {
    const h = harness(); h.inboxRow.local_part = 'facturas-ffffffffffffffffffffffffffffffff';
    expect(await receive(h)).toEqual({ acknowledged: true, handled: 0 }); expect(h.message.create).not.toHaveBeenCalled();
    h.inboxRow.local_part = alias; h.transport.readRaw.mockRejectedValueOnce(new Error('S3 offline'));
    await receive(h); h.inboxRow.local_part = 'facturas-ffffffffffffffffffffffffffffffff'; h.inboxes.lookupByAlias.mockResolvedValue(null);
    expect((await receive(h)).acknowledged).toBe(true); expect(h.rows.size).toBe(1); expect(h.inboxes.revalidateSnapshot).toHaveBeenLastCalledWith(snapshot);
  });
  it('does not download or parse over the COUNT limit; rejected mail remains durable', async () => {
    const h = harness(); h.message.aggregate.mockResolvedValueOnce({ _count: { _all: 200 }, _sum: { raw_bytes: 100 } });
    expect((await receive(h)).acknowledged).toBe(true); expect(row(h)).toMatchObject({ reason_code: 'DAILY_QUOTA_EXCEEDED', status: 'not_processed' }); expect(h.transport.readRaw).not.toHaveBeenCalled();
  });
  it('rechecks actual daily bytes under a UTC lock before parsing and does not double-count a retry', async () => {
    const h = harness(); h.message.aggregate.mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { raw_bytes: 0 } }).mockResolvedValueOnce({ _count: { _all: 1 }, _sum: { raw_bytes: 1024 * 1024 * 1024 - 1 } });
    expect((await receive(h)).acknowledged).toBe(true); expect(row(h).reason_code).toBe('DAILY_QUOTA_EXCEEDED'); expect(h.processor.processEmail).not.toHaveBeenCalled();
    expect(h.message.aggregate).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ store_id: 21, id: { not: 1 }, received_at: { gte: expect.any(Date), lt: expect.any(Date) } }) }));
  });
  it('cuts the bounded raw stream at 20 MiB without invoking the parser', async () => {
    const h = harness(); const stream = Readable.from([Buffer.alloc(20 * 1024 * 1024), Buffer.from('x')]); h.transport.readRaw.mockResolvedValueOnce(stream);
    expect((await receive(h)).acknowledged).toBe(true); expect(row(h).reason_code).toBe('LIMIT_EXCEEDED'); expect(stream.destroyed).toBe(true); expect(h.processor.processEmail).not.toHaveBeenCalled();
  });
  it.each([['FAIL', 'PASS', 'VIRUS_BLOCKED'], ['GRAY', 'PASS', 'SECURITY_SCAN_UNAVAILABLE'], ['PROCESSING_FAILED', 'PASS', 'SECURITY_SCAN_UNAVAILABLE'], ['PASS', 'FAIL', 'SUSPICIOUS_EMAIL']] as const)('blocks security verdict %s/%s durably with %s', async (virus, spam, reason) => {
    const h = harness(); expect((await receive(h, envelope((n) => { n.receipt.virusVerdict.status = virus; n.receipt.spamVerdict.status = spam; }))).acknowledged).toBe(true);
    expect(row(h).reason_code).toBe(reason); expect(h.transport.readRaw).not.toHaveBeenCalled(); expect(h.inboxRow.first_valid_received_at).toBeNull();
  });
  it('authenticates Gmail only from SES From plus DKIM/DMARC, never raw headers, and hides subject codes even spoofed', async () => {
    const h = harness(); await receive(h, envelope((n) => { n.mail.commonHeaders.from = ['forwarding-noreply@google.com']; n.mail.commonHeaders.subject = 'Confirmation 1234567'; n.receipt.dkimVerdict.status = 'FAIL'; n.mail.headers = [{ name: 'Authentication-Results', value: 'dkim=pass dmarc=pass' }]; }));
    expect(row(h).parts[0].transport_facts.gmail_authenticated).toBe(false); expect(row(h).subject).toBe('Confirmación de reenvío de Gmail');
    const good = harness(); await receive(good, envelope((n) => { n.mail.commonHeaders.from = ['forwarding-noreply@google.com']; })); expect(row(good).parts[0].transport_facts.gmail_authenticated).toBe(true);
  });
  it('persistently fails technical S3/processor work without ACK; native SQS may move it to DLQ', async () => {
    const h = harness(); h.transport.readRaw.mockRejectedValueOnce(new Error('private raw pointer'));
    expect((await receive(h)).acknowledged).toBe(false); expect(row(h)).toMatchObject({ status: 'failed', retryable: true, processed_at: null, reason_code: 'TECHNICAL_PROCESSING_ERROR' });
    expect(h.transport.delete).not.toHaveBeenCalled(); expect(h.transport.sendRetry).not.toHaveBeenCalled();
    expect((await receive(h)).acknowledged).toBe(true); expect(h.rows.size).toBe(1);
  });
  it('DB registration failure never ACKs and never touches raw storage', async () => {
    const h = harness(); h.message.create.mockRejectedValueOnce(new Error('database offline'));
    expect((await receive(h)).acknowledged).toBe(false); expect(h.transport.delete).not.toHaveBeenCalled(); expect(h.transport.readRaw).not.toHaveBeenCalled();
  });
  it('active claim cannot be stolen but an abandoned expired attempt can resume', async () => {
    const h = harness(); h.transport.readRaw.mockRejectedValueOnce(new Error('offline')); await receive(h);
    Object.assign(row(h), { status: 'processing', processing_token: 'owner-other', processing_started_at: new Date(), retryable: false });
    expect((await receive(h)).acknowledged).toBe(false);
    row(h).processing_started_at = new Date(Date.now() - 121_000);
    expect((await receive(h)).acknowledged).toBe(true); expect(row(h).attempt_count).toBe(2);
  });
  it('before_write revalidates fiscal authority and refuses a lost claim token', async () => {
    const h = harness(); h.processor.processEmail.mockImplementationOnce(async (request) => { row(h).processing_token = 'foreign-owner'; await request.before_write(); return success; });
    expect((await receive(h)).acknowledged).toBe(false); expect(row(h).processed_at).toBeNull(); expect(h.transport.delete).not.toHaveBeenCalled();
  });
  it('blocks a canonical taxpayer identity change before_write without a fiscal mutation', async () => {
    const h = harness(); let fiscalWrites = 0;
    h.processor.processEmail.mockImplementationOnce(async (request) => {
      h.inboxes.revalidateSnapshot.mockResolvedValueOnce({ ...snapshot, recipient_alias: `${alias}@${domain}`, fiscal_scope: 'ORGANIZATION', fiscal_identity: { nit: '901999999', nit_type: 'NIT' } });
      await request.before_write(); fiscalWrites++;
      return success;
    });
    expect((await receive(h)).acknowledged).toBe(true);
    expect(fiscalWrites).toBe(0);
    expect(row(h)).toMatchObject({ status: 'not_processed', reason_code: 'FISCAL_GATE_BLOCKED', retryable: false });
    expect(h.inboxRow.first_valid_received_at).toBeNull();
  });
  it.each(['EMAIL_RECEPTION_PAUSED', 'EMAIL_RECEPTION_UNAVAILABLE', 'EMAIL_RECEPTION_FISCAL_GATE', 'EMAIL_RECEPTION_SUBSCRIPTION_BLOCKED'])('durably projects %s without IO or valid-document health', async (errorCode) => {
    const h = harness(); h.inboxes.revalidateSnapshot.mockRejectedValueOnce({ errorCode });
    expect((await receive(h)).acknowledged).toBe(true); expect(h.transport.readRaw).not.toHaveBeenCalled(); expect(h.inboxRow.first_valid_received_at).toBeNull();
    expect(row(h).reason_code).toBe(errorCode === 'EMAIL_RECEPTION_FISCAL_GATE' ? 'FISCAL_GATE_BLOCKED' : errorCode === 'EMAIL_RECEPTION_SUBSCRIPTION_BLOCKED' ? 'SUBSCRIPTION_BLOCKED' : 'EMAIL_RECEPTION_PAUSED');
  });
  it('shutdown aborts raw IO and never acknowledges unfinished work', async () => {
    const h = harness(); let ioStarted!: () => void; const started = new Promise<void>((resolve) => { ioStarted = resolve; });
    let stream!: Readable;
    h.transport.readRaw.mockImplementationOnce(async () => { stream = new Readable({ read() {} }); ioStarted(); return stream; });
    const pending = receive(h); await started; await h.service.onModuleDestroy();
    expect((await pending).acknowledged).toBe(false); expect(stream.destroyed).toBe(true); expect(h.transport.delete).not.toHaveBeenCalled();
  });
  it('internal retry has a durable request epoch that survives claim/failure version increments', async () => {
    const h = harness(); h.transport.readRaw.mockRejectedValueOnce(new Error('offline')); await receive(h);
    await h.service.sendInternalRetry(1, row(h).version, snapshot, h.transport);
    const request = h.transport.sendRetry.mock.calls[0][0]; expect(Object.keys(request).sort()).toEqual(['message_id', 'type', 'version']);
    expect(row(h).parts[0].transport_facts.retry_requested_version).toBe(request.version);
    h.processor.processEmail.mockResolvedValueOnce({ ...success, status: 'failed', reason_code: 'TECHNICAL_PROCESSING_ERROR', retryable: true, valid_document: false });
    expect((await receive(h, JSON.stringify(request))).acknowledged).toBe(false);
    expect(row(h).version).toBeGreaterThan(request.version);
    expect((await receive(h, JSON.stringify(request))).acknowledged).toBe(true); expect(h.rows.size).toBe(1);
  });
  it('partial technical outcomes remain durable without ACK and are eligible for the same retry protocol', async () => {
    const h = harness();
    h.processor.processEmail.mockResolvedValueOnce({ ...success, status: 'partial', reason_code: 'TECHNICAL_PROCESSING_ERROR', retryable: true, valid_document: false,
      parts: [{ message_index: 0, ordinal: 1, filename: 'invoice.xml', kind: 'xml', status: 'processed' }] });
    expect((await receive(h)).acknowledged).toBe(false);
    expect(row(h)).toMatchObject({ status: 'partial', retryable: true, processed_at: null });
    await h.service.sendInternalRetry(1, row(h).version, snapshot, h.transport);
    expect((await receive(h, JSON.stringify(h.transport.sendRetry.mock.calls[0][0]))).acknowledged).toBe(true);
    expect(h.rows.size).toBe(1);
  });
  it('a timer-observed pause aborts IO but persists the business reason under the still-owned claim', async () => {
    jest.useFakeTimers();
    try {
      const h = harness(); let processorStarted!: () => void;
      const started = new Promise<void>((resolve) => { processorStarted = resolve; });
      h.processor.processEmail.mockImplementationOnce(async (request) => {
        processorStarted();
        await new Promise<void>((resolve) => request.signal.addEventListener('abort', () => resolve(), { once: true }));
        return success;
      });
      const pending = receive(h); await started;
      h.inboxes.revalidateSnapshot.mockRejectedValueOnce({ errorCode: 'EMAIL_RECEPTION_PAUSED' });
      await jest.advanceTimersByTimeAsync(30_000);
      expect((await pending).acknowledged).toBe(true);
      expect(row(h)).toMatchObject({ status: 'not_processed', reason_code: 'EMAIL_RECEPTION_PAUSED', retryable: false });
      expect(h.inboxRow.first_valid_received_at).toBeNull();
    } finally { jest.useRealTimers(); }
  });
  it('post-terminal tag failure defers ACK but re-delivery retries only retention tagging', async () => {
    const h = harness(); h.transport.tagRaw.mockRejectedValueOnce(new Error('tagging unavailable'));
    h.processor.processEmail.mockResolvedValueOnce({ status: 'ignored', reason_code: 'NOT_AN_INVOICE', retryable: false, valid_document: false, parts: [] });
    expect((await receive(h)).acknowledged).toBe(false);
    expect(row(h).processed_at).toBeInstanceOf(Date);
    expect((await receive(h)).acknowledged).toBe(true);
    expect(h.processor.processEmail).toHaveBeenCalledTimes(1);
    expect(h.transport.tagRaw).toHaveBeenLastCalledWith(bucket, 'raw/synthetic-ses-invoice', 'noinvoice', expect.any(AbortSignal));
  });
  it('stale retry epochs ACK no-op, while malicious retry payload pointers never trigger IO', async () => {
    const h = harness(); h.transport.readRaw.mockRejectedValueOnce(new Error('offline')); await receive(h); await h.service.sendInternalRetry(1, row(h).version, snapshot, h.transport);
    const request = h.transport.sendRetry.mock.calls[0][0];
    expect((await receive(h, JSON.stringify({ ...request, version: request.version - 1 }))).acknowledged).toBe(true);
    expect((await receive(h, JSON.stringify({ ...request, raw_key: 'attacker' }))).acknowledged).toBe(false);
    expect(h.transport.readRaw).toHaveBeenCalledTimes(1);
  });
  it('retry SDK send failure preserves the epoch for a later explicit user re-enqueue', async () => {
    const h = harness(); h.transport.readRaw.mockRejectedValueOnce(new Error('offline')); await receive(h); const prior = row(h).version; h.transport.sendRetry.mockRejectedValueOnce(new Error('SQS offline'));
    await expect(h.service.sendInternalRetry(1, prior, snapshot, h.transport)).rejects.toThrow('SQS offline');
    expect(row(h)).toMatchObject({ status: 'failed', retryable: true, processed_at: null, version: prior + 1 });
    await expect(h.service.sendInternalRetry(1, row(h).version, { ...snapshot, store_id: 99 }, h.transport)).rejects.toThrow('outside authorized scope');
  });
  it('expired raw retry becomes a durable RAW_EXPIRED reason without redownloading originals', async () => {
    const h = harness(); h.transport.readRaw.mockRejectedValueOnce(new Error('offline')); await receive(h); await h.service.sendInternalRetry(1, row(h).version, snapshot, h.transport);
    const request = h.transport.sendRetry.mock.calls[0][0]; row(h).received_at = new Date(Date.now() - 31 * 86_400_000);
    expect((await receive(h, JSON.stringify(request))).acknowledged).toBe(true); expect(row(h).reason_code).toBe('RAW_EXPIRED'); expect(h.transport.readRaw).toHaveBeenCalledTimes(1);
  });
  it('preserves transport facts but whitelists parts without bytes/body/base64', async () => {
    const h = harness(); h.processor.processEmail.mockResolvedValueOnce({ ...success, parts: [{ message_index: 0, ordinal: 1, filename: 'invoice.xml', kind: 'xml', status: 'processed', bytes: 'secret-bytes', body: '<script>', base64: 'AAAA' } as any] });
    await receive(h); expect(JSON.stringify(row(h).parts)).not.toMatch(/secret-bytes|script|AAAA/); expect(row(h).parts[0].transport_facts).toEqual(facts);
  });
  it('only complete valid documents count as first/last valid; challenge/error never does', async () => {
    const h = harness(); h.processor.processEmail.mockResolvedValueOnce({ status: 'ignored', reason_code: 'GMAIL_VERIFICATION_CODE', retryable: false, valid_document: false, parts: [] });
    await receive(h); expect(h.inboxRow.last_email_at).toBeInstanceOf(Date); expect(h.inboxRow.first_valid_received_at).toBeNull(); expect(h.inboxRow.last_valid_received_at).toBeNull();
  });
  it('does not start polling for default-disabled or api role; local overrides never publish live metrics', async () => {
    const disabled = harness({ NODE_ENV: 'production', EMAIL_RECEPTION_ENABLED: 'false' }); const api = harness({ NODE_ENV: 'production', VENDIX_PROCESS_ROLE: 'api' });
    const disabledPoll = jest.spyOn(disabled.service as any, 'poll'); const apiPoll = jest.spyOn(api.service as any, 'poll');
    disabled.service.onModuleInit(); api.service.onModuleInit(); expect(disabledPoll).not.toHaveBeenCalled(); expect(apiPoll).not.toHaveBeenCalled();
    const h = harness(); const clients = jest.spyOn(h.service as any, 'clients'); const localPoll = jest.spyOn(h.service as any, 'poll'); h.service.onModuleInit(); expect(localPoll).not.toHaveBeenCalled(); await receive(h); expect(clients).not.toHaveBeenCalled();
  });
});
