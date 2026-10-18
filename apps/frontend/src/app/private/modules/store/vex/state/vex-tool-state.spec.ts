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
  it.each([
    ['pending_confirmation', 'waiting'],
    ['needs_user_input', 'waiting'],
    ['unknown_effect', 'unknown'],
    ['recoverable_error', 'failed'],
    ['blocked', 'failed'],
    ['ok', 'done'],
  ] as const)(
    'maps %s to %s rather than inventing applied success',
    (status, expected) => {
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
  it.each(['unknown', 'truncated'] as const)(
    'treats %s evidence as unverified',
    (freshness) => {
      expect(
        settleVexToolStep([], {
          id: 'one',
          name: 'read',
          execution: receipt('ok', freshness),
        })[0].status,
      ).toBe('unknown');
    },
  );
  it('upserts exactly one step when a result repeats or its call was not observed', () => {
    const tool = { id: 'same', name: 'read', execution: receipt('ok') };
    expect(settleVexToolStep(settleVexToolStep([], tool), tool)).toHaveLength(
      1,
    );
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
    ).toMatchObject({ status: 'done', summary: 'legacy' });
    expect(
      settleVexToolStep([], { id: 'one', name: 'read', failed: true })[0]
        .status,
    ).toBe('failed');
  });
});
