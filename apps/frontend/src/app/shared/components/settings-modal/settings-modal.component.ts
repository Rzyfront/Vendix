import { Component, EventEmitter, inject, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ModalComponent } from '../modal/modal.component';
import { AuthService } from '../../../core/services/auth.service';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { finalize } from 'rxjs';
import { ButtonComponent } from '../button/button.component';
import { ToggleComponent } from '../toggle/toggle.component';
import { IconComponent } from '../icon/icon.component';

// Constant: Configuration of modules per app type
const APP_MODULES = {
  ORG_ADMIN: [
    { key: 'stores', label: 'Tiendas', description: 'Gestionar tiendas de la organización' },
    { key: 'users', label: 'Usuarios', description: 'Gestionar usuarios y permisos' },
    { key: 'dashboard', label: 'Dashboard', description: 'Vista general de la organización' },
    { key: 'orders', label: 'Órdenes', description: 'Gestionar órdenes de todas las tiendas' },
    { key: 'analytics', label: 'Analíticas', description: 'Métricas y estadísticas' },
    { key: 'reports', label: 'Reportes', description: 'Reportes detallados por tienda' },
    { key: 'inventory', label: 'Inventario', description: 'Gestión de inventario consolidado' },
    { key: 'billing', label: 'Facturación', description: 'Facturas y pagos' },
    { key: 'ecommerce', label: 'E-commerce', description: 'Ventas online consolidadas' },
    { key: 'audit', label: 'Auditoría', description: 'Logs de auditoría del sistema' },
    { key: 'settings', label: 'Configuración', description: 'Ajustes de la organización' }
  ],
  STORE_ADMIN: [
    { key: 'pos', label: 'Punto de Venta', description: 'Ventas en tienda física' },
    { key: 'users', label: 'Usuarios', description: 'Gestionar personal de la tienda' },
    { key: 'dashboard', label: 'Dashboard', description: 'Vista general de la tienda' },
    { key: 'analytics', label: 'Analíticas', description: 'Métricas de ventas de la tienda' },
    { key: 'reports', label: 'Reportes', description: 'Reportes de operación de tienda' },
    { key: 'billing', label: 'Facturación', description: 'Facturas y pagos de la tienda' },
    { key: 'ecommerce', label: 'E-commerce', description: 'Ventas online de la tienda' },
    { key: 'settings', label: 'Configuración', description: 'Ajustes de la tienda' }
  ]
};

