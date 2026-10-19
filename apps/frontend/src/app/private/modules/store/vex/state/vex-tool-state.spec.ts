import { cancelVexToolSteps, settleVexToolStep } from './vex-tool-state';
import type { VexiToolExecution } from '../../../../../core/services/vexi-api.service';

const receipt = (
  status: VexiToolExecution['status'],
  freshness: VexiToolExecution['freshness'] = 'observed',
): VexiToolExecution => ({
  schema_version: '1',
  status,
  freshness,
  retryable: false,
  next_action: null,
  error_code: null,
  effect_status: 'not_applicable',
  evidence_refs: [],
  resource_ids: {},
});
describe('H Vex trace uses the same honest semantic states as Vexi', () => {
  (
    [
      ['pending_confirmation', 'waiting'],
      ['needs_user_input', 'waiting'],
      ['unknown_effect', 'unknown'],
      ['recoverable_error', 'failed'],
      ['blocked', 'failed'],
      ['ok', 'done'],
    ] as const
  ).forEach(([status, expected], index) => {
    it(
      'maps %s to %s rather than inventing applied success' +
        ' (caso ' +
        index +
        ')',
      () => {
        const result = settleVexToolStep([], {
          id: 'one',
          name: 'tool',
          summary: 'untrusted success prose',
          execution: receipt(status),
        });
        expect(result[0].status).toBe(expected);
        if (expected !== 'done')
          expect(result[0].summary).not.toBe('untrusted success prose');
      },
    );
  });
  it('treats unknown evidence as unconfirmed', () => {
    expect(
      settleVexToolStep([], {
        id: 'one',
        name: 'read',
        execution: receipt('ok', 'unknown'),
      })[0].status,
    ).toBe('unknown');
  });
  it('a compacted read is a valid read: done, no warning label', () => {
    for (const execution of [
      receipt('ok', 'truncated'),
      { ...receipt('ok'), compacted: true },
    ]) {
      const [step] = settleVexToolStep([], {
        id: 'one',
        name: 'read',
        execution,
      });
      expect(step.status).toBe('done');
      expect(step.summary).toBeUndefined();
    }
  });
  it('a held-back call (batch stopped, staged) leaves the trace, never as failed', () => {
    for (const error_code of ['BATCH_NOT_DISPATCHED', 'AI_AGENT_TOOL_STAGED']) {
      const steps = settleVexToolStep(
        [{ id: 'one', name: 'read', status: 'running' }],
        {
          id: 'one',
          name: 'read',
          summary: 'internal note',
          execution: { ...receipt('recoverable_error'), error_code },
        },
      );
      expect(steps).toEqual([]);
    }
  });
  it('maps a denied read to the catalog text, not the receipt note', () => {
    const [step] = settleVexToolStep([], {
      id: 'one',
      name: 'read',
      execution: {
        ...receipt('blocked'),
        error_code: 'NOT_ALLOWED',
        next_action: 'internal recovery note',
      },
    });
    expect(step.status).toBe('failed');
    expect(step.summary).toBe('No tienes permiso para esta consulta.');
  });
  it('upserts exactly one step when a result repeats or its call was not observed', () => {
    const tool = { id: 'same', name: 'read', execution: receipt('ok') };
    expect(settleVexToolStep(settleVexToolStep([], tool), tool)).toHaveSize(1);
  });
  it('cancel marks only running work unknown, preserving confirmed results and pending approval', () => {
    const steps = cancelVexToolSteps([
      { id: 'running', name: 'read', status: 'running' },
      { id: 'done', name: 'read', status: 'done' },
      { id: 'waiting', name: 'write', status: 'waiting' },
    ]);
    expect(steps.map((step) => step.status)).toEqual([
      'unknown',
      'done',
      'waiting',
    ]);
    expect(steps[0].summary).toContain('verificarse');
  });
  it('keeps OFF legacy status/summary when receipts are absent', () => {
    expect(
      settleVexToolStep([], { id: 'one', name: 'read', summary: 'legacy' })[0],
    ).toEqual(jasmine.objectContaining({ status: 'done', summary: 'legacy' }));
    expect(
      settleVexToolStep([], { id: 'one', name: 'read', failed: true })[0]
        .status,
    ).toBe('failed');
  });
});
