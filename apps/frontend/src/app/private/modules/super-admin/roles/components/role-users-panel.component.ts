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

import {
  ButtonComponent,
  DialogService,
  EmptyStateComponent,
  IconComponent,
  InputsearchComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
} from '../../../../../shared/components/index';
import {
  ROLE_SCOPE_COLOR_MAP,
  ROLE_SCOPE_ICONS,
  getRoleScopeLabel,
} from '../../../../../shared/constants/role-scope.constant';
import { Role, RoleUserAssignment } from '../interfaces/role.interface';
import { RolesService } from '../services/roles.service';
import { superadminRoleErrorMessage } from '../utils/superadmin-role-errors';
import { UsersService } from '../../users/services/users.service';
import { User } from '../../users/interfaces/user.interface';

/** Valor del selector de tienda que representa la asignación org-wide. */
const ORG_WIDE = '';

/**
 * QUI-72 — Pestaña "Usuarios" del detalle del rol (dirección rol → usuarios).
 *
 * Consume el MISMO `RolesService` que el editor de roles del usuario, que es la
 * dirección inversa. Las dos vistas escriben la misma fila de `user_roles`; si
 * cada una tuviera su propio servicio, la corrección que el backend hizo por
 * abajo (una sola fachada de escritura) se perdería por arriba.
 *
 * `store_id === null` NO es "sin tienda": es una asignación org-wide, válida en
 * todas las tiendas de la organización. Por eso se muestra con una etiqueta
 * propia y no como un valor vacío.
 */
