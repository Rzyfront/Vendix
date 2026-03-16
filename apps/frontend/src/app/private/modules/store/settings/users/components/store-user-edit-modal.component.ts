import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  inject,
  signal,
  computed,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { Store } from '@ngrx/store';
import {
  InputComponent,
  ButtonComponent,
  ModalComponent,
  IconComponent,
  SettingToggleComponent,
} from '../../../../../../shared/components/index';
import {
  ScrollableTabsComponent,
  ScrollableTab,
} from '../../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';
import { StoreUser } from '../interfaces/store-user.interface';
import * as StoreUsersActions from '../state/actions/store-users.actions';
import {
  selectUserDetail,
  selectDetailLoading,
  selectAvailableRoles,
} from '../state/selectors/store-users.selectors';

interface PanelUIGroup {
  label: string;
  keys: { key: string; label: string }[];
}

const KEY_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  pos: 'Punto de Venta',
  products: 'Productos',
  ecommerce: 'E-commerce',
  orders: 'Pedidos',
  orders_sales: 'Ventas',
  orders_purchase_orders: 'Ordenes de compra',
  orders_quotations: 'Cotizaciones',
  inventory: 'Inventario',
  inventory_pop: 'Punto de compra',
  inventory_adjustments: 'Ajustes',
  inventory_locations: 'Ubicaciones',
  inventory_suppliers: 'Proveedores',
  inventory_movements: 'Movimientos',
  inventory_transfers: 'Transferencias',
  customers: 'Clientes',
  customers_all: 'Todos',
  customers_reviews: 'Resenas',
  marketing: 'Marketing',
  marketing_promotions: 'Promociones',
  marketing_coupons: 'Cupones',
  analytics: 'Analiticas',
  analytics_sales: 'Ventas',
  analytics_traffic: 'Trafico',
  analytics_performance: 'Rendimiento',
  analytics_overview: 'Resumen',
  expenses: 'Gastos',
  invoicing: 'Facturacion',
  accounting: 'Contabilidad',
  accounting_journal_entries: 'Asientos',
  accounting_fiscal_periods: 'Periodos fiscales',
  accounting_chart_of_accounts: 'Plan de cuentas',
  accounting_reports: 'Reportes',
  payroll: 'Nomina',
  payroll_employees: 'Empleados',
  payroll_runs: 'Liquidaciones',
  payroll_settings: 'Config nomina',
  settings: 'Configuracion',
  settings_general: 'General',
  settings_payments: 'Pagos',
  settings_appearance: 'Apariencia',
  settings_security: 'Seguridad',
  settings_domains: 'Dominios',
  settings_shipping: 'Envios',
  settings_legal_documents: 'Documentos legales',
  settings_support: 'Soporte',
  settings_users: 'Usuarios',
  settings_roles: 'Roles',
  settings_cash_registers: 'Cajas registradoras',
  help: 'Ayuda',
  help_support: 'Soporte',
  help_center: 'Centro de ayuda',
  // ORG_ADMIN keys
  stores: 'Tiendas',
  users: 'Usuarios',
  domains: 'Dominios',
  audit: 'Auditoria',
  reports: 'Reportes',
  billing: 'Facturacion',
};

const GROUP_PREFIXES: { prefix: string; label: string }[] = [
  { prefix: 'orders_', label: 'Pedidos' },
  { prefix: 'inventory_', label: 'Inventario' },
  { prefix: 'customers_', label: 'Clientes' },
  { prefix: 'marketing_', label: 'Marketing' },
  { prefix: 'analytics_', label: 'Analiticas' },
  { prefix: 'accounting_', label: 'Contabilidad' },
  { prefix: 'payroll_', label: 'Nomina' },
  { prefix: 'settings_', label: 'Configuracion' },
  { prefix: 'help_', label: 'Ayuda' },
];

