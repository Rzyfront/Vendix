import { resolve } from 'node:path';
import { loadCorpus } from './runner';
import { withExecutionContract } from '../../src/ai-engine/agent-execution.contract';
import {
  normalizeToolResult,
  toolReceipt,
} from '../../src/ai-engine/tools/tool-result.normalizer';
import {
  vexiTaskExecution,
  vexiToolFailed,
  vexiToolStepStatus,
  vexiToolLabel,
} from '../../../frontend/src/app/core/store/vexi/vexi-execution.utils';
import type { AIStreamChunk } from '../../src/ai-engine/interfaces/ai-provider.interface';
import type { AgentResult } from '../../src/ai-engine/ai-agent.service';

const corpus = loadCorpus(resolve(__dirname, 'requests.es.jsonl'));

/** Contract smoke only. These are NOT provider recordings/business receipts. */
describe('D0 50-case corpus terminal smoke (synthetic, no live adjudication)', () => {
  it.each(corpus.map((testCase) => [testCase.id, testCase] as const))(
    'case %s never fabricates verified completion',
    async (_id, testCase) => {
      const raw =
        testCase.expectedOutcome === 'unknown_effect'
          ? { result_unknown: true }
          : testCase.expectedOutcome.startsWith('blocked')
            ? {
                error: 'bloqueado',
                error_code: 'PERMISSION_DENIED',
                next_step: 'Solicita revisión al administrador.',
              }
            : testCase.expectedOutcome === 'awaiting_input'
              ? {
                  status: 'needs_user_input',
                  next_action: 'Indica el dato pendiente.',
                }
              : testCase.expectedOutcome === 'awaiting_approval'
                ? { requires_confirmation: true }
                : testCase.expectedOutcome === 'not_found'
                  ? {
                      error: 'No encontrado',
                      error_code: 'NOT_FOUND',
                      next_step: 'Indica otro registro.',
                    }
                  : { data: testCase.expectedFacts };
      const normalized = normalizeToolResult(raw, {
        evidenceRef: `tool_call:synthetic-${testCase.id}`,
      });
      const source = async function* (): AsyncGenerator<
        AIStreamChunk,
        AgentResult
      > {
        yield {
          type: 'tool_result',
          tool: {
            id: testCase.id,
            name: 'synthetic_probe',
            execution: toolReceipt(normalized),
            summary: 'fixture sintético',
          },
        };
        yield {
          type: 'text',
          content:
            normalized.status === 'ok'
              ? 'Resultado de consulta sintética.'
              : 'Ya completé todo.',
        };
        yield { type: 'done' };
        return {
          success: true,
          content: '',
          iterations: 1,
          total_tokens: 0,
          tools_used: [],
        };
      };
      const generator = withExecutionContract(source());
      const chunks: AIStreamChunk[] = [];
      let step = await generator.next();
      while (!step.done) {
        chunks.push(step.value);
        step = await generator.next();
      }
      expect(step.value.execution?.outcome).not.toBe('completed_verified');
      expect(step.value.execution?.next_action).toBeTruthy();
      expect(chunks.at(-1)).toMatchObject({
        type: 'done',
        execution: step.value.execution,
      });
      if (normalized.status !== 'ok')
        expect(step.value.content).not.toContain('Ya completé');
    },
  );
});

describe('D0 web consumer pure helpers (not browser E2E)', () => {
  it.each([
    'pending_confirmation',
    'needs_user_input',
    'unknown_effect',
    'ok',
  ] as const)('%s is not a red technical failure', (status) => {
    expect(
      vexiToolFailed({ ...toolReceipt(normalizeToolResult('qa')), status }),
    ).toBe(false);
  });
  it.each(['recoverable_error', 'blocked'] as const)(
    '%s remains a failed step',
    (status) => {
      expect(
        vexiToolFailed({ ...toolReceipt(normalizeToolResult('qa')), status }),
      ).toBe(true);
    },
  );
  it('supports legacy servers and partial background results without a completed-business label', () => {
    expect(vexiToolFailed(undefined, true)).toBe(true);
    expect(vexiToolFailed(undefined, undefined)).toBeUndefined();
    const execution = {
      schema_version: '1',
      outcome: 'partial',
      next_action: 'Verifica.',
      resource_ids: {},
      evidence_refs: [],
    };
    expect(vexiTaskExecution({ content: 'parcial', execution })).toEqual(
      execution,
    );
    expect(vexiTaskExecution({ content: 'legacy' })).toBeNull();
  });
});

describe('D0 semantic trace labels', () => {
  it.each([
    'pending_confirmation',
    'needs_user_input',
    'unknown_effect',
  ] as const)('%s never becomes a past-tense success', (status) => {
    const execution = { ...toolReceipt(normalizeToolResult('qa')), status };
    expect(vexiToolStepStatus(execution)).not.toBe('done');
    expect(vexiToolLabel(execution)).toBeTruthy();
  });
});

describe('D0 generator lifecycle', () => {
  const result: AgentResult = {
    success: true,
    content: '',
    iterations: 1,
    total_tokens: 0,
    tools_used: [],
  };
  it('forwards consumer throw so the source can recover', async () => {
    let seen: unknown;
    const source = async function* (): AsyncGenerator<
      AIStreamChunk,
      AgentResult
    > {
      try {
        yield { type: 'tool_call', tool: { id: 'qa', name: 'qa' } };
      } catch (error) {
        seen = error;
        yield { type: 'text', content: 'Recuperado.' };
      }
      return { ...result, content: 'Recuperado.' };
    };
    const generator = withExecutionContract(source());
    await generator.next();
    const error = new Error('consumer');
    const next = await generator.throw(error);
    expect(seen).toBe(error);
    expect(next.value).toMatchObject({ type: 'text', content: 'Recuperado.' });
    await generator.return(result);
  });
  it('consumer return closes the source exactly once', async () => {
    let closed = 0;
    const source = async function* (): AsyncGenerator<
      AIStreamChunk,
      AgentResult
    > {
      try {
        yield { type: 'tool_call', tool: { id: 'qa', name: 'qa' } };
        return result;
      } finally {
        closed++;
      }
    };
    const generator = withExecutionContract(source());
    await generator.next();
    await generator.return(result);
    expect(closed).toBe(1);
  });
});
