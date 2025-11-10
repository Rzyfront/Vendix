import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
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
} from '../../../../../shared/components/index';
import { UsersService } from '../services/users.service';
import { User, UpdateUserDto, UserState } from '../interfaces/user.interface';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-user-edit-modal',
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
      [size]="'lg'"
      title="Editar Usuario"
      (openChange)="onClose.emit()"
    >
      <form [formGroup]="userForm" (ngSubmit)="onSubmit()" *ngIf="user">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-input
            formControlName="first_name"
            label="Nombre"
            placeholder="Juan"
            [required]="true"
            [control]="userForm.get('first_name')"
            [disabled]="isUpdating"
          ></app-input>

          <app-input
            formControlName="last_name"
            label="Apellido"
            placeholder="Pérez"
            [required]="true"
            [control]="userForm.get('last_name')"
            [disabled]="isUpdating"
          ></app-input>

          <app-input
            formControlName="username"
            label="Nombre de Usuario"
            placeholder="juanperez"
            [required]="true"
            [control]="userForm.get('username')"
            [disabled]="isUpdating"
          ></app-input>

          <app-input
            formControlName="email"
            label="Email"
            type="email"
            placeholder="juan@ejemplo.com"
            [required]="true"
            [control]="userForm.get('email')"
            [disabled]="isUpdating"
          ></app-input>

          <app-input
            formControlName="password"
            label="Nueva Contraseña (opcional)"
            type="password"
            placeholder="Dejar en blanco para mantener actual"
            [control]="userForm.get('password')"
            [disabled]="isUpdating"
          ></app-input>

          <div class="space-y-2">
            <label
              class="block text-sm font-medium text-[var(--color-text-primary)]"
            >
              Aplicación
            </label>
            <select
              formControlName="app"
              class="w-full px-3 py-2 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)]"
              [disabled]="isUpdating"
            >
              <option value="">Seleccionar aplicación</option>
              <option value="ORG_ADMIN">ORG_ADMIN</option>
              <option value="STORE_ADMIN">STORE_ADMIN</option>
              <option value="STORE_ECOMMERCE">STORE_ECOMMERCE</option>
              <option value="VENDIX_LANDING">VENDIX_LANDING</option>
            </select>
          </div>

          <div class="space-y-2">
            <label
              class="block text-sm font-medium text-[var(--color-text-primary)]"
            >
              Estado
            </label>
            <select
              formControlName="state"
              class="w-full px-3 py-2 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)]"
              [disabled]="isUpdating"
            >
              <option value="">Seleccionar estado</option>
              <option [value]="UserState.ACTIVE">Activo</option>
              <option [value]="UserState.INACTIVE">Inactivo</option>
              <option [value]="UserState.PENDING_VERIFICATION">
                Pendiente de Verificación
              </option>
              <option [value]="UserState.SUSPENDED">Suspendido</option>
              <option [value]="UserState.ARCHIVED">Archivado</option>
            </select>
          </div>
        </div>

        <!-- User Info -->
        <div class="mt-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Información del Usuario
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
              <span class="text-gray-500 dark:text-gray-400"
                >Email Verificado:</span
              >
              <span
                class="ml-2"
                [class]="
                  user.email_verified ? 'text-green-600' : 'text-yellow-600'
                "
              >
                {{ user.email_verified ? 'Sí' : 'No' }}
              </span>
            </div>
            <div>
              <span class="text-gray-500 dark:text-gray-400">2FA:</span>
              <span
                class="ml-2"
                [class]="
                  user.two_factor_enabled ? 'text-green-600' : 'text-gray-600'
                "
              >
                {{ user.two_factor_enabled ? 'Habilitado' : 'Deshabilitado' }}
              </span>
            </div>
          </div>
        </div>
      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="outline"
          (clicked)="onClose.emit()"
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
export class UserEditModalComponent implements OnInit, OnDestroy {
  @Input() user: User | null = null;
  @Input() isOpen: boolean = false;
  @Output() onClose = new EventEmitter<void>();
  @Output() onUserUpdated = new EventEmitter<void>();

  userForm: FormGroup;
  isUpdating: boolean = false;
  UserState = UserState;
  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private usersService: UsersService,
  ) {
    this.userForm = this.fb.group({
      first_name: ['', [Validators.required, Validators.maxLength(100)]],
      last_name: ['', [Validators.required, Validators.maxLength(100)]],
      username: [
        '',
        [
          Validators.required,
          Validators.minLength(3),
          Validators.maxLength(50),
        ],
      ],
      email: [
        '',
        [Validators.required, Validators.email, Validators.maxLength(255)],
      ],
      password: [''],
      app: [''],
      state: [UserState.ACTIVE],
    });
  }

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnChanges(): void {
    if (this.user) {
      this.userForm.patchValue({
        first_name: this.user.first_name,
        last_name: this.user.last_name,
        username: this.user.username,
        email: this.user.email,
        app: this.user.app || '',
        state: this.user.state,
      });
    }
  }

  onSubmit(): void {
    if (this.userForm.invalid || this.isUpdating || !this.user) {
      return;
    }

    this.isUpdating = true;
    const userData: UpdateUserDto = this.userForm.value;

    // Remove password if empty
    if (!userData.password) {
      delete userData.password;
    }

    this.usersService
      .updateUser(this.user.id, userData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isUpdating = false;
          this.onUserUpdated.emit();
          this.onClose.emit();
        },
        error: (error: any) => {
          this.isUpdating = false;
          console.error('Error updating user:', error);
        },
      });
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
