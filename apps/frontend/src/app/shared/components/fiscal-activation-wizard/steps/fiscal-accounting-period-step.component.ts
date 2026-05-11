import { Component, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../../environments/environment';
import { FiscalActivationWizardService } from '../../../../core/services/fiscal-activation-wizard.service';
import { FiscalWizardStepId } from '../../../../core/models/fiscal-status.model';
import { FiscalWizardStepHost } from '../wizard-step.contract';
import {
  FiscalPeriodFormComponent,
  FiscalPeriodValue,
} from '../../forms/fiscal-period-form/fiscal-period-form.component';
import { parseApiError } from '../../../../core/utils/parse-api-error';

@Component({
  selector: 'app-fiscal-accounting-period-step',
  standalone: true,
  imports: [CommonModule, FiscalPeriodFormComponent],
  template: `
    <div class="step-body">
      <app-fiscal-period-form
        #form
        [initialValue]="initial()"
        [disabled]="submitting()"
        (validityChange)="onValidity($event)"
      ></app-fiscal-period-form>

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
export class FiscalAccountingPeriodStepComponent
  implements FiscalWizardStepHost
{
  private readonly service = inject(FiscalActivationWizardService);
  private readonly http = inject(HttpClient);

  readonly stepId: FiscalWizardStepId = 'accounting_period';
  readonly valid = signal(false);
  readonly submitting = signal(false);
  readonly localError = signal<string | null>(null);
  readonly initial = signal<Partial<FiscalPeriodValue> | null>(
    this.defaultPeriod(),
  );

  private readonly form = viewChild.required<FiscalPeriodFormComponent>('form');

  private defaultPeriod(): Partial<FiscalPeriodValue> {
    const year = new Date().getFullYear();
    return {
      name: `Año fiscal ${year}`,
      start_date: `${year}-01-01`,
      end_date: `${year}-12-31`,
    };
  }

  private baseUrl(): string {
    // Use userScope (logged-in user) to route the request, NOT
    // lastStatus().fiscal_scope (org-level data location). See
    // FiscalActivationWizardService.userScope for the rationale.
    // TODO: when userScope === 'store' but the org's fiscal_scope is
    // 'ORGANIZATION', this endpoint may still 403 server-side; surface
    // an inline read-only banner like fiscal-legal-data-step.
    return `${environment.apiUrl}/${this.service.userScope()}/accounting/fiscal-periods`;
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
    if (
      this.service.userScope() === 'organization' &&
      this.service.targetStoreId() === null
    ) {
      this.localError.set(
        'Selecciona una tienda en el panel de manejo fiscal antes de continuar.',
      );
      this.submitting.set(false);
      return null;
    }
    try {
      const value = form.getValue();
      // Org fiscal-periods controller accepts `store_id` only via query.
      const storeQuery =
        this.service.userScope() === 'organization' &&
        this.service.targetStoreId() !== null
          ? `?store_id=${this.service.targetStoreId()}`
          : '';
      const res: any = await firstValueFrom(
        this.http.post(`${this.baseUrl()}${storeQuery}`, value),
      );
      const payload = res?.data ?? res;
      const periodId =
        typeof payload?.id === 'number' ? payload.id : (payload?.id ?? null);
      const ref = {
        period_id: periodId,
        name: value.name,
        start_date: value.start_date,
        end_date: value.end_date,
        completed_at: new Date().toISOString(),
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
