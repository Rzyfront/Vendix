/** Bounded, explicit-scope technical retention only. No fiscal files, S3 or inbox writes. */
import type { Prisma } from '@prisma/client';
import type { GlobalPrismaService } from '../src/prisma/services/global-prisma.service';

const APPROVAL = 'PURGE_TECHNICAL_EMAIL_METADATA_ONLY';
const DAY_MS = 24 * 60 * 60 * 1000;
const FINAL_STATES = ['processed', 'not_processed', 'ignored', 'failed', 'partial'];
interface PurgeOptions {
  execute: boolean;
  environment: 'production' | 'staging';
  organization_id: number;
  store_id: number;
  actor_id?: number;
  batch_size: number;
  max_batches: number;
  approval?: string;
}
class PurgeCliError extends Error {}
const help = `Recepción email: purga de metadatos técnicos (dry-run por defecto).

Uso desde apps/backend, sin build ni arranque Nest:
  TS_NODE_TRANSPILE_ONLY=1 NODE_OPTIONS=--max-old-space-size=1536 \\
  node -r ts-node/register -r tsconfig-paths/register scripts/email-reception-purge.ts \\
    --dry-run --environment production --organization-id <id> --store-id <id>

Opciones:
  --help                   Sólo ayuda; no importa ni construye Prisma ni conecta DB.
  --dry-run                Predeterminado; sólo lecturas y contadores.
  --execute                Escrituras explícitas, requiere --actor-id.
  --environment            production|staging (prod|stage como alias explícitos).
  --organization-id        Entero positivo; obligatorio, sin scope global.
  --store-id               Entero positivo; obligatorio, sin scope global.
  --actor-id               Operador perteneciente a la organización; obligatorio al ejecutar.
  --batch-size             1..100, predeterminado50.
  --max-batches            1..20 por fase, predeterminado1.
  --approve-production-purge ${APPROVAL}
                           Obligatorio para target no-local production incluso dry-run.

Retención:90d UTC, sólo estados finales no-retryable sin claim/token activo y con processed_at.
Códigos Gmail expirados se limpian por scope/versión sin imprimirlos, incluso si son recientes.
No borra originales fiscales/S3, inboxes, documentos, entidades ni registros de auditoría.
Target no-local staging no admitido en este corte. Execute production no-local exige NODE_ENV=production.
`;

function positive(value: string | undefined, max = 2_147_483_647): number {
  if (!value || !/^[1-9][0-9]{0,9}$/.test(value)) throw new PurgeCliError('CLI_INVALID_POSITIVE_INTEGER');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > max) throw new PurgeCliError('CLI_INVALID_POSITIVE_INTEGER');
  return number;
}
function options(argv: string[]): PurgeOptions | null {
  if (argv.length === 1 && argv[0] === '--help') return null;
  const allowed = new Set(['--dry-run', '--execute', '--environment', '--organization-id', '--store-id', '--actor-id', '--batch-size', '--max-batches', '--approve-production-purge']);
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!allowed.has(key) || values.has(key)) throw new PurgeCliError('CLI_UNKNOWN_OR_DUPLICATED_ARGUMENT');
    if (key === '--dry-run' || key === '--execute') values.set(key, 'true');
    else {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new PurgeCliError('CLI_MISSING_ARGUMENT_VALUE');
      values.set(key, value);
    }
  }
  if (values.has('--dry-run') && values.has('--execute')) throw new PurgeCliError('CLI_AMBIGUOUS_MODE');
  const env = values.get('--environment');
  const environment = env === 'production' || env === 'prod' ? 'production' : env === 'staging' || env === 'stage' ? 'staging' : null;
  if (!environment) throw new PurgeCliError('CLI_ENVIRONMENT_REQUIRED');
  const execute = values.has('--execute');
  const actor_id = values.has('--actor-id') ? positive(values.get('--actor-id')) : undefined;
  if (execute && actor_id === undefined) throw new PurgeCliError('CLI_ACTOR_REQUIRED');
  return { execute, environment, organization_id: positive(values.get('--organization-id')), store_id: positive(values.get('--store-id')), actor_id,
    batch_size: positive(values.get('--batch-size') || '50', 100), max_batches: positive(values.get('--max-batches') || '1', 20), approval: values.get('--approve-production-purge') };
}
function checkTarget(config: PurgeOptions): void {
  let target: URL;
  try { target = new URL(process.env.DATABASE_URL || ''); }
  catch { throw new PurgeCliError('CLI_DATABASE_CONFIGURATION_INVALID'); }
  if (!['postgres:', 'postgresql:'].includes(target.protocol)) throw new PurgeCliError('CLI_DATABASE_CONFIGURATION_INVALID');
  const local = ['localhost', '127.0.0.1', '[::1]', '::1', 'db', 'vendix_postgres'].includes(target.hostname.toLowerCase());
  if (local && (target.pathname !== '/vendix_db' || (target.port && target.port !== '5432'))) throw new PurgeCliError('CLI_LOCAL_DATABASE_TARGET_NOT_APPROVED');
  if (!local) {
    if (config.environment !== 'production') throw new PurgeCliError('CLI_NONLOCAL_STAGING_NOT_APPROVED');
    if (config.approval !== APPROVAL) throw new PurgeCliError('CLI_PRODUCTION_APPROVAL_REQUIRED');
    if (config.actor_id === undefined) throw new PurgeCliError('CLI_ACTOR_REQUIRED');
    if (config.execute && process.env.NODE_ENV !== 'production') throw new PurgeCliError('CLI_PRODUCTION_NODE_ENV_REQUIRED');
  }
  const runtimeEnv = process.env.EMAIL_RECEPTION_ENVIRONMENT;
  if (runtimeEnv && runtimeEnv !== config.environment) throw new PurgeCliError('CLI_ENVIRONMENT_BINDING_MISMATCH');
}
function scope(config: PurgeOptions): Prisma.document_reception_email_messagesWhereInput {
  return { environment: config.environment, organization_id: config.organization_id, store_id: config.store_id };
}
function terminal(): Prisma.document_reception_email_messagesWhereInput {
  return { status: { in: FINAL_STATES }, retryable: false, processed_at: { not: null }, processing_token: null, processing_started_at: null };
}
function emit(value: Record<string, unknown>): void { process.stdout.write(JSON.stringify(value) + '\n'); }

