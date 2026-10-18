import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { RequestContextService } from '../../common/context/request-context.service';
import { AgentDeadline, agentDeadlineContext } from '../tasks/agent-deadline';
import { safeObjectiveArtifact } from '../tasks/agent-artifact-safety';
import { objectiveArgsHash } from '../tasks/agent-durable-session.service';
import { countsAsToolSuccess } from '../tools/tool-result.normalizer';
import { AIToolRegistry } from '../tools/ai-tool-registry';
import { SandboxClientService } from './sandbox-client.service';
import { SandboxPolicyService } from './sandbox-policy.service';
import {
  SandboxAuditRepository,
  sandboxSourceHash,
} from './sandbox-audit.repository';
import { sandboxInvocation } from './sandbox-invocation.context';
import {
  SANDBOX_LIMITS,
  SandboxCall,
  SandboxError,
  SandboxReply,
  SandboxStart,
  sandboxEnabled,
  sandboxStoreEnabled,
} from './interfaces/sandbox-protocol.interface';

const NEXT =
  'Usa list_products por páginas o un reporte/agregación existente; no reintentes automáticamente el sandbox.';

@Injectable()
export class SandboxBrokerService {
  constructor(
    private readonly registry: AIToolRegistry,
    private readonly policy: SandboxPolicyService,
    private readonly client: SandboxClientService,
    private readonly audit: SandboxAuditRepository,
  ) {}

