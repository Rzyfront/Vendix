import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { RequestContextService } from '../../common/context/request-context.service';
import { AgentDeadline, agentDeadlineContext } from '../tasks/agent-deadline';
import {
  ANALYSIS_LIMITS,
  ANALYSIS_PROTOCOL,
  AnalysisError,
  AnalysisFailureCode,
  AnalysisRequest,
  AnalysisRunRequest,
  AnalysisRunResult,
  AnalysisRunner,
} from './interfaces/analysis-protocol.interface';
import {
  normalizeSandboxSource,
  SandboxAuditRepository,
  sandboxSourceHash,
} from './sandbox-audit.repository';
import { sandboxInvocation } from './sandbox-invocation.context';
import { SandboxLambdaClientService } from './sandbox-lambda-client.service';
import { validateAnalysisInputs } from './analysis-output.validator';

/** Constant fingerprint of the analysis protocol and its numeric limits. */
const POLICY_DIGEST = `sha256:${createHash('sha256')
  .update(JSON.stringify({ protocol: ANALYSIS_PROTOCOL, limits: ANALYSIS_LIMITS }))
  .digest('hex')}`;
const TEARDOWN_RESERVE_MS = 2_000;

/**
 * Analysis runner behind the existing admission/audit guarantees. It never
 * executes code: it only audits intent and asks the isolated Lambda to run it.
 */
@Injectable()
export class SandboxAnalysisBrokerService implements AnalysisRunner {
  private readonly logger = new Logger(SandboxAnalysisBrokerService.name);

  constructor(
    private readonly client: SandboxLambdaClientService,
    private readonly audit: SandboxAuditRepository,
  ) {}

  available(): boolean {
    return !!this.client.configuration() && this.audit.sourceAvailable();
  }

  async run(request: AnalysisRunRequest): Promise<AnalysisRunResult> {
    const invocation = sandboxInvocation.getStore();
    const ctx = RequestContextService.asyncLocalStorage.getStore();
    const config = this.client.configuration();
    if (
      !invocation ||
      !ctx?.user_id ||
      !ctx.store_id ||
      !ctx.organization_id ||
      !config ||
      !this.audit.sourceAvailable()
    )
      throw new AnalysisError('ANALYSIS_UNAVAILABLE');

    if (typeof request?.source !== 'string')
      throw new AnalysisError('ANALYSIS_INPUT', 'source must be a string');
    const source = normalizeSandboxSource(request.source);
    if (
      !source.trim().length ||
      Buffer.byteLength(source, 'utf8') > ANALYSIS_LIMITS.source_bytes
    )
      throw new AnalysisError('ANALYSIS_INPUT', 'source is empty or too large');
    const inputs = validateAnalysisInputs(request.inputs, ANALYSIS_LIMITS);
    const sourceHash = sandboxSourceHash(source);

    const executionId = randomUUID();
    const nonce = randomBytes(32).toString('hex');
    const parent = agentDeadlineContext.getStore();
    const started = Date.now();
    const objective = invocation.durable.objective;
    const deadline = new AgentDeadline({
      wallDeadlineMs: Math.min(
        started + ANALYSIS_LIMITS.wall_ms + TEARDOWN_RESERVE_MS,
        parent?.deadlineMs ?? Infinity,
        objective.expires_at.getTime(),
      ),
      activeBudgetMs: Math.min(
        ANALYSIS_LIMITS.wall_ms + TEARDOWN_RESERVE_MS,
        Math.max(0, 1_800_000 - objective.budget.active_runtime_ms),
      ),
      reserveMs: TEARDOWN_RESERVE_MS,
      signal: parent?.signal,
    });
    let opened = false;
    let outcome = 'failed';
    let outputBytes = 0;
    try {
      await invocation.durable.assertBudget();
      deadline.assertCanStart();
      const wallMs = Math.min(
        ANALYSIS_LIMITS.wall_ms,
        Math.floor(deadline.remainingMs()),
      );
      if (wallMs < 1) throw new AnalysisError('ANALYSIS_EXPIRED');
      const limits = { ...ANALYSIS_LIMITS, wall_ms: wallMs };
      // Audit intent (and admission: one slot per store, global cap) BEFORE dispatch.
      try {
        await this.audit.start({
          id: executionId,
          objective_id: invocation.durable.objective_id,
          source,
          source_hash: sourceHash,
          policy_digest: POLICY_DIGEST,
          runtime_digest: config.runtimeDigest,
          limits: {
            wall_ms: wallMs,
            cpu_ms: ANALYSIS_LIMITS.cpu_s * 1000,
            memory_mb: ANALYSIS_LIMITS.memory_mb,
            source_bytes: ANALYSIS_LIMITS.source_bytes,
            input_bytes: ANALYSIS_LIMITS.input_bytes,
            output_bytes: ANALYSIS_LIMITS.output_bytes,
            rows: ANALYSIS_LIMITS.input_rows,
          },
          manifest: [],
        });
      } catch (error) {
        // Capacity, cooldown and attempt exhaustion are ConflictException.
        if (error instanceof ConflictException)
          throw new AnalysisError('ANALYSIS_LIMIT');
        throw error;
      }
      opened = true;
      deadline.assertCanStart();
      const payload: AnalysisRequest = {
        protocol: ANALYSIS_PROTOCOL,
        execution_id: executionId,
        nonce,
        language: 'python',
        source,
        inputs,
        limits,
      };
      const output = await deadline.run(() =>
        this.client.invoke(payload, deadline.signal),
      );
      outputBytes = Buffer.byteLength(JSON.stringify(output), 'utf8');
      outcome = 'ok';
      return {
        run_id: executionId,
        source_hash: sourceHash,
        output,
        usage: { duration_ms: Date.now() - started },
      };
    } catch (error) {
      const code = this.code(error);
      outcome = this.outcome(code, !!parent?.signal.aborted);
      throw error instanceof AnalysisError && error.code === code
        ? error
        : new AnalysisError(code);
    } finally {
      deadline.dispose();
      if (opened) {
        try {
          // No source, inputs, outputs or guest text in audit metadata.
          await this.audit.finish(executionId, outcome, {
            calls: 0,
            pages: 0,
            rows: 0,
            input_bytes: 0,
            output_bytes: outputBytes,
            denials: outcome === 'denied' ? 1 : 0,
            wall_ms: Date.now() - started,
            cpu_ms: null,
            memory_mb: null,
            cost_usd: null,
            verified: false,
          });
        } catch {
          this.logger.warn(`analysis audit finish failed id=${executionId}`);
        }
      }
    }
  }

  private code(error: unknown): AnalysisFailureCode {
    if (error instanceof AnalysisError) return error.code;
    if ((error as Error)?.name === 'AbortError') return 'ANALYSIS_EXPIRED';
    return 'ANALYSIS_UNAVAILABLE';
  }

  private outcome(code: AnalysisFailureCode, parentCancelled: boolean): string {
    switch (code) {
      case 'ANALYSIS_UNAVAILABLE':
        return 'unavailable';
      case 'ANALYSIS_EXPIRED':
        return parentCancelled ? 'cancelled' : 'timeout';
      case 'ANALYSIS_TIMEOUT':
        return 'timeout';
      case 'ANALYSIS_DENIED':
      case 'ANALYSIS_LIMIT':
      case 'ANALYSIS_INPUT':
        return 'denied';
      default:
        return 'failed';
    }
  }
}
