import {
  Component,
  EventEmitter,
  inject,
  Input,
  OnInit,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ModalComponent } from '../modal/modal.component';
import { AuthService } from '../../../core/services/auth.service';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { finalize } from 'rxjs';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';
import { GlobalFacade } from '../../../core/store/global.facade';
import { EnvironmentContextService } from '../../../core/services/environment-context.service';
import { EnvironmentSwitchService } from '../../../core/services/environment-switch.service';
import { DialogService, ToastService } from '../index';
import { SettingToggleComponent } from '../setting-toggle/setting-toggle.component';
import { ThemeService } from '../../../core/services/theme.service';

// Constant: Configuration of modules per app type
const APP_MODULES = {
  ORG_ADMIN: [
    {
      key: 'dashboard',
      label: 'Panel Principal',
      description: 'Vista general de la organización',
    },
    {
      key: 'stores',
      label: 'Tiendas',
      description: 'Gestionar tiendas de la organización',
    },
    {
      key: 'users',
      label: 'Usuarios',
      description: 'Gestionar usuarios y permisos',
    },
    {
      key: 'domains',
      label: 'Dominios',
      description: 'Gestionar dominios de la organización',
    },
    {
      key: 'audit',
      label: 'Auditoría',
      description: 'Logs de auditoría del sistema',
    },
    {
      key: 'settings',
      label: 'Configuración',
      description: 'Ajustes de la organización',
    },
    {
      key: 'analytics',
      label: 'Analíticas',
      description: 'Métricas y estadísticas',
    },
    {
      key: 'reports',
      label: 'Reportes',
      description: 'Reportes detallados por tienda',
    },
    {
      key: 'inventory',
      label: 'Inventario',
      description: 'Gestión de inventario consolidado',
    },
    { key: 'billing', label: 'Facturación', description: 'Facturas y pagos' },
    {
      key: 'ecommerce',
      label: 'E-commerce',
      description: 'Ventas online consolidadas',
    },
    {
      key: 'orders',
      label: 'Órdenes',
      description: 'Gestionar órdenes de todas las tiendas',
    },
  ],
  STORE_ADMIN: [
    // Módulos principales (standalone - sin hijos)
    {
      key: 'dashboard',
      label: 'Panel Principal',
      description: 'Vista general de la tienda',
    },
    {
      key: 'pos',
      label: 'Punto de Venta',
      description: 'Ventas en tienda física',
    },
    {
      key: 'products',
      label: 'Productos',
      description: 'Gestionar catálogo de productos',
    },
    {
      key: 'ecommerce',
      label: 'E-commerce',
      description: 'Ventas online de la tienda',
    },

    // Órdenes (padre con hijos)
    {
      key: 'orders',
      label: 'Órdenes',
      description: 'Sección de órdenes',
      isParent: true,
      children: [
        {
          key: 'orders_sales',
          label: 'Órdenes de Venta',
          description: 'Órdenes de venta',
        },
        {
          key: 'orders_purchase_orders',
          label: 'Órdenes de Compra',
          description: 'Órdenes de compra a proveedores',
        },
      ],
    },

    // Inventario (padre con hijos)
    {
      key: 'inventory',
      label: 'Inventario',
      description: 'Sección de inventario',
      isParent: true,
      children: [
        {
          key: 'inventory_pop',
          label: 'Punto de Compra',
          description: 'Punto de compra a proveedores',
        },
        {
          key: 'inventory_adjustments',
          label: 'Ajustes de Stock',
          description: 'Ajustes manuales de inventario',
        },
        {
          key: 'inventory_locations',
          label: 'Ubicaciones',
          description: 'Ubicaciones de almacenamiento',
        },
        {
          key: 'inventory_suppliers',
          label: 'Proveedores',
          description: 'Directorio de proveedores',
        },
        {
          key: 'inventory_movements',
          label: 'Movimientos',
          description: 'Historial de movimientos de inventario',
        },
      ],
    },

    // Clientes (padre con hijos)
    {
      key: 'customers',
      label: 'Clientes',
      description: 'Sección de clientes',
      isParent: true,
      children: [
        {
          key: 'customers_all',
          label: 'Todos los Clientes',
          description: 'Directorio completo de clientes',
        },
        {
          key: 'customers_reviews',
          label: 'Reseñas',
          description: 'Reseñas de clientes',
        },
      ],
    },

    // Marketing (padre con hijos)
    {
      key: 'marketing',
      label: 'Marketing',
      description: 'Sección de marketing',
      isParent: true,
      children: [
        {
          key: 'marketing_promotions',
          label: 'Promociones',
          description: 'Promociones y descuentos',
        },
        {
          key: 'marketing_coupons',
          label: 'Cupones',
          description: 'Cupones de descuento',
        },
      ],
    },

    // Analíticas (padre con hijos)
    {
      key: 'analytics',
      label: 'Analíticas',
      description: 'Sección de analíticas',
      isParent: true,
      children: [
        {
          key: 'analytics_overview',
          label: 'Resumen',
          description: 'Resumen general de analíticas',
        },
        {
          key: 'analytics_sales',
          label: 'Ventas',
          description: 'Métricas de ventas',
        },
        {
          key: 'analytics_traffic',
          label: 'Tráfico',
          description: 'Análisis de tráfico web',
        },
        {
          key: 'analytics_performance',
          label: 'Rendimiento',
          description: 'KPIs de rendimiento',
        },
      ],
    },

    // Gastos
    {
      key: 'expenses',
      label: 'Gastos',
      description: 'Sección de gastos',
    },

    // Configuración (padre con hijos)
    {
      key: 'settings',
      label: 'Configuración',
      description: 'Sección de configuración',
      isParent: true,
      children: [
        {
          key: 'settings_general',
          label: 'General',
          description: 'Configuración general de la tienda',
        },
        {
          key: 'settings_payments',
          label: 'Métodos de Pago',
          description: 'Métodos de pago aceptados',
        },
        {
          key: 'settings_appearance',
          label: 'Apariencia',
          description: 'Personalización visual',
        },
        {
          key: 'settings_security',
          label: 'Seguridad',
          description: 'Configuración de seguridad',
        },
        {
          key: 'settings_domains',
          label: 'Dominios',
          description: 'Dominios de la tienda online',
        },
        {
          key: 'settings_shipping',
          label: 'Envíos',
          description: 'Configuración de envíos y zonas',
        },
        {
          key: 'settings_legal_documents',
          label: 'Documentos Legales',
          description: 'Gestionar términos, privacidad y documentos legales',
        },
      ],
    },
    // Ayuda (padre con hijos)
    {
      key: 'help',
      label: 'Ayuda',
      description: 'Sección de ayuda y soporte',
      isParent: true,
      children: [
        {
          key: 'help_support',
          label: 'Soporte',
          description: 'Acceso a la sección de soporte',
        },
        {
          key: 'help_center',
          label: 'Centro de Ayuda',
          description: 'Artículos y guías del centro de ayuda',
        },
      ],
    },
  ],
};