@Component({
  selector: 'app-role-users-panel',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    EmptyStateComponent,
    IconComponent,
    InputsearchComponent,
    SelectorComponent,
  ],
  template: `
    <div class="flex flex-col gap-4">
      <!-- Alcance del rol: condiciona a qué tienda puede ir la asignación -->
      @if (role(); as currentRole) {
        <div
          class="flex items-start gap-3 rounded-lg border border-[var(--color-border)] p-3"
        >
          <app-icon
            [name]="scopeIcon()"
            size="18"
            [style.color]="scopeColor()"
          ></app-icon>
          <div class="min-w-0">
            <p class="text-sm font-medium text-text-primary">
              Alcance {{ scopeLabel() }}
              @if (ownerLabel()) {
                <span class="text-text-secondary">· {{ ownerLabel() }}</span>
              }
            </p>
            <p class="text-xs text-text-secondary mt-0.5">
              {{ scopeHint() }}
            </p>
          </div>
        </div>

        <!-- Asignar -->
        <div class="flex flex-col gap-3">
          <h4 class="text-sm font-semibold text-text-primary">
            Asignar a un usuario
          </h4>

          @if (canChooseStore()) {
            <app-selector
              label="Alcance de la asignación"
              [options]="storeSelectorOptions()"
              [formControl]="storeControl"
              size="sm"
              variant="outline"
              (valueChange)="onStoreChange($event)"
            ></app-selector>
          }

          <app-inputsearch
            placeholder="Buscar usuario por nombre o email..."
            [debounceTime]="400"
            size="sm"
            (searchChange)="onUserSearch($event)"
          ></app-inputsearch>

          @if (isSearching()) {
            <p class="text-xs text-text-secondary">Buscando usuarios...</p>
          } @else if (searchTerm() && candidates().length === 0) {
            <p class="text-xs text-text-secondary">
              Sin usuarios que coincidan con "{{ searchTerm() }}".
            </p>
          } @else if (candidates().length > 0) {
            <ul class="flex flex-col divide-y divide-[var(--color-border)]">
              @for (candidate of candidates(); track candidate.id) {
                <li class="flex items-center justify-between gap-3 py-2">
                  <div class="min-w-0">
                    <p class="text-sm text-text-primary truncate">
                      {{ candidate.first_name }} {{ candidate.last_name }}
                    </p>
                    <p class="text-xs text-text-secondary truncate">
                      {{ candidate.email }}
                    </p>
                  </div>
                  <app-button
                    variant="outline"
                    size="sm"
                    iconName="user-plus"
                    [disabled]="isMutating() || isAlreadyAssigned(candidate.id)"
                    (clicked)="assign(candidate)"
                  >
                    {{ isAlreadyAssigned(candidate.id) ? 'Asignado' : 'Asignar' }}
                  </app-button>
                </li>
              }
            </ul>
          }
        </div>

        <!-- Asignados -->
        <div class="flex flex-col gap-2">
          <h4 class="text-sm font-semibold text-text-primary">
            Usuarios con este rol ({{ assignments().length }})
          </h4>

          @if (isLoading()) {
            <p class="text-xs text-text-secondary">Cargando asignaciones...</p>
          } @else if (assignments().length === 0) {
            <app-empty-state
              icon="users"
              title="Sin usuarios asignados"
              description="Busca un usuario arriba para asignarle este rol."
              [showActionButton]="false"
            ></app-empty-state>
          } @else {
            <ul class="flex flex-col divide-y divide-[var(--color-border)]">
              @for (item of assignments(); track item.assignment_id) {
                <li class="flex items-center justify-between gap-3 py-2">
                  <div class="min-w-0">
                    <p class="text-sm text-text-primary truncate">
                      {{ item.user.first_name }} {{ item.user.last_name }}
                    </p>
                    <p class="text-xs text-text-secondary truncate">
                      {{ item.user.email }}
                    </p>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <span
                      class="text-[11px] px-2 py-0.5 rounded-full border"
                      [style.color]="scopeColor()"
                      [style.borderColor]="scopeColor() + '40'"
                      [style.backgroundColor]="scopeColor() + '26'"
                    >
                      {{ item.store_name ?? 'Toda la organización' }}
                    </span>
                    <app-button
                      variant="ghost"
                      size="sm"
                      iconName="user-minus"
                      [disabled]="isMutating()"
                      (clicked)="confirmRemove(item)"
                    >
                      Quitar
                    </app-button>
                  </div>
                </li>
              }
            </ul>
          }
        </div>
      }
    </div>
  `,
})
export class RoleUsersPanelComponent {
  private readonly rolesService = inject(RolesService);
  private readonly usersService = inject(UsersService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly role = input<Role | null>(null);
  /** La pestaña sólo consulta cuando está visible: evita pedir por cada modal. */
  readonly active = input<boolean>(false);

  /** Notifica al padre para que refresque contadores del listado. */
  readonly changed = output<void>();

  readonly assignments = signal<RoleUserAssignment[]>([]);
  readonly candidates = signal<User[]>([]);
  readonly storeOptions = signal<{ id: number; name: string }[]>([]);
  readonly searchTerm = signal('');
  readonly isLoading = signal(false);
  readonly isSearching = signal(false);
  readonly isMutating = signal(false);

  /** Tienda elegida para la NUEVA asignación (`null` = org-wide). */
  readonly selectedStoreId = signal<number | null>(null);
  readonly storeControl = new FormControl<string>(ORG_WIDE, {
    nonNullable: true,
  });

  /** Clave de la última carga; evita recargar en cada ciclo del effect. */
  private lastLoadedRoleId: number | null = null;

  readonly scopeLabel = computed(() => getRoleScopeLabel(this.role()?.scope));
  readonly scopeColor = computed(() => {
    const scope = this.role()?.scope;
    return scope ? ROLE_SCOPE_COLOR_MAP[scope] : ROLE_SCOPE_COLOR_MAP.system;
  });
  readonly scopeIcon = computed(() => {
    const scope = this.role()?.scope;
    return scope ? ROLE_SCOPE_ICONS[scope] : 'shield-check';
  });

  readonly ownerLabel = computed(() => {
    const role = this.role();
    if (!role) return '';
    if (role.store_name) return `${role.organization_name} / ${role.store_name}`;
    return role.organization_name ?? '';
  });

  /**
   * Sólo el alcance ORGANIZACIÓN deja elegir tienda:
   * - `store`: el backend fuerza la tienda del rol (`ROLE_ASSIGN_007` si no).
   * - `system`: no tiene organización dueña, así que se asigna org-wide.
   */
  readonly canChooseStore = computed(() => this.role()?.scope === 'organization');

  readonly scopeHint = computed(() => {
    const role = this.role();
    if (!role) return '';
    if (role.scope === 'store') {
      return `Las asignaciones de este rol viven forzosamente en la tienda ${
        role.store_name ?? role.store_id
      }.`;
    }
    if (role.scope === 'organization') {
      return 'Puede asignarse a toda la organización o acotarse a una de sus tiendas.';
    }
    return 'Rol de sistema: la asignación se hace a nivel global del usuario (org-wide).';
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
      const role = this.role();
      const active = this.active();

      if (!active || !role) return;
      if (this.lastLoadedRoleId === role.id) return;

      this.lastLoadedRoleId = role.id;
      this.resetAssignmentDraft();
      this.loadAssignments(role.id);
      this.loadStoreOptions(role);
    });
  }

