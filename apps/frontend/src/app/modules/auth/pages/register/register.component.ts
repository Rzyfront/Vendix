import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl } from '@angular/forms';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { AuthService, RegisterOwnerDto } from '../../../../core/services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    CardComponent,
    ButtonComponent
  ],
  template: `
    <div class="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div class="max-w-md w-full space-y-8">
        <div class="text-center">
          <h1 class="text-3xl font-bold text-gray-900 mb-2">Vendix</h1>
          <h2 class="text-xl text-gray-600">Crear tu cuenta</h2>
          <p class="mt-2 text-sm text-gray-500">
            Registra tu organización y comienza a usar Vendix
          </p>
        </div>

        <app-card class="p-8">
          <form [formGroup]="registerForm" (ngSubmit)="onSubmit()" class="space-y-6">
            <!-- Nombre de la Organización -->
            <div>
              <label for="organizationName" class="block text-sm font-medium text-gray-700 mb-1">
                Nombre de la Organización *
              </label>
              <input
                id="organizationName"
                type="text"
                formControlName="organizationName"
                class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Mi Super Tienda"
                [class.border-red-500]="isFieldInvalid('organizationName')"
              />
              <p *ngIf="isFieldInvalid('organizationName')" class="mt-1 text-sm text-red-600">
                {{ getFieldError('organizationName') }}
              </p>
            </div>

            <!-- Email -->
            <div>
              <label for="email" class="block text-sm font-medium text-gray-700 mb-1">
                Correo Electrónico *
              </label>
              <input
                id="email"
                type="email"
                formControlName="email"
                class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="usuario@email.com"
                [class.border-red-500]="isFieldInvalid('email')"
              />
              <p *ngIf="isFieldInvalid('email')" class="mt-1 text-sm text-red-600">
                {{ getFieldError('email') }}
              </p>
            </div>

            <!-- Nombre y Apellido -->
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label for="first_name" class="block text-sm font-medium text-gray-700 mb-1">
                  Nombre *
                </label>
                <input
                  id="first_name"
                  type="text"
                  formControlName="first_name"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Juan"
                  [class.border-red-500]="isFieldInvalid('first_name')"
                />
                <p *ngIf="isFieldInvalid('first_name')" class="mt-1 text-sm text-red-600">
                  {{ getFieldError('first_name') }}
                </p>
              </div>

              <div>
                <label for="last_name" class="block text-sm font-medium text-gray-700 mb-1">
                  Apellido *
                </label>
                <input
                  id="last_name"
                  type="text"
                  formControlName="last_name"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Pérez"
                  [class.border-red-500]="isFieldInvalid('last_name')"
                />
                <p *ngIf="isFieldInvalid('last_name')" class="mt-1 text-sm text-red-600">
                  {{ getFieldError('last_name') }}
                </p>
              </div>
            </div>

            <!-- Teléfono -->
            <div>
              <label for="phone" class="block text-sm font-medium text-gray-700 mb-1">
                Teléfono
              </label>
              <input
                id="phone"
                type="tel"
                formControlName="phone"
                class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="+521234567890"
                [class.border-red-500]="isFieldInvalid('phone')"
              />
              <p *ngIf="isFieldInvalid('phone')" class="mt-1 text-sm text-red-600">
                {{ getFieldError('phone') }}
              </p>
            </div>

            <!-- Contraseña -->
            <div>
              <label for="password" class="block text-sm font-medium text-gray-700 mb-1">
                Contraseña *
              </label>
              <input
                id="password"
                type="password"
                formControlName="password"
                class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Password@123"
                [class.border-red-500]="isFieldInvalid('password')"
              />
              <p *ngIf="isFieldInvalid('password')" class="mt-1 text-sm text-red-600">
                {{ getFieldError('password') }}
              </p>
              <div class="mt-1 text-xs text-gray-500">
                Mínimo 8 caracteres, al menos un carácter especial
              </div>
            </div>

            <!-- Confirmar Contraseña -->
            <div>
              <label for="confirmPassword" class="block text-sm font-medium text-gray-700 mb-1">
                Confirmar Contraseña *
              </label>
              <input
                id="confirmPassword"
                type="password"
                formControlName="confirmPassword"
                class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Password@123"
                [class.border-red-500]="isFieldInvalid('confirmPassword')"
              />
              <p *ngIf="isFieldInvalid('confirmPassword')" class="mt-1 text-sm text-red-600">
                {{ getFieldError('confirmPassword') }}
              </p>
            </div>

            <!-- Mensaje de error general -->
            <div *ngIf="errorMessage" class="p-3 bg-red-50 border border-red-200 rounded-md">
              <p class="text-sm text-red-600">{{ errorMessage }}</p>
            </div>

            <!-- Mensaje de éxito -->
            <div *ngIf="successMessage" class="p-3 bg-green-50 border border-green-200 rounded-md">
              <p class="text-sm text-green-600">{{ successMessage }}</p>
            </div>

            <!-- Botón de registro -->
            <app-button
              type="submit"
              variant="primary"
              class="w-full"
              [disabled]="registerForm.invalid || isLoading"
              [loading]="isLoading"
            >
              {{ isLoading ? 'Registrando...' : 'Crear Cuenta' }}
            </app-button>
          </form>
        </app-card>

        <div class="text-center">
          <p class="text-sm text-gray-500">
            ¿Ya tienes cuenta?
            <a routerLink="/auth/login" class="text-blue-600 hover:text-blue-500 font-medium">
              Inicia sesión
            </a>
          </p>
          <a routerLink="/" class="block mt-4 text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Volver al inicio
          </a>
        </div>
      </div>
    </div>
  `
})
export class RegisterComponent implements OnInit {
  registerForm!: FormGroup;
  isLoading = false;
  errorMessage = '';
  successMessage = '';

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.initForm();
  }

  private initForm(): void {
    this.registerForm = this.fb.group({
      organizationName: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      first_name: ['', [Validators.required, Validators.minLength(2)]],
      last_name: ['', [Validators.required, Validators.minLength(2)]],
      phone: [''],
      password: ['', [
        Validators.required,
        Validators.minLength(8),
        this.passwordValidator
      ]],
      confirmPassword: ['', [Validators.required]]
    }, {
      validators: this.passwordMatchValidator
    });
  }

  // Validador personalizado para contraseña
  private passwordValidator(control: AbstractControl): { [key: string]: any } | null {
    const value = control.value;
    if (!value) return null;

    const hasSpecialChar = /[^A-Za-z0-9]/.test(value);
    if (!hasSpecialChar) {
      return { specialChar: 'La contraseña debe contener al menos un carácter especial' };
    }

    return null;
  }

  // Validador para confirmar contraseña
  private passwordMatchValidator(group: AbstractControl): { [key: string]: any } | null {
    const password = group.get('password');
    const confirmPassword = group.get('confirmPassword');

    if (!password || !confirmPassword) return null;

    return password.value === confirmPassword.value ? null : { passwordMismatch: true };
  }

  isFieldInvalid(fieldName: string): boolean {
    const field = this.registerForm.get(fieldName);
    return !!(field && field.invalid && (field.dirty || field.touched));
  }

  getFieldError(fieldName: string): string {
    const field = this.registerForm.get(fieldName);
    if (!field || !field.errors) return '';

    if (field.errors['required']) return 'Este campo es requerido';
    if (field.errors['email']) return 'Debe ser un email válido';
    if (field.errors['minlength']) return `Mínimo ${field.errors['minlength'].requiredLength} caracteres`;
    if (field.errors['specialChar']) return field.errors['specialChar'];
    if (field.errors['passwordMismatch']) return 'Las contraseñas no coinciden';

    return 'Campo inválido';
  }

  onSubmit(): void {
    if (this.registerForm.invalid) {
      this.markFormGroupTouched();
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    const formData = this.registerForm.value;
    const registerData: RegisterOwnerDto = {
      organizationName: formData.organizationName,
      email: formData.email,
      password: formData.password,
      first_name: formData.first_name,
      last_name: formData.last_name,
      phone: formData.phone || undefined
    };

    this.authService.registerOwner(registerData).subscribe({
      next: (response) => {
        this.isLoading = false;
        this.successMessage = '¡Registro exitoso! Revisa tu email para verificar tu cuenta.';
        this.registerForm.reset();

        // Redirigir al login después de 3 segundos
        setTimeout(() => {
          this.router.navigate(['/auth/login']);
        }, 3000);
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = error.message || 'Error al registrar. Inténtalo de nuevo.';
      }
    });
  }

  private markFormGroupTouched(): void {
    Object.keys(this.registerForm.controls).forEach(key => {
      const control = this.registerForm.get(key);
      control?.markAsTouched();
    });
  }
}