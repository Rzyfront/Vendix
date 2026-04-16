import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnDestroy,
  inject,
} from '@angular/core';

import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import {
  InputComponent,
  ButtonComponent,
  ModalComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { StoreRolesService } from '../services/store-roles.service';
import { StoreRole, UpdateStoreRoleDto } from '../interfaces/store-role.interface';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-store-role-edit-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    ButtonComponent,
    ModalComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      title="Editar Rol"
      subtitle="Actualiza la informacion del rol seleccionado"
      >
      @if (role) {
        <form [formGroup]="roleForm" (ngSubmit)="onSubmit()">
          <div class="space-y-4">
            <app-input
              formControlName="name"
              label="Nombre del Rol *"
              placeholder="Ej: Cajero, Supervisor..."
              [required]="true"
              [control]="roleForm.get('name')"
              [disabled]="isUpdating"
            ></app-input>
            <app-input
              formControlName="description"
              label="Descripcion"
              placeholder="Descripcion opcional del rol"
              [control]="roleForm.get('description')"
              [disabled]="isUpdating"
            ></app-input>
          </div>
          <!-- Role Info -->
          <div class="mt-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Informacion del Rol
            </h4>
            <div class="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span class="text-gray-500 dark:text-gray-400">ID:</span>
                <span class="ml-2 text-gray-900 dark:text-gray-100">{{ role.id }}</span>
              </div>
              <div>
                <span class="text-gray-500 dark:text-gray-400">Tipo:</span>
                <span class="ml-2 text-gray-900 dark:text-gray-100">{{ role.system_role ? 'Sistema' : 'Personalizado' }}</span>
              </div>
              <div>
                <span class="text-gray-500 dark:text-gray-400">Usuarios:</span>
                <span class="ml-2 text-gray-900 dark:text-gray-100">{{ role._count?.user_roles || 0 }}</span>
              </div>
              <div>
                <span class="text-gray-500 dark:text-gray-400">Permisos:</span>
                <span class="ml-2 text-gray-900 dark:text-gray-100">{{ role.permissions.length || 0 }}</span>
              </div>
            </div>
          </div>
        </form>
      }
    
      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="outline"
          (clicked)="onCancel()"
          [disabled]="isUpdating"
          >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [disabled]="roleForm.invalid || isUpdating"
          [loading]="isUpdating"
          >
          Actualizar Rol
        </app-button>
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
export class StoreRoleEditModalComponent implements OnDestroy {
  @Input() role: StoreRole | null = null;
  @Input() isOpen: boolean = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() onRoleUpdated = new EventEmitter<void>();

  roleForm: FormGroup;
  isUpdating: boolean = false;
  private destroy$ = new Subject<void>();

  private storeRolesService = inject(StoreRolesService);
  private toastService = inject(ToastService);

  constructor(private fb: FormBuilder) {
    this.roleForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50)]],
      description: [''],
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnChanges(): void {
    if (this.role) {
      this.roleForm.patchValue({
        name: this.role.name,
        description: this.role.description || '',
      });
    }
  }

  onSubmit(): void {
    if (this.roleForm.invalid || this.isUpdating || !this.role) {
      Object.keys(this.roleForm.controls).forEach((key) => {
        this.roleForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.isUpdating = true;
    const roleData: UpdateStoreRoleDto = this.roleForm.value;

    this.storeRolesService
      .updateRole(this.role.id, roleData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isUpdating = false;
          this.toastService.success('Rol actualizado exitosamente');
          // TODO: The 'emit' function requires a mandatory void argument
          // TODO: The 'emit' function requires a mandatory void argument
          // TODO: The 'emit' function requires a mandatory void argument
          // TODO: The 'emit' function requires a mandatory void argument
          // TODO: The 'emit' function requires a mandatory void argument
          this.onRoleUpdated.emit();
          this.isOpenChange.emit(false);
        },
        error: (error: any) => {
          this.isUpdating = false;
          console.error('Error updating store role:', error);
          const message =
            error?.error?.message || 'Error al actualizar el rol';
          this.toastService.error(message);
        },
      });
  }

  onCancel(): void {
    this.isOpen = false;
    this.isOpenChange.emit(false);
  }
}
