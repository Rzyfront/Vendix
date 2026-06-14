import {
  Component,
  input,
  output,
  model,
  OnChanges,
  SimpleChanges,
  inject,
  signal,
  computed,
  effect,
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { Store } from '@ngrx/store';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import {
  InputComponent,
  ButtonComponent,
  ModalComponent,
  IconComponent,
  SettingToggleComponent,
  BadgeComponent,
  PanelUiModulesEditorComponent,
} from '../../../../../../shared/components/index';
import type { BadgeVariant } from '../../../../../../shared/components/index';
import {
  ScrollableTabsComponent,
  ScrollableTab,
} from '../../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';
import { getModulesHiddenByIndustries } from '../../../../../../shared/constants/industry-modules.constant';
import { StoreUser } from '../interfaces/store-user.interface';
import * as StoreUsersActions from '../state/actions/store-users.actions';
import {
  selectUserDetail,
  selectDetailLoading,
  selectAvailableRoles,
} from '../state/selectors/store-users.selectors';

@Component({
  selector: 'app-store-user-edit-modal',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    InputComponent,
    ButtonComponent,
    ModalComponent,
    IconComponent,
    ScrollableTabsComponent,
    PanelUiModulesEditorComponent,
    BadgeComponent,
  ],
  template: `
    @if (isOpen()) {
      <app-modal
        [isOpen]="true"
        (isOpenChange)="isOpenChange.emit($event)"
        (cancel)="onCancel()"
        size="xl"
        [title]="
          user() ? user()!.first_name + ' ' + user()!.last_name : 'Usuario'
        "
        subtitle="Gestionar configuracion del usuario"
      >
        <!-- Loading -->
        @if (detailLoading() && !userDetail()) {
          <div class="flex items-center justify-center py-10">
            <div
              class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary"
            ></div>
            <span class="ml-2 text-sm text-text-secondary">Cargando...</span>
          </div>
        }

        @if (userDetail()) {
          <!-- Tabs -->
          <div class="bg-surface/50 rounded-lg p-1 mb-4">
            <app-scrollable-tabs
              [tabs]="tabItems"
              [activeTab]="activeTab()"
              size="sm"
              (tabChange)="activeTab.set($event)"
            />
          </div>

          <div>
            @switch (activeTab()) {
              <!-- ── General ─────────────────────────────────── -->
              @case ('info') {
                <div class="space-y-4">
                  <div class="flex items-center gap-2.5">
                    <div class="p-1.5 bg-primary/10 rounded-lg">
                      <app-icon name="user" [size]="16" class="text-primary" />
                    </div>
                    <div>
                      <h4 class="text-sm font-semibold text-text-primary">
                        Informacion General
                      </h4>
                      <p class="text-[10px] text-text-secondary">
                        Datos basicos del usuario
                      </p>
                    </div>
                  </div>

                  <!-- Status bar -->
                  <div
                    class="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg border border-border bg-surface/50"
                  >
                    <app-badge
                      [variant]="
                        getStateBadgeVariant(userDetail()?.state || '')
                      "
                      size="xs"
                    >
                      {{ getStateLabel(userDetail()?.state || '') }}
                    </app-badge>
                    @for (role of userDetail()?.roles || []; track role.id) {
                      <app-badge
                        variant="primary"
                        size="xsm"
                        badgeStyle="outline"
                        >{{ role.name }}</app-badge
                      >
                    }
                    @if ((userDetail()?.roles || []).length === 0) {
                      <app-badge
                        variant="neutral"
                        size="xsm"
                        badgeStyle="outline"
                        >Sin roles</app-badge
                      >
                    }
                    <span class="text-[10px] text-text-secondary">·</span>
                    <span class="text-[10px] text-text-secondary">
                      <app-icon
                        name="calendar"
                        [size]="10"
                        class="inline-block mr-0.5"
                      />
                      Creado {{ formatDate(userDetail()?.created_at || '') }}
                    </span>
                    @if (userDetail()?.last_login) {
                      <span class="text-[10px] text-text-secondary">·</span>
                      <span class="text-[10px] text-text-secondary">
                        <app-icon
                          name="clock"
                          [size]="10"
                          class="inline-block mr-0.5"
                        />
                        Ultimo acceso
                        {{ formatDate(userDetail()!.last_login!) }}
                      </span>
                    }
                  </div>

                  <form [formGroup]="infoForm" class="space-y-3">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <app-input
                        formControlName="first_name"
                        label="Nombre"
                        placeholder="Juan"
                        [required]="true"
                        [control]="infoForm.get('first_name')"
                      />
                      <app-input
                        formControlName="last_name"
                        label="Apellido"
                        placeholder="Perez"
                        [required]="true"
                        [control]="infoForm.get('last_name')"
                      />
                    </div>
                    <app-input
                      formControlName="email"
                      label="Email"
                      type="email"
                      placeholder="juan&#64;ejemplo.com"
                      [required]="true"
                      [control]="infoForm.get('email')"
                    />
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <app-input
                        formControlName="username"
                        label="Username"
                        placeholder="juan_perez"
                        [control]="infoForm.get('username')"
                      />
                      <app-input
                        formControlName="phone"
                        label="Telefono"
                        placeholder="+57 300 123 4567"
                        [control]="infoForm.get('phone')"
                      />
                    </div>
                  </form>
                </div>
              }

              <!-- ── Roles ───────────────────────────────────── -->
              @case ('roles') {
                <div class="space-y-3">
                  <div class="flex items-center gap-2.5">
                    <div class="p-1.5 bg-primary/10 rounded-lg">
                      <app-icon
                        name="shield"
                        [size]="16"
                        class="text-primary"
                      />
                    </div>
                    <div>
                      <h4 class="text-sm font-semibold text-text-primary">
                        Roles y Permisos
                      </h4>
                      <p class="text-[10px] text-text-secondary">
                        Asigna roles para controlar el acceso del usuario
                      </p>
                    </div>
                  </div>

                  @if (availableRoles().length === 0) {
                    <div class="text-center py-8">
                      <div
                        class="p-3 bg-surface rounded-full inline-block mb-2"
                      >
                        <app-icon
                          name="shield-off"
                          [size]="28"
                          class="text-text-secondary"
                        />
                      </div>
                      <p class="text-sm font-medium text-text-primary">
                        No hay roles disponibles
                      </p>
                      <p class="text-xs text-text-secondary mt-1">
                        Crea roles desde Configuracion → Roles
                      </p>
                    </div>
                  }

                  @for (role of sortedRoles(); track role.id) {
                    <label
                      class="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all min-h-[44px]"
                      [class]="
                        isRoleAssigned(role.id)
                          ? 'border-primary/30 bg-primary/5 hover:bg-primary/10'
                          : 'border-border hover:bg-surface'
                      "
                    >
                      <input
                        type="checkbox"
                        [checked]="isRoleAssigned(role.id)"
                        (change)="toggleRole(role.id)"
                        class="w-4 h-4 rounded border-border text-primary focus:ring-primary shrink-0"
                      />
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-1.5">
                          <span class="text-sm font-medium text-text-primary">{{
                            role.name
                          }}</span>
                          @if (role.is_system_role) {
                            <app-badge variant="info" size="xsm"
                              >Sistema</app-badge
                            >
                          }
                          @if (isRoleAssigned(role.id)) {
                            <app-badge variant="success" size="xsm"
                              >Asignado</app-badge
                            >
                          }
                        </div>
                        @if (role.description) {
                          <p
                            class="text-xs text-text-secondary mt-0.5 truncate"
                          >
                            {{ role.description }}
                          </p>
                        }
                      </div>
                    </label>
                  }
                </div>
              }

              <!-- ── Modulos (Panel UI) ─────────────────────────── -->
              @case ('panel_ui') {
                <div class="space-y-4">
                  <!-- Header -->
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2.5">
                      <div class="p-1.5 bg-primary/10 rounded-lg">
                        <app-icon
                          name="layout"
                          [size]="16"
                          class="text-primary"
                        />
                      </div>
                      <div>
                        <h4 class="text-sm font-semibold text-text-primary">
                          Modulos:
                          {{
                            activePanelUITab() === 'STORE_ADMIN'
                              ? 'Tienda'
                              : 'Organizacion'
                          }}
                        </h4>
                        <p class="text-[10px] text-text-secondary">
                          Personaliza la visibilidad de herramientas
                        </p>
                      </div>
                    </div>
                  </div>

                  <!-- Sub-tabs por app_type -->
                  @if (isAdminOrOwner()) {
                    <div
                      class="flex gap-1 p-1 bg-surface rounded-lg border border-border"
                    >
                      @for (tab of panelUIAppTabs; track tab.id) {
                        <button
                          type="button"
                          class="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                          [class]="
                            activePanelUITab() === tab.id
                              ? 'bg-primary text-white shadow-sm'
                              : 'text-text-secondary hover:text-text-primary hover:bg-surface'
                          "
                          (click)="activePanelUITab.set(tab.id)"
                        >
                          {{ tab.label }}
                        </button>
                      }
                    </div>
                  }

                  <!-- Shared modules editor -->
                  <app-panel-ui-modules-editor
                    [appType]="activePanelUITab()"
                    [value]="editorValue()"
                    [hiddenByIndustry]="hiddenByIndustry()"
                    [hiddenByStore]="hiddenByStore()"
                    [searchable]="true"
                    [parentSync]="true"
                    (valueChange)="onEditorValueChange($event)"
                  />
                </div>
              }

              <!-- ── Seguridad ───────────────────────────────── -->
              @case ('security') {
                <div class="space-y-4">
                  <div class="flex items-center gap-2.5">
                    <div class="p-1.5 bg-primary/10 rounded-lg">
                      <app-icon name="lock" [size]="16" class="text-primary" />
                    </div>
                    <div>
                      <h4 class="text-sm font-semibold text-text-primary">
                        Seguridad
                      </h4>
                      <p class="text-[10px] text-text-secondary">
                        Verificacion de email y contrasena
                      </p>
                    </div>
                  </div>

                  <!-- Email status -->
                  <div
                    class="flex items-center gap-3 p-3 rounded-lg border border-border"
                  >
                    <app-icon
                      [name]="
                        userDetail()?.email_verified
                          ? 'shield-check'
                          : 'shield-alert'
                      "
                      [size]="18"
                      [class]="
                        userDetail()?.email_verified
                          ? 'text-green-600'
                          : 'text-yellow-600'
                      "
                    />
                    <div class="min-w-0">
                      <span class="text-sm font-medium text-text-primary">
                        Email
                        {{
                          userDetail()?.email_verified
                            ? 'verificado'
                            : 'no verificado'
                        }}
                      </span>
                      <p class="text-xs text-text-secondary truncate">
                        {{ userDetail()?.email }}
                      </p>
                    </div>
                  </div>

                  <!-- Reset password -->
                  <form [formGroup]="passwordForm" class="space-y-3">
                    <h4 class="text-sm font-medium text-text-primary">
                      Restablecer contrasena
                    </h4>
                    <app-input
                      formControlName="new_password"
                      label="Nueva contrasena"
                      type="password"
                      placeholder="Minimo 8 caracteres"
                      [required]="true"
                      [control]="passwordForm.get('new_password')"
                    />
                    <app-input
                      formControlName="confirm_password"
                      label="Confirmar contrasena"
                      type="password"
                      placeholder="Repetir contrasena"
                      [required]="true"
                      [control]="passwordForm.get('confirm_password')"
                      [error]="
                        passwordForm.errors?.['mismatch'] &&
                        passwordForm.get('confirm_password')?.touched
                          ? 'Las contrasenas no coinciden'
                          : ''
                      "
                    />
                  </form>
                </div>
              }
            }
          </div>
        }

        <div
          slot="footer"
          class="flex items-center justify-between w-full gap-3"
        >
          <app-button variant="outline" size="sm" (clicked)="onCancel()"
            >Cerrar</app-button
          >
          @if (userDetail()) {
            <app-button
              variant="primary"
              size="sm"
              (clicked)="saveCurrentTab()"
              [disabled]="isSaveDisabled()"
              [loading]="detailLoading()"
              >{{ getSaveLabel() }}</app-button
            >
          }
        </div>
      </app-modal>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class StoreUserEditModalComponent implements OnChanges {
  readonly user = model<StoreUser | null>(null);
  readonly isOpen = model<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly onUserUpdated = output<void>();

  private store = inject(Store);
  private fb = inject(FormBuilder);
  private authFacade = inject(AuthFacade);

  userDetail = this.store.selectSignal(selectUserDetail);
  detailLoading = this.store.selectSignal(selectDetailLoading);
  availableRoles = this.store.selectSignal(selectAvailableRoles);

  activeTab = signal('info');
  selectedRoleIds = signal<Set<number>>(new Set());
  localPanelUI = signal<Record<string, Record<string, boolean>>>({});
  /**
   * Snapshot of the user's `panel_ui` at the time the detail loaded.
   * Used in the save diff so modules gated by industry or the store
   * panel UI keep their stored user value untouched — if the ceiling
   * later re-allows the module, the user's previous preference resurfaces.
   */
  originalPanelUI = signal<Record<string, Record<string, boolean>>>({});
  activePanelUITab = signal('STORE_ADMIN');

  tabItems: ScrollableTab[] = [
    { id: 'info', label: 'General', icon: 'user' },
    { id: 'roles', label: 'Roles', icon: 'shield' },
    { id: 'panel_ui', label: 'Modulos', icon: 'layout-dashboard' },
    { id: 'security', label: 'Seguridad', icon: 'lock' },
  ];

  panelUIAppTabs = [
    { id: 'STORE_ADMIN', label: 'Tienda' },
    { id: 'ORG_ADMIN', label: 'Organizacion' },
  ];

  infoForm: FormGroup;
  passwordForm: FormGroup;

  private readonly IMMUTABLE_ROLES = ['owner', 'super_admin'];

  /** Roles sorted: assigned first, then available. Excludes immutable roles. */
  sortedRoles = computed(() => {
    const roles = this.availableRoles().filter(
      (r) => !this.IMMUTABLE_ROLES.includes(r.name.toLowerCase()),
    );
    const assigned = this.selectedRoleIds();
    return [...roles].sort((a, b) => {
      const aAssigned = assigned.has(a.id) ? 0 : 1;
      const bAssigned = assigned.has(b.id) ? 0 : 1;
      return aAssigned - bAssigned;
    });
  });

  /** Check if user has admin or owner role */
  isAdminOrOwner = computed(() => {
    const roles = this.availableRoles();
    const assigned = this.selectedRoleIds();
    return roles.some(
      (r) =>
        assigned.has(r.id) &&
        (r.name.toLowerCase().includes('admin') ||
          r.name.toLowerCase().includes('owner')),
    );
  });

  /** `value` for the shared editor — the active app_type's flat map. */
  readonly editorValue = computed<Record<string, boolean>>(() => {
    const appType = this.activePanelUITab();
    const v = this.localPanelUI()[appType] || {};
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
    if (this.activePanelUITab() !== 'STORE_ADMIN') return [];
    return getModulesHiddenByIndustries(this.authFacade.userIndustries());
  });

  readonly hiddenByStore = computed<string[]>(() => {
    if (this.activePanelUITab() !== 'STORE_ADMIN') return [];
    const storePanelMap: Record<string, boolean> | undefined =
      this.authFacade.storeSettings()?.panel_ui?.STORE_ADMIN;
    if (!storePanelMap) return [];
    return Object.keys(storePanelMap).filter(
      (k) => storePanelMap[k] === false,
    );
  });

  /** Per-key gating helper used by `buildPanelUIDiff` to mirror the
   *  same arrays the editor renders against. */
  private isGated(key: string, appType: string): boolean {
    if (appType !== 'STORE_ADMIN') return false;
    return this.hiddenByIndustry().includes(key) || this.hiddenByStore().includes(key);
  }

  constructor() {
    this.infoForm = this.fb.group({
      first_name: ['', [Validators.required, Validators.maxLength(100)]],
      last_name: ['', [Validators.required, Validators.maxLength(100)]],
      email: ['', [Validators.required, Validators.email]],
      username: [''],
      phone: [''],
    });

    this.passwordForm = this.fb.group(
      {
        new_password: ['', [Validators.required, Validators.minLength(8)]],
        confirm_password: ['', [Validators.required]],
      },
      { validators: this.passwordMatchValidator },
    );

    effect(() => {
      const detail = this.userDetail();
      if (detail) {
        this.infoForm.patchValue({
          first_name: detail.first_name,
          last_name: detail.last_name,
          email: detail.email,
          username: detail.username || '',
          phone: detail.phone || '',
        });
        this.selectedRoleIds.set(new Set(detail.roles?.map((r) => r.id) || []));
        const snapshot = detail.panel_ui
          ? JSON.parse(JSON.stringify(detail.panel_ui))
          : {};
        this.localPanelUI.set(snapshot);
        this.originalPanelUI.set(JSON.parse(JSON.stringify(snapshot)));
      }
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    const currentUser = this.user();
    if (changes['isOpen'] && this.isOpen() && currentUser) {
      this.activeTab.set('info');
      this.activePanelUITab.set('STORE_ADMIN');
      this.passwordForm.reset();
      this.store.dispatch(
        StoreUsersActions.loadUserDetail({ id: currentUser.id }),
      );
      this.store.dispatch(StoreUsersActions.loadAvailableRoles());
    }
  }

  // ── Info ────────────────────────────────────────────────────────

  saveInfo(): void {
    const currentUser = this.user();
    if (this.infoForm.invalid || !currentUser) return;
    this.store.dispatch(
      StoreUsersActions.updateUser({
        id: currentUser.id,
        user: this.infoForm.value,
      }),
    );
  }

  // ── Roles ──────────────────────────────────────────────────────

  isRoleAssigned(roleId: number): boolean {
    return this.selectedRoleIds().has(roleId);
  }

  toggleRole(roleId: number): void {
    const current = new Set(this.selectedRoleIds());
    if (current.has(roleId)) {
      current.delete(roleId);
    } else {
      current.add(roleId);
    }
    this.selectedRoleIds.set(current);
  }

  saveRoles(): void {
    const currentUser = this.user();
    if (!currentUser) return;
    this.store.dispatch(
      StoreUsersActions.updateUserRoles({
        id: currentUser.id,
        role_ids: Array.from(this.selectedRoleIds()),
      }),
    );
  }

  // ── Panel UI ───────────────────────────────────────────────────

  /** Patch the active app_type's `localPanelUI` with the editor's emitted
   *  map. Gated keys are not in the emission (the editor filters them
   *  out), so their stored value is preserved untouched. */
  onEditorValueChange(next: Record<string, boolean>): void {
    const appType = this.activePanelUITab();
    this.localPanelUI.update((prev) => ({
      ...prev,
      [appType]: { ...(prev[appType] || {}), ...next },
    }));
  }

  savePanelUI(): void {
    const currentUser = this.user();
    if (!currentUser) return;
    this.store.dispatch(
      StoreUsersActions.updateUserPanelUI({
        id: currentUser.id,
        panel_ui: this.buildPanelUIDiff(),
      }),
    );
  }

  /**
   * Build the per-user panel_ui save payload. For the active app_type,
   * keys gated by industry or the store panel UI are excluded — the
   * user's original stored value is preserved so the module resurfaces
   * if the ceiling later lifts. Other app_types are forwarded as-is.
   */
  private buildPanelUIDiff(): Record<string, Record<string, boolean>> {
    const appType = this.activePanelUITab();
    const local = JSON.parse(JSON.stringify(this.localPanelUI()));
    const original = JSON.parse(JSON.stringify(this.originalPanelUI()));

    if (appType !== 'STORE_ADMIN') {
      return local;
    }

    const localForApp: Record<string, boolean> = local[appType] || {};
    const originalForApp: Record<string, boolean> = original[appType] || {};
    const mergedForApp: Record<string, boolean> = { ...originalForApp };

    for (const key of Object.keys(localForApp)) {
      if (this.isGated(key, appType)) continue;
      mergedForApp[key] = localForApp[key];
    }

    return {
      ...local,
      [appType]: mergedForApp,
    };
  }

  // ── Security ───────────────────────────────────────────────────

  resetPassword(): void {
    const currentUser = this.user();
    if (this.passwordForm.invalid || !currentUser) return;
    const { new_password, confirm_password } = this.passwordForm.value;
    this.store.dispatch(
      StoreUsersActions.resetPassword({
        id: currentUser.id,
        new_password,
        confirm_password,
      }),
    );
    this.passwordForm.reset();
  }

  // ── Footer ─────────────────────────────────────────────────────

  saveCurrentTab(): void {
    switch (this.activeTab()) {
      case 'info':
        this.saveInfo();
        break;
      case 'roles':
        this.saveRoles();
        break;
      case 'panel_ui':
        this.savePanelUI();
        break;
      case 'security':
        this.resetPassword();
        break;
    }
  }

  getSaveLabel(): string {
    const labels: Record<string, string> = {
      info: 'Guardar cambios',
      roles: 'Guardar roles',
      panel_ui: 'Guardar modulos',
      security: 'Restablecer contrasena',
    };
    return labels[this.activeTab()] || 'Guardar';
  }

  isSaveDisabled(): boolean {
    switch (this.activeTab()) {
      case 'info':
        return this.infoForm.invalid || this.detailLoading();
      case 'security':
        return this.passwordForm.invalid || this.detailLoading();
      default:
        return this.detailLoading();
    }
  }

  // ── Helpers ────────────────────────────────────────────────────

  passwordMatchValidator(group: FormGroup): { mismatch: boolean } | null {
    const password = group.get('new_password')?.value;
    const confirm = group.get('confirm_password')?.value;
    return password === confirm ? null : { mismatch: true };
  }

  onCancel(): void {
    this.isOpen.set(false);
    this.store.dispatch(StoreUsersActions.clearUserDetail());
  }

  getStateLabel(state: string): string {
    const map: Record<string, string> = {
      active: 'Activo',
      inactive: 'Inactivo',
      pending_verification: 'Pendiente',
      suspended: 'Suspendido',
      archived: 'Archivado',
    };
    return map[state] || state;
  }

  getStateBadgeVariant(state: string): BadgeVariant {
    const map: Record<string, BadgeVariant> = {
      active: 'success',
      inactive: 'neutral',
      pending_verification: 'warning',
      suspended: 'error',
      archived: 'neutral',
    };
    return map[state] || 'neutral';
  }

  formatDate(dateString: string): string {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
}
