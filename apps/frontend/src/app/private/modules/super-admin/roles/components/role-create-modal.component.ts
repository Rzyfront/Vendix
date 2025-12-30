import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
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
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-role-create-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="onOpenChange($event)"
      title="Create New Role"
      subtitle="Fill in the details to create a new role"
      size="md"
      [showCloseButton]="true"
      (closed)="onCancel()"
    >
      <form [formGroup]="roleForm" (ngSubmit)="onSubmit()">
        <div class="space-y-6">
          <!-- Role Name -->
          <div class="form-group">
            <label for="name" class="form-label"> Role Name * </label>
            <input
              id="name"
              type="text"
              formControlName="name"
              class="form-input"
              placeholder="e.g., store_manager"
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
                >Role name is required</span
              >
              <span *ngIf="roleForm.get('name')?.errors?.['minlength']"
                >Role name must be at least 2 characters</span
              >
            </div>
          </div>

          <!-- Description -->
          <div class="form-group">
            <label for="description" class="form-label"> Description * </label>
            <textarea
              id="description"
              formControlName="description"
              rows="3"
              class="form-input"
              placeholder="Describe the role and its responsibilities"
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
                >Description is required</span
              >
              <span *ngIf="roleForm.get('description')?.errors?.['minlength']"
                >Description must be at least 10 characters</span
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
                  System Role
                </label>
                <p class="form-checkbox-description">
                  System roles cannot be modified or deleted after creation
                </p>
              </div>
            </div>
          </div>
        </div>
      </form>

      <div slot="footer" class="modal-footer">
        <button
          type="button"
          class="btn btn-secondary"
          (click)="onCancel()"
          [disabled]="isSubmitting"
        >
          Cancel
        </button>
        <button
          type="submit"
          class="btn btn-primary"
          [disabled]="isSubmitting || roleForm.invalid"
          (click)="onSubmit()"
        >
          <app-icon
            *ngIf="isSubmitting"
            name="refresh"
            class="animate-spin"
            size="16"
          ></app-icon>
          <span *ngIf="!isSubmitting">Create Role</span>
          <span *ngIf="isSubmitting">Creating...</span>
        </button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      .form-group {
        @apply mb-6;
      }

      .form-label {
        @apply block text-sm font-medium text-text-primary mb-2;
      }

      .form-input {
        @apply w-full px-3 py-2 border border-border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:border-primary transition-colors;
        background-color: var(--color-surface);
        color: var(--color-text-primary);
        focus-ring-color: rgba(var(--color-primary), 0.5);
      }

      .form-input:focus {
        background-color: var(--color-surface);
      }

      .form-input-error {
        border-color: var(--color-destructive);
        box-shadow: 0 0 0 1px var(--color-destructive);
      }

      .form-error {
        @apply mt-1 text-sm text-destructive;
      }

      .form-checkbox {
        @apply h-4 w-4 text-primary border-border rounded focus:ring-2;
        focus-ring-color: rgba(var(--color-primary), 0.5);
      }

      .form-checkbox-label {
        @apply block text-sm font-medium text-text-primary;
      }

      .form-checkbox-description {
        @apply mt-1 text-sm text-text-secondary;
      }

      .modal-footer {
        @apply flex justify-end gap-3;
      }

      .btn {
        @apply inline-flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2;
      }

      .btn-primary {
        background-color: var(--color-primary);
        color: var(--color-text-on-primary);
        border: 1px solid var(--color-primary);

        &:hover:not(:disabled) {
          background-color: var(--color-secondary);
          border-color: var(--color-secondary);
          transform: translateY(-1px);
          box-shadow: var(--shadow-sm);
        }

        &:focus {
          focus-ring-color: rgba(var(--color-primary), 0.5);
        }

        &:disabled {
          @apply opacity-50 cursor-not-allowed;
          transform: none;
        }
      }

      .btn-secondary {
        background-color: var(--color-surface);
        color: var(--color-text-primary);
        border: var(--border-width) solid var(--color-border);

        &:hover:not(:disabled) {
          background-color: var(--color-background);
          border-color: var(--color-text-secondary);
          transform: translateY(-1px);
          box-shadow: var(--shadow-sm);
        }

        &:focus {
          focus-ring-color: rgba(var(--color-muted), 0.5);
        }

        &:disabled {
          @apply opacity-50 cursor-not-allowed;
          transform: none;
        }
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .animate-spin {
        animation: spin 1s linear infinite;
      }
    `,
  ],
})
export class RoleCreateModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() isSubmitting = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() submit = new EventEmitter<CreateRoleDto>();
  @Output() cancel = new EventEmitter<void>();

  roleForm: FormGroup;

  constructor(private fb: FormBuilder) {
    this.roleForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      description: ['', [Validators.required, Validators.minLength(10)]],
      is_system_role: [false],
    });
  }

  onOpenChange(isOpen: any): void {
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
  ngOnChanges(): void {
    if (this.isOpen) {
      this.roleForm.reset({
        name: '',
        description: '',
        is_system_role: false,
      });
    }
  }
}
