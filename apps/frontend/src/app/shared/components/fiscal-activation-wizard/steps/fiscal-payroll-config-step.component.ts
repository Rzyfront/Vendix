import {
  Component,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../../environments/environment';
import { FiscalActivationWizardService } from '../../../../core/services/fiscal-activation-wizard.service';
import { FiscalWizardStepId } from '../../../../core/models/fiscal-status.model';
import {
  WizardPrefillPayrollConfig,
} from '../../../../core/models/wizard-prefill.model';
import { FiscalWizardStepHost } from '../wizard-step.contract';
import {
  PayrollSettingsFormComponent,
  PayrollSettingsValue,
} from '../../forms/payroll-settings-form/payroll-settings-form.component';
import { parseApiError } from '../../../../core/utils/parse-api-error';

@Component({
  selector: 'app-fiscal-payroll-config-step',
  standalone: true,
  imports: [CommonModule, PayrollSettingsFormComponent],
  template: `
    <div class="step-body">
      <app-payroll-settings-form
        #form
        [initialValue]="initial()"
        [disabled]="submitting() || readOnlyForStore()"
        (validityChange)="onValidity($event)"
      ></app-payroll-settings-form>

      @if (localError()) {
        <p class="step-error" role="alert">{{ localError() }}</p>
      }
    </div>
  `,
  styles: [
    `
      .step-body {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .step-error {
        margin: 0;
        font-size: 0.85rem;
        color: var(--color-destructive, #b91c1c);
      }
    `,
  ],
})
export class FiscalPayrollConfigStepComponent implements FiscalWizardStepHost {
  private readonly service = inject(FiscalActivationWizardService);
  private readonly http = inject(HttpClient);

  readonly stepId: FiscalWizardStepId = 'payroll_config';
  readonly valid = signal(true);
  readonly submitting = signal(false);
  readonly localError = signal<string | null>(null);
  readonly initial = signal<Partial<PayrollSettingsValue> | null>(null);
  readonly readOnlyForStore = computed(
    () =>
      this.service.userScope() === 'store' &&
      this.service.lastStatus()?.fiscal_scope === 'ORGANIZATION',
  );

  private readonly form =
    viewChild.required<PayrollSettingsFormComponent>('form');
  private loadedContextKey: string | null = null;

  constructor() {
    effect(() => {
      const key = this.service.fiscalContextKey();
      if (key && key !== this.loadedContextKey) {
        this.loadedContextKey = key;
        void this.loadInitial();
      }
    });
  }

  private baseUrl(): string {
    // userScope routes the request; backend resolves fiscal ownership.
    return `${environment.apiUrl}/${this.service.userScope()}/payroll/settings`;
  }

  private async loadInitial(): Promise<void> {
    // Replaces the previous N+1 GET against `/payroll/settings`. The
    // prefill snapshot carries the full `payroll.config` object, which is
    // what the form needs to seed initial values. The canonical PUT in
    // submit() is still the write path.
    const payroll = this.service.prefill()?.payroll_config;
    if (!payroll?.enabled || !payroll.config) {
      // No prefill, payroll not enabled, or no config object — empty form.
      return;
    }
    this.initial.set(this.toPayrollFormValue(payroll));
  }

  private toPayrollFormValue(
    payroll: WizardPrefillPayrollConfig,
  ): Partial<PayrollSettingsValue> {
    // `defaults_year` is informational — surfaced elsewhere in the UI; the
    // payroll form only cares about the runtime config (frequency,
    // withholding, parafiscales, pila operator).
    return (payroll.config as Partial<PayrollSettingsValue>) ?? null;
  }

  onValidity(v: boolean): void {
    this.valid.set(v);
  }

  async submit(): Promise<{ ref: Record<string, unknown> } | null> {
    const form = this.form();
    form.markAllTouched();
    if (!this.valid()) return null;

    this.submitting.set(true);
    this.localError.set(null);
    try {
      const value = form.getValue();
      if (this.readOnlyForStore()) {
        const ref = {
          payment_frequency: value.payment_frequency,
          inherited: true,
          saved_at: new Date().toISOString(),
        };
        await this.service.commitStep(this.stepId, ref);
        return { ref };
      }
      await firstValueFrom(
        this.http.put(`${this.baseUrl()}${this.service.storeQuery()}`, {
          ...value,
          ...this.service.storeContext(),
        }),
      );
      const ref = {
        payment_frequency: value.payment_frequency,
        saved_at: new Date().toISOString(),
      };
      await this.service.commitStep(this.stepId, ref);
      return { ref };
    } catch (e) {
      this.localError.set(parseApiError(e).userMessage);
      return null;
    } finally {
      this.submitting.set(false);
    }
  }
}
