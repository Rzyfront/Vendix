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
  DefaultTaxesFormComponent,
  DefaultTaxesValue,
  TaxRow,
} from '../../forms/default-taxes-form/default-taxes-form.component';
import { parseApiError } from '../../../../core/utils/parse-api-error';

@Component({
  selector: 'app-fiscal-default-taxes-step',
  standalone: true,
  imports: [CommonModule, DefaultTaxesFormComponent],
  template: `
    <div class="step-body">
      <app-default-taxes-form
        #form
        [initialValue]="initial()"
        [disabled]="submitting() || readOnlyForStore()"
        (validityChange)="onValidity($event)"
      ></app-default-taxes-form>

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
export class FiscalDefaultTaxesStepComponent implements FiscalWizardStepHost {
  private readonly service = inject(FiscalActivationWizardService);
  private readonly http = inject(HttpClient);

  readonly stepId: FiscalWizardStepId = 'default_taxes';
  readonly valid = signal(true);
  readonly submitting = signal(false);
  readonly localError = signal<string | null>(null);
  readonly initial = signal<Partial<DefaultTaxesValue> | null>({
    mode: 'defaults',
    taxes: [],
  });
  readonly existingCount = signal(0);
  readonly readOnlyForStore = computed(
    () =>
      this.service.userScope() === 'store' &&
      this.service.lastStatus()?.fiscal_scope === 'ORGANIZATION',
  );

  private readonly form = viewChild.required<DefaultTaxesFormComponent>('form');
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
    return `${environment.apiUrl}/${this.service.userScope()}/taxes`;
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
      this.existingCount.set(items.length);
      if (items.length > 0) {
        this.initial.set({
          mode: 'custom',
          taxes: items.map((item) => {
            const rate = item?.tax_rates?.[0]?.rate ?? item?.rate ?? 0;
            return {
              name: item.name ?? '',
              percentage: Number(rate) * 100,
              type: this.guessType(item.name ?? ''),
            };
          }),
        });
      }
    } catch {
      // Silent: defaults mode is fine for new configurations.
    }
  }

  private guessType(name: string): TaxRow['type'] {
    const normalized = name.toLowerCase();
    if (normalized.includes('ica')) return 'ICA';
    if (normalized.includes('ret')) return 'WITHHOLDING';
    return 'VAT';
  }

  onValidity(v: boolean): void {
    this.valid.set(v);
  }

  private mapType(t: TaxRow['type']): 'percentage' | 'fixed' {
    // Backend TaxType only supports percentage/fixed. VAT/ICA/WITHHOLDING are all percentage-based.
    return 'percentage';
  }

  async submit(): Promise<{ ref: Record<string, unknown> } | null> {
    const form = this.form();
    form.markAllTouched();
    if (!this.valid()) return null;

    this.submitting.set(true);
    this.localError.set(null);
    if (this.readOnlyForStore()) {
      if (this.existingCount() === 0) {
        this.localError.set(
          'La configuración fiscal heredada todavía no tiene impuestos configurados.',
        );
        this.submitting.set(false);
        return null;
      }
      const ref = {
        count: this.existingCount(),
        inherited: true,
        completed_at: new Date().toISOString(),
      };
      await this.service.commitStep(this.stepId, ref);
      this.submitting.set(false);
      return { ref };
    }
    try {
      const value = form.getValue();
      let count = 0;

      if (value.mode === 'defaults') {
        const res: any = await firstValueFrom(
          this.http.post(`${this.baseUrl()}/seed-default${this.service.storeQuery()}`, {
            force: false,
            ...this.service.storeContext(),
          }),
        );
        const payload = res?.data ?? res;
        count =
          typeof payload?.count === 'number'
            ? payload.count
            : Array.isArray(payload)
              ? payload.length
              : Array.isArray(payload?.taxes)
                ? payload.taxes.length
                : 0;
      } else {
        for (const row of value.taxes ?? []) {
          await firstValueFrom(
            this.http.post(this.baseUrl(), {
              name: row.name,
              type: this.mapType(row.type),
              rate: row.percentage,
              is_inclusive: false,
              ...this.service.storeContext(),
            }),
          );
          count++;
        }
      }

      const ref = {
        mode: value.mode,
        count,
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