  async run(raw: unknown): Promise<string> {
    const invocation = sandboxInvocation.getStore();
    const ctx = RequestContextService.asyncLocalStorage.getStore();
    const config = this.client.configuration();
    // No local executable fallback. Jobs without this host capability cannot use it.
    if (
      !sandboxEnabled() ||
      !invocation ||
      !ctx?.user_id ||
      !ctx.store_id ||
      !ctx.organization_id ||
      !sandboxStoreEnabled(ctx.store_id) ||
      !config
    )
      return this.failure('SANDBOX_UNAVAILABLE');
    const snapshot = Object.freeze({
      ...ctx,
      permissions: [...(ctx.permissions ?? [])],
      roles: [...(ctx.roles ?? [])],
    });
    const executionId = randomUUID();
    const nonce = randomBytes(32).toString('hex');
    const parent = agentDeadlineContext.getStore();
    const started = Date.now();
    let opened = false;
    let closed = false;
    let expectedSeq = 1;
    let inFlight = 0;
    let calls = 0;
    let pages = 0;
    let rows = 0;
    let inputBytes = 0;
    let outputBytes = 0;
    let denials = 0;
    let outcome = 'failed';
    let terminalCode: SandboxError['code'] | undefined;
    const refs: string[] = [];
    let readQueue: Promise<unknown> = Promise.resolve();
    const deadline = new AgentDeadline({
      wallDeadlineMs: Math.min(
        started + SANDBOX_LIMITS.wall_ms,
        parent?.deadlineMs ?? Infinity,
        invocation.durable.objective.expires_at.getTime(),
      ),
      activeBudgetMs: Math.min(
        SANDBOX_LIMITS.wall_ms,
        Math.max(
          0,
          1_800_000 - invocation.durable.objective.budget.active_runtime_ms,
        ),
      ),
      reserveMs: 100,
      signal: parent?.signal,
    });
    const assertLive = () => {
      if (closed) throw new SandboxError('SANDBOX_EXPIRED');
      if (!sandboxEnabled() || !sandboxStoreEnabled(snapshot.store_id))
        throw new SandboxError('SANDBOX_DENIED');
      deadline.assertCanStart();
    };
    try {
      const request = this.policy.validateRequest(raw);
      await invocation.durable.assertBudget();
      const current = await invocation.revalidate();
      assertLive();
      if (
        request.tools.some(
          (name) =>
            !invocation.initialNames.includes(name) || !current.includes(name),
        )
      )
        throw new SandboxError('SANDBOX_DENIED');
      const limits = {
        ...SANDBOX_LIMITS,
        concurrency: 1, // Initial audited list_products has no parallelSafe declaration.
        calls: Math.min(
          SANDBOX_LIMITS.calls,
          Math.max(0, 999 - invocation.durable.objective.budget.tools),
        ),
        // Leave teardown time inside the non-renewable admission lease.
        wall_ms: Math.max(0, Math.floor(deadline.remainingMs() - 12_000)),
      };
      if (!limits.calls || limits.wall_ms < 1)
        throw new SandboxError('SANDBOX_LIMIT');
      await this.policy.authorize(
        snapshot,
        invocation.agentKey,
        request.tools,
        invocation.durable.objective.authority_snapshot,
        async (_ctx, names) => {
          if (
            request.tools.some(
              (name) =>
                !names.includes(name) ||
                !this.policy.eligible(this.registry.get(name)),
            )
          )
            throw new SandboxError('SANDBOX_DENIED');
        },
      );
      assertLive();
      await this.audit.start({
        id: executionId,
        objective_id: invocation.durable.objective_id,
        source: request.source,
        source_hash: sandboxSourceHash(request.source),
        ...config,
        limits: { ...limits },
        manifest: request.tools,
      });
      opened = true;
      limits.wall_ms = Math.min(
        limits.wall_ms,
        Math.floor(deadline.remainingMs() - 12_000),
      );
      if (limits.wall_ms < 1) throw new SandboxError('SANDBOX_EXPIRED');
      const start: SandboxStart = {
        type: 'start',
        execution_id: executionId,
        nonce,
        source: request.source,
        language: request.language,
        tools: request.tools,
        limits,
        ...config,
      };
      const onCall = async (untrusted: SandboxCall): Promise<SandboxReply> => {
        let seq = 0;
        let tool = 'invalid';
        let argsHash = objectiveArgsHash({});
        try {
          assertLive();
          const frame = this.validateFrame(
            untrusted,
            executionId,
            nonce,
            expectedSeq,
          );
          seq = frame.seq;
          tool = frame.tool;
          expectedSeq++;
          if (
            !request.tools.includes(tool) ||
            !this.policy.eligible(this.registry.get(tool))
          )
            throw new SandboxError('SANDBOX_DENIED');
          this.policy.assertArgs(tool, frame.args);
          argsHash = objectiveArgsHash(frame.args);
          if (
            inFlight >= limits.concurrency ||
            calls >= limits.calls ||
            pages >= limits.pages
          )
            throw new SandboxError('SANDBOX_LIMIT');
          calls++;
          pages++;
          inFlight++;
          const work = async () => {
            await invocation.durable.assertBudget();
            const freshNames = await invocation.revalidate();
            assertLive();
            if (!freshNames.includes(tool))
              throw new SandboxError('SANDBOX_DENIED');
            return this.policy.authorize(
              snapshot,
              invocation.agentKey,
              request.tools,
              invocation.durable.objective.authority_snapshot,
              async (_fresh, names) => {
                assertLive();
                if (!names.includes(tool))
                  throw new SandboxError('SANDBOX_DENIED');
                await this.audit.appendCall(executionId, {
                  seq,
                  tool,
                  args_hash: argsHash,
                  status: 'dispatching',
                });
                assertLive();
                const result = await agentDeadlineContext.run(deadline, () =>
                  this.registry.executeToolResult(tool, frame.args, {
                    evidenceRef: `sandbox:${executionId}:${seq}`,
                  }),
                );
                // Even a non-cooperative read may complete after revoke: no publishing it.
                assertLive();
                await invocation.durable.assertCurrent();
                await this.policy.authorize(
                  snapshot,
                  invocation.agentKey,
                  request.tools,
                  invocation.durable.objective.authority_snapshot,
                  async (_current, allowed) => {
                    if (!allowed.includes(tool))
                      throw new SandboxError('SANDBOX_DENIED');
                  },
                );
                const filtered = this.policy.filterResult(tool, result);
                const bytes = Buffer.byteLength(JSON.stringify(filtered));
                const data = filtered.data as { products?: unknown[] } | null;
                const count = data?.products?.length ?? 0;
                if (
                  inputBytes + bytes > limits.input_bytes ||
                  rows + count > limits.rows
                )
                  throw new SandboxError('SANDBOX_LIMIT');
                inputBytes += bytes;
                rows += count;
                // Full allowed result persisted BEFORE returning a single guest byte.
                const artifact = await invocation.record(
                  seq,
                  tool,
                  frame.args,
                  filtered,
                );
                const ref = `agent-result:${artifact}`;
                refs.push(ref);
                await this.audit.appendCall(executionId, {
                  seq,
                  tool,
                  args_hash: argsHash,
                  status: filtered.status,
                  result_ref: ref,
                });
                assertLive();
                if (!countsAsToolSuccess(filtered)) outcome = 'partial';
                return {
                  type: 'reply' as const,
                  execution_id: executionId,
                  nonce,
                  seq,
                  result: filtered,
                };
              },
            );
          };
          // Current allowlist is serial; keep objective CAS updates in one chain.
          const pending = readQueue.then(work);
          readQueue = pending.catch(() => undefined);
          try {
            return await deadline.run(() => pending);
          } finally {
            inFlight--;
          }
        } catch (error) {
          denials++;
          closed = true;
          const code = this.code(error);
          terminalCode ??= code;
          if (seq)
            await this.audit
              .appendCall(executionId, {
                seq,
                tool,
                args_hash: argsHash,
                status: 'denied',
                denial: code,
              })
              .catch(() => undefined);
          deadline.cancel(); // A caught guest denial cannot continue by fabricating a result.
          throw new SandboxError(code);
        }
      };
      const value = await deadline.run(() =>
        this.client.run(start, onCall, deadline.signal),
      );
      assertLive();
      if (inFlight) throw new SandboxError('SANDBOX_PROTOCOL');
      await invocation.durable.assertCurrent();
      const finalAuthority = await invocation.revalidate();
      if (request.tools.some((name) => !finalAuthority.includes(name)))
        throw new SandboxError('SANDBOX_DENIED');
      await this.policy.authorize(
        snapshot,
        invocation.agentKey,
        request.tools,
        invocation.durable.objective.authority_snapshot,
        async (_fresh, names) => {
          if (request.tools.some((name) => !names.includes(name)))
            throw new SandboxError('SANDBOX_DENIED');
        },
      );
      assertLive();
      if (!calls || (calls < 2 && request.purpose !== 'pagination'))
        throw new SandboxError('SANDBOX_DENIED');
      const safe = safeObjectiveArtifact(value);
      outputBytes = Buffer.byteLength(JSON.stringify(safe) ?? 'null');
      if (outputBytes > limits.output_bytes)
        throw new SandboxError('SANDBOX_LIMIT');
      if (outcome !== 'partial') outcome = 'ok';
      return JSON.stringify({
        schema_version: '1',
        status: 'ok',
        error_code: null,
        retryable: false,
        next_action:
          'Cálculo no verificado: contrasta con las lecturas referenciadas antes de concluir. Nunca autoriza cambios.',
        evidence_refs: refs,
        resource_ids: {},
        pagination: null,
        freshness: 'observed',
        effect_status: 'not_applicable',
        data: {
          value: safe,
          script_run_ref: executionId,
          verified: false,
          dataset_complete: false,
          partial: outcome === 'partial',
        },
      });
    } catch (error) {
      const code = terminalCode ?? this.code(error);
      outcome =
        code === 'SANDBOX_UNAVAILABLE'
          ? 'unavailable'
          : code === 'SANDBOX_EXPIRED'
            ? parent?.signal.aborted
              ? 'cancelled'
              : 'timeout'
            : 'denied';
      return this.failure(code, refs, executionId);
    } finally {
      closed = true;
      deadline.dispose();
      if (opened) {
        // No source/args/values/errors in logs or audit metadata.
        await this.audit.finish(executionId, outcome, {
          calls,
          pages,
          rows,
          input_bytes: inputBytes,
          output_bytes: outputBytes,
          denials,
          wall_ms: Date.now() - started,
          cpu_ms: null,
          memory_mb: null,
          cost_usd: null,
          verified: false,
        });
      }
    }
  }