@Component({
  selector: 'app-store-user-edit-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    InputComponent,
    ButtonComponent,
    ModalComponent,
    IconComponent,
    SettingToggleComponent,
    ScrollableTabsComponent,
  ],
  template: `
    @if (isOpen) {
    <app-modal
      [isOpen]="true"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      size="lg"
      [title]="user ? (user.first_name + ' ' + user.last_name) : 'Usuario'"
      subtitle="Gestionar configuracion del usuario"
    >
      <!-- Loading -->
      @if (detailLoading() && !userDetail()) {
        <div class="flex items-center justify-center py-10">
          <div class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
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

                <!-- Info card -->
                <div class="p-3 rounded-lg bg-surface border border-border">
                  <div class="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span class="text-text-secondary">Estado</span>
                      <div class="mt-0.5">
                        <span
                          class="inline-block px-1.5 py-0.5 rounded-full text-[11px] font-medium"
                          [class]="getStateBadgeClass(userDetail()?.state || '')"
                        >{{ getStateLabel(userDetail()?.state || '') }}</span>
                      </div>
                    </div>
                    <div>
                      <span class="text-text-secondary">Creado</span>
                      <p class="text-text-primary mt-0.5">{{ formatDate(userDetail()?.created_at || '') }}</p>
                    </div>
                    <div>
                      <span class="text-text-secondary">Ultimo acceso</span>
                      <p class="text-text-primary mt-0.5">{{ userDetail()?.last_login ? formatDate(userDetail()!.last_login!) : 'Nunca' }}</p>
                    </div>
                    <div>
                      <span class="text-text-secondary">ID</span>
                      <p class="text-text-primary mt-0.5">{{ userDetail()?.id }}</p>
                    </div>
                  </div>
                </div>

                <div class="flex justify-end pt-1">
                  <app-button
                    variant="primary"
                    size="sm"
                    (clicked)="saveInfo()"
                    [disabled]="infoForm.invalid || detailLoading()"
                    [loading]="detailLoading()"
                  >Guardar cambios</app-button>
                </div>
              </form>
            }

            <!-- ── Roles ───────────────────────────────────── -->
            @case ('roles') {
              <div class="space-y-2">
                @for (role of sortedRoles(); track role.id) {
                  <label
                    class="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all min-h-[44px]"
                    [class]="isRoleAssigned(role.id)
                      ? 'border-primary/30 bg-primary/5 hover:bg-primary/10'
                      : 'border-border hover:bg-surface'"
                  >
                    <input
                      type="checkbox"
                      [checked]="isRoleAssigned(role.id)"
                      (change)="toggleRole(role.id)"
                      class="w-4 h-4 rounded border-border text-primary focus:ring-primary shrink-0"
                    />
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-1.5">
                        <span class="text-sm font-medium text-text-primary">{{ role.name }}</span>
                        @if (role.is_system_role) {
                          <span class="px-1.5 py-px text-[10px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded">Sistema</span>
                        }
                        @if (isRoleAssigned(role.id)) {
                          <span class="px-1.5 py-px text-[10px] font-semibold bg-primary/10 text-primary rounded">Asignado</span>
                        }
                      </div>
                      @if (role.description) {
                        <p class="text-xs text-text-secondary mt-0.5 truncate">{{ role.description }}</p>
                      }
                    </div>
                  </label>
                }
                @if (availableRoles().length === 0) {
                  <p class="text-center py-6 text-sm text-text-secondary">No hay roles disponibles</p>
                }
                <div class="flex justify-end pt-2">
                  <app-button
                    variant="primary"
                    size="sm"
                    (clicked)="saveRoles()"
                    [disabled]="detailLoading()"
                    [loading]="detailLoading()"
                  >Guardar roles</app-button>
                </div>
              </div>
            }

            <!-- ── Menu (Panel UI) ─────────────────────────── -->
            @case ('panel_ui') {
              <div class="space-y-4">
                <!-- Sub-tabs por app_type -->
                @if (isAdminOrOwner()) {
                  <div class="flex gap-1 p-1 bg-surface rounded-lg border border-border">
                    @for (tab of panelUIAppTabs; track tab.id) {
                      <button
                        type="button"
                        class="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                        [class]="activePanelUITab() === tab.id
                          ? 'bg-primary text-white shadow-sm'
                          : 'text-text-secondary hover:text-text-primary hover:bg-surface'"
                        (click)="activePanelUITab.set(tab.id)"
                      >{{ tab.label }}</button>
                    }
                  </div>
                }

                @for (group of currentPanelUIGroups(); track group.label) {
                  <div>
                    <h4 class="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5 px-1">
                      {{ group.label }}
                    </h4>
                    <div class="rounded-lg border border-border divide-y divide-border">
                      @for (item of group.keys; track item.key) {
                        <app-setting-toggle
                          [label]="item.label"
                          [ngModel]="getPanelUIValue(activePanelUITab(), item.key)"
                          (changed)="togglePanelUI(activePanelUITab(), item.key)"
                        />
                      }
                    </div>
                  </div>
                }
                <div class="flex justify-end pt-1">
                  <app-button
                    variant="primary"
                    size="sm"
                    (clicked)="savePanelUI()"
                    [disabled]="detailLoading()"
                    [loading]="detailLoading()"
                  >Guardar menu</app-button>
                </div>
              </div>
            }

            <!-- ── Seguridad ───────────────────────────────── -->
            @case ('security') {
              <div class="space-y-4">
                <!-- Email status -->
                <div class="flex items-center gap-3 p-3 rounded-lg border border-border">
                  <app-icon
                    [name]="userDetail()?.email_verified ? 'shield-check' : 'shield-alert'"
                    [size]="18"
                    [class]="userDetail()?.email_verified ? 'text-green-600' : 'text-yellow-600'"
                  />
                  <div class="min-w-0">
                    <span class="text-sm font-medium text-text-primary">
                      Email {{ userDetail()?.email_verified ? 'verificado' : 'no verificado' }}
                    </span>
                    <p class="text-xs text-text-secondary truncate">{{ userDetail()?.email }}</p>
                  </div>
                </div>

                <!-- Reset password -->
                <form [formGroup]="passwordForm" class="space-y-3">
                  <h4 class="text-sm font-medium text-text-primary">Restablecer contrasena</h4>
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
                    [error]="passwordForm.errors?.['mismatch'] && passwordForm.get('confirm_password')?.touched ? 'Las contrasenas no coinciden' : ''"
                  />
                  <div class="flex justify-end pt-1">
                    <app-button
                      variant="primary"
                      size="sm"
                      (clicked)="resetPassword()"
                      [disabled]="passwordForm.invalid || detailLoading()"
                      [loading]="detailLoading()"
                    >Restablecer contrasena</app-button>
                  </div>
                </form>
              </div>
            }
          }
        </div>
      }

      <div slot="footer" class="flex justify-end">
        <app-button variant="outline" size="sm" (clicked)="onCancel()">Cerrar</app-button>
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
  @Input() user: StoreUser | null = null;
  @Input() isOpen: boolean = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() onUserUpdated = new EventEmitter<void>();

  private store = inject(Store);
  private fb = inject(FormBuilder);

  userDetail = this.store.selectSignal(selectUserDetail);
  detailLoading = this.store.selectSignal(selectDetailLoading);
  availableRoles = this.store.selectSignal(selectAvailableRoles);

  activeTab = signal('info');
  selectedRoleIds = signal<Set<number>>(new Set());
  localPanelUI = signal<Record<string, Record<string, boolean>>>({});
  activePanelUITab = signal('STORE_ADMIN');

  tabItems: ScrollableTab[] = [
    { id: 'info', label: 'General', icon: 'user' },
    { id: 'roles', label: 'Roles', icon: 'shield' },
    { id: 'panel_ui', label: 'Menu', icon: 'layout-dashboard' },
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

  /** Dynamic panel UI groups for the active app_type tab */
  currentPanelUIGroups = computed(() => {
    const panelUI = this.localPanelUI();
    const appType = this.activePanelUITab();
    const keys = panelUI[appType];
    if (!keys) return [];
    return this.buildGroupsFromKeys(Object.keys(keys));
  });

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
        this.localPanelUI.set(
          detail.panel_ui
            ? JSON.parse(JSON.stringify(detail.panel_ui))
            : {},
        );
      }
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen && this.user) {
      this.activeTab.set('info');
      this.activePanelUITab.set('STORE_ADMIN');
      this.passwordForm.reset();
      this.store.dispatch(StoreUsersActions.loadUserDetail({ id: this.user.id }));
      this.store.dispatch(StoreUsersActions.loadAvailableRoles());
    }
  }

  // ── Info ────────────────────────────────────────────────────────

  saveInfo(): void {
    if (this.infoForm.invalid || !this.user) return;
    this.store.dispatch(
      StoreUsersActions.updateUser({ id: this.user.id, user: this.infoForm.value }),
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
    if (!this.user) return;
    this.store.dispatch(
      StoreUsersActions.updateUserRoles({
        id: this.user.id,
        role_ids: Array.from(this.selectedRoleIds()),
      }),
    );
  }

  // ── Panel UI ───────────────────────────────────────────────────

  getPanelUIValue(appType: string, key: string): boolean {
    return this.localPanelUI()[appType]?.[key] ?? true;
  }

  togglePanelUI(appType: string, key: string): void {
    const current = JSON.parse(JSON.stringify(this.localPanelUI()));
    if (!current[appType]) current[appType] = {};
    current[appType][key] = !this.getPanelUIValue(appType, key);
    this.localPanelUI.set(current);
  }

  savePanelUI(): void {
    if (!this.user) return;
    this.store.dispatch(
      StoreUsersActions.updateUserPanelUI({
        id: this.user.id,
        panel_ui: this.localPanelUI(),
      }),
    );
  }

  // ── Security ───────────────────────────────────────────────────

  resetPassword(): void {
    if (this.passwordForm.invalid || !this.user) return;
    const { new_password, confirm_password } = this.passwordForm.value;
    this.store.dispatch(
      StoreUsersActions.resetPassword({
        id: this.user.id,
        new_password,
        confirm_password,
      }),
    );
    this.passwordForm.reset();
  }

  // ── Helpers ────────────────────────────────────────────────────

  private buildGroupsFromKeys(keys: string[]): PanelUIGroup[] {
    const grouped = new Map<string, { key: string; label: string }[]>();

    for (const key of keys) {
      let groupLabel = 'Principal';
      for (const gp of GROUP_PREFIXES) {
        if (key.startsWith(gp.prefix)) {
          groupLabel = gp.label;
          break;
        }
      }
      if (!grouped.has(groupLabel)) grouped.set(groupLabel, []);
      grouped.get(groupLabel)!.push({
        key,
        label: KEY_LABELS[key] || key,
      });
    }

    // Keep Principal first, then alphabetical
    const result: PanelUIGroup[] = [];
    if (grouped.has('Principal')) {
      result.push({ label: 'Principal', keys: grouped.get('Principal')! });
      grouped.delete('Principal');
    }
    for (const [label, items] of Array.from(grouped.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      result.push({ label, keys: items });
    }
    return result;
  }

  passwordMatchValidator(group: FormGroup): { mismatch: boolean } | null {
    const password = group.get('new_password')?.value;
    const confirm = group.get('confirm_password')?.value;
    return password === confirm ? null : { mismatch: true };
  }

  onCancel(): void {
    this.isOpen = false;
    this.isOpenChange.emit(false);
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

  getStateBadgeClass(state: string): string {
    const map: Record<string, string> = {
      active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      inactive: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
      pending_verification: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      suspended: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
      archived: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    };
    return map[state] || 'bg-gray-100 text-gray-800';
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
