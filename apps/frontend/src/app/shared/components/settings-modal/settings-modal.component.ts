import {Component, inject, input, output, model, signal, effect, ChangeDetectionStrategy, DestroyRef, computed} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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
import { PanelUiModulesEditorComponent } from '../panel-ui-modules-editor/panel-ui-modules-editor.component';
import { ThemeService } from '../../../core/services/theme.service';
import { APP_MODULES } from '../../constants/app-modules.constant';
import { getModulesHiddenByIndustries } from '../../constants/industry-modules.constant';

@Component({
  selector: 'app-settings-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    PanelUiModulesEditorComponent,
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
      @if (!loading()) {
        <form
          [formGroup]="settingsForm"
          (ngSubmit)="onSubmit()"
          class="settings-form"
        >
          <!-- Top Section: App Type & Upgrade -->
          <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <!-- App Type Selection -->
            <div class="lg:col-span-8">
              <h4 class="section-header">
                <app-icon name="app-window" [size]="20"></app-icon>
                Tipo de Aplicación
              </h4>
              <div
                class="app-type-selection"
                [class.read-only]="!canChangeAppType"
              >
                @if (!isSingleStore) {
                  <div
                    class="app-type-card"
                    [class.selected]="currentAppType() === 'ORG_ADMIN'"
                    (click)="selectAppType('ORG_ADMIN')"
                  >
                    <app-icon name="building" [size]="24"></app-icon>
                    <div class="card-content">
                      <h3>Organización</h3>
                      <p>Gestión multi-tienda</p>
                    </div>
                    @if (currentAppType() === 'ORG_ADMIN') {
                      <div class="status-badge">Actual</div>
                    }
                  </div>
                }
                <div
                  class="app-type-card"
                  [class.selected]="currentAppType() === 'STORE_ADMIN'"
                  (click)="selectAppType('STORE_ADMIN')"
                >
                  <app-icon name="store" [size]="24"></app-icon>
                  <div class="card-content">
                    <h3>Tienda</h3>
                    <p>Operaciones locales</p>
                  </div>
                  @if (currentAppType() === 'STORE_ADMIN') {
                    <div class="status-badge">Actual</div>
                  }
                </div>
              </div>
              @if (!canChangeAppType) {
                <p
                  class="text-[10px] text-gray-400 mt-2 flex items-center gap-1"
                >
                  <app-icon name="lock" [size]="10"></app-icon>
                  Cambio restringido a administradores
                </p>
              }
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
                  <div
                    class="theme-box"
                    [class.active]="
                      settingsForm.get('preferences.theme')?.value === 'default'
                    "
                    (click)="selectTheme('default')"
                  >
                    <div class="theme-preview bg-gray-200"></div>
                    <span>Default</span>
                  </div>
                  <div
                    class="theme-box disabled"
                    [class.active]="
                      settingsForm.get('preferences.theme')?.value === 'aura'
                    "
                  >
                    <div
                      class="theme-preview bg-gradient-to-br from-purple-500 to-pink-500"
                    ></div>
                    <span>Aura</span>
                    <span class="coming-soon-label">Próximamente</span>
                  </div>
                  <div
                    class="theme-box"
                    [class.active]="
                      settingsForm.get('preferences.theme')?.value ===
                      'monocromo'
                    "
                    (click)="selectTheme('monocromo')"
                  >
                    <div class="theme-preview bg-slate-700"></div>
                    <span>Mono</span>
                  </div>
                  <div
                    class="theme-box disabled"
                    [class.active]="
                      settingsForm.get('preferences.theme')?.value === 'glass'
                    "
                  >
                    <div class="theme-preview glass-preview"></div>
                    <span>Glass</span>
                    <span class="coming-soon-label">Próximamente</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <hr class="border-gray-100 my-6" />
          <!-- Modules Configuration - delegates to the shared editor -->
          <div class="modules-section">
            <div class="flex items-center justify-between mb-4">
              <h4 class="section-header !mb-0">
                <app-icon name="layout" [size]="20"></app-icon>
                Módulos del Panel: {{ getAppTypeLabel(currentAppType()) }}
              </h4>
              <span class="text-xs text-gray-400">
                @if (canEditModules) {
                  Personaliza la visibilidad de tus herramientas
                } @else {
                  Visibilidad gestionada por tu administrador
                }
              </span>
            </div>
            <app-panel-ui-modules-editor
              [appType]="currentAppType()"
              [value]="editorValue()"
              [hiddenByIndustry]="hiddenByIndustry()"
              [hiddenByStore]="hiddenByStore()"
              [newKeys]="newKeysForActiveApp()"
              [searchable]="true"
              [parentSync]="true"
              [readOnly]="!canEditModules"
              (valueChange)="onEditorValueChange($event)"
            ></app-panel-ui-modules-editor>
            @if (!canEditModules) {
              <p class="text-[10px] text-gray-400 mt-2 flex items-center gap-1">
                <app-icon name="lock" [size]="10"></app-icon>
                Solo un administrador o propietario puede editar la visibilidad de
                los módulos
              </p>
            }
            @if (canEditModules && hasModuleError()) {
              <div class="text-xs text-red-500 mt-4 flex items-center gap-1">
                <app-icon name="alert-circle" [size]="14"></app-icon>
                Debes habilitar al menos un módulo para poder navegar
              </div>
            }
          </div>
          <!-- Upgrade single store if applicable -->
          @if (isSingleStore && isOwner) {
            <div class="mt-8 pt-6 border-t border-gray-100">
              <div class="upgrade-banner">
                <div class="flex items-center gap-4">
                  <div class="p-3 bg-primary/10 rounded-xl text-primary">
                    <app-icon name="zap" [size]="32"></app-icon>
                  </div>
                  <div class="flex-1">
                    <h5 class="font-bold text-gray-900">
                      ¿Necesitas más tiendas?
                    </h5>
                    <p class="text-xs text-gray-500">
                      Convierte tu cuenta en una Organización para gestionar
                      múltiples sucursales y reportes consolidados.
                    </p>
                  </div>
                  <app-button
                    variant="primary"
                    [loading]="upgrading()"
                    (clicked)="upgradeToOrganization()"
                    size="sm"
                  >
                    Ver más
                  </app-button>
                </div>
              </div>
            </div>
          }
        </form>
      } @else {
        <div class="flex items-center justify-center py-12">
          <div
            class="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary)]"
          ></div>
        </div>
      }

      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="outline-danger" (clicked)="isOpen.set(false)"
          >Cancelar</app-button
        >
        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [loading]="saving()"
          [disabled]="settingsForm.invalid"
          >Guardar Cambios</app-button
        >
      </div>
    </app-modal>
  `,
  styleUrls: ['./settings-modal.component.scss'],
})
export class SettingsModalComponent {
  private destroyRef = inject(DestroyRef);
  readonly isOpen = model(false);
  readonly isOpenChange = output<boolean>();

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
  readonly loading = signal(false);
  readonly saving = signal(false);
  currentSettings: any = null;
  readonly currentAppType = signal<string>('ORG_ADMIN');
  canChangeAppType: boolean = false;
  /** Owner/admin only: editar la visibilidad del propio panel_ui es privilegiado.
   *  El acceso a módulos de un usuario común lo curan owner/admin desde el
   *  módulo de usuarios, no el propio usuario. */
  canEditModules = false;
  isSingleStore = false;
  isOwner = false;
  readonly upgrading = signal(false);
  defaultPanelUi: Record<string, Record<string, boolean>> | null = null;
  /** Per-key new-flag tracker, scoped by `appType::key`. */
  readonly newModuleKeys = signal<Set<string>>(new Set());
  /** Flat store of every form's panel_ui value the editor is currently
   *  showing — kept in sync with the form so the editor sees the resolved
   *  state on app_type switch and external updates. */
  readonly panelUiValues = signal<Record<string, Record<string, boolean>>>({});

  constructor() {
    const orgAdminControls = this.createPanelUiControls('ORG_ADMIN');
    const storeAdminControls = this.createPanelUiControls('STORE_ADMIN');

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

  /** `value` for the shared editor — derived from the active app_type's
   *  current form state. Absent keys = allowed (true). */
  readonly editorValue = computed<Record<string, boolean>>(() => {
    const appType = this.currentAppType();
    const v = this.panelUiValues()[appType] || {};
    const result: Record<string, boolean> = {};
    for (const k of Object.keys(v)) {
      result[k] = v[k] !== false;
    }
    return result;
  });

  /** Industry ∩ store_panel ceiling — only applies to `STORE_ADMIN`
   *  (industries are store-scoped; `ORG_ADMIN` is untouched, per the
   *  `vendix-panel-ui` rules). Other app_types see no gating. */
  readonly hiddenByIndustry = computed<string[]>(() => {
    if (this.currentAppType() !== 'STORE_ADMIN') return [];
    return getModulesHiddenByIndustries(this.authFacade.userIndustries());
  });

  readonly hiddenByStore = computed<string[]>(() => {
    if (this.currentAppType() !== 'STORE_ADMIN') return [];
    const storePanelMap: Record<string, boolean> | undefined =
      this.authFacade.storeSettings()?.panel_ui?.STORE_ADMIN;
    if (!storePanelMap) return [];
    return Object.keys(storePanelMap).filter(
      (k) => storePanelMap[k] === false,
    );
  });

  /** `newKeys` for the shared editor — scoped to the active app_type. */
  readonly newKeysForActiveApp = computed<string[]>(() => {
    const appType = this.currentAppType();
    const prefix = appType + '::';
    return Array.from(this.newModuleKeys())
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  });

  onOpen() {
    this.loadSettings();

    const context = this.globalFacade.getUserContext();

    // Robust account_type detection (handles objects and arrays)
    const userOrg = context?.user?.organizations;
    const accountType =
      context?.organization?.account_type ||
      (Array.isArray(userOrg)
        ? userOrg[0]?.account_type
        : userOrg?.account_type);

    this.isSingleStore = accountType === 'SINGLE_STORE';
    this.isOwner = this.authFacade.isOwner();

    // Forzar STORE_ADMIN si es SINGLE_STORE
    if (this.isSingleStore && this.currentAppType() === 'ORG_ADMIN') {
      this.currentAppType.set('STORE_ADMIN');
      this.settingsForm.patchValue({ app: 'STORE_ADMIN' });
    }
  }

  onClose() {
    this.closeModal();
  }

  closeModal() {
    this.isOpen.set(false);
    this.isOpenChange.emit(false);
    this.settingsForm.reset();
  }

  checkPermissions() {
    // Use synchronous methods from AuthFacade
    this.canChangeAppType =
      this.authFacade.isOwner() || this.authFacade.isAdmin();
    // Editar la visibilidad de módulos es solo owner/admin (misma regla que el
    // cambio de tipo de aplicación). Un rol no privilegiado no puede tocarla.
    this.canEditModules = this.canChangeAppType;
  }

  // ===== Form population helpers =====

  private createPanelUiControls(appType: string): Record<string, [boolean]> {
    const controls: Record<string, [boolean]> = {};
    this.getAllModulesForAppType(appType).forEach((module: any) => {
      controls[module.key] = [false];
    });
    return controls;
  }

  private buildPanelUiPatch(appType: string, config: any): Record<string, boolean> {
    const defaults = this.defaultPanelUi?.[appType] || {};
    const patch: Record<string, boolean> = {};

    this.getAllModulesForAppType(appType).forEach((module: any) => {
      const isNewKey =
        !config.panel_ui?.[appType]?.hasOwnProperty(module.key) &&
        !config.panel_ui?.hasOwnProperty(module.key);
      const defaultValue = defaults[module.key] ?? false;
      patch[module.key] = isNewKey
        ? defaultValue
        : (config.panel_ui?.[appType]?.[module.key] ??
          config.panel_ui?.[module.key] ??
          false);
    });

    return patch;
  }

  private getAllModulesForAppType(appType: string): any[] {
    const modules: any[] = [];
    const appModules = APP_MODULES[appType as keyof typeof APP_MODULES] || [];

    appModules.forEach((module: any) => {
      modules.push(module);
      if (module.isParent && module.children) {
        modules.push(...module.children);
      }
    });

    return modules;
  }

  // ===== App Type & Theme selection =====

  getAppTypeLabel(appType: string): string {
    const labels: Record<string, string> = {
      ORG_ADMIN: 'Organización',
      STORE_ADMIN: 'Tienda',
    };
    return labels[appType] || appType;
  }

  selectAppType(appType: string) {
    if (!this.canChangeAppType) return;
    this.currentAppType.set(appType);
    this.settingsForm.patchValue({ app: appType });
  }

  selectTheme(theme: string) {
    this.settingsForm.patchValue({
      preferences: { theme },
    });
    // Apply immediate preview
    this.themeService.applyUserTheme(theme);
  }

  // ===== Editor integration =====

  /** Patch the form's `panel_ui.{appType}` group with the editor's emitted
   *  map. Gated keys are not in the emission (the editor filters them
   *  out), so their stored value is preserved untouched. The local
   *  `panelUiValues` mirror is kept in sync so the editor sees the
   *  resolved state on app_type switch. */
  onEditorValueChange(next: Record<string, boolean>): void {
    const appType = this.currentAppType();
    const group = this.settingsForm.get(`panel_ui.${appType}`);
    if (!group) return;
    group.patchValue(next, { emitEvent: false });
    group.markAsTouched();
    this.panelUiValues.update((prev) => ({
      ...prev,
      [appType]: { ...(prev[appType] || {}), ...next },
    }));
  }

  // ===== New module badge =====

  private computeNewModuleKeys(config: any): void {
    const set = new Set<string>();
    if (!this.defaultPanelUi) {
      this.newModuleKeys.set(set);
      return;
    }
    // Only check editable app types (not STORE_ECOMMERCE or VENDIX_LANDING)
    const editableAppTypes = ['ORG_ADMIN', 'STORE_ADMIN'];
    for (const appType of editableAppTypes) {
      const userKeys = config.panel_ui?.[appType] || {};
      const defaultKeys = this.defaultPanelUi[appType] || {};
      for (const key of Object.keys(defaultKeys)) {
        if (!userKeys.hasOwnProperty(key)) {
          set.add(appType + '::' + key);
        }
      }
    }
    this.newModuleKeys.set(set);
  }

  // ===== Save / Validation =====

  hasModuleError(): boolean {
    const panelUiGroup = this.settingsForm.get(
      'panel_ui.' + this.currentAppType(),
    );
    if (!panelUiGroup) return false;
    const values = Object.values(panelUiGroup.value);
    const hasEnabled = values.some((v: any) => v === true);
    return !hasEnabled && panelUiGroup.touched;
  }

  /**
   * Build the panel_ui diff for the current app_type. For `STORE_ADMIN`,
   * modules gated by industry or the store panel UI are excluded: their
   * stored user value is preserved untouched, so if the ceiling later
   * re-allows the module the user's previous preference resurfaces.
   * For `ORG_ADMIN`, every form value is forwarded (no ceiling applies).
   */
  private buildPanelUiDiff(
    appType: string,
    formValue: any,
    currentConfig: any,
  ): Record<string, boolean> {
    const formValues: Record<string, boolean> =
      formValue?.panel_ui?.[appType] || {};
    const storedValues: Record<string, boolean> =
      currentConfig?.panel_ui?.[appType] || {};

    if (appType !== 'STORE_ADMIN') {
      return { ...formValues };
    }

    const diff: Record<string, boolean> = {};
    const hiddenI = getModulesHiddenByIndustries(
      this.authFacade.userIndustries(),
    );
    const storePanelMap: Record<string, boolean> | undefined =
      this.authFacade.storeSettings()?.panel_ui?.STORE_ADMIN;
    const isStorePanelHidden = (k: string) =>
      storePanelMap?.[k] === false;
    const isIndustryHidden = (k: string) => hiddenI.includes(k);
    const isGated = (k: string) =>
      isIndustryHidden(k) || isStorePanelHidden(k);

    for (const module of this.getAllModulesForAppType(appType)) {
      if (isGated(module.key)) {
        if (Object.prototype.hasOwnProperty.call(storedValues, module.key)) {
          diff[module.key] = storedValues[module.key];
        }
        // else: omit from the diff (absent = allowed = default).
      } else {
        diff[module.key] = formValues[module.key] ?? false;
      }
    }
    return diff;
  }

  // ===== Load + save flow =====

  loadSettings() {
    this.loading.set(true);
    this.authService
      .getSettings()
      .pipe(finalize(() => this.loading.set(false)))
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (response) => {
          const settings = response.data || response;
          this.currentSettings = settings;
          this.currentAppType.set(settings.app_type || 'ORG_ADMIN');

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
          this.currentAppType.set('ORG_ADMIN');
          this.initializeForm({});
        },
      });
  }

  initializeForm(config: any) {
    // Build patch object efficiently
    const patchObj: any = {
      app: this.currentAppType(),
      panel_ui: {
        ORG_ADMIN: {},
        STORE_ADMIN: {},
      },
      preferences: {
        language: 'es',
        theme: 'default',
      },
    };

    const orgAdminPatch = this.buildPanelUiPatch('ORG_ADMIN', config);
    const storeAdminPatch = this.buildPanelUiPatch('STORE_ADMIN', config);
    patchObj.panel_ui.ORG_ADMIN = orgAdminPatch;
    patchObj.panel_ui.STORE_ADMIN = storeAdminPatch;

    // Update preferences
    const prefs = config.preferences || { language: 'es', theme: 'default' };
    patchObj.preferences.language = prefs.language;
    patchObj.preferences.theme = prefs.theme || 'default';

    // Apply all patches at once
    this.settingsForm.patchValue(patchObj);

    // Mirror the resolved state so the editor sees the same values.
    this.panelUiValues.set({
      ORG_ADMIN: { ...orgAdminPatch },
      STORE_ADMIN: { ...storeAdminPatch },
    });
  }

  onSubmit() {
    if (this.settingsForm.invalid) return;

    this.saving.set(true);
    const formValue = this.settingsForm.getRawValue();

    // Preservar datos existentes con deep merge
    this.authService.getSettings().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        const currentConfig = response.data?.config || response.config || {};

        // NO modificar el campo 'app'. Preferences siempre; panel_ui solo si el rol puede.
        const configObj: any = {
          ...currentConfig, // preserva panel_ui existente intacto por defecto

          // Merge preferences: preservar preferencias existentes
          preferences: {
            ...currentConfig.preferences,
            language: formValue.preferences.language,
            theme: formValue.preferences.theme,
          },
        };

        // Editar la visibilidad de módulos es solo owner/admin. Un usuario no
        // privilegiado nunca persiste auto-ediciones: su panel_ui queda intacto
        // (lo curan owner/admin desde el módulo de usuarios).
        if (this.canEditModules) {
          // Merge panel_ui: preservar app types no editados y actualizar solo el actual.
          // For STORE_ADMIN, the diff excludes modules gated by industry or the
          // store panel UI (their stored user value is preserved untouched).
          configObj.panel_ui = {
            ...currentConfig.panel_ui, // Preservar todos los app types existentes
            [this.currentAppType()]: this.buildPanelUiDiff(
              this.currentAppType(),
              formValue,
              currentConfig,
            ),
          };
        }

        const dto = { config: configObj };

        // Use AuthFacade to update settings through NgRx
        this.authFacade.updateUserSettings(dto);
        this.saving.set(false);

        // Close modal after a short delay to allow store to update
        setTimeout(() => {
          this.isOpen.set(false);
          this.isOpenChange.emit(false);
        }, 100);
      },
      error: (err) => {
        console.error('Error loading current config for merge', err);
        this.saving.set(false);
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
              <li>Ver reportes consolidados de todas tus sucursales</li>
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

    this.upgrading.set(true);

    try {
      const response = await this.environmentContextService
        .upgradeAccountType()
        .toPromise();

      this.toastService.success(
        'Tu cuenta ha sido actualizada a organización multi-tienda.',
      );

      this.upgrading.set(false);

      setTimeout(async () => {
        try {
          const success =
            await this.environmentSwitchService.performEnvironmentSwitch(
              'ORG_ADMIN',
            );
          if (success) {
            this.closeModal();
          } else {
            window.location.reload();
          }
        } catch (switchError: any) {
          console.error('❌ Error en switch automático:', switchError);
          window.location.reload();
        }
      }, 500);
    } catch (error: any) {
      this.upgrading.set(false);
      console.error('❌ Error al actualizar tipo de cuenta:', error);
      this.toastService.error(
        error.error?.message ||
          'Error al actualizar el tipo de cuenta. Por favor, intenta de nuevo.',
      );
    }
  }
}
