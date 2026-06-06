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
  AccountMappingsFormComponent,
  AccountMappingsValue,
  AccountOption,
  MappingKeyDef,
} from '../../forms/account-mappings-form/account-mappings-form.component';
import { parseApiError } from '../../../../core/utils/parse-api-error';
import { ToastService } from '../../toast/toast.service';

// Canonical mapping keys (mirrors DEFAULT_ACCOUNT_MAPPINGS in the backend).
const DEFAULT_MAPPING_KEYS: MappingKeyDef[] = [
  { key: 'invoice.validated.accounts_receivable', label: 'Factura · Cuentas por cobrar' },
  { key: 'invoice.validated.revenue', label: 'Factura · Ingresos' },
  { key: 'invoice.validated.vat_payable', label: 'Factura · IVA por pagar' },
  { key: 'payment.received.cash', label: 'Pago recibido · Caja/Banco' },
  { key: 'payment.received.accounts_receivable', label: 'Pago recibido · Cuentas por cobrar' },
  { key: 'payment.received.revenue', label: 'Pago recibido · Ingresos (venta directa)' },
  { key: 'expense.approved.expense', label: 'Gasto aprobado · Gasto' },
  { key: 'expense.approved.accounts_payable', label: 'Gasto aprobado · Proveedores' },
  { key: 'expense.paid.accounts_payable', label: 'Gasto pagado · Proveedores' },
  { key: 'expense.paid.cash', label: 'Gasto pagado · Caja/Banco' },
  { key: 'payroll.approved.payroll_expense', label: 'Nómina aprobada · Gasto personal' },
  { key: 'payroll.approved.social_security', label: 'Nómina aprobada · Seguridad social' },
  { key: 'payroll.approved.salaries_payable', label: 'Nómina aprobada · Salarios por pagar' },
  { key: 'payroll.approved.health_payable', label: 'Nómina aprobada · EPS por pagar' },
  { key: 'payroll.approved.pension_payable', label: 'Nómina aprobada · Pensión por pagar' },
  { key: 'payroll.approved.withholdings', label: 'Nómina aprobada · Retenciones' },
];