@Component({
    selector: 'app-settings-modal',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, ModalComponent, ButtonComponent, ToggleComponent, IconComponent],
    template: `
    <app-modal
      [(isOpen)]="isOpen"
      [title]="'Configuración de Usuario'"
      [subtitle]="'Personaliza tu experiencia en la plataforma'"
      [size]="'lg'"
      (closed)="onClose()"
      (opened)="onOpen()"
    >
      <form [formGroup]="settingsForm" (ngSubmit)="onSubmit()" class="space-y-6" *ngIf="!loading; else loadingTemplate">
        <!-- Section 1: App Type Selection -->
        <div class="app-type-section">
          <h4 class="text-lg font-medium text-gray-900 mb-4">Tipo de Aplicación</h4>
          <div class="app-type-selection" [class.read-only]="!canChangeAppType">
            <div
              class="app-type-card"
              [class.selected]="currentAppType === 'ORG_ADMIN'"
              [class.read-only]="!canChangeAppType"
              (click)="selectAppType('ORG_ADMIN')">
              <app-icon name="building" [size]="32"></app-icon>
              <div class="card-content">
                <h3>Administración de Organización</h3>
                <p>Gestión completa de múltiples tiendas</p>
              </div>
              <div class="badge" *ngIf="currentAppType === 'ORG_ADMIN'">✓ Actual</div>
            </div>

            <div
              class="app-type-card"
              [class.selected]="currentAppType === 'STORE_ADMIN'"
              [class.read-only]="!canChangeAppType"
              (click)="selectAppType('STORE_ADMIN')">
              <app-icon name="store" [size]="32"></app-icon>
              <div class="card-content">
                <h3>Administración de Tienda</h3>
                <p>Gestión de operaciones de una tienda</p>
              </div>
              <div class="badge" *ngIf="currentAppType === 'STORE_ADMIN'">✓ Actual</div>
            </div>
          </div>
          <div class="read-only-badge" *ngIf="!canChangeAppType">
            <app-icon name="lock" [size]="16"></app-icon>
            Solo administradores pueden cambiar el tipo de aplicación
          </div>
        </div>

        <!-- Section 2: Panel UI Configuration -->
        <div class="panel-ui-config">
          <h4 class="text-lg font-medium text-gray-900 mb-4">
            Módulos del Panel para {{ getAppTypeLabel(currentAppType) }}
          </h4>

          <div formGroupName="panel_ui">
            <div [formGroupName]="currentAppType">
              <div class="toggles-grid">
                <div class="toggle-item" *ngFor="let module of getModulesForAppType(currentAppType)">
                  <div class="toggle-header">
                    <app-toggle
                      [formControlName]="module.key"
                      [label]="module.label">
                    </app-toggle>
                  </div>
                  <span class="module-description">{{ module.description }}</span>
                </div>
              </div>
            </div>
          </div>

          <div *ngIf="hasModuleError()" class="text-sm text-red-500 mt-2">
            Debes habilitar al menos un módulo
          </div>
        </div>

        <!-- Section 3: Preferences -->
        <div formGroupName="preferences" class="preferences-section">
          <h4 class="text-lg font-medium text-gray-900 mb-4">Preferencias</h4>

          <!-- Language (disabled) -->
          <div class="preference-row">
            <label>Idioma</label>
            <select formControlName="language" [disabled]="true" class="disabled-select">
              <option value="es">Español</option>
            </select>
            <small class="text-gray-500">Español es el único idioma disponible actualmente</small>
          </div>

          <!-- Theme -->
          <div class="preference-row">
            <label>Tema de la aplicación</label>
            <div class="theme-selector">
              <div
                class="theme-option"
                [class.selected]="settingsForm.get('preferences.theme')?.value === 'default'"
                (click)="selectTheme('default')">
                <app-icon name="circle" [size]="32"></app-icon>
                <div class="theme-info">
                  <span class="theme-name">Default</span>
                  <span class="theme-description">Tema por defecto del sistema</span>
                </div>
              </div>
              <div
                class="theme-option"
                [class.selected]="settingsForm.get('preferences.theme')?.value === 'aura'"
                (click)="selectTheme('aura')">
                <app-icon name="sparkles" [size]="32"></app-icon>
                <div class="theme-info">
                  <span class="theme-name">Aura</span>
                  <span class="theme-description">Estilo alternativo</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>

      <ng-template #loadingTemplate>
        <div class="flex items-center justify-center py-12">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary)]"></div>
        </div>
      </ng-template>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="secondary"
          (click)="isOpen = false"
          label="Cancelar"
        ></app-button>
        <app-button
          variant="primary"
          (click)="onSubmit()"
          [loading]="saving"
          [disabled]="settingsForm.invalid"
          label="Guardar Cambios"
        ></app-button>
      </div>
    </app-modal>
  `,
  styleUrls: ['./settings-modal.component.scss']
})
export class SettingsModalComponent implements OnInit {
    @Input() isOpen = false;
    @Output() isOpenChange = new EventEmitter<boolean>();

    private fb = inject(FormBuilder);
    private authService = inject(AuthService);
    private authFacade = inject(AuthFacade);

    settingsForm: FormGroup;
    loading = false;
    saving = false;
    currentSettings: any = null;
    currentAppType: string = 'ORG_ADMIN';
    canChangeAppType: boolean = false;

    constructor() {
        // Initialize panel_ui controls for ORG_ADMIN
        const orgAdminControls: any = {};
        APP_MODULES.ORG_ADMIN.forEach(module => {
            orgAdminControls[module.key] = [true]; // Default to true
        });

        // Initialize panel_ui controls for STORE_ADMIN
        const storeAdminControls: any = {};
        APP_MODULES.STORE_ADMIN.forEach(module => {
            storeAdminControls[module.key] = [true]; // Default to true
        });

        this.settingsForm = this.fb.group({
            app: ['ORG_ADMIN', Validators.required],
            panel_ui: this.fb.group({
                ORG_ADMIN: this.fb.group(orgAdminControls),
                STORE_ADMIN: this.fb.group(storeAdminControls)
            }),
            preferences: this.fb.group({
                language: ['es'],
                theme: ['default']
            })
        });

        // Check permissions synchronously
        this.checkPermissions();
    }

    ngOnInit() { }

    onOpen() {
        this.loadSettings();
    }

    onClose() {
        this.closeModal();
    }

    closeModal() {
        this.isOpen = false;
        this.isOpenChange.emit(false);
        this.settingsForm.reset();
    }

    checkPermissions() {
        // Use synchronous methods from AuthFacade
        this.canChangeAppType = this.authFacade.isOwner() || this.authFacade.isAdmin();
    }

