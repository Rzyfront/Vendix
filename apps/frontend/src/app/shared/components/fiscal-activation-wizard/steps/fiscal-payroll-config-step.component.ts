import {
  Component,
  computed,
  effect,
  ElementRef,
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
  PaymentFrequency,
  PayrollParafiscales,
  PayrollSettingsFormComponent,
  PayrollSettingsValue,
} from '../../forms/payroll-settings-form/payroll-settings-form.component';
import { parseApiError } from '../../../../core/utils/parse-api-error';
import { focusFirstInvalid } from '../../../../core/utils/focus-first-invalid';

const PARAFISCAL_KEYS: readonly (keyof PayrollParafiscales)[] = [
  'sena',
  'icbf',
  'caja_compensacion',
  'eps',
  'arl',
  'pension',
];

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
  private readonly host = inject(ElementRef<HTMLElement>);

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
  private seededContextKey: string | null = null;

  constructor() {
    // Seed once per fiscal context, as soon as the prefill snapshot is
    // available. The prefill may land after this step mounts (it is
    // refreshed every time the wizard opens), so the effect tracks it
    // instead of only the context key.
    effect(() => {
      const key = this.service.fiscalContextKey();
      const prefill = this.service.prefill();
      if (!key || !prefill || key === this.seededContextKey) return;
      this.seededContextKey = key;
      const value = this.toPayrollFormValue(prefill.payroll_config);
      if (value) this.initial.set(value);
    });
  }

  private baseUrl(): string {
    // userScope routes the request; backend resolves fiscal ownership.
    return `${environment.apiUrl}/${this.service.userScope()}/payroll/settings`;
  }

  /**
   * Maps the prefill snapshot onto the form. `PUT /payroll/settings` persists
   * the values under `settings.payroll.minimal`, and the prefill exposes the
   * whole `settings.payroll` object as `config`, so the saved values live in
   * `config.minimal`. Legacy tenants that stored them at the root of `config`
   * (flagged with `enabled`) are still honored. Unknown values are dropped so
   * the form keeps its defaults instead of receiving garbage.
   */
  private toPayrollFormValue(
    payroll: WizardPrefillPayrollConfig | null | undefined,
  ): Partial<PayrollSettingsValue> | null {
    const config = payroll?.config;
    if (!config) return null;
    const minimal = this.asRecord(config['minimal']);
    const source = minimal ?? (payroll?.enabled === true ? config : null);
    if (!source) return null;

    const value: Partial<PayrollSettingsValue> = {};
    const frequency = source['payment_frequency'];
    if (this.isPaymentFrequency(frequency)) {
      value.payment_frequency = frequency;
    }
    const withholding = source['withholding_enabled'];
    if (typeof withholding === 'boolean') {
      value.withholding_enabled = withholding;
    }
    const parafiscales = this.asRecord(source['parafiscales']);
    if (parafiscales) {
      const flags: Partial<PayrollParafiscales> = {};
      PARAFISCAL_KEYS.forEach((k) => {
        const flag = parafiscales[k];
        if (typeof flag === 'boolean') flags[k] = flag;
      });
      // patchValue accepts a partial group; the cast only satisfies the
      // form's full-value input type.
      value.parafiscales = flags as PayrollParafiscales;
    }
    const pilaOperator = source['pila_operator'];
    if (typeof pilaOperator === 'string') {
      value.pila_operator = pilaOperator;
    }
    return Object.keys(value).length > 0 ? value : null;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private isPaymentFrequency(value: unknown): value is PaymentFrequency {
    return value === 'MENSUAL' || value === 'QUINCENAL' || value === 'SEMANAL';
  }

  onValidity(v: boolean): void {
    this.valid.set(v);
  }

  async submit(): Promise<{ ref: Record<string, unknown> } | null> {
    const form = this.form();
    form.markAllTouched();
    if (!this.valid()) {
      focusFirstInvalid(this.host);
      return null;
    }

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
