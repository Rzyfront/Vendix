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
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import {
  ButtonComponent,
  IconComponent,
  ResponsiveDataViewComponent,
  StoreUserSelectComponent,
  ToastService,
  ItemListCardConfig,
  TableAction,
  TableColumn,
} from '../../../../../../shared/components/index';
import {
  canAssignRoleScope,
  getRoleNotAssignableReason,
} from '../../../../../../shared/constants/role-scope.constant';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import {
  StoreRole,
  StoreRoleUserAssignment,
} from '../interfaces/store-role.interface';
import { StoreRolesService } from '../services/store-roles.service';
import { storeRoleErrorMessage } from '../utils/store-role-errors';

const ACTOR_LEVEL = 'store' as const;

const USER_STATE_LABELS: Record<string, string> = {
  active: 'Activo',
  inactive: 'Inactivo',
  pending_verification: 'Pendiente',
  suspended: 'Suspendido',
  archived: 'Archivado',
};

const USER_STATE_COLOR_MAP: Record<string, string> = {
  active: '#10B981',
  inactive: '#6B7280',
  pending_verification: '#F59E0B',
  suspended: '#EF4444',
  archived: '#6B7280',
};

/**
 * QUI-72 — Pestaña "Usuarios" del detalle de un rol de tienda.
 *
 * Es la dirección que el nivel tienda no tenía: ROL → usuarios. Lee de
 * `GET /store/roles/:id/users` y escribe con POST/DELETE
 * `/store/roles/:id/users/:userId`, todo a través de `StoreRolesService`, que
 * es el MISMO servicio del que el modal de usuario toma su catálogo de roles.
 *
 * Dos motivos independientes hacen una fila de sólo lectura:
 *  1. La matriz de ASIGNACIÓN (`canAssignRoleScope`) no autoriza a este actor
 *     a manejar el rol — p. ej. un `manager` no puede asignar `admin` ni
 *     `fiscal_supervisor`. Un `owner` sí, porque `resolveAssignmentLevel` lo
 *     eleva a nivel organización (necesario para tenants de tienda única).
 *  2. La asignación es HEREDADA de la organización (`store_id === null`):
 *     aunque el rol sea asignable, esa fila concreta se administra desde el
 *     panel de la organización.
 */
