import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import {
  ButtonComponent,
  DialogService,
  IconComponent,
  InputsearchComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
} from '../../../../../shared/components/index';
import {
  ROLE_SCOPE_COLOR_MAP,
  ROLE_SCOPE_FILTER_OPTIONS,
  ROLE_SCOPE_ICONS,
  getRoleScopeLabel,
} from '../../../../../shared/constants/role-scope.constant';
import type { RoleScope } from '../../../../../shared/constants/role-scope.constant';
import { RolesService } from '../../roles/services/roles.service';
import {
  Role,
  UserRoleAssignment,
} from '../../roles/interfaces/role.interface';
import { superadminRoleErrorMessage } from '../../roles/utils/superadmin-role-errors';
import { User } from '../interfaces/user.interface';

/** Valor del selector de tienda que representa la asignación org-wide. */
const ORG_WIDE = '';

interface RoleScopeGroup {
  scope: RoleScope;
  label: string;
  color: string;
  icon: string;
  roles: Role[];
}

/**
 * QUI-72 — Roles de un usuario (dirección usuario → roles).
 *
 * Consume el MISMO `RolesService` que la pestaña "Usuarios" del detalle del rol.
 * Las dos direcciones escriben la misma fila de `user_roles`; el backend las
 * unificó detrás de una sola fachada y el frontend hace lo propio con un solo
 * servicio, para que ninguna de las dos vistas pueda quedar desfasada.
 *
 * El picker se agrupa por ALCANCE porque a nivel plataforma un usuario ve roles
 * de sistema junto a los de su organización y los de cada tienda: sin la
 * agrupación, elegir "cajero" no dice a qué tenant pertenece.
 */
