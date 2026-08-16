import {
  Component,
  inject,
  signal,
  effect,
  untracked,
  DestroyRef,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngrx/store';

import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of, catchError } from 'rxjs';

import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { environment } from '../../../../../../../environments/environment';
import { TenantFacade } from '../../../../../../core/store/tenant/tenant.facade';
import { AppType } from '../../../../../../core/models/environment.enum';

/**
 * Fila del catálogo de mapping keys servido por
 * `GET /store/accounting/account-mappings/keys`. Refleja el contrato de
 * `MappingKeyCatalogEntry` en el backend (`account-mapping.service.ts`):
 * declarado acá para que el frontend NO tenga que importar del backend, y
 * cualquier drift entre los dos lados lo cazan las pruebas E2E que cruzan
 * ambos.
 */
interface MappingKeyCatalogEntry {
  key: string;
  label: string;
  event: string;
  role: string;
  default_code: string;
  description: string;
}

import { AccountMapping } from '../../interfaces/accounting.interface';
import {
  selectAccountMappings,
  selectAccountMappingsLoading,
} from '../../state/selectors/accounting.selectors';
import {
  loadAccountMappings,
  saveAccountMappings,
  resetAccountMappings,
} from '../../state/actions/accounting.actions';
import {
  AccountSelectComponent,
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
} from '../../../../../../shared/components/index';

interface MappingGroup {
  key: string;
  label: string;
  icon: string;
  prefixes: string[];
  mappings: AccountMapping[];
}

/**
 * One row of `GET /store/accounting/account-mappings/keys`.
 *
 * Mirrors `MappingKeyCatalogEntry` in
 * `apps/backend/src/domains/store/accounting/account-mappings/account-mapping.service.ts`,
 * which is the single source of truth for the mapping-key catalog. It is
 * re-declared here (and nowhere else) only because the frontend cannot import
 * from the backend package; the *values* are never re-declared — they are read
 * off the wire, precisely so the two sides cannot drift again.
 */
interface MappingKeyCatalogEntry {
  key: string;
  label: string;
  /** Event half of the key (`invoice.validated`). */
  event: string;
  /** Account role half of the key (`accounts_receivable`). */
  role: string;
  /** PUC code the default cascade falls back to. */
  default_code: string;
  /** Raw account description from the backend default mappings. */
  description: string;
}

const GROUP_DEFINITIONS: Array<{
  key: string;
  label: string;
  icon: string;
  prefixes: string[];
}> = [
  {
    key: 'invoicing',
    label: 'Facturacion',
    icon: 'file-text',
    prefixes: ['invoice.validated.'],
  },
  {
    key: 'payments',
    label: 'Pagos',
    icon: 'credit-card',
    prefixes: ['payment.received.'],
  },
  {
    key: 'expenses',
    label: 'Gastos',
    icon: 'trending-down',
    prefixes: [
      'expense.approved.',
      'expense.paid.',
      'expense.cancelled.',
      'expense.refunded.',
    ],
  },
  {
    key: 'payroll',
    label: 'Nomina',
    icon: 'users',
    prefixes: ['payroll.approved.', 'payroll.paid.'],
  },
  {
    key: 'credit_sales',
    label: 'Ventas a Credito',
    icon: 'file-plus',
    prefixes: ['credit_sale.created.', 'credit_note.accepted.'],
  },
  {
    key: 'inventory',
    label: 'Inventario',
    icon: 'package',
    prefixes: [
      'order.completed.',
      'refund.completed.',
      'purchase_order.received.',
      'support_document.accepted.',
      'purchase.vat_recognized.',
      'purchase_order.payment.',
      'inventory.adjusted.',
      'dispatch_note.',
    ],
  },
  {
    key: 'layaway',
    label: 'Plan Separe',
    icon: 'clock',
    prefixes: ['layaway.payment.', 'layaway.completed.', 'layaway.cancelled.'],
  },
  {
    key: 'fixed_assets',
    label: 'Activos Fijos',
    icon: 'hard-drive',
    prefixes: ['depreciation.monthly.', 'disposal.fixed_asset.'],
  },
  {
    key: 'withholding',
    label: 'Retencion en la Fuente',
    icon: 'percent',
    prefixes: [
      'withholding.applied.',
      'withholding.practiced.',
      'withholding.suffered.',
    ],
  },
  {
    key: 'restaurant_ops',
    label: 'Cocina y Produccion',
    icon: 'chef-hat',
    prefixes: ['kitchen.fired.', 'production.completed.'],
  },
  {
    key: 'settlements',
    label: 'Liquidaciones',
    icon: 'user-minus',
    prefixes: ['settlement.approved.', 'settlement.paid.'],
  },
  {
    key: 'wallet',
    label: 'Wallet / Monedero',
    icon: 'wallet',
    prefixes: ['wallet.topup.', 'wallet.debit.'],
  },
  {
    key: 'accounts_payable',
    label: 'Cuentas por Pagar',
    icon: 'file-output',
    prefixes: ['ap.payment.', 'ap.write_off.'],
  },
  {
    key: 'accounts_receivable',
    label: 'Cuentas por Cobrar (Castigos)',
    icon: 'file-input',
    prefixes: ['ar.write_off.'],
  },
  {
    key: 'saas',
    label: 'Suscripcion SaaS Vendix',
    icon: 'server',
    prefixes: [
      'saas_revenue.',
      'saas_refund.',
      'saas_bad_debt.',
      'saas_partner_payout.',
      'saas_subscription_expense.',
    ],
  },
  {
    key: 'stock_transfers',
    label: 'Transferencias de Stock',
    icon: 'repeat',
    prefixes: ['stock_transfer.completed.', 'intercompany_transfer.'],
  },
  {
    key: 'commissions',
    label: 'Comisiones',
    icon: 'award',
    prefixes: ['commission.calculated.'],
  },
  {
    key: 'cash_register',
    label: 'Caja Registradora',
    icon: 'calculator',
    prefixes: [
      'cash_register.opened.',
      'cash_register.closed.',
      'cash_register.movement.',
    ],
  },
  {
    key: 'dispatch_routes',
    label: 'Planillas de Ruta (DSD)',
    icon: 'truck',
    prefixes: ['dispatch_route.closed.', 'dispatch_route.settlement.'],
  },
];

