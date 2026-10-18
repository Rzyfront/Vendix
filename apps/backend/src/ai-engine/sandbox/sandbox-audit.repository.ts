import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createCipheriv, createHash, randomBytes } from 'crypto';
import { RequestContextService } from '../../common/context/request-context.service';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const DIGEST = /^(?:sha256:)?[a-f0-9]{64}$/;
const TOOL = /^[a-z][a-z0-9_]{0,199}$/;
const RESULT_REF =
  /^agent-result:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const ADMISSION_LOCK = 1789197551;
const MAX_CALLS = 20;
const MAX_SOURCE_BYTES = 32 * 1024;
const LIMIT_FIELDS = new Set([
  'wall_ms',
  'cpu_ms',
  'memory_mb',
  'calls',
  'concurrency',
  'pages',
  'rows',
  'input_bytes',
  'output_bytes',
  'source_bytes',
]);
const OUTCOMES = new Set([
  'ok',
  'partial',
  'denied',
  'cancelled',
  'timeout',
  'unavailable',
  'failed',
]);
const CALL_STATUSES = new Set([
  'ok',
  'recoverable_error',
  'blocked',
  'pending_confirmation',
  'needs_user_input',
  'unknown_effect',
  'denied',
  'dispatching',
]);
const DENIALS = new Set([
  'SANDBOX_DENIED',
  'SANDBOX_LIMIT',
  'SANDBOX_PROTOCOL',
  'SANDBOX_EXPIRED',
  'SANDBOX_UNAVAILABLE',
]);
const USAGE_COUNTERS = [
  'calls',
  'pages',
  'rows',
  'input_bytes',
  'output_bytes',
  'wall_ms',
  'cpu_ms',
  'memory_mb',
  'denials',
] as const;

interface AuditScope {
  store_id: number;
  organization_id: number;
  user_id: number;
}

export interface SandboxAuditStart {
  id: string;
  objective_id: string;
  source: string;
  source_hash: string;
  policy_digest: string;
  runtime_digest: string;
  limits: Record<string, number>;
  manifest: string[];
}

export interface SandboxAuditCall {
  seq: number;
  tool: string;
  args_hash: string;
  status: string;
  result_ref?: string;
  denial?: string;
}

/** Deliberately contains neither plaintext nor ciphertext/key/nonce/tag fields. */
export interface SandboxAuditRecord extends AuditScope {
  id: string;
  objective_id: string;
  source_hash: string;
  policy_digest: string;
  runtime_digest: string;
  limits: Record<string, number>;
  manifest: string[];
  calls: SandboxAuditCall[];
  outcome: string;
  usage: Record<string, unknown>;
  lease_until: Date;
  expires_at: Date;
  created_at: Date;
  finished_at: Date | null;
}

/** Execute precisely this normalized source, not a different pre-normalized string. */
export function normalizeSandboxSource(source: string): string {
  return source.replace(/\r\n?/g, '\n').normalize('NFC');
}

export function sandboxSourceHash(source: string): string {
  return createHash('sha256')
    .update(normalizeSandboxSource(source))
    .digest('hex');
}

function requireScope(): AuditScope {
  // Never use getContext(): its legacy static fallback may belong to another tenant.
  const context = RequestContextService.asyncLocalStorage.getStore();
  if (
    !context ||
    ![context.store_id, context.organization_id, context.user_id].every(
      (id) => Number.isSafeInteger(id) && Number(id) > 0,
    )
  ) {
    throw new UnauthorizedException(
      'An explicit sandbox owner scope is required',
    );
  }
  return {
    store_id: context.store_id!,
    organization_id: context.organization_id!,
    user_id: context.user_id!,
  };
}

const scopeSql = (scope: AuditScope): Prisma.Sql =>
  Prisma.sql`store_id = ${scope.store_id} AND organization_id = ${scope.organization_id} AND user_id = ${scope.user_id}`;
const json = (value: unknown): Prisma.Sql =>
  Prisma.sql`${JSON.stringify(value)}::jsonb`;

function sourceKey(): Buffer {
  const encoded = process.env.AI_SANDBOX_SOURCE_KEY;
  // Buffer.from is deliberately lenient; enforce canonical base64 independently.
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    throw new ServiceUnavailableException(
      'Sandbox source protection is unavailable',
    );
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    key.fill(0);
    throw new ServiceUnavailableException(
      'Sandbox source protection is unavailable',
    );
  }
  return key;
}

