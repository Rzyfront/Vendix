import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
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
  IconComponent,
  InputComponent,
  ButtonComponent,
  ModalComponent,
  ToastService,
} from '../../../../../shared/components/index';
import { UsersService } from '../services/users.service';
import { User, UpdateUserDto, UserState } from '../interfaces/user.interface';
import { Observable, Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-user-edit-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IconComponent,
    InputComponent,
    ButtonComponent,
    ModalComponent,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      [size]="'lg'"
      title="Editar Usuario"
      [subtitle]="
        user
          ? 'Modificando información de ' +
            user.first_name +
            ' ' +
            user.last_name
          : ''
      "
    >
      <form [formGroup]="userForm" (ngSubmit)="onSubmit()">
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
            formControlName="organization_id"
            label="ID de Organización"
            type="number"
            placeholder="1"
            [required]="true"
            [control]="userForm.get('organization_id')"
            [disabled]="isUpdating"
          ></app-input>

          <app-input
            formControlName="password"
            label="Nueva Contraseña"
            type="password"
            placeholder="Dejar en blanco para no cambiar"
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

          <!-- Security Options -->
          <div class="md:col-span-2 space-y-4">
            <h3
              class="text-sm font-medium text-[var(--color-text-primary)] mb-3"
            >
              Opciones de Seguridad
            </h3>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <!-- Email Verification -->
              <div
                class="flex items-center justify-between p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg hover:shadow-md transition-shadow"
              >
                <div class="flex-1">
                  <p
                    class="text-sm font-medium text-[var(--color-text-primary)]"
                  >
                    Verificar Email
                  </p>
                  <p class="text-xs text-[var(--color-text-secondary)] mt-1">
                    {{
                      user?.email_verified
                        ? 'Email ya verificado'
                        : 'Marcar email como verificado'
                    }}
                  </p>
                </div>
                <app-button
                  [variant]="user?.email_verified ? 'success' : 'primary'"
                  size="sm"
                  (clicked)="verifyEmail()"
                  [disabled]="isUpdating || !!user?.email_verified"
                >
                  <app-icon
                    [name]="user?.email_verified ? 'check' : 'mail-check'"
                    class="w-4 h-4"
                    slot="icon"
                  ></app-icon>
                </app-button>
              </div>

              <!-- 2FA Toggle -->
              <div
                class="flex items-center justify-between p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg hover:shadow-md transition-shadow"
              >
                <div class="flex-1">
                  <p
                    class="text-sm font-medium text-[var(--color-text-primary)]"
                  >
                    2FA
                  </p>
                  <p class="text-xs text-[var(--color-text-secondary)] mt-1">
                    {{
                      user?.two_factor_enabled ? '2FA activado' : 'Activar 2FA'
                    }}
                  </p>
                </div>
                <app-button
                  [variant]="user?.two_factor_enabled ? 'danger' : 'primary'"
                  size="sm"
                  (clicked)="toggle2FA()"
                  [disabled]="isUpdating"
                >
                  <app-icon
                    [name]="user?.two_factor_enabled ? 'shield-off' : 'shield'"
                    class="w-4 h-4"
                    slot="icon"
                  ></app-icon>
                </app-button>
              </div>

              <!-- Unlock User -->
              <div
                class="flex items-center justify-between p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg hover:shadow-md transition-shadow"
              >
                <div class="flex-1">
                  <p
                    class="text-sm font-medium text-[var(--color-text-primary)]"
                  >
                    Desbloquear
                  </p>
                  <p class="text-xs text-[var(--color-text-secondary)] mt-1">
                    @if (user?.locked_until) {
                      Bloqueado hasta {{ lockedUntilDisplay }}
                    } @else {
                      No bloqueado
                    }
                  </p>
                </div>
                <app-button
                  variant="outline"
                  size="sm"
                  (clicked)="unlockUser()"
                  [disabled]="isUpdating || !user?.locked_until"
                >
                  <app-icon
                    name="unlock"
                    class="w-4 h-4"
                    slot="icon"
                  ></app-icon>
                </app-button>
              </div>
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
export class UserEditModalComponent implements OnInit, OnDestroy {
  @Input() user: User | null = null;
  @Input() isOpen: boolean = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() onUserUpdated = new EventEmitter<void>();

  userForm: FormGroup;
  isUpdating: boolean = false;
  UserState = UserState;
  private destroy$ = new Subject<void>();

  private fb = inject(FormBuilder);
  private usersService = inject(UsersService);
  private toastService = inject(ToastService);

  constructor() {
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
      organization_id: [null, [Validators.required]],
      password: ['', [Validators.minLength(8)]],
      app: [''],
      state: [UserState.ACTIVE],
    });
  }

  ngOnInit(): void {
    if (this.user) {
      this.userForm.patchValue({
        first_name: this.user.first_name,
        last_name: this.user.last_name,
        username: this.user.username,
        email: this.user.email,
        organization_id: this.user.organization_id,
        app: this.user.app || '',
        state: this.user.state,
        password: '', // No mostrar la contraseña actual
      });
    }
  }

  onCancel(): void {
    this.isOpen = false;
    this.isOpenChange.emit(false);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSubmit(): void {
    if (this.userForm.invalid || this.isUpdating || !this.user) {
      return;
    }

    this.isUpdating = true;
    const updateData: UpdateUserDto = this.userForm.value;

    // No enviar password si está vacío
    if (!updateData.password) {
      delete updateData.password;
    }

    this.usersService
      .updateUser(this.user.id, updateData)
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
          this.toastService.error('Error al actualizar el usuario');
          console.error('Error updating user:', error);
        },
      });
  }

  verifyEmail(): void {
    if (!this.user || this.isUpdating) return;

    this.isUpdating = true;
    this.usersService
      .verifyUserEmail(this.user.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updatedUser: User) => {
          this.isUpdating = false;
          this.user = updatedUser;
          this.userForm.patchValue({ state: updatedUser.state });
          this.toastService.success('Email verificado exitosamente');
          this.onUserUpdated.emit();
        },
        error: (error: any) => {
          this.isUpdating = false;
          this.toastService.error('Error al verificar el email');
          console.error('Error verifying email:', error);
        },
      });
  }

  toggle2FA(): void {
    if (!this.user || this.isUpdating) return;

    this.isUpdating = true;
    const newState = !this.user.two_factor_enabled;

    this.usersService
      .toggleUser2FA(this.user.id, newState)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updatedUser: User) => {
          this.isUpdating = false;
          this.user = updatedUser;
          this.toastService.success(
            `2FA ${newState ? 'activado' : 'desactivado'} exitosamente`,
          );
          this.onUserUpdated.emit();
        },
        error: (error: any) => {
          this.isUpdating = false;
          this.toastService.error('Error al cambiar estado de 2FA');
          console.error('Error toggling 2FA:', error);
        },
      });
  }

  unlockUser(): void {
    if (!this.user || this.isUpdating) return;

    this.isUpdating = true;
    this.usersService
      .unlockUser(this.user.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updatedUser: User) => {
          this.isUpdating = false;
          this.user = updatedUser;
          this.toastService.success('Usuario desbloqueado exitosamente');
          this.onUserUpdated.emit();
        },
        error: (error: any) => {
          this.isUpdating = false;
          this.toastService.error('Error al desbloquear el usuario');
          console.error('Error unlocking user:', error);
        },
      });
  }

  formatDate(dateString: string | null | undefined): string {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('es-ES');
  }

  // Computed property for locked until display
  get lockedUntilDisplay(): string {
    if (!this.user?.locked_until) return '';
    return this.formatDate(this.user.locked_until);
  }
}
