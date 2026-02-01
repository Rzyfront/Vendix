import {
  Component,
  Input,
  Output,
  EventEmitter,
  inject,
  OnInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import { StoreSettings, ApiResponse } from '../../../../../../core/models/store-settings.interface';

// Interface for settings saved event
export interface SettingsSavedEvent {
  storeName?: string;
}

// Import form components from store settings general module
import { GeneralSettingsForm } from '../../../../../../private/modules/store/settings/general/components/general-settings-form/general-settings-form.component';
import { AppSettingsForm } from '../../../../../../private/modules/store/settings/general/components/app-settings-form/app-settings-form.component';
import { InventorySettingsForm } from '../../../../../../private/modules/store/settings/general/components/inventory-settings-form/inventory-settings-form.component';
import { NotificationsSettingsForm } from '../../../../../../private/modules/store/settings/general/components/notifications-settings-form/notifications-settings-form.component';
import { PosSettingsForm } from '../../../../../../private/modules/store/settings/general/components/pos-settings-form/pos-settings-form.component';
import { ReceiptsSettingsForm } from '../../../../../../private/modules/store/settings/general/components/receipts-settings-form/receipts-settings-form.component';

// Import shared components
import {
  ButtonComponent,
  ModalComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';

// Import service
import { OrganizationStoreSettingsService } from '../../services/organization-store-settings.service';

@Component({
  selector: 'app-store-configuration-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    GeneralSettingsForm,
    AppSettingsForm,
    InventorySettingsForm,
    NotificationsSettingsForm,
    PosSettingsForm,
    ReceiptsSettingsForm,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="onOpenChange($event)"
      (cancel)="onCancel()"
      [size]="'xl'"
      title="Configuración de Tienda"
      [subtitle]="storeName"
    >
      <!-- Status Header -->
      <div class="flex items-center justify-between mb-6 pb-4 border-b border-border">
        <div class="flex items-center gap-3">
          @if (hasUnsavedChanges) {
            <span class="px-3 py-1.5 bg-orange-100 text-orange-700 text-xs font-bold uppercase rounded-lg animate-pulse flex items-center gap-2">
              <app-icon name="alert-circle" size="14"></app-icon>
              Pendiente de Guardar
            </span>
          } @else {
            <span class="px-3 py-1.5 bg-green-100 text-green-700 text-xs font-bold uppercase rounded-lg flex items-center gap-2">
              <app-icon name="check-circle" size="14"></app-icon>
              Sincronizado
            </span>
          }
          @if (lastSaved) {
            <span class="text-xs text-text-secondary italic">
              Último guardado: {{ lastSaved | date: 'HH:mm:ss' }}
            </span>
          }
        </div>

        <div class="flex items-center gap-2">
          <app-button
            variant="outline-danger"
            size="sm"
            (clicked)="resetToDefaults()"
            [disabled]="isLoading || isSaving"
          >
            <app-icon name="rotate-ccw" size="16" class="mr-2"></app-icon>
            Restablecer
          </app-button>
        </div>
      </div>

      @if (isLoading) {
        <!-- Loading State -->
        <div class="text-center py-16">
          <div class="inline-block animate-spin rounded-full h-12 w-12 border-4 border-primary/20 border-t-primary mb-4"></div>
          <p class="text-text-secondary font-medium">Cargando configuración...</p>
        </div>
      } @else {
        <!-- Tabs Navigation -->
        <div class="mb-6">
          <nav class="flex gap-2 bg-surface rounded-xl p-1.5 border border-border" role="tablist">
            <button
              *ngFor="let tab of tabs"
              (click)="switchTab(tab.id)"
              [class]="
                activeTabId === tab.id
                  ? 'bg-[var(--color-primary)] text-white shadow-sm'
                  : 'text-text-secondary hover:text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10'
              "
              class="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 min-w-[120px] justify-center"
              [attr.aria-selected]="activeTabId === tab.id"
              role="tab"
            >
              <app-icon [name]="tab.icon" color="currentColor" size="16"></app-icon>
              <span>{{ tab.label }}</span>
            </button>
          </nav>
        </div>

        <!-- Tab Content -->
        <div class="min-h-[500px] max-h-[75vh] overflow-y-auto pr-2">
          @switch (activeTabId) {
            @case ('general') {
              <div class="animate-fade-in">
                <div class="bg-surface rounded-xl border border-border p-6">
                  <h3 class="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                    <div class="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                      <app-icon name="settings" size="18" class="text-blue-600"></app-icon>
                    </div>
                    Configuración General
                  </h3>
                  <app-general-settings-form
                    [settings]="settings.general"
                    (settingsChange)="onSectionChange('general', $event)"
                  />
                </div>
              </div>
            }

            @case ('branding') {
              <div class="animate-fade-in">
                <div class="bg-surface rounded-xl border border-border p-6">
                  <h3 class="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                    <div class="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
                      <app-icon name="palette" size="18" class="text-purple-600"></app-icon>
                    </div>
                    Identidad y Marca
                  </h3>
                  <app-app-settings-form
                    [settings]="settings.app"
                    (settingsChange)="onSectionChange('app', $event)"
                  />
                </div>
              </div>
            }

            @case ('inventory') {
              <div class="animate-fade-in">
                <div class="bg-surface rounded-xl border border-border p-6">
                  <h3 class="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                    <div class="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                      <app-icon name="package" size="18" class="text-green-600"></app-icon>
                    </div>
                    Gestión de Inventario
                  </h3>
                  <app-inventory-settings-form
                    [settings]="settings.inventory"
                    (settingsChange)="onSectionChange('inventory', $event)"
                  />
                </div>
              </div>
            }

            @case ('notifications') {
              <div class="animate-fade-in">
                <div class="bg-surface rounded-xl border border-border p-6">
                  <h3 class="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                    <div class="w-8 h-8 rounded-lg bg-yellow-50 flex items-center justify-center">
                      <app-icon name="bell" size="18" class="text-yellow-600"></app-icon>
                    </div>
                    Configuración de Notificaciones
                  </h3>
                  <app-notifications-settings-form
                    [settings]="settings.notifications"
                    (settingsChange)="onSectionChange('notifications', $event)"
                  />
                </div>
              </div>
            }

            @case ('pos') {
              <div class="animate-fade-in">
                <div class="bg-surface rounded-xl border border-border p-6">
                  <h3 class="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                    <div class="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
                      <app-icon name="monitor" size="18" class="text-orange-600"></app-icon>
                    </div>
                    Punto de Venta (POS)
                  </h3>
                  <app-pos-settings-form
                    [settings]="settings.pos"
                    (settingsChange)="onSectionChange('pos', $event)"
                  />
                </div>
              </div>
            }

            @case ('receipts') {
              <div class="animate-fade-in">
                <div class="bg-surface rounded-xl border border-border p-6">
                  <h3 class="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                    <div class="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                      <app-icon name="file-text" size="18" class="text-indigo-600"></app-icon>
                    </div>
                    Recibos y Facturación
                  </h3>
                  <app-receipts-settings-form
                    [settings]="settings.receipts"
                    (settingsChange)="onSectionChange('receipts', $event)"
                  />
                </div>
              </div>
            }
          }
        </div>
      }

      <!-- Footer with actions -->
      <div slot="footer" class="flex justify-between items-center pt-4 border-t border-border">
        <div class="text-sm text-text-secondary">
          @if (hasUnsavedChanges) {
            <span>Tienes cambios sin guardar</span>
          } @else {
            <span>Todos los cambios están guardados</span>
          }
        </div>

        <div class="flex justify-end gap-3">
          <app-button
            (clicked)="onCancel()"
            variant="outline"
            [disabled]="isSaving"
          >
            Cancelar
          </app-button>
          <app-button
            (clicked)="saveAllSettings()"
            [disabled]="!hasUnsavedChanges || isLoading"
            [loading]="isSaving"
            variant="primary"
          >
            <app-icon name="save" size="16" class="mr-2"></app-icon>
            Guardar Cambios
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .animate-fade-in {
        animation: fadeIn 0.2s ease-in-out;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      /* Custom scrollbar for tab content */
      .min-h-\\[500px\\] {
        scrollbar-width: thin;
        scrollbar-color: rgb(203 213 225) transparent;
      }

      .min-h-\\[500px\\]::-webkit-scrollbar {
        width: 6px;
      }

      .min-h-\\[500px\\]::-webkit-scrollbar-track {
        background: transparent;
      }

      .min-h-\\[500px\\]::-webkit-scrollbar-thumb {
        background-color: rgb(203 213 225);
        border-radius: 3px;
      }

      .min-h-\\[500px\\]::-webkit-scrollbar-thumb:hover {
        background-color: rgb(148 163 184);
      }
    `,
  ],
})
export class StoreConfigurationModalComponent implements OnInit, OnDestroy, OnChanges {
  @Input() isOpen: boolean = false;
  @Input() storeId: number | null = null;
  @Input() storeName: string = '';
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() settingsSaved = new EventEmitter<SettingsSavedEvent>();

  private settings_service = inject(OrganizationStoreSettingsService);
  private toast_service = inject(ToastService);
  private dialog_service = inject(DialogService);
  private cdr = inject(ChangeDetectorRef);

  // Estado principal
  settings: StoreSettings = {} as StoreSettings;
  isLoading = false;
  isSaving = false;
  hasUnsavedChanges = false;
  lastSaved: Date | null = null;

  // Tabs del modal
  activeTabId: string = 'general';
  tabs = [
    { id: 'general', label: 'General', icon: 'settings' },
    { id: 'branding', label: 'Identidad', icon: 'palette' },
    { id: 'inventory', label: 'Inventario', icon: 'package' },
    { id: 'notifications', label: 'Notificaciones', icon: 'bell' },
    { id: 'pos', label: 'Punto de Venta', icon: 'monitor' },
    { id: 'receipts', label: 'Recibos', icon: 'file-text' },
  ];

  private destroy$$ = new Subject<void>();

  // Default settings for fallback
  private defaultSettings: StoreSettings = {
    general: {
      timezone: 'America/Bogota',
      currency: 'COP',
      language: 'es',
      tax_included: false,
    },
    inventory: {
      low_stock_threshold: 10,
      out_of_stock_action: 'hide',
      track_inventory: true,
      allow_negative_stock: false,
    },
    checkout: {
      require_customer_data: false,
      allow_guest_checkout: true,
      allow_partial_payments: false,
      require_payment_confirmation: false,
    },
    notifications: {
      email_enabled: true,
      sms_enabled: false,
      low_stock_alerts: true,
      new_order_alerts: true,
      low_stock_alerts_email: null,
      new_order_alerts_email: null,
      low_stock_alerts_phone: null,
      new_order_alerts_phone: null,
    },
    pos: {
      allow_anonymous_sales: false,
      anonymous_sales_as_default: false,
      business_hours: {
        monday: { open: '09:00', close: '19:00' },
        tuesday: { open: '09:00', close: '19:00' },
        wednesday: { open: '09:00', close: '19:00' },
        thursday: { open: '09:00', close: '19:00' },
        friday: { open: '09:00', close: '19:00' },
        saturday: { open: '09:00', close: '14:00' },
        sunday: { open: 'closed', close: 'closed' },
      },
      offline_mode_enabled: false,
      require_cash_drawer_open: false,
      auto_print_receipt: true,
      allow_price_edit: true,
      allow_discount: true,
      max_discount_percentage: 15,
      allow_refund_without_approval: false,
    },
    receipts: {
      print_receipt: true,
      email_receipt: true,
      receipt_header: '',
      receipt_footer: '',
    },
    app: {
      name: 'Mi Tienda',
      primary_color: '#7ED7A5',
      secondary_color: '#2F6F4E',
      accent_color: '#FFFFFF',
      logo_url: null,
      favicon_url: null,
      theme: 'default' as const,
    },
  };

  ngOnInit(): void {
    if (this.isOpen && this.storeId) {
      this.loadSettings();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && changes['isOpen'].currentValue && this.storeId) {
      this.loadSettings();
    }
  }

  loadSettings(): void {
    if (!this.storeId) return;

    this.isLoading = true;
    this.settings_service.getStoreSettings(this.storeId).pipe(
      takeUntil(this.destroy$$)
    ).subscribe({
      next: (response: ApiResponse<StoreSettings>) => {
        if (response.data) {
          this.settings = { ...this.defaultSettings, ...response.data };
        } else {
          this.settings = { ...this.defaultSettings };
        }
        this.isLoading = false;
        this.hasUnsavedChanges = false;
      },
      error: (error: any) => {
        console.error('Error loading settings:', error);
        this.toast_service.error('Error cargando configuración');
        this.settings = { ...this.defaultSettings };
        this.isLoading = false;
      },
    });
  }

  onSectionChange(section: keyof StoreSettings, newSettings: any): void {
    // Create a new object reference for the settings to ensure Angular detects the change
    // This is critical for proper change detection when switching between tabs
    this.settings = {
      ...this.settings,
      [section]: { ...newSettings }, // Create new reference for nested object
    };
    this.hasUnsavedChanges = true;
    this.lastSaved = null;

    // Manually trigger change detection to ensure child components receive updated settings
    this.cdr.markForCheck();
  }

  switchTab(tabId: string): void {
    this.activeTabId = tabId;
  }

  async saveAllSettings(): Promise<void> {
    if (!this.storeId) return;

    this.isSaving = true;
    this.settings_service.saveSettingsNow(this.storeId, this.settings).pipe(
      takeUntil(this.destroy$$)
    ).subscribe({
      next: (response: ApiResponse<StoreSettings>) => {
        // Merge the response with current local settings to preserve all changes
        // This ensures we don't lose any local modifications
        if (response.data) {
          this.settings = this.mergeSettings(this.settings, response.data);
          // Update the store name from settings.app.name
          if (response.data.app?.name) {
            this.storeName = response.data.app.name;
          }
        }
        this.isSaving = false;
        this.hasUnsavedChanges = false;
        this.lastSaved = new Date();
        this.toast_service.success('Configuración guardada correctamente');
        // Emit the updated store name so the parent can update its list
        this.settingsSaved.emit({ storeName: this.storeName });
      },
      error: (error: any) => {
        console.error('Error saving settings:', error);
        this.toast_service.error('Error guardando configuración');
        this.isSaving = false;
      },
    });
  }

  /**
   * Merge server response with local settings to preserve all local changes
   * Local settings take precedence over server response
   */
  private mergeSettings(
    local: StoreSettings,
    server: StoreSettings,
  ): StoreSettings {
    const merged: StoreSettings = { ...local };

    // For each section, deeply merge server data with local data
    // Local data takes precedence to preserve user's uncommitted changes
    if (server.general) {
      merged.general = { ...server.general, ...local.general };
    }
    if (server.inventory) {
      merged.inventory = { ...server.inventory, ...local.inventory };
    }
    if (server.notifications) {
      merged.notifications = { ...server.notifications, ...local.notifications };
    }
    if (server.pos) {
      merged.pos = { ...server.pos, ...local.pos };
    }
    if (server.receipts) {
      merged.receipts = { ...server.receipts, ...local.receipts };
    }
    if (server.app) {
      merged.app = { ...server.app, ...local.app };
    }
    if (server.checkout) {
      merged.checkout = { ...server.checkout, ...local.checkout };
    }

    return merged;
  }

  async resetToDefaults(): Promise<void> {
    if (!this.storeId) return;

    const confirmed = await this.dialog_service.confirm(
      {
        title: 'Restablecer Configuración',
        message: '¿Estás seguro de restablecer todas las configuraciones a valores por defecto? Esta acción no se puede deshacer.',
        confirmText: 'Restablecer',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      },
      { size: 'md' },
    );

    if (confirmed) {
      this.isLoading = true;
      this.settings_service.resetToDefault(this.storeId).pipe(
        takeUntil(this.destroy$$)
      ).subscribe({
        next: (response: ApiResponse<StoreSettings>) => {
          if (response.data) {
            // For reset, we replace entirely since user wants defaults
            this.settings = response.data;
            // Update the store name from settings.app.name
            if (response.data.app?.name) {
              this.storeName = response.data.app.name;
            }
          }
          this.isLoading = false;
          this.hasUnsavedChanges = false;
          this.lastSaved = new Date();
          this.toast_service.success('Configuración restablecida a valores por defecto');
        },
        error: (error: any) => {
          console.error('Error resetting settings:', error);
          this.toast_service.error('Error restableciendo configuración');
          this.isLoading = false;
        },
      });
    }
  }

  async onOpenChange(isOpen: boolean): Promise<void> {
    // If opening, allow it
    if (isOpen) {
      this.isOpenChange.emit(isOpen);
      return;
    }

    // If closing and no unsaved changes, allow it
    if (!isOpen && !this.hasUnsavedChanges) {
      this.isOpenChange.emit(isOpen);
      // Reset state when closing
      this.activeTabId = 'general';
      this.hasUnsavedChanges = false;
      this.lastSaved = null;
      return;
    }

    // If closing with unsaved changes, confirm first
    if (!isOpen && this.hasUnsavedChanges) {
      const confirmed = await this.dialog_service.confirm(
        {
          title: 'Cambios Sin Guardar',
          message: 'Tienes cambios sin guardar. ¿Estás seguro de que deseas cerrar sin guardar?',
          confirmText: 'Cerrar sin guardar',
          cancelText: 'Seguir editando',
          confirmVariant: 'danger',
        },
        { size: 'md' },
      );

      if (confirmed) {
        // User confirmed to close without saving
        this.isOpenChange.emit(false);
        this.activeTabId = 'general';
        this.hasUnsavedChanges = false;
        this.lastSaved = null;
      }
      // If not confirmed, do nothing - modal stays open
    }
  }

  async onCancel(): Promise<void> {
    // Check for unsaved changes before closing
    if (this.hasUnsavedChanges) {
      const confirmed = await this.dialog_service.confirm(
        {
          title: 'Cambios Sin Guardar',
          message: 'Tienes cambios sin guardar. ¿Estás seguro de que deseas cerrar sin guardar?',
          confirmText: 'Cerrar sin guardar',
          cancelText: 'Seguir editando',
          confirmVariant: 'danger',
        },
        { size: 'md' },
      );

      if (!confirmed) {
        return;
      }
    }

    this.isOpenChange.emit(false);
    this.activeTabId = 'general';
    this.hasUnsavedChanges = false;
    this.lastSaved = null;
  }

  ngOnDestroy(): void {
    this.destroy$$.next();
    this.destroy$$.complete();
  }
}