function globalRunnerLimit(): number {
  const configured = process.env.AI_SANDBOX_MAX_RUNNERS;
  if (configured === undefined) return 2;
  if (!/^[1-9][0-9]?$/.test(configured) || Number(configured) > 32) {
    throw new ServiceUnavailableException(
      'Sandbox admission configuration is invalid',
    );
  }
  return Number(configured);
}

function redactUsage(usage: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = { verified: false, cost_usd: null };
  for (const field of USAGE_COUNTERS) {
    const value = usage[field];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
      safe[field] = value;
  }
  if (
    typeof usage.cost_usd === 'number' &&
    Number.isFinite(usage.cost_usd) &&
    usage.cost_usd >= 0
  )
    safe.cost_usd = usage.cost_usd;
  // Exit0 is not a business verifier. Never persist an asserted verified=true.
  return safe;
}

/**
 * System sink with explicit owner ACL in EVERY data query. No generic Store/Org
 * delegate is exposed: their ordinary scopes do not enforce user ownership.
 * No source decryption API, raw args/results, bearer tokens, or logging here.
 */
@Injectable()
export class SandboxAuditRepository {
  constructor(private readonly prisma: GlobalPrismaService) {}

  private validId(id: string): void {
    if (typeof id !== 'string' || !UUID.test(id))
      throw new NotFoundException('Sandbox run not found');
  }

