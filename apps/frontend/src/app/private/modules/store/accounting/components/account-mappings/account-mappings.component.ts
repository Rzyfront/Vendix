import {Component, inject, signal,
  DestroyRef} from '@angular/core';
import { NgClass } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngrx/store';

import { toSignal , takeUntilDestroyed} from '@angular/core/rxjs-interop';


import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { environment } from '../../../../../../../environments/environment';

import {
  AccountMapping,
  ChartAccount} from '../../interfaces/accounting.interface';
import {
  selectAccountMappings,
  selectAccountMappingsLoading,
  selectLeafAccounts} from '../../state/selectors/accounting.selectors';
import {
  loadAccountMappings,
  saveAccountMappings,
  resetAccountMappings,
  loadAccounts} from '../../state/actions/accounting.actions';
import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent} from '../../../../../../shared/components/index';

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
  'payment.received.accounts_receivable':
    'Cuentas por Cobrar (recaudo factura)',
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
  'credit_sale.created.accounts_receivable':
    'Cuentas por Cobrar (Venta a Credito)',
  'credit_sale.created.revenue': 'Ingresos (Venta a Credito)',
  'credit_sale.created.vat_payable': 'IVA por Pagar (Venta a Credito)',
  'payment.received.sales_discount': 'Descuentos en Ventas (POS)',
  'credit_sale.created.sales_discount': 'Descuentos en Ventas (Credito)',
  // Purchase Order Payments
  'purchase_order.payment.accounts_payable': 'Proveedores (Pago OC)',
  'purchase_order.payment.cash_bank': 'Banco (Pago OC)',
  // Layaway (Plan Separe)
  'layaway.payment.cash': 'Caja (Cuota Separe)',
  'layaway.payment.bank': 'Banco (Cuota Separe)',
  'layaway.payment.customer_advance': 'Anticipos de Clientes (Separe)',
  'layaway.completed.customer_advance':
    'Anticipos de Clientes (Separe Completado)',
  'layaway.completed.revenue': 'Ingresos por Ventas (Separe Completado)',
  // Fixed Assets - Depreciation
  'depreciation.monthly.depreciation_expense': 'Gasto por Depreciacion',
  'depreciation.monthly.accumulated_depreciation': 'Depreciacion Acumulada',
  // Fixed Assets - Disposal
  'disposal.fixed_asset.asset_cost': 'Propiedad Planta y Equipo',
  'disposal.fixed_asset.accumulated_depreciation':
    'Depreciacion Acumulada (Baja)',
  'disposal.fixed_asset.loss': 'Perdida en Baja de Activos',
  'disposal.fixed_asset.gain': 'Utilidad en Venta de Activos',
  'disposal.fixed_asset.cash': 'Caja (Venta Activo)',
  // Withholding Tax (Retencion en la Fuente)
  'withholding.applied.expense': 'Gasto / Compra (Base Retencion)',
  'withholding.applied.withholding_payable': 'Retencion en la Fuente por Pagar',
  'withholding.applied.accounts_payable': 'Proveedores (Neto tras Retencion)',
  // Settlement (Liquidacion por Terminacion)
  'settlement.paid.severance': 'Cesantias Consolidadas',
  'settlement.paid.severance_interest': 'Intereses sobre Cesantias',
  'settlement.paid.bonus': 'Prima de Servicios por Pagar',
  'settlement.paid.vacation': 'Vacaciones por Pagar',
  'settlement.paid.pending_salary': 'Gastos de Personal (Salario Pendiente)',
  'settlement.paid.indemnification': 'Gastos de Personal (Indemnizacion)',
  'settlement.paid.social_deductions': 'Retenciones y Aportes de Nomina',
  'settlement.paid.bank': 'Bancos (Pago Liquidacion)',
  // Wallet / Monedero
  'wallet.topup.customer_advance': 'Anticipos de Clientes (Recarga Wallet)',
  'wallet.topup.cash_bank': 'Caja/Banco (Recarga Wallet)',
  'wallet.debit.customer_advance': 'Anticipos de Clientes (Uso Wallet)',
  'wallet.debit.revenue': 'Ingresos (Uso Wallet)',
  // Cuentas por Pagar (AP)
  'ap.payment.accounts_payable': 'Cuentas por Pagar (Pago)',
  'ap.payment.cash_bank': 'Banco (Pago CxP)',
  'ap.write_off.accounts_payable': 'Cuentas por Pagar (Castigo)',
  'ap.write_off.other_income': 'Otros Ingresos (Castigo CxP)',
  // Cuentas por Cobrar (AR)
  'ar.write_off.bad_debt': 'Deudas Incobrables',
  'ar.write_off.accounts_receivable': 'Cuentas por Cobrar (Castigo)',
  // Nomina por Departamento
  'payroll.approved.payroll_expense.administrative': 'Gastos Personal (Administrativo)',
  'payroll.approved.payroll_expense.operational': 'Gastos Personal (Operativo)',
  'payroll.approved.payroll_expense.sales': 'Gastos Personal (Ventas)',
  'payroll.approved.social_security.administrative': 'Seg. Social (Administrativo)',
  'payroll.approved.social_security.operational': 'Seg. Social (Operativo)',
  'payroll.approved.social_security.sales': 'Seg. Social (Ventas)',
  // Nómina individual — gastos (débitos)
  'payroll.approved.transport_subsidy': 'Aux. Transporte (Gasto)',
  'payroll.approved.provision_severance': 'Gasto Cesantias',
  'payroll.approved.provision_severance_interest': 'Gasto Intereses Cesantias',
  'payroll.approved.provision_vacation': 'Gasto Vacaciones',
  'payroll.approved.provision_bonus': 'Gasto Prima de Servicios',
  'payroll.approved.health_employer': 'EPS Empleador (Gasto)',
  'payroll.approved.pension_employer': 'AFP Empleador (Gasto)',
  'payroll.approved.arl_expense': 'ARL (Gasto)',
  'payroll.approved.sena_expense': 'SENA (Gasto)',
  'payroll.approved.icbf_expense': 'ICBF (Gasto)',
  'payroll.approved.compensation_fund_expense': 'Caja Compensacion (Gasto)',
  // Nómina individual — pasivos provisiones (créditos)
  'payroll.approved.liability_severance': 'Cesantias por Pagar',
  'payroll.approved.liability_severance_interest': 'Intereses Cesantias por Pagar',
  'payroll.approved.liability_vacation': 'Vacaciones por Pagar',
  'payroll.approved.liability_bonus': 'Prima de Servicios por Pagar',
  // Nómina individual — aportes patronales por pagar (créditos)
  'payroll.approved.health_employer_payable': 'EPS Empleador por Pagar',
  'payroll.approved.pension_employer_payable': 'AFP Empleador por Pagar',
  'payroll.approved.arl_payable': 'ARL por Pagar',
  'payroll.approved.sena_payable': 'SENA por Pagar',
  'payroll.approved.icbf_payable': 'ICBF por Pagar',
  'payroll.approved.compensation_fund_payable': 'Caja Compensacion por Pagar',
  'payroll.approved.advance_deduction': 'Descuento Anticipos',
  // Wompi
  'payment.received.wompi': 'Pasarela Wompi',
  // Cuotas de Credito
  'installment_payment.received.accounts_receivable': 'CxC (Cuota Recibida)',
  'installment_payment.received.cash_bank': 'Caja/Banco (Cuota Recibida)',
  // Comisiones
  'commission.calculated.expense': 'Gasto por Comisiones',
  'commission.calculated.payable': 'Comisiones por Pagar',
  // Caja Registradora
  'cash_register.opened.cash': 'Caja (Apertura)',
  'cash_register.opened.cash_base': 'Fondo Base (Apertura)',
  'cash_register.closed.cash': 'Caja (Cierre)',
  'cash_register.closed.bank': 'Banco (Cierre/Consignacion)',
  'cash_register.closed.surplus': 'Sobrante de Caja',
  'cash_register.closed.shortage': 'Faltante de Caja',
  'cash_register.movement.cash': 'Caja (Movimiento Manual)',
  'cash_register.movement.other': 'Contrapartida (Movimiento Manual)',
  // Transferencias de Stock
  'stock_transfer.completed.inventory_origin': 'Inventario (Tienda Origen)',
  'stock_transfer.completed.inventory_destination': 'Inventario (Tienda Destino)'};

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
    prefixes: ['invoice.validated.']},
  {
    key: 'payments',
    label: 'Pagos',
    icon: 'credit-card',
    prefixes: ['payment.received.']},
  {
    key: 'expenses',
    label: 'Gastos',
    icon: 'trending-down',
    prefixes: ['expense.approved.', 'expense.paid.']},
  {
    key: 'payroll',
    label: 'Nomina',
    icon: 'users',
    prefixes: ['payroll.approved.', 'payroll.paid.']},
  {
    key: 'credit_sales',
    label: 'Ventas a Credito',
    icon: 'file-plus',
    prefixes: ['credit_sale.created.']},
  {
    key: 'inventory',
    label: 'Inventario',
    icon: 'package',
    prefixes: [
      'order.completed.',
      'refund.completed.',
      'purchase_order.received.',
      'purchase_order.payment.',
      'inventory.adjusted.',
    ]},
  {
    key: 'layaway',
    label: 'Plan Separe',
    icon: 'clock',
    prefixes: ['layaway.payment.', 'layaway.completed.']},
  {
    key: 'fixed_assets',
    label: 'Activos Fijos',
    icon: 'hard-drive',
    prefixes: ['depreciation.monthly.', 'disposal.fixed_asset.']},
  {
    key: 'withholding',
    label: 'Retencion en la Fuente',
    icon: 'percent',
    prefixes: ['withholding.applied.']},
  {
    key: 'settlements',
    label: 'Liquidaciones',
    icon: 'user-minus',
    prefixes: ['settlement.paid.']},
  {
    key: 'wallet',
    label: 'Wallet / Monedero',
    icon: 'wallet',
    prefixes: ['wallet.topup.', 'wallet.debit.']},
  {
    key: 'accounts_payable',
    label: 'Cuentas por Pagar',
    icon: 'file-output',
    prefixes: ['ap.payment.', 'ap.write_off.']},
  {
    key: 'accounts_receivable',
    label: 'Cuentas por Cobrar (Castigos)',
    icon: 'file-input',
    prefixes: ['ar.write_off.']},
  {
    key: 'installments',
    label: 'Cuotas de Credito',
    icon: 'calendar-check',
    prefixes: ['installment_payment.received.']},
  {
    key: 'stock_transfers',
    label: 'Transferencias de Stock',
    icon: 'repeat',
    prefixes: ['stock_transfer.completed.']},
  {
    key: 'commissions',
    label: 'Comisiones',
    icon: 'award',
    prefixes: ['commission.calculated.']},
  {
    key: 'cash_register',
    label: 'Caja Registradora',
    icon: 'calculator',
    prefixes: ['cash_register.opened.', 'cash_register.closed.', 'cash_register.movement.']},
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
  cash_register: 'cash_register'};

