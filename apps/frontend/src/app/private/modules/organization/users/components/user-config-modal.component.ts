import {
  Component,
  OnInit,
  inject,
  OnChanges,
  input,
  output,
  model,
  signal,
  DestroyRef,
  computed,
  effect,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import {
  ReactiveFormsModule,
  FormBuilder,
  FormControl,
  FormGroup,
  Validators,
} from '@angular/forms';
import {
  ButtonComponent,
  ModalComponent,
  TextareaComponent,
  MultiSelectorComponent,
  MultiSelectorOption,
  PanelUiModulesEditorComponent,
} from '../../../../../shared/components/index';
import { UsersService } from '../services/users.service';
import { User } from '../interfaces/user.interface';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { OrgRolesService } from '../../roles/services/org-roles.service';
import { OrganizationStoresService } from '../../stores/services/organization-stores.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { Role } from '../../roles/interfaces/role.interface';
import { StoreListItem } from '../../stores/interfaces/store.interface';

type PanelUiAppType = 'STORE_ADMIN' | 'ORG_ADMIN' | 'STORE_ECOMMERCE' | 'VENDIX_LANDING';

/** Default `panel_ui` for `STORE_ECOMMERCE` — there is no APP_MODULES
 *  catalog for it yet, so the consumer holds the schema. `VENDIX_LANDING`
 *  intentionally has no defaults (it is empty `{}` when no keys are set). */
const DEFAULT_STORE_ECOMMERCE_PANEL_UI: Record<string, boolean> = {
  profile: true,
  history: true,
  dashboard: true,
  favorites: true,
  orders: true,
  settings: true,
};

/** App types the shared editor can render. Non-catalog types
 *  (`STORE_ECOMMERCE`, `VENDIX_LANDING`) fall through to the JSON
 *  textarea in the "Avanzado (JSON)" block. */
const CATALOG_APP_TYPES: PanelUiAppType[] = ['STORE_ADMIN', 'ORG_ADMIN'];

@Component({
  selector: 'app-user-config-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    ButtonComponent,
    ModalComponent,
    TextareaComponent,
    MultiSelectorComponent,
    PanelUiModulesEditorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Configuración de Usuario"
      subtitle="Administra los roles, tiendas y configuraciones del panel UI"
    >
      @if (user()) {
        <form [formGroup]="configForm" (ngSubmit)="onSubmit()">
          <div class="flex border-b border-gray-200 dark:border-gray-700 mb-6">
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium border-b-2 focus:outline-none transition-colors"
              [class.border-primary]="activeTab === 'general'"
              [class.text-primary]="activeTab === 'general'"
              [class.border-transparent]="activeTab !== 'general'"
              [class.text-gray-500]="activeTab !== 'general'"
              (click)="activeTab = 'general'"
            >
              General
            </button>
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium border-b-2 focus:outline-none transition-colors"
              [class.border-primary]="activeTab === 'roles'"
              [class.text-primary]="activeTab === 'roles'"
              [class.border-transparent]="activeTab !== 'roles'"
              [class.text-gray-500]="activeTab !== 'roles'"
              (click)="activeTab = 'roles'"
            >
              Roles
            </button>
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium border-b-2 focus:outline-none transition-colors"
              [class.border-primary]="activeTab === 'stores'"
              [class.text-primary]="activeTab === 'stores'"
              [class.border-transparent]="activeTab !== 'stores'"
              [class.text-gray-500]="activeTab !== 'stores'"
              (click)="activeTab = 'stores'"
            >
              Tiendas
            </button>
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium border-b-2 focus:outline-none transition-colors"
              [class.border-primary]="activeTab === 'panel_ui'"
              [class.text-primary]="activeTab === 'panel_ui'"
              [class.border-transparent]="activeTab !== 'panel_ui'"
              [class.text-gray-500]="activeTab !== 'panel_ui'"
              (click)="activeTab = 'panel_ui'"
            >
              Panel UI
            </button>
          </div>

          <div>
            @switch (activeTab) {
              @case ('general') {
                <div class="space-y-4">
                  <div class="space-y-2">
                    <label
                      class="block text-sm font-medium text-[var(--color-text-primary)]"
                    >
                      Aplicación Asignada
                    </label>
                    <select
                      formControlName="app"
                      class="w-full px-3 py-2 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)]"
                    >
                      <option value="VENDIX_LANDING">VENDIX_LANDING</option>
                      <option value="ORG_ADMIN">ORG_ADMIN</option>
                      <option value="STORE_ADMIN">STORE_ADMIN</option>
                      <option value="STORE_ECOMMERCE">STORE_ECOMMERCE</option>
                    </select>
                    <p class="text-xs text-gray-500">
                      Selecciona la aplicación principal a la que tendrá acceso
                      el usuario.
                    </p>
                  </div>
                </div>
              }
              @case ('roles') {
                <div class="space-y-4">
                  <app-multi-selector
                    [options]="roleOptions()"
                    [label]="'Roles Asignados'"
                    [placeholder]="'Seleccionar roles...'"
                    [helpText]="'Selecciona los roles que tendrá el usuario'"
                    formControlName="roles"
                  ></app-multi-selector>
                  @if (isLoadingRoles()) {
                    <p class="text-sm text-[var(--color-text-secondary)]">
                      <span class="inline-block animate-spin mr-1">⟳</span>
                      Cargando roles...
                    </p>
                  }
                </div>
              }
              @case ('stores') {
                <div class="space-y-4">
                  <app-multi-selector
                    [options]="storeOptions()"
                    [label]="'Tiendas Asignadas'"
                    [placeholder]="'Seleccionar tiendas...'"
                    [helpText]="'Selecciona las tiendas a las que tendrá acceso el usuario'"
                    formControlName="store_ids"
                  ></app-multi-selector>
                  @if (isLoadingStores()) {
                    <p class="text-sm text-[var(--color-text-secondary)]">
                      <span class="inline-block animate-spin mr-1">⟳</span>
                      Cargando tiendas...
                    </p>
                  }
                </div>
              }
              @case ('panel_ui') {
                <div class="space-y-4">
                  <p class="text-xs text-[var(--color-text-secondary)]">
                    Configura la visibilidad de módulos para cada aplicación.
                    Para apps con catálogo, usa el árbol; para apps sin
                    catálogo edita el JSON.
                  </p>

                  <!-- Sub-tabs por app_type -->
                  <div
                    class="flex gap-1 p-1 bg-surface rounded-lg border border-border"
                  >
                    @for (tab of panelUiTabs; track tab.id) {
                      <button
                        type="button"
                        class="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                        [class]="
                          activePanelUiTab() === tab.id
                            ? 'bg-primary text-white shadow-sm'
                            : 'text-text-secondary hover:text-text-primary hover:bg-surface'
                        "
                        (click)="activePanelUiTab.set(tab.id)"
                      >
                        {{ tab.label }}
                      </button>
                    }
                  </div>

                  <!-- Catalog app_types: shared editor -->
                  @if (isCatalogAppType(activePanelUiTab())) {
                    <app-panel-ui-modules-editor
                      [appType]="activePanelUiTab()"
                      [value]="editorValue()"
                      [hiddenByIndustry]="[]"
                      [hiddenByStore]="[]"
                      [searchable]="true"
                      [parentSync]="true"
                      (valueChange)="onEditorValueChange($event)"
                    ></app-panel-ui-modules-editor>
                  }

                  <!-- Non-catalog app_types: JSON textarea (Avanzado) -->
                  @if (!isCatalogAppType(activePanelUiTab())) {
                    <div class="space-y-2">
                      @if (activePanelUiTab() === 'STORE_ECOMMERCE') {
                        <app-textarea
                          styleVariant="modern"
                          [formControl]="ecommerceJsonInput"
                          [label]="'Configuración JSON — STORE_ECOMMERCE'"
                          [rows]="10"
                          [placeholder]="'{}'"
                          customClass="font-mono"
                        ></app-textarea>
                        @if (jsonErrors()['STORE_ECOMMERCE']) {
                          <p class="text-xs text-red-500">
                            {{ jsonErrors()['STORE_ECOMMERCE'] }}
                          </p>
                        }
                      }
                      @if (activePanelUiTab() === 'VENDIX_LANDING') {
                        <app-textarea
                          styleVariant="modern"
                          [formControl]="landingJsonInput"
                          [label]="'Configuración JSON — VENDIX_LANDING'"
                          [rows]="10"
                          [placeholder]="'{}'"
                          customClass="font-mono"
                        ></app-textarea>
                        @if (jsonErrors()['VENDIX_LANDING']) {
                          <p class="text-xs text-red-500">
                            {{ jsonErrors()['VENDIX_LANDING'] }}
                          </p>
                        }
                      }
                    </div>
                  }
                </div>
              }
            }
          </div>
        </form>
      }

      <div
        class="flex justify-between items-center pt-4 border-t border-[var(--color-border)]"
        slot="footer"
      >
        <app-button
          variant="outline-danger"
          (clicked)="onCancel()"
          [disabled]="isSaving()"
          size="sm"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [disabled]="configForm.invalid || isSaving() || hasJsonError()"
          [loading]="isSaving()"
          size="sm"
        >
          Guardar Configuración
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class UserConfigModalComponent implements OnInit, OnChanges {
  private destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);
  private usersService = inject(UsersService);
  private authFacade = inject(AuthFacade);
  private rolesService = inject(OrgRolesService);
  private storesService = inject(OrganizationStoresService);
  private toastService = inject(ToastService);

  readonly user = input<User | null>(null);
  readonly isOpen = model<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly onSaved = output<void>();

  configForm!: FormGroup;
  readonly isSaving = signal(false);
  readonly isLoadingRoles = signal(false);
  readonly isLoadingStores = signal(false);
  activeTab: 'general' | 'roles' | 'stores' | 'panel_ui' = 'general';

  readonly roles = signal<Role[]>([]);
  readonly stores = signal<StoreListItem[]>([]);

  readonly roleOptions = computed<MultiSelectorOption[]>(() =>
    this.roles().map((r) => ({
      value: r.id,
      label: r.name,
      description: r.description || undefined,
    })),
  );

  readonly storeOptions = computed<MultiSelectorOption[]>(() =>
    this.stores().map((s) => ({
      value: s.id,
      label: s.name,
      description: s.store_code ? `Código: ${s.store_code}` : undefined,
    })),
  );

  /** Form controls for the two non-catalog app_types' JSON textareas. */
  readonly ecommerceJsonInput = new FormControl<string>(
    { value: '{}', disabled: false },
    { nonNullable: true },
  );
  readonly landingJsonInput = new FormControl<string>(
    { value: '{}', disabled: false },
    { nonNullable: true },
  );

  /** Full nested `panel_ui` map: per-app_type Record. Populated on
   *  load with the resolved server config (deep-merged with defaults
   *  for non-catalog app_types); updated on every editor toggle and
   *  JSON edit. Written as-is on save. */
  readonly localPanelUi = signal<Record<string, Record<string, boolean>>>({});

  /** Sub-tab inside the `panel_ui` section. */
  readonly activePanelUiTab = signal<PanelUiAppType>('STORE_ADMIN');

  readonly panelUiTabs: { id: PanelUiAppType; label: string }[] = [
    { id: 'STORE_ADMIN', label: 'Tienda' },
    { id: 'ORG_ADMIN', label: 'Organización' },
    { id: 'STORE_ECOMMERCE', label: 'E-commerce' },
    { id: 'VENDIX_LANDING', label: 'Landing' },
  ];

  /** Per-app-type JSON strings + parse errors. */
  readonly jsonStrings = signal<Record<PanelUiAppType, string>>({
    STORE_ADMIN: '{}',
    ORG_ADMIN: '{}',
    STORE_ECOMMERCE: '{}',
    VENDIX_LANDING: '{}',
  });
  readonly jsonErrors = signal<Record<PanelUiAppType, string | null>>({
    STORE_ADMIN: null,
    ORG_ADMIN: null,
    STORE_ECOMMERCE: null,
    VENDIX_LANDING: null,
  });

  /** Resolved boolean map for the active catalog tab, fed to the shared
   *  editor. Mirrors the store/user consumers (absent / `true` = allowed). */
  readonly editorValue = computed<Record<string, boolean>>(
    () => this.localPanelUi()[this.activePanelUiTab()] ?? {},
  );

  readonly hasJsonError = computed<boolean>(() => {
    const errs = this.jsonErrors();
    return Object.values(errs).some((e) => !!e);
  });

  constructor() {
    this.configForm = this.fb.group({
      app: ['VENDIX_LANDING'],
      roles: [[] as number[]],
      store_ids: [[] as number[]],
    });

    // Wire the JSON textareas: when the user edits, parse and write
    // the result back into `localPanelUi[STORE_ECOMMERCE]` /
    // `localPanelUi[VENDIX_LANDING]`. Save is blocked while either
    // textarea is in error (`hasJsonError`).
    this.ecommerceJsonInput.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value: string | null) =>
        this.onAdvancedJsonChange(value ?? '{}', 'STORE_ECOMMERCE'),
      );
    this.landingJsonInput.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value: string | null) =>
        this.onAdvancedJsonChange(value ?? '{}', 'VENDIX_LANDING'),
      );

    // When the active sub-tab changes, refresh the form control's
    // value from the persisted JSON string so the textarea reflects
    // any external state (e.g. loadConfiguration).
    effect(() => {
      const tab = this.activePanelUiTab();
      const next = this.jsonStrings()[tab] || '{}';
      if (tab === 'STORE_ECOMMERCE' && this.ecommerceJsonInput.value !== next) {
        this.ecommerceJsonInput.setValue(next, { emitEvent: false });
      } else if (tab === 'VENDIX_LANDING' && this.landingJsonInput.value !== next) {
        this.landingJsonInput.setValue(next, { emitEvent: false });
      }
    });
  }

  ngOnInit(): void {
    this.loadRoles();
    this.loadStores();
  }

  ngOnChanges(): void {
    if (this.isOpen() && this.user()) {
      this.loadConfiguration();
    }
  }

  isCatalogAppType(appType: string): boolean {
    return CATALOG_APP_TYPES.includes(appType as PanelUiAppType);
  }

  /** Patch the active catalog app_type's map with the editor's emission. */
  onEditorValueChange(next: Record<string, boolean>): void {
    const appType = this.activePanelUiTab();
    this.localPanelUi.update((prev) => ({
      ...prev,
      [appType]: { ...next },
    }));
  }

  /** Parse + validate the JSON for the given non-catalog app_type and
   *  write the result back into `localPanelUi`. */
  onAdvancedJsonChange(value: string, appType: PanelUiAppType): void {
    this.jsonStrings.update((prev) => ({ ...prev, [appType]: value }));
    try {
      const parsed = value.trim() === '' ? {} : JSON.parse(value);
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        throw new Error('El JSON debe ser un objeto plano');
      }
      // Coerce to `Record<string, boolean>` (drop non-boolean entries).
      const cleaned: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'boolean') cleaned[k] = v;
      }
      this.jsonErrors.update((prev) => ({ ...prev, [appType]: null }));
      this.localPanelUi.update((prev) => ({ ...prev, [appType]: cleaned }));
    } catch (err) {
      this.jsonErrors.update((prev) => ({
        ...prev,
        [appType]: err instanceof Error ? err.message : 'Formato JSON inválido',
      }));
    }
  }

  private loadRoles(): void {
    this.isLoadingRoles.set(true);
    this.rolesService
      .getRoles({ limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.roles.set(response.data);
          this.isLoadingRoles.set(false);
        },
        error: () => {
          this.isLoadingRoles.set(false);
          this.toastService.error('Error cargando roles');
        },
      });
  }

  private loadStores(): void {
    this.isLoadingStores.set(true);
    this.storesService
      .getStores({ limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.stores.set(response.data?.flat() || []);
          this.isLoadingStores.set(false);
        },
        error: () => {
          this.isLoadingStores.set(false);
          this.toastService.error('Error cargando tiendas');
        },
      });
  }

  loadConfiguration(): void {
    const user = this.user();
    if (!user) return;

    // Defaults for the catalog app_types come from the editor (absent
    // = true, the editor treats empty `value` as fully-enabled). For
    // non-catalog app_types the defaults are explicit because there is
    // no APP_MODULES entry to fall back on.
    const defaults: Record<string, Record<string, boolean>> = {
      STORE_ADMIN: {},
      ORG_ADMIN: {},
      STORE_ECOMMERCE: { ...DEFAULT_STORE_ECOMMERCE_PANEL_UI },
      VENDIX_LANDING: {},
    };

    this.configForm.reset({
      app: 'VENDIX_LANDING',
      roles: [],
      store_ids: [],
    });

    this.usersService
      .getUserConfiguration(user.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (config: any) => {
          const mergedPanelUi: Record<string, Record<string, boolean>> = {
            ...defaults,
            ...(config.panel_ui || {}),
          };

          this.configForm.patchValue({
            app: config.app || 'VENDIX_LANDING',
            roles: config.roles || [],
            store_ids: config.store_ids || [],
          });

          this.localPanelUi.set(mergedPanelUi);
          this.jsonStrings.set({
            STORE_ADMIN: JSON.stringify(mergedPanelUi['STORE_ADMIN'] || {}, null, 2),
            ORG_ADMIN: JSON.stringify(mergedPanelUi['ORG_ADMIN'] || {}, null, 2),
            STORE_ECOMMERCE: JSON.stringify(
              mergedPanelUi['STORE_ECOMMERCE'] || {},
              null,
              2,
            ),
            VENDIX_LANDING: JSON.stringify(
              mergedPanelUi['VENDIX_LANDING'] || {},
              null,
              2,
            ),
          });
          this.jsonErrors.set({
            STORE_ADMIN: null,
            ORG_ADMIN: null,
            STORE_ECOMMERCE: null,
            VENDIX_LANDING: null,
          });
        },
        error: (err: unknown) => {
          console.error('Failed to load configuration', err);
          const message = extractApiErrorMessage(err);
          this.toastService.error(message);
        },
      });
  }

  onCancel(): void {
    this.isOpen.set(false);
    this.isOpenChange.emit(false);
  }

  onSubmit(): void {
    const user = this.user();
    if (this.configForm.invalid || this.hasJsonError() || !user) return;

    this.isSaving.set(true);
    const formVal = this.configForm.value;

    const payload = {
      app: formVal.app,
      roles: formVal.roles as number[],
      store_ids: formVal.store_ids as number[],
      panel_ui: this.localPanelUi(),
    };

    this.usersService
      .updateUserConfiguration(user.id, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isSaving.set(false);
          this.toastService.success('Configuración actualizada exitosamente');

          const currentUserId = this.authFacade.getUserId();
          const userValue = this.user();
          if (userValue && currentUserId === userValue.id) {
            const currentUserSettings = this.authFacade.getUserSettings();
            const updatedSettings = {
              ...currentUserSettings,
              config: {
                ...currentUserSettings?.config,
                panel_ui: {
                  ...currentUserSettings?.config?.panel_ui,
                  [payload.app]: payload.panel_ui,
                },
              },
            };
            this.authFacade.updateUserSettings(updatedSettings);
          }

          this.onSaved.emit();
          this.isOpenChange.emit(false);
        },
        error: (err: unknown) => {
          this.isSaving.set(false);
          const message = extractApiErrorMessage(err);
          this.toastService.error(message);
        },
      });
  }
}
