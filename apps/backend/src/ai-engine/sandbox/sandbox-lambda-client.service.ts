import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import {
  ANALYSIS_PROTOCOL,
  AnalysisError,
  AnalysisErrorCode,
  AnalysisFailureCode,
  AnalysisOutput,
  AnalysisRequest,
  AnalysisResponse,
} from './interfaces/analysis-protocol.interface';
import { validateAnalysisOutput } from './analysis-output.validator';
import {
  CodeModeError,
  CodeModeRoundRequest,
} from './interfaces/codemode-protocol.interface';

export interface LambdaInvokeTransport {
  invoke(input: {
    functionArn: string;
    region: string;
    payload: Uint8Array;
    signal: AbortSignal;
    /**
     * Opaque per-tenant key for Lambda tenant isolation (F10). Absent for the
     * analysis path, which keeps the exact InvokeCommand it always had.
     */
    tenantId?: string;
  }): Promise<{
    statusCode?: number;
    functionError?: string;
    payload?: Uint8Array;
    /** AWS request id, for audit correlation only. */
    requestId?: string;
  }>;
}

export const LAMBDA_INVOKE_TRANSPORT = Symbol('LAMBDA_INVOKE_TRANSPORT');

/** Function coordinates shared by every Lambda-backed sandbox contract. */
export interface LambdaFunctionConfig {
  functionArn: string;
  region: string;
  runtimeDigest: string;
}
export type AnalysisLambdaConfig = LambdaFunctionConfig;
export type CodeModeLambdaConfig = LambdaFunctionConfig;

const ARN =
  /^arn:aws(?:-[a-z]+)*:lambda:([a-z]{2}(?:-[a-z]+)+-\d):\d{12}:function:[A-Za-z0-9_-]{1,64}(?::[A-Za-z0-9_-]{1,128})?$/;
const REGION = /^[a-z]{2}(?:-[a-z]+)+-\d$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;
const NONCE = /^[a-f0-9]{64}$/;
const RESPONSE_SLACK_BYTES = 16 * 1024;
const REQUEST_SLACK_BYTES = 64 * 1024;
const MAX_MESSAGE = 300;
const TENANT_DOMAIN = 'vendix.codemode.tenant/v1';
const GUEST_CODES: ReadonlySet<string> = new Set<AnalysisErrorCode>([
  'ANALYSIS_INPUT',
  'ANALYSIS_SYNTAX',
  'ANALYSIS_RUNTIME',
  'ANALYSIS_TIMEOUT',
  'ANALYSIS_MEMORY',
  'ANALYSIS_OUTPUT',
]);

interface AwsLambdaModule {
  LambdaClient: new (config: { region: string; maxAttempts: number }) => {
    send(
      command: unknown,
      options: { abortSignal: AbortSignal },
    ): Promise<{
      StatusCode?: number;
      FunctionError?: string;
      Payload?: Uint8Array;
      $metadata?: { requestId?: string };
    }>;
    destroy(): void;
  };
  InvokeCommand: new (input: {
    FunctionName: string;
    InvocationType: 'RequestResponse';
    LogType: 'None';
    Payload: Uint8Array;
    TenantId?: string;
  }) => unknown;
}

/** Default transport: loads the AWS SDK lazily; absent SDK means unavailable. */
export const awsLambdaTransport: LambdaInvokeTransport = {
  async invoke({ functionArn, region, payload, signal, tenantId }) {
    let mod: AwsLambdaModule;
    try {
      // Non-literal specifier: the SDK is optional infra, never a build dependency.
      const moduleName: string = '@aws-sdk/client-lambda';
      mod = (await import(moduleName)) as AwsLambdaModule;
    } catch {
      throw new AnalysisError('ANALYSIS_UNAVAILABLE');
    }
    const client = new mod.LambdaClient({ region, maxAttempts: 1 });
    try {
      const out = await client.send(
        new mod.InvokeCommand({
          FunctionName: functionArn,
          InvocationType: 'RequestResponse',
          LogType: 'None',
          Payload: payload,
          ...(tenantId ? { TenantId: tenantId } : {}),
        }),
        { abortSignal: signal },
      );
      return {
        statusCode: out.StatusCode,
        functionError: out.FunctionError,
        payload: out.Payload,
        requestId: out.$metadata?.requestId,
      };
    } finally {
      client.destroy();
    }
  },
};

type InvokeFailureKind = 'unavailable' | 'expired' | 'protocol' | 'limit';
class InvokeFailure extends Error {
  constructor(readonly kind: InvokeFailureKind) {
    super(kind);
  }
}
const ANALYSIS_FAILURES: Record<InvokeFailureKind, AnalysisFailureCode> = {
  unavailable: 'ANALYSIS_UNAVAILABLE',
  expired: 'ANALYSIS_EXPIRED',
  protocol: 'ANALYSIS_PROTOCOL',
  limit: 'ANALYSIS_LIMIT',
};
const CODEMODE_FAILURES = {
  unavailable: 'CODEMODE_UNAVAILABLE',
  expired: 'CODEMODE_EXPIRED',
  protocol: 'CODEMODE_PROTOCOL',
  limit: 'CODEMODE_LIMIT',
} as const;

