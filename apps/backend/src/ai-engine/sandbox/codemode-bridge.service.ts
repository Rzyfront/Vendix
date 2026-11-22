import { ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { RequestContextService } from '../../common/context/request-context.service';
import { AgentDeadline, agentDeadlineContext } from '../tasks/agent-deadline';
import { AIToolRegistry } from '../tools/ai-tool-registry';
import type { ToolExecutionResult } from '../tools/interfaces/tool.interface';
import { codeModeInvocation } from './codemode-invocation.context';
import { CodeModePolicyService } from './codemode-policy.service';
import { validateCodeModeResponse } from './codemode-response.validator';
import {
  CODEMODE_LIMITS,
  CODEMODE_PROTOCOL,
  CodeModeCallSummary,
  CodeModeError,
  CodeModeFailureCode,
  CodeModeJournalEntry,
  CodeModeJson,
  CodeModeRoundRequest,
  CodeModeRunRequest,
  CodeModeRunResult,
  CodeModeRunner,
  codeModeArgsHash,
  codeModeCanonicalJson,
} from './interfaces/codemode-protocol.interface';
import { SandboxError } from './interfaces/sandbox-protocol.interface';
import { dispatchSandboxTool } from './sandbox-broker.service';
import {
  normalizeSandboxSource,
  SandboxAuditRepository,
  sandboxSourceHash,
} from './sandbox-audit.repository';
import {
  codeModeTenantId,
  SandboxLambdaClientService,
} from './sandbox-lambda-client.service';

/** Constant fingerprint of the Code Mode protocol and its numeric limits. */
const POLICY_DIGEST = `sha256:${createHash('sha256')
  .update(JSON.stringify({ protocol: CODEMODE_PROTOCOL, limits: CODEMODE_LIMITS }))
  .digest('hex')}`;
const TOOL_NAME = /^[a-z][a-z0-9_]{0,79}$/;
const MAX_OUTCOME_ERROR = 300;
const MAX_REQUEST_IDS = 20;
/** Keys that would let a script name a tenant. Compared without case, `_` or `-`. */
const TENANT_KEYS = new Set(['storeid', 'organizationid', 'tenantid', 'orgid']);

/** A call the host refuses: the script sees a rejected promise, the run goes on. */
class CallDenied extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** True when any key at any depth names a tenant (store/organization/tenant id). */
export function containsTenantKey(value: unknown, depth = 0): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (depth > 32) return true; // unreasonably deep: refuse rather than scan
  if (Array.isArray(value))
    return value.some((item) => containsTenantKey(item, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) =>
      TENANT_KEYS.has(key.toLowerCase().replace(/[_-]/g, '')) ||
      containsTenantKey(child, depth + 1),
  );
}

/** Rows a tool result hands to the script: its largest array (or itself). */
function rowCount(data: unknown): number {
  if (Array.isArray(data)) return data.length;
  if (data === null || typeof data !== 'object') return 0;
  return Math.max(
    0,
    ...Object.values(data as Record<string, unknown>).map((value) =>
      Array.isArray(value) ? value.length : 0,
    ),
  );
}

const bytesOf = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8');

/**
 * F10 (T64) host bridge, channel A: re-invocation with pending calls and
 * deterministic replay. The Lambda NEVER executes a tool. Each round it
 * returns the calls it is waiting for; THIS service runs every one through the
 * authority pipeline (frame, manifest, re-derived authorization, argument
 * schema, scoped registry, size/row filter, audit) and only then appends it to
 * the journal.
 *
 * The journal lives ONLY in this process' memory for the life of one execution
 * (<= wall_ms = 30 s). Deviation from the plan (Redis): an execution never
 * resumes in another process, so there is nothing to share, and a journal the
 * host cannot read back from anywhere but its own memory cannot be forged. The
 * Lambda receives a COPY each round and its response has no journal field.
 */
@Injectable()
export class CodeModeBridgeService implements CodeModeRunner {
  private readonly logger = new Logger(CodeModeBridgeService.name);

  constructor(
    private readonly registry: AIToolRegistry,
    private readonly policy: CodeModePolicyService,
    private readonly client: SandboxLambdaClientService,
    private readonly audit: SandboxAuditRepository,
  ) {}

