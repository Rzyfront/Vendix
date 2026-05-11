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

interface ChartAccountPreview {
  id: number;
  code: string;
  name: string;
}

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

      @if (preview().length) {
        <div class="preview">
          <h3>Vista previa del PUC actual</h3>
          <ul>
            @for (acc of preview(); track acc.id) {
              <li>
                <code>{{ acc.code }}</code>
                <span>{{ acc.name }}</span>
              </li>
            }
          </ul>
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
        border: 1px solid var(--border-color, #e5e7eb);
        border-radius: 0.5rem;
        padding: 0.75rem 1rem;
        background: var(--surface-muted, #f8fafc);
      }
      .preview h3 {
        margin: 0 0 0.5rem;
        font-size: 0.85rem;
        font-weight: 700;
        color: var(--text-secondary, #475569);
      }
      .preview ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.25rem;
      }
      .preview li {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-size: 0.85rem;
      }
      .preview code {
        font-weight: 700;
        color: var(--primary-color, #2563eb);
      }
      .step-error {
        margin: 0;
        font-size: 0.85rem;
        color: var(--color-destructive, #b91c1c);
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
  readonly preview = signal<ChartAccountPreview[]>([]);
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
        void this.loadPreview();
      }
    });
  }

  private baseUrl(): string {
    // userScope routes the request; backend resolves fiscal ownership.
    return `${environment.apiUrl}/${this.service.userScope()}/accounting/chart-of-accounts`;
  }

  private async loadPreview(): Promise<void> {
    try {
      // Org chart-of-accounts GET takes `?store_id=` to narrow the listing to
      // a single store when operating_scope=STORE. Otherwise the consolidated
      // org view is returned.
      const storeParam = this.service.storeQuery('&');
      const res: any = await firstValueFrom(
        this.http.get(`${this.baseUrl()}?limit=10${storeParam}`),
      );
      const payload = res?.data ?? res;
      const items: any[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : Array.isArray(payload?.data)
            ? payload.data
            : [];
      this.preview.set(
        items.slice(0, 10).map((a: any) => ({
          id: a.id,
          code: a.code ?? a.account_code ?? '',
          name: a.name ?? a.account_name ?? '',
        })),
      );
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
    if (this.readOnlyForStore()) {
      const ref = {
        count: this.preview().length,
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
        if (this.preview().length > 0) {
          count = this.preview().length;
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
            await this.loadPreview();
            count = this.preview().length;
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

      await this.loadPreview();
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
