import {Component,
  input,
  output,
  model,
  inject,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators} from '@angular/forms';
import {
  InputComponent,
  ButtonComponent,
  ModalComponent,
  ToastService} from '../../../../../../shared/components/index';
import { StoreRolesService } from '../services/store-roles.service';
import {
  StoreRole,
  UpdateStoreRoleDto} from '../interfaces/store-role.interface';


@Component({
  selector: 'app-store-role-edit-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    ButtonComponent,
    ModalComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      title="Editar Rol"
      subtitle="Actualiza la informacion del rol seleccionado"
    >
      @if (role()) {
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
          <div class="mt-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <h4
              class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Informacion del Rol
            </h4>
            <div class="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span class="text-gray-500 dark:text-gray-400">ID:</span>
                <span class="ml-2 text-gray-900 dark:text-gray-100">{{
                  role()?.id
                }}</span>
              </div>
              <div>
                <span class="text-gray-500 dark:text-gray-400">Tipo:</span>
                <span class="ml-2 text-gray-900 dark:text-gray-100">{{
                  role()?.system_role ? 'Sistema' : 'Personalizado'
                }}</span>
              </div>
              <div>
                <span class="text-gray-500 dark:text-gray-400">Usuarios:</span>
                <span class="ml-2 text-gray-900 dark:text-gray-100">{{
                  role()?._count?.user_roles || 0
                }}</span>
              </div>
              <div>
                <span class="text-gray-500 dark:text-gray-400">Permisos:</span>
                <span class="ml-2 text-gray-900 dark:text-gray-100">{{
                  role()?.permissions?.length || 0
                }}</span>
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
  ]})
export class StoreRoleEditModalComponent {
  private destroyRef = inject(DestroyRef);
  readonly role = model<StoreRole | null>(null);
  readonly isOpen = model<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly onRoleUpdated = output<void>();

  roleForm: FormGroup;
  isUpdating: boolean = false;
private storeRolesService = inject(StoreRolesService);
  private toastService = inject(ToastService);

  constructor(private fb: FormBuilder) {
    this.roleForm = this.fb.group({
      name: [
        '',
        [
          Validators.required,
          Validators.minLength(2),
          Validators.maxLength(50),
        ],
      ],
      description: ['']});
  }
ngOnChanges(): void {
    const currentRole = this.role();
    if (currentRole) {
      this.roleForm.patchValue({
        name: currentRole.name,
        description: currentRole.description || ''});
    }
  }

  onSubmit(): void {
    const currentRole = this.role();
    if (this.roleForm.invalid || this.isUpdating || !currentRole) {
      Object.keys(this.roleForm.controls).forEach((key) => {
        this.roleForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.isUpdating = true;
    this.roleForm.disable({ emitEvent: false });
    const roleData: UpdateStoreRoleDto = this.roleForm.value;

    this.storeRolesService
      .updateRole(currentRole.id, roleData)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isUpdating = false;
          this.roleForm.enable({ emitEvent: false });
          this.toastService.success('Rol actualizado exitosamente');
          this.onRoleUpdated.emit();
          this.isOpenChange.emit(false);
        },
        error: (error: any) => {
          this.isUpdating = false;
          this.roleForm.enable({ emitEvent: false });
          console.error('Error updating store role:', error);
          const message = error?.error?.message || 'Error al actualizar el rol';
          this.toastService.error(message);
        }});
  }

  onCancel(): void {
    this.isOpen.set(false);
  }
}
