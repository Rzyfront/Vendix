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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../shared/components/index';
import {
  ROLE_SCOPE_COLOR_MAP,
  ROLE_SCOPE_ICONS,
  ROLE_SCOPE_LABELS,
  RoleScope,
} from '../../../../../shared/constants/role-scope.constant';
import { OrganizationStoresService } from '../../stores/services/organization-stores.service';
import { Role, UserRoleAssignment } from '../interfaces/role.interface';
import { extractRoleErrorMessage } from '../services/org-role-errors';
import { OrgRolesService } from '../services/org-roles.service';
import { RoleScopeSelectComponent } from './role-scope-select.component';
import {
  StoreScopeOption,
  StoreScopeSelectComponent,
} from './store-scope-select.component';

/**
 * QUI-72 — editor de los roles de UN usuario (dirección usuario → rol).
 *
 * Consume el MISMO `OrgRolesService` que la pestaña "Usuarios" del detalle del
 * rol: las dos direcciones escriben `user_roles` a través de los mismos
 * endpoints, así que no pueden divergir.
 *
 * Escribe de inmediato (assign/remove por asignación) en vez de acumular un
 * "set de roles" y mandarlo al guardar: `PATCH /users/:id/configuration` borra
 * por `role_id` sin mirar `store_id`, y eso revocaría en silencio las
 * asignaciones de tienda del usuario.
 */
