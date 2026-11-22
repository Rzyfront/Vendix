import { ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RequestContextService } from '../../common/context/request-context.service';
import { AgentDeadline, agentDeadlineContext } from '../tasks/agent-deadline';
import {
  ANALYSIS_LIMITS,
  AnalysisError,
} from './interfaces/analysis-protocol.interface';
import { SandboxAnalysisBrokerService } from './sandbox-analysis-broker.service';
import { sandboxInvocation } from './sandbox-invocation.context';
import { sandboxSourceHash } from './sandbox-audit.repository';

const ctx = {
  user_id: 3,
  store_id: 1,
  organization_id: 2,
  permissions: [],
  roles: [],
  is_owner: true,
  is_super_admin: false,
};
const DIGEST = `sha256:${'b'.repeat(64)}`;
const request = () => ({
  source: 'result = {"figures": []}',
  inputs: [{ name: 'sales', columns: ['a'], rows: [[1]] }],
  purpose: 'other' as const,
});
const output = { figures: [{ label: 'n', value: 1 }] };

function fixture(opts: { invoke?: (...a: any[]) => Promise<any> } = {}) {
  const order: string[] = [];
  const audit = {
    sourceAvailable: jest.fn(() => true),
    start: jest.fn<any, any[]>(async () => {
      order.push('start');
    }),
    finish: jest.fn<any, any[]>(async () => {
      order.push('finish');
    }),
  };
  const client = {
    configuration: jest.fn(
      (): { runtimeDigest: string } | null => ({ runtimeDigest: DIGEST }),
    ),
    invoke: jest.fn<any, any[]>(
      opts.invoke ??
        (async () => {
          order.push('invoke');
          return output;
        }),
    ),
  };
  const durable = {
    objective_id: randomUUID(),
    objective: {
      expires_at: new Date(Date.now() + 60_000),
      budget: { active_runtime_ms: 0 },
    },
    assertBudget: jest.fn(async () => {}),
  };
  const invocation = { durable } as never;
  const broker = new SandboxAnalysisBrokerService(client as never, audit as never);
  const run = (req = request()) =>
    RequestContextService.runIsolated(ctx as never, () =>
      sandboxInvocation.run(invocation, () => broker.run(req)),
    );
  return { broker, audit, client, durable, order, run };
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return e instanceof AnalysisError ? e.code : `OTHER:${(e as Error).message}`;
  }
  return undefined;
}

