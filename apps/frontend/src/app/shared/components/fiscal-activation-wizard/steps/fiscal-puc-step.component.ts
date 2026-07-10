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
  PucBootstrapFormComponent,
  PucBootstrapValue,
} from '../../forms/puc-bootstrap-form/puc-bootstrap-form.component';
import { parseApiError } from '../../../../core/utils/parse-api-error';

@Component({
  selector: 'app-fiscal-puc-step',
  standalone: true,
  imports: [CommonModule, PucBootstrapFormComponent],
  template: `
    <div class="step-body">
      <app-puc-bootstrap-form
        #form
        [initialValue]="initial()"
        [disabled]="submitting() || readOnlyForStore()"
        (validityChange)="onValidity($event)"
      ></app-puc-bootstrap-form>

      @if (pucExists()) {
        <div class="preview">
          <h3>Plan de cuentas existente</h3>
          <p>
            Ya tienes {{ pucPostableCount() }} cuentas postables configuradas.
            Si continúas con el modo "predeterminado" no se crearán duplicados.
          </p>
        </div>
      }

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
      .preview {
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
        padding: 0.75rem 1rem;
        background: var(--color-surface-secondary);
      }
      .preview h3 {
        margin: 0 0 0.5rem;
        font-size: 0.85rem;
        font-weight: 700;
        color: var(--color-text-secondary);
      }
      .preview p {
        margin: 0;
        font-size: 0.85rem;
        color: var(--color-text-secondary);
        line-height: 1.4rem;
      }
      .step-error {
        margin: 0;
        font-size: 0.85rem;
        color: var(--color-destructive);
      }
    `,
  ],
})
export class FiscalPucStepComponent implements FiscalWizardStepHost {
  private readonly service = inject(FiscalActivationWizardService);
  private readonly http = inject(HttpClient);

  readonly stepId: FiscalWizardStepId = 'puc';
  readonly valid = signal(true);
  readonly submitting = signal(false);
  readonly localError = signal<string | null>(null);
  readonly initial = signal<Partial<PucBootstrapValue> | null>({
    source: 'default',
    rows: [],
  });
  /**
   * True when the chart of accounts already exists. Seeded from the prefill
   * snapshot — no GET needed. The PUC bootstrap form has its own internal
   * `rows` state; this signal is only a UX hint surfaced in the template.
   */
  readonly pucExists = signal(false);
  readonly pucPostableCount = signal(0);
  readonly readOnlyForStore = computed(
    () =>
      this.service.userScope() === 'store' &&
      this.service.lastStatus()?.fiscal_scope === 'ORGANIZATION',
  );

  private readonly form = viewChild.required<PucBootstrapFormComponent>('form');
  private loadedContextKey: string | null = null;

  readonly scopeLabel = computed(() =>
    this.service.userScope() === 'organization' ? 'ORGANIZATION' : 'STORE',
  );

  constructor() {
    effect(() => {
      const key = this.service.fiscalContextKey();
      if (key && key !== this.loadedContextKey) {
        this.loadedContextKey = key;
        this.loadFromPrefill();
      }
    });
  }

  private baseUrl(): string {
    // userScope routes the request; backend resolves fiscal ownership.
    return `${environment.apiUrl}/${this.service.userScope()}/accounting/chart-of-accounts`;
  }

  private loadFromPrefill(): void {
    // Replaces the previous N+1 GET against `/accounting/chart-of-accounts`.
    // The prefill snapshot already reports `exists` + the postable count —
    // that's all the template uses to render the "ya tienes N cuentas"
    // hint. The canonical POST `/seed-default` and per-row POSTs in
    // submit() are still the write paths.
    const puc = this.service.prefill()?.puc;
    this.pucExists.set(puc?.exists ?? false);
    this.pucPostableCount.set(puc?.postable_accounts ?? 0);
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
      const ref = {
        count: this.pucPostableCount(),
        inherited: true,
        completed_at: new Date().toISOString(),
      };
      await this.service.commitStep(this.stepId, ref);
      this.submitting.set(false);
      return { ref };
    }
    // For ORG_ADMIN custom-row POSTs, the backend resolves `store_id` only
    // from `?store_id=` query. Block early if no target store has been
    // chosen and the user is going down the custom path on an
    // operating_scope=STORE org.
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
      let count = 0;

      // ORG-level seed-default is purely organization-scoped (chart owned by
      // the org); store_id is intentionally omitted here. Custom-row POSTs
      // need `?store_id=` so the org service can pin per-store accounts when
      // operating_scope=STORE.
      const storeQuery = this.service.storeQuery();

      if (value.source === 'default') {
        if (this.pucExists()) {
          count = this.pucPostableCount();
        } else {
          try {
            const res: any = await firstValueFrom(
              this.http.post(`${this.baseUrl()}/seed-default${storeQuery}`, {
                force: false,
                ...this.service.storeContext(),
              }),
            );
            const payload = res?.data ?? res;
            count =
              typeof payload?.count === 'number'
                ? payload.count
                : typeof payload?.accounts_processed === 'number'
                  ? payload.accounts_processed
                  : Array.isArray(payload?.accounts)
                    ? payload.accounts.length
                    : 0;
          } catch (error: any) {
            const parsed = parseApiError(error);
            if (parsed.errorCode !== 'CHART_ALREADY_SEEDED') {
              throw error;
            }
            // Backend says the chart is already seeded even though the
            // prefill said otherwise (concurrent write / stale snapshot).
            // Refresh the prefill and reuse the postable count.
            await this.service.loadPrefill(true);
            this.loadFromPrefill();
            count = this.pucPostableCount();
            if (count === 0) {
              throw error;
            }
          }
        }
      } else {
        // CSV / custom path: loop POST per row. Append ?store_id when
        // ORG_ADMIN so the org service routes the create correctly.
        for (const row of value.rows ?? []) {
          await firstValueFrom(
            this.http.post(`${this.baseUrl()}${storeQuery}`, {
              code: row.code,
              name: row.name,
              account_type: row.account_type,
              parent_code: row.parent_code,
            }),
          );
          count++;
        }
      }

      await this.service.loadPrefill(true);
      this.loadFromPrefill();
      const ref = {
        source: value.source,
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
