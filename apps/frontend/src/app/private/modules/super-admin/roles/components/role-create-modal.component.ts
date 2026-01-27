import {
  Component,
  input,
  output,
  OnChanges,
  inject,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { CreateRoleDto } from '../interfaces/role.interface';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';

@Component({
  selector: 'app-role-create-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      title="Crear Nuevo Rol"
      subtitle="Complete los detalles para crear un nuevo rol"
      size="md"
      [showCloseButton]="true"
      (closed)="onCancel()"
    >
      <form [formGroup]="roleForm" (ngSubmit)="onSubmit()">
        <div class="space-y-6">
          <!-- Role Name -->
          <div class="form-group">
            <label for="name" class="form-label"> Nombre del Rol * </label>
            <input
              id="name"
              type="text"
              formControlName="name"
              class="form-input"
              placeholder="ej., store_manager"
              [class.form-input-error]="
                roleForm.get('name')?.invalid && roleForm.get('name')?.touched
              "
            />
            <div
              *ngIf="
                roleForm.get('name')?.invalid && roleForm.get('name')?.touched
              "
              class="form-error"
            >
              <span *ngIf="roleForm.get('name')?.errors?.['required']"
                >El nombre es requerido</span
              >
              <span *ngIf="roleForm.get('name')?.errors?.['minlength']"
                >El nombre debe tener al menos 2 caracteres</span
              >
            </div>
          </div>

          <!-- Description -->
          <div class="form-group">
            <label for="description" class="form-label"> Descripción * </label>
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
            <div
              *ngIf="
                roleForm.get('description')?.invalid &&
                roleForm.get('description')?.touched
              "
              class="form-error"
            >
              <span *ngIf="roleForm.get('description')?.errors?.['required']"
                >La descripción es requerida</span
              >
              <span *ngIf="roleForm.get('description')?.errors?.['minlength']"
                >La descripción debe tener al menos 10 caracteres</span
              >
            </div>
          </div>

          <!-- System Role Checkbox -->
          <div class="form-group">
            <div class="flex items-start">
              <div class="flex items-center h-5">
                <input
                  id="is_system_role"
                  type="checkbox"
                  formControlName="is_system_role"
                  class="form-checkbox"
                />
              </div>
              <div class="ml-3">
                <label for="is_system_role" class="form-checkbox-label">
                  Rol de Sistema
                </label>
                <p class="form-checkbox-description">
                  Los roles de sistema no pueden ser modificados o eliminados después de creados
                </p>
              </div>
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
            <span *ngIf="!isSubmitting()">Crear Rol</span>
            <span *ngIf="isSubmitting()">Creando...</span>
          </app-button>
        </div>
      </form>
    </app-modal>
  `,
  styleUrls: ['./role-create-modal.component.scss'],
})
export class RoleCreateModalComponent implements OnChanges {
  // Signals
  readonly isOpen = input<boolean>(false);
  readonly isSubmitting = input<boolean>(false);

  // Outputs
  readonly isOpenChange = output<boolean>();
  readonly submit = output<CreateRoleDto>();
  readonly cancel = output<void>();

  roleForm: FormGroup;
  private fb = inject(FormBuilder);

  constructor() {
    this.roleForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      description: ['', [Validators.required, Validators.minLength(10)]],
      is_system_role: [false],
    });
  }

  onOpenChange(isOpen: boolean): void {
    if (!isOpen) {
      this.onCancel();
    }
    this.isOpenChange.emit(isOpen);
  }

  onSubmit(): void {
    if (this.roleForm.valid) {
      const roleData: CreateRoleDto = {
        name: this.roleForm.value.name,
        description: this.roleForm.value.description,
        is_system_role: this.roleForm.value.is_system_role || false,
      };
      this.submit.emit(roleData);
    } else {
      this.roleForm.markAllAsTouched();
    }
  }

  onCancel(): void {
    this.cancel.emit();
    this.roleForm.reset({
      name: '',
      description: '',
      is_system_role: false,
    });
  }

  // Reset form when modal opens
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && changes['isOpen'].currentValue) {
      this.roleForm.reset({
        name: '',
        description: '',
        is_system_role: false,
      });
    }
  }
}