/**
 * Opaque per-store key sent as the Lambda `TenantId` (tenant isolation mode),
 * never the raw store id. HMAC-SHA256 with a server-side key when
 * AI_CODEMODE_TENANT_KEY_SALT is set; otherwise sha256 over a fixed domain
 * prefix. 64 hex chars, stable per store.
 */
export function codeModeTenantId(storeId: number): string {
  const salt = process.env.AI_CODEMODE_TENANT_KEY_SALT;
  const message = `${TENANT_DOMAIN}:${storeId}`;
  return salt
    ? createHmac('sha256', salt).update(message, 'utf8').digest('hex')
    : createHash('sha256').update(message, 'utf8').digest('hex');
}

/**
 * Trusted host adapter for the isolated analysis Lambda. It only sends a JSON
 * request and validates the JSON reply: no process spawn, vm or eval, ever.
 */
@Injectable()
export class SandboxLambdaClientService {
  private readonly logger = new Logger(SandboxLambdaClientService.name);
  private readonly transport: LambdaInvokeTransport;

  constructor(
    @Optional()
    @Inject(LAMBDA_INVOKE_TRANSPORT)
    transport?: LambdaInvokeTransport,
  ) {
    this.transport = transport ?? awsLambdaTransport;
  }

  /** Null unless enabled AND configured AND certified for this exact image (T53). */
  configuration(): AnalysisLambdaConfig | null {
    return this.parseConfig('AI_ANALYSIS');
  }

  /**
   * F10 (T64): same rule for the Code Mode function, with its own variables:
   * AI_CODEMODE_SANDBOX_ENABLED, _LAMBDA_FUNCTION_ARN, _LAMBDA_REGION,
   * _RUNTIME_DIGEST and a matching, non-zero _CERTIFIED_DIGEST.
   */
  codeModeConfiguration(): CodeModeLambdaConfig | null {
    return this.parseConfig('AI_CODEMODE');
  }

  private parseConfig(prefix: string): LambdaFunctionConfig | null {
    const env = process.env;
    if (env[`${prefix}_SANDBOX_ENABLED`] !== 'true') return null;
    const arn = env[`${prefix}_LAMBDA_FUNCTION_ARN`] ?? '';
    const region = env[`${prefix}_LAMBDA_REGION`] ?? '';
    const digest = env[`${prefix}_RUNTIME_DIGEST`] ?? '';
    const certified = env[`${prefix}_CERTIFIED_DIGEST`] ?? '';
    const match = ARN.exec(arn);
    if (
      !match ||
      !REGION.test(region) ||
      match[1] !== region ||
      !DIGEST.test(digest) ||
      digest === ZERO_DIGEST ||
      certified !== digest
    )
      return null;
    return { functionArn: arn, region, runtimeDigest: digest };
  }

  async invoke(
    request: AnalysisRequest,
    signal: AbortSignal,
  ): Promise<AnalysisOutput> {
    const config = this.configuration();
    if (!config) throw new AnalysisError('ANALYSIS_UNAVAILABLE');
    const limits = request.limits;
    let parsed: unknown;
    try {
      ({ body: parsed } = await this.invokeJson({
        config,
        request,
        signal,
        label: `analysis invoke failed id=${request.execution_id}`,
        limits: {
          wall_ms: limits.wall_ms,
          max_request_bytes:
            limits.source_bytes + limits.input_bytes + REQUEST_SLACK_BYTES,
          max_response_bytes: limits.output_bytes + RESPONSE_SLACK_BYTES,
        },
      }));
    } catch (error) {
      if (error instanceof InvokeFailure)
        throw new AnalysisError(ANALYSIS_FAILURES[error.kind]);
      throw error;
    }
    return this.interpret(parsed, request, config);
  }

  /**
   * F10 (T64): one Code Mode round. Transport only: returns the PARSED body
   * (untrusted) for `validateCodeModeResponse`; it never interprets it.
   * `tenantId` is the opaque per-store key (see `codeModeTenantId`).
   */
  async invokeCodeMode(
    request: CodeModeRoundRequest,
    signal: AbortSignal,
    tenantId?: string,
  ): Promise<{ body: unknown; requestId?: string }> {
    const config = this.codeModeConfiguration();
    if (!config) throw new CodeModeError('CODEMODE_UNAVAILABLE');
    const limits = request.limits;
    try {
      return await this.invokeJson({
        config,
        request,
        signal,
        tenantId,
        label: `codemode invoke failed id=${request.execution_id}`,
        limits: {
          wall_ms: limits.wall_ms,
          max_request_bytes:
            limits.source_bytes + limits.journal_bytes + REQUEST_SLACK_BYTES,
          max_response_bytes: limits.output_bytes + RESPONSE_SLACK_BYTES,
        },
      });
    } catch (error) {
      if (error instanceof InvokeFailure)
        throw new CodeModeError(CODEMODE_FAILURES[error.kind]);
      throw error;
    }
  }

