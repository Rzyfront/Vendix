import type { VexApplyStepResult } from '../services/vex-api.service';
import type { VexPlanStatus, VexPlanStepStatus } from '../models/vex.models';
import { vexiErrorText } from '../../../../../core/store/vexi/vexi-user-copy.utils';

/** HTTP success is transport only. Missing or contradictory receipts fail closed. */
export function vexApplyState(result: VexApplyStepResult): {
  step_status: VexPlanStepStatus;
  plan_status: VexPlanStatus;
  error?: string;
} {
  const receipt = result.execution;
  if (
    result.step_status === 'unknown' ||
    result.plan_status === 'unknown_effect' ||
    (receipt &&
      (receipt.status !== 'ok' || receipt.effect_status !== 'applied')) ||
    !result.step_status ||
    !result.plan_status
  ) {
    if (
      result.step_status === 'failed' &&
      receipt?.effect_status === 'not_applied'
    ) {
      return {
        step_status: 'failed',
        plan_status: 'failed',
        error: `${vexiErrorText(receipt.error_code)}.`,
      };
    }
    return {
      step_status: 'unknown',
      plan_status: 'unknown_effect',
      error:
        'No pude confirmar si el cambio se aplicó. Revisa el resultado antes de repetirlo.',
    };
  }
  return {
    step_status: result.step_status === 'applied' ? 'done' : result.step_status,
    plan_status: result.plan_status === 'applied' ? 'done' : result.plan_status,
  };
}