@Component({
  selector: 'app-user-roles-editor',
  standalone: true,
  imports: [
    ButtonComponent,
    IconComponent,
    RoleScopeSelectComponent,
    StoreScopeSelectComponent,
  ],
  template: `
    <div class="space-y-4">
      <div>
        <h4 class="text-sm font-medium text-[var(--color-text-primary)] mb-2">
          Roles asignados
          <span class="text-[var(--color-text-secondary)] font-normal">
            ({{ assignments().length }})
          </span>
        </h4>

        @if (isLoading()) {
          <p class="text-sm text-[var(--color-text-secondary)]">
            Cargando roles del usuario...
          </p>
        } @else if (assignments().length === 0) {
          <p
            class="text-sm text-[var(--color-text-secondary)] border border-dashed
                   border-[var(--color-border)] rounded-lg px-3 py-4 text-center"
          >
            Este usuario no tiene roles asignados todavía.
          </p>
        } @else {
          <ul class="space-y-2">
            @for (assignment of assignments(); track assignment.assignment_id) {
              <li
                class="flex items-center justify-between gap-3 px-3 py-2 rounded-lg
                       border border-[var(--color-border)] bg-[var(--color-surface)]"
              >
                <div class="min-w-0 flex items-center gap-2">
                  <span
                    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                           text-[11px] font-medium border shrink-0"
                    [style.background-color]="scopeBg(assignment.role?.scope)"
                    [style.border-color]="scopeBorder(assignment.role?.scope)"
                    [style.color]="scopeColor(assignment.role?.scope)"
                  >
                    <app-icon
                      [name]="scopeIcon(assignment.role?.scope)"
                      [size]="12"
                    ></app-icon>
                    {{ scopeLabel(assignment.role?.scope) }}
                  </span>

                  <div class="min-w-0">
                    <p
                      class="text-sm font-medium text-[var(--color-text-primary)] truncate"
                    >
                      {{ assignment.role?.name || 'Rol desconocido' }}
                    </p>
                    <p class="text-xs text-[var(--color-text-secondary)] truncate">
                      {{ assignmentScopeText(assignment) }}
                    </p>
                  </div>
                </div>

                <app-button
                  variant="outline-danger"
                  size="sm"
                  [disabled]="isSaving() || disabled()"
                  (clicked)="remove(assignment)"
                >
                  Quitar
                </app-button>
              </li>
            }
          </ul>
        }
      </div>

      <div
        class="space-y-3 pt-3 border-t border-[var(--color-border)]"
      >
        <h4 class="text-sm font-medium text-[var(--color-text-primary)]">
          Asignar un rol
        </h4>

        <app-role-scope-select
          label="Rol"
          [roles]="roles()"
          [excludedRoleIds]="excludedRoleIds()"
          [disabled]="isSaving() || disabled()"
          [(value)]="selectedRoleId"
          (roleSelected)="onRoleSelected($event)"
          helpText="Los roles están agrupados por alcance: organización, tienda y sistema."
        ></app-role-scope-select>

        <app-store-scope-select
          label="Alcance de la asignación"
          [stores]="storeOptions()"
          [disabled]="isStoreLocked() || isSaving() || disabled()"
          [helpText]="storeHelpText()"
          [(value)]="selectedStoreId"
        ></app-store-scope-select>

        <div class="flex justify-end">
          <app-button
            variant="primary"
            size="sm"
            [disabled]="selectedRoleId() === null || isSaving() || disabled()"
            [loading]="isSaving()"
            (clicked)="assign()"
          >
            <app-icon slot="icon" name="user-plus" [size]="14"></app-icon>
            Asignar rol
          </app-button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class UserRolesEditorComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly rolesService = inject(OrgRolesService);
  private readonly storesService = inject(OrganizationStoresService);
  private readonly toastService = inject(ToastService);

  readonly userId = input.required<number | null>();
  readonly disabled = input<boolean>(false);
  readonly changed = output<void>();

  readonly assignments = signal<UserRoleAssignment[]>([]);
  readonly roles = signal<Role[]>([]);
  readonly storeOptions = signal<StoreScopeOption[]>([]);
  readonly isLoading = signal(false);
  readonly isSaving = signal(false);

  readonly selectedRoleId = signal<number | null>(null);
  readonly selectedStoreId = signal<number | null>(null);

  readonly selectedRole = computed<Role | null>(() => {
    const id = this.selectedRoleId();
    if (id === null) return null;
    return this.roles().find((role) => role.id === id) ?? null;
  });

  /**
   * Un rol de alcance tienda sólo puede asignarse EN SU tienda (regla 5 de
   * `UserRoleAssignmentService`): pedir la tienda sería ofrecer un 403.
   */
  readonly isStoreLocked = computed(
    () => this.selectedRole()?.scope === 'store',
  );

  readonly storeHelpText = computed(() => {
    const role = this.selectedRole();
    if (role?.scope === 'store') {
      return `Rol de tienda: la asignación queda fijada a ${role.store_name ?? 'su tienda'}.`;
    }
    return 'Sin tienda, el rol aplica en toda la organización.';
  });

  /**
   * Evita el 409 `ROLE_ASSIGN_005`: el unique es (user_id, role_id, store_id),
   * así que un rol sólo está "agotado" para el alcance que ya tiene asignado.
   */
  readonly excludedRoleIds = computed<number[]>(() => {
    const taken = new Set(
      this.assignments()
        .filter((a) => a.role)
        .map((a) => `${a.role!.id}:${a.store_id ?? 'null'}`),
    );
    const target = this.selectedStoreId();

    return this.roles()
      .filter((role) => {
        const storeKey =
          role.scope === 'store'
            ? (role.store_id ?? 'null')
            : (target ?? 'null');
        return taken.has(`${role.id}:${storeKey}`);
      })
      .map((role) => role.id);
  });

  constructor() {
    effect(() => {
      const userId = this.userId();
      if (userId == null) {
        this.assignments.set([]);
        return;
      }
      this.loadAssignments(userId);
    });

    this.loadRoles();
    this.loadStores();
  }

  // ===== ETIQUETAS DE ALCANCE =====

  scopeLabel(scope: RoleScope | null | undefined): string {
    return scope ? ROLE_SCOPE_LABELS[scope] : '—';
  }

  scopeIcon(scope: RoleScope | null | undefined): string {
    return scope ? ROLE_SCOPE_ICONS[scope] : 'shield';
  }

  scopeColor(scope: RoleScope | null | undefined): string {
    return scope ? ROLE_SCOPE_COLOR_MAP[scope] : '#64748B';
  }

  /**
   * Mismo cálculo de alfa que `item-list`/`table`: el color del contrato es un
   * hex de 7 caracteres y el fondo/borde se derivan concatenando `26`/`40`.
   */
  scopeBg(scope: RoleScope | null | undefined): string {
    return `${this.scopeColor(scope)}26`;
  }

  scopeBorder(scope: RoleScope | null | undefined): string {
    return `${this.scopeColor(scope)}40`;
  }

  assignmentScopeText(assignment: UserRoleAssignment): string {
    if (assignment.store_id === null) {
      return 'Toda la organización';
    }
    return assignment.store_name
      ? `Tienda: ${assignment.store_name}`
      : `Tienda #${assignment.store_id}`;
  }

  // ===== ACCIONES =====

  onRoleSelected(role: Role | null): void {
    if (role?.scope === 'store') {
      this.selectedStoreId.set(role.store_id);
      return;
    }
    if (this.isStoreLocked()) {
      this.selectedStoreId.set(null);
    }
  }

  assign(): void {
    const userId = this.userId();
    const roleId = this.selectedRoleId();
    if (userId == null || roleId === null || this.isSaving()) return;

    const role = this.selectedRole();
    const storeId =
      role?.scope === 'store' ? role.store_id : this.selectedStoreId();

    this.isSaving.set(true);
    this.rolesService
      .assignRoleToUser({
        user_id: userId,
        role_id: roleId,
        store_id: storeId,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isSaving.set(false);
          this.selectedRoleId.set(null);
          this.selectedStoreId.set(null);
          this.toastService.success('Rol asignado exitosamente');
          this.loadAssignments(userId);
          this.changed.emit();
        },
        error: (error: unknown) => {
          this.isSaving.set(false);
          this.toastService.error(
            extractRoleErrorMessage(error, 'No se pudo asignar el rol'),
          );
        },
      });
  }

  remove(assignment: UserRoleAssignment): void {
    const userId = this.userId();
    const roleId = assignment.role?.id;
    if (userId == null || roleId == null || this.isSaving()) return;

    this.isSaving.set(true);
    this.rolesService
      .removeRoleFromUser({
        user_id: userId,
        role_id: roleId,
        store_id: assignment.store_id,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isSaving.set(false);
          this.toastService.success('Rol removido exitosamente');
          this.loadAssignments(userId);
          this.changed.emit();
        },
        error: (error: unknown) => {
          this.isSaving.set(false);
          this.toastService.error(
            extractRoleErrorMessage(error, 'No se pudo remover el rol'),
          );
        },
      });
  }

  // ===== CARGA =====

  private loadAssignments(userId: number): void {
    this.isLoading.set(true);
    this.rolesService
      .getUserRoleAssignments(userId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (assignments) => {
          this.assignments.set(assignments);
          this.isLoading.set(false);
        },
        error: (error: unknown) => {
          this.assignments.set([]);
          this.isLoading.set(false);
          this.toastService.error(
            extractRoleErrorMessage(
              error,
              'No se pudieron cargar los roles del usuario',
            ),
          );
        },
      });
  }

  private loadRoles(): void {
    this.rolesService
      .getRoles({ limit: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.roles.set(response.data || []),
        error: () => this.roles.set([]),
      });
  }

  private loadStores(): void {
    this.storesService
      .getStores({ limit: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) =>
          this.storeOptions.set(
            (response.data?.flat() || []).map((store) => ({
              id: store.id,
              name: store.name,
            })),
          ),
        error: () => this.storeOptions.set([]),
      });
  }
}