@Component({
  selector: 'app-fiscal-accounting-mappings-step',
  standalone: true,
  imports: [CommonModule, AccountMappingsFormComponent],
  template: `
    <div class="step-body">
      <app-account-mappings-form
        #form
        [initialValue]="initial()"
        [disabled]="submitting() || readOnlyForStore()"
        [mappingKeys]="mappingKeys()"
        [availableAccounts]="accounts()"
        (validityChange)="onValidity($event)"
        (applyDefaultsClicked)="onApplyDefaults()"
      ></app-account-mappings-form>

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
export class FiscalAccountingMappingsStepComponent
  implements FiscalWizardStepHost
{
  private readonly service = inject(FiscalActivationWizardService);
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);

  readonly stepId: FiscalWizardStepId = 'accounting_mappings';
  readonly valid = signal(true);
  readonly submitting = signal(false);
  readonly localError = signal<string | null>(null);
  readonly initial = signal<Partial<AccountMappingsValue> | null>(null);
  readonly mappingKeys = signal<MappingKeyDef[]>(DEFAULT_MAPPING_KEYS);
  readonly accounts = signal<AccountOption[]>([]);
  readonly existingCount = signal(0);
  readonly readOnlyForStore = computed(
    () =>
      this.service.userScope() === 'store' &&
      this.service.lastStatus()?.fiscal_scope === 'ORGANIZATION',
  );

  private readonly form =
    viewChild.required<AccountMappingsFormComponent>('form');
  private loadedContextKey: string | null = null;

  constructor() {
    effect(() => {
      const key = this.service.fiscalContextKey();
      if (key && key !== this.loadedContextKey) {
        this.loadedContextKey = key;
        void this.loadData();
      }
    });
  }

  private mappingsUrl(): string {
    // userScope routes the request, not org-level fiscal_scope.
    // Org uses `/mappings` while store uses `/account-mappings`.
    // TODO: surface read-only banner if STORE_ADMIN hits an org-owned config.
    return this.service.userScope() === 'organization'
      ? `${environment.apiUrl}/organization/accounting/mappings`
      : `${environment.apiUrl}/store/accounting/account-mappings`;
  }

  private coaUrl(): string {
    return `${environment.apiUrl}/${this.service.userScope()}/accounting/chart-of-accounts`;
  }

  private async loadData(): Promise<void> {
    try {
      // Prefill gives us the already-mapped keys (no account_id though),
      // so we seed `existingCount` from there. We still need the canonical
      // GETs for the full account_id mappings AND the CoA dropdown options
      // — those are not in the prefill snapshot, so the GETs are NOT
      // redundant. We do them in parallel to keep latency low.
      const prefillMappings = this.service.prefill()?.accounting_mappings;
      this.existingCount.set(prefillMappings?.total ?? 0);

      // Both GETs accept `?store_id=` to narrow the org-level views when a
      // specific store is selected (operating_scope=STORE or per-store
      // overrides). For consolidated org reads (no targetStoreId) the query
      // is omitted and the backend returns org-wide rows.
      const storeQuery = this.service.storeContext().store_id
        ? `store_id=${this.service.storeContext().store_id}`
        : '';
      const mappingsUrl = storeQuery
        ? `${this.mappingsUrl()}?${storeQuery}`
        : this.mappingsUrl();
      const coaUrl = storeQuery
        ? `${this.coaUrl()}?limit=500&${storeQuery}`
        : `${this.coaUrl()}?limit=500`;
      const [mappingsRes, coaRes]: any[] = await Promise.all([
        firstValueFrom(this.http.get(mappingsUrl)),
        firstValueFrom(this.http.get(coaUrl)),
      ]);
      const mappingsPayload = mappingsRes?.data ?? mappingsRes;
      const mappingItems: any[] = Array.isArray(mappingsPayload)
        ? mappingsPayload
        : Array.isArray(mappingsPayload?.items)
          ? mappingsPayload.items
          : [];
      const initialMap: Record<string, number | string | null> = {};
      mappingItems.forEach((m: any) => {
        if (m?.mapping_key) initialMap[m.mapping_key] = m.account_id ?? null;
      });
      // Refresh the count from the actual mapping rows in case the prefill
      // was stale (e.g. someone edited mappings between snapshots).
      this.existingCount.set(
        Object.values(initialMap).filter((value) => value != null).length,
      );
      this.initial.set({ mappings: initialMap });

      const coaPayload = coaRes?.data ?? coaRes;
      const coaItems: any[] = Array.isArray(coaPayload)
        ? coaPayload
        : Array.isArray(coaPayload?.items)
          ? coaPayload.items
          : Array.isArray(coaPayload?.data)
            ? coaPayload.data
            : [];
      this.accounts.set(
        coaItems.map((a: any) => ({
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

  async onApplyDefaults(): Promise<void> {
    if (this.readOnlyForStore()) return;
    try {
      // Reset accepts `store_id` in the body via ResetAccountMappingDto.
      const body =
        this.service.userScope() === 'organization'
          ? { ...this.service.storeContext() }
          : {};
      await firstValueFrom(
        this.http.post(`${this.mappingsUrl()}/reset`, body),
      );
      await this.loadData();
    } catch (e) {
      this.localError.set(parseApiError(e).userMessage);
    }
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
          'La configuración fiscal heredada todavía no tiene mapeos contables.',
        );
        this.submitting.set(false);
        return null;
      }
      // The step is already configured (inherited from org-level config).
      // Notify the user via toast and advance without re-saving.
      this.toast.info(
        'Este paso ya está configurado. Avanzando al siguiente paso.',
      );
      const ref = {
        count: this.existingCount(),
        inherited: true,
        completed_at: new Date().toISOString(),
      };
      await this.service.commitStep(this.stepId, ref);
      this.submitting.set(false);
      return { ref };
    }

    // Non-readOnly path: detect "already configured" before re-PUTing.
    // The form may have been seeded from the prefill / loadData() so the
    // user clicks "Continuar" on data that is already persisted server-side.
    // In that case, skip the PUT, notify, and advance.
    const seeded = form.getValue();
    const seededCount = Object.values(seeded.mappings).filter(
      (v) => v !== null && v !== undefined,
    ).length;
    if (this.existingCount() > 0 && seededCount > 0) {
      this.toast.info(
        'Este paso ya está configurado. Avanzando al siguiente paso.',
      );
      const ref = {
        count: seededCount,
        completed_at: new Date().toISOString(),
      };
      try {
        await this.service.commitStep(this.stepId, ref);
      } finally {
        this.submitting.set(false);
      }
      return { ref };
    }

    try {
      const value = form.getValue();
      const mappings = Object.entries(value.mappings)
        .filter(([, accountId]) => accountId !== null && accountId !== undefined)
        .map(([mapping_key, accountId]) => ({
          mapping_key,
          account_id: Number(accountId),
        }));

      if (mappings.length === 0) {
        this.localError.set('Selecciona al menos un mapeo.');
        return null;
      }

      // Org PUT accepts `store_id` via UpsertAccountMappingDto.store_id;
      // when omitted, the backend defaults to org-level mappings.
      const body = {
        mappings,
        ...(this.service.userScope() === 'organization'
          ? this.service.storeContext()
          : {}),
      };
      await firstValueFrom(this.http.put(this.mappingsUrl(), body));

      const ref = {
        count: mappings.length,
        completed_at: new Date().toISOString(),
      };
      await this.service.commitStep(this.stepId, ref);
      return { ref };
    } catch (e) {
      // 409 / "ya existe" — the endpoint is idempotent or the row was
      // created out-of-band. Treat as "already configured" instead of
      // a hard error so the user can advance.
      const parsed = parseApiError(e);
      const isAlreadyExists =
        parsed.errorCode === 'CONFLICT' ||
        parsed.errorCode === 'ALREADY_EXISTS' ||
        (parsed.devMessage ?? '').toLowerCase().includes('ya existe') ||
        (parsed.devMessage ?? '').toLowerCase().includes('already exists');
      if (isAlreadyExists) {
        this.toast.info(
          'Este paso ya está configurado. Avanzando al siguiente paso.',
        );
        const ref = {
          count: this.existingCount() || seededCount,
          completed_at: new Date().toISOString(),
        };
        try {
          await this.service.commitStep(this.stepId, ref);
        } finally {
          this.submitting.set(false);
        }
        return { ref };
      }
      this.localError.set(parsed.userMessage);
      return null;
    } finally {
      this.submitting.set(false);
    }
  }
}