  /** Off unless enabled, configured AND certified for the deployed digest. */
  available(): boolean {
    return !!this.client.codeModeConfiguration() && this.audit.sourceAvailable();
  }

  async run(request: CodeModeRunRequest): Promise<CodeModeRunResult> {
    const invocation = codeModeInvocation.getStore();
    const ctx = RequestContextService.asyncLocalStorage.getStore();
    const config = this.client.codeModeConfiguration();
    // Checked before anything else: off means nothing is invoked or audited.
    if (
      !invocation ||
      !ctx?.user_id ||
      !ctx.store_id ||
      !ctx.organization_id ||
      !config ||
      !this.audit.sourceAvailable()
    )
      throw new CodeModeError('CODEMODE_UNAVAILABLE');

    const limits = CODEMODE_LIMITS;
    const source = this.validSource(request);
    const manifest = this.validManifest(request);
    // Tenant, user, roles and permissions are fixed HERE from the session.
    const snapshot = Object.freeze({
      ...ctx,
      permissions: [...(ctx.permissions ?? [])],
      roles: [...(ctx.roles ?? [])],
    });
    const frozen = {
      store_id: ctx.store_id,
      organization_id: ctx.organization_id,
      user_id: ctx.user_id,
    };
    const durable = invocation.durable;
    const objectivePermissions =
      durable?.objective.authority_snapshot ?? snapshot.permissions;
    const tenantId = codeModeTenantId(frozen.store_id);
    const executionId = randomUUID();
    const nonce = randomBytes(32).toString('hex');
    const seed = randomBytes(32).toString('hex');
    const sourceHash = sandboxSourceHash(source);
    const started = Date.now();
    const parent = agentDeadlineContext.getStore();
    const deadline = new AgentDeadline({
      wallDeadlineMs: Math.min(
        started + limits.wall_ms,
        parent?.deadlineMs ?? Infinity,
        durable?.objective.expires_at.getTime() ?? Infinity,
      ),
      activeBudgetMs: limits.wall_ms,
      reserveMs: 100,
      signal: parent?.signal,
    });
    const assertLive = () => deadline.assertCanStart();
    const assertTenant = () => {
      const current = RequestContextService.asyncLocalStorage.getStore();
      if (
        !current ||
        current.store_id !== frozen.store_id ||
        current.organization_id !== frozen.organization_id ||
        current.user_id !== frozen.user_id
      )
        throw new CodeModeError(
          'CODEMODE_TENANT_CHANGED',
          'La sesión cambió de tienda o de usuario durante el script; se canceló.',
        );
    };

    // Server-side only. Never read back from the Lambda.
    const journal: CodeModeJournalEntry[] = [];
    let journalBytes = 2;
    const summaries: CodeModeCallSummary[] = [];
    const requestIds: string[] = [];
    let rowsSeen = 0;
    let denials = 0;
    let rounds = 0;
    let returnedBytes = 0;
    let softFailures = 0;
    let outcome = 'failed';
    let cutReason: CodeModeFailureCode | undefined;
    let opened = false;

    try {
      await durable?.assertBudget();
      const current = await invocation.revalidate();
      assertLive();
      for (const name of manifest)
        if (
          !invocation.initialNames.includes(name) ||
          !current.includes(name) ||
          !this.policy.eligible(this.registry.get(name))
        )
          throw this.denied(name);
      await this.policy.authorize(
        snapshot,
        invocation.agentKey,
        manifest,
        objectivePermissions,
        async (_ctx, names) => {
          if (manifest.some((name) => !names.includes(name)))
            throw this.denied();
        },
      );
      assertLive();
      try {
        await this.audit.start({
          id: executionId,
          objective_id: durable?.objective_id,
          source,
          source_hash: sourceHash,
          policy_digest: POLICY_DIGEST,
          runtime_digest: config.runtimeDigest,
          limits: {
            wall_ms: limits.wall_ms,
            cpu_ms: limits.round_cpu_ms,
            memory_mb: limits.memory_mb,
            calls: limits.calls,
            rounds: limits.rounds,
            rows: limits.rows,
            source_bytes: limits.source_bytes,
            output_bytes: limits.output_bytes,
          },
          manifest,
          executor: 'lambda-js',
          tenant_hash: tenantId,
        });
      } catch (error) {
        // Admission (store/global capacity) or audit outage: nothing ran.
        throw new CodeModeError(
          'CODEMODE_UNAVAILABLE',
          error instanceof ConflictException
            ? 'Ya hay un script en ejecución para esta tienda; reintenta en unos segundos o usa herramientas directas.'
            : 'No se pudo registrar la auditoría del script; usa herramientas directas.',
        );
      }
      opened = true;
      const clockMs = Date.now(); // frozen `Date` for every round

      for (let round = 1; ; round++) {
        assertTenant();
        assertLive();
        const roundRequest: CodeModeRoundRequest = {
          protocol: CODEMODE_PROTOCOL,
          execution_id: executionId,
          nonce,
          round,
          language: 'javascript',
          source,
          manifest,
          journal: journal.slice(), // a COPY: the Lambda cannot alter ours
          clock_ms: clockMs,
          seed,
          limits: { ...limits },
        };
        rounds = round;
        const reply = await deadline.run(() =>
          this.client.invokeCodeMode(roundRequest, deadline.signal, tenantId),
        );
        if (reply.requestId && requestIds.length < MAX_REQUEST_IDS)
          requestIds.push(reply.requestId);
        const response = validateCodeModeResponse(
          reply.body,
          roundRequest,
          config.runtimeDigest,
        );
        if (response.status === 'error')
          throw new CodeModeError(response.error_code, response.error_message);
        if (response.status === 'completed') {
          assertTenant();
          assertLive();
          returnedBytes = bytesOf(response.result);
          outcome = denials || softFailures ? 'partial' : 'ok';
          return {
            run_id: executionId,
            source_hash: sourceHash,
            result: response.result,
            result_truncated: response.result_truncated,
            // Earlier rounds replay the same logs: only the last round counts.
            logs: response.logs,
            calls: summaries,
            rows_seen: rowsSeen,
            rounds,
            blocks: response.blocks,
            usage: { duration_ms: Date.now() - started },
          };
        }

        if (round >= limits.rounds)
          throw new CodeModeError(
            'CODEMODE_LIMIT',
            `El script necesitó más de ${limits.rounds} rondas de consultas; agrupa las llamadas con Promise.all o usa herramientas directas.`,
          );
        if (journal.length + response.pending.length > limits.calls)
          throw new CodeModeError(
            'CODEMODE_LIMIT',
            `El script superó el máximo de ${limits.calls} llamadas a herramientas; reduce las consultas o usa herramientas directas.`,
          );
        for (const call of response.pending) {
          const done = await this.executeCall({
            call,
            manifest,
            executionId,
            snapshot,
            objectivePermissions,
            invocation,
            durable,
            deadline,
            assertLive,
            assertTenant,
            rowsSeen,
          });
          rowsSeen += done.rows;
          if (done.summary.status === 'denied') denials++;
          else if (done.summary.status === 'error') softFailures++;
          summaries.push(done.summary);
          const entryBytes = bytesOf(done.entry) + 1;
          if (journalBytes + entryBytes > limits.journal_bytes)
            throw new CodeModeError(
              'CODEMODE_LIMIT',
              'Los resultados intermedios superaron el tamaño permitido; pide menos datos por llamada.',
            );
          journalBytes += entryBytes;
          journal.push(done.entry);
        }
      }
    } catch (error) {
      const failure = this.failure(error);
      cutReason = failure.code;
      outcome =
        failure.code === 'CODEMODE_UNAVAILABLE'
          ? 'unavailable'
          : failure.code === 'CODEMODE_EXPIRED'
            ? parent?.signal.aborted
              ? 'cancelled'
              : 'timeout'
            : ['CODEMODE_DENIED', 'CODEMODE_TENANT_CHANGED', 'CODEMODE_PROTOCOL'].includes(
                  failure.code,
                )
              ? 'denied'
              : 'failed';
      throw failure;
    } finally {
      deadline.dispose();
      if (opened) {
        // No source/args/values in audit metadata: counters and codes only.
        await this.audit
          .finish(
            executionId,
            outcome,
            {
              calls: journal.length,
              rows: rowsSeen,
              input_bytes: journalBytes,
              output_bytes: returnedBytes,
              denials,
              wall_ms: Date.now() - started,
            },
            {
              rounds,
              lambda_request_ids: requestIds,
              returned_bytes: returnedBytes,
              ...(cutReason ? { cut_reason: cutReason } : {}),
            },
          )
          .catch((error: unknown) =>
            this.logger.warn(
              `codemode audit finish failed id=${executionId} kind=${(error as Error)?.name ?? 'unknown'}`,
            ),
          );
      }
    }
  }

