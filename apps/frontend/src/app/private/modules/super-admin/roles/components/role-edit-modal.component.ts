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
import { Role, UpdateRoleDto } from '../interfaces/role.interface';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';

@Component({
  selector: 'app-role-edit-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    IconComponent,
    ButtonComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      title="Editar Rol"
      subtitle="Modificar detalles del rol"
      size="md"
      [showCloseButton]="true"
      (closed)="onCancel()"
    >
      <form [formGroup]="roleForm" (ngSubmit)="onSubmit()">
        <div class="space-y-6">
          <!-- System Role Warning -->
          <div *ngIf="role()?.is_system_role" class="warning-banner">
            <app-icon name="warning" size="20" class="warning-icon"></app-icon>
            <div class="warning-content">
              <h4 class="warning-title">Rol de Sistema</h4>
              <p class="warning-message">
                Este es un rol de sistema y no modificado completamente. Solo la descripción puede ser actualizada.
              </p>
            </div>
          </div>

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
              [readonly]="role()?.is_system_role"
              [class.form-input-disabled]="role()?.is_system_role"
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

          <!-- Role Info -->
          <div class="info-card">
            <h4 class="info-title">Información del Rol</h4>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">ID de Rol:</span>
                <span class="info-value">{{ role()?.id }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Rol de Sistema:</span>
                <span
                  class="info-value"
                  [class.info-value-danger]="role()?.is_system_role"
                  [class.info-value-success]="!role()?.is_system_role"
                >
                  {{ role()?.is_system_role ? 'Si' : 'No' }}
                </span>
              </div>
              <div class="info-item">
                <span class="info-label">Creado:</span>
                <span class="info-value">{{
                  formatDate(role()?.created_at)
                }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Actualizado:</span>
                <span class="info-value">{{
                  formatDate(role()?.updated_at)
                }}</span>
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
            <span *ngIf="!isSubmitting()">Actualizar Rol</span>
            <span *ngIf="isSubmitting()">Actualizando...</span>
          </app-button>
        </div>
      </form>
    </app-modal>
  `,
  styleUrls: ['./role-edit-modal.component.scss'],
})
export class RoleEditModalComponent implements OnChanges {
  // Signals
  readonly isOpen = input<boolean>(false);
  readonly isSubmitting = input<boolean>(false);
  readonly role = input<Role | null>(null);

  // Outputs
  readonly isOpenChange = output<boolean>();
  readonly submit = output<UpdateRoleDto>();
  readonly cancel = output<void>();

  roleForm: FormGroup;
  private fb = inject(FormBuilder);

  constructor() {
    this.roleForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      description: ['', [Validators.required, Validators.minLength(10)]],
    });
  }

  onOpenChange(isOpen: boolean): void {
    if (!isOpen) {
      this.onCancel();
    }
    this.isOpenChange.emit(isOpen);
  }

  ngOnChanges(changes: SimpleChanges): void {
    const currentRole = this.role();
    if (changes['isOpen'] && changes['isOpen'].currentValue && currentRole) {
      this.roleForm.patchValue({
        name: currentRole.name,
        description: currentRole.description,
      });

      // Disable name field for system roles
      if (currentRole.is_system_role) {
        this.roleForm.get('name')?.disable();
      } else {
        this.roleForm.get('name')?.enable();
      }
    }
  }

  onSubmit(): void {
    const currentRole = this.role();
    if (this.roleForm.valid && currentRole) {
      const roleData: UpdateRoleDto = {
        name: this.roleForm.get('name')?.value,
        description: this.roleForm.get('description')?.value,
      };

      // Only include name if it's not a system role
      if (currentRole.is_system_role) {
        delete roleData.name;
      }

      this.submit.emit(roleData);
    } else {
      this.roleForm.markAllAsTouched();
    }
  }

  onCancel(): void {
    this.cancel.emit();
  }

  formatDate(dateString?: string): string {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
