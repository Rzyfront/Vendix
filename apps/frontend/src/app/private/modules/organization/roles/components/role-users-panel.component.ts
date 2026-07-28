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
import { OrganizationStoresService } from '../../stores/services/organization-stores.service';
import { UsersService } from '../../users/services/users.service';
import { Role, RoleUserAssignment } from '../interfaces/role.interface';
import { extractRoleErrorMessage } from '../services/org-role-errors';
import { OrgRolesService } from '../services/org-roles.service';
import {
  StoreScopeOption,
  StoreScopeSelectComponent,
} from './store-scope-select.component';

interface UserOption {
  id: number;
  label: string;
}

/**
 * QUI-72 — pestaña "Usuarios" del detalle del rol (dirección rol → usuario).
 *
 * Espejo exacto de `UserRolesEditorComponent`: mismo servicio, mismos
 * endpoints (`assign-to-user` / `remove-from-user`) y misma semántica de
 * `store_id` (NULL = toda la organización). Si una de las dos pantallas
 * escribiera por su cuenta, las dos vistas del mismo dato divergirían.
 */
@Component({
  selector: 'app-role-users-panel',
  standalone: true,
  imports: [ButtonComponent, IconComponent, StoreScopeSelectComponent],
  template: `
    <div class="space-y-4">
      <div>
        <h4 class="text-sm font-medium text-[var(--color-text-primary)] mb-2">
          Usuarios con este rol
          <span class="text-[var(--color-text-secondary)] font-normal">
            ({{ assignments().length }})
          </span>
        </h4>

        @if (isLoading()) {
          <p class="text-sm text-[var(--color-text-secondary)]">
            Cargando usuarios...
          </p>
        } @else if (assignments().length === 0) {
          <p
            class="text-sm text-[var(--color-text-secondary)] border border-dashed
                   border-[var(--color-border)] rounded-lg px-3 py-4 text-center"
          >
            Ningún usuario tiene este rol todavía.
          </p>
        } @else {
          <ul class="space-y-2">
            @for (assignment of assignments(); track assignment.id) {
              <li
                class="flex items-center justify-between gap-3 px-3 py-2 rounded-lg
                       border border-[var(--color-border)] bg-[var(--color-surface)]"
              >
                <div class="min-w-0">
                  <p
                    class="text-sm font-medium text-[var(--color-text-primary)] truncate"
                  >
                    {{ userName(assignment) }}
                  </p>
                  <p class="text-xs text-[var(--color-text-secondary)] truncate">
                    {{ assignment.users?.email }} · {{ scopeText(assignment) }}
                  </p>
                </div>

                @if (canManage()) {
                  <app-button
                    variant="outline-danger"
                    size="sm"
                    [disabled]="isSaving()"
                    (clicked)="remove(assignment)"
                  >
                    Quitar
                  </app-button>
                }
              </li>
            }
          </ul>
        }
      </div>

      @if (canManage()) {
        <div class="space-y-3 pt-3 border-t border-[var(--color-border)]">
          <h4 class="text-sm font-medium text-[var(--color-text-primary)]">
            Asignar este rol a un usuario
          </h4>

          <div>
            <label
              class="block text-sm font-medium text-[var(--color-text-primary)] mb-1"
              for="role-users-panel-user"
            >
              Usuario
            </label>
            <select
              id="role-users-panel-user"
              class="w-full px-3 py-2 border border-[var(--color-border)] rounded-md
                     bg-[var(--color-surface)] text-[var(--color-text-primary)] text-sm
                     focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]
                     focus:border-[var(--color-primary)] disabled:opacity-60"
              [disabled]="isSaving()"
              [value]="selectedUserId() === null ? '' : String(selectedUserId())"
              (change)="onUserChange($event)"
            >
              <option value="">
                {{
                  isLoadingUsers()
                    ? 'Cargando usuarios...'
                    : 'Seleccionar usuario...'
                }}
              </option>
              @for (option of userOptions(); track option.id) {
                <option [value]="String(option.id)">{{ option.label }}</option>
              }
            </select>
          </div>

          <app-store-scope-select
            label="Alcance de la asignación"
            [stores]="storeOptions()"
            [disabled]="isStoreLocked() || isSaving()"
            [helpText]="storeHelpText()"
            [(value)]="selectedStoreId"
          ></app-store-scope-select>

          <div class="flex justify-end">
            <app-button
              variant="primary"
              size="sm"
              [disabled]="selectedUserId() === null || isSaving()"
              [loading]="isSaving()"
              (clicked)="assign()"
            >
              <app-icon slot="icon" name="user-plus" [size]="14"></app-icon>
              Asignar rol
            </app-button>
          </div>
        </div>
      } @else {
        <p
          class="text-xs text-[var(--color-text-secondary)] pt-3 border-t
                 border-[var(--color-border)]"
        >
          Este rol es de sólo lectura en el nivel organización: sus asignaciones
          no se pueden modificar desde aquí.
        </p>
      }
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
export class RoleUsersPanelComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly rolesService = inject(OrgRolesService);
  private readonly usersService = inject(UsersService);
  private readonly storesService = inject(OrganizationStoresService);
  private readonly toastService = inject(ToastService);

  readonly role = input<Role | null>(null);
  /** false para roles de sistema: el backend los rechaza con `ROLE_ASSIGN_003`. */
  readonly canManage = input<boolean>(true);
  readonly changed = output<void>();

  readonly assignments = signal<RoleUserAssignment[]>([]);
  readonly storeOptions = signal<StoreScopeOption[]>([]);
  readonly isLoading = signal(false);
  readonly isLoadingUsers = signal(false);
  readonly isSaving = signal(false);

  readonly selectedUserId = signal<number | null>(null);
  readonly selectedStoreId = signal<number | null>(null);

  readonly String = String;

  private readonly users = signal<UserOption[]>([]);

  /** Oculta a quien ya tiene el rol en el alcance que se está eligiendo. */
  readonly userOptions = computed<UserOption[]>(() => {
    const target = this.selectedStoreId();
    const role = this.role();
    const effectiveStore =
      role?.scope === 'store' ? (role.store_id ?? null) : target;

    const taken = new Set(
      this.assignments()
        .filter((a) => (a.store_id ?? null) === effectiveStore)
        .map((a) => a.user_id),
    );

    return this.users().filter((option) => !taken.has(option.id));
  });

  readonly isStoreLocked = computed(() => this.role()?.scope === 'store');

  readonly storeHelpText = computed(() => {
    const role = this.role();
    if (role?.scope === 'store') {
      return `Rol de tienda: la asignación queda fijada a ${role.store_name ?? 'su tienda'}.`;
    }
    return 'Sin tienda, el rol aplica en toda la organización.';
  });

  constructor() {
    effect(() => {
      const role = this.role();
      if (!role) {
        this.assignments.set([]);
        return;
      }
      // Un rol de tienda sólo admite su propia tienda como alcance.
      this.selectedStoreId.set(role.scope === 'store' ? role.store_id : null);
      this.loadAssignments(role.id);
    });

    this.loadUsers();
    this.loadStores();
  }

  userName(assignment: RoleUserAssignment): string {
    const user = assignment.users;
    if (!user) return `Usuario #${assignment.user_id}`;
    const name = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
    return name || user.email;
  }

  scopeText(assignment: RoleUserAssignment): string {
    if (assignment.store_id === null) return 'Toda la organización';
    return assignment.stores?.name
      ? `Tienda: ${assignment.stores.name}`
      : `Tienda #${assignment.store_id}`;
  }

  onUserChange(event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    this.selectedUserId.set(raw === '' ? null : Number(raw));
  }

  assign(): void {
    const role = this.role();
    const userId = this.selectedUserId();
    if (!role || userId === null || this.isSaving()) return;

    const storeId =
      role.scope === 'store' ? role.store_id : this.selectedStoreId();

    this.isSaving.set(true);
    this.rolesService
      .assignRoleToUser({
        user_id: userId,
        role_id: role.id,
        store_id: storeId,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isSaving.set(false);
          this.selectedUserId.set(null);
          this.toastService.success('Rol asignado exitosamente');
          this.loadAssignments(role.id);
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

  remove(assignment: RoleUserAssignment): void {
    const role = this.role();
    if (!role || this.isSaving()) return;

    this.isSaving.set(true);
    this.rolesService
      .removeRoleFromUser({
        user_id: assignment.user_id,
        role_id: role.id,
        store_id: assignment.store_id,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isSaving.set(false);
          this.toastService.success('Rol removido exitosamente');
          this.loadAssignments(role.id);
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

  private loadAssignments(roleId: number): void {
    this.isLoading.set(true);
    this.rolesService
      .getRoleUsers(roleId)
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
              'No se pudieron cargar los usuarios del rol',
            ),
          );
        },
      });
  }

  private loadUsers(): void {
    this.isLoadingUsers.set(true);
    this.usersService
      .getUsers({ limit: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.users.set(
            (response.data || []).map((user) => ({
              id: user.id,
              label:
                `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() ||
                user.email,
            })),
          );
          this.isLoadingUsers.set(false);
        },
        error: () => {
          this.users.set([]);
          this.isLoadingUsers.set(false);
        },
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
