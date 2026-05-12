import type { Signal } from '@angular/core';

import type { FiscalWizardStepId } from '../../../core/models/fiscal-status.model';

export interface FiscalWizardStepHost {
  readonly stepId: FiscalWizardStepId;
  readonly valid: Signal<boolean>;
  readonly submitting: Signal<boolean>;
  submit(): Promise<{ ref: Record<string, unknown> } | null>;
}
