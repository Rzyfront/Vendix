import {Component, inject, signal, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgClass } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { take } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import {
  CardComponent,
  IconComponent,
  ButtonComponent,
} from '../../../../../../shared/components/index';
import { toLocalDateString } from '../../../../../../shared/utils/date.util';

interface FlowStatus {
  key: string;
  label: string;
  icon: string;
  enabled: boolean;
}

const FLOW_DEFINITIONS: Array<{ key: string; label: string; icon: string }> = [
  { key: 'invoicing', label: 'Facturacion', icon: 'file-text' },
  { key: 'payments', label: 'Pagos', icon: 'credit-card' },
  { key: 'expenses', label: 'Gastos', icon: 'trending-down' },
  { key: 'payroll', label: 'Nomina', icon: 'users' },
  { key: 'credit_sales', label: 'Ventas a Credito', icon: 'file-plus' },
  { key: 'inventory', label: 'Inventario / COGS', icon: 'package' },
  { key: 'returns', label: 'Devoluciones', icon: 'rotate-ccw' },
  { key: 'purchases', label: 'Compras', icon: 'shopping-cart' },
  { key: 'layaway', label: 'Plan Separe', icon: 'clock' },
  { key: 'fixed_assets', label: 'Activos Fijos', icon: 'hard-drive' },
  { key: 'withholding', label: 'Retenciones', icon: 'percent' },
  { key: 'settlements', label: 'Liquidaciones', icon: 'user-minus' },
  { key: 'wallet', label: 'Wallet', icon: 'wallet' },
  { key: 'cash_register', label: 'Caja Registradora', icon: 'calculator' },
  { key: 'stock_transfers', label: 'Transferencias', icon: 'repeat' },
  { key: 'commissions', label: 'Comisiones', icon: 'award' },
  { key: 'ar_ap', label: 'CxC / CxP', icon: 'file-input' },
  { key: 'installments', label: 'Cuotas de Credito', icon: 'calendar-check' },
];

@Component({
  selector: 'vendix-accounting-flows',
  standalone: true,
  imports: [CardComponent, IconComponent, ButtonComponent,
    NgClass,
  ],
  templateUrl: './accounting-flows.component.html',
})
export class AccountingFlowsComponent {
  private destroyRef = inject(DestroyRef);
  private http = inject(HttpClient);

  readonly flows = signal<FlowStatus[]>([]);
  readonly loading = signal(true);
  readonly total_active_flows = signal(0);
  readonly total_disabled_flows = signal(0);
  readonly total_entries_today = signal(0);
  readonly recent_entries = signal<any[]>([]);

  constructor() {
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);

    this.http.get<any>(`${environment.apiUrl}/store/settings`).pipe(take(1)).subscribe({
      next: (res) => {
        const settings = res?.data?.settings || res?.data || res;
        const flows = settings?.module_flows?.accounting || settings?.accounting_flows || {};
        const built = FLOW_DEFINITIONS.map((def) => ({
          ...def,
          enabled: flows[def.key] !== false,
        }));
        this.flows.set(built);
        this.total_active_flows.set(built.filter((f) => f.enabled).length);
        this.total_disabled_flows.set(built.filter((f) => !f.enabled).length);
        this.loading.set(false);
      },
      error: () => {
        const built = FLOW_DEFINITIONS.map((def) => ({ ...def, enabled: true }));
        this.flows.set(built);
        this.total_active_flows.set(built.length);
        this.loading.set(false);
      },
    });

    this.http.get<any>(`${environment.apiUrl}/store/accounting/journal-entries`, {
      params: { limit: '10', page: '1' },
    }).pipe(take(1)).subscribe({
      next: (res) => {
        const entries = res?.data || [];
        this.recent_entries.set(entries.filter((e: any) => e.entry_type?.startsWith('auto_')).slice(0, 8));
        const today = toLocalDateString();
        this.total_entries_today.set(entries.filter(
          (e: any) => e.entry_type?.startsWith('auto_') && e.created_at?.startsWith(today),
        ).length);
      },
    });
  }

  getEntryTypeLabel(entry_type: string): string {
    const labels: Record<string, string> = {
      auto_invoice: 'Factura', auto_payment: 'Pago', auto_expense: 'Gasto',
      auto_payroll: 'Nomina', auto_inventory: 'Inventario', auto_return: 'Devolucion',
      auto_purchase: 'Compra', auto_depreciation: 'Depreciacion',
      auto_installment_payment: 'Cuota', adjustment: 'Ajuste', manual: 'Manual',
    };
    return labels[entry_type] || entry_type;
  }

  formatDate(date: string): string {
    if (!date) return '-';
    return new Date(date).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
}
