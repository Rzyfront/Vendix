import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  ANALYSIS_PROTOCOL,
  AnalysisError,
  AnalysisErrorCode,
  AnalysisOutput,
  AnalysisRequest,
  AnalysisResponse,
} from './interfaces/analysis-protocol.interface';
import { validateAnalysisOutput } from './analysis-output.validator';

export interface LambdaInvokeTransport {
  invoke(input: {
    functionArn: string;
    region: string;
    payload: Uint8Array;
    signal: AbortSignal;
  }): Promise<{
    statusCode?: number;
    functionError?: string;
    payload?: Uint8Array;
  }>;
}

export const LAMBDA_INVOKE_TRANSPORT = Symbol('LAMBDA_INVOKE_TRANSPORT');

export interface AnalysisLambdaConfig {
  functionArn: string;
  region: string;
  runtimeDigest: string;
}

const ARN =
  /^arn:aws(?:-[a-z]+)*:lambda:([a-z]{2}(?:-[a-z]+)+-\d):\d{12}:function:[A-Za-z0-9_-]{1,64}(?::[A-Za-z0-9_-]{1,128})?$/;
const REGION = /^[a-z]{2}(?:-[a-z]+)+-\d$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;
const NONCE = /^[a-f0-9]{64}$/;
const RESPONSE_SLACK_BYTES = 16 * 1024;
const REQUEST_SLACK_BYTES = 64 * 1024;
const MAX_MESSAGE = 300;
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
    }>;
    destroy(): void;
  };
  InvokeCommand: new (input: {
    FunctionName: string;
    InvocationType: 'RequestResponse';
    LogType: 'None';
    Payload: Uint8Array;
  }) => unknown;
}

/** Default transport: loads the AWS SDK lazily; absent SDK means unavailable. */
export const awsLambdaTransport: LambdaInvokeTransport = {
  async invoke({ functionArn, region, payload, signal }) {
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
        }),
        { abortSignal: signal },
      );
      return {
        statusCode: out.StatusCode,
        functionError: out.FunctionError,
        payload: out.Payload,
      };
    } finally {
      client.destroy();
    }
  },
};

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
    const env = process.env;
    if (env.AI_ANALYSIS_SANDBOX_ENABLED !== 'true') return null;
    const arn = env.AI_ANALYSIS_LAMBDA_FUNCTION_ARN ?? '';
    const region = env.AI_ANALYSIS_LAMBDA_REGION ?? '';
    const digest = env.AI_ANALYSIS_RUNTIME_DIGEST ?? '';
    const certified = env.AI_ANALYSIS_CERTIFIED_DIGEST ?? '';
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
    if (signal.aborted) throw new AnalysisError('ANALYSIS_EXPIRED');
    const limits = request.limits;
    const payload = Buffer.from(JSON.stringify(request), 'utf8');
    if (
      payload.byteLength >
      limits.source_bytes + limits.input_bytes + REQUEST_SLACK_BYTES
    )
      throw new AnalysisError('ANALYSIS_LIMIT');

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
          () => reject(new AnalysisError('ANALYSIS_EXPIRED')),
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
        }),
        aborted,
      ]);
    } catch (error) {
      if (error instanceof AnalysisError) throw error;
      if (expired || (error as Error)?.name === 'AbortError')
        throw new AnalysisError('ANALYSIS_EXPIRED');
      // Log only the error class: SDK messages may echo ARNs or guest text.
      this.logger.warn(
        `analysis invoke failed id=${request.execution_id} kind=${(error as Error)?.name ?? 'unknown'}`,
      );
      throw new AnalysisError('ANALYSIS_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', expire);
    }

    if (reply.functionError)
      throw new AnalysisError('ANALYSIS_UNAVAILABLE');
    if (reply.statusCode !== undefined && reply.statusCode !== 200)
      throw new AnalysisError('ANALYSIS_UNAVAILABLE');
    const body = reply.payload;
    if (!body || !body.byteLength) throw new AnalysisError('ANALYSIS_PROTOCOL');
    if (body.byteLength > limits.output_bytes + RESPONSE_SLACK_BYTES)
      throw new AnalysisError('ANALYSIS_LIMIT');

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(body).toString('utf8'));
    } catch {
      throw new AnalysisError('ANALYSIS_PROTOCOL');
    }
    return this.interpret(parsed, request, config);
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
