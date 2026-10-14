/**
 * LOCAL ONLY: real email consumer -> MIME/ZIP -> prepared core -> local originals.
 * No Nest boot, HTTP, polling, AWS, DIAN, OCR or queue execution. The unused OCR
 * dependency explicitly throws; it is a simulator boundary, not a logic mock.
 * Raw copies remain private on disk; this script never cleans fiscal/DB files.
 * Standalone logging is suppressed to keep headers, taxpayer IDs and challenges
 * out of stdout. Explicit exit follows settled IO/public cleanup/JSON flush:
 * Prisma's externally supplied pg Pool can otherwise keep this standalone alive.
 *
 * From apps/backend:
 * TS_NODE_TRANSPILE_ONLY=1 NODE_OPTIONS=--max-old-space-size=1536 \
 * node -r ts-node/register -r tsconfig-paths/register scripts/email-reception-simulate.ts --help
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { DocumentEmailTransport } from '../src/domains/received-documents/interfaces/document-email-reception.interface';
import type { GlobalPrismaService } from '../src/prisma/services/global-prisma.service';
import type { StorePrismaService } from '../src/prisma/services/store-prisma.service';
import type { ReceivedDocumentScanQueueService } from '../src/domains/received-documents/services/received-document-scan-queue.service';

const MAX_RAW = 20 * 1024 * 1024;
const MAX_METADATA = 300 * 1024;
const HELP = `Simulador LOCAL de recepción email (pipeline y gates reales, sin AWS/DIAN/OCR).
Uso: --store-id <id> --eml <fixture.eml> [--ses-id <id>] [--repeat 1..3]
     [--ses-metadata <fixture.json>] [--activate --actor-id <id>]
--help: no conecta ni construye servicios.
NODE_ENV=development; DB local:5432/vendix_db y Redis local:6379 obligatorios.
Reutiliza el alias actual; no crea/activa sin --activate explícito con actor autorizado.
Metadata SES es una simulación explícita, NO prueba autenticación SES real.
Sin metadata: escaneos PASS sintéticos, autenticación Gmail siempre desconocida.
No reescribe XML ni ajusta identidad fiscal. Raw privado y originales se conservan.
`;
class SimulatorError extends Error {}
interface Options { store: number; eml: string; ses: string; repeat: number; metadata?: string; activate: boolean; actor?: number }
type ObjectRecord = Record<string, unknown>;
function fail(code: string): never { throw new SimulatorError(code); }
function object(value: unknown): ObjectRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('SIM_INVALID_SES_FIXTURE');
  return value as ObjectRecord;
}
function positive(value?: string, max = 2_147_483_647): number {
  if (!value || !/^[1-9][0-9]{0,9}$/.test(value) || Number(value) > max) fail('SIM_INVALID_ARGUMENTS');
  return Number(value);
}
function parse(argv: string[]): Options | null {
  if (argv.length === 1 && argv[0] === '--help') return null;
  const values = new Map<string, string>(); let activate = false;
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--activate' && !activate) { activate = true; continue; }
    if (!['--store-id', '--eml', '--ses-id', '--repeat', '--ses-metadata', '--actor-id'].includes(key) || values.has(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) fail('SIM_INVALID_ARGUMENTS');
    values.set(key, argv[++i]);
  }
  const eml = values.get('--eml'), ses = values.get('--ses-id') ?? `sim-${randomBytes(16).toString('hex')}`;
  if (!eml || !/^[a-zA-Z0-9_-]{1,255}$/.test(ses) || activate !== values.has('--actor-id')) fail('SIM_INVALID_ARGUMENTS');
  return { store: positive(values.get('--store-id')), eml: resolve(eml), ses,
    repeat: positive(values.get('--repeat') ?? '1', 3), activate,
    actor: values.has('--actor-id') ? positive(values.get('--actor-id')) : undefined,
    metadata: values.has('--ses-metadata') ? resolve(values.get('--ses-metadata')!) : undefined };
}
function localGuards(): { host: string; port: number; db: number; password?: string } {
  if (process.env.NODE_ENV !== 'development') fail('SIM_DEVELOPMENT_ONLY');
  if (process.env.RECEIVED_DOCUMENT_STORAGE_DRIVER?.trim() && process.env.RECEIVED_DOCUMENT_STORAGE_DRIVER.trim().toLowerCase() !== 'local') fail('SIM_LOCAL_STORAGE_ONLY');
  let database: URL; try { database = new URL(process.env.DATABASE_URL ?? ''); } catch { fail('SIM_LOCAL_DATABASE_ONLY'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !['localhost', '127.0.0.1', '[::1]', 'db'].includes(database.hostname) || (database.port || '5432') !== '5432' || database.pathname !== '/vendix_db' || [...database.searchParams.keys()].some((key) => !['sslmode', 'schema', 'connection_limit', 'pool_timeout'].includes(key))) fail('SIM_LOCAL_DATABASE_ONLY');
  const allowed = ['localhost', '127.0.0.1', '::1', '[::1]', 'redis'];
  let url: URL | undefined;
  if (process.env.REDIS_URL) {
    try { url = new URL(process.env.REDIS_URL); } catch { fail('SIM_LOCAL_REDIS_ONLY'); }
    if (url.protocol !== 'redis:' || !allowed.includes(url.hostname) || (url.port || '6379') !== '6379') fail('SIM_LOCAL_REDIS_ONLY');
  }
  const host = process.env.REDIS_HOST ?? url?.hostname ?? 'localhost';
  const port = Number(process.env.REDIS_PORT ?? url?.port ?? 6379);
  const db = Number(process.env.REDIS_DB ?? url?.pathname.slice(1) ?? 0);
  if (!allowed.includes(host) || port !== 6379 || !Number.isInteger(db) || db < 0 || db > 15) fail('SIM_LOCAL_REDIS_ONLY');
  return { host: host === '[::1]' ? '::1' : host, port, db,
    password: process.env.REDIS_PASSWORD || (url?.password ? decodeURIComponent(url.password) : undefined) };
}
async function metadata(path?: string): Promise<{ commonHeaders: ObjectRecord; receipt: ObjectRecord }> {
  if (!path) return { commonHeaders: {}, receipt: { virusVerdict: { status: 'PASS' }, spamVerdict: { status: 'PASS' }, dkimVerdict: { status: 'UNKNOWN' }, dmarcVerdict: { status: 'UNKNOWN' } } };
  const info = await stat(path); if (!info.isFile() || info.size > MAX_METADATA) fail('SIM_INVALID_SES_FIXTURE');
  const chunks: Buffer[] = []; let total = 0;
  const input = createReadStream(path);
  try { for await (const chunk of input) { total += chunk.length; if (total > MAX_METADATA) fail('SIM_INVALID_SES_FIXTURE'); chunks.push(chunk); } }
  finally { input.destroy(); }
  const bytes = Buffer.concat(chunks, total);
  let fixture: ObjectRecord;
  try {
    fixture = object(JSON.parse(bytes.toString('utf8')));
    if (fixture.Type === 'Notification') {
      if (typeof fixture.Message !== 'string' || Buffer.byteLength(fixture.Message) > MAX_METADATA) fail('SIM_INVALID_SES_FIXTURE');
      fixture = object(JSON.parse(fixture.Message));
    }
  } catch { fail('SIM_INVALID_SES_FIXTURE'); }
  if (fixture.notificationType !== 'Received') fail('SIM_INVALID_SES_FIXTURE');
  const mail = object(fixture.mail), receipt = object(fixture.receipt), headers = object(mail.commonHeaders);
  const commonHeaders: ObjectRecord = {};
  if (headers.from !== undefined) {
    if (!Array.isArray(headers.from) || headers.from.length > 1 || headers.from.some((v) => typeof v !== 'string' || v.length > 255 || /[\r\n]/.test(v))) fail('SIM_INVALID_SES_FIXTURE');
    commonHeaders.from = headers.from;
  }
  for (const [key, limit] of [['subject', 255], ['messageId', 1024]] as const) {
    if (headers[key] !== undefined) {
      if (typeof headers[key] !== 'string' || (headers[key] as string).length > limit || /[\r\n]/.test(headers[key] as string)) fail('SIM_INVALID_SES_FIXTURE');
      commonHeaders[key] = headers[key];
    }
  }
  const safeReceipt: ObjectRecord = {};
  for (const key of ['virusVerdict', 'spamVerdict', 'dkimVerdict', 'dmarcVerdict', 'spfVerdict']) {
    const verdict = receipt[key] === undefined ? { status: 'UNKNOWN' } : object(receipt[key]);
    if (!['PASS', 'FAIL', 'GRAY', 'PROCESSING_FAILED', 'UNKNOWN'].includes(verdict.status as string)) fail('SIM_INVALID_SES_FIXTURE');
    safeReceipt[key] = { status: verdict.status };
  }
  // Fixture tenant/address/date/storage bindings are deliberately never copied.
  return { commonHeaders, receipt: safeReceipt };
}
async function validateActor(prisma: GlobalPrismaService, actor: number, organization: number, store: number): Promise<void> {
  const user = await prisma.users.findFirst({ where: { id: actor, state: 'active' }, select: { organization_id: true } });
  if (!user) fail('SIM_ACTOR_FORBIDDEN');
  const assignments = await prisma.user_roles.findMany({ where: { user_id: actor, OR: [{ store_id: null }, { store_id: store }] },
    include: { roles: { include: { role_permissions: { where: { granted: true }, include: { permissions: true } } } } } });
  const superAdmin = assignments.some((a) => a.store_id == null && a.roles?.name === 'super_admin' && a.roles.is_system_role && a.roles.organization_id == null && a.roles.store_id == null);
  if (superAdmin) return;
  if (user.organization_id !== organization || !assignments.some((a) => {
    const role = a.roles;
    return role && (role.organization_id === organization || role.is_system_role && role.organization_id == null)
      && (role.store_id == null || role.store_id === store)
      && role.role_permissions.some((p) => p.permissions.status === 'active' && p.permissions.name === 'invoicing:received:connections:configure');
  })) fail('SIM_ACTOR_FORBIDDEN');
  const { AccessValidationService } = await import('../src/common/services/access-validation.service');
  await new AccessValidationService(prisma).validateStoreAccess(store, { id: actor, organization_id: user.organization_id, user_roles: assignments });
}

export async function main(argv = process.argv.slice(2)): Promise<{ code: number; output: unknown }> {
  let phase: 'guards' | 'raw_copy' | 'clients' | 'fiscal_lookup' | 'activation' | 'processor_bootstrap' | 'delivery' | 'summary' = 'guards';
  let subphase: 'actor_validation' | 'config_read' | 'inbox_activate' | 'inbox_resume' | 'alias_resolve' | null = null;
  let prisma: GlobalPrismaService | undefined;
  let redis: import('ioredis').default | undefined;
  let consumer: import('../src/domains/received-documents/services/document-email-sqs-consumer.service').DocumentEmailSqsConsumerService | undefined;
  const streams = new Set<Readable>(); const shutdown = new AbortController();
  const interrupt = () => { shutdown.abort(); for (const stream of streams) stream.destroy(); void consumer?.onModuleDestroy().catch(() => undefined); };
  try {
    const options = parse(argv); if (!options) return { code: 0, output: HELP };
    // Read-only dotenv load; existing operator environment always wins.
    (await import('dotenv')).config({ path: resolve(__dirname, '../.env'), override: false });
    const redisOptions = localGuards();
    const security = await metadata(options.metadata);
    const info = await stat(options.eml); if (!info.isFile() || info.size > MAX_RAW) fail('SIM_RAW_BUDGET');
    phase = 'raw_copy';
    const privateDir = await mkdtemp(join(tmpdir(), 'vendix-email-sim-')); await chmod(privateDir, 0o700);
    const rawPath = join(privateDir, 'raw.eml');
    let rawBytes = 0;
    const bound = new Transform({ transform(chunk, _encoding, done) { rawBytes += chunk.length; done(rawBytes > MAX_RAW ? new SimulatorError('SIM_RAW_BUDGET') : null, chunk); } });
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    await pipeline(createReadStream(options.eml), bound, createWriteStream(rawPath, { mode: 0o600, flags: 'wx' }), { signal: shutdown.signal });
    phase = 'clients';
    // Dynamic imports keep --help dependency/connection free. No AppModule import.
    const { GlobalPrismaService: PrismaService } = await import('../src/prisma/services/global-prisma.service');
    const { FiscalScopeService } = await import('../src/common/services/fiscal-scope.service');
    const { ConfigService } = await import('@nestjs/config');
    const { default: Redis } = await import('ioredis');
    const { SubscriptionResolverService } = await import('../src/domains/store/subscriptions/services/subscription-resolver.service');
    const { SubscriptionAccessService } = await import('../src/domains/store/subscriptions/services/subscription-access.service');
    const { DocumentEmailInboxService } = await import('../src/domains/received-documents/services/document-email-inbox.service');
    prisma = new PrismaService(); await prisma.$connect();
    redis = new Redis({ ...redisOptions, lazyConnect: true, connectTimeout: 5000, maxRetriesPerRequest: 1, retryStrategy: () => null });
    redis.on('error', () => undefined); await redis.connect(); await redis.ping();
    phase = 'fiscal_lookup';
    const store = await prisma.stores.findFirst({ where: { id: options.store, is_active: true, organizations: { state: 'active' } }, select: { organization_id: true } });
    if (!store) fail('SIM_STORE_UNAVAILABLE');
    const organization = store.organization_id;
    // Single system client; every fiscal query receives an explicitly scoped raw tx.
    const fiscal = new FiscalScopeService(prisma as unknown as StorePrismaService);
    const fiscalScope = await fiscal.getFiscalScope(organization, prisma.withoutScope());
    const org = await prisma.organizations.findFirst({ where: { id: organization, state: 'active' }, select: { operating_scope: true } });
    fiscal.assertValidScopeCombination(org!.operating_scope, fiscalScope);
    const entityId = await fiscal.findFiscalAccountingEntityId({ organization_id: organization, store_id: options.store, tx: prisma.withoutScope() });
    const entity = entityId == null ? null : await prisma.withoutScope().accounting_entities.findFirst({ where: { id: entityId, organization_id: organization, store_id: fiscalScope === 'STORE' ? options.store : null, scope: fiscalScope, is_active: true }, select: { id: true } });
    if (!entity) fail('SIM_EXISTING_FISCAL_ENTITY_REQUIRED');
    const existing = await prisma.document_reception_email_inboxes.findFirst({ where: { organization_id: organization, store_id: options.store } });
    const environment = existing?.environment ?? process.env.EMAIL_RECEPTION_ENVIRONMENT ?? 'staging';
    if (!['production', 'staging'].includes(environment)) fail('SIM_INVALID_EMAIL_BINDING');
    const domain = environment === 'production' ? 'recepcion.vendix.online' : 'recepcion-stg.vendix.online';
    const topic = 'arn:aws:sns:us-east-1:000000000000:email-reception-local-simulator';
    const bucket = 'vendix-email-local-simulator'; const key = `raw/${options.ses}`;
    const config = new ConfigService({ NODE_ENV: 'development', EMAIL_RECEPTION_ENABLED: 'true', EMAIL_RECEPTION_STORE_ALLOWLIST: String(options.store),
      EMAIL_RECEPTION_ENVIRONMENT: environment, EMAIL_RECEPTION_DOMAIN: domain, EMAIL_RECEPTION_AWS_REGION: 'us-east-1',
      EMAIL_RECEPTION_SNS_TOPIC_ARN: topic, EMAIL_RECEPTION_RAW_BUCKET: bucket, EMAIL_RECEPTION_RAW_PREFIX: 'raw/',
      EMAIL_RECEPTION_SQS_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/000000000000/email-reception-local-simulator' });
    const inboxes = new DocumentEmailInboxService(prisma, config, fiscal, new SubscriptionAccessService(new SubscriptionResolverService(prisma, redis), redis, prisma));
    const readContext = { organization_id: organization, store_id: options.store, accounting_entity_id: entity.id, fiscal_scope: fiscalScope, is_organization: false };
    phase = 'activation';
    if (options.activate) {
      subphase = 'actor_validation';
      await validateActor(prisma, options.actor!, organization, options.store);
      const actorContext = { ...readContext, actor_id: options.actor };
      subphase = 'config_read';
      const current = await inboxes.configuration(actorContext);
      subphase = 'inbox_activate';
      const active = await inboxes.activate(actorContext, { consent: true, policy_version: current.policy_version });
      subphase = 'inbox_resume';
      if (!active.enabled) await inboxes.update(actorContext, { enabled: true, expected_version: active.version! });
    }
    const inbox = await prisma.document_reception_email_inboxes.findFirst({ where: { organization_id: organization, store_id: options.store, accounting_entity_id: entity.id, enabled: true } });
    if (!inbox) fail('SIM_EXPLICIT_ACTIVATION_REQUIRED');
    const alias = `${inbox.local_part}@${inbox.domain}`;
    subphase = 'alias_resolve';
    if (!await inboxes.resolveByAlias(alias)) fail('SIM_INVALID_EMAIL_BINDING'); // Actual pilot, subscription and production DIAN configuration gates (read-only).
    subphase = null;
    phase = 'processor_bootstrap';
    const { S3Service } = await import('../src/common/services/s3.service');
    const { S3PathHelper } = await import('../src/common/helpers/s3-path.helper');
    const { ReceivedDocumentStorageService } = await import('../src/domains/received-documents/services/received-document-storage.service');
    const { ReceivedDocumentParserService } = await import('../src/domains/received-documents/services/received-document-parser.service');
    const { ReceivedDocumentsService } = await import('../src/domains/received-documents/received-documents.service');
    const { DocumentReceptionIngestService } = await import('../src/domains/received-documents/services/document-reception-ingest.service');
    const { DocumentEmailGmailCodeService } = await import('../src/domains/received-documents/services/document-email-gmail-code.service');
    const { EncryptionService } = await import('../src/common/services/encryption.service');
    const { DocumentEmailMimeService } = await import('../src/domains/received-documents/services/document-email-mime.service');
    const { DocumentEmailZipService } = await import('../src/domains/received-documents/services/document-email-zip.service');
    const { DocumentEmailAttachmentService } = await import('../src/domains/received-documents/services/document-email-attachment.service');
    const { DocumentEmailSqsConsumerService } = await import('../src/domains/received-documents/services/document-email-sqs-consumer.service');
    const parser = new ReceivedDocumentParserService();
    const storage = new ReceivedDocumentStorageService(new S3Service(config, new S3PathHelper()));
    const documents = new ReceivedDocumentsService(prisma, parser, storage);
    const prohibitedOcr = { enqueue: async () => fail('SIM_OCR_PROHIBITED') } as unknown as ReceivedDocumentScanQueueService;
    const ingest = new DocumentReceptionIngestService(documents, prohibitedOcr);
    const gmail = new DocumentEmailGmailCodeService(prisma, new EncryptionService());
    const processor = new DocumentEmailAttachmentService(new DocumentEmailMimeService(), new DocumentEmailZipService(), parser, ingest, gmail);
    consumer = new DocumentEmailSqsConsumerService(prisma, config, inboxes, processor);
    let acknowledgements = 0; let renewals = 0; let retryRequests = 0; let tags = 0;
    const check = (signal: AbortSignal) => { if (signal.aborted || shutdown.signal.aborted) fail('SIM_INTERRUPTED'); };
    const transport: DocumentEmailTransport = {
      receipt_handle: 'local-simulator',
      readRaw: async (receivedBucket, receivedKey, signal) => {
        check(signal); if (receivedBucket !== bucket || receivedKey !== key) fail('SIM_LOCAL_BINDING_MISMATCH');
        const stream = createReadStream(rawPath, { signal }); streams.add(stream); stream.once('close', () => streams.delete(stream)); return stream;
      },
      delete: async (_handle, signal) => { check(signal); acknowledgements++; },
      renew: async (_handle, signal) => { check(signal); renewals++; },
      sendRetry: async (payload, signal) => { check(signal); if (payload.type !== 'internal_retry' || !Number.isInteger(payload.message_id) || !Number.isInteger(payload.version)) fail('SIM_INVALID_RETRY'); retryRequests++; },
      tagRaw: async (receivedBucket, receivedKey, classification, signal) => {
        check(signal); if (receivedBucket !== bucket || receivedKey !== key) fail('SIM_LOCAL_BINDING_MISMATCH');
        await writeFile(join(privateDir, 'classification.json'), JSON.stringify({ classification }), { mode: 0o600 }); tags++;
      },
    };
    const now = new Date().toISOString();
    const body = JSON.stringify({ Type: 'Notification', TopicArn: topic, MessageId: `local-${options.ses}`.slice(0, 255), Message: JSON.stringify({ notificationType: 'Received',
      mail: { timestamp: now, messageId: options.ses, commonHeaders: security.commonHeaders },
      receipt: { ...security.receipt, timestamp: now, recipients: [alias], action: { type: 'S3', topicArn: topic, bucketName: bucket, objectKey: key } } }) });
    phase = 'delivery';
    const deliveries = [];
    for (let index = 0; index < options.repeat && !shutdown.signal.aborted; index++) deliveries.push(await consumer.handleDelivery(body, transport));
    if (shutdown.signal.aborted) fail('SIM_INTERRUPTED');
    phase = 'summary';
    const row = await prisma.document_reception_email_messages.findFirst({ where: { organization_id: organization, store_id: options.store, accounting_entity_id: entity.id, environment, ses_message_id: options.ses, recipient_alias: alias }, select: { id: true, status: true, reason_code: true, retryable: true, parts: true } });
    const partIds = Array.isArray(row?.parts) ? row.parts.flatMap((part) => part && typeof part === 'object' && !Array.isArray(part) && typeof part.document_id === 'number' ? [part.document_id] : []) : [];
    const owned = partIds.length ? await prisma.received_documents.findMany({ where: { id: { in: partIds }, organization_id: organization, store_id: options.store, accounting_entity_id: entity.id }, select: { id: true } }) : [];
    const files = owned.length ? await prisma.received_document_files.findMany({ where: { document_id: { in: owned.map((doc) => doc.id) }, document: { organization_id: organization, store_id: options.store, accounting_entity_id: entity.id } }, select: { sha256: true } }) : [];
    const status = await inboxes.status(readContext);
    return { code: deliveries.every((delivery) => delivery.acknowledged) ? 0 : 2, output: { simulator: 'local_only', security_facts_source: options.metadata ? 'explicit_ses_fixture' : 'synthetic_default',
      store_id: options.store, message: row ? { id: row.id, status: row.status, reason_code: row.reason_code, retryable: row.retryable } : null,
      document_ids: owned.map((doc) => doc.id), original_files: files.length, original_hashes: new Set(files.map((file) => file.sha256)).size,
      raw_bytes: rawBytes, deliveries, acknowledgements, renewals, retry_requests: retryRequests, retention_tags: tags,
      inbox: { state: status.state, has_first_valid: status.first_valid_received_at != null, has_last_valid: status.last_valid_received_at != null, last_error_code: status.last_error_code } } };
  } catch (error) {
    const response = error && typeof error === 'object' && 'getResponse' in error && typeof error.getResponse === 'function' ? error.getResponse() : null;
    const typedCode = response && typeof response === 'object' && 'error_code' in response && typeof response.error_code === 'string' && /^[A-Z0-9_]{1,100}$/.test(response.error_code) ? response.error_code : null;
    const name = error && typeof error === 'object' ? error.constructor?.name : null;
    const errorType = typeof name === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(name) ? name : 'UnknownError';
    const prismaCode = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^P[0-9]{4}$/.test(error.code) ? error.code : null;
    return { code: 1, output: { simulator: 'local_only', phase, subphase, prisma_code: prismaCode, error_type: errorType, error_code: error instanceof SimulatorError ? error.message : typedCode ?? 'SIM_EXECUTION_FAILED' } };
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    for (const stream of streams) stream.destroy();
    let cleanupFailed = false;
    try { await consumer?.onModuleDestroy(); } catch { cleanupFailed = true; }
    if (redis) { try { await redis.quit(); } catch { redis.disconnect(); cleanupFailed = true; } }
    try { await prisma?.$disconnect(); } catch { cleanupFailed = true; }
    if (cleanupFailed) fail('SIM_CLEANUP_FAILED');
  }
}

if (require.main === module) {
  void (async () => {
    // Standalone-only boundary. Importing this module never mutates logging or exits.
    if (!(process.argv.length === 3 && process.argv[2] === '--help')) {
      const { Logger } = await import('@nestjs/common'); Logger.overrideLogger(false);
      console.log = console.info = console.warn = console.error = console.debug = () => undefined;
    }
    const result = await main();
    const output = typeof result.output === 'string' ? result.output : `${JSON.stringify(result.output)}\n`;
    await new Promise<void>((done, reject) => process.stdout.write(output, (error) => error ? reject(error) : done()));
    process.exit(result.code);
  })().catch(() => {
    process.stdout.write('{"simulator":"local_only","error_code":"SIM_CLEANUP_FAILED"}\n', () => process.exit(1));
  });
}
