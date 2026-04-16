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
import { CreateStoreRoleDto } from '../interfaces/store-role.interface';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-store-role-create-modal',
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
      title="Crear Nuevo Rol"
      subtitle="Define un nombre y descripcion para el nuevo rol"
    >
      <form [formGroup]="roleForm" (ngSubmit)="onSubmit()">
        <div class="space-y-4">

          <app-input
            formControlName="name"
            label="Nombre del Rol *"
            placeholder="Ej: Cajero, Supervisor..."
            [required]="true"
            [control]="roleForm.get('name')"
            [disabled]="isCreating"
          ></app-input>

          <app-input
            formControlName="description"
            label="Descripcion"
            placeholder="Descripcion opcional del rol"
            [control]="roleForm.get('description')"
            [disabled]="isCreating"
          ></app-input>

        </div>
      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="outline"
          (clicked)="onCancel()"
          [disabled]="isCreating"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [disabled]="roleForm.invalid || isCreating"
          [loading]="isCreating"
        >
          Crear Rol
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
export class StoreRoleCreateModalComponent implements OnDestroy {
  @Input() isOpen: boolean = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() onRoleCreated = new EventEmitter<void>();

  roleForm: FormGroup;
  isCreating: boolean = false;
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

  onSubmit(): void {
    if (this.roleForm.invalid || this.isCreating) {
      Object.keys(this.roleForm.controls).forEach((key) => {
        this.roleForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.isCreating = true;
    const roleData: CreateStoreRoleDto = this.roleForm.value;

    // Remove description if empty
    if (!roleData.description) {
      delete roleData.description;
    }

    this.storeRolesService
      .createRole(roleData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isCreating = false;
          this.toastService.success('Rol creado exitosamente');
          // TODO: The 'emit' function requires a mandatory void argument
          // TODO: The 'emit' function requires a mandatory void argument
          // TODO: The 'emit' function requires a mandatory void argument
          // TODO: The 'emit' function requires a mandatory void argument
          // TODO: The 'emit' function requires a mandatory void argument
          this.onRoleCreated.emit();
          this.isOpenChange.emit(false);
          this.resetForm();
        },
        error: (error: any) => {
          this.isCreating = false;
          console.error('Error creating store role:', error);
          const message =
            error?.error?.message || 'Error al crear el rol';
          this.toastService.error(message);
        },
      });
  }

  onCancel(): void {
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
