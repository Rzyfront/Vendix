import { Component, inject, signal } from '@angular/core';
import {
  ReactiveFormsModule,
  FormGroup,
  FormControl,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  InputComponent,
  ButtonComponent,
  CardComponent,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
  AlertBannerComponent,
  IconComponent,
  StickyHeaderComponent,
} from '../../../../../shared/components';
import { OrganizationSettingsService } from '../services/organization-settings.service';

@Component({
  selector: 'app-integrations',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    ButtonComponent,
    CardComponent,
    SelectorComponent,
    SpinnerComponent,
    AlertBannerComponent,
    IconComponent,
    StickyHeaderComponent,
  ],
  template: `
    <div class="w-full">
      <app-sticky-header
        title="Integraciones"
        subtitle="Conecta servicios de terceros"
        icon="link-2"
        [showBackButton]="true"
        backRoute="/organization/config"
      ></app-sticky-header>

      <div class="mt-6">
        @if (loading()) {
          <div class="flex justify-center py-12">
            <app-spinner size="lg" text="Cargando integraciones..."></app-spinner>
          </div>
        } @else if (error()) {
          <app-alert-banner variant="danger" icon="alert-circle">
            {{ error() }}
            <button class="ml-3 underline font-semibold" (click)="dismissError()">Cerrar</button>
          </app-alert-banner>
        } @else {
          <div class="space-y-6">
            <!-- Accounting Integration -->
            <app-card [responsivePadding]="true">
              <div class="flex items-start justify-between">
                <div class="flex items-start gap-4">
                  <div class="p-3 bg-blue-100 rounded-lg">
                    <app-icon name="calculator" size="24" class="text-blue-600"></app-icon>
                  </div>
                  <div>
                    <h3 class="text-lg font-semibold">Contabilidad</h3>
                    <p class="text-gray-600 text-sm mt-1">
                      Integración con sistemas de contabilidad
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                  [class.bg-primary]="accountingEnabled()"
                  [class.bg-gray-300]="!accountingEnabled()"
                  (click)="accountingEnabled.set(!accountingEnabled())"
                >
                  <span
                    class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                    [class.translate-x-6]="accountingEnabled()"
                    [class.translate-x-1]="!accountingEnabled()"
                  ></span>
                </button>
              </div>

              @if (accountingEnabled()) {
                <div class="mt-6 pt-6 border-t border-gray-200 space-y-4">
                  <app-selector
                    label="Plataforma de contabilidad"
                    [options]="accountingPlatformOptions"
                    formControlName="accounting_platform"
                    placeholder="Seleccionar plataforma"
                  ></app-selector>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <app-input
                      label="API Key"
                      type="password"
                      placeholder="Ingresa tu API key"
                      formControlName="accounting_api_key"
                    ></app-input>

                    <app-input
                      label="URL de webhook"
                      type="url"
                      placeholder="https://..."
                      formControlName="accounting_webhook_url"
                    ></app-input>
                  </div>
                </div>
              }
            </app-card>

            <!-- E-commerce Integration -->
            <app-card [responsivePadding]="true">
              <div class="flex items-start justify-between">
                <div class="flex items-start gap-4">
                  <div class="p-3 bg-green-100 rounded-lg">
                    <app-icon name="shopping-bag" size="24" class="text-green-600"></app-icon>
                  </div>
                  <div>
                    <h3 class="text-lg font-semibold">E-commerce</h3>
                    <p class="text-gray-600 text-sm mt-1">
                      Sincronización con plataformas de comercio electrónico
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                  [class.bg-primary]="ecommerceEnabled()"
                  [class.bg-gray-300]="!ecommerceEnabled()"
                  (click)="ecommerceEnabled.set(!ecommerceEnabled())"
                >
                  <span
                    class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                    [class.translate-x-6]="ecommerceEnabled()"
                    [class.translate-x-1]="!ecommerceEnabled()"
                  ></span>
                </button>
              </div>

              @if (ecommerceEnabled()) {
                <div class="mt-6 pt-6 border-t border-gray-200 space-y-4">
                  <app-selector
                    label="Plataforma e-commerce"
                    [options]="ecommercePlatformOptions"
                    formControlName="ecommerce_platform"
                    placeholder="Seleccionar plataforma"
                  ></app-selector>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <app-input
                      label="Store URL"
                      type="url"
                      placeholder="https://mitienda.com"
                      formControlName="ecommerce_store_url"
                    ></app-input>

                    <app-input
                      label="API Key"
                      type="password"
                      placeholder="Ingresa tu API key"
                      formControlName="ecommerce_api_key"
                    ></app-input>
                  </div>

                  <div class="flex items-center gap-3">
                    <button
                      type="button"
                      class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                      [class.bg-primary]="ecommerceSyncInventory()"
                      [class.bg-gray-300]="!ecommerceSyncInventory()"
                      (click)="ecommerceSyncInventory.set(!ecommerceSyncInventory())"
                    >
                      <span
                        class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                        [class.translate-x-6]="ecommerceSyncInventory()"
                        [class.translate-x-1]="!ecommerceSyncInventory()"
                      ></span>
                    </button>
                    <div>
                      <span class="font-medium">Sincronizar inventario automáticamente</span>
                      <p class="text-gray-500 text-xs">El stock se actualiza en tiempo real</p>
                    </div>
                  </div>
                </div>
              }
            </app-card>

            <!-- CRM Integration -->
            <app-card [responsivePadding]="true">
              <div class="flex items-start justify-between">
                <div class="flex items-start gap-4">
                  <div class="p-3 bg-purple-100 rounded-lg">
                    <app-icon name="users" size="24" class="text-purple-600"></app-icon>
                  </div>
                  <div>
                    <h3 class="text-lg font-semibold">CRM</h3>
                    <p class="text-gray-600 text-sm mt-1">
                      Gestión de relaciones con clientes
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                  [class.bg-primary]="crmEnabled()"
                  [class.bg-gray-300]="!crmEnabled()"
                  (click)="crmEnabled.set(!crmEnabled())"
                >
                  <span
                    class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                    [class.translate-x-6]="crmEnabled()"
                    [class.translate-x-1]="!crmEnabled()"
                  ></span>
                </button>
              </div>

              @if (crmEnabled()) {
                <div class="mt-6 pt-6 border-t border-gray-200 space-y-4">
                  <app-selector
                    label="Plataforma CRM"
                    [options]="crmPlatformOptions"
                    formControlName="crm_platform"
                    placeholder="Seleccionar plataforma"
                  ></app-selector>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <app-input
                      label="API Key"
                      type="password"
                      placeholder="Ingresa tu API key"
                      formControlName="crm_api_key"
                    ></app-input>

                    <app-input
                      label="Webhook URL"
                      type="url"
                      placeholder="https://..."
                      formControlName="crm_webhook_url"
                    ></app-input>
                  </div>
                </div>
              }
            </app-card>

            <!-- Save Button -->
            <div class="flex justify-end">
              <app-button
                variant="primary"
                [loading]="saving()"
                [disabled]="form.pristine"
                (clicked)="onSave()"
              >
                Guardar integraciones
              </app-button>
            </div>
          </div>
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
export class IntegrationsComponent {
  private settingsService = inject(OrganizationSettingsService);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly accountingEnabled = signal(false);
  readonly ecommerceEnabled = signal(false);
  readonly crmEnabled = signal(false);
  readonly ecommerceSyncInventory = signal(false);

  form = new FormGroup({
    accounting_platform: new FormControl('', { nonNullable: true }),
    accounting_api_key: new FormControl('', { nonNullable: true }),
    accounting_webhook_url: new FormControl('', { nonNullable: true }),
    ecommerce_platform: new FormControl('', { nonNullable: true }),
    ecommerce_store_url: new FormControl('', { nonNullable: true }),
    ecommerce_api_key: new FormControl('', { nonNullable: true }),
    crm_platform: new FormControl('', { nonNullable: true }),
    crm_api_key: new FormControl('', { nonNullable: true }),
    crm_webhook_url: new FormControl('', { nonNullable: true }),
  });

  readonly accountingPlatformOptions: SelectorOption[] = [
    { value: 'none', label: 'Ninguna' },
    { value: 'helisa', label: 'Helisa' },
    { value: 'siigo', label: 'SIIGO' },
    { value: 'sap', label: 'SAP' },
    { value: 'otro', label: 'Otro' },
  ];

  readonly ecommercePlatformOptions: SelectorOption[] = [
    { value: 'none', label: 'Ninguna' },
    { value: 'woocommerce', label: 'WooCommerce' },
    { value: 'shopify', label: 'Shopify' },
    { value: 'magento', label: 'Magento' },
    { value: 'prestashop', label: 'PrestaShop' },
    { value: 'custom', label: 'Tienda personalizada' },
  ];

  readonly crmPlatformOptions: SelectorOption[] = [
    { value: 'none', label: 'Ninguna' },
    { value: 'hubspot', label: 'HubSpot' },
    { value: 'salesforce', label: 'Salesforce' },
    { value: 'zoho', label: 'Zoho CRM' },
    { value: 'pipedrive', label: 'Pipedrive' },
    { value: 'custom', label: 'CRM personalizado' },
  ];

  constructor() {
    this.settingsService.getSettings().pipe(takeUntilDestroyed()).subscribe((settings) => {
      this.loading.set(this.settingsService.loading());
      this.saving.set(this.settingsService.saving());
      this.error.set(this.settingsService.error());

      if (settings) {
        const integrations = (settings as any).integrations || {};
        this.accountingEnabled.set(!!integrations.accounting?.enabled);
        this.ecommerceEnabled.set(!!integrations.ecommerce?.enabled);
        this.crmEnabled.set(!!integrations.crm?.enabled);
        this.ecommerceSyncInventory.set(!!integrations.ecommerce?.sync_inventory);
        this.form.patchValue(
          {
            accounting_platform: integrations.accounting?.platform || '',
            accounting_api_key: integrations.accounting?.api_key || '',
            accounting_webhook_url: integrations.accounting?.webhook_url || '',
            ecommerce_platform: integrations.ecommerce?.platform || '',
            ecommerce_store_url: integrations.ecommerce?.store_url || '',
            ecommerce_api_key: integrations.ecommerce?.api_key || '',
            crm_platform: integrations.crm?.platform || '',
            crm_api_key: integrations.crm?.api_key || '',
            crm_webhook_url: integrations.crm?.webhook_url || '',
          },
          { emitEvent: false },
        );
        this.form.markAsPristine();
      }
    });
  }

  onSave(): void {
    if (this.form.pristine || this.saving()) return;

    const v = this.form.value;
    const integrations = {
      accounting: {
        enabled: this.accountingEnabled(),
        platform: v.accounting_platform,
        api_key: v.accounting_api_key,
        webhook_url: v.accounting_webhook_url,
      },
      ecommerce: {
        enabled: this.ecommerceEnabled(),
        platform: v.ecommerce_platform,
        store_url: v.ecommerce_store_url,
        api_key: v.ecommerce_api_key,
        sync_inventory: this.ecommerceSyncInventory(),
      },
      crm: {
        enabled: this.crmEnabled(),
        platform: v.crm_platform,
        api_key: v.crm_api_key,
        webhook_url: v.crm_webhook_url,
      },
    };

    this.settingsService.saveSettings({ integrations } as any).subscribe({
      next: () => this.form.markAsPristine(),
      error: () => {},
    });
  }

  dismissError(): void {
    this.error.set(null);
  }
}