@Component({
  selector: 'app-store-role-users-panel',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    StoreUserSelectComponent,
  ],
  template: `
    <div class="space-y-3">
      <!-- Header -->
      <div class="flex items-center gap-2.5">
        <div class="p-1.5 bg-primary/10 rounded-lg">
          <app-icon name="users" [size]="16" class="text-primary" />
        </div>
        <div class="min-w-0">
          <h4 class="text-sm font-semibold text-text-primary">
            Usuarios con este rol
          </h4>
          <p class="text-[10px] text-text-secondary">
            {{ assignments().length }} asignacion(es) visibles en esta tienda
          </p>
        </div>
      </div>

      @if (!canManage()) {
        <div
          class="flex items-start gap-2 px-3 py-2 rounded-lg border border-border bg-surface/50"
        >
          <app-icon
            name="lock"
            [size]="14"
            class="text-text-secondary mt-0.5 shrink-0"
          />
          <p class="text-[11px] text-text-secondary">{{ readOnlyReason() }}</p>
        </div>
      }

      <!-- Asignar usuario -->
      @if (canManage()) {
        <div
          class="flex flex-col gap-2 p-3 rounded-lg border border-border bg-surface/50 sm:flex-row sm:items-end"
        >
          <div class="flex-1 min-w-0">
            <label
              class="block text-[11px] font-medium text-text-secondary mb-1"
            >
              Asignar a un usuario
            </label>
            <app-store-user-select
              [formControl]="userToAssign"
              [excludeIds]="assignedUserIds()"
              placeholder="Buscar usuario de la tienda..."
            />
          </div>
          <app-button
            variant="primary"
            size="sm"
            [disabled]="!userToAssign.value || isSaving()"
            [loading]="isSaving()"
            (clicked)="onAssign()"
          >
            <app-icon slot="icon" name="user-plus" [size]="14" />
            Asignar
          </app-button>
        </div>
      }

      <!-- Lista -->
      @if (isLoading()) {
        <div class="p-6 text-center">
          <div
            class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
          ></div>
          <p class="mt-2 text-text-secondary text-sm">Cargando usuarios...</p>
        </div>
      } @else {
        <app-responsive-data-view
          [data]="assignments()"
          [columns]="columns"
          [cardConfig]="cardConfig"
          [actions]="tableActions"
          [hoverable]="true"
          emptyMessage="Ningun usuario tiene este rol en esta tienda"
          emptyIcon="users"
          tableSize="sm"
        />
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
export class StoreRoleUsersPanelComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly storeRolesService = inject(StoreRolesService);
  private readonly toast = inject(ToastService);
  private readonly authFacade = inject(AuthFacade);

  readonly role = input<StoreRole | null>(null);
  /** Época que fuerza una recarga (p. ej. al abrir el modal). */
  readonly reloadToken = input<number>(0);

  /** Se emite tras asignar/quitar para que el listado refresque contadores. */
  readonly assignmentsChanged = output<void>();

  readonly assignments = signal<StoreRoleUserAssignment[]>([]);
  readonly isLoading = signal(false);
  readonly isSaving = signal(false);

  readonly userToAssign = new FormControl<number | null>(null);

  /**
   * QUI-600 — La pregunta del panel "Usuarios con este rol" es de ASIGNACIÓN
   * ("¿puede darle este rol a un usuario?"), no de edición. Antes se usaba
   * `canEditRoleScope`, que devuelve `false` para todo `scope === 'system'`,
   * bloqueando al `owner` y al `admin` justamente sobre los roles que sí pueden
   * asignar (`admin`, `fiscal_supervisor` vía la elevación de `owner` a nivel
   * organización). `canAssignRoleScope` honra la matriz correcta y deja al
   * `manager` fuera del allowlist de tienda, igual que el backend.
   */
  readonly canManage = computed(() =>
    canAssignRoleScope(
      this.role() ?? { name: '', scope: null },
      ACTOR_LEVEL,
      this.authFacade.userRoles(),
    ),
  );

  readonly readOnlyReason = computed(
    () =>
      getRoleNotAssignableReason(
        this.role() ?? { name: '', scope: null },
        ACTOR_LEVEL,
        this.authFacade.userRoles(),
      ) ?? '',
  );

  readonly assignedUserIds = computed(() =>
    this.assignments().map((a) => a.user.id),
  );

  constructor() {
    effect(() => {
      const role = this.role();
      // Se lee para que la época dispare la recarga aunque el rol no cambie.
      this.reloadToken();
      if (!role) {
        this.assignments.set([]);
        return;
      }
      this.load(role.id);
    });
  }

  // ── Columnas / cards ─────────────────────────────────────────────────

  readonly columns: TableColumn[] = [
    {
      key: 'user.first_name',
      label: 'Usuario',
      priority: 1,
      transform: (_value: any, item: any) =>
        `${item?.user?.first_name ?? ''} ${item?.user?.last_name ?? ''}`.trim() ||
        '—',
    },
    {
      key: 'user.email',
      label: 'Email',
      priority: 2,
    },
    {
      key: 'user.state',
      label: 'Estado',
      priority: 2,
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: USER_STATE_COLOR_MAP,
        size: 'sm',
      },
      transform: (value: any) => USER_STATE_LABELS[value] ?? String(value ?? '—'),
    },
    {
      key: 'store_id',
      label: 'Origen',
      priority: 3,
      transform: (value: any, item: any) =>
        value == null ? 'Heredada de la organizacion' : (item?.store_name ?? 'Esta tienda'),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'user.first_name',
    titleTransform: (item: any) =>
      `${item?.user?.first_name ?? ''} ${item?.user?.last_name ?? ''}`.trim() ||
      'Usuario',
    subtitleKey: 'user.email',
    avatarFallbackIcon: 'user',
    badgeKey: 'user.state',
    badgeConfig: {
      type: 'custom',
      colorMap: USER_STATE_COLOR_MAP,
      size: 'sm',
    },
    badgeTransform: (value: any) =>
      USER_STATE_LABELS[value] ?? String(value ?? '—'),
    detailKeys: [
      {
        key: 'store_id',
        label: 'Origen',
        icon: 'store',
        transform: (value: any, item: any) =>
          value == null
            ? 'Heredada de la organizacion'
            : (item?.store_name ?? 'Esta tienda'),
      },
    ],
  };

  readonly tableActions: TableAction[] = [
    {
      label: 'Quitar',
      icon: 'user-minus',
      variant: 'danger',
      action: (item: StoreRoleUserAssignment) => {
        if (!this.isRemovable(item)) return;
        this.onRemove(item);
      },
      disabled: (item: StoreRoleUserAssignment) => !this.isRemovable(item),
      tooltip: (item: StoreRoleUserAssignment) => this.removeTooltip(item),
    },
  ];

  // ── Reglas de sólo lectura ───────────────────────────────────────────

  isInherited(item: StoreRoleUserAssignment): boolean {
    return item?.store_id == null;
  }

  isRemovable(item: StoreRoleUserAssignment): boolean {
    return this.canManage() && !this.isInherited(item) && !this.isSaving();
  }

  removeTooltip(item: StoreRoleUserAssignment): string {
    if (!this.canManage()) return this.readOnlyReason();
    if (this.isInherited(item)) {
      return 'Asignacion heredada de la organizacion: se quita desde el panel de la organizacion.';
    }
    return 'Quitar el rol a este usuario';
  }

  // ── Datos ────────────────────────────────────────────────────────────

  private load(roleId: number): void {
    this.isLoading.set(true);
    this.storeRolesService
      .getRoleUsers(roleId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.assignments.set(rows);
          this.isLoading.set(false);
        },
        error: (error) => {
          this.assignments.set([]);
          this.isLoading.set(false);
          this.toast.error(
            storeRoleErrorMessage(
              error,
              'Error al cargar los usuarios del rol',
            ),
          );
        },
      });
  }

  onAssign(): void {
    const role = this.role();
    const userId = this.userToAssign.value;
    if (!role || userId == null || this.isSaving() || !this.canManage()) return;

    this.isSaving.set(true);
    this.storeRolesService
      .assignRoleToUser(role.id, userId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isSaving.set(false);
          this.userToAssign.setValue(null);
          this.toast.success('Rol asignado al usuario');
          this.load(role.id);
          this.assignmentsChanged.emit();
        },
        error: (error) => {
          this.isSaving.set(false);
          this.toast.error(
            storeRoleErrorMessage(error, 'Error al asignar el rol'),
          );
        },
      });
  }

  onRemove(item: StoreRoleUserAssignment): void {
    const role = this.role();
    if (!role || this.isSaving()) return;

    this.isSaving.set(true);
    this.storeRolesService
      .removeRoleFromUser(role.id, item.user.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isSaving.set(false);
          this.toast.success('Rol retirado del usuario');
          this.load(role.id);
          this.assignmentsChanged.emit();
        },
        error: (error) => {
          this.isSaving.set(false);
          this.toast.error(
            storeRoleErrorMessage(error, 'Error al quitar el rol'),
          );
        },
      });
  }
}