  onStoreChange(value: string | number | null): void {
    const parsed = value === null || value === ORG_WIDE ? null : Number(value);
    this.selectedStoreId.set(Number.isNaN(parsed as number) ? null : parsed);
  }

  onUserSearch(term: string): void {
    this.searchTerm.set(term);

    if (!term || term.trim().length < 2) {
      this.candidates.set([]);
      return;
    }

    this.isSearching.set(true);
    this.usersService
      .getUsers({ search: term.trim(), limit: 8, page: 1 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.candidates.set(response.data || []);
          this.isSearching.set(false);
        },
        error: () => {
          this.candidates.set([]);
          this.isSearching.set(false);
          this.toastService.error('Error al buscar usuarios');
        },
      });
  }

  isAlreadyAssigned(userId: number): boolean {
    const targetStore = this.resolveTargetStoreId();
    return this.assignments().some(
      (item) => item.user.id === userId && item.store_id === targetStore,
    );
  }

  assign(user: User): void {
    const role = this.role();
    if (!role) return;

    this.isMutating.set(true);
    this.rolesService
      .assignRoleToUser(role.id, user.id, this.resolveTargetStoreId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isMutating.set(false);
          this.toastService.success('Rol asignado al usuario');
          this.reload();
          this.changed.emit();
        },
        error: (error) => {
          this.isMutating.set(false);
          this.toastService.error(
            superadminRoleErrorMessage(error, 'Error al asignar el rol'),
          );
        },
      });
  }

  confirmRemove(item: RoleUserAssignment): void {
    const role = this.role();
    if (!role) return;

    const scopeText = item.store_name
      ? `en la tienda "${item.store_name}"`
      : 'en toda la organización';

    this.dialogService
      .confirm({
        title: 'Quitar rol',
        message: `¿Quitar el rol "${role.name}" a ${item.user.first_name} ${item.user.last_name} ${scopeText}?`,
        confirmText: 'Quitar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (!confirmed) return;

        this.isMutating.set(true);
        this.rolesService
          .removeRoleFromUser(role.id, item.user.id, item.store_id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.isMutating.set(false);
              this.toastService.success('Rol retirado del usuario');
              this.reload();
              this.changed.emit();
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

  private reload(): void {
    const role = this.role();
    if (role) this.loadAssignments(role.id);
  }

  /**
   * Tienda destino de la nueva asignación. Para un rol de tienda se ignora lo
   * elegido y se usa la del rol, que es lo único que el backend acepta.
   */
  private resolveTargetStoreId(): number | null {
    const role = this.role();
    if (!role) return null;
    if (role.scope === 'store') return role.store_id;
    if (role.scope === 'system') return null;
    return this.selectedStoreId();
  }

  private resetAssignmentDraft(): void {
    this.selectedStoreId.set(null);
    this.storeControl.setValue(ORG_WIDE, { emitEvent: false });
    this.candidates.set([]);
    this.searchTerm.set('');
  }

  private loadAssignments(roleId: number): void {
    this.isLoading.set(true);
    this.rolesService
      .getRoleUsers(roleId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.assignments.set(data);
          this.isLoading.set(false);
        },
        error: (error) => {
          this.assignments.set([]);
          this.isLoading.set(false);
          this.toastService.error(
            superadminRoleErrorMessage(
              error,
              'Error al cargar los usuarios del rol',
            ),
          );
        },
      });
  }

  private loadStoreOptions(role: Role): void {
    if (role.scope !== 'organization' || role.organization_id == null) {
      this.storeOptions.set([]);
      return;
    }

    this.rolesService
      .getStoreOptions(role.organization_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (options) => this.storeOptions.set(options),
        error: () => this.storeOptions.set([]),
      });
  }
}
