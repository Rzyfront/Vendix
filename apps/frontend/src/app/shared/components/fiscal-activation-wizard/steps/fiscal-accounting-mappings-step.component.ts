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
  { key: 'invoice.validated.accounts_receivable', label: 'Factura validada · Cuentas por Cobrar' },
  { key: 'invoice.validated.revenue', label: 'Factura validada · Ingresos' },
  { key: 'invoice.validated.vat_payable', label: 'Factura validada · IVA por Pagar' },
  { key: 'payment.received.cash', label: 'Pago recibido · Caja/Banco' },
  { key: 'payment.received.accounts_receivable', label: 'Pago recibido · Cuentas por Cobrar' },
  { key: 'payment.received.revenue', label: 'Pago recibido · Ingresos por Ventas (venta directa sin factura)' },
  { key: 'expense.approved.expense', label: 'Gasto aprobado · Gastos Diversos' },
  { key: 'expense.approved.accounts_payable', label: 'Gasto aprobado · Proveedores' },
  { key: 'expense.paid.accounts_payable', label: 'Gasto pagado · Proveedores' },
  { key: 'expense.paid.cash', label: 'Gasto pagado · Caja/Banco' },
  { key: 'expense.refunded.accounts_payable', label: 'Gasto reembolsado · Proveedores (Reversión)' },
  { key: 'expense.refunded.cash', label: 'Gasto reembolsado · Caja/Banco (Reembolso)' },
  { key: 'expense.refunded.expense', label: 'Gasto reembolsado · Gastos Diversos (Reversión)' },
  { key: 'expense.cancelled.accounts_payable', label: 'Gasto cancelado · Proveedores (Cancelación)' },
  { key: 'expense.cancelled.expense', label: 'Gasto cancelado · Gastos Diversos (Cancelación)' },
  { key: 'payroll.approved.payroll_expense', label: 'Nómina aprobada · Gastos de Personal' },
  { key: 'payroll.approved.social_security', label: 'Nómina aprobada · Seguridad Social' },
  { key: 'payroll.approved.payroll_expense.administrative', label: 'Nómina aprobada · Gastos de Personal (Administrativo)' },
  { key: 'payroll.approved.social_security.administrative', label: 'Nómina aprobada · Seguridad Social (Administrativo)' },
  { key: 'payroll.approved.payroll_expense.operational', label: 'Nómina aprobada · Mano de Obra Directa (Operacional)' },
  { key: 'payroll.approved.social_security.operational', label: 'Nómina aprobada · Seguridad Social M.O.D. (Operacional)' },
  { key: 'payroll.approved.payroll_expense.sales', label: 'Nómina aprobada · Gastos de Personal (Ventas)' },
  { key: 'payroll.approved.social_security.sales', label: 'Nómina aprobada · Seguridad Social (Ventas)' },
  { key: 'payroll.approved.salaries_payable', label: 'Nómina aprobada · Salarios por Pagar' },
  { key: 'payroll.approved.health_payable', label: 'Nómina aprobada · EPS' },
  { key: 'payroll.approved.pension_payable', label: 'Nómina aprobada · Pension' },
  { key: 'payroll.approved.withholdings', label: 'Nómina aprobada · Retenciones' },
  { key: 'payroll.approved.labor_withholding', label: 'Nómina aprobada · Retención en la Fuente - Laboral' },
  { key: 'payroll.paid.salaries_payable', label: 'Nómina pagada · Salarios por Pagar' },
  { key: 'payroll.paid.bank', label: 'Nómina pagada · Banco' },
  { key: 'order.completed.cogs', label: 'Orden completada · Costo de Ventas' },
  { key: 'order.completed.inventory', label: 'Orden completada · Inventario' },
  { key: 'refund.completed.revenue', label: 'Reembolso completado · Ingresos (reversa)' },
  { key: 'refund.completed.cash', label: 'Reembolso completado · Caja/Banco' },
  { key: 'purchase_order.received.inventory', label: 'Orden de compra recibida · Inventario' },
  { key: 'purchase_order.received.accounts_payable', label: 'Orden de compra recibida · Proveedores' },
  { key: 'support_document.accepted.expense', label: 'Documento soporte aceptado · Compra/Gasto soportado' },
  { key: 'support_document.accepted.vat_deductible', label: 'Documento soporte aceptado · IVA descontable' },
  { key: 'support_document.accepted.withholding_payable', label: 'Documento soporte aceptado · Retenciones por pagar' },
  { key: 'support_document.accepted.accounts_payable', label: 'Documento soporte aceptado · Proveedor documento soporte' },
  { key: 'purchase_order.payment.accounts_payable', label: 'Pago orden de compra · Proveedores (pago OC)' },
  { key: 'purchase_order.payment.cash_bank', label: 'Pago orden de compra · Banco (pago OC)' },
  { key: 'inventory.adjusted.inventory', label: 'Ajuste de inventario · Inventario' },
  { key: 'inventory.adjusted.shrinkage', label: 'Ajuste de inventario · Faltantes de Inventario' },
  { key: 'production.completed.finished_goods', label: 'Producción completada · Inventario de productos terminados (producción)' },
  { key: 'production.completed.ingredient_consumed', label: 'Producción completada · Inventario de insumos consumidos (producción)' },
  { key: 'kitchen.fired.cogs', label: 'Fired a cocina · Costo de Ventas (fire-to-kitchen)' },
  { key: 'kitchen.fired.inventory', label: 'Fired a cocina · Inventario (fire-to-kitchen)' },
  { key: 'payment.received.bank', label: 'Pago recibido · Banco (Transferencia/Tarjeta)' },
  { key: 'payment.received.vat_payable', label: 'Pago recibido · IVA por Pagar (venta directa)' },
  { key: 'credit_sale.created.accounts_receivable', label: 'Venta a crédito · Cuentas por Cobrar (venta a crédito)' },
  { key: 'credit_sale.created.revenue', label: 'Venta a crédito · Ingresos por Ventas (venta a crédito)' },
  { key: 'credit_sale.created.vat_payable', label: 'Venta a crédito · IVA por Pagar (venta a crédito)' },
  { key: 'refund.completed.vat_payable', label: 'Reembolso completado · IVA por Pagar (reversa devolución)' },
  { key: 'invoice.validated.iva_payable', label: 'Factura validada · IVA por Pagar (factura)' },
  { key: 'invoice.validated.inc_payable', label: 'Factura validada · Impuesto al Consumo por Pagar (factura)' },
  { key: 'invoice.validated.ica_payable', label: 'Factura validada · ICA por Pagar (factura)' },
  { key: 'payment.received.iva_payable', label: 'Pago recibido · IVA por Pagar (venta directa)' },
  { key: 'payment.received.inc_payable', label: 'Pago recibido · Impuesto al Consumo por Pagar (venta directa)' },
  { key: 'payment.received.ica_payable', label: 'Pago recibido · ICA por Pagar (venta directa)' },
  { key: 'credit_sale.created.iva_payable', label: 'Venta a crédito · IVA por Pagar (venta a crédito)' },
  { key: 'credit_sale.created.inc_payable', label: 'Venta a crédito · Impuesto al Consumo por Pagar (venta a crédito)' },
  { key: 'credit_sale.created.ica_payable', label: 'Venta a crédito · ICA por Pagar (venta a crédito)' },
  { key: 'refund.completed.iva_payable', label: 'Reembolso completado · IVA por Pagar (reversa devolución)' },
  { key: 'refund.completed.inc_payable', label: 'Reembolso completado · Impuesto al Consumo por Pagar (reversa devolución)' },
  { key: 'refund.completed.ica_payable', label: 'Reembolso completado · ICA por Pagar (reversa devolución)' },
  { key: 'credit_note.accepted.sales_returns', label: 'Nota crédito aceptada · Devoluciones en Ventas (nota crédito)' },
  { key: 'credit_note.accepted.iva_payable', label: 'Nota crédito aceptada · IVA por Pagar (reversa nota crédito)' },
  { key: 'credit_note.accepted.inc_payable', label: 'Nota crédito aceptada · Impuesto al Consumo por Pagar (reversa nota crédito)' },
  { key: 'credit_note.accepted.ica_payable', label: 'Nota crédito aceptada · ICA por Pagar (reversa nota crédito)' },
  { key: 'credit_note.accepted.accounts_receivable', label: 'Nota crédito aceptada · Cuentas por Cobrar (reversa nota crédito)' },
  { key: 'payment.received.sales_discount', label: 'Pago recibido · Descuentos en Ventas (POS)' },
  { key: 'credit_sale.created.sales_discount', label: 'Venta a crédito · Descuentos en Ventas (Crédito)' },
  { key: 'layaway.payment.cash', label: 'Pago plan separe · Caja (pago cuota separé)' },
  { key: 'layaway.payment.bank', label: 'Pago plan separe · Banco (pago cuota separé)' },
  { key: 'layaway.payment.customer_advance', label: 'Pago plan separe · Anticipos de Clientes (separé)' },
  { key: 'layaway.completed.customer_advance', label: 'Plan separe completado · Anticipos de Clientes (separé completado)' },
  { key: 'layaway.completed.revenue', label: 'Plan separe completado · Ingresos por Ventas (separé completado)' },
  { key: 'layaway.cancelled.advance', label: 'Plan separe cancelado · Anticipos de Clientes (reversa separé cancelado)' },
  { key: 'layaway.cancelled.refund', label: 'Plan separe cancelado · Caja/Banco (devolución separé cancelado)' },
  { key: 'layaway.cancelled.forfeit_income', label: 'Plan separe cancelado · Otros Ingresos (penalización separé cancelado)' },
  { key: 'depreciation.monthly.depreciation_expense', label: 'Depreciación mensual · Gasto por Depreciación' },
  { key: 'depreciation.monthly.accumulated_depreciation', label: 'Depreciación mensual · Depreciación Acumulada' },
  { key: 'disposal.fixed_asset.asset_cost', label: 'Baja de activo fijo · Propiedad Planta y Equipo' },
  { key: 'disposal.fixed_asset.accumulated_depreciation', label: 'Baja de activo fijo · Depreciación Acumulada (baja)' },
  { key: 'disposal.fixed_asset.loss', label: 'Baja de activo fijo · Pérdida en Baja de Activos' },
  { key: 'disposal.fixed_asset.gain', label: 'Baja de activo fijo · Utilidad en Venta de Activos' },
  { key: 'disposal.fixed_asset.cash', label: 'Baja de activo fijo · Caja (venta activo)' },
  { key: 'withholding.applied.expense', label: 'Retención aplicada · Gasto / Compra (base retención)' },
  { key: 'withholding.applied.withholding_payable', label: 'Retención aplicada · Retención en la Fuente por Pagar' },
  { key: 'withholding.applied.accounts_payable', label: 'Retención aplicada · Proveedores (neto después de retención)' },
  { key: 'withholding.practiced.retefuente_payable', label: 'Retención practicada · Retención en la Fuente por Pagar (Compras)' },
  { key: 'withholding.practiced.reteiva_payable', label: 'Retención practicada · IVA Retenido por Pagar (ReteIVA practicada)' },
  { key: 'withholding.practiced.reteica_payable', label: 'Retención practicada · ICA Retenido por Pagar (ReteICA practicada)' },
  { key: 'withholding.suffered.retefuente_receivable', label: 'Retención sufrida · Retención en la Fuente a Favor (ReteFuente sufrida)' },
  { key: 'withholding.suffered.reteiva_receivable', label: 'Retención sufrida · IVA Retenido a Favor (ReteIVA sufrida)' },
  { key: 'withholding.suffered.reteica_receivable', label: 'Retención sufrida · ICA Retenido a Favor (ReteICA sufrida)' },
  { key: 'settlement.approved.severance', label: 'Liquidación aprobada · Cesantías Consolidadas (causación liquidación)' },
  { key: 'settlement.approved.severance_interest', label: 'Liquidación aprobada · Intereses sobre Cesantías (causación liquidación)' },
  { key: 'settlement.approved.bonus', label: 'Liquidación aprobada · Prima de Servicios (causación liquidación)' },
  { key: 'settlement.approved.vacation', label: 'Liquidación aprobada · Vacaciones (causación liquidación)' },
  { key: 'settlement.approved.pending_salary', label: 'Liquidación aprobada · Gastos de Personal - Salario Pendiente (causación)' },
  { key: 'settlement.approved.indemnification', label: 'Liquidación aprobada · Gastos de Personal - Indemnización (causación)' },
  { key: 'settlement.approved.salaries_payable', label: 'Liquidación aprobada · Salarios por Pagar (causación liquidación)' },
  { key: 'settlement.paid.severance', label: 'Liquidación pagada · Cesantías Consolidadas' },
  { key: 'settlement.paid.severance_interest', label: 'Liquidación pagada · Intereses sobre Cesantías' },
  { key: 'settlement.paid.bonus', label: 'Liquidación pagada · Prima de Servicios por Pagar' },
  { key: 'settlement.paid.vacation', label: 'Liquidación pagada · Vacaciones por Pagar' },
  { key: 'settlement.paid.pending_salary', label: 'Liquidación pagada · Gastos de Personal (Salario Pendiente)' },
  { key: 'settlement.paid.indemnification', label: 'Liquidación pagada · Gastos de Personal (Indemnización)' },
  { key: 'settlement.paid.social_deductions', label: 'Liquidación pagada · Retenciones y Aportes de Nómina' },
  { key: 'settlement.paid.bank', label: 'Liquidación pagada · Bancos (Pago Liquidación)' },
  { key: 'settlement.paid.salaries_payable', label: 'Liquidación pagada · Salarios por Pagar (drenaje pago liquidación)' },
  { key: 'payment.received.wompi', label: 'Pago recibido · Banco (Wompi - Nequi/PSE/Tarjeta)' },
  { key: 'ar.write_off.bad_debt', label: 'Castigo de cartera (CxC) · Provisión Cartera Dudosa' },
  { key: 'ar.write_off.accounts_receivable', label: 'Castigo de cartera (CxC) · Cuentas por Cobrar (castigo)' },
  { key: 'wallet.topup.customer_advance', label: 'Recarga de wallet · Anticipos de Clientes (Wallet)' },
  { key: 'wallet.topup.cash_bank', label: 'Recarga de wallet · Caja (recarga wallet)' },
  { key: 'wallet.debit.customer_advance', label: 'Uso de wallet · Anticipos de Clientes (uso wallet)' },
  { key: 'wallet.debit.revenue', label: 'Uso de wallet · Ingresos por Ventas (pago con wallet)' },
  { key: 'ap.payment.accounts_payable', label: 'Pago de CxP · Proveedores (pago CxP)' },
  { key: 'ap.payment.cash_bank', label: 'Pago de CxP · Banco (pago a proveedor)' },
  { key: 'ap.write_off.accounts_payable', label: 'Castigo de CxP · Proveedores (castigo CxP)' },
  { key: 'ap.write_off.other_income', label: 'Castigo de CxP · Otros Ingresos (castigo CxP a favor)' },
  { key: 'stock_transfer.completed.inventory_origin', label: 'Transferencia de stock · Inventario (tienda origen)' },
  { key: 'stock_transfer.completed.inventory_destination', label: 'Transferencia de stock · Inventario (tienda destino)' },
  { key: 'intercompany_transfer.shipped.receivable', label: 'Transferencia intercompany enviada · Cuentas por cobrar a vinculados' },
  { key: 'intercompany_transfer.shipped.inventory', label: 'Transferencia intercompany enviada · Inventario transferido a vinculada' },
  { key: 'intercompany_transfer.received.inventory', label: 'Transferencia intercompany recibida · Inventario recibido de vinculada' },
  { key: 'intercompany_transfer.received.payable', label: 'Transferencia intercompany recibida · Cuentas por pagar a vinculados' },
  { key: 'commission.calculated.expense', label: 'Comisión calculada · Gastos Diversos - Comisiones' },
  { key: 'commission.calculated.payable', label: 'Comisión calculada · Costos y Gastos por Pagar - Comisiones' },
  { key: 'payroll.approved.transport_subsidy', label: 'Nómina aprobada · Aux. Transporte Nómina' },
  { key: 'payroll.approved.provision_severance', label: 'Nómina aprobada · Gasto Cesantías' },
  { key: 'payroll.approved.provision_severance_interest', label: 'Nómina aprobada · Gasto Intereses Cesantías' },
  { key: 'payroll.approved.provision_vacation', label: 'Nómina aprobada · Gasto Vacaciones' },
  { key: 'payroll.approved.provision_bonus', label: 'Nómina aprobada · Gasto Prima de Servicios' },
  { key: 'payroll.approved.health_employer', label: 'Nómina aprobada · EPS Empleador (Gasto)' },
  { key: 'payroll.approved.pension_employer', label: 'Nómina aprobada · AFP Empleador (Gasto)' },
  { key: 'payroll.approved.arl_expense', label: 'Nómina aprobada · ARL (Gasto)' },
  { key: 'payroll.approved.sena_expense', label: 'Nómina aprobada · SENA (Gasto)' },
  { key: 'payroll.approved.icbf_expense', label: 'Nómina aprobada · ICBF (Gasto)' },
  { key: 'payroll.approved.compensation_fund_expense', label: 'Nómina aprobada · Caja Compensación (Gasto)' },
  { key: 'payroll.approved.liability_severance', label: 'Nómina aprobada · Cesantías por Pagar' },
  { key: 'payroll.approved.liability_severance_interest', label: 'Nómina aprobada · Intereses Cesantías por Pagar' },
  { key: 'payroll.approved.liability_vacation', label: 'Nómina aprobada · Vacaciones por Pagar' },
  { key: 'payroll.approved.liability_bonus', label: 'Nómina aprobada · Prima de Servicios por Pagar' },
  { key: 'payroll.approved.health_employer_payable', label: 'Nómina aprobada · EPS Empleador por Pagar' },
  { key: 'payroll.approved.pension_employer_payable', label: 'Nómina aprobada · AFP Empleador por Pagar' },
  { key: 'payroll.approved.arl_payable', label: 'Nómina aprobada · ARL por Pagar' },
  { key: 'payroll.approved.sena_payable', label: 'Nómina aprobada · SENA por Pagar' },
  { key: 'payroll.approved.icbf_payable', label: 'Nómina aprobada · ICBF por Pagar' },
  { key: 'payroll.approved.compensation_fund_payable', label: 'Nómina aprobada · Caja Compensación por Pagar' },
  { key: 'payroll.approved.advance_deduction', label: 'Nómina aprobada · Descuento Anticipos Empleados' },
  { key: 'cash_register.opened.cash', label: 'Apertura de caja · Caja (apertura)' },
  { key: 'cash_register.opened.cash_base', label: 'Apertura de caja · Banco/Fondo base (apertura)' },
  { key: 'cash_register.closed.cash', label: 'Cierre de caja · Caja (cierre)' },
  { key: 'cash_register.closed.bank', label: 'Cierre de caja · Banco (cierre/consignación)' },
  { key: 'cash_register.closed.surplus', label: 'Cierre de caja · Sobrante de caja' },
  { key: 'cash_register.closed.shortage', label: 'Cierre de caja · Faltante de caja' },
  { key: 'dispatch_route.closed.cash', label: 'Cierre de planilla de ruta · Caja (cuadre planilla de ruta)' },
  { key: 'dispatch_route.closed.surplus', label: 'Cierre de planilla de ruta · Otros Ingresos (sobrante de ruta)' },
  { key: 'dispatch_route.closed.shortage_receivable', label: 'Cierre de planilla de ruta · Cuentas por Cobrar a Trabajadores (faltante de ruta, conductor)' },
  { key: 'cash_register.movement.cash', label: 'Movimiento de caja · Caja (movimiento manual)' },
  { key: 'cash_register.movement.other', label: 'Movimiento de caja · Otros (movimiento manual caja)' },
  { key: 'saas_refund.revenue', label: 'Reembolso suscripción SaaS · Devoluciones en Ventas (SaaS refund)' },
  { key: 'saas_refund.cash_bank', label: 'Reembolso suscripción SaaS · Bancos (reembolso SaaS)' },
  { key: 'saas_bad_debt.expense', label: 'Cartera incobrable SaaS · Gasto Incobrable SaaS' },
  { key: 'saas_bad_debt.receivable', label: 'Cartera incobrable SaaS · Cuentas por Cobrar SaaS (provisión incobrable)' },
  { key: 'saas_partner_payout.commissions_payable', label: 'Pago comisión partner SaaS · CxP Comisiones Partners' },
  { key: 'saas_partner_payout.cash_bank', label: 'Pago comisión partner SaaS · Bancos (pago comisiones partner)' },
  { key: 'saas_subscription_expense.expense', label: 'Gasto suscripción SaaS · Gasto suscripción SaaS Vendix (cliente)' },
  { key: 'saas_subscription_expense.cash_bank', label: 'Gasto suscripción SaaS · Pago a Vendix (suscripción) — banco del cliente' },
  { key: 'saas_revenue.cash_bank', label: 'Ingreso suscripción SaaS · Bancos (cobro suscripción SaaS — plataforma Vendix)' },
  { key: 'saas_revenue.revenue', label: 'Ingreso suscripción SaaS · Ingreso suscripción SaaS (plataforma Vendix)' },
  { key: 'saas_revenue.partner_payable', label: 'Ingreso suscripción SaaS · CxP Comisión partner SaaS (plataforma Vendix)' },
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
      // Seed the form with the full cascade (incl. `source: 'default'`
      // suggestions resolved from DEFAULT_ACCOUNT_MAPPINGS) so the user sees
      // sensible pre-filled accounts. But `existingCount` must reflect ONLY
      // actually-persisted rows ('store'/'organization' sources). Counting the
      // default-cascade entries made `submit()` believe the step was "already
      // configured", skip the PUT, and never write rows — so the fiscal
      // validation step saw mapeos as permanently incomplete (even after a
      // reload), because the backend only counts real `is_active` rows.
      const persistedCount = mappingItems.filter(
        (m: any) =>
          (m?.source === 'store' || m?.source === 'organization') &&
          m.account_id != null,
      ).length;
      this.existingCount.set(persistedCount);
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

      // Refresh the read-only prefill so `accounting_mappings` lands in
      // `satisfied_steps` immediately (mirrors the PUC step). Without this the
      // in-session prefill stays stale and downstream screens rely on a manual
      // reload to reflect the just-saved mappings.
      await this.service.loadPrefill(true).catch(() => undefined);

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
