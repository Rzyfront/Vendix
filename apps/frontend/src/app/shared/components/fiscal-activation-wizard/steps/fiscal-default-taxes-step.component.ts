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
  WizardPrefillDefaultTaxes,
} from '../../../../core/models/wizard-prefill.model';
import { FiscalWizardStepHost } from '../wizard-step.contract';
import {
  DefaultTaxesFormComponent,
  DefaultTaxesValue,
  TaxRow,
  UI_TO_FISCAL_TAX_TYPE,
} from '../../forms/default-taxes-form/default-taxes-form.component';
import { ConfirmationModalComponent } from '../../confirmation-modal/confirmation-modal.component';
import { parseApiError } from '../../../../core/utils/parse-api-error';

@Component({
  selector: 'app-fiscal-default-taxes-step',
  standalone: true,
  imports: [CommonModule, DefaultTaxesFormComponent, ConfirmationModalComponent],
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

      <app-confirmation-modal
        [(isOpen)]="confirmForceOpen"
        title="Sobrescribir impuestos actuales"
        message="Ya tienes impuestos configurados. Al continuar con los valores predeterminados se <strong>sobrescribirán tus tarifas actuales</strong> por los valores estándar colombianos (IVA 19%, IVA 5%, IVA Exento, Impoconsumo 8%, ICA Bogotá y Retención en la Fuente). Esta acción no se puede deshacer."
        confirmText="Sí, sobrescribir"
        cancelText="Cancelar"
        confirmVariant="danger"
        (confirm)="onConfirmForce()"
        (cancel)="onCancelForce()"
      ></app-confirmation-modal>
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

  /** Controls the "overwrite current taxes" confirmation modal (B1). */
  readonly confirmForceOpen = signal(false);
  private forceResolver: ((confirmed: boolean) => void) | null = null;

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

    // If the confirmation modal is dismissed via backdrop/escape (which does
    // not emit confirm/cancel), still resolve the pending decision as cancel
    // so submit() never hangs.
    effect(() => {
      if (!this.confirmForceOpen() && this.forceResolver) {
        const resolve = this.forceResolver;
        this.forceResolver = null;
        resolve(false);
      }
    });
  }

  private baseUrl(): string {
    return `${environment.apiUrl}/${this.service.userScope()}/taxes`;
  }

  private async loadInitial(): Promise<void> {
    // Replaces the previous N+1 GET against `/taxes`. The prefill payload
    // exposes per-category rate counts (not the rate values themselves), so
    // we seed the form with category names + an empty percentage that the
    // user can adjust. The POST endpoints in submit() are still the write
    // path; the canonical `/taxes` GET is no longer needed by this wizard.
    const taxes = this.service.prefill()?.default_taxes;
    if (!taxes) {
      // No prefill or backend reported no taxes — defaults mode.
      return;
    }
    this.existingCount.set(taxes.total_categories);
    if (taxes.total_categories > 0) {
      this.initial.set(this.toTaxesFormValue(taxes));
    }
  }

  private toTaxesFormValue(
    taxes: WizardPrefillDefaultTaxes,
  ): Partial<DefaultTaxesValue> {
    return {
      mode: 'custom',
      // B2: load the REAL rate/type from the frozen prefill contract. Fall
      // back to 0 / guessType only when the backend has no value yet.
      // Backend `rate` is a raw decimal FRACTION (0.19 = 19%, 0.00966 = 0.966%)
      // while the form stores the human-readable percentage (19, 5, 0.966), so
      // multiply by 100. Round to strip binary-float artifacts
      // (0.19 * 100 = 19.000000000000004).
      taxes: taxes.categories.map((category) => ({
        name: category.name,
        percentage:
          category.rate != null
            ? Math.round(category.rate * 100 * 1e6) / 1e6
            : 0,
        type: this.mapFiscalTaxType(category.tax_type, category.name),
      })),
    };
  }

  /**
   * Maps the backend fiscal `tax_type` ('iva' | 'inc' | 'ica' | 'withholding')
   * back to the UI tax type. Falls back to a name-based guess only when the
   * category is not yet classified (`tax_type === null`).
   */
  private mapFiscalTaxType(
    taxType: string | null,
    name: string,
  ): TaxRow['type'] {
    switch ((taxType ?? '').toLowerCase()) {
      case 'iva':
        return 'VAT';
      case 'inc':
        return 'INC';
      case 'ica':
        return 'ICA';
      case 'withholding':
        return 'WITHHOLDING';
      default:
        return this.guessType(name);
    }
  }

  private guessType(name: string): TaxRow['type'] {
    const normalized = name.toLowerCase();
    if (normalized.includes('ica')) return 'ICA';
    if (normalized.includes('ret')) return 'WITHHOLDING';
    if (
      normalized.includes('consumo') ||
      normalized.includes('impoconsumo') ||
      normalized.includes('inc')
    )
      return 'INC';
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

    this.localError.set(null);

    if (this.readOnlyForStore()) {
      this.submitting.set(true);
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

    const value = form.getValue();

    // B1: re-seeding the Colombian defaults on top of an existing tax setup
    // OVERWRITES the current rates. Ask for explicit confirmation first and
    // only then seed with force. If the user cancels, do nothing.
    let force = false;
    if (value.mode === 'defaults' && this.existingCount() > 0) {
      const confirmed = await this.askForceOverwrite();
      if (!confirmed) return null;
      force = true;
    }

    this.submitting.set(true);
    try {
      let count = 0;

      if (value.mode === 'defaults') {
        count = await this.seedDefaults(force);
      } else {
        for (const row of value.taxes ?? []) {
          await firstValueFrom(
            this.http.post(this.baseUrl(), {
              name: row.name,
              type: this.mapType(row.type),
              tax_type: UI_TO_FISCAL_TAX_TYPE[row.type],
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

  /**
   * POSTs the Colombian default tax set. Handles TAXES_ALREADY_SEEDED
   * defensively (mirrors how fiscal-puc-step handles CHART_ALREADY_SEEDED):
   * if a 409 escapes because the prefill snapshot was stale, offer to
   * overwrite with force instead of surfacing a raw error.
   */
  private async seedDefaults(force: boolean): Promise<number> {
    try {
      const res: any = await firstValueFrom(
        this.http.post(
          `${this.baseUrl()}/seed-default${this.service.storeQuery()}`,
          { force, ...this.service.storeContext() },
        ),
      );
      return this.extractSeedCount(res);
    } catch (error: any) {
      const parsed = parseApiError(error);
      if (parsed.errorCode !== 'TAXES_ALREADY_SEEDED' || force) {
        // Not the "already seeded" case, or we already forced and it still
        // failed — let the outer handler surface a safe message.
        throw error;
      }
      // Stale snapshot: taxes exist but the prefill said otherwise. Offer the
      // same overwrite decision instead of a raw error.
      const confirmed = await this.askForceOverwrite();
      if (!confirmed) {
        // Keep the existing taxes; refresh the count so the step still commits.
        await this.service.loadPrefill(true);
        const existing =
          this.service.prefill()?.default_taxes?.total_categories ?? 0;
        this.existingCount.set(existing);
        if (existing === 0) throw error;
        return existing;
      }
      const res: any = await firstValueFrom(
        this.http.post(
          `${this.baseUrl()}/seed-default${this.service.storeQuery()}`,
          { force: true, ...this.service.storeContext() },
        ),
      );
      return this.extractSeedCount(res);
    }
  }

  private extractSeedCount(res: any): number {
    const payload = res?.data ?? res;
    return typeof payload?.count === 'number'
      ? payload.count
      : Array.isArray(payload)
        ? payload.length
        : Array.isArray(payload?.taxes)
          ? payload.taxes.length
          : 0;
  }

  /** Opens the overwrite confirmation modal and resolves with the choice. */
  private askForceOverwrite(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.forceResolver = resolve;
      this.confirmForceOpen.set(true);
    });
  }

  onConfirmForce(): void {
    const resolve = this.forceResolver;
    this.forceResolver = null;
    this.confirmForceOpen.set(false);
    resolve?.(true);
  }

  onCancelForce(): void {
    const resolve = this.forceResolver;
    this.forceResolver = null;
    this.confirmForceOpen.set(false);
    resolve?.(false);
  }
}
