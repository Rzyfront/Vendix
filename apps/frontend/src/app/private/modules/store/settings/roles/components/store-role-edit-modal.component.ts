import {
  Component,
  OnChanges,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs/operators';

import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import {
  InputComponent,
  ButtonComponent,
  IconComponent,
  ModalComponent,
  ScrollableTabsComponent,
  ScrollableTab,
  ToastService,
} from '../../../../../../shared/components/index';
import {
  ROLE_SCOPE_ICONS,
  canEditRoleScope,
  getRoleReadOnlyReason,
  getRoleScopeLabel,
} from '../../../../../../shared/constants/role-scope.constant';
import { StoreRolesService } from '../services/store-roles.service';
import {
  StoreRole,
  UpdateStoreRoleDto,
} from '../interfaces/store-role.interface';
import { storeRoleErrorMessage } from '../utils/store-role-errors';
import { StoreRoleUsersPanelComponent } from './store-role-users-panel.component';

const ACTOR_LEVEL = 'store' as const;

export type StoreRoleDetailTab = 'general' | 'users';

/**
 * QUI-72 — Detalle del rol de tienda, ahora con pestañas.
 *
 * - `General`: los datos del rol. Sólo editable si `scope === 'store'`; para un
 *   rol de sistema o heredado de la organización se muestra en sólo lectura con
 *   el motivo exacto (el backend responde 403 `ROLE_SCOPE_001`).
 * - `Usuarios`: la dirección rol → usuarios que faltaba en este nivel.
 *
 * El modal se abre también para roles NO editables (desde la acción
 * "Usuarios"), por eso la pestaña General se defiende sola en vez de confiar en
 * que la acción "Editar" esté deshabilitada en el listado.
 */
@Component({
  selector: 'app-store-role-edit-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    ButtonComponent,
    IconComponent,
    ModalComponent,
    ScrollableTabsComponent,
    StoreRoleUsersPanelComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      [title]="'Rol: ' + (role()?.name || '')"
      [subtitle]="
        'Alcance: ' +
        scopeLabel() +
        (canEdit() ? '' : ' — sólo lectura en esta tienda')
      "
    >
      @if (role()) {
        <!-- Tabs -->
        <div class="bg-surface/50 rounded-lg p-1 mb-4">
          <app-scrollable-tabs
            [tabs]="tabItems()"
            [activeTab]="activeTab()"
            size="sm"
            (tabChange)="onTabChange($event)"
          />
        </div>

        @switch (activeTab()) {
          @case ('general') {
            @if (!canEdit()) {
              <div
                class="flex items-start gap-2 px-3 py-2 mb-3 rounded-lg border border-border bg-surface/50"
              >
                <app-icon
                  name="lock"
                  [size]="14"
                  class="text-text-secondary mt-0.5 shrink-0"
                />
                <p class="text-[11px] text-text-secondary">
                  {{ readOnlyReason() }}
                </p>
              </div>
            }

            <form [formGroup]="roleForm" (ngSubmit)="onSubmit()">
              <div class="space-y-4">
                <app-input
                  formControlName="name"
                  label="Nombre del Rol *"
                  placeholder="Ej: Cajero, Supervisor..."
                  [required]="true"
                  [control]="roleForm.get('name')"
                ></app-input>
                <app-input
                  formControlName="description"
                  label="Descripcion"
                  placeholder="Descripcion opcional del rol"
                  [control]="roleForm.get('description')"
                ></app-input>
              </div>

              <!-- Role Info -->
              <div class="mt-6 p-4 rounded-lg border border-border bg-surface/50">
                <h4 class="text-sm font-medium text-text-primary mb-2">
                  Informacion del Rol
                </h4>
                <div class="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span class="text-text-secondary">ID:</span>
                    <span class="ml-2 text-text-primary">{{ role()?.id }}</span>
                  </div>
                  <div>
                    <span class="text-text-secondary">Alcance:</span>
                    <span class="ml-2 text-text-primary">{{
                      scopeLabel()
                    }}</span>
                  </div>
                  <div>
                    <span class="text-text-secondary">Usuarios:</span>
                    <span class="ml-2 text-text-primary">{{
                      role()?._count?.user_roles || 0
                    }}</span>
                  </div>
                  <div>
                    <span class="text-text-secondary">Permisos:</span>
                    <span class="ml-2 text-text-primary">{{
                      role()?.permissions?.length || 0
                    }}</span>
                  </div>
                </div>
              </div>
            </form>
          }

          @case ('users') {
            <app-store-role-users-panel
              [role]="role()"
              [reloadToken]="reloadToken()"
              (assignmentsChanged)="onRoleUpdated.emit()"
            />
          }
        }
      }

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="outline"
          (clicked)="onCancel()"
          [disabled]="isUpdating()"
        >
          Cerrar
        </app-button>
        @if (activeTab() === 'general' && canEdit()) {
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="!formValid() || isUpdating()"
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
export class StoreRoleEditModalComponent implements OnChanges {
  private destroyRef = inject(DestroyRef);
  readonly role = model<StoreRole | null>(null);
  readonly isOpen = model<boolean>(false);
  /** Pestaña con la que se abre el detalle ('users' desde la acción Usuarios). */
  readonly initialTab = input<StoreRoleDetailTab>('general');
  readonly isOpenChange = output<boolean>();
  readonly onRoleUpdated = output<void>();

  readonly activeTab = signal<StoreRoleDetailTab>('general');
  readonly isUpdating = signal(false);
  /** Época de recarga de la pestaña Usuarios (se bumpea al abrir el modal). */
  readonly reloadToken = signal(0);

  private readonly fb = inject(FormBuilder);

  readonly roleForm: FormGroup = this.fb.group({
    name: [
      '',
      [Validators.required, Validators.minLength(2), Validators.maxLength(50)],
    ],
    description: [''],
  });

  /**
   * `form.invalid` NO es reactivo en zoneless: es una propiedad plana, no una
   * signal. Se puentea el estado con `statusChanges` para que el botón Guardar
   * no quede congelado en la validez inicial.
   */
  private readonly formStatus = toSignal(
    this.roleForm.statusChanges.pipe(startWith(this.roleForm.status)),
    { initialValue: this.roleForm.status },
  );
  readonly formValid = computed(() => this.formStatus() === 'VALID');

  private storeRolesService = inject(StoreRolesService);
  private toastService = inject(ToastService);

  readonly canEdit = computed(() =>
    canEditRoleScope(this.role()?.scope, ACTOR_LEVEL),
  );

  readonly readOnlyReason = computed(
    () => getRoleReadOnlyReason(this.role()?.scope, ACTOR_LEVEL) ?? '',
  );

  readonly scopeLabel = computed(() => getRoleScopeLabel(this.role()?.scope));

  readonly tabItems = computed<ScrollableTab[]>(() => [
    {
      id: 'general',
      label: 'General',
      icon: ROLE_SCOPE_ICONS[this.role()?.scope ?? 'store'],
    },
    { id: 'users', label: 'Usuarios', icon: 'users' },
  ]);

  ngOnChanges(): void {
    const currentRole = this.role();
    if (!currentRole) return;

    this.roleForm.patchValue({
      name: currentRole.name,
      description: currentRole.description || '',
    });

    // Sólo-lectura estructural: si el rol no es gestionable aquí, el formulario
    // ni siquiera acepta escritura.
    if (this.canEdit()) {
      this.roleForm.enable({ emitEvent: false });
    } else {
      this.roleForm.disable({ emitEvent: false });
    }

    if (this.isOpen()) {
      this.activeTab.set(this.initialTab());
      this.reloadToken.update((v) => v + 1);
    }
  }

  onTabChange(tabId: string): void {
    this.activeTab.set(tabId === 'users' ? 'users' : 'general');
  }

  onSubmit(): void {
    const currentRole = this.role();
    if (!currentRole || !this.canEdit()) return;
    if (this.roleForm.invalid || this.isUpdating()) {
      Object.keys(this.roleForm.controls).forEach((key) => {
        this.roleForm.get(key)?.markAsTouched();
      });
      return;
    }

    // OJO: el valor se lee ANTES de deshabilitar. `FormGroup.value` excluye los
    // controles deshabilitados, así que el orden inverso enviaba `{}` al PATCH.
    const roleData: UpdateStoreRoleDto = this.roleForm.value;
    this.isUpdating.set(true);
    this.roleForm.disable({ emitEvent: false });

    this.storeRolesService
      .updateRole(currentRole.id, roleData)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isUpdating.set(false);
          this.roleForm.enable({ emitEvent: false });
          this.toastService.success('Rol actualizado exitosamente');
          this.onRoleUpdated.emit();
          this.isOpenChange.emit(false);
        },
        error: (error: unknown) => {
          this.isUpdating.set(false);
          this.roleForm.enable({ emitEvent: false });
          console.error('Error updating store role:', error);
          this.toastService.error(
            storeRoleErrorMessage(error, 'Error al actualizar el rol'),
          );
        },
      });
  }

  onCancel(): void {
    // Se notifican los DOS canales: el `model()` para el binding two-way y el
    // output explícito `isOpenChange`, que es el que consume el contenedor.
    this.isOpen.set(false);
    this.isOpenChange.emit(false);
  }
}