  /**
   * One pending call through the whole authority pipeline. A refused call
   * (manifest, tenant key, schema, revoked permission) becomes an ERROR outcome
   * the script sees as a rejected promise; the tool never ran. Anything else
   * unexpected (audit outage, expiry, tenant change) aborts the execution.
   */
  private async executeCall(input: {
    call: { seq: number; tool: string; args: Record<string, CodeModeJson> };
    manifest: string[];
    executionId: string;
    snapshot: NonNullable<ReturnType<typeof RequestContextService.getContext>>;
    objectivePermissions: string[];
    invocation: NonNullable<ReturnType<typeof codeModeInvocation.getStore>>;
    durable?: NonNullable<ReturnType<typeof codeModeInvocation.getStore>>['durable'];
    deadline: AgentDeadline;
    assertLive: () => void;
    assertTenant: () => void;
    rowsSeen: number;
  }): Promise<{
    entry: CodeModeJournalEntry;
    summary: CodeModeCallSummary;
    rows: number;
  }> {
    const { call, invocation, durable } = input;
    const limits = CODEMODE_LIMITS;
    const t0 = Date.now();
    input.assertLive();
    input.assertTenant();
    const argsHash = codeModeArgsHash(call.args);
    const entry = (outcome: CodeModeJournalEntry['outcome']): CodeModeJournalEntry => ({
      seq: call.seq,
      tool: call.tool,
      args_hash: argsHash,
      outcome,
    });
    try {
      await durable?.assertBudget();
      const fresh = await invocation.revalidate();
      input.assertLive();
      if (
        !input.manifest.includes(call.tool) ||
        !fresh.includes(call.tool) ||
        !this.policy.eligible(this.registry.get(call.tool))
      )
        throw new CallDenied('herramienta no autorizada');
      // A script can never name a tenant, at any depth, whatever the tool.
      if (containsTenantKey(call.args))
        throw new CallDenied('los argumentos no pueden indicar tienda ni organización');
      this.policy.assertArgs(call.tool, call.args);
      const filtered = await this.policy.authorize(
        input.snapshot,
        invocation.agentKey,
        input.manifest,
        input.objectivePermissions,
        async (_grant, names) => {
          if (!names.includes(call.tool)) throw this.denied(call.tool);
          const result: ToolExecutionResult = await dispatchSandboxTool(
            this.registry,
            this.audit,
            {
              executionId: input.executionId,
              seq: call.seq,
              tool: call.tool,
              args: call.args,
              argsHash,
              deadline: input.deadline,
              assertLive: input.assertLive,
            },
          );
          await durable?.assertCurrent();
          // Revoked while the read ran: never publish it.
          await this.policy.authorize(
            input.snapshot,
            invocation.agentKey,
            input.manifest,
            input.objectivePermissions,
            async (_current, allowed) => {
              if (!allowed.includes(call.tool)) throw this.denied(call.tool);
            },
          );
          return this.policy.filterResult(call.tool, result);
        },
      );
      input.assertTenant();
      input.assertLive();

      const count = rowCount(filtered.data);
      let outcome: CodeModeJournalEntry['outcome'];
      let status: CodeModeCallSummary['status'] = 'ok';
      let rows = 0;
      if (filtered.status !== 'ok') {
        status = 'error';
        outcome = {
          ok: false,
          error: this.bounded(
            `${filtered.error_code ?? filtered.status}: ${filtered.next_action ?? ''}`,
          ),
        };
      } else if (
        count > limits.rows ||
        input.rowsSeen + count > limits.rows
      ) {
        status = 'error';
        outcome = {
          ok: false,
          error: `El resultado supera el máximo de ${limits.rows} filas; filtra o pagina.`,
        };
      } else {
        rows = count;
        outcome = {
          ok: true,
          value: JSON.parse(
            codeModeCanonicalJson(JSON.parse(JSON.stringify(filtered.data ?? null))),
          ) as CodeModeJson,
        };
      }
      await this.audit.appendCall(input.executionId, {
        seq: call.seq,
        tool: call.tool,
        args_hash: argsHash,
        status: status === 'ok' ? filtered.status : 'blocked',
      });
      return {
        entry: entry(outcome),
        summary: {
          seq: call.seq,
          tool: call.tool,
          status,
          rows,
          duration_ms: Date.now() - t0,
        },
        rows,
      };
    } catch (error) {
      if (!this.isDenial(error)) throw error;
      const reason =
        error instanceof CallDenied ? error.reason : 'permiso o autorización revocados';
      await this.audit
        .appendCall(input.executionId, {
          seq: call.seq,
          tool: call.tool,
          args_hash: argsHash,
          status: 'denied',
          denial: 'SANDBOX_DENIED',
        })
        .catch(() => undefined);
      return {
        entry: entry({ ok: false, error: this.bounded(`DENEGADO: ${reason}`) }),
        summary: {
          seq: call.seq,
          tool: call.tool,
          status: 'denied',
          rows: 0,
          duration_ms: Date.now() - t0,
        },
        rows: 0,
      };
    }
  }