const GROUP_FLOW_MAP: Record<string, string> = {
  invoicing: 'invoicing',
  payments: 'payments',
  expenses: 'expenses',
  payroll: 'payroll',
  credit_sales: 'credit_sales',
  inventory: 'inventory',
  layaway: 'layaway',
  fixed_assets: 'fixed_assets',
  withholding: 'withholding',
  settlements: 'settlements',
  wallet: 'wallet',
  accounts_payable: 'ar_ap',
  accounts_receivable: 'ar_ap',
  installments: 'installments',
  stock_transfers: 'stock_transfers',
  commissions: 'commissions',
  cash_register: 'cash_register',
};

@Component({
  selector: 'vendix-account-mappings',
  standalone: true,
  imports: [
    AccountSelectComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    EmptyStateComponent,
    FormsModule,
    NgClass,
  ],
  templateUrl: './account-mappings.component.html',
  styleUrls: ['./account-mappings.component.scss'],
})
export class AccountMappingsComponent {
  private destroyRef = inject(DestroyRef);
  private store = inject(Store);
  private http = inject(HttpClient);
  private toast = inject(ToastService);
  private tenantFacade = inject(TenantFacade);
  // State signals
  readonly loading = toSignal(this.store.select(selectAccountMappingsLoading), {
    initialValue: false,
  });
  // `leaf_accounts` is gone: each row's `app-account-select` searches the chart
  // of accounts server-side. The old markup rendered the whole leaf list as
  // <option>s inside every one of the ~230 mapping rows.

  // Local state
  /** `mapping_key` → short account label, from the backend key catalog. */
  readonly mapping_labels = signal<Record<string, string>>({});
  readonly mapping_groups = signal<MappingGroup[]>([]);
  readonly changed_mappings = signal<Map<string, number>>(new Map());
  readonly has_changes = signal(false);
  readonly has_custom_mappings = signal(false);
  readonly flow_toggles = signal<Record<string, boolean>>({});
  readonly flows_loaded = signal(false);

