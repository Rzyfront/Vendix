import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { IconComponent } from '../../../../../shared/components/index';
import { UsersService } from '../services/users.service';
import { CreateUserDto, UserState } from '../interfaces/user.interface';
import { Observable, Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-user-create-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IconComponent],
  template: `
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-surface rounded-lg border border-border w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4">
        <div class="p-6">
          <!-- Header -->
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-semibold text-text">Crear Nuevo Usuario</h2>
            <button
              (click)="onClose.emit()"
              class="text-text-muted hover:text-text transition-colors"
              [disabled]="isCreating"
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
                  [disabled]="isCreating"
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
                  [disabled]="isCreating"
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
                  [disabled]="isCreating"
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
                  [disabled]="isCreating"
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
                  [disabled]="isCreating"
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
                  Contraseña *
                </label>
                <input
                  type="password"
                  formControlName="password"
                  class="w-full px-3 py-2 border border-border rounded-md bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                  placeholder="••••••••••"
                  [disabled]="isCreating"
                />
                <div
                  *ngIf="userForm.get('password')?.touched && userForm.get('password')?.errors?.['required']"
                  class="text-red-500 text-xs"
                >
                  La contraseña es requerida
                </div>
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
                  [disabled]="isCreating"
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
                  Estado Inicial
                </label>
                <select
                  formControlName="state"
                  class="w-full px-3 py-2 border border-border rounded-md bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                  [disabled]="isCreating"
                >
                  <option value="">Seleccionar estado</option>
                  <option [value]="UserState.ACTIVE">Activo</option>
                  <option [value]="UserState.INACTIVE">Inactivo</option>
                  <option [value]="UserState.PENDING_VERIFICATION">Pendiente de Verificación</option>
                </select>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
              <button
                type="button"
                (click)="onClose.emit()"
                class="px-4 py-2 text-text bg-surface border border-border rounded-md hover:bg-surface-hover transition-colors"
                [disabled]="isCreating"
              >
                Cancelar
              </button>
              <button
                type="submit"
                class="px-4 py-2 text-white bg-primary rounded-md hover:bg-primary-hover transition-colors flex items-center gap-2 disabled:opacity-50"
                [disabled]="userForm.invalid || isCreating"
              >
                <app-icon *ngIf="isCreating" name="loader-2" class="w-4 h-4 animate-spin"></app-icon>
                {{ isCreating ? 'Creando...' : 'Crear Usuario' }}
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
export class UserCreateModalComponent implements OnInit, OnDestroy {
  @Input() isOpen: boolean = false;
  @Output() onClose = new EventEmitter<void>();
  @Output() onUserCreated = new EventEmitter<void>();

  userForm: FormGroup;
  isCreating: boolean = false;
  UserState = UserState;
  private destroy$ = new Subject<void>();

  usersService = inject(UsersService);

  constructor(
    private fb: FormBuilder
  ) {
    this.userForm = this.fb.group({
      first_name: ['', [Validators.required, Validators.maxLength(100)]],
      last_name: ['', [Validators.required, Validators.maxLength(100)]],
      username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(50)]],
      email: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
      organization_id: [null, [Validators.required]],
      password: ['', [Validators.required, Validators.minLength(8)]],
      app: [''],
      state: [UserState.PENDING_VERIFICATION]
    });
  }

  ngOnInit(): void {
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSubmit(): void {
    if (this.userForm.invalid || this.isCreating) {
      return;
    }

    this.isCreating = true;
    const userData: CreateUserDto = this.userForm.value;

    this.usersService.createUser(userData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isCreating = false;
          this.onUserCreated.emit();
          this.onClose.emit();
          this.resetForm();
        },
        error: (error: any) => {
          this.isCreating = false;
          console.error('Error creating user:', error);
        }
      });
  }

  resetForm(): void {
    this.userForm.reset({
      first_name: '',
      last_name: '',
      username: '',
      email: '',
      organization_id: null,
      password: '',
      app: '',
      state: UserState.PENDING_VERIFICATION
    });
  }
}