@Component({
  selector: 'app-user-roles-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    IconComponent,
    InputsearchComponent,
    ModalComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="close()"
      size="lg"
      title="Roles del Usuario"
      [subtitle]="subtitle()"
    >
      <div class="flex flex-col gap-6">
        <!-- Asignados -->
        <section class="flex flex-col gap-2">
          <h4 class="text-sm font-semibold text-text-primary">
            Roles asignados ({{ assignments().length }})
          </h4>

          @if (isLoadingAssignments()) {
            <p class="text-xs text-text-secondary">Cargando roles...</p>
          } @else if (assignments().length === 0) {
            <p class="text-xs text-text-secondary">
              Este usuario todavía no tiene roles asignados.
            </p>
          } @else {
            <ul class="flex flex-col divide-y divide-[var(--color-border)]">
              @for (item of assignments(); track item.assignment_id) {
                <li class="flex items-center justify-between gap-3 py-2">
                  <div class="min-w-0 flex items-center gap-2">
                    <app-icon
                      [name]="scopeIcon(item.role?.scope)"
                      size="16"
                      [style.color]="scopeColor(item.role?.scope)"
                    ></app-icon>
                    <div class="min-w-0">
                      <p class="text-sm text-text-primary truncate">
                        {{ item.role?.name }}
                      </p>
                      <p class="text-xs text-text-secondary truncate">
                        {{ getRoleScopeLabel(item.role?.scope) }} ·
                        {{ item.store_name ?? 'Toda la organización' }}
                      </p>
                    </div>
                  </div>
                  <app-button
                    variant="ghost"
                    size="sm"
                    iconName="user-minus"
                    [disabled]="isMutating()"
                    (clicked)="confirmRemove(item)"
                  >
                    Quitar
                  </app-button>
                </li>
              }
            </ul>
          }
        </section>

        <!-- Selector agrupado por alcance -->
        <section class="flex flex-col gap-3">
          <h4 class="text-sm font-semibold text-text-primary">Asignar un rol</h4>

          <app-inputsearch
            placeholder="Filtrar roles..."
            [debounceTime]="200"
            size="sm"
            (searchChange)="roleFilter.set($event)"
          ></app-inputsearch>

          @if (isLoadingRoles()) {
            <p class="text-xs text-text-secondary">Cargando roles...</p>
          } @else if (roleGroups().length === 0) {
            <p class="text-xs text-text-secondary">
              No hay roles disponibles para este usuario.
            </p>
          } @else {
            <div
              class="flex flex-col gap-3 max-h-64 overflow-y-auto pr-1 border border-[var(--color-border)] rounded-lg p-3"
            >
              @for (group of roleGroups(); track group.scope) {
                <div class="flex flex-col gap-1">
                  <div class="flex items-center gap-2">
                    <app-icon
                      [name]="group.icon"
                      size="14"
                      [style.color]="group.color"
                    ></app-icon>
                    <span
                      class="text-xs font-semibold uppercase tracking-wide"
                      [style.color]="group.color"
                    >
                      {{ group.label }} ({{ group.roles.length }})
                    </span>
                  </div>

                  @for (role of group.roles; track role.id) {
                    <button
                      type="button"
                      class="flex items-center justify-between gap-2 text-left rounded-md px-2 py-1.5 border hover:bg-[var(--color-surface-hover)]"
                      [style.borderColor]="
                        selectedRole()?.id === role.id
                          ? group.color
                          : 'transparent'
                      "
                      (click)="selectRole(role)"
                    >
                      <span class="min-w-0">
                        <span class="block text-sm text-text-primary truncate">
                          {{ role.name }}
                        </span>
                        <span
                          class="block text-[11px] text-text-secondary truncate"
                        >
                          {{ ownerLabel(role) }}
                        </span>
                      </span>
                      @if (selectedRole()?.id === role.id) {
                        <app-icon name="check" size="14"></app-icon>
                      }
                    </button>
                  }
                </div>
              }
            </div>
          }

          @if (selectedRole(); as role) {
            <div class="flex flex-col gap-2">
              @if (role.scope === 'organization') {
                <app-selector
                  label="Alcance de la asignación"
                  [options]="storeSelectorOptions()"
                  [formControl]="storeControl"
                  size="sm"
                  variant="outline"
                  (valueChange)="onStoreChange($event)"
                ></app-selector>
              } @else {
                <p class="text-xs text-text-secondary">
                  {{ assignmentHint(role) }}
                </p>
              }

              <app-button
                variant="primary"
                size="sm"
                iconName="user-plus"
                [disabled]="isMutating() || isAlreadyAssigned()"
                (clicked)="assign()"
              >
                {{
                  isAlreadyAssigned()
                    ? 'Ya asignado con ese alcance'
                    : 'Asignar rol'
                }}
              </app-button>
            </div>
          }
        </section>
      </div>
    </app-modal>
  `,
})
export class UserRolesModalComponent {
  private readonly rolesService = inject(RolesService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input<boolean>(false);
  readonly user = input<User | null>(null);

  readonly isOpenChange = output<boolean>();
  readonly rolesChanged = output<void>();

  readonly assignments = signal<UserRoleAssignment[]>([]);
  readonly availableRoles = signal<Role[]>([]);
  readonly storeOptions = signal<{ id: number; name: string }[]>([]);
  readonly selectedRole = signal<Role | null>(null);
  readonly selectedStoreId = signal<number | null>(null);
  readonly roleFilter = signal('');
  readonly isLoadingAssignments = signal(false);
  readonly isLoadingRoles = signal(false);
  readonly isMutating = signal(false);

  readonly storeControl = new FormControl<string>(ORG_WIDE, {
    nonNullable: true,
  });

  private lastLoadedUserId: number | null = null;

  readonly getRoleScopeLabel = getRoleScopeLabel;

  readonly subtitle = computed(() => {
    const user = this.user();
    if (!user) return '';
    return `${user.first_name} ${user.last_name} · ${user.email}`;
  });

  /** Roles candidatos agrupados por alcance, filtrados por el buscador. */
  readonly roleGroups = computed<RoleScopeGroup[]>(() => {
    const term = this.roleFilter().trim().toLowerCase();
    const roles = term
      ? this.availableRoles().filter(
          (role) =>
            role.name.toLowerCase().includes(term) ||
            (role.description ?? '').toLowerCase().includes(term),
        )
      : this.availableRoles();

    return ROLE_SCOPE_FILTER_OPTIONS.map((option) => ({
      scope: option.value,
      label: option.label,
      color: ROLE_SCOPE_COLOR_MAP[option.value],
      icon: ROLE_SCOPE_ICONS[option.value],
      roles: roles.filter((role) => role.scope === option.value),
    })).filter((group) => group.roles.length > 0);
  });

  readonly storeSelectorOptions = computed<SelectorOption[]>(() => [
    { value: ORG_WIDE, label: 'Toda la organización' },
    ...this.storeOptions().map((store) => ({
      value: String(store.id),
      label: store.name,
    })),
  ]);

  constructor() {
    effect(() => {
      const user = this.user();
      const isOpen = this.isOpen();

      if (!isOpen || !user) return;
      if (this.lastLoadedUserId === user.id) return;

      this.lastLoadedUserId = user.id;
      this.resetDraft();
      this.loadAssignments(user.id);
      this.loadAvailableRoles(user);
      this.loadStores(user.organization_id ?? null);
    });
  }

  scopeColor(scope: RoleScope | null | undefined): string {
    return scope ? ROLE_SCOPE_COLOR_MAP[scope] : ROLE_SCOPE_COLOR_MAP.system;
  }

  scopeIcon(scope: RoleScope | null | undefined): string {
    return scope ? ROLE_SCOPE_ICONS[scope] : 'shield-check';
  }

  ownerLabel(role: Role): string {
    if (role.store_name) {
      return `${role.organization_name ?? '—'} / ${role.store_name}`;
    }
    return role.organization_name ?? 'Plataforma';
  }

  assignmentHint(role: Role): string {
    if (role.scope === 'store') {
      return `La asignación vive forzosamente en la tienda ${
        role.store_name ?? role.store_id
      }.`;
    }
    return 'Rol de sistema: se asigna a nivel global del usuario (org-wide).';
  }

  selectRole(role: Role): void {
    this.selectedRole.set(role);
    this.selectedStoreId.set(null);
    this.storeControl.setValue(ORG_WIDE, { emitEvent: false });
  }

  onStoreChange(value: string | number | null): void {
    const parsed = value === null || value === ORG_WIDE ? null : Number(value);
    this.selectedStoreId.set(Number.isNaN(parsed as number) ? null : parsed);
  }

  isAlreadyAssigned(): boolean {
    const role = this.selectedRole();
    if (!role) return false;
    const targetStore = this.resolveTargetStoreId(role);
    return this.assignments().some(
      (item) => item.role?.id === role.id && item.store_id === targetStore,
    );
  }

  assign(): void {
    const user = this.user();
    const role = this.selectedRole();
    if (!user || !role) return;

    this.isMutating.set(true);
    this.rolesService
      .assignRoleToUser(role.id, user.id, this.resolveTargetStoreId(role))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isMutating.set(false);
          this.toastService.success('Rol asignado');
          this.loadAssignments(user.id);
          this.rolesChanged.emit();
        },
        error: (error) => {
          this.isMutating.set(false);
          this.toastService.error(
            superadminRoleErrorMessage(error, 'Error al asignar el rol'),
          );
        },
      });
  }

  confirmRemove(item: UserRoleAssignment): void {
    const user = this.user();
    if (!user || !item.role) return;

    const scopeText = item.store_name
      ? `en la tienda "${item.store_name}"`
      : 'en toda la organización';

    this.dialogService
      .confirm({
        title: 'Quitar rol',
        message: `¿Quitar el rol "${item.role.name}" a ${user.first_name} ${user.last_name} ${scopeText}?`,
        confirmText: 'Quitar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (!confirmed) return;

        this.isMutating.set(true);
        this.rolesService
          .removeRoleFromUser(item.role!.id, user.id, item.store_id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.isMutating.set(false);
              this.toastService.success('Rol retirado');
              this.loadAssignments(user.id);
              this.rolesChanged.emit();
            },
            error: (error) => {
              this.isMutating.set(false);
              this.toastService.error(
                superadminRoleErrorMessage(error, 'Error al quitar el rol'),
              );
            },
          });
      });
  }

  close(): void {
    this.isOpenChange.emit(false);
  }

  /**
   * Tienda destino: sólo el alcance organización deja elegirla. Para un rol de
   * tienda el backend fuerza la del rol y para uno de sistema no hay tienda.
   */
  private resolveTargetStoreId(role: Role): number | null {
    if (role.scope === 'store') return role.store_id;
    if (role.scope === 'system') return null;
    return this.selectedStoreId();
  }

  private resetDraft(): void {
    this.selectedRole.set(null);
    this.selectedStoreId.set(null);
    this.roleFilter.set('');
    this.storeControl.setValue(ORG_WIDE, { emitEvent: false });
  }

  private loadAssignments(userId: number): void {
    this.isLoadingAssignments.set(true);
    this.rolesService
      .getUserRoles(userId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.assignments.set(data);
          this.isLoadingAssignments.set(false);
        },
        error: (error) => {
          this.assignments.set([]);
          this.isLoadingAssignments.set(false);
          this.toastService.error(
            superadminRoleErrorMessage(
              error,
              'Error al cargar los roles del usuario',
            ),
          );
        },
      });
  }

  /**
   * Candidatos = roles de sistema + roles del tenant del usuario.
   *
   * Es la misma regla que aplica el backend (`ROLE_ASSIGN_001`): un rol con
   * organización sólo se asigna a usuarios de ESA organización. Se piden en dos
   * consultas acotadas en vez de traer los roles de todos los tenants.
   */
  private loadAvailableRoles(user: User): void {
    this.isLoadingRoles.set(true);

    const system$ = this.rolesService
      .getRoles({ scope: 'system', limit: 100, page: 1 })
      .pipe(catchError(() => of({ data: [] as Role[] } as any)));

    const tenant$ = user.organization_id
      ? this.rolesService
          .getRoles({
            organization_id: user.organization_id,
            limit: 200,
            page: 1,
          })
          .pipe(catchError(() => of({ data: [] as Role[] } as any)))
      : of({ data: [] as Role[] } as any);

    forkJoin([system$, tenant$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ([systemRoles, tenantRoles]) => {
          this.availableRoles.set([
            ...(systemRoles.data ?? []),
            ...(tenantRoles.data ?? []),
          ]);
          this.isLoadingRoles.set(false);
        },
        error: () => {
          this.availableRoles.set([]);
          this.isLoadingRoles.set(false);
        },
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
        next: (options) => this.storeOptions.set(options),
        error: () => this.storeOptions.set([]),
      });
  }
}
