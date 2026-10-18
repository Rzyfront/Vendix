import type { VexToolStep } from '../models/vex.models';
import type { VexiToolExecution } from '../../../../../core/services/vexi-api.service';
import {
  vexiToolLabel,
  vexiToolStepStatus,
} from '../../../../../core/store/vexi/vexi-execution.utils';

/** Same semantic receipts as the dock. Pending/uncertain is never green success. */
export function settleVexToolStep(
  steps: VexToolStep[],
  tool: {
    id: string;
    name: string;
    summary?: string;
    failed?: boolean;
    execution?: VexiToolExecution;
  },
): VexToolStep[] {
  const resolved: VexToolStep = {
    id: tool.id,
    name: tool.name,
    summary: vexiToolLabel(tool.execution) ?? tool.summary,
    status: vexiToolStepStatus(tool.execution, tool.failed),
  };
  return steps.some((step) => step.id === tool.id)
    ? steps.map((step) => (step.id === tool.id ? resolved : step))
    : [...steps, resolved];
}

export function cancelVexToolSteps(steps: VexToolStep[]): VexToolStep[] {
  return steps.map((step) =>
    step.status === 'running'
      ? {
          ...step,
          status: 'unknown',
          summary: 'Respuesta detenida; el resultado debe verificarse.',
        }
      : step,
  );
}
