import {
  buildWorkflowLimits,
  emptyWorkflowLimitsForm,
  workflowLimitsToForm,
} from './workflow-limits.util';

describe('workflow limits of a plan (P7.1)', () => {
  it('an empty section sends null for the whole object', () => {
    expect(buildWorkflowLimits(emptyWorkflowLimitsForm())).toBeNull();
  });

  it('sends only the lines that were filled', () => {
    const form = emptyWorkflowLimitsForm();
    form.monthly_instances = { value: 500, unlimited: false };
    expect(buildWorkflowLimits(form)).toEqual({ monthly_instances: 500 });
  });

  it('"Sin límite" sends null for that key, whatever number was typed', () => {
    const form = emptyWorkflowLimitsForm();
    form.monthly_http_calls = { value: 10, unlimited: true };
    expect(buildWorkflowLimits(form)).toEqual({ monthly_http_calls: null });
  });

  it('storage is typed in GB and sent in bytes', () => {
    const form = emptyWorkflowLimitsForm();
    form.storage_bytes = { value: 2, unlimited: false };
    expect(buildWorkflowLimits(form)).toEqual({ storage_bytes: 2 * 1024 ** 3 });
  });

  it('a zero is a real cap, not an empty line', () => {
    const form = emptyWorkflowLimitsForm();
    form.monthly_instances = { value: 0, unlimited: false };
    expect(buildWorkflowLimits(form)).toEqual({ monthly_instances: 0 });
  });

  it('a negative or non-finite number is left out', () => {
    const form = emptyWorkflowLimitsForm();
    form.monthly_instances = { value: -1, unlimited: false };
    form.monthly_http_calls = { value: Number.NaN, unlimited: false };
    expect(buildWorkflowLimits(form)).toBeNull();
  });

  it('loads a stored plan back into the lines (null key = Sin límite, bytes = GB)', () => {
    const form = workflowLimitsToForm({ monthly_instances: 500, monthly_http_calls: null, storage_bytes: 5 * 1024 ** 3 });
    expect(form.monthly_instances).toEqual({ value: 500, unlimited: false });
    expect(form.monthly_http_calls).toEqual({ value: null, unlimited: true });
    expect(form.storage_bytes).toEqual({ value: 5, unlimited: false });
  });

  it('a plan without limits loads an empty section, and it round-trips to null', () => {
    expect(workflowLimitsToForm(null)).toEqual(emptyWorkflowLimitsForm());
    expect(buildWorkflowLimits(workflowLimitsToForm(undefined))).toBeNull();
  });

  it('save then load keeps the same limits', () => {
    const stored = { monthly_instances: 20, storage_bytes: 3 * 1024 ** 3, monthly_http_calls: null };
    expect(buildWorkflowLimits(workflowLimitsToForm(stored))).toEqual(stored);
  });
});