@Component({
  selector: 'vendix-account-mappings',
  standalone: true,
  imports: [
    ButtonComponent,
    CardComponent,
    IconComponent,
    EmptyStateComponent,
    NgClass,
  ],
  templateUrl: './account-mappings.component.html',
  styleUrls: ['./account-mappings.component.scss']})
export class AccountMappingsComponent {
  private destroyRef = inject(DestroyRef);
  private store = inject(Store);
  private http = inject(HttpClient);
  private toast = inject(ToastService);
// State signals
  readonly loading = toSignal(
    this.store.select(selectAccountMappingsLoading),
    { initialValue: false }
  );
  readonly leaf_accounts = toSignal(
    this.store.select(selectLeafAccounts),
    { initialValue: [] as ChartAccount[] }
  );

  // Local state
  readonly mapping_groups = signal<MappingGroup[]>([]);
  readonly changed_mappings = signal<Map<string, number>>(new Map());
  readonly has_changes = signal(false);
  readonly has_custom_mappings = signal(false);
  readonly flow_toggles = signal<Record<string, boolean>>({});
  readonly flows_loaded = signal(false);

  constructor() {
    this.store.dispatch(loadAccountMappings({}));
    this.store.dispatch(loadAccounts());

    this.store
      .select(selectAccountMappings)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((mappings) => {
        this.mapping_groups.set(this.buildGroups(mappings));
        this.has_custom_mappings.set(
          mappings.some((m) => m.source !== 'default')
        );
        this.changed_mappings.set(new Map());
        this.has_changes.set(false);
      });

    this.http
      .get<any>(`${environment.apiUrl}/store/settings`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const settings = res?.data?.settings || res?.data || res;
          this.flow_toggles.set(
            settings?.module_flows?.accounting ||
              settings?.accounting_flows ||
              {}
          );
          this.flows_loaded.set(true);
        },
        error: () => {
          this.flows_loaded.set(true);
        }});
  }