    loadSettings() {
        this.loading = true;
        this.authService.getSettings()
            .pipe(finalize(() => this.loading = false))
            .subscribe({
                next: (response) => {
                    const settings = response.data || response;
                    this.currentSettings = settings;
                    this.currentAppType = settings.config?.app || 'ORG_ADMIN';

                    console.log('🔍 Settings loaded:', settings);
                    console.log('🔍 Config:', settings.config);
                    console.log('🔍 Panel UI:', settings.config?.panel_ui);

                    this.initializeForm(settings.config || {});
                },
                error: (err) => {
                    console.error('Error loading settings', err);
                    // Initialize with defaults even on error
                    this.currentAppType = 'ORG_ADMIN';
                    this.initializeForm({});
                }
            });
    }

    initializeForm(config: any) {
        console.log('🔧 Updating form with config:', config);

        // Build patch object efficiently
        const patchObj: any = {
            app: this.currentAppType,
            panel_ui: {
                ORG_ADMIN: {},
                STORE_ADMIN: {}
            },
            preferences: {
                language: 'es',
                theme: 'default'
            }
        };

        // Update ORG_ADMIN modules
        APP_MODULES.ORG_ADMIN.forEach(module => {
            const currentValue = config.panel_ui?.ORG_ADMIN?.[module.key] ??
                                config.panel_ui?.[module.key] ??
                                true;
            patchObj.panel_ui.ORG_ADMIN[module.key] = currentValue;
        });

        // Update STORE_ADMIN modules
        APP_MODULES.STORE_ADMIN.forEach(module => {
            const currentValue = config.panel_ui?.STORE_ADMIN?.[module.key] ??
                                config.panel_ui?.[module.key] ??
                                true;
            patchObj.panel_ui.STORE_ADMIN[module.key] = currentValue;
        });

        // Update preferences
        const prefs = config.preferences || { language: 'es', theme: 'default' };
        patchObj.preferences.language = prefs.language;
        patchObj.preferences.theme = prefs.theme || 'default';

        // Apply all patches at once
        this.settingsForm.patchValue(patchObj);

        console.log('✅ Form updated:', this.settingsForm.value);
    }

    getModulesForAppType(appType: string): any[] {
        return APP_MODULES[appType as keyof typeof APP_MODULES] || [];
    }

    getAppTypeLabel(appType: string): string {
        const labels: Record<string, string> = {
            'ORG_ADMIN': 'Organización',
            'STORE_ADMIN': 'Tienda'
        };
        return labels[appType] || appType;
    }

    selectAppType(appType: string) {
        if (!this.canChangeAppType) return;

        this.currentAppType = appType;
        this.settingsForm.patchValue({ app: appType });
    }

    selectTheme(theme: string) {
        this.settingsForm.patchValue({
            preferences: { theme }
        });
    }

    hasModuleError(): boolean {
        const panelUiGroup = this.settingsForm.get('panel_ui.' + this.currentAppType);
        if (!panelUiGroup) return false;

        const values = Object.values(panelUiGroup.value);
        const hasEnabled = values.some((v: any) => v === true);
        return !hasEnabled && panelUiGroup.touched;
    }

    onSubmit() {
        if (this.settingsForm.invalid) return;

        this.saving = true;
        const formValue = this.settingsForm.getRawValue();

        // 🔥 CRÍTICO: Preservar datos existentes con deep merge
        this.authService.getSettings().subscribe({
            next: (response) => {
                const currentConfig = response.data?.config || response.config || {};

                // Deep merge strategy
                const configObj = {
                    // Preservar TODOS los campos existentes
                    ...currentConfig,

                    // Actualizar solo campos que estamos editando
                    app: formValue.app,

                    // Merge panel_ui: preservar app types no editados
                    panel_ui: {
                        ...currentConfig.panel_ui,  // Preservar todos los app types existentes
                        [formValue.app]: formValue.panel_ui[formValue.app]  // Actualizar solo el actual
                    },

                    // Merge preferences: preservar preferencias existentes
                    preferences: {
                        ...currentConfig.preferences,  // Preservar otras preferencias
                        language: formValue.preferences.language,
                        theme: formValue.preferences.theme
                    }
                };

                const dto = { config: configObj };

                this.authService.updateSettings(dto)
                    .pipe(finalize(() => this.saving = false))
                    .subscribe({
                        next: () => {
                            this.isOpen = false;
                            this.isOpenChange.emit(false);
                        },
                        error: (err) => console.error('Error saving settings', err)
                    });
            },
            error: (err) => {
                console.error('Error loading current config for merge', err);
                this.saving = false;
            }
        });
    }
}
