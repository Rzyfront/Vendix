import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { IconComponent } from '../../../../../shared/components/index';
import { UsersService } from '../services/users.service';
import { User, UpdateUserDto, UserState } from '../interfaces/user.interface';
import { Observable, Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-user-edit-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IconComponent],
  template: `
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-surface rounded-lg border border-border w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4">
        <div class="p-6">
          <!-- Header -->
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-semibold text-text">Editar Usuario</h2>
            <button
              (click)="onClose.emit()"
              class="text-text-muted hover:text-text transition-colors"
              [disabled]="isUpdating"
            >
              <app-icon name="x" class="w-6 h-6"></app-icon>
            </button>
          </div>

          <!-- Form -->
          <form [formGroup]="userForm" (ngSubmit)="onSubmit()">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- First Name -->
              <div class="space-y-2">
                <label class="block text-sm font-medium text-text">
                  Nombre *
                </label>
                <input
                  type="text"
                  formControlName="first_name"
                  class="w-full px-3 py-2 border border-border rounded-md bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                  placeholder="Juan"
                  [disabled]="isUpdating"
                />
                <div
                  *ngIf="userForm.get('first_name')?.touched && userForm.get('first_name')?.errors?.['required']"
                  class="text-red-500 text-xs"
                >
                  El nombre es requerido
                </div>
              </div>

              <!-- Last Name -->
              <div class="space-y-2">
                <label class="block text-sm font-medium text-text">
                  Apellido *
                </label>
                <input
                  type="text"
                  formControlName="last_name"
                  class="w-full px-3 py-2 border border-border rounded-md bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                  placeholder="Pérez"
                  [disabled]="isUpdating"
                />
                <div
                  *ngIf="userForm.get('last_name')?.touched && userForm.get('last_name')?.errors?.['required']"
                  class="text-red-500 text-xs"
                >
                  El apellido es requerido
                </div>
              </div>

              <!-- Username -->
              <div class="space-y-2">
                <label class="block text-sm font-medium text-text">
                  Nombre de Usuario *
                </label>
                <input
                  type="text"
                  formControlName="username"
                  class="w-full px-3 py-2 border border-border rounded-md bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                  placeholder="juanperez"
                  [disabled]="isUpdating"
                />
                <div
                  *ngIf="userForm.get('username')?.touched && userForm.get('username')?.errors?.['required']"
                  class="text-red-500 text-xs"
                >
                  El nombre de usuario es requerido
                </div>
                <div
                  *ngIf="userForm.get('username')?.touched && userForm.get('username')?.errors?.['minlength']"
                  class="text-red-500 text-xs"
                >
                  Mínimo 3 caracteres
                </div>
              </div>

              <!-- Email -->
              <div class="space-y-2">
                <label class="block text-sm font-medium text-text">
                  Email *
                </label>
                <input
                  type="email"
                  formControlName="email"
                  class="w-full px-3 py-2 border border-border rounded-md bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                  placeholder="juan@ejemplo.com"
                  [disabled]="isUpdating"
                />
                <div
                  *ngIf="userForm.get('email')?.touched && userForm.get('email')?.errors?.['required']"
                  class="text-red-500 text-xs"
                >
                  El email es requerido
                </div>
                <div
                  *ngIf="userForm.get('email')?.touched && userForm.get('email')?.errors?.['email']"
                  class="text-red-500 text-xs"
                >
                  Email inválido
                </div>
              </div>

              <!-- Organization ID -->
              <div class="space-y-2">
                <label class="block text-sm font-medium text-text">
                  ID de Organización *
                </label>
                <input
                  type="number"
                  formControlName="organization_id"
                  class="w-full px-3 py-2 border border-border rounded-md bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                  placeholder="1"
                  [disabled]="isUpdating"
                />
                <div
                  *ngIf="userForm.get('organization_id')?.touched && userForm.get('organization_id')?.errors?.['required']"
                  class="text-red-500 text-xs"
                >
                  El ID de organización es requerido
                </div>
              </div>

              <!-- Password -->
              <div class="space-y-2">
                <label class="block text-sm font-medium text-text">
                  Nueva Contraseña
                </label>
                <input
                  type="password"
                  formControlName="password"
                  class="w-full px-3 py-2 border border-border rounded-md bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                  placeholder="Dejar en blanco para no cambiar"
                  [disabled]="isUpdating"
                />
                <div
                  *ngIf="userForm.get('password')?.touched && userForm.get('password')?.errors?.['minlength']"
                  class="text-red-500 text-xs"
                >
                  Mínimo 8 caracteres
                </div>
              </div>

              <!-- App -->
              <div class="space-y-2">
                <label class="block text-sm font-medium text-text">
                  Aplicación
                </label>
                <select
                  formControlName="app"
                  class="w-full px-3 py-2 border border-border rounded-md bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                  [disabled]="isUpdating"
                >
                  <option value="">Seleccionar aplicación</option>
                  <option value="ORG_ADMIN">ORG_ADMIN</option>
                  <option value="STORE_ADMIN">STORE_ADMIN</option>
                  <option value="STORE_ECOMMERCE">STORE_ECOMMERCE</option>
                  <option value="VENDIX_LANDING">VENDIX_LANDING</option>
                </select>
              </div>

              <!-- State -->
              <div class="space-y-2">
                <label class="block text-sm font-medium text-text">
                  Estado
                </label>
                <select
                  formControlName="state"
                  class="w-full px-3 py-2 border border-border rounded-md bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                  [disabled]="isUpdating"
                >
                  <option value="">Seleccionar estado</option>
                  <option [value]="UserState.ACTIVE">Activo</option>
                  <option [value]="UserState.INACTIVE">Inactivo</option>
                  <option [value]="UserState.PENDING_VERIFICATION">Pendiente de Verificación</option>
                  <option [value]="UserState.SUSPENDED">Suspendido</option>
                  <option [value]="UserState.ARCHIVED">Archivado</option>
                </select>
              </div>

              <!-- Security Options -->
              <div class="md:col-span-2 space-y-4">
                <h3 class="text-sm font-medium text-text">Opciones de Seguridad</h3>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <!-- Email Verification -->
                  <div class="flex items-center justify-between p-3 bg-surface border border-border rounded">
                    <div>
                      <p class="text-sm font-medium text-text">Verificar Email</p>
                      <p class="text-xs text-text-muted">
                        {{ user?.email_verified ? 'Email ya verificado' : 'Marcar email como verificado' }}
                      </p>
                    </div>
                    <button
                      type="button"
                      (click)="verifyEmail()"
                      [disabled]="isUpdating || user?.email_verified"
                      class="px-3 py-1 text-sm bg-green-500 hover:bg-green-600 text-white rounded transition-colors disabled:opacity-50"
                    >
                      <app-icon name="mail-check" class="w-4 h-4"></app-icon>
                    </button>
                  </div>

                  <!-- 2FA Toggle -->
                  <div class="flex items-center justify-between p-3 bg-surface border border-border rounded">
                    <div>
                      <p class="text-sm font-medium text-text">2FA</p>
                      <p class="text-xs text-text-muted">
                        {{ user?.two_factor_enabled ? '2FA activado' : 'Activar 2FA' }}
                      </p>
                    </div>
                    <button
                      type="button"
                      (click)="toggle2FA()"
                      [disabled]="isUpdating"
                      [class]="user?.two_factor_enabled ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'"
                      class="px-3 py-1 text-sm text-white rounded transition-colors"
                    >
                      <app-icon [name]="user?.two_factor_enabled ? 'shield-off' : 'shield'" class="w-4 h-4"></app-icon>
                    </button>
                  </div>

                  <!-- Unlock User -->
                  <div class="flex items-center justify-between p-3 bg-surface border border-border rounded">
                    <div>
                      <p class="text-sm font-medium text-text">Desbloquear</p>
                      <p class="text-xs text-text-muted">
                        @if (user?.locked_until) {
                          Bloqueado hasta {{ lockedUntilDisplay }}
                        } @else {
                          No bloqueado
                        }
                      </p>
                    </div>
                    <button
                      type="button"
                      (click)="unlockUser()"
                      [disabled]="isUpdating || !user?.locked_until"
                      class="px-3 py-1 text-sm bg-yellow-500 hover:bg-yellow-600 text-white rounded transition-colors disabled:opacity-50"
                    >
                      <app-icon name="unlock" class="w-4 h-4"></app-icon>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
              <button
                type="button"
                (click)="onClose.emit()"
                class="px-4 py-2 text-text bg-surface border border-border rounded-md hover:bg-surface-hover transition-colors"
                [disabled]="isUpdating"
              >
                Cancelar
              </button>
              <button
                type="submit"
                class="px-4 py-2 text-white bg-primary rounded-md hover:bg-primary-hover transition-colors flex items-center gap-2 disabled:opacity-50"
                [disabled]="userForm.invalid || isUpdating"
              >
                <app-icon *ngIf="isUpdating" name="loader-2" class="w-4 h-4 animate-spin"></app-icon>
                {{ isUpdating ? 'Actualizando...' : 'Actualizar Usuario' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
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
    private usersService: UsersService
  ) {
    this.userForm = this.fb.group({
      first_name: ['', [Validators.required, Validators.maxLength(100)]],
      last_name: ['', [Validators.required, Validators.maxLength(100)]],
      username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(50)]],
      email: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
      organization_id: [null, [Validators.required]],
      password: ['', [Validators.minLength(8)]],
      app: [''],
      state: [UserState.ACTIVE]
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
        password: '' // No mostrar la contraseña actual
      });
    }
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

    this.usersService.updateUser(this.user.id, updateData)
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
        }
      });
  }

  verifyEmail(): void {
    if (!this.user || this.isUpdating) return;

    this.isUpdating = true;
    this.usersService.verifyUserEmail(this.user.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isUpdating = false;
          this.onUserUpdated.emit();
        },
        error: (error: any) => {
          this.isUpdating = false;
          console.error('Error verifying email:', error);
        }
      });
  }

  toggle2FA(): void {
    if (!this.user || this.isUpdating) return;

    this.isUpdating = true;
    const newState = !this.user.two_factor_enabled;

    this.usersService.toggleUser2FA(this.user.id, newState)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isUpdating = false;
          this.onUserUpdated.emit();
        },
        error: (error: any) => {
          this.isUpdating = false;
          console.error('Error toggling 2FA:', error);
        }
      });
  }

  unlockUser(): void {
    if (!this.user || this.isUpdating) return;

    this.isUpdating = true;
    this.usersService.unlockUser(this.user.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isUpdating = false;
          this.onUserUpdated.emit();
        },
        error: (error: any) => {
          this.isUpdating = false;
          console.error('Error unlocking user:', error);
        }
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