import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnDestroy,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { StoreUsersManagementService } from '../services/store-users-management.service';
import { StoreUser, UpdateStoreUserDto } from '../interfaces/store-user.interface';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-store-user-edit-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputComponent,
    ButtonComponent,
    ModalComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Editar Usuario"
      subtitle="Actualiza la informacion del usuario seleccionado"
    >
      <form [formGroup]="userForm" (ngSubmit)="onSubmit()" *ngIf="user">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">

          <app-input
            formControlName="first_name"
            label="Nombre *"
            placeholder="Juan"
            [required]="true"
            [control]="userForm.get('first_name')"
            [disabled]="isUpdating"
          ></app-input>

          <app-input
            formControlName="last_name"
            label="Apellido *"
            placeholder="Perez"
            [required]="true"
            [control]="userForm.get('last_name')"
            [disabled]="isUpdating"
          ></app-input>

          <app-input
            formControlName="email"
            label="Email *"
            type="email"
            placeholder="juan@ejemplo.com"
            [required]="true"
            [control]="userForm.get('email')"
            [disabled]="isUpdating"
          ></app-input>

        </div>

        <!-- User Info -->
        <div class="mt-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Informacion del Usuario
          </h4>
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span class="text-gray-500 dark:text-gray-400">ID:</span>
              <span class="ml-2 text-gray-900 dark:text-gray-100">{{
                user.id
              }}</span>
            </div>
            <div>
              <span class="text-gray-500 dark:text-gray-400">Creado:</span>
              <span class="ml-2 text-gray-900 dark:text-gray-100">{{
                formatDate(user.created_at)
              }}</span>
            </div>
            <div>
              <span class="text-gray-500 dark:text-gray-400">Estado:</span>
              <span class="ml-2 text-gray-900 dark:text-gray-100">{{
                user.state
              }}</span>
            </div>
            <div *ngIf="user.last_login">
              <span class="text-gray-500 dark:text-gray-400">Ultimo acceso:</span>
              <span class="ml-2 text-gray-900 dark:text-gray-100">{{
                formatDate(user.last_login)
              }}</span>
            </div>
          </div>
        </div>
      </form>

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
          [disabled]="userForm.invalid || isUpdating"
          [loading]="isUpdating"
        >
          Actualizar Usuario
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
export class StoreUserEditModalComponent implements OnDestroy {
  @Input() user: StoreUser | null = null;
  @Input() isOpen: boolean = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() onUserUpdated = new EventEmitter<void>();

  userForm: FormGroup;
  isUpdating: boolean = false;
  private destroy$ = new Subject<void>();

  private storeUsersService = inject(StoreUsersManagementService);
  private toastService = inject(ToastService);

  constructor(private fb: FormBuilder) {
    this.userForm = this.fb.group({
      first_name: ['', [Validators.required, Validators.maxLength(100)]],
      last_name: ['', [Validators.required, Validators.maxLength(100)]],
      email: [
        '',
        [Validators.required, Validators.email, Validators.maxLength(255)],
      ],
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnChanges(): void {
    if (this.user) {
      this.userForm.patchValue({
        first_name: this.user.first_name,
        last_name: this.user.last_name,
        email: this.user.email,
      });
    }
  }

  onSubmit(): void {
    if (this.userForm.invalid || this.isUpdating || !this.user) {
      Object.keys(this.userForm.controls).forEach((key) => {
        this.userForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.isUpdating = true;
    const userData: UpdateStoreUserDto = this.userForm.value;

    this.storeUsersService
      .updateUser(this.user.id, userData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isUpdating = false;
          this.toastService.success('Usuario actualizado exitosamente');
          this.onUserUpdated.emit();
          this.isOpenChange.emit(false);
        },
        error: (error: any) => {
          this.isUpdating = false;
          console.error('Error updating store user:', error);
          const message =
            error?.error?.message || 'Error al actualizar el usuario';
          this.toastService.error(message);
        },
      });
  }

  onCancel(): void {
    this.isOpen = false;
    this.isOpenChange.emit(false);
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
}