@Component({
  selector: 'app-settings-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    SettingToggleComponent,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      [title]="'Configuración de Usuario'"
      [subtitle]="'Personaliza tu experiencia en la plataforma'"
      [size]="'xl'"
      (closed)="onClose()"
      (opened)="onOpen()"
    >
      <form
        [formGroup]="settingsForm"
        (ngSubmit)="onSubmit()"
        class="settings-form"
        *ngIf="!loading; else loadingTemplate"
      >
        <!-- Top Section: App Type & Upgrade -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <!-- App Type Selection -->
          <div class="lg:col-span-8">
            <h4 class="section-header">
              <app-icon name="app-window" [size]="20"></app-icon>
              Tipo de Aplicación
            </h4>
            <div class="app-type-selection" [class.read-only]="!canChangeAppType">
              <div
                class="app-type-card"
                [class.selected]="currentAppType === 'ORG_ADMIN'"
                *ngIf="!isSingleStore"
                (click)="selectAppType('ORG_ADMIN')"
              >
                <app-icon name="building" [size]="24"></app-icon>
                <div class="card-content">
                  <h3>Organización</h3>
                  <p>Gestión multi-tienda</p>
                </div>
                <div class="status-badge" *ngIf="currentAppType === 'ORG_ADMIN'">
                  Actual
                </div>
              </div>

              <div
                class="app-type-card"
                [class.selected]="currentAppType === 'STORE_ADMIN'"
                (click)="selectAppType('STORE_ADMIN')"
              >
                <app-icon name="store" [size]="24"></app-icon>
                <div class="card-content">
                  <h3>Tienda</h3>
                  <p>Operaciones locales</p>
                </div>
                <div class="status-badge" *ngIf="currentAppType === 'STORE_ADMIN'">
                  Actual
                </div>
              </div>
            </div>
            <p class="text-[10px] text-gray-400 mt-2 flex items-center gap-1" *ngIf="!canChangeAppType">
              <app-icon name="lock" [size]="10"></app-icon>
              Cambio restringido a administradores
            </p>
          </div>

          <!-- Preferences (Language & Theme) -->
          <div class="lg:col-span-4" formGroupName="preferences">
            <h4 class="section-header">
              <app-icon name="palette" [size]="20"></app-icon>
              Preferencias
            </h4>
            
            <div class="flex flex-col gap-4">
              <!-- Inline Theme Selector -->
              <div class="theme-grid">
                <div class="theme-box" 
                     [class.active]="settingsForm.get('preferences.theme')?.value === 'default'"
                     (click)="selectTheme('default')">
                  <div class="theme-preview bg-gray-200"></div>
                  <span>Default</span>
                </div>
                <div class="theme-box" 
                     [class.active]="settingsForm.get('preferences.theme')?.value === 'aura'"
                     (click)="selectTheme('aura')">
                  <div class="theme-preview bg-gradient-to-br from-purple-500 to-pink-500"></div>
                  <span>Aura</span>
                </div>
                <div class="theme-box" 
                     [class.active]="settingsForm.get('preferences.theme')?.value === 'monocromo'"
                     (click)="selectTheme('monocromo')">
                  <div class="theme-preview bg-slate-700"></div>
                  <span>Mono</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <hr class="border-gray-100 my-6" />

        <!-- Modules Configuration - COMPACT GRID -->
        <div class="modules-section">
          <div class="flex items-center justify-between mb-4">
            <h4 class="section-header !mb-0">
              <app-icon name="layout" [size]="20"></app-icon>
              Módulos del Panel: {{ getAppTypeLabel(currentAppType) }}
            </h4>
            <span class="text-xs text-gray-400">Personaliza la visibilidad de tus herramientas</span>
          </div>

          <div formGroupName="panel_ui" class="relative">
            <div [formGroupName]="currentAppType" class="flex flex-col gap-6">
              
              <!-- SECTION A: Modules WITH Children (larger cards/areas) -->
              <div class="compact-modules-grid">
                <div *ngFor="let module of getModulesWithChildren(currentAppType)" class="module-group is-parent" [class.new-module]="isNewModule(module.key)">
                  <div class="toggle-wrapper">
                    <app-setting-toggle
                      [formControlName]="module.key"
                      [label]="module.label"
                      [description]="module.description"
                      [isNew]="isNewModule(module.key)"
                      (changed)="onParentToggle($event, module)"
                    ></app-setting-toggle>
                  </div>

                  <div class="children-grid">
                    <div *ngFor="let child of module.children" class="child-item" [class.new-module]="isNewModule(child.key)">
                      <app-setting-toggle
                        [formControlName]="child.key"
                        [label]="child.label"
                        [isNew]="isNewModule(child.key)"
                        [disabled]="!isParentModuleEnabled(module.key)"
                      ></app-setting-toggle>
                    </div>
                  </div>
                </div>
              </div>

              <!-- SECTION B: STANDALONE Modules (grouped together) -->
              <div class="standalone-container mt-2">
                <h5 class="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Herramientas Directas</h5>
                <div class="compact-modules-grid">
                  <div *ngFor="let module of getStandaloneModules(currentAppType)" class="module-group" [class.new-module]="isNewModule(module.key)">
                    <app-setting-toggle
                      [formControlName]="module.key"
                      [label]="module.label"
                      [description]="module.description"
                      [isNew]="isNewModule(module.key)"
                    ></app-setting-toggle>
                  </div>
                </div>
              </div>

            </div>
          </div>

          <div *ngIf="hasModuleError()" class="text-xs text-red-500 mt-4 flex items-center gap-1">
            <app-icon name="alert-circle" [size]="14"></app-icon>
            Debes habilitar al menos un módulo para poder navegar
          </div>
        </div>

        <!-- Upgrade single store if applicable -->
        <div class="mt-8 pt-6 border-t border-gray-100" *ngIf="isSingleStore && isOwner">
          <div class="upgrade-banner">
            <div class="flex items-center gap-4">
              <div class="p-3 bg-primary/10 rounded-xl text-primary">
                <app-icon name="zap" [size]="32"></app-icon>
              </div>
              <div class="flex-1">
                <h5 class="font-bold text-gray-900">¿Necesitas más tiendas?</h5>
                <p class="text-xs text-gray-500">Convierte tu cuenta en una Organización para gestionar múltiples sucursales y reportes consolidados.</p>
              </div>
              <app-button
                variant="primary"
                [loading]="upgrading"
                (clicked)="upgradeToOrganization()"
                size="sm"
              >
                Ver más
              </app-button>
            </div>
          </div>
        </div>
      </form>

      <ng-template #loadingTemplate>
        <div class="flex items-center justify-center py-12">
          <div
            class="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary)]"
          ></div>
        </div>
      </ng-template>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="outline-danger" (clicked)="isOpen = false"
          >Cancelar</app-button
        >
        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [loading]="saving"
          [disabled]="settingsForm.invalid"
          >Guardar Cambios</app-button
        >
      </div>
    </app-modal>
  `,
  styleUrls: ['./settings-modal.component.scss'],
})
export class SettingsModalComponent implements OnInit {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();

  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private authFacade = inject(AuthFacade);
  private globalFacade = inject(GlobalFacade);
  private environmentContextService = inject(EnvironmentContextService);
  private environmentSwitchService = inject(EnvironmentSwitchService);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);
  private themeService = inject(ThemeService);

  settingsForm: FormGroup;
  loading = false;
  saving = false;
  currentSettings: any = null;
  currentAppType: string = 'ORG_ADMIN';
  canChangeAppType: boolean = false;
  isSingleStore = false;
  isOwner = false;
  upgrading = false;
  defaultPanelUi: Record<string, Record<string, boolean>> | null = null;
  newModuleKeys = new Set<string>();

  constructor() {
    // Initialize panel_ui controls for ORG_ADMIN
    const orgAdminControls: any = {};
    APP_MODULES.ORG_ADMIN.forEach((module) => {
      orgAdminControls[module.key] = [false]; // Default to false
    });

    // Initialize panel_ui controls for STORE_ADMIN (all modules including submodules)
    const storeAdminControls: any = {};
    APP_MODULES.STORE_ADMIN.forEach((module) => {
      // For parent modules, initialize with true
      // For child modules, also initialize with true (all enabled by default now)
      storeAdminControls[module.key] = [false];
      // Also initialize children if they exist
      if (module.isParent && module.children) {
        module.children.forEach((child) => {
          storeAdminControls[child.key] = [false];
        });
      }
    });

    this.settingsForm = this.fb.group({
      app: ['ORG_ADMIN', Validators.required],
      panel_ui: this.fb.group({
        ORG_ADMIN: this.fb.group(orgAdminControls),
        STORE_ADMIN: this.fb.group(storeAdminControls),
      }),
      preferences: this.fb.group({
        language: ['es'],
        theme: ['default'],
      }),
    });

    // Check permissions synchronously
    this.checkPermissions();
  }

  ngOnInit() { }

  onOpen() {
    this.loadSettings();

    const context = this.globalFacade.getUserContext();

    // Robust account_type detection (handles objects and arrays)
    const userOrg = context?.user?.organizations;
    const accountType =
      context?.organization?.account_type ||
      (Array.isArray(userOrg) ? userOrg[0]?.account_type : userOrg?.account_type);

    this.isSingleStore = accountType === 'SINGLE_STORE';
    this.isOwner = this.authFacade.isOwner();

    console.log('🔍 isSingleStore:', this.isSingleStore, 'AccountType:', accountType);

    // Forzar STORE_ADMIN si es SINGLE_STORE
    if (this.isSingleStore && this.currentAppType === 'ORG_ADMIN') {
      this.currentAppType = 'STORE_ADMIN';
      this.settingsForm.patchValue({ app: 'STORE_ADMIN' });
    }
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
    this.canChangeAppType =
      this.authFacade.isOwner() || this.authFacade.isAdmin();
  }

  // ===== Nested Module Methods =====

  /**
   * Check if a parent module is enabled (used to disable children when parent is off)
   * @param parentKey - The key of the parent module
   * @returns true if the parent module is enabled
   */
  isParentModuleEnabled(parentKey: string): boolean {
    const control = this.settingsForm.get(
      `panel_ui.${this.currentAppType}.${parentKey}`,
    );
    return control?.value ?? false;
  }

  /**
   * Synchronize child module toggles with parent module state
   *
   * When a parent module is toggled, all its children should match the parent's state:
   * - Parent enabled → all children become enabled
   * - Parent disabled → all children become disabled
   *
   * @param isEnabled - The new state of the parent toggle
   * @param parentModule - The parent module object containing children array
   */
  onParentToggle(isEnabled: boolean, parentModule: any): void {
    // Guard: Only process if parent has children
    if (!parentModule.children || !Array.isArray(parentModule.children)) {
      return;
    }

    // Synchronize each child with the parent's state
    parentModule.children.forEach((child: any) => {
      const controlPath = `panel_ui.${this.currentAppType}.${child.key}`;
      const childControl = this.settingsForm.get(controlPath);

      if (childControl) {
        // Update child value without emitting additional events
        // This prevents performance issues from multiple validation cycles
        childControl.setValue(isEnabled, { emitEvent: false });
      }
    });
  }

  /**
   * Get all modules for an app type (flattened for backward compatibility)
   * @param appType - The app type to get modules for
   * @returns Array of all modules including children
   */
  getAllModulesForAppType(appType: string): any[] {
    const modules: any[] = [];
    const appModules = APP_MODULES[appType as keyof typeof APP_MODULES] || [];

    appModules.forEach((module: any) => {
      modules.push(module);
      // Add children if they exist
      if (module.isParent && module.children) {
        modules.push(...module.children);
      }
    });

    return modules;
  }

  /**
   * Get parent modules (modules with isParent flag) plus standalone modules
   * @param appType - The app type to get modules for
   * @returns Array of parent and standalone modules
   */
  getParentModules(appType: string): any[] {
    return APP_MODULES[appType as keyof typeof APP_MODULES] || [];
  }

  /**
   * Get modules that have children
   * @param appType - The app type to get modules for
   * @returns Array of modules with children
   */
  getModulesWithChildren(appType: string): any[] {
    return this.getParentModules(appType).filter(m => m.isParent && m.children && m.children.length > 0);
  }

  /**
   * Get standalone modules (no children)
   * @param appType - The app type to get modules for
   * @returns Array of modules without children
   */
  getStandaloneModules(appType: string): any[] {
    return this.getParentModules(appType).filter(m => !m.isParent || !m.children || m.children.length === 0);
  }

  /**
   * Compute which module keys are new (exist in defaults but not in user config)
   */
  private computeNewModuleKeys(config: any): void {
    this.newModuleKeys.clear();
    if (!this.defaultPanelUi) return;

    for (const appType of Object.keys(this.defaultPanelUi)) {
      const userKeys = config.panel_ui?.[appType] || {};
      const defaultKeys = this.defaultPanelUi[appType] || {};
      for (const key of Object.keys(defaultKeys)) {
        if (!userKeys.hasOwnProperty(key)) {
          this.newModuleKeys.add(key);
        }
      }
    }
  }

  isNewModule(key: string): boolean {
    return this.newModuleKeys.has(key);
  }

  loadSettings() {
    this.loading = true;
    this.authService
      .getSettings()
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: (response) => {
          const settings = response.data || response;
          this.currentSettings = settings;
          this.currentAppType = settings.app_type || 'ORG_ADMIN';

          // Extract and dispatch default_panel_ui for new module detection
          if (settings.default_panel_ui) {
            this.defaultPanelUi = settings.default_panel_ui;
            this.authFacade.setDefaultPanelUi(settings.default_panel_ui);
            this.computeNewModuleKeys(settings.config || {});
          }

          this.initializeForm(settings.config || {});
        },
        error: (err) => {
          console.error('Error loading settings', err);
          // Initialize with defaults even on error
          this.currentAppType = 'ORG_ADMIN';
          this.initializeForm({});
        },
      });
  }

  initializeForm(config: any) {
    console.log('🔧 Updating form with config:', config);

    // Build patch object efficiently
    const patchObj: any = {
      app: this.currentAppType,
      panel_ui: {
        ORG_ADMIN: {},
        STORE_ADMIN: {},
      },
      preferences: {
        language: 'es',
        theme: 'default',
      },
    };

    // Update ORG_ADMIN modules
    const orgDefaults = this.defaultPanelUi?.['ORG_ADMIN'] || {};
    APP_MODULES.ORG_ADMIN.forEach((module) => {
      const isNewKey = !config.panel_ui?.ORG_ADMIN?.hasOwnProperty(module.key) && !config.panel_ui?.hasOwnProperty(module.key);
      const defaultValue = orgDefaults[module.key] ?? false;
      const currentValue = isNewKey
        ? defaultValue
        : (config.panel_ui?.ORG_ADMIN?.[module.key] ?? config.panel_ui?.[module.key] ?? false);
      patchObj.panel_ui.ORG_ADMIN[module.key] = currentValue;
    });

    // Update STORE_ADMIN modules (including children)
    const storeDefaults = this.defaultPanelUi?.['STORE_ADMIN'] || {};
    APP_MODULES.STORE_ADMIN.forEach((module: any) => {
      const isNewKey = !config.panel_ui?.STORE_ADMIN?.hasOwnProperty(module.key) && !config.panel_ui?.hasOwnProperty(module.key);
      const defaultValue = storeDefaults[module.key] ?? false;
      const currentValue = isNewKey
        ? defaultValue
        : (config.panel_ui?.STORE_ADMIN?.[module.key] ?? config.panel_ui?.[module.key] ?? false);
      patchObj.panel_ui.STORE_ADMIN[module.key] = currentValue;

      // Also handle children if they exist
      if (module.isParent && module.children) {
        module.children.forEach((child: any) => {
          const isChildNew = !config.panel_ui?.STORE_ADMIN?.hasOwnProperty(child.key) && !config.panel_ui?.hasOwnProperty(child.key);
          const childDefault = storeDefaults[child.key] ?? false;
          const childValue = isChildNew
            ? childDefault
            : (config.panel_ui?.STORE_ADMIN?.[child.key] ?? config.panel_ui?.[child.key] ?? false);
          patchObj.panel_ui.STORE_ADMIN[child.key] = childValue;
        });
      }
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
      ORG_ADMIN: 'Organización',
      STORE_ADMIN: 'Tienda',
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
      preferences: { theme },
    });
    // Apply immediate preview
    this.themeService.applyUserTheme(theme);
  }

  hasModuleError(): boolean {
    const panelUiGroup = this.settingsForm.get(
      'panel_ui.' + this.currentAppType,
    );
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

        // 🔧 FIX: NO modificar el campo 'app' - solo actualizar panel_ui del app type actual
        // El usuario puede estar viendo/editando un app type diferente al que tiene seleccionado
        const configObj = {
          // Preservar TODOS los campos existentes, incluyendo 'app'
          ...currentConfig,

          // 🔥 NO actualizar 'app' - mantener el valor actual del usuario
          // app: formValue.app,  // ❌ ESTO CAUSA EL BUG - elimina esta línea

          // Merge panel_ui: preservar app types no editados y actualizar solo el actual
          panel_ui: {
            ...currentConfig.panel_ui, // Preservar todos los app types existentes
            [this.currentAppType]: formValue.panel_ui[this.currentAppType], // ✅ Actualizar solo el app type que se está editando
          },

          // Merge preferences: preservar preferencias existentes
          preferences: {
            ...currentConfig.preferences, // Preservar otras preferencias
            language: formValue.preferences.language,
            theme: formValue.preferences.theme,
          },
        };

        const dto = { config: configObj };

        console.log('🔧 Debug - Saving settings:');
        console.log('  - Current app type:', this.currentAppType);
        console.log('  - User app (preserved):', currentConfig.app);
        console.log('  - Updating panel_ui for:', this.currentAppType);
        console.log('  - New config:', configObj);

        // Use AuthFacade to update settings through NgRx
        // This ensures the store is updated and the sidebar reacts immediately
        this.authFacade.updateUserSettings(dto);
        this.saving = false;

        // Close modal after a short delay to allow the store to update
        setTimeout(() => {
          this.isOpen = false;
          this.isOpenChange.emit(false);
        }, 100);
      },
      error: (err) => {
        console.error('Error loading current config for merge', err);
        this.saving = false;
      },
    });
  }

  async upgradeToOrganization(): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Convertir en Organización',
      message: `
        <div style="display: flex; flex-direction: column; gap: 1rem; color: var(--color-text-primary);">
          <p style="font-size: var(--fs-base);">¿Estás seguro de convertir tu cuenta en una organización multi-tienda?</p>

          <div style="background-color: var(--color-muted); padding: 1.25rem; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
            <p style="font-weight: var(--fw-medium); font-size: var(--fs-sm); margin-bottom: 0.75rem; color: var(--color-text-primary);">Esto te permitirá:</p>
            <ul style="list-style-type: disc; list-style-position: inside; font-size: var(--fs-sm); color: var(--color-text-secondary); display: flex; flex-direction: column; gap: 0.5rem;">
              <li>Administrar múltiples tiendas desde un solo lugar</li>
              <li>Gestionar usuarios y permisos centralizados</li>
              <li>Ver reportes consolidados de todas tus tiendas</li>
            </ul>
          </div>

          <p style="font-size: var(--fs-xs); color: var(--color-text-muted); font-style: italic;">
            * Esta acción actualizará tu tipo de cuenta y generará automáticamente el panel de organización.
          </p>
        </div>
      `,
      confirmText: 'Convertir ahora',
      cancelText: 'Cancelar',
      confirmVariant: 'primary',
    });

    if (!confirmed) return;

    this.upgrading = true;

    try {
      const response = await this.environmentContextService
        .upgradeAccountType()
        .toPromise();

      this.toastService.success(
        'Tu cuenta ha sido actualizada a organización multi-tienda.',
      );

      this.upgrading = false;

      setTimeout(async () => {
        try {
          const success =
            await this.environmentSwitchService.performEnvironmentSwitch(
              'ORG_ADMIN',
            );
          if (success) {
            console.log('✅ Switch automático a ORG_ADMIN exitoso');
            this.closeModal();
          } else {
            console.warn('⚠️ Switch falló, intentando recargar...');
            window.location.reload();
          }
        } catch (switchError: any) {
          console.error('❌ Error en switch automático:', switchError);
          window.location.reload();
        }
      }, 500);
    } catch (error: any) {
      this.upgrading = false;
      console.error('❌ Error al actualizar tipo de cuenta:', error);
      this.toastService.error(
        error.error?.message ||
        'Error al actualizar el tipo de cuenta. Por favor, intenta de nuevo.',
      );
    }
  }
}