  constructor() {
    this.store.dispatch(loadAccountMappings({}));
    // No `loadAccounts()` here any more — this screen no longer needs the whole
    // chart in memory. (The accounting shell still dispatches it for the other
    // tabs that read `selectLeafAccounts`.)
    this.loadMappingKeyCatalog();

    this.store
      .select(selectAccountMappings)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((mappings) => {
        this.mapping_groups.set(this.buildGroups(mappings));
        this.has_custom_mappings.set(
          mappings.some((m) => m.source !== 'default'),
        );
        this.changed_mappings.set(new Map());
        this.has_changes.set(false);
      });

    // Reacciona al signal currentEnvironment. Guardado con flows_loaded
    // leído en untracked para evitar re-ejecutar cuando nosotros mismos
    // lo seteamos en true.
    effect(() => {
      const env = this.tenantFacade.currentEnvironment() as AppType | null;
      if (!env) return;
      if (untracked(() => this.flows_loaded())) return;

      const endpoint = this.getSettingsEndpoint(env);
      if (!endpoint) {
        this.flows_loaded.set(true);
        return;
      }

      this.http
        .get<any>(`${environment.apiUrl}${endpoint}`)
        .pipe(
          catchError(() => of(null)),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((res) => {
          if (res) {
            const settings = res?.data?.settings || res?.data || res;
            this.flow_toggles.set(
              settings?.module_flows?.accounting ||
                settings?.accounting_flows ||
                {},
            );
          }
          this.flows_loaded.set(true);
        });
    });
  }

  private getSettingsEndpoint(env: AppType): string | null {
    switch (env) {
      case AppType.STORE_ADMIN:
        return '/store/settings';
      case AppType.ORG_ADMIN:
        return '/organization/settings'; // domain-isolation-ok: AppType branch routes ORG_ADMIN context to /organization/* explicitly
      default:
        return null;
    }
  }
  /**
   * Pulls the canonical mapping-key catalog once. Failure is non-fatal: rows
   * fall back to showing the raw `mapping_key`, which is still usable, so a
   * flaky catalog request never blocks editing the mappings themselves.
   */
  private loadMappingKeyCatalog(): void {
    this.http
      .get<{ data?: MappingKeyCatalogEntry[] }>(
        `${environment.apiUrl}/store/accounting/account-mappings/keys`,
      )
      .pipe(
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        const entries = res?.data ?? [];
        if (entries.length === 0) return;
        this.mapping_labels.set(
          Object.fromEntries(
            entries.map((e) => [e.key, e.description || e.label || e.key]),
          ),
        );
      });
  }

  getLabel(mapping_key: string): string {
    return this.mapping_labels()[mapping_key] || mapping_key;
  }

  getSourceLabel(source: string): string {
    const labels: Record<string, string> = {
      default: 'Default',
      organization: 'Organizacion',
      store: 'Tienda',
    };
    return labels[source] || source;
  }

  getSelectedAccountId(mapping: AccountMapping): number | null {
    const changedMappings = this.changed_mappings();
    if (changedMappings.has(mapping.mapping_key)) {
      return changedMappings.get(mapping.mapping_key)!;
    }
    return mapping.account_id ?? null;
  }

  /**
   * `app-account-select` is a CVA, so it emits the account id directly instead
   * of a DOM `Event` the way the old native `<select>` did.
   */
  onAccountSelected(mapping_key: string, account_id: number | null): void {
    const updatedMap = new Map(this.changed_mappings());
    if (account_id != null) {
      updatedMap.set(mapping_key, Number(account_id));
    } else {
      updatedMap.delete(mapping_key);
    }
    this.changed_mappings.set(updatedMap);
    this.has_changes.set(updatedMap.size > 0);
  }

  saveMappings(): void {
    if (!this.has_changes()) return;
    const mappings = Array.from(this.changed_mappings().entries()).map(
      ([mapping_key, account_id]) => ({
        mapping_key,
        account_id,
      }),
    );
    this.store.dispatch(saveAccountMappings({ mappings }));
  }

  resetMappings(): void {
    if (
      confirm(
        'Esto restablecera todas las cuentas a los valores predeterminados del PUC. Desea continuar?',
      )
    ) {
      this.store.dispatch(resetAccountMappings({}));
    }
  }

  isFlowEnabled(group_key: string): boolean {
    const flow_key = GROUP_FLOW_MAP[group_key];
    if (!flow_key) return true;
    return this.flow_toggles()[flow_key] !== false;
  }

  toggleFlow(group_key: string): void {
    const flow_key = GROUP_FLOW_MAP[group_key];
    if (!flow_key) return;
    const env = this.tenantFacade.currentEnvironment();
    const endpoint = env ? this.getSettingsEndpoint(env) : null;
    if (!endpoint) {
      this.toast.error(
        'No se puede actualizar la configuración en este contexto',
      );
      return;
    }
    const new_value = !this.isFlowEnabled(group_key);
    const updatedToggles = { ...this.flow_toggles(), [flow_key]: new_value };
    this.flow_toggles.set(updatedToggles);
    this.http
      .patch(`${environment.apiUrl}${endpoint}`, {
        module_flows: { accounting: { [flow_key]: new_value } },
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          const group = GROUP_DEFINITIONS.find((g) => g.key === group_key);
          this.toast.success(
            `Flujo "${group?.label || group_key}" ${
              new_value ? 'activado' : 'desactivado'
            }`,
          );
        },
        error: () => {
          const revertedToggles = {
            ...this.flow_toggles(),
            [flow_key]: !new_value,
          };
          this.flow_toggles.set(revertedToggles);
          this.toast.error('Error al actualizar la configuracion del flujo');
        },
      });
  }

  private buildGroups(mappings: AccountMapping[]): MappingGroup[] {
    return GROUP_DEFINITIONS.map((def) => ({
      ...def,
      mappings: mappings.filter((m) =>
        def.prefixes.some((prefix) => m.mapping_key.startsWith(prefix)),
      ),
    })).filter((g) => g.mappings.length > 0);
  }
}
