import {
  Component,
  computed,
  effect,
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

import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  IconComponent,
} from '../../../../../shared/components/index';
import {
  ROLE_SCOPE_COLOR_MAP,
  ROLE_SCOPE_ICONS,
  canAssignRoleScope,
  canEditRoleScope,
  getRoleReadOnlyReason,
  getRoleScopeLabel,
} from '../../../../../shared/constants/role-scope.constant';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { Role, UpdateRoleDto } from '../interfaces/role.interface';
import { RoleUsersPanelComponent } from './role-users-panel.component';

type RoleDetailTab = 'general' | 'users';

/**
 * QUI-72 — detalle del rol en el nivel ORGANIZACIÓN.
 *
 * Deja de ser un modal de sólo edición: ahora tiene pestaña "Usuarios" (la
 * dirección rol → usuario que el nivel organización no exponía) y respeta la
 * matriz de alcance. Un rol de SISTEMA se abre en sólo lectura completa: el
 * backend responde 403 `ROLE_SCOPE_001` y antes ese 403 llegaba como
 * `200 { success:false }`, así que la UI mostraba "guardado" sin haber guardado.
 */
@Component({
  selector: 'app-role-edit-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    IconComponent,
    RoleUsersPanelComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [title]="modalTitle()"
      [subtitle]="modalSubtitle()"
      size="lg"
    >
      @if (role()) {
        <div class="flex border-b border-[var(--color-border)] mb-4">
          <button
            type="button"
            class="px-4 py-2 text-sm font-medium border-b-2 transition-colors focus:outline-none"
            [class.border-primary]="activeTab() === 'general'"
            [class.text-primary]="activeTab() === 'general'"
            [class.border-transparent]="activeTab() !== 'general'"
            [class.text-text-secondary]="activeTab() !== 'general'"
            (click)="activeTab.set('general')"
          >
            General
          </button>
          <button
            type="button"
            class="px-4 py-2 text-sm font-medium border-b-2 transition-colors focus:outline-none"
            [class.border-primary]="activeTab() === 'users'"
            [class.text-primary]="activeTab() === 'users'"
            [class.border-transparent]="activeTab() !== 'users'"
            [class.text-text-secondary]="activeTab() !== 'users'"
            (click)="activeTab.set('users')"
          >
            Usuarios
          </button>
        </div>

        @if (readOnlyReason()) {
          <div
            class="flex items-start gap-2 p-3 mb-4 rounded-lg border"
            [style.background-color]="scopeBg()"
            [style.border-color]="scopeBorder()"
          >
            <app-icon
              name="lock"
              [size]="16"
              class="mt-0.5"
              [style.color]="scopeColor()"
            ></app-icon>
            <span class="text-sm text-[var(--color-text-primary)]">
              {{ readOnlyReason() }}
            </span>
          </div>
        }

        @if (activeTab() === 'general') {
          <form [formGroup]="roleForm" (ngSubmit)="onSubmit()">
            <div class="space-y-4">
              <app-input
                formControlName="name"
                label="Nombre del Rol *"
                placeholder="Ej: Gerente de Ventas"
                [required]="true"
                [control]="roleForm.get('name')"
                [disabled]="isUpdating() || !canEdit()"
                [helperText]="
                  canEdit()
                    ? 'Nombre único, mínimo 2 caracteres'
                    : 'Este rol no se puede renombrar desde la organización'
                "
              ></app-input>

              <app-input
                formControlName="description"
                label="Descripción"
                placeholder="Describe las responsabilidades de este rol"
                [control]="roleForm.get('description')"
                [disabled]="isUpdating() || !canEdit()"
              ></app-input>

              <div class="p-4 bg-muted/20 rounded-lg space-y-2">
                <h4 class="text-sm font-medium text-text-primary mb-2">
                  Información del Rol
                </h4>
                <div class="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span class="text-text-secondary">ID:</span>
                    <span class="ml-2 text-text-primary">{{ role()?.id }}</span>
                  </div>
                  <div>
                    <span class="text-text-secondary">Alcance:</span>
                    <span class="ml-2 text-text-primary">
                      {{ scopeLabel() }}
                    </span>
                  </div>
                  <div>
                    <span class="text-text-secondary">Tienda:</span>
                    <span class="ml-2 text-text-primary">
                      {{ role()?.store_name || '—' }}
                    </span>
                  </div>
                  <div>
                    <span class="text-text-secondary">Usuarios:</span>
                    <span class="ml-2 text-text-primary">
                      {{ role()?._count?.user_roles || 0 }}
                    </span>
                  </div>
                  <div>
                    <span class="text-text-secondary">Creado:</span>
                    <span class="ml-2 text-text-primary">
                      {{ formatDate(role()?.created_at) }}
                    </span>
                  </div>
                  <div>
                    <span class="text-text-secondary">Actualizado:</span>
                    <span class="ml-2 text-text-primary">
                      {{ formatDate(role()?.updated_at) }}
                    </span>
                  </div>
                </div>
              </div>

              @if (role()?.permissions && role()!.permissions!.length > 0) {
                <div class="p-4 bg-muted/20 rounded-lg">
                  <h4 class="text-sm font-medium text-text-primary mb-2">
                    Permisos Asignados ({{ role()!.permissions!.length }})
                  </h4>
                  <div class="flex flex-wrap gap-2">
                    @for (perm of role()!.permissions!.slice(0, 5); track perm) {
                      <span
                        class="px-2 py-1 bg-surface border border-border rounded text-xs text-text-secondary"
                      >
                        {{ perm }}
                      </span>
                    }
                    @if (role()!.permissions!.length > 5) {
                      <span
                        class="px-2 py-1 bg-muted rounded text-xs text-text-secondary"
                      >
                        +{{ role()!.permissions!.length - 5 }} más
                      </span>
                    }
                  </div>
                </div>
              }
            </div>
          </form>
        }

        @if (activeTab() === 'users') {
          <app-role-users-panel
            [role]="role()"
            [canManage]="canAssign()"
            (changed)="usersChanged.emit()"
          ></app-role-users-panel>
        }
      }

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="outline"
          (clicked)="onCancel()"
          [disabled]="isUpdating()"
        >
          {{ canEdit() && activeTab() === 'general' ? 'Cancelar' : 'Cerrar' }}
        </app-button>
        @if (canEdit() && activeTab() === 'general') {
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="roleForm.invalid || isUpdating()"
            [loading]="isUpdating()"
          >
            Actualizar Rol
          </app-button>
        }
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
export class RoleEditModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authFacade = inject(AuthFacade);

  readonly isOpen = input<boolean>(false);
  readonly role = input<Role | null>(null);
  readonly isUpdating = input<boolean>(false);

  readonly isOpenChange = output<boolean>();
  readonly roleUpdated = output<UpdateRoleDto>();
  readonly cancel = output<void>();
  /** Se emite al asignar/quitar usuarios para que el listado recargue contadores. */
  readonly usersChanged = output<void>();

  readonly activeTab = signal<RoleDetailTab>('general');

  readonly roleForm: FormGroup;

  /**
   * Espejo de la matriz del backend. Sirve para OCULTAR acciones, no para
   * autorizar: la autorización real responde 403 tipado.
   */
  readonly canEdit = computed(() =>
    canEditRoleScope(this.role()?.scope, 'organization'),
  );

  /**
   * QUI-600 — Matriz de ASIGNACIÓN, distinta de la de edición. `canEdit`
   * gatea "¿puede cambiar qué significa este rol?" (no, para `system`); esta
   * gatea "¿puede dárselo a un usuario?" (sí, es gestión de personal). Sin la
   * separación, el panel "Usuarios" se bloqueaba para `owner` y `admin` sobre
   * roles de sistema — justamente el único panel donde un tenant de tienda
   * única puede asignarlos.
   */
  readonly canAssign = computed(() =>
    canAssignRoleScope(
      this.role() ?? { name: '', scope: null },
      'organization',
      this.authFacade.userRoles(),
    ),
  );

  readonly readOnlyReason = computed(() =>
    getRoleReadOnlyReason(this.role()?.scope, 'organization'),
  );

  readonly scopeLabel = computed(() => getRoleScopeLabel(this.role()?.scope));

  readonly modalTitle = computed(() => {
    const role = this.role();
    if (!role) return 'Detalle del Rol';
    return this.canEdit()
      ? `Editar Rol: ${role.name}`
      : `Rol: ${role.name} (sólo lectura)`;
  });

  readonly modalSubtitle = computed(() => {
    const role = this.role();
    if (!role) return '';
    if (role.scope === 'store' && role.store_name) {
      return `Alcance ${this.scopeLabel()} · ${role.store_name}`;
    }
    return `Alcance ${this.scopeLabel()}`;
  });

  constructor() {
    this.roleForm = this.fb.group({
      name: [
        '',
        [
          Validators.required,
          Validators.minLength(2),
          Validators.maxLength(50),
          Validators.pattern(/^[a-zA-Z0-9_\s-]+$/),
        ],
      ],
      description: ['', [Validators.maxLength(255)]],
    });

    // Se hidrata desde el input signal en vez de `ngOnChanges`: con inputs de
    // señal el efecto se dispara exactamente cuando cambia el rol.
    effect(() => {
      const role = this.role();
      if (!role) return;
      this.roleForm.patchValue({
        name: role.name,
        description: role.description || '',
      });
    });

    // Cada apertura arranca en General; si no, el modal recuerda la pestaña
    // del rol anterior y se ve un panel de usuarios que no corresponde.
    effect(() => {
      if (this.isOpen()) {
        this.activeTab.set('general');
      }
    });
  }

  scopeColor(): string {
    const scope = this.role()?.scope;
    return scope ? ROLE_SCOPE_COLOR_MAP[scope] : '#64748B';
  }

  scopeBg(): string {
    return `${this.scopeColor()}26`;
  }

  scopeBorder(): string {
    return `${this.scopeColor()}40`;
  }

  scopeIcon(): string {
    const scope = this.role()?.scope;
    return scope ? ROLE_SCOPE_ICONS[scope] : 'shield';
  }

  onSubmit(): void {
    if (this.roleForm.invalid || this.isUpdating() || !this.canEdit()) {
      Object.keys(this.roleForm.controls).forEach((key) => {
        this.roleForm.get(key)?.markAsTouched();
      });
      return;
    }

    const roleData: UpdateRoleDto = {
      name: this.roleForm.value.name?.trim() || undefined,
      description: this.roleForm.value.description?.trim() || undefined,
    };

    this.roleUpdated.emit(roleData);
  }

  onCancel(): void {
    this.cancel.emit();
    this.isOpenChange.emit(false);
    this.resetForm();
  }

  resetForm(): void {
    this.roleForm.reset({
      name: '',
      description: '',
    });
  }

  formatDate(dateString?: string): string {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
}
