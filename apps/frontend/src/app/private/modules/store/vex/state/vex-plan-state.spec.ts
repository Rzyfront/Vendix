import { vexApplyState } from './vex-plan-state';
import type { VexApplyStepResult } from '../services/vex-api.service';

const unknown: VexApplyStepResult = {
  tool: 'create_customer',
  output: '{}',
  execution: {
    schema_version: '1',
    status: 'unknown_effect',
    effect_status: 'unknown',
    error_code: null,
    retryable: false,
    next_action: 'Reconciliar antes de repetir.',
    evidence_refs: [],
    resource_ids: {},
    freshness: 'unknown',
  },
};
describe('B4 Vex apply receipt is not HTTP success', () => {
  it('preserves unknown_effect when a 2xx omits legacy statuses', () => {
    expect(vexApplyState(unknown)).toEqual({
      step_status: 'unknown',
      plan_status: 'unknown_effect',
      error:
        'No pude confirmar si el cambio se aplicó. Revisa el resultado antes de repetirlo.',
    });
  });
  it('never turns missing statuses or contradictory applied flags into done/proposed', () => {
    for (const result of [
      { ...unknown, execution: undefined },
      { ...unknown, step_status: 'applied', plan_status: 'applied' } as const,
      {
        ...unknown,
        step_status: 'unknown',
        plan_status: 'unknown_effect',
      } as const,
    ]) {
      expect(vexApplyState(result)).toEqual(
        jasmine.objectContaining({
          step_status: 'unknown',
          plan_status: 'unknown_effect',
        }),
      );
    }
  });
  it('keeps a definitive not-applied receipt failed, distinct from uncertainty', () => {
    expect(
      vexApplyState({
        ...unknown,
        step_status: 'failed',
        plan_status: 'partially_applied',
        execution: {
          ...unknown.execution!,
          status: 'recoverable_error',
          effect_status: 'not_applied',
        },
      }),
    ).toEqual(
      jasmine.objectContaining({
        step_status: 'failed',
        plan_status: 'failed',
      }),
    );
  });
  it('retains explicit legacy applied status without requiring new metadata', () => {
    expect(
      vexApplyState({
        tool: 'write',
        output: '{}',
        step_status: 'applied',
        plan_status: 'applied',
      }),
    ).toEqual({ step_status: 'done', plan_status: 'done' });
  });
});