  /**
   * Contract-agnostic synchronous invoke: serialize, bound, call, parse. Each
   * contract maps `InvokeFailure.kind` to its own error code.
   */
  private async invokeJson(input: {
    config: LambdaFunctionConfig;
    request: { execution_id: string };
    signal: AbortSignal;
    tenantId?: string;
    label: string;
    limits: {
      wall_ms: number;
      max_request_bytes: number;
      max_response_bytes: number;
    };
  }): Promise<{ body: unknown; requestId?: string }> {
    const { config, signal, limits } = input;
    if (signal.aborted) throw new InvokeFailure('expired');
    const payload = Buffer.from(JSON.stringify(input.request), 'utf8');
    if (payload.byteLength > limits.max_request_bytes)
      throw new InvokeFailure('limit');

    const controller = new AbortController();
    let expired = false;
    const expire = () => {
      expired = true;
      controller.abort();
    };
    const timer = setTimeout(expire, Math.max(1, limits.wall_ms));
    if (typeof timer.unref === 'function') timer.unref();
    signal.addEventListener('abort', expire, { once: true });
    let reply: Awaited<ReturnType<LambdaInvokeTransport['invoke']>>;
    try {
      const aborted = new Promise<never>((_, reject) =>
        controller.signal.addEventListener(
          'abort',
          () => reject(new InvokeFailure('expired')),
          { once: true },
        ),
      );
      aborted.catch(() => undefined);
      reply = await Promise.race([
        this.transport.invoke({
          functionArn: config.functionArn,
          region: config.region,
          payload,
          signal: controller.signal,
          ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        }),
        aborted,
      ]);
    } catch (error) {
      if (error instanceof InvokeFailure) throw error;
      // The default transport reports a missing optional SDK as unavailable.
      if (error instanceof AnalysisError)
        throw new InvokeFailure(
          error.code === 'ANALYSIS_EXPIRED'
            ? 'expired'
            : error.code === 'ANALYSIS_LIMIT'
              ? 'limit'
              : error.code === 'ANALYSIS_PROTOCOL'
                ? 'protocol'
                : 'unavailable',
        );
      if (expired || (error as Error)?.name === 'AbortError')
        throw new InvokeFailure('expired');
      // Log only the error class: SDK messages may echo ARNs or guest text.
      this.logger.warn(
        `${input.label} kind=${(error as Error)?.name ?? 'unknown'}`,
      );
      throw new InvokeFailure('unavailable');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', expire);
    }

    if (reply.functionError) throw new InvokeFailure('unavailable');
    if (reply.statusCode !== undefined && reply.statusCode !== 200)
      throw new InvokeFailure('unavailable');
    const body = reply.payload;
    if (!body || !body.byteLength) throw new InvokeFailure('protocol');
    if (body.byteLength > limits.max_response_bytes)
      throw new InvokeFailure('limit');

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(body).toString('utf8'));
    } catch {
      throw new InvokeFailure('protocol');
    }
    return { body: parsed, requestId: reply.requestId };
  }

  private interpret(
    parsed: unknown,
    request: AnalysisRequest,
    config: AnalysisLambdaConfig,
  ): AnalysisOutput {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new AnalysisError('ANALYSIS_PROTOCOL');
    const res = parsed as Partial<AnalysisResponse>;
    if (
      res.protocol !== ANALYSIS_PROTOCOL ||
      res.execution_id !== request.execution_id ||
      typeof res.nonce !== 'string' ||
      !NONCE.test(res.nonce) ||
      res.nonce !== request.nonce ||
      res.runtime_digest !== config.runtimeDigest
    )
      throw new AnalysisError('ANALYSIS_PROTOCOL');
    if (res.status === 'ok') return validateAnalysisOutput(res.output, request.limits);
    if (res.status === 'error') {
      if (typeof res.error_code !== 'string' || !GUEST_CODES.has(res.error_code))
        throw new AnalysisError('ANALYSIS_PROTOCOL');
      throw new AnalysisError(
        res.error_code as AnalysisErrorCode,
        this.boundedMessage(res.error_message),
      );
    }
    throw new AnalysisError('ANALYSIS_PROTOCOL');
  }

  private boundedMessage(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const clean = value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .trim()
      .slice(0, MAX_MESSAGE);
    return clean || undefined;
  }
}
