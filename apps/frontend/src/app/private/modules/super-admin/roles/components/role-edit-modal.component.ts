import {
  Component,
  DestroyRef,
  OnChanges,
  SimpleChanges,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Role,
  RoleScope,
  TenantOption,
  UpdateRoleDto,
} from '../interfaces/role.interface';
import { RolesService } from '../services/roles.service';
import { RoleUsersPanelComponent } from './role-users-panel.component';
import {
  ROLE_SCOPE_FILTER_OPTIONS,
  canEditRoleScope,
  getRoleReadOnlyReason,
  getRoleScopeLabel,
} from '../../../../../shared/constants/role-scope.constant';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { SelectorComponent } from '../../../../../shared/components/selector/selector.component';
import type { SelectorOption } from '../../../../../shared/components/selector/selector.component';
import { ScrollableTabsComponent } from '../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';
import type { ScrollableTab } from '../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';

/**
 * Roles resueltos POR NOMBRE en seeds, guards y provisioning. El backend sólo
 * les acepta cambios de `description` y responde `SUP_ADMIN_PERM_001` ante
 * cualquier intento de renombrarlos o moverlos de alcance.
 */
const CORE_ROLE_NAMES = ['owner', 'super_admin'];

const CORE_ROLE_REASON =
  'Rol núcleo: se resuelve por nombre en seeds y guards, así que sólo admite editar la descripción.';

