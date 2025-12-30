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
import { Role, UpdateRoleDto } from '../interfaces/role.interface';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-role-edit-modal',
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
      title="Edit Role"
      subtitle="Modify the role details and permissions"
      size="md"
      [showCloseButton]="true"
      (closed)="onCancel()"
    >
      <form [formGroup]="roleForm" (ngSubmit)="onSubmit()">
        <div class="space-y-6">
          <!-- System Role Warning -->
          <div *ngIf="role?.is_system_role" class="warning-banner">
            <app-icon name="warning" size="20" class="warning-icon"></app-icon>
            <div class="warning-content">
              <h4 class="warning-title">System Role</h4>
              <p class="warning-message">
                This is a system role and cannot be modified. Only description
                can be updated.
              </p>
            </div>
          </div>

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
              [readonly]="role?.is_system_role"
              [class.form-input-disabled]="role?.is_system_role"
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

          <!-- Role Info -->
          <div class="info-card">
            <h4 class="info-title">Role Information</h4>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">Role ID:</span>
                <span class="info-value">{{ role?.id }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">System Role:</span>
                <span
                  class="info-value"
                  [class.info-value-danger]="role?.is_system_role"
                  [class.info-value-success]="!role?.is_system_role"
                >
                  {{ role?.is_system_role ? 'Yes' : 'No' }}
                </span>
              </div>
              <div class="info-item">
                <span class="info-label">Created:</span>
                <span class="info-value">{{
                  formatDate(role?.created_at)
                }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Last Updated:</span>
                <span class="info-value">{{
                  formatDate(role?.updated_at)
                }}</span>
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
          <span *ngIf="!isSubmitting">Update Role</span>
          <span *ngIf="isSubmitting">Updating...</span>
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

      .form-input-disabled {
        background-color: var(--color-background);
        color: var(--color-text-muted);
        cursor: not-allowed;
      }

      .form-error {
        @apply mt-1 text-sm text-destructive;
      }

      .warning-banner {
        @apply flex items-start p-4 mb-6 rounded-md border;
        background-color: rgba(251, 191, 36, 0.1);
        border-color: rgba(251, 191, 36, 0.3);
        color: #92400e;
      }

      .warning-icon {
        flex-shrink: 0;
        margin-right: 12px;
        color: #f59e0b;
      }

      .warning-content {
        flex: 1;
      }

      .warning-title {
        @apply text-sm font-medium mb-1;
        color: #92400e;
      }

      .warning-message {
        @apply text-sm;
        color: #b45309;
      }

      .info-card {
        @apply p-4 rounded-md border;
        background-color: var(--color-background);
        border-color: var(--color-border);
      }

      .info-title {
        @apply text-sm font-medium text-text-primary mb-3;
      }

      .info-grid {
        @apply space-y-2;
      }

      .info-item {
        @apply flex justify-between text-sm;
      }

      .info-label {
        color: var(--color-text-secondary);
      }

      .info-value {
        font-family: var(--font-primary);
        color: var(--color-text-primary);
      }

      .info-value-danger {
        color: var(--color-destructive);
      }

      .info-value-success {
        color: #059669;
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
export class RoleEditModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() isSubmitting = false;
  @Input() role: Role | null = null;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() submit = new EventEmitter<UpdateRoleDto>();
  @Output() cancel = new EventEmitter<void>();

  roleForm: FormGroup;

  constructor(private fb: FormBuilder) {
    this.roleForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      description: ['', [Validators.required, Validators.minLength(10)]],
    });
  }

  onOpenChange(isOpen: any): void {
    if (!isOpen) {
      this.onCancel();
    }
    this.isOpenChange.emit(isOpen);
  }

  ngOnChanges(): void {
    if (this.isOpen && this.role) {
      this.roleForm.patchValue({
        name: this.role.name,
        description: this.role.description,
      });

      // Disable name field for system roles
      if (this.role.is_system_role) {
        this.roleForm.get('name')?.disable();
      } else {
        this.roleForm.get('name')?.enable();
      }
    }
  }

  onSubmit(): void {
    if (this.roleForm.valid && this.role) {
      const roleData: UpdateRoleDto = {
        name: this.roleForm.get('name')?.value,
        description: this.roleForm.get('description')?.value,
      };

      // Only include name if it's not a system role
      if (this.role.is_system_role) {
        delete roleData.name;
      }

      this.submit.emit(roleData);
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