  private validSource(request: CodeModeRunRequest): string {
    if (typeof request?.source !== 'string')
      throw new CodeModeError('CODEMODE_INPUT', 'El script debe ser texto.');
    const source = normalizeSandboxSource(request.source);
    if (
      !source.trim() ||
      Buffer.byteLength(source, 'utf8') > CODEMODE_LIMITS.source_bytes
    )
      throw new CodeModeError(
        'CODEMODE_INPUT',
        'El script está vacío o supera el tamaño máximo (32 KiB).',
      );
    return source;
  }

  private validManifest(request: CodeModeRunRequest): string[] {
    const tools = request.tools;
    if (
      !Array.isArray(tools) ||
      tools.length < 1 ||
      tools.length > CODEMODE_LIMITS.manifest_tools ||
      new Set(tools).size !== tools.length ||
      tools.some((name) => typeof name !== 'string' || !TOOL_NAME.test(name))
    )
      throw new CodeModeError(
        'CODEMODE_DENIED',
        `Un script declara entre 1 y ${CODEMODE_LIMITS.manifest_tools} herramientas distintas.`,
      );
    return [...tools];
  }

  private denied(tool?: string): CodeModeError {
    return new CodeModeError(
      'CODEMODE_DENIED',
      tool && TOOL_NAME.test(tool)
        ? `La herramienta ${tool} no está autorizada para scripts en este turno.`
        : 'Las herramientas del script no están autorizadas en este turno.',
    );
  }

  /** Refusals that stay inside the run (the tool never executed). */
  private isDenial(error: unknown): boolean {
    return (
      error instanceof CallDenied ||
      error instanceof ForbiddenException ||
      error instanceof SandboxError ||
      (error instanceof CodeModeError && error.code === 'CODEMODE_DENIED')
    );
  }

  private failure(error: unknown): CodeModeError {
    if (error instanceof CodeModeError) return error;
    if ((error as Error)?.name === 'AbortError')
      return new CodeModeError(
        'CODEMODE_EXPIRED',
        'El script superó el tiempo máximo (30 s) o fue cancelado.',
      );
    if (error instanceof ForbiddenException || error instanceof SandboxError)
      return this.denied();
    // Unexpected (audit outage, durable lease lost...): fail closed, no details.
    this.logger.warn(`codemode run failed kind=${(error as Error)?.name ?? 'unknown'}`);
    return new CodeModeError(
      'CODEMODE_DENIED',
      'El script se canceló por un error de autorización o auditoría; usa herramientas directas.',
    );
  }

  private bounded(text: string): string {
    return (
      text
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
        .trim()
        .slice(0, MAX_OUTCOME_ERROR) || 'error'
    );
  }
}