async function phase(
  prisma: GlobalPrismaService,
  config: PurgeOptions,
  name: 'expired_gmail_codes' | 'technical_history_90d',
  predicate: Prisma.document_reception_email_messagesWhereInput,
  cutoff: Date,
): Promise<{ selected: number; changed: number; skipped_cas: number; has_more: boolean }> {
  const bound = { ...scope(config), ...terminal(), ...predicate };
  let cursor = 0, selected = 0, changed = 0, skipped_cas = 0, batches = 0;
  const candidate_count = await prisma.document_reception_email_messages.count({ where: bound });
  emit({ phase: name, mode: config.execute ? 'execute' : 'dry_run', candidate_count, cutoff_utc: cutoff.toISOString() });
  for (; batches < config.max_batches; batches += 1) {
    const rows = await prisma.document_reception_email_messages.findMany({ where: { ...bound, id: { gt: cursor } }, select: { id: true, version: true }, orderBy: { id: 'asc' }, take: config.batch_size });
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;
    selected += rows.length;
    let count = 0;
    if (config.execute) {
      count = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Repeat every terminal/scope/version condition at mutation time. A renewed claim wins.
        const where: Prisma.document_reception_email_messagesWhereInput = { ...bound, OR: rows.map((row) => ({ id: row.id, version: row.version })) };
        const result = name === 'expired_gmail_codes'
          ? await tx.document_reception_email_messages.updateMany({ where, data: { gmail_code_encrypted: null, gmail_code_expires_at: null, gmail_challenge_alias: null, version: { increment: 1 } } })
          : await tx.document_reception_email_messages.deleteMany({ where });
        await tx.audit_logs.create({ data: {
          user_id: config.actor_id!, organization_id: config.organization_id, store_id: config.store_id,
          action: name === 'expired_gmail_codes' ? 'UPDATE' : 'DELETE', resource: 'document_reception_email_messages',
          metadata: { reason: name === 'expired_gmail_codes' ? 'EXPIRED_GMAIL_CODE' : 'RETENTION_90_DAYS', environment: config.environment,
            selected_count: rows.length, changed_count: result.count, skipped_cas_count: rows.length - result.count, cutoff_utc: cutoff.toISOString() },
        } });
        return result.count;
      });
      changed += count;
      skipped_cas += rows.length - count;
    }
    // Counts only: no sender, alias, subject, NIT, raw key, code/ciphertext or row IDs in logs.
    emit({ phase: name, batch: batches + 1, selected_count: rows.length, changed_count: count, skipped_cas_count: config.execute ? rows.length - count : 0 });
  }
  const has_more = (await prisma.document_reception_email_messages.count({ where: config.execute ? bound : { ...bound, id: { gt: cursor } } })) > 0;
  return { selected, changed, skipped_cas, has_more };
}

async function main(argv: string[]): Promise<number> {
  const config = options(argv);
  if (!config) { process.stdout.write(help); return 0; }
  checkTarget(config);
  // One background-system scoped client, no Nest graph and no private Pool/client field access.
  process.env.DATABASE_POOL_MAX = '1';
  const { GlobalPrismaService } = await import('../src/prisma/services/global-prisma.service');
  const prisma = new GlobalPrismaService();
  try {
    await prisma.$connect();
    const store = await prisma.stores.findFirst({ where: { id: config.store_id, organization_id: config.organization_id }, select: { id: true } });
    if (!store) throw new PurgeCliError('CLI_STORE_SCOPE_NOT_FOUND');
    if (config.actor_id !== undefined) {
      const actor = await prisma.users.findFirst({ where: { id: config.actor_id, organization_id: config.organization_id }, select: { id: true } });
      if (!actor) throw new PurgeCliError('CLI_ACTOR_SCOPE_NOT_FOUND');
    }
    const now = new Date();
    const cutoff = new Date(now.getTime() - 90 * DAY_MS);
    emit({ mode: config.execute ? 'execute' : 'dry_run', environment: config.environment, organization_id: config.organization_id, store_id: config.store_id,
      batch_size: config.batch_size, max_batches_per_phase: config.max_batches, now_utc: now.toISOString(), retention_cutoff_utc: cutoff.toISOString() });
    const codes = await phase(prisma, config, 'expired_gmail_codes', { gmail_code_expires_at: { lte: now } }, now);
    const history = await phase(prisma, config, 'technical_history_90d', { received_at: { lt: cutoff } }, cutoff);
    emit({ completed: true, mode: config.execute ? 'execute' : 'dry_run', expired_gmail_codes: codes, technical_history_90d: history, fiscal_files_mutated: false });
    return 0;
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(JSON.stringify({ success: false, reason_code: error instanceof PurgeCliError ? error.message : 'CLI_TECHNICAL_DATABASE_ERROR' }) + '\n');
    return 1;
  }).then(async (code) => {
    // PrismaPg may keep driver handles after public disconnect; flush output then explicitly end CLI.
    await new Promise<void>((resolve) => process.stdout.write('', () => resolve()));
    await new Promise<void>((resolve) => process.stderr.write('', () => resolve()));
    process.exit(code);
  });
}
