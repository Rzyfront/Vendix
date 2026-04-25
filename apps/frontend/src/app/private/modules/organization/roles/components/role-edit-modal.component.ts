import {
  Component,
  input,
  output,
  signal,
  inject,
  DestroyRef,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  IconComponent,
} from '../../../../../shared/components/index';
import { OrgRolesService } from '../services/org-roles.service';
import { Role, UpdateRoleDto } from '../interfaces/role.interface';

@Component({
  selector: 'app-role-edit-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [title]="'Editar Rol: ' + (role()?.name || '')"
      subtitle="Actualiza la información del rol seleccionado"
      size="md"
    >
      @if (role()) {
        <form [formGroup]="roleForm" (ngSubmit)="onSubmit()">
          <div class="space-y-4">
            <app-input
              formControlName="name"
              label="Nombre del Rol *"
              placeholder="Ej: Gerente de Ventas"
              [required]="true"
              [control]="roleForm.get('name')"
              [disabled]="isUpdating() || isSystemRole()"
              [helperText]="isSystemRole() ? 'Los roles del sistema no pueden cambiar su nombre' : 'Nombre único, mínimo 2 caracteres'"
            ></app-input>

            <app-input
              formControlName="description"
              label="Descripción"
              placeholder="Describe las responsabilidades de este rol"
              [control]="roleForm.get('description')"
              [disabled]="isUpdating() || isSystemRole()"
            ></app-input>

            <!-- System Role Badge -->
            @if (isSystemRole()) {
              <div class="flex items-center gap-2 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                <app-icon name="lock" [size]="16" class="text-purple-600"></app-icon>
                <span class="text-sm text-purple-700 dark:text-purple-300">
                  Este es un rol del sistema y no puede ser modificado
                </span>
              </div>
            }

            <!-- Role Info -->
            <div class="p-4 bg-muted/20 rounded-lg space-y-2">
              <h4 class="text-sm font-medium text-text-primary mb-2">Información del Rol</h4>
              <div class="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span class="text-text-secondary">ID:</span>
                  <span class="ml-2 text-text-primary">{{ role()?.id }}</span>
                </div>
                <div>
                  <span class="text-text-secondary">Usuarios:</span>
                  <span class="ml-2 text-text-primary">{{ role()?._count?.user_roles || 0 }}</span>
                </div>
                <div>
                  <span class="text-text-secondary">Creado:</span>
                  <span class="ml-2 text-text-primary">{{ formatDate(role()?.created_at) }}</span>
                </div>
                <div>
                  <span class="text-text-secondary">Actualizado:</span>
                  <span class="ml-2 text-text-primary">{{ formatDate(role()?.updated_at) }}</span>
                </div>
              </div>
            </div>

            <!-- Permissions Summary -->
            @if (role()?.permissions && role()!.permissions!.length > 0) {
              <div class="p-4 bg-muted/20 rounded-lg">
                <h4 class="text-sm font-medium text-text-primary mb-2">
                  Permisos Asignados ({{ role()!.permissions!.length }})
                </h4>
                <div class="flex flex-wrap gap-2">
                  @for (perm of role()!.permissions!.slice(0, 5); track perm) {
                    <span class="px-2 py-1 bg-surface border border-border rounded text-xs text-text-secondary">
                      {{ perm }}
                    </span>
                  }
                  @if (role()!.permissions!.length > 5) {
                    <span class="px-2 py-1 bg-muted rounded text-xs text-text-secondary">
                      +{{ role()!.permissions!.length - 5 }} más
                    </span>
                  }
                </div>
              </div>
            }
          </div>
        </form>
      }

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="outline"
          (clicked)="onCancel()"
          [disabled]="isUpdating()"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [disabled]="roleForm.invalid || isUpdating() || isSystemRole()"
          [loading]="isUpdating()"
        >
          Actualizar Rol
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [`
    :host {
      display: block;
    }
  `],
})
export class RoleEditModalComponent implements OnChanges {
  private destroyRef = inject(DestroyRef);
  private rolesService = inject(OrgRolesService);
  private fb = inject(FormBuilder);

  readonly isOpen = input<boolean>(false);
  readonly role = input<Role | null>(null);
  readonly isUpdating = input<boolean>(false);

  readonly isOpenChange = output<boolean>();
  readonly roleUpdated = output<UpdateRoleDto>();
  readonly cancel = output<void>();

  roleForm: FormGroup;

  isSystemRole(): boolean {
    return this.role()?.system_role ?? false;
  }

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
  }

  ngOnChanges(changes: SimpleChanges): void {
    const role = this.role();
    if (role) {
      this.roleForm.patchValue({
        name: role.name,
        description: role.description || '',
      });
    }
  }

  onSubmit(): void {
    if (this.roleForm.invalid || this.isUpdating() || this.isSystemRole()) {
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