  private transaction<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(callback, {
      timeout: 5000,
      maxWait: 1000,
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  }

  async start(input: SandboxAuditStart): Promise<void> {
    const scope = requireScope();
    this.validId(input.id);
    this.validId(input.objective_id);
    if (
      typeof input.source !== 'string' ||
      !HASH.test(input.source_hash) ||
      !DIGEST.test(input.policy_digest) ||
      !DIGEST.test(input.runtime_digest)
    )
      throw new BadRequestException('Invalid sandbox audit metadata');
    const source = normalizeSandboxSource(input.source);
    if (
      !source.length ||
      Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES ||
      sandboxSourceHash(source) !== input.source_hash
    )
      throw new BadRequestException('Invalid sandbox source fingerprint');
    if (
      !Array.isArray(input.manifest) ||
      input.manifest.length > MAX_CALLS ||
      new Set(input.manifest).size !== input.manifest.length ||
      !input.manifest.every(
        (tool) => typeof tool === 'string' && TOOL.test(tool),
      )
    )
      throw new BadRequestException('Invalid sandbox tool manifest');
    const entries =
      input.limits &&
      typeof input.limits === 'object' &&
      !Array.isArray(input.limits)
        ? Object.entries(input.limits)
        : [];
    if (
      !entries.length ||
      entries.length > 16 ||
      !entries.every(
        ([name, value]) =>
          LIMIT_FIELDS.has(name) &&
          typeof value === 'number' &&
          Number.isFinite(value) &&
          value >= 0,
      )
    )
      throw new BadRequestException('Invalid sandbox audit limits');
    const limits = Object.fromEntries(entries);
    const manifest = [...input.manifest];
    // Caller objects may be reused/mutated while the transaction awaits a lock.
    input = { ...input, limits, manifest };
    const globalLimit = globalRunnerLimit();
    const key = sourceKey();
    const nonce = randomBytes(12);
    let ciphertext: Buffer;
    let authTag: Buffer;
    let keyId: string;
    try {
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      // Bind ciphertext to its immutable principal/artifact/runtime identity.
      cipher.setAAD(
        Buffer.from(
          JSON.stringify([
            'vendix-sandbox-source-v1',
            input.id,
            input.objective_id,
            scope.organization_id,
            scope.store_id,
            scope.user_id,
            input.source_hash,
            input.policy_digest,
            input.runtime_digest,
          ]),
        ),
      );
      ciphertext = Buffer.concat([
        cipher.update(source, 'utf8'),
        cipher.final(),
      ]);
      authTag = cipher.getAuthTag();
      keyId = createHash('sha256').update(key).digest('hex').slice(0, 16);
    } finally {
      key.fill(0);
    }
    await this.transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT set_config('lock_timeout', '1000ms', true)`,
      );
      // Serialize admission across all API workers. No raw cross-tenant rows leave SQL.
      // Prisma 7's pg adapter cannot deserialize PostgreSQL void-returning locks.
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(${ADMISSION_LOCK}::bigint)`,
      );
      const objective = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM ai_agent_objectives WHERE id = ${input.objective_id}::uuid
        AND ${scopeSql(scope)} AND expires_at > CURRENT_TIMESTAMP
        AND semantic_status NOT IN ('cancelled', 'superseded', 'completed_verified', 'expired')
        FOR KEY SHARE`);
      if (!objective[0])
        throw new NotFoundException('Sandbox objective not found');
      // One original script plus at most one repair for this durable objective.
      // Count terminal/expired leases too: new source, turn or cooldown is not a reset.
      const attempts = await tx.$queryRaw<
        Array<{ attempt_count: number }>
      >(Prisma.sql`
        SELECT COUNT(*)::int AS attempt_count FROM ai_agent_script_runs
        WHERE objective_id = ${input.objective_id}::uuid AND ${scopeSql(scope)}`);
      if (
        !attempts[0] ||
        !Number.isSafeInteger(attempts[0].attempt_count) ||
        attempts[0].attempt_count < 0 ||
        attempts[0].attempt_count >= 2
      )
        throw new ConflictException(
          'Sandbox objective script attempts are exhausted',
        );
      const admission = await tx.$queryRaw<
        Array<{ global_count: number; store_count: number }>
      >(Prisma.sql`
        SELECT COUNT(*)::int AS global_count,
        COUNT(*) FILTER (WHERE store_id = ${scope.store_id})::int AS store_count
        FROM ai_agent_script_runs
        WHERE lease_until > CURRENT_TIMESTAMP AND expires_at > CURRENT_TIMESTAMP`);
      if (
        !admission[0] ||
        !Number.isSafeInteger(admission[0].store_count) ||
        admission[0].store_count < 0 ||
        !Number.isSafeInteger(admission[0].global_count) ||
        admission[0].global_count < 0 ||
        admission[0].store_count >= 1 ||
        admission[0].global_count >= globalLimit
      )
        throw new ConflictException('Sandbox runner capacity is unavailable');
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO ai_agent_script_runs
          (id, store_id, organization_id, user_id, objective_id, source_hash,
           source_ciphertext, source_nonce, source_auth_tag, source_key_id,
           policy_digest, runtime_digest, limits, manifest, lease_until, expires_at)
        VALUES (${input.id}::uuid, ${scope.store_id}, ${scope.organization_id}, ${scope.user_id},
          ${input.objective_id}::uuid, ${input.source_hash}, ${ciphertext}, ${nonce}, ${authTag}, ${keyId},
          ${input.policy_digest}, ${input.runtime_digest}, ${json(limits)}, ${json(manifest)},
          CURRENT_TIMESTAMP + INTERVAL '30 seconds', CURRENT_TIMESTAMP + INTERVAL '7 days')`);
    });
  }

  async appendCall(id: string, entry: SandboxAuditCall): Promise<void> {
    const scope = requireScope();
    this.validId(id);
    const ref =
      entry.result_ref === undefined
        ? undefined
        : RESULT_REF.exec(entry.result_ref);
    if (
      !Number.isSafeInteger(entry.seq) ||
      entry.seq <= 0 ||
      entry.seq > MAX_CALLS ||
      typeof entry.tool !== 'string' ||
      !TOOL.test(entry.tool) ||
      !HASH.test(entry.args_hash) ||
      !CALL_STATUSES.has(entry.status) ||
      (entry.denial !== undefined && !DENIALS.has(entry.denial)) ||
      (entry.result_ref !== undefined && !ref)
    )
      throw new BadRequestException('Invalid sandbox call audit metadata');
    const safe: SandboxAuditCall = {
      seq: entry.seq,
      tool: entry.tool,
      args_hash: entry.args_hash,
      status: entry.status,
      ...(entry.result_ref ? { result_ref: entry.result_ref } : {}),
      ...(entry.denial ? { denial: entry.denial } : {}),
    };
    await this.transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        UPDATE ai_agent_script_runs SET calls = calls || ${json([safe])}
        WHERE id = ${id}::uuid AND ${scopeSql(scope)}
        AND outcome = 'running' AND lease_until > CURRENT_TIMESTAMP AND expires_at > CURRENT_TIMESTAMP
        AND jsonb_array_length(calls) < ${MAX_CALLS * 2}
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(calls) call
          WHERE (call->>'seq')::int = ${safe.seq} AND call->>'status' <> 'dispatching')
        AND ((${safe.status === 'dispatching'} AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(calls) call WHERE (call->>'seq')::int = ${safe.seq}))
          OR (${safe.status !== 'dispatching'} AND (
            (${safe.status === 'denied'} AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(calls) call WHERE (call->>'seq')::int = ${safe.seq}))
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(calls) call
              WHERE (call->>'seq')::int = ${safe.seq} AND call->>'status' = 'dispatching'
              AND call->>'tool' = ${safe.tool} AND call->>'args_hash' = ${safe.args_hash}))))
        AND (${safe.status === 'denied'} OR manifest ? ${safe.tool})
        ${
          ref
            ? Prisma.sql`AND EXISTS (SELECT 1 FROM ai_agent_tool_results result
          WHERE result.id = ${ref[1]}::uuid AND result.objective_id = ai_agent_script_runs.objective_id
          AND result.store_id = ${scope.store_id} AND result.organization_id = ${scope.organization_id}
          AND result.user_id = ${scope.user_id} AND result.tool_name = ${safe.tool})`
            : Prisma.empty
        }
        RETURNING id`);
      if (!rows[0])
        throw new ConflictException('Sandbox audit call is not current');
    });
  }

  async finish(
    id: string,
    outcome: string,
    usage: Record<string, unknown>,
  ): Promise<void> {
    const scope = requireScope();
    this.validId(id);
    if (
      !OUTCOMES.has(outcome) ||
      !usage ||
      typeof usage !== 'object' ||
      Array.isArray(usage)
    )
      throw new BadRequestException('Invalid sandbox final audit metadata');
    const safeUsage = redactUsage(usage);
    await this.transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        UPDATE ai_agent_script_runs SET outcome = ${outcome}, usage = ${json(safeUsage)},
          finished_at = CURRENT_TIMESTAMP
        WHERE id = ${id}::uuid AND ${scopeSql(scope)} AND outcome = 'running'
        AND expires_at > CURRENT_TIMESTAMP RETURNING id`);
      if (rows[0]) return;
      const previous = await tx.$queryRaw<
        Array<{ outcome: string }>
      >(Prisma.sql`
        SELECT outcome FROM ai_agent_script_runs WHERE id = ${id}::uuid AND ${scopeSql(scope)}
        AND expires_at > CURRENT_TIMESTAMP`);
      // Network retries may observe the same terminal state, never rewrite its evidence.
      if (previous[0]?.outcome === outcome) return;
      throw new ConflictException('Sandbox run is not current');
    });
  }

  async get(id: string): Promise<SandboxAuditRecord> {
    const scope = requireScope();
    this.validId(id);
    const rows = await this.transaction((tx) =>
      tx.$queryRaw<SandboxAuditRecord[]>(Prisma.sql`
      SELECT id, store_id, organization_id, user_id, objective_id, source_hash,
        policy_digest, runtime_digest, limits, manifest, calls, outcome, usage,
        lease_until, expires_at, created_at, finished_at
      FROM ai_agent_script_runs WHERE id = ${id}::uuid AND ${scopeSql(scope)}
      AND expires_at > CURRENT_TIMESTAMP`),
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Sandbox run not found');
    return {
      id: row.id,
      store_id: row.store_id,
      organization_id: row.organization_id,
      user_id: row.user_id,
      objective_id: row.objective_id,
      source_hash: row.source_hash,
      policy_digest: row.policy_digest,
      runtime_digest: row.runtime_digest,
      limits: row.limits,
      manifest: row.manifest,
      calls: row.calls,
      usage: row.usage,
      outcome:
        row.outcome === 'running' && row.lease_until.getTime() <= Date.now()
          ? 'timeout'
          : row.outcome,
      lease_until: row.lease_until,
      expires_at: row.expires_at,
      created_at: row.created_at,
      finished_at: row.finished_at,
    };
  }
}
