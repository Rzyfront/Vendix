import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import { AccountMapping, ChartAccount } from '../../interfaces/accounting.interface';
import {
  selectAccountMappings,
  selectAccountMappingsLoading,
  selectLeafAccounts,
} from '../../state/selectors/accounting.selectors';
import {
  loadAccountMappings,
  saveAccountMappings,
  resetAccountMappings,
  loadAccounts,
} from '../../state/actions/accounting.actions';
import {
  ButtonComponent,
  IconComponent,
} from '../../../../../../shared/components/index';

interface MappingGroup {
  key: string;
  label: string;
  icon: string;
  prefixes: string[];
  mappings: AccountMapping[];
}

const MAPPING_LABELS: Record<string, string> = {
  'invoice.validated.accounts_receivable': 'Cuentas por Cobrar',
  'invoice.validated.revenue': 'Ingresos por Ventas',
  'invoice.validated.vat_payable': 'IVA por Pagar',
  'payment.received.cash': 'Caja (Efectivo)',
  'payment.received.bank': 'Banco (Transferencia / Tarjeta)',
  'payment.received.accounts_receivable': 'Cuentas por Cobrar (recaudo factura)',
  'payment.received.revenue': 'Ingresos por Ventas (venta directa)',
  'payment.received.vat_payable': 'IVA por Pagar (venta directa)',
  'expense.approved.expense': 'Gastos Diversos',
  'expense.approved.accounts_payable': 'Cuentas por Pagar',
  'expense.paid.accounts_payable': 'Cuentas por Pagar',
  'expense.paid.cash': 'Caja / Banco',
  'payroll.approved.payroll_expense': 'Gastos de Personal',
  'payroll.approved.social_security': 'Seguridad Social Empleador',
  'payroll.approved.salaries_payable': 'Salarios por Pagar',
  'payroll.approved.health_payable': 'Aportes EPS',
  'payroll.approved.pension_payable': 'Aportes Pension',
  'payroll.approved.withholdings': 'Retenciones',
  'payroll.paid.salaries_payable': 'Salarios por Pagar',
  'payroll.paid.bank': 'Banco',
  'order.completed.cogs': 'Costo de Ventas',
  'order.completed.inventory': 'Inventario (Salida)',
  'refund.completed.revenue': 'Ingresos (Reversa)',
  'refund.completed.cash': 'Caja / Banco (Reembolso)',
  'refund.completed.vat_payable': 'IVA por Pagar (Reversa Devolucion)',
  'purchase_order.received.inventory': 'Inventario (Entrada)',
  'purchase_order.received.accounts_payable': 'Proveedores',
  'inventory.adjusted.inventory': 'Inventario (Ajuste)',
  'inventory.adjusted.shrinkage': 'Faltantes de Inventario',
  'credit_sale.created.accounts_receivable': 'Cuentas por Cobrar (Venta a Credito)',
  'credit_sale.created.revenue': 'Ingresos (Venta a Credito)',
  'credit_sale.created.vat_payable': 'IVA por Pagar (Venta a Credito)',
};

const GROUP_DEFINITIONS: Array<{ key: string; label: string; icon: string; prefixes: string[] }> = [
  { key: 'invoicing', label: 'Facturacion', icon: 'file-text', prefixes: ['invoice.validated.'] },
  { key: 'payments', label: 'Pagos', icon: 'credit-card', prefixes: ['payment.received.'] },
  { key: 'expenses', label: 'Gastos', icon: 'trending-down', prefixes: ['expense.approved.', 'expense.paid.'] },
  { key: 'payroll', label: 'Nomina', icon: 'users', prefixes: ['payroll.approved.', 'payroll.paid.'] },
  { key: 'credit_sales', label: 'Ventas a Credito', icon: 'file-plus', prefixes: ['credit_sale.created.'] },
  { key: 'inventory', label: 'Inventario', icon: 'package', prefixes: ['order.completed.', 'refund.completed.', 'purchase_order.received.', 'inventory.adjusted.'] },
];

@Component({
  selector: 'vendix-account-mappings',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  templateUrl: './account-mappings.component.html',
  styleUrls: ['./account-mappings.component.scss'],
})
export class AccountMappingsComponent implements OnInit {
  private store = inject(Store);

  mappings$: Observable<AccountMapping[]> = this.store.select(selectAccountMappings);
  loading$: Observable<boolean> = this.store.select(selectAccountMappingsLoading);
  leaf_accounts$: Observable<ChartAccount[]> = this.store.select(selectLeafAccounts);

  mapping_groups: MappingGroup[] = [];
  leaf_accounts: ChartAccount[] = [];
  changed_mappings = new Map<string, number>();
  has_changes = false;
  has_custom_mappings = false;

  ngOnInit(): void {
    this.store.dispatch(loadAccountMappings({}));
    this.store.dispatch(loadAccounts());

    this.leaf_accounts$.subscribe((accounts) => {
      this.leaf_accounts = accounts;
    });

    this.mappings$.subscribe((mappings) => {
      this.mapping_groups = this.buildGroups(mappings);
      this.has_custom_mappings = mappings.some((m) => m.source !== 'default');
      this.changed_mappings.clear();
      this.has_changes = false;
    });
  }

  getLabel(mapping_key: string): string {
    return MAPPING_LABELS[mapping_key] || mapping_key;
  }

  getSourceLabel(source: string): string {
    const labels: Record<string, string> = {
      default: 'Default',
      organization: 'Organizacion',
      store: 'Tienda',
    };
    return labels[source] || source;
  }

  getSelectedAccountId(mapping: AccountMapping): number | string {
    if (this.changed_mappings.has(mapping.mapping_key)) {
      return this.changed_mappings.get(mapping.mapping_key)!;
    }
    return mapping.account_id || '';
  }

  onAccountChange(mapping_key: string, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value) {
      this.changed_mappings.set(mapping_key, Number(value));
    } else {
      this.changed_mappings.delete(mapping_key);
    }
    this.has_changes = this.changed_mappings.size > 0;
  }

  saveMappings(): void {
    if (!this.has_changes) return;
    const mappings = Array.from(this.changed_mappings.entries()).map(([mapping_key, account_id]) => ({
      mapping_key,
      account_id,
    }));
    this.store.dispatch(saveAccountMappings({ mappings }));
  }

  resetMappings(): void {
    if (confirm('Esto restablecera todas las cuentas a los valores predeterminados del PUC. Desea continuar?')) {
      this.store.dispatch(resetAccountMappings({}));
    }
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