describe('SandboxAnalysisBrokerService', () => {
  describe('available', () => {
    it('is false when the lambda client is not configured', () => {
      const f = fixture();
      f.client.configuration.mockReturnValue(null);
      expect(f.broker.available()).toBe(false);
    });
    it('is false when audit source encryption is unavailable', () => {
      const f = fixture();
      f.audit.sourceAvailable.mockReturnValue(false);
      expect(f.broker.available()).toBe(false);
    });
    it('is true when both are available', () => {
      expect(fixture().broker.available()).toBe(true);
    });
  });

  describe('run', () => {
    it('is unavailable without a sandbox invocation and never invokes', async () => {
      const f = fixture();
      const code = await codeOf(
        RequestContextService.runIsolated(ctx as never, () =>
          f.broker.run(request()),
        ),
      );
      expect(code).toBe('ANALYSIS_UNAVAILABLE');
      expect(f.client.invoke).not.toHaveBeenCalled();
      expect(f.audit.start).not.toHaveBeenCalled();
    });

    it('is unavailable without a request context', async () => {
      const f = fixture();
      const code = await codeOf(
        sandboxInvocation.run({ durable: f.durable } as never, () =>
          f.broker.run(request()),
        ),
      );
      expect(code).toBe('ANALYSIS_UNAVAILABLE');
      expect(f.client.invoke).not.toHaveBeenCalled();
    });

    it('is unavailable when the client is not configured', async () => {
      const f = fixture();
      f.client.configuration.mockReturnValue(null);
      expect(await codeOf(f.run())).toBe('ANALYSIS_UNAVAILABLE');
      expect(f.audit.start).not.toHaveBeenCalled();
    });

    it('audits intent BEFORE invoking and finishes after', async () => {
      const f = fixture();
      const result = await f.run();
      expect(f.order).toEqual(['start', 'invoke', 'finish']);
      const startArg = f.audit.start.mock.calls[0][0];
      expect(startArg.objective_id).toBe(f.durable.objective_id);
      expect(startArg.runtime_digest).toBe(DIGEST);
      expect(startArg.manifest).toEqual([]);
      expect(startArg.policy_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(startArg.limits.cpu_ms).toBe(ANALYSIS_LIMITS.cpu_s * 1000);
      expect(f.audit.finish.mock.calls[0][1]).toBe('ok');
      expect(result.output).toEqual(output);
      expect(result.source_hash).toBe(sandboxSourceHash(request().source));
      expect(result.run_id).toBe(startArg.id);
      const sent = f.client.invoke.mock.calls[0][0];
      expect(sent.execution_id).toBe(startArg.id);
      expect(sent.nonce).toMatch(/^[a-f0-9]{64}$/);
      expect(sent.language).toBe('python');
    });

    it('maps admission rejection to ANALYSIS_LIMIT without invoking or finishing', async () => {
      const f = fixture();
      f.audit.start.mockRejectedValue(new ConflictException('capacity'));
      expect(await codeOf(f.run())).toBe('ANALYSIS_LIMIT');
      expect(f.client.invoke).not.toHaveBeenCalled();
      expect(f.audit.finish).not.toHaveBeenCalled();
    });

    it('maps other audit failures to ANALYSIS_UNAVAILABLE', async () => {
      const f = fixture();
      f.audit.start.mockRejectedValue(new NotFoundException('objective'));
      expect(await codeOf(f.run())).toBe('ANALYSIS_UNAVAILABLE');
      expect(f.client.invoke).not.toHaveBeenCalled();
    });

    it('always finishes on failure with an accepted outcome', async () => {
      const f = fixture({
        invoke: async () => {
          throw new AnalysisError('ANALYSIS_RUNTIME', 'ZeroDivisionError');
        },
      });
      let caught: AnalysisError | undefined;
      try {
        await f.run();
      } catch (e) {
        caught = e as AnalysisError;
      }
      expect(caught?.code).toBe('ANALYSIS_RUNTIME');
      expect(caught?.detail).toBe('ZeroDivisionError');
      expect(f.audit.finish).toHaveBeenCalledTimes(1);
      expect(f.audit.finish.mock.calls[0][1]).toBe('failed');
    });

    it.each([
      ['ANALYSIS_UNAVAILABLE', 'unavailable'],
      ['ANALYSIS_EXPIRED', 'timeout'],
      ['ANALYSIS_TIMEOUT', 'timeout'],
      ['ANALYSIS_LIMIT', 'denied'],
      ['ANALYSIS_PROTOCOL', 'failed'],
    ] as const)('maps %s to outcome %s', async (code, expected) => {
      const f = fixture({
        invoke: async () => {
          throw new AnalysisError(code);
        },
      });
      expect(await codeOf(f.run())).toBe(code);
      expect(f.audit.finish.mock.calls[0][1]).toBe(expected);
    });

    it('wraps unexpected errors as ANALYSIS_UNAVAILABLE without raw text', async () => {
      const f = fixture({
        invoke: async () => {
          throw new Error('raw guest text');
        },
      });
      let caught: AnalysisError | undefined;
      try {
        await f.run();
      } catch (e) {
        caught = e as AnalysisError;
      }
      expect(caught?.code).toBe('ANALYSIS_UNAVAILABLE');
      expect(caught?.detail).toBeUndefined();
      expect(caught?.message).not.toContain('raw guest text');
    });

    it('records cancelled when the parent deadline was aborted', async () => {
      const f = fixture({
        invoke: async () => {
          throw new AnalysisError('ANALYSIS_EXPIRED');
        },
      });
      const parent = new AgentDeadline({
        wallDeadlineMs: Date.now() + 60_000,
        activeBudgetMs: 60_000,
      });
      const pending = agentDeadlineContext.run(parent, async () => {
        parent.cancel();
        return codeOf(f.run());
      });
      await pending;
      parent.dispose();
      // Parent aborted before start: either never opened or finished as cancelled.
      if (f.audit.finish.mock.calls.length)
        expect(f.audit.finish.mock.calls[0][1]).toBe('cancelled');
    });

    it('rejects invalid source and inputs before any audit or invoke', async () => {
      const f = fixture();
      expect(
        await codeOf(f.run({ ...request(), source: 'x'.repeat(33 * 1024) })),
      ).toBe('ANALYSIS_INPUT');
      expect(
        await codeOf(f.run({ ...request(), source: 5 as unknown as string })),
      ).toBe('ANALYSIS_INPUT');
      expect(
        await codeOf(
          f.run({ ...request(), inputs: [{ name: 'Bad', columns: ['a'], rows: [] }] }),
        ),
      ).toBe('ANALYSIS_INPUT');
      expect(f.audit.start).not.toHaveBeenCalled();
      expect(f.client.invoke).not.toHaveBeenCalled();
    });

    it('swallows an audit finish failure without masking the result', async () => {
      const f = fixture();
      f.audit.finish.mockRejectedValue(new Error('db down'));
      const result = await f.run();
      expect(result.output).toEqual(output);
    });
  });
});