  private validateFrame(
    raw: unknown,
    id: string,
    nonce: string,
    expected: number,
  ): SandboxCall {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new SandboxError('SANDBOX_PROTOCOL');
    const frame = raw as SandboxCall;
    if (
      Object.keys(frame).sort().join(',') !==
        'args,execution_id,nonce,seq,tool,type' ||
      frame.type !== 'call' ||
      frame.execution_id !== id ||
      frame.nonce !== nonce ||
      !Number.isSafeInteger(frame.seq) ||
      frame.seq !== expected ||
      typeof frame.tool !== 'string' ||
      !/^[a-z][a-z0-9_]{0,79}$/.test(frame.tool) ||
      Buffer.byteLength(JSON.stringify(frame)) > 16 * 1024
    )
      throw new SandboxError('SANDBOX_PROTOCOL');
    return frame;
  }
  private code(error: unknown): SandboxError['code'] {
    if (error instanceof SandboxError) return error.code;
    if ((error as Error)?.name === 'AbortError') return 'SANDBOX_EXPIRED';
    return 'SANDBOX_DENIED';
  }
  private failure(code: string, refs: string[] = [], runId?: string): string {
    return JSON.stringify({
      schema_version: '1',
      status: 'blocked',
      error_code: code,
      retryable: false,
      next_action: NEXT,
      evidence_refs: refs,
      resource_ids: {},
      pagination: null,
      freshness: 'unknown',
      effect_status: 'not_applicable',
      data: {
        script_run_ref: runId ?? null,
        verified: false,
        partial: refs.length > 0,
      },
    });
  }
}
