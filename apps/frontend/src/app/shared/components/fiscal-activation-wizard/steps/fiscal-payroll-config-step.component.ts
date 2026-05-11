import {
  Component,
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
        [disabled]="submitting()"
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

  private readonly form =
    viewChild.required<PayrollSettingsFormComponent>('form');
  private loaded = false;

  constructor() {
    effect(() => {
      const scope = this.service.userScope();
      if (scope && !this.loaded) {
        this.loaded = true;
        void this.loadInitial();
      }
    });
  }

  private baseUrl(): string {
    // userScope (logged-in user) routes the request, not org-level fiscal_scope.
    // Dedicated payroll endpoint with UpdatePayrollSettingsDto — NOT /settings.
    // TODO: surface read-only banner if STORE_ADMIN hits an org-owned config.
    return `${environment.apiUrl}/${this.service.userScope()}/payroll/settings`;
  }

  private async loadInitial(): Promise<void> {
    try {
      const res: any = await firstValueFrom(this.http.get(this.baseUrl()));
      const payload = res?.data ?? res;
      if (payload && typeof payload === 'object') {
        this.initial.set(payload as Partial<PayrollSettingsValue>);
      }
    } catch {
      // Silent
    }
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
      await firstValueFrom(this.http.put(this.baseUrl(), value));
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