@Component({
  selector: 'app-role-edit-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    IconComponent,
    ButtonComponent,
    SelectorComponent,
    ScrollableTabsComponent,
    RoleUsersPanelComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      title="Detalle del Rol"
      [subtitle]="modalSubtitle()"
      size="lg"
      [showCloseButton]="true"
      (closed)="onCancel()"
    >
      <app-scrollable-tabs
        [tabs]="tabs"
        [activeTab]="activeTab()"
        size="sm"
        ariaLabel="Secciones del rol"
        (tabChange)="activeTab.set($event)"
      ></app-scrollable-tabs>

      <div class="mt-4">
        @if (activeTab() === 'detalles') {
          <form [formGroup]="roleForm" (ngSubmit)="onSubmit()">
            <div class="space-y-5">
              <!-- Motivo de sólo lectura: se muestra ANTES de que el usuario
                   intente algo que el backend va a rechazar. -->
              @if (readOnlyReason(); as reason) {
                <div
                  class="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3"
                >
                  <app-icon name="triangle-alert" size="18"></app-icon>
                  <div>
                    <h4 class="text-sm font-medium text-text-primary">
                      Edición restringida
                    </h4>
                    <p class="text-xs text-text-secondary mt-0.5">
                      {{ reason }}
                    </p>
                  </div>
                </div>
              }

              <!-- Nombre -->
              <div class="form-group">
                <label for="name" class="form-label">Nombre del Rol *</label>
                <input
                  id="name"
                  type="text"
                  formControlName="name"
                  class="form-input"
                  placeholder="ej., store_manager"
                  [class.form-input-error]="
                    roleForm.get('name')?.invalid &&
                    roleForm.get('name')?.touched
                  "
                />
                @if (
                  roleForm.get('name')?.invalid && roleForm.get('name')?.touched
                ) {
                  <div class="form-error">
                    @if (roleForm.get('name')?.errors?.['required']) {
                      <span>El nombre es requerido</span>
                    }
                    @if (roleForm.get('name')?.errors?.['minlength']) {
                      <span>El nombre debe tener al menos 2 caracteres</span>
                    }
                  </div>
                }
              </div>

              <!-- Descripción -->
              <div class="form-group">
                <label for="description" class="form-label">Descripción *</label>
                <textarea
                  id="description"
                  formControlName="description"
                  rows="3"
                  class="form-input"
                  placeholder="Describe el rol y sus responsabilidades"
                  [class.form-input-error]="
                    roleForm.get('description')?.invalid &&
                    roleForm.get('description')?.touched
                  "
                ></textarea>
                @if (
                  roleForm.get('description')?.invalid &&
                  roleForm.get('description')?.touched
                ) {
                  <div class="form-error">
                    @if (roleForm.get('description')?.errors?.['required']) {
                      <span>La descripción es requerida</span>
                    }
                    @if (roleForm.get('description')?.errors?.['minlength']) {
                      <span>La descripción debe tener al menos 10 caracteres</span>
                    }
                  </div>
                }
              </div>

              <!-- Alcance: a nivel plataforma el dueño del rol lo decide el
                   payload, no el contexto del actor. -->
              <div class="form-group">
                <app-selector
                  label="Alcance del rol"
                  [options]="scopeOptions"
                  [formControl]="$any(roleForm.get('scope'))"
                  size="sm"
                  variant="outline"
                  (valueChange)="onScopeChange($event)"
                ></app-selector>
              </div>

              @if (selectedScope() !== 'system') {
                <div class="form-group">
                  <app-selector
                    label="Organización dueña *"
                    [options]="organizationOptions()"
                    [formControl]="$any(roleForm.get('organization_id'))"
                    [searchable]="true"
                    size="sm"
                    variant="outline"
                    (valueChange)="onOrganizationChange($event)"
                  ></app-selector>
                </div>
              }

              @if (selectedScope() === 'store') {
                <div class="form-group">
                  <app-selector
                    label="Tienda dueña *"
                    [options]="storeOptions()"
                    [formControl]="$any(roleForm.get('store_id'))"
                    [searchable]="true"
                    size="sm"
                    variant="outline"
                    helpText="La tienda debe pertenecer a la organización elegida."
                  ></app-selector>
                </div>
              }

              <!-- Info -->
              <div
                class="rounded-lg border border-[var(--color-border)] p-3 text-xs text-text-secondary grid grid-cols-1 sm:grid-cols-2 gap-2"
              >
                <div>
                  <span class="font-medium text-text-primary">ID:</span>
                  {{ role()?.id }}
                </div>
                <div>
                  <span class="font-medium text-text-primary">Alcance actual:</span>
                  {{ currentScopeLabel() }}
                </div>
                <div>
                  <span class="font-medium text-text-primary">Creado:</span>
                  {{ formatDate(role()?.created_at) }}
                </div>
                <div>
                  <span class="font-medium text-text-primary">Actualizado:</span>
                  {{ formatDate(role()?.updated_at) }}
                </div>
              </div>
            </div>

            <div class="modal-footer mt-6">
              <app-button
                variant="outline"
                (clicked)="onCancel()"
                [disabled]="isSubmitting()"
              >
                Cancelar
              </app-button>
              <app-button
                variant="primary"
                (clicked)="onSubmit()"
                [disabled]="isSubmitting() || roleForm.invalid"
                [loading]="isSubmitting()"
              >
                @if (!isSubmitting()) {
                  <span>Actualizar Rol</span>
                }
                @if (isSubmitting()) {
                  <span>Actualizando...</span>
                }
              </app-button>
            </div>
          </form>
        } @else {
          <app-role-users-panel
            [role]="role()"
            [active]="activeTab() === 'usuarios'"
            (changed)="usersChanged.emit()"
          ></app-role-users-panel>
        }
      </div>
    </app-modal>
  `,
  styleUrls: ['./role-edit-modal.component.scss'],
})
export class RoleEditModalComponent implements OnChanges {
  // Signals
  readonly isOpen = input<boolean>(false);
  readonly isSubmitting = input<boolean>(false);
  readonly role = input<Role | null>(null);

  // Outputs
  readonly isOpenChange = output<boolean>();
  readonly submit = output<UpdateRoleDto>();
  readonly cancel = output<void>();
  /** Se emitió una asignación/remoción: el listado debe refrescar contadores. */
  readonly usersChanged = output<void>();

  readonly tabs: ScrollableTab[] = [
    { id: 'detalles', label: 'Detalles', icon: 'file-text' },
    { id: 'usuarios', label: 'Usuarios', icon: 'users' },
  ];
  readonly activeTab = signal<string>('detalles');

  readonly scopeOptions: SelectorOption[] = ROLE_SCOPE_FILTER_OPTIONS.map(
    (option) => ({ value: option.value, label: option.label }),
  );
  readonly organizationOptions = signal<SelectorOption[]>([]);
  readonly storeOptions = signal<SelectorOption[]>([]);
  readonly selectedScope = signal<RoleScope>('system');
  readonly selectedOrganizationId = signal<number | null>(null);

  roleForm: FormGroup;
  private fb = inject(FormBuilder);
  private rolesService = inject(RolesService);
  private destroyRef = inject(DestroyRef);

  /**
   * `owner` / `super_admin` sólo admiten `description`. La matriz compartida
   * (`canEditRoleScope`) autoriza los tres alcances al superadmin, así que la
   * restricción que queda es exclusivamente la de estos roles núcleo.
   */
  readonly isCoreRole = computed(() =>
    CORE_ROLE_NAMES.includes((this.role()?.name ?? '').toLowerCase()),
  );

  readonly canEditScope = computed(
    () =>
      !this.isCoreRole() && canEditRoleScope(this.role()?.scope, 'superadmin'),
  );

  readonly readOnlyReason = computed(() => {
    if (this.isCoreRole()) return CORE_ROLE_REASON;
    return getRoleReadOnlyReason(this.role()?.scope, 'superadmin');
  });

  readonly currentScopeLabel = computed(() =>
    getRoleScopeLabel(this.role()?.scope),
  );

  readonly modalSubtitle = computed(() => {
    const role = this.role();
    if (!role) return 'Modificar detalles del rol';
    const owner = role.store_name
      ? `${role.organization_name} / ${role.store_name}`
      : (role.organization_name ?? 'Plataforma');
    return `${role.name} · ${getRoleScopeLabel(role.scope)} · ${owner}`;
  });

  constructor() {
    this.roleForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      description: ['', [Validators.required, Validators.minLength(10)]],
      scope: ['system'],
      organization_id: [''],
      store_id: [''],
    });

    this.loadOrganizations();
  }

  onOpenChange(isOpen: boolean): void {
    if (!isOpen) {
      this.onCancel();
    }
    this.isOpenChange.emit(isOpen);
  }

  ngOnChanges(changes: SimpleChanges): void {
    const currentRole = this.role();
    if (changes['isOpen'] && changes['isOpen'].currentValue && currentRole) {
      this.activeTab.set('detalles');
      this.hydrateForm(currentRole);
    }
  }

  onScopeChange(value: string | number | null): void {
    const scope = (value || 'system') as RoleScope;
    this.selectedScope.set(scope);

    if (scope === 'system') {
      this.roleForm.patchValue(
        { organization_id: '', store_id: '' },
        { emitEvent: false },
      );
      this.selectedOrganizationId.set(null);
      this.storeOptions.set([]);
      this.syncStoreControlState();
      return;
    }

    if (scope === 'organization') {
      this.roleForm.patchValue({ store_id: '' }, { emitEvent: false });
    }

    this.syncStoreControlState();
  }

  onOrganizationChange(value: string | number | null): void {
    const organizationId = value ? Number(value) : null;
    this.selectedOrganizationId.set(organizationId);
    this.roleForm.patchValue({ store_id: '' }, { emitEvent: false });
    this.syncStoreControlState();
    this.loadStores(organizationId);
  }

  /** Sin organización elegida no hay tiendas válidas que ofrecer. */
  private syncStoreControlState(): void {
    const control = this.roleForm.get('store_id');
    if (!control) return;

    if (!this.canEditScope() || this.selectedOrganizationId() == null) {
      control.disable({ emitEvent: false });
      return;
    }
    control.enable({ emitEvent: false });
  }

  onSubmit(): void {
    const currentRole = this.role();
    if (!currentRole) return;

    if (!this.roleForm.valid) {
      this.roleForm.markAllAsTouched();
      return;
    }

    const description = this.roleForm.get('description')?.value;

    // Rol núcleo: se manda SÓLO la descripción. Enviar `name` o el trío de
    // propiedad, aunque no cambien, expondría el 403 `SUP_ADMIN_PERM_001` a un
    // usuario que no pidió renombrar nada.
    if (this.isCoreRole()) {
      this.submit.emit({ description });
      return;
    }

    const scope = this.selectedScope();
    const organizationId = this.toId(this.roleForm.get('organization_id')?.value);
    const storeId = this.toId(this.roleForm.get('store_id')?.value);

    const payload: UpdateRoleDto = {
      name: this.roleForm.get('name')?.value,
      description,
      is_system_role: scope === 'system',
      // `null` explícito = desvincular. El backend distingue null de ausente,
      // así que subir un rol de tienda a organización exige mandar el null.
      organization_id: scope === 'system' ? null : organizationId,
      store_id: scope === 'store' ? storeId : null,
    };

    this.submit.emit(payload);
  }

  onCancel(): void {
    this.cancel.emit();
  }

  formatDate(dateString?: string): string {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private hydrateForm(role: Role): void {
    this.selectedScope.set(role.scope);
    this.selectedOrganizationId.set(role.organization_id);

    this.roleForm.patchValue(
      {
        name: role.name,
        description: role.description ?? '',
        scope: role.scope,
        organization_id:
          role.organization_id != null ? String(role.organization_id) : '',
        store_id: role.store_id != null ? String(role.store_id) : '',
      },
      { emitEvent: false },
    );

    // Los controles de un rol núcleo se deshabilitan en el FormControl, no sólo
    // en el template: un control deshabilitado no se puede enviar por accidente
    // y el CVA compartido ya refleja el estado vía `setDisabledState`.
    const identityLocked = !this.canEditScope();
    for (const control of ['name', 'scope', 'organization_id', 'store_id']) {
      const target = this.roleForm.get(control);
      if (!target) continue;
      if (identityLocked) {
        target.disable({ emitEvent: false });
      } else {
        target.enable({ emitEvent: false });
      }
    }

    this.syncStoreControlState();
    this.loadStores(role.organization_id);
  }

  private loadOrganizations(): void {
    this.rolesService
      .getOrganizationOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (options) => this.organizationOptions.set(this.toOptions(options)),
        error: () => this.organizationOptions.set([]),
      });
  }

  private loadStores(organizationId: number | null): void {
    if (organizationId == null) {
      this.storeOptions.set([]);
      return;
    }

    this.rolesService
      .getStoreOptions(organizationId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (options) => this.storeOptions.set(this.toOptions(options)),
        error: () => this.storeOptions.set([]),
      });
  }

  private toOptions(items: TenantOption[]): SelectorOption[] {
    return items.map((item) => ({ value: String(item.id), label: item.name }));
  }

  private toId(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
}
