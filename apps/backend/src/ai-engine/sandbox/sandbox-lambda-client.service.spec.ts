import {
  ANALYSIS_LIMITS,
  ANALYSIS_PROTOCOL,
  AnalysisError,
  AnalysisRequest,
} from './interfaces/analysis-protocol.interface';
import {
  CODEMODE_LIMITS,
  CODEMODE_PROTOCOL,
  CodeModeError,
  CodeModeRoundRequest,
} from './interfaces/codemode-protocol.interface';
import {
  codeModeTenantId,
  LambdaInvokeTransport,
  SandboxLambdaClientService,
} from './sandbox-lambda-client.service';

const DIGEST = `sha256:${'b'.repeat(64)}`;
const ENV_KEYS = [
  'AI_ANALYSIS_SANDBOX_ENABLED',
  'AI_ANALYSIS_LAMBDA_FUNCTION_ARN',
  'AI_ANALYSIS_LAMBDA_REGION',
  'AI_ANALYSIS_RUNTIME_DIGEST',
  'AI_ANALYSIS_CERTIFIED_DIGEST',
];
const saved: Record<string, string | undefined> = {};

function setEnv(overrides: Record<string, string | undefined> = {}) {
  const base: Record<string, string> = {
    AI_ANALYSIS_SANDBOX_ENABLED: 'true',
    AI_ANALYSIS_LAMBDA_FUNCTION_ARN:
      'arn:aws:lambda:us-east-1:123456789012:function:vendix-analysis',
    AI_ANALYSIS_LAMBDA_REGION: 'us-east-1',
    AI_ANALYSIS_RUNTIME_DIGEST: DIGEST,
    AI_ANALYSIS_CERTIFIED_DIGEST: DIGEST,
  };
  for (const [k, v] of Object.entries({ ...base, ...overrides })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const request = (): AnalysisRequest => ({
  protocol: ANALYSIS_PROTOCOL,
  execution_id: 'e-1',
  nonce: 'c'.repeat(64),
  language: 'python',
  source: 'result = {}',
  inputs: [],
  limits: { ...ANALYSIS_LIMITS, wall_ms: 1000 },
});

const okBody = (patch: Record<string, unknown> = {}) => ({
  protocol: ANALYSIS_PROTOCOL,
  execution_id: 'e-1',
  nonce: 'c'.repeat(64),
  runtime_digest: DIGEST,
  status: 'ok',
  output: { figures: [{ label: 'n', value: 1 }] },
  ...patch,
});
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

function build(reply: () => Promise<any>) {
  const invoke = jest.fn<ReturnType<LambdaInvokeTransport['invoke']>, any[]>(
    reply,
  );
  return {
    invoke,
    service: new SandboxLambdaClientService({ invoke } as LambdaInvokeTransport),
  };
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return e instanceof AnalysisError ? e.code : 'OTHER';
  }
  return undefined;
}

describe('SandboxLambdaClientService', () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    setEnv();
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe('configuration', () => {
    it('returns the config when every condition holds', () => {
      const { service } = build(async () => ({}));
      expect(service.configuration()).toEqual({
        functionArn:
          'arn:aws:lambda:us-east-1:123456789012:function:vendix-analysis',
        region: 'us-east-1',
        runtimeDigest: DIGEST,
      });
    });

    const off: Array<[string, Record<string, string | undefined>]> = [
      ['flag unset', { AI_ANALYSIS_SANDBOX_ENABLED: undefined }],
      ['flag not exactly true', { AI_ANALYSIS_SANDBOX_ENABLED: '1' }],
      ['ARN missing', { AI_ANALYSIS_LAMBDA_FUNCTION_ARN: undefined }],
      [
        'ARN with wildcard',
        { AI_ANALYSIS_LAMBDA_FUNCTION_ARN: 'arn:aws:lambda:us-east-1:123456789012:function:*' },
      ],
      [
        'ARN alias wildcard',
        { AI_ANALYSIS_LAMBDA_FUNCTION_ARN: 'arn:aws:lambda:us-east-1:123456789012:function:f:*' },
      ],
      ['region invalid', { AI_ANALYSIS_LAMBDA_REGION: 'nowhere' }],
      ['region differs from ARN', { AI_ANALYSIS_LAMBDA_REGION: 'us-west-2' }],
      ['runtime digest invalid', { AI_ANALYSIS_RUNTIME_DIGEST: 'sha256:abc' }],
      [
        'zero placeholder digest',
        {
          AI_ANALYSIS_RUNTIME_DIGEST: `sha256:${'0'.repeat(64)}`,
          AI_ANALYSIS_CERTIFIED_DIGEST: `sha256:${'0'.repeat(64)}`,
        },
      ],
      ['certified digest missing', { AI_ANALYSIS_CERTIFIED_DIGEST: undefined }],
      [
        'certified digest differs from runtime',
        { AI_ANALYSIS_CERTIFIED_DIGEST: `sha256:${'d'.repeat(64)}` },
      ],
    ];
    it.each(off)('is off when %s and never invokes', async (_n, env) => {
      setEnv(env);
      const { service, invoke } = build(async () => ({}));
      expect(service.configuration()).toBeNull();
      expect(await codeOf(service.invoke(request(), new AbortController().signal))).toBe(
        'ANALYSIS_UNAVAILABLE',
      );
      expect(invoke).not.toHaveBeenCalled();
    });
  });

  describe('invoke', () => {
    it('returns the validated output when echoes match', async () => {
      const { service, invoke } = build(async () => ({
        statusCode: 200,
        payload: bytes(okBody()),
      }));
      const out = await service.invoke(request(), new AbortController().signal);
      expect(out).toEqual({ figures: [{ label: 'n', value: 1 }] });
      expect(invoke.mock.calls[0][0].region).toBe('us-east-1');
    });

    it('rejects a nonce mismatch with ANALYSIS_PROTOCOL', async () => {
      const { service } = build(async () => ({
        payload: bytes(okBody({ nonce: 'e'.repeat(64) })),
      }));
      expect(await codeOf(service.invoke(request(), new AbortController().signal))).toBe(
        'ANALYSIS_PROTOCOL',
      );
    });

    it('rejects an execution id mismatch with ANALYSIS_PROTOCOL', async () => {
      const { service } = build(async () => ({
        payload: bytes(okBody({ execution_id: 'other' })),
      }));
      expect(await codeOf(service.invoke(request(), new AbortController().signal))).toBe(
        'ANALYSIS_PROTOCOL',
      );
    });

    it('rejects a runtime digest mismatch with ANALYSIS_PROTOCOL', async () => {
      const { service } = build(async () => ({
        payload: bytes(okBody({ runtime_digest: `sha256:${'f'.repeat(64)}` })),
      }));
      expect(await codeOf(service.invoke(request(), new AbortController().signal))).toBe(
        'ANALYSIS_PROTOCOL',
      );
    });

    it('rejects non-JSON payloads with ANALYSIS_PROTOCOL', async () => {
      const { service } = build(async () => ({
        payload: new TextEncoder().encode('not json'),
      }));
      expect(await codeOf(service.invoke(request(), new AbortController().signal))).toBe(
        'ANALYSIS_PROTOCOL',
      );
    });

    it('maps FunctionError to ANALYSIS_UNAVAILABLE without guest text', async () => {
      const { service } = build(async () => ({
        functionError: 'Unhandled',
        payload: bytes({ errorMessage: 'SECRET /var/task/x.py' }),
      }));
      let caught: unknown;
      try {
        await service.invoke(request(), new AbortController().signal);
      } catch (e) {
        caught = e;
      }
      expect((caught as AnalysisError).code).toBe('ANALYSIS_UNAVAILABLE');
      expect((caught as AnalysisError).detail).toBeUndefined();
      expect(JSON.stringify(caught)).not.toContain('SECRET');
    });

    it('rejects an oversize response with ANALYSIS_LIMIT', async () => {
      const big = new Uint8Array(ANALYSIS_LIMITS.output_bytes + 16 * 1024 + 1);
      const { service } = build(async () => ({ payload: big }));
      expect(await codeOf(service.invoke(request(), new AbortController().signal))).toBe(
        'ANALYSIS_LIMIT',
      );
    });

    it('rejects an invalid output with ANALYSIS_OUTPUT', async () => {
      const { service } = build(async () => ({
        payload: bytes(okBody({ output: { figures: [] } })),
      }));
      expect(await codeOf(service.invoke(request(), new AbortController().signal))).toBe(
        'ANALYSIS_OUTPUT',
      );
    });

    it('expires when the host timer fires even if transport ignores the signal', async () => {
      jest.useFakeTimers();
      try {
        const { service } = build(() => new Promise(() => undefined));
        const pending = codeOf(service.invoke(request(), new AbortController().signal));
        await jest.advanceTimersByTimeAsync(1001);
        expect(await pending).toBe('ANALYSIS_EXPIRED');
      } finally {
        jest.useRealTimers();
      }
    });

    it('expires when the caller signal aborts', async () => {
      const controller = new AbortController();
      const { service } = build(() => new Promise(() => undefined));
      const pending = codeOf(service.invoke(request(), controller.signal));
      controller.abort();
      expect(await pending).toBe('ANALYSIS_EXPIRED');
    });

    it('does not invoke when already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const { service, invoke } = build(async () => ({}));
      expect(await codeOf(service.invoke(request(), controller.signal))).toBe(
        'ANALYSIS_EXPIRED',
      );
      expect(invoke).not.toHaveBeenCalled();
    });

    it('passes the guest error code through with a bounded, clean message', async () => {
      const { service } = build(async () => ({
        payload: bytes(
          okBody({
            status: 'error',
            output: undefined,
            error_code: 'ANALYSIS_RUNTIME',
            error_message: `Zero\u0000Division${'x'.repeat(600)}`,
          }),
        ),
      }));
      let caught: AnalysisError | undefined;
      try {
        await service.invoke(request(), new AbortController().signal);
      } catch (e) {
        caught = e as AnalysisError;
      }
      expect(caught?.code).toBe('ANALYSIS_RUNTIME');
      expect(caught?.detail?.length).toBeLessThanOrEqual(300);
      // eslint-disable-next-line no-control-regex
      expect(caught?.detail).not.toMatch(/[\u0000-\u001f]/);
    });

    it('rejects an unknown guest error code with ANALYSIS_PROTOCOL', async () => {
      const { service } = build(async () => ({
        payload: bytes(okBody({ status: 'error', error_code: 'ANALYSIS_DENIED' })),
      }));
      expect(await codeOf(service.invoke(request(), new AbortController().signal))).toBe(
        'ANALYSIS_PROTOCOL',
      );
    });

    it('rejects an oversized request with ANALYSIS_LIMIT before invoking', async () => {
      const { service, invoke } = build(async () => ({}));
      const big = { ...request(), source: 'x'.repeat(3 * 1024 * 1024) };
      expect(await codeOf(service.invoke(big, new AbortController().signal))).toBe(
        'ANALYSIS_LIMIT',
      );
      expect(invoke).not.toHaveBeenCalled();
    });

    it('maps unexpected transport errors to ANALYSIS_UNAVAILABLE', async () => {
      const { service } = build(async () => {
        throw new Error('boom with guest text');
      });
      expect(await codeOf(service.invoke(request(), new AbortController().signal))).toBe(
        'ANALYSIS_UNAVAILABLE',
      );
    });

    it('is ANALYSIS_UNAVAILABLE when the AWS SDK module is missing (default transport)', async () => {
      const service = new SandboxLambdaClientService();
      expect(await codeOf(service.invoke(request(), new AbortController().signal))).toBe(
        'ANALYSIS_UNAVAILABLE',
      );
    });
  });

  describe('generic transport (F10 codemode path)', () => {
    const CM_ENV: Record<string, string> = {
      AI_CODEMODE_SANDBOX_ENABLED: 'true',
      AI_CODEMODE_LAMBDA_FUNCTION_ARN:
        'arn:aws:lambda:us-east-1:123456789012:function:vendix-agent-codemode',
      AI_CODEMODE_LAMBDA_REGION: 'us-east-1',
      AI_CODEMODE_RUNTIME_DIGEST: DIGEST,
      AI_CODEMODE_CERTIFIED_DIGEST: DIGEST,
    };
    const cmRequest = (): CodeModeRoundRequest => ({
      protocol: CODEMODE_PROTOCOL,
      execution_id: 'e-1',
      nonce: 'c'.repeat(64),
      round: 1,
      language: 'javascript',
      source: 'return 1;',
      manifest: [],
      journal: [],
      clock_ms: 1,
      seed: 'd'.repeat(64),
      limits: { ...CODEMODE_LIMITS, wall_ms: 1000 },
    });
    const withCm = (env: Record<string, string | undefined> = {}) => {
      for (const [k, v] of Object.entries({ ...CM_ENV, ...env })) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    };
    afterEach(() => {
      for (const k of [...Object.keys(CM_ENV), 'AI_CODEMODE_TENANT_KEY_SALT'])
        delete process.env[k];
    });

    it('analysis keeps its exact transport call: no tenantId key, analysis config only', async () => {
      withCm();
      const { service, invoke } = build(async () => ({
        statusCode: 200,
        payload: bytes(okBody()),
      }));
      await service.invoke(request(), new AbortController().signal);
      expect(Object.keys(invoke.mock.calls[0][0]).sort()).toEqual([
        'functionArn',
        'payload',
        'region',
        'signal',
      ]);
      expect(invoke.mock.calls[0][0].functionArn).toContain('vendix-analysis');
    });

    it('codemode config has its own flag set and the same certified-digest rule', () => {
      const { service } = build(async () => ({}));
      expect(service.codeModeConfiguration()).toBeNull();
      withCm();
      expect(service.codeModeConfiguration()).toMatchObject({ region: 'us-east-1', runtimeDigest: DIGEST });
      for (const env of [
        { AI_CODEMODE_SANDBOX_ENABLED: 'yes' },
        { AI_CODEMODE_CERTIFIED_DIGEST: `sha256:${'c'.repeat(64)}` },
        { AI_CODEMODE_RUNTIME_DIGEST: `sha256:${'0'.repeat(64)}`, AI_CODEMODE_CERTIFIED_DIGEST: `sha256:${'0'.repeat(64)}` },
        { AI_CODEMODE_LAMBDA_REGION: 'eu-west-1' },
      ]) {
        withCm(env);
        expect(service.codeModeConfiguration()).toBeNull();
      }
    });

    it('invokes with the codemode function and an optional TenantId; returns the parsed body and request id', async () => {
      withCm();
      const { service, invoke } = build(async () => ({
        statusCode: 200,
        payload: bytes({ any: 'thing' }),
        requestId: 'req-1',
      }));
      const out = await service.invokeCodeMode(cmRequest(), new AbortController().signal, 'a'.repeat(64));
      expect(out).toEqual({ body: { any: 'thing' }, requestId: 'req-1' });
      expect(invoke.mock.calls[0][0]).toMatchObject({
        functionArn: expect.stringContaining('vendix-agent-codemode'),
        tenantId: 'a'.repeat(64),
      });
      await service.invokeCodeMode(cmRequest(), new AbortController().signal);
      expect('tenantId' in invoke.mock.calls[1][0]).toBe(false);
    });

    it('maps transport failures to codemode codes and never invokes when unconfigured', async () => {
      const code = async (p: Promise<unknown>) => {
        try {
          await p;
        } catch (e) {
          return e instanceof CodeModeError ? e.code : 'OTHER';
        }
      };
      const off = build(async () => ({}));
      expect(await code(off.service.invokeCodeMode(cmRequest(), new AbortController().signal))).toBe('CODEMODE_UNAVAILABLE');
      expect(off.invoke).not.toHaveBeenCalled();
      withCm();
      const boom = build(async () => {
        throw new Error('boom');
      });
      expect(await code(boom.service.invokeCodeMode(cmRequest(), new AbortController().signal))).toBe('CODEMODE_UNAVAILABLE');
      const empty = build(async () => ({ statusCode: 200 }));
      expect(await code(empty.service.invokeCodeMode(cmRequest(), new AbortController().signal))).toBe('CODEMODE_PROTOCOL');
      const bad = build(async () => ({ statusCode: 200, payload: new TextEncoder().encode('{') }));
      expect(await code(bad.service.invokeCodeMode(cmRequest(), new AbortController().signal))).toBe('CODEMODE_PROTOCOL');
      const ctrl = new AbortController();
      ctrl.abort();
      expect(await code(boom.service.invokeCodeMode(cmRequest(), ctrl.signal))).toBe('CODEMODE_EXPIRED');
    });

    it('codeModeTenantId is opaque, stable per store and keyed when a server salt exists', () => {
      const a = codeModeTenantId(7);
      expect(a).toMatch(/^[a-f0-9]{64}$/);
      expect(a).toBe(codeModeTenantId(7));
      expect(a).not.toBe(codeModeTenantId(8));
      process.env.AI_CODEMODE_TENANT_KEY_SALT = 'k'.repeat(32);
      expect(codeModeTenantId(7)).not.toBe(a);
      expect(codeModeTenantId(7)).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