getLabel(mapping_key: string): string {
    return MAPPING_LABELS[mapping_key] || mapping_key;
  }

  getSourceLabel(source: string): string {
    const labels: Record<string, string> = {
      default: 'Default',
      organization: 'Organizacion',
      store: 'Tienda'};
    return labels[source] || source;
  }

  getSelectedAccountId(mapping: AccountMapping): number | string {
    const changedMappings = this.changed_mappings();
    if (changedMappings.has(mapping.mapping_key)) {
      return changedMappings.get(mapping.mapping_key)!;
    }
    return mapping.account_id || '';
  }

  onAccountChange(mapping_key: string, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const updatedMap = new Map(this.changed_mappings());
    if (value) {
      updatedMap.set(mapping_key, Number(value));
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
        account_id}),
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
    const new_value = !this.isFlowEnabled(group_key);
    const updatedToggles = { ...this.flow_toggles(), [flow_key]: new_value };
    this.flow_toggles.set(updatedToggles);
    this.http
      .patch(`${environment.apiUrl}/store/settings`, {
        module_flows: { accounting: { [flow_key]: new_value } }})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          const group = GROUP_DEFINITIONS.find((g) => g.key === group_key);
          this.toast.success(
            `Flujo "${group?.label || group_key}" ${
              new_value ? 'activado' : 'desactivado'
            }`
          );
        },
        error: () => {
          const revertedToggles = {
            ...this.flow_toggles(),
            [flow_key]: !new_value};
          this.flow_toggles.set(revertedToggles);
          this.toast.error(
            'Error al actualizar la configuracion del flujo'
          );
        }});
  }

  private buildGroups(mappings: AccountMapping[]): MappingGroup[] {
    return GROUP_DEFINITIONS.map((def) => ({
      ...def,
      mappings: mappings.filter((m) =>
        def.prefixes.some((prefix) => m.mapping_key.startsWith(prefix)),
      )})).filter((g) => g.mappings.length > 0);
  }
}
