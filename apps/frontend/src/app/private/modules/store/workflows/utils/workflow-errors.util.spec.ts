import { HttpErrorResponse } from '@angular/common/http';
import { isPlanLimit, toWorkflowError } from './workflow-errors.util';

describe('isPlanLimit (P7.1)', () => {
  const failure = (status: number, error_code: string) =>
    toWorkflowError(new HttpErrorResponse({ status, error: { error_code, message: 'x' } }));

  it('is true for a Flows plan limit, which the paywall already explains', () => {
    expect(isPlanLimit(failure(402, 'WORKFLOW_PLAN_LIMIT_REACHED'))).toBeTrue();
  });

  it('is false for any other refusal, which the screen must still show', () => {
    expect(isPlanLimit(failure(422, 'WORKFLOW_FORM_INVALID'))).toBeFalse();
    expect(isPlanLimit(failure(409, 'WORKFLOW_STALE'))).toBeFalse();
    expect(isPlanLimit(failure(403, 'WORKFLOW_STAGE_FORBIDDEN'))).toBeFalse();
  });
});
