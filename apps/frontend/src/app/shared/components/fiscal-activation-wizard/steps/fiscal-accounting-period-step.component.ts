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
        [disabled]="submitting() || readOnlyForStore()"
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
  readonly existingPeriodId = signal<number | null>(null);
  readonly readOnlyForStore = computed(
    () =>
      this.service.userScope() === 'store' &&
      this.service.lastStatus()?.fiscal_scope === 'ORGANIZATION',
  );

  private readonly form = viewChild.required<FiscalPeriodFormComponent>('form');
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

  private defaultPeriod(): Partial<FiscalPeriodValue> {
    const year = new Date().getFullYear();
    return {
      name: `Año fiscal ${year}`,
      start_date: `${year}-01-01`,
      end_date: `${year}-12-31`,
    };
  }

  private baseUrl(): string {
    // userScope routes the request; backend resolves fiscal ownership.
    return `${environment.apiUrl}/${this.service.userScope()}/accounting/fiscal-periods`;
  }

  private async loadInitial(): Promise<void> {
    try {
      const res: any = await firstValueFrom(
        this.http.get(`${this.baseUrl()}${this.service.storeQuery()}`),
      );
      const payload = res?.data ?? res;
      const items: any[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : Array.isArray(payload?.data)
            ? payload.data
            : [];
      const open = items.find((period) => period?.status === 'open') ?? items[0];
      if (open) {
        this.existingPeriodId.set(typeof open.id === 'number' ? open.id : null);
        this.initial.set({
          name: open.name ?? '',
          start_date: String(open.start_date ?? '').slice(0, 10),
          end_date: String(open.end_date ?? '').slice(0, 10),
        });
      }
    } catch {
      // Silent: default form is fine for new configurations.
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
    if (this.readOnlyForStore()) {
      if (!this.existingPeriodId()) {
        this.localError.set(
          'La configuración fiscal heredada todavía no tiene un periodo fiscal.',
        );
        this.submitting.set(false);
        return null;
      }
      const ref = {
        period_id: this.existingPeriodId(),
        inherited: true,
        completed_at: new Date().toISOString(),
      };
      await this.service.commitStep(this.stepId, ref);
      this.submitting.set(false);
      return { ref };
    }
    if (
      this.service.userScope() === 'organization' &&
      this.service.fiscalDataOwner() === 'store' &&
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
      if (this.existingPeriodId()) {
        const ref = await this.commitExistingPeriod(value);
        return { ref };
      }

      // Org fiscal-periods controller accepts `store_id` only via query.
      const storeQuery = this.service.storeQuery();
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
    } catch (e: any) {
      if (this.isExistingPeriodConflict(e)) {
        await this.loadInitial();
        if (this.existingPeriodId()) {
          const ref = await this.commitExistingPeriod(form.getValue());
          return { ref };
        }
      }
      this.localError.set(parseApiError(e).userMessage);
      return null;
    } finally {
      this.submitting.set(false);
    }
  }

  private async commitExistingPeriod(
    fallback: FiscalPeriodValue,
  ): Promise<Record<string, unknown>> {
    const period = {
      ...fallback,
      ...(this.initial() ?? {}),
    };
    const ref = {
      period_id: this.existingPeriodId(),
      name: period.name,
      start_date: period.start_date,
      end_date: period.end_date,
      reused_existing: true,
      completed_at: new Date().toISOString(),
    };
    await this.service.commitStep(this.stepId, ref);
    return ref;
  }

  private isExistingPeriodConflict(error: any): boolean {
    if (error?.status !== 409) return false;
    const message =
      error?.error?.message?.message ??
      error?.error?.message ??
      error?.message ??
      '';
    return (
      typeof message === 'string' &&
      /Fiscal period overlaps with existing period/i.test(message)
    );
  }
}
