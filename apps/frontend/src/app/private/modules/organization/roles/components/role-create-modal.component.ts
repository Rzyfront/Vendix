import {
  Component,
  input,
  output,
  signal,
  inject,
  DestroyRef,
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
import { CreateRoleDto } from '../interfaces/role.interface';

@Component({
  selector: 'app-role-create-modal',
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
      title="Crear Nuevo Rol"
      subtitle="Completa el formulario para crear un nuevo rol en la organización"
      size="md"
    >
      <form [formGroup]="roleForm" (ngSubmit)="onSubmit()">
        <div class="space-y-4">
          <app-input
            formControlName="name"
            label="Nombre del Rol *"
            placeholder="Ej: Gerente de Ventas"
            [required]="true"
            [control]="roleForm.get('name')"
            [disabled]="isCreating()"
            helperText="Nombre único, mínimo 2 caracteres, máximo 50"
          ></app-input>

          <app-input
            formControlName="description"
            label="Descripción"
            placeholder="Describe las responsabilidades de este rol"
            [control]="roleForm.get('description')"
            [disabled]="isCreating()"
            helperText="Opcional, ayuda a otros administradores a entender el propósito del rol"
          ></app-input>

          <div class="p-4 bg-muted/20 rounded-lg">
            <div class="flex items-start gap-3">
              <app-icon name="info" [size]="20" class="text-primary mt-0.5"></app-icon>
              <div class="text-sm text-text-secondary">
                <p class="font-medium text-text-primary mb-1">Nota sobre Roles</p>
                <p>Los roles personalizados pueden ser editados y eliminados posteriormente.
                   Los roles del sistema no pueden ser modificados.</p>
              </div>
            </div>
          </div>
        </div>
      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="outline"
          (clicked)="onCancel()"
          [disabled]="isCreating()"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [disabled]="roleForm.invalid || isCreating()"
          [loading]="isCreating()"
        >
          Crear Rol
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
export class RoleCreateModalComponent {
  private destroyRef = inject(DestroyRef);
  private rolesService = inject(OrgRolesService);
  private fb = inject(FormBuilder);

  readonly isOpen = input<boolean>(false);
  readonly isCreating = input<boolean>(false);

  readonly isOpenChange = output<boolean>();
  readonly roleCreated = output<CreateRoleDto>();
  readonly cancel = output<void>();

  roleForm: FormGroup;

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

  onSubmit(): void {
    if (this.roleForm.invalid || this.isCreating()) {
      Object.keys(this.roleForm.controls).forEach((key) => {
        this.roleForm.get(key)?.markAsTouched();
      });
      return;
    }

    const roleData: CreateRoleDto = {
      name: this.roleForm.value.name.trim(),
      description: this.roleForm.value.description?.trim() || undefined,
    };

    this.roleCreated.emit(roleData);
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
}
