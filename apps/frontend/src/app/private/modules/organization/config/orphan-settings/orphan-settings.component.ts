import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import {
  FormGroup,
  FormControl,
  ReactiveFormsModule,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  InputComponent,
  TextareaComponent,
  ButtonComponent,
  CardComponent,
  ToggleComponent,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
  AlertBannerComponent,
  StickyHeaderComponent,
  ScrollableTabsComponent,
} from '../../../../../shared/components';
import { OrganizationSettingsService } from '../services/organization-settings.service';

@Component({
  selector: 'app-orphan-settings',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    TextareaComponent,
    ButtonComponent,
    CardComponent,
    ToggleComponent,
    SelectorComponent,
    SpinnerComponent,
    AlertBannerComponent,
    StickyHeaderComponent,
    ScrollableTabsComponent,
  ],
  template: `
    <div class="w-full">
      <app-sticky-header
        title="Configuración adicional"
        subtitle="Ajustes de publicación, fuentes, flujos y paneles"
        icon="settings"
        [showBackButton]="true"
        backRoute="/admin/config"
      ></app-sticky-header>

      <div class="mt-6">
        @if (loading()) {
          <div class="flex justify-center py-12">
            <app-spinner size="lg" text="Cargando configuración..."></app-spinner>
          </div>
        } @else if (error()) {
          <app-alert-banner variant="danger" icon="alert-circle">
            {{ error() }}
            <button class="ml-3 underline font-semibold" (click)="dismissError()">Cerrar</button>
          </app-alert-banner>
        } @else {
          <app-card [responsivePadding]="true">
            <form [formGroup]="form" (ngSubmit)="onSave()">
            <app-scrollable-tabs [tabs]="tabs" [activeTab]="activeTab()" (tabChange)="activeTab.set($event)"></app-scrollable-tabs>

            <div class="mt-6">
              @switch (activeTab()) {
                @case ('publication') {
                  <div class="space-y-6">
                    <h3 class="text-lg font-semibold">Estado de publicación</h3>
                    <div class="space-y-3">
                      <app-toggle
                        label="Tienda publicada"
                        description="La tienda es visible para el público"
                        formControlName="store_published"
                      ></app-toggle>

                      <app-toggle
                        label="E-commerce habilitado"
                        description="Permite ventas en línea"
                        formControlName="ecommerce_enabled"
                      ></app-toggle>

                      <app-toggle
                        label="Landing page habilitada"
                        description="Muestra landing page pública"
                        formControlName="landing_enabled"
                      ></app-toggle>

                      <app-toggle
                        label="Modo mantenimiento"
                        description="Solo administradores pueden acceder"
                        formControlName="maintenance_mode"
                      ></app-toggle>
                    </div>

                    @if (form.get('maintenance_mode')?.value) {
                      <app-textarea
                        label="Mensaje de mantenimiento"
                        placeholder="Estamos en mantenimiento. Vuelve pronto."
                        formControlName="maintenance_message"
                        [rows]="3"
                      ></app-textarea>
                    }
                  </div>
                }

                @case ('fonts') {
                  <div class="space-y-6">
                    <h3 class="text-lg font-semibold">Tipografía</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <app-selector
                        label="Fuente principal"
                        [options]="fontOptions"
                        formControlName="primary_font"
                        placeholder="Seleccionar fuente"
                      ></app-selector>

                      <app-selector
                        label="Fuente secundaria"
                        [options]="fontOptions"
                        formControlName="secondary_font"
                        placeholder="Seleccionar fuente"
                      ></app-selector>

                      <app-selector
                        label="Fuente para títulos"
                        [options]="fontOptions"
                        formControlName="headings_font"
                        placeholder="Seleccionar fuente"
                      ></app-selector>
                    </div>
                  </div>
                }

                @case ('accounting') {
                  <div class="space-y-6">
                    <h3 class="text-lg font-semibold">Flujos de contabilidad</h3>
                    <p class="text-gray-600 text-sm">Selecciona qué módulos generan asientos automáticos</p>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <app-toggle label="Facturación" formControlName="flow_invoicing"></app-toggle>
                      <app-toggle label="Pagos" formControlName="flow_payments"></app-toggle>
                      <app-toggle label="Gastos" formControlName="flow_expenses"></app-toggle>
                      <app-toggle label="Nómina" formControlName="flow_payroll"></app-toggle>
                      <app-toggle label="Ventas a crédito" formControlName="flow_credit_sales"></app-toggle>
                      <app-toggle label="Inventario" formControlName="flow_inventory"></app-toggle>
                      <app-toggle label="Devoluciones" formControlName="flow_returns"></app-toggle>
                      <app-toggle label="Compras" formControlName="flow_purchases"></app-toggle>
                      <app-toggle label="Activos fijos" formControlName="flow_fixed_assets"></app-toggle>
                      <app-toggle label="Retenciones" formControlName="flow_withholding"></app-toggle>
                      <app-toggle label="Liquidaciones" formControlName="flow_settlements"></app-toggle>
                      <app-toggle label="Cartera" formControlName="flow_wallet"></app-toggle>
                      <app-toggle label="Caja registradora" formControlName="flow_cash_register"></app-toggle>
                      <app-toggle label="Transferencias de stock" formControlName="flow_stock_transfers"></app-toggle>
                      <app-toggle label="Comisiones" formControlName="flow_commissions"></app-toggle>
                      <app-toggle label="Cuentas por pagar/cobrar" formControlName="flow_ar_ap"></app-toggle>
                    </div>
                  </div>
                }

                @case ('reservations') {
                  <div class="space-y-6">
                    <h3 class="text-lg font-semibold">Reservaciones</h3>

                    <div class="space-y-4">
                      <h4 class="font-medium text-sm text-gray-700">Recordatorios</h4>
                      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <app-toggle label="Habilitar recordatorios" formControlName="reservations_reminders_enabled"></app-toggle>
                        <app-input label="Tiempo antes del turno" placeholder="30m, 1h, 2h, 24h, 48h, 1w" formControlName="reservations_reminder_time"></app-input>
                      </div>
                    </div>

                    <div class="space-y-4 pt-4 border-t">
                      <h4 class="font-medium text-sm text-gray-700">Confirmación</h4>
                      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <app-toggle label="Habilitar confirmación" formControlName="reservations_confirmation_enabled"></app-toggle>
                        <app-input label="Tiempo de confirmación" placeholder="e.g., 24h" formControlName="reservations_confirmation_time"></app-input>
                      </div>
                      <app-toggle label="Cancelar si no se confirma" formControlName="reservations_auto_cancel"></app-toggle>
                    </div>

                    <div class="space-y-4 pt-4 border-t">
                      <h4 class="font-medium text-sm text-gray-700">Check-in</h4>
                      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <app-toggle label="Permitir check-in del cliente" formControlName="reservations_allow_customer_checkin"></app-toggle>
                        <app-toggle label="Permitir check-in del staff" formControlName="reservations_allow_staff_checkin"></app-toggle>
                      </div>
                    </div>
                  </div>
                }

                @case ('operations') {
                  <div class="space-y-6">
                    <h3 class="text-lg font-semibold">Operaciones</h3>
                    <app-input label="Tiempo de preparación por defecto (minutos)" type="number" placeholder="30" formControlName="default_preparation_time_minutes"></app-input>
                  </div>
                }

                @case ('panel') {
                  <div class="space-y-6">
                    <h3 class="text-lg font-semibold">Visibilidad de módulos</h3>
                    <p class="text-gray-600 text-sm">Controla qué módulos son visibles para los usuarios de esta organización</p>

                    <div class="space-y-4">
                      <h4 class="font-medium text-sm text-gray-700">Panel de organización (ORG_ADMIN)</h4>
                      <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <app-toggle label="Dashboard" formControlName="panel_dashboard"></app-toggle>
                        <app-toggle label="Tiendas" formControlName="panel_stores"></app-toggle>
                        <app-toggle label="Usuarios" formControlName="panel_users"></app-toggle>
                        <app-toggle label="Auditoría" formControlName="panel_audit"></app-toggle>
                        <app-toggle label="Dominios" formControlName="panel_domains"></app-toggle>
                        <app-toggle label="Configuración" formControlName="panel_settings"></app-toggle>
                        <app-toggle label="Analytics" formControlName="panel_analytics"></app-toggle>
                        <app-toggle label="Reportes" formControlName="panel_reports"></app-toggle>
                        <app-toggle label="Inventario" formControlName="panel_inventory"></app-toggle>
                        <app-toggle label="Facturación" formControlName="panel_billing"></app-toggle>
                        <app-toggle label="E-commerce" formControlName="panel_ecommerce"></app-toggle>
                        <app-toggle label="Órdenes" formControlName="panel_orders"></app-toggle>
                        <app-toggle label="Gastos" formControlName="panel_expenses"></app-toggle>
                      </div>
                    </div>
                  </div>
                }
              }
            </div>

            <!-- Save Button -->
            <div class="flex justify-end pt-6 mt-6 border-t">
              <app-button variant="primary" [loading]="saving()" [disabled]="form.pristine" (clicked)="onSave()">
                Guardar cambios
              </app-button>
            </div>
            </form>
          </app-card>
        }
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `],
})
export class OrphanSettingsComponent {
  private settingsService = inject(OrganizationSettingsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly activeTab = signal('publication');

  readonly tabs = [
    { id: 'publication', label: 'Publicación' },
    { id: 'fonts', label: 'Fuentes' },
    { id: 'accounting', label: 'Contabilidad' },
    { id: 'reservations', label: 'Reservaciones' },
    { id: 'operations', label: 'Operaciones' },
    { id: 'panel', label: 'Panel UI' },
  ];

  form = new FormGroup({
    store_published: new FormControl(true, { nonNullable: true }),
    ecommerce_enabled: new FormControl(true, { nonNullable: true }),
    landing_enabled: new FormControl(true, { nonNullable: true }),
    maintenance_mode: new FormControl(false, { nonNullable: true }),
    maintenance_message: new FormControl('', { nonNullable: true }),

    primary_font: new FormControl('Inter', { nonNullable: true }),
    secondary_font: new FormControl('Inter', { nonNullable: true }),
    headings_font: new FormControl('Inter', { nonNullable: true }),

    flow_invoicing: new FormControl(true, { nonNullable: true }),
    flow_payments: new FormControl(true, { nonNullable: true }),
    flow_expenses: new FormControl(true, { nonNullable: true }),
    flow_payroll: new FormControl(false, { nonNullable: true }),
    flow_credit_sales: new FormControl(true, { nonNullable: true }),
    flow_inventory: new FormControl(true, { nonNullable: true }),
    flow_returns: new FormControl(true, { nonNullable: true }),
    flow_purchases: new FormControl(true, { nonNullable: true }),
    flow_fixed_assets: new FormControl(false, { nonNullable: true }),
    flow_withholding: new FormControl(true, { nonNullable: true }),
    flow_settlements: new FormControl(false, { nonNullable: true }),
    flow_wallet: new FormControl(false, { nonNullable: true }),
    flow_cash_register: new FormControl(true, { nonNullable: true }),
    flow_stock_transfers: new FormControl(true, { nonNullable: true }),
    flow_commissions: new FormControl(false, { nonNullable: true }),
    flow_ar_ap: new FormControl(false, { nonNullable: true }),

    reservations_reminders_enabled: new FormControl(true, { nonNullable: true }),
    reservations_reminder_time: new FormControl('30m', { nonNullable: true }),
    reservations_confirmation_enabled: new FormControl(true, { nonNullable: true }),
    reservations_confirmation_time: new FormControl('24h', { nonNullable: true }),
    reservations_auto_cancel: new FormControl(false, { nonNullable: true }),
    reservations_allow_customer_checkin: new FormControl(true, { nonNullable: true }),
    reservations_allow_staff_checkin: new FormControl(true, { nonNullable: true }),

    default_preparation_time_minutes: new FormControl(30, { nonNullable: true }),

    panel_dashboard: new FormControl(true, { nonNullable: true }),
    panel_stores: new FormControl(true, { nonNullable: true }),
    panel_users: new FormControl(true, { nonNullable: true }),
    panel_audit: new FormControl(true, { nonNullable: true }),
    panel_domains: new FormControl(true, { nonNullable: true }),
    panel_settings: new FormControl(true, { nonNullable: true }),
    panel_analytics: new FormControl(true, { nonNullable: true }),
    panel_reports: new FormControl(true, { nonNullable: true }),
    panel_inventory: new FormControl(true, { nonNullable: true }),
    panel_billing: new FormControl(true, { nonNullable: true }),
    panel_ecommerce: new FormControl(true, { nonNullable: true }),
    panel_orders: new FormControl(true, { nonNullable: true }),
    panel_expenses: new FormControl(true, { nonNullable: true }),
  });

  readonly fontOptions: SelectorOption[] = [
    { value: 'Inter', label: 'Inter' },
    { value: 'Roboto', label: 'Roboto' },
    { value: 'Open Sans', label: 'Open Sans' },
    { value: 'Montserrat', label: 'Montserrat' },
    { value: 'Poppins', label: 'Poppins' },
    { value: 'Lato', label: 'Lato' },
    { value: 'Nunito', label: 'Nunito' },
    { value: 'Playfair Display', label: 'Playfair Display' },
    { value: 'Merriweather', label: 'Merriweather' },
    { value: 'Source Sans Pro', label: 'Source Sans Pro' },
  ];

  constructor() {
    this.settingsService.getSettings().pipe(takeUntilDestroyed()).subscribe((settings) => {
      this.loading.set(this.settingsService.loading());
      this.saving.set(this.settingsService.saving());
      this.error.set(this.settingsService.error());

      if (settings) {
        const orphaned = settings as any;
        this.form.patchValue(
          {
            store_published: orphaned.store_published ?? true,
            ecommerce_enabled: orphaned.ecommerce_enabled ?? true,
            landing_enabled: orphaned.landing_enabled ?? true,
            maintenance_mode: orphaned.maintenance_mode ?? false,
            maintenance_message: orphaned.maintenance_message ?? '',
            primary_font: orphaned.primary_font ?? 'Inter',
            secondary_font: orphaned.secondary_font ?? 'Inter',
            headings_font: orphaned.headings_font ?? 'Inter',
            flow_invoicing: orphaned.flow_invoicing ?? true,
            flow_payments: orphaned.flow_payments ?? true,
            flow_expenses: orphaned.flow_expenses ?? true,
            flow_payroll: orphaned.flow_payroll ?? false,
            flow_credit_sales: orphaned.flow_credit_sales ?? true,
            flow_inventory: orphaned.flow_inventory ?? true,
            flow_returns: orphaned.flow_returns ?? true,
            flow_purchases: orphaned.flow_purchases ?? true,
            flow_fixed_assets: orphaned.flow_fixed_assets ?? false,
            flow_withholding: orphaned.flow_withholding ?? true,
            flow_settlements: orphaned.flow_settlements ?? false,
            flow_wallet: orphaned.flow_wallet ?? false,
            flow_cash_register: orphaned.flow_cash_register ?? true,
            flow_stock_transfers: orphaned.flow_stock_transfers ?? true,
            flow_commissions: orphaned.flow_commissions ?? false,
            flow_ar_ap: orphaned.flow_ar_ap ?? false,
            reservations_reminders_enabled: orphaned.reservations_reminders_enabled ?? true,
            reservations_reminder_time: orphaned.reservations_reminder_time ?? '30m',
            reservations_confirmation_enabled: orphaned.reservations_confirmation_enabled ?? true,
            reservations_confirmation_time: orphaned.reservations_confirmation_time ?? '24h',
            reservations_auto_cancel: orphaned.reservations_auto_cancel ?? false,
            reservations_allow_customer_checkin: orphaned.reservations_allow_customer_checkin ?? true,
            reservations_allow_staff_checkin: orphaned.reservations_allow_staff_checkin ?? true,
            default_preparation_time_minutes: orphaned.default_preparation_time_minutes ?? 30,
          },
          { emitEvent: false },
        );

        if (orphaned.panel_ui?.ORG_ADMIN) {
          const panel = orphaned.panel_ui.ORG_ADMIN;
          this.form.patchValue(
            {
              panel_dashboard: panel.dashboard ?? true,
              panel_stores: panel.stores ?? true,
              panel_users: panel.users ?? true,
              panel_audit: panel.audit ?? true,
              panel_domains: panel.domains ?? true,
              panel_settings: panel.settings ?? true,
              panel_analytics: panel.analytics ?? true,
              panel_reports: panel.reports ?? true,
              panel_inventory: panel.inventory ?? true,
              panel_billing: panel.billing ?? true,
              panel_ecommerce: panel.ecommerce ?? true,
              panel_orders: panel.orders ?? true,
              panel_expenses: panel.expenses ?? true,
            },
            { emitEvent: false },
          );
        }

        this.form.markAsPristine();
      }
    });
  }

  onSave(): void {
    if (this.form.pristine || this.saving()) return;

    const v = this.form.value;

    const settings = {
      store_published: v.store_published,
      ecommerce_enabled: v.ecommerce_enabled,
      landing_enabled: v.landing_enabled,
      maintenance_mode: v.maintenance_mode,
      maintenance_message: v.maintenance_message,
      primary_font: v.primary_font,
      secondary_font: v.secondary_font,
      headings_font: v.headings_font,
      flow_invoicing: v.flow_invoicing,
      flow_payments: v.flow_payments,
      flow_expenses: v.flow_expenses,
      flow_payroll: v.flow_payroll,
      flow_credit_sales: v.flow_credit_sales,
      flow_inventory: v.flow_inventory,
      flow_returns: v.flow_returns,
      flow_purchases: v.flow_purchases,
      flow_fixed_assets: v.flow_fixed_assets,
      flow_withholding: v.flow_withholding,
      flow_settlements: v.flow_settlements,
      flow_wallet: v.flow_wallet,
      flow_cash_register: v.flow_cash_register,
      flow_stock_transfers: v.flow_stock_transfers,
      flow_commissions: v.flow_commissions,
      flow_ar_ap: v.flow_ar_ap,
      reservations_reminders_enabled: v.reservations_reminders_enabled,
      reservations_reminder_time: v.reservations_reminder_time,
      reservations_confirmation_enabled: v.reservations_confirmation_enabled,
      reservations_confirmation_time: v.reservations_confirmation_time,
      reservations_auto_cancel: v.reservations_auto_cancel,
      reservations_allow_customer_checkin: v.reservations_allow_customer_checkin,
      reservations_allow_staff_checkin: v.reservations_allow_staff_checkin,
      default_preparation_time_minutes: v.default_preparation_time_minutes,
      panel_ui: {
        ORG_ADMIN: {
          dashboard: v.panel_dashboard,
          stores: v.panel_stores,
          users: v.panel_users,
          audit: v.panel_audit,
          domains: v.panel_domains,
          settings: v.panel_settings,
          analytics: v.panel_analytics,
          reports: v.panel_reports,
          inventory: v.panel_inventory,
          billing: v.panel_billing,
          ecommerce: v.panel_ecommerce,
          orders: v.panel_orders,
          expenses: v.panel_expenses,
        },
      },
    };

    this.saving.set(true);
    this.error.set(null);

    this.settingsService
      .saveSettings(settings as any)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.form.markAsPristine();
          this.saving.set(false);
        },
        error: () => {
          this.error.set('Error al guardar la configuración adicional.');
          this.saving.set(false);
        },
      });
  }

  dismissError(): void {
    this.error.set(null);
  }
}
