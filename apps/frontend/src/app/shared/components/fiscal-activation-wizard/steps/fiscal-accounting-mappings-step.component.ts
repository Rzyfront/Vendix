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
  AccountMappingsFormComponent,
  AccountMappingsValue,
  AccountOption,
  MappingKeyDef,
} from '../../forms/account-mappings-form/account-mappings-form.component';
import { parseApiError } from '../../../../core/utils/parse-api-error';

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
        [disabled]="submitting()"
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

  readonly stepId: FiscalWizardStepId = 'accounting_mappings';
  readonly valid = signal(true);
  readonly submitting = signal(false);
  readonly localError = signal<string | null>(null);
  readonly initial = signal<Partial<AccountMappingsValue> | null>(null);
  readonly mappingKeys = signal<MappingKeyDef[]>(DEFAULT_MAPPING_KEYS);
  readonly accounts = signal<AccountOption[]>([]);

  private readonly form =
    viewChild.required<AccountMappingsFormComponent>('form');
  private loaded = false;

  constructor() {
    effect(() => {
      const scope = this.service.userScope();
      if (scope && !this.loaded) {
        this.loaded = true;
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
      // Both GETs accept `?store_id=` to narrow the org-level views when a
      // specific store is selected (operating_scope=STORE or per-store
      // overrides). For consolidated org reads (no targetStoreId) the query
      // is omitted and the backend returns org-wide rows.
      const storeQuery =
        this.service.userScope() === 'organization' &&
        this.service.targetStoreId() !== null
          ? `store_id=${this.service.targetStoreId()}`
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
      this.localError.set(parseApiError(e).userMessage);
      return null;
    } finally {
      this.submitting.set(false);
    }
  }
}
