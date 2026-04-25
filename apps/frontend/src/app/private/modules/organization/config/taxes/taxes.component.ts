import { Component, effect, inject, signal } from '@angular/core';
import {
  FormGroup,
  FormControl,
  ReactiveFormsModule,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ButtonComponent,
  SelectorComponent,
  SelectorOption,
  StickyHeaderComponent,
  TableComponent,
  TableColumn,
  TableAction,
  ScrollableTabsComponent,
  CardComponent,
  ToggleComponent,
  SpinnerComponent,
  AlertBannerComponent,
  IconComponent,
} from '../../../../../shared/components';
import { OrganizationSettingsService } from '../services/organization-settings.service';

type TaxesTabId = 'iva' | 'retenciones' | 'resoluciones' | 'config';

interface DianResolution {
  id: number;
  prefix: string;
  resolution_number: string;
  valid_from: string;
  valid_to: string;
  consecutive_from: number;
  consecutive_to: number;
  current_number: number;
  is_active: boolean;
}

interface RetentionType {
  id: number;
  code: string;
  name: string;
  rate: number;
  description: string;
  is_active: boolean;
}

@Component({
  selector: 'app-taxes',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    CardComponent,
    ToggleComponent,
    SelectorComponent,
    SpinnerComponent,
    AlertBannerComponent,
    IconComponent,
    StickyHeaderComponent,
    TableComponent,
    ScrollableTabsComponent,
  ],
  template: `
    <div class="w-full">
      <app-sticky-header
        title="Configuración de Impuestos"
        subtitle="DIAN, retenciones y tasas de IVA"
        icon="credit-card"
        [showBackButton]="true"
        backRoute="/organization/config"
      ></app-sticky-header>

      <div class="mt-6">
        @if (loading()) {
          <div class="flex justify-center py-12">
            <app-spinner size="lg" text="Cargando configuración fiscal..."></app-spinner>
          </div>
        } @else if (error()) {
          <app-alert-banner variant="danger" icon="alert-circle">
            {{ error() }}
            <button class="ml-3 underline font-semibold" (click)="dismissError()">Cerrar</button>
          </app-alert-banner>
        } @else {
          <app-card [responsivePadding]="true">
            <app-scrollable-tabs [tabs]="tabs" [activeTab]="activeTab()" (tabChange)="setActiveTab($event)"></app-scrollable-tabs>

            <div class="mt-6">
              @switch (activeTab()) {
                @case ('iva') {
                  <!-- IVA Tab -->
                  <div class="space-y-6">
                    <div class="flex items-center justify-between">
                      <h3 class="text-lg font-semibold">Tasas de IVA</h3>
                      <app-button variant="primary" size="sm" icon="plus" (clicked)="openIvaModal()">
                        Agregar tasa
                      </app-button>
                    </div>

                    <app-table
                      [data]="ivaRates()"
                      [columns]="ivaColumns"
                      [actions]="ivaActions"
                      [striped]="true"
                    ></app-table>

                    <!-- Default IVA Rate -->
                    <div class="border-t pt-4 mt-4">
                      <app-selector
                        label="Tasa de IVA por defecto"
                        [options]="defaultIvaOptions"
                        formControlName="default_iva_rate"
                        placeholder="Seleccionar tasa"
                      ></app-selector>
                    </div>
                  </div>
                }

                @case ('retenciones') {
                  <!-- Retenciones Tab -->
                  <div class="space-y-6">
                    <div class="flex items-center justify-between">
                      <h3 class="text-lg font-semibold">Retenciones en la fuente</h3>
                      <app-button variant="primary" size="sm" icon="plus" (clicked)="openRetentionModal()">
                        Agregar retención
                      </app-button>
                    </div>

                    <app-table
                      [data]="retentions()"
                      [columns]="retentionColumns"
                      [actions]="retentionActions"
                      [striped]="true"
                    ></app-table>
                  </div>
                }

                @case ('resoluciones') {
                  <!-- Resoluciones DIAN Tab -->
                  <div class="space-y-6">
                    <div class="flex items-center justify-between">
                      <h3 class="text-lg font-semibold">Resoluciones DIAN</h3>
                      <app-button variant="primary" size="sm" icon="plus" (clicked)="openResolutionModal()">
                        Nueva resolución
                      </app-button>
                    </div>

                    <app-table
                      [data]="resolutions()"
                      [columns]="resolutionColumns"
                      [actions]="resolutionActions"
                      [striped]="true"
                    ></app-table>
                  </div>
                }

                @case ('config') {
                  <!-- Configuración general -->
                  <div class="space-y-6">
                    <h3 class="text-lg font-semibold">Configuración general de impuestos</h3>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <app-selector
                        label="Régimen tributario"
                        [options]="taxRegimeOptions"
                        formControlName="tax_regime"
                        placeholder="Seleccionar régimen"
                      ></app-selector>

                      <app-selector
                        label="Tipo de contribuyente"
                        [options]="taxpayerTypeOptions"
                        formControlName="taxpayer_type"
                        placeholder="Seleccionar tipo"
                      ></app-selector>
                    </div>

                    <div class="space-y-3">
                      <app-toggle
                        label="Impuestos incluidos en precios"
                        description="Los precios de productos ya incluyen IVA"
                        formControlName="prices_include_tax"
                      ></app-toggle>

                      <app-toggle
                        label="Facturación electrónica obligatoria"
                        description="Requerir facturación electrónica para todas las ventas"
                        formControlName="electronic_invoicing_required"
                      ></app-toggle>

                      <app-toggle
                        label="Retención automática"
                        description="Aplicar retenciones automáticamente en ventas"
                        formControlName="auto_retention"
                      ></app-toggle>
                    </div>

                    <div class="flex justify-end pt-4">
                      <app-button
                        variant="primary"
                        [loading]="saving()"
                        [disabled]="form.pristine"
                        (clicked)="onSave()"
                      >
                        Guardar configuración
                      </app-button>
                    </div>
                  </div>
                }
              }
            </div>
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
export class TaxesComponent {
  private settingsService = inject(OrganizationSettingsService);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly activeTab = signal<TaxesTabId>('iva');

  setActiveTab(id: string): void {
    this.activeTab.set(id as TaxesTabId);
  }

  readonly tabs = [
    { id: 'iva', label: 'IVA' },
    { id: 'retenciones', label: 'Retenciones' },
    { id: 'resoluciones', label: 'Resoluciones DIAN' },
    { id: 'config', label: 'Configuración' },
  ];

  readonly ivaRates = signal([
    { id: 1, name: 'IVA 19%', rate: 19, is_default: true, is_active: true },
    { id: 2, name: 'IVA 5%', rate: 5, is_default: false, is_active: true },
    { id: 3, name: 'IVA 0%', rate: 0, is_default: false, is_active: true },
  ]);

  readonly retentions = signal<RetentionType[]>([
    { id: 1, code: 'RENTA', name: 'Retención en renta', rate: 4, description: 'Tarifa general retención renta', is_active: true },
    { id: 2, code: 'ICA', name: 'Retención ICA', rate: 0.1, description: 'Industria y comercio', is_active: true },
    { id: 3, code: 'IVA', name: 'Retención IVA', rate: 15, description: 'Sobre IVA cobrado', is_active: true },
  ]);

  readonly resolutions = signal<DianResolution[]>([
    { id: 1, prefix: 'FE', resolution_number: '18760000001', valid_from: '2024-01-01', valid_to: '2025-12-31', consecutive_from: 1, consecutive_to: 10000, current_number: 1523, is_active: true },
  ]);

  form = new FormGroup({
    tax_regime: new FormControl('responsable_inscripto', { nonNullable: true }),
    taxpayer_type: new FormControl('contribuyente', { nonNullable: true }),
    prices_include_tax: new FormControl(false, { nonNullable: true }),
    electronic_invoicing_required: new FormControl(true, { nonNullable: true }),
    auto_retention: new FormControl(false, { nonNullable: true }),
    default_iva_rate: new FormControl('19', { nonNullable: true }),
  });

  readonly ivaColumns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true },
    { key: 'rate', label: 'Tasa (%)', sortable: true, transform: (v) => `${v}%` },
    { key: 'is_default', label: 'Por defecto', transform: (v) => v ? 'Sí' : 'No' },
    { key: 'is_active', label: 'Activo', transform: (v) => v ? 'Sí' : 'No' },
  ];

  readonly ivaActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit-2',
      variant: 'secondary',
      action: (item) => this.editIvaRate(item),
    },
    {
      label: (item) => item.is_default ? '' : 'Establecer por defecto',
      icon: (item) => item.is_default ? 'check' : 'star',
      variant: (item) => item.is_default ? 'success' : 'ghost',
      show: (item) => !item.is_default,
      action: (item) => this.setDefaultIva(item),
    },
  ];

  readonly retentionColumns: TableColumn[] = [
    { key: 'code', label: 'Código', sortable: true },
    { key: 'name', label: 'Nombre', sortable: true },
    { key: 'rate', label: 'Tarifa (%)', sortable: true, transform: (v) => `${v}%` },
    { key: 'description', label: 'Descripción' },
    { key: 'is_active', label: 'Activo', transform: (v) => v ? 'Sí' : 'No' },
  ];

  readonly retentionActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit-2',
      variant: 'secondary',
      action: (item) => this.editRetention(item),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item) => this.removeRetention(item),
    },
  ];

  readonly resolutionColumns: TableColumn[] = [
    { key: 'prefix', label: 'Prefijo', sortable: true },
    { key: 'resolution_number', label: 'Resolución', sortable: true },
    { key: 'valid_from', label: 'Válida desde', transform: (v) => this.formatDate(v) },
    { key: 'valid_to', label: 'Válida hasta', transform: (v) => this.formatDate(v) },
    { key: 'current_number', label: 'Actual', transform: (v) => v?.toString() || '0' },
    { key: 'is_active', label: 'Activa', transform: (v) => v ? 'Sí' : 'No' },
  ];

  readonly resolutionActions: TableAction[] = [
    {
      label: 'Verificar',
      icon: 'check-circle',
      variant: 'success',
      show: (item) => item.is_active,
      action: (item) => this.verifyResolution(item),
    },
    {
      label: 'Editar',
      icon: 'edit-2',
      variant: 'secondary',
      action: (item) => this.editResolution(item),
    },
  ];

  readonly defaultIvaOptions: SelectorOption[] = [
    { value: '19', label: 'IVA 19%' },
    { value: '5', label: 'IVA 5%' },
    { value: '0', label: 'IVA 0%' },
  ];

  readonly taxRegimeOptions: SelectorOption[] = [
    { value: 'responsable_inscripto', label: 'Responsable inscripto' },
    { value: 'responsable_no_inscripto', label: 'Responsable no inscripto' },
    { value: 'no_responsable', label: 'No responsable' },
    { value: 'consumidor_final', label: 'Consumidor final' },
  ];

  readonly taxpayerTypeOptions: SelectorOption[] = [
    { value: 'contribuyente', label: 'Contribuyente' },
    { value: 'persona_natural', label: 'Persona natural' },
    { value: 'entidad_sin_animofines', label: 'Entidad sin ánimo de lucro' },
    { value: 'regimen_simple', label: 'Régimen Simple' },
  ];

  constructor() {
    this.settingsService.getSettings().pipe(takeUntilDestroyed()).subscribe((settings) => {
      this.loading.set(this.settingsService.loading());
      this.saving.set(this.settingsService.saving());
      this.error.set(this.settingsService.error());

      if (settings) {
        const taxes = (settings as any).taxes || {};
        this.form.patchValue(
          {
            tax_regime: taxes.tax_regime || 'responsable_inscripto',
            taxpayer_type: taxes.taxpayer_type || 'contribuyente',
            prices_include_tax: taxes.prices_include_tax ?? false,
            electronic_invoicing_required: taxes.electronic_invoicing_required ?? true,
            auto_retention: taxes.auto_retention ?? false,
            default_iva_rate: taxes.default_iva_rate || '19',
          },
          { emitEvent: false },
        );

        if (taxes.iva_rates) this.ivaRates.set(taxes.iva_rates);
        if (taxes.retentions) this.retentions.set(taxes.retentions);
        if (taxes.resolutions) this.resolutions.set(taxes.resolutions);

        this.form.markAsPristine();
      }
    });
  }

  openIvaModal(): void {}
  openRetentionModal(): void {}
  openResolutionModal(): void {}

  editIvaRate(item: any): void {}
  setDefaultIva(item: any): void {
    this.ivaRates.update((rates) =>
      rates.map((r) => ({ ...r, is_default: r.id === item.id })),
    );
    this.emitTaxUpdate();
  }

  editRetention(item: RetentionType): void {}
  removeRetention(item: RetentionType): void {
    this.retentions.update((list) => list.filter((r) => r.id !== item.id));
    this.emitTaxUpdate();
  }

  editResolution(item: DianResolution): void {}
  verifyResolution(item: DianResolution): void {}

  onSave(): void {
    if (this.form.pristine || this.saving()) return;

    const taxes = {
      ...this.form.value,
      iva_rates: this.ivaRates(),
      retentions: this.retentions(),
      resolutions: this.resolutions(),
    };

    this.settingsService.saveSettings({ taxes } as any).subscribe({
      next: () => this.form.markAsPristine(),
      error: () => {},
    });
  }

  private emitTaxUpdate(): void {
    const taxes = {
      ...this.form.value,
      iva_rates: this.ivaRates(),
      retentions: this.retentions(),
      resolutions: this.resolutions(),
    };
    this.settingsService.saveSettings({ taxes } as any).subscribe();
  }

  private formatDate(date: string): string {
    if (!date) return '';
    return new Date(date).toLocaleDateString('es-CO');
  }

  dismissError(): void {
    this.error.set(null);
  }
}