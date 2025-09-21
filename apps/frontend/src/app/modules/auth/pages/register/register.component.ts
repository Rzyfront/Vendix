import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl } from '@angular/forms';
import { AuthService, RegisterOwnerDto } from '../../../../core/services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule
  ],
  template: `
    <div class="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-emerald-50 flex items-center justify-center py-8 px-4 sm:px-6 lg:px-8">
      <div class="max-w-4xl w-full space-y-8">
        <!-- Header con logo -->
        <div class="text-center">
          <div class="flex justify-center items-center mb-6 space-x-4">
            <img src="/vlogo.png" alt="Vendix Logo" class="w-12 h-12 rounded-xl shadow-lg">
            <h1 class="text-4xl font-black bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
              Vendix
            </h1>
          </div>
          <h2 class="text-2xl font-bold text-gray-800 mb-2">Crear tu cuenta</h2>
          <p class="text-gray-600 max-w-sm mx-auto leading-relaxed">
            Registra tu organización y comienza a transformar tu negocio
          </p>
        </div>

        <div class="bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-8 relative overflow-hidden">
          <!-- Decorative background -->
          <div class="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-primary/10 to-secondary/10 rounded-full blur-3xl"></div>
          <div class="absolute bottom-0 left-0 w-24 h-24 bg-gradient-to-tr from-secondary/10 to-primary/10 rounded-full blur-3xl"></div>
          
          <form [formGroup]="registerForm" (ngSubmit)="onSubmit()" class="space-y-6 relative">
            <!-- Primera fila: Organización y Email -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <!-- Nombre de la Organización -->
              <div class="relative">
                <label for="organizationName" class="block text-sm font-semibold text-gray-700 mb-2">
                  Nombre de la Organización *
                </label>
                <input
                  id="organizationName"
                  type="text"
                  formControlName="organizationName"
                  class="w-full px-4 py-3 bg-white/60 backdrop-blur-sm border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-300 hover:shadow-md"
                  placeholder="Mi Super Tienda"
                  [class.border-red-300]="isFieldInvalid('organizationName')"
                  [ngClass]="{'bg-red-50/50': isFieldInvalid('organizationName')}"
                />
                <p *ngIf="isFieldInvalid('organizationName')" class="mt-2 text-sm text-red-500 flex items-center space-x-1">
                  <span>{{ getFieldError('organizationName') }}</span>
                </p>
              </div>

              <!-- Email -->
              <div class="relative">
                <label for="email" class="block text-sm font-semibold text-gray-700 mb-2">
                  Correo Electrónico *
                </label>
                <input
                  id="email"
                  type="email"
                  formControlName="email"
                  class="w-full px-4 py-3 bg-white/60 backdrop-blur-sm border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-300 hover:shadow-md"
                  placeholder="usuario@email.com"
                  [class.border-red-300]="isFieldInvalid('email')"
                  [ngClass]="{'bg-red-50/50': isFieldInvalid('email')}"
                />
                <p *ngIf="isFieldInvalid('email')" class="mt-2 text-sm text-red-500 flex items-center space-x-1">
                  <span>{{ getFieldError('email') }}</span>
                </p>
              </div>
            </div>

            <!-- Segunda fila: Nombre y Apellido -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="relative">
                <label for="first_name" class="block text-sm font-semibold text-gray-700 mb-2">
                  Nombre *
                </label>
                <input
                  id="first_name"
                  type="text"
                  formControlName="first_name"
                  class="w-full px-4 py-3 bg-white/60 backdrop-blur-sm border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-300 hover:shadow-md"
                  placeholder="Juan"
                  [class.border-red-300]="isFieldInvalid('first_name')"
                  [ngClass]="{'bg-red-50/50': isFieldInvalid('first_name')}"
                />
                <p *ngIf="isFieldInvalid('first_name')" class="mt-2 text-sm text-red-500 flex items-center space-x-1">
                  <span>{{ getFieldError('first_name') }}</span>
                </p>
              </div>

              <div class="relative">
                <label for="last_name" class="block text-sm font-semibold text-gray-700 mb-2">
                  Apellido *
                </label>
                <input
                  id="last_name"
                  type="text"
                  formControlName="last_name"
                  class="w-full px-4 py-3 bg-white/60 backdrop-blur-sm border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-300 hover:shadow-md"
                  placeholder="Pérez"
                  [class.border-red-300]="isFieldInvalid('last_name')"
                  [ngClass]="{'bg-red-50/50': isFieldInvalid('last_name')}"
                />
                <p *ngIf="isFieldInvalid('last_name')" class="mt-2 text-sm text-red-500 flex items-center space-x-1">
                  <span>{{ getFieldError('last_name') }}</span>
                </p>
              </div>
            </div>

            <!-- Tercera fila: Teléfono y Contraseña -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <!-- Teléfono -->
              <div class="relative">
                <label for="phone" class="block text-sm font-semibold text-gray-700 mb-2">
                  Teléfono
                </label>
                <input
                  id="phone"
                  type="tel"
                  formControlName="phone"
                  class="w-full px-4 py-3 bg-white/60 backdrop-blur-sm border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-300 hover:shadow-md"
                  placeholder="+57 300 123 4567"
                  [class.border-red-300]="isFieldInvalid('phone')"
                  [ngClass]="{'bg-red-50/50': isFieldInvalid('phone')}"
                />
                <p *ngIf="isFieldInvalid('phone')" class="mt-2 text-sm text-red-500 flex items-center space-x-1">
                  <span>{{ getFieldError('phone') }}</span>
                </p>
              </div>

              <!-- Contraseña -->
              <div class="relative">
                <label for="password" class="block text-sm font-semibold text-gray-700 mb-2">
                  Contraseña *
                </label>
                <input
                  id="password"
                  type="password"
                  formControlName="password"
                  class="w-full px-4 py-3 bg-white/60 backdrop-blur-sm border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-300 hover:shadow-md"
                  placeholder="••••••••"
                  [class.border-red-300]="isFieldInvalid('password')"
                  [ngClass]="{'bg-red-50/50': isFieldInvalid('password')}"
                />
                <p *ngIf="isFieldInvalid('password')" class="mt-2 text-sm text-red-500 flex items-center space-x-1">
                  <span>{{ getFieldError('password') }}</span>
                </p>
                <div class="mt-2 text-xs text-gray-500">
                  Mínimo 8 caracteres, al menos un carácter especial
                </div>
              </div>
            </div>

            <!-- Confirmar Contraseña -->
            <div class="relative">
              <label for="confirmPassword" class="block text-sm font-semibold text-gray-700 mb-2">
                Confirmar Contraseña *
              </label>
              <input
                id="confirmPassword"
                type="password"
                formControlName="confirmPassword"
                class="w-full px-4 py-3 bg-white/60 backdrop-blur-sm border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-300 hover:shadow-md"
                placeholder="••••••••"
                [class.border-red-300]="isFieldInvalid('confirmPassword')"
                [ngClass]="{'bg-red-50/50': isFieldInvalid('confirmPassword')}"
              />
              <p *ngIf="isFieldInvalid('confirmPassword')" class="mt-2 text-sm text-red-500 flex items-center space-x-1">
                <span>{{ getFieldError('confirmPassword') }}</span>
              </p>
            </div>

            <!-- Mensaje de error general -->
            <div *ngIf="errorMessage" class="p-4 bg-red-50/80 backdrop-blur-sm border border-red-200/50 rounded-2xl shadow-sm">
              <div class="flex items-center space-x-2">
                <p class="text-sm text-red-600 font-medium">{{ errorMessage }}</p>
              </div>
            </div>

            <!-- Mensaje de éxito -->
            <div *ngIf="successMessage" class="p-4 bg-green-50/80 backdrop-blur-sm border border-green-200/50 rounded-2xl shadow-sm">
              <div class="flex items-center space-x-2">
                <p class="text-sm text-green-600 font-medium">{{ successMessage }}</p>
              </div>
            </div>

            <!-- Botón de registro -->
            <div class="pt-2">
              <button
                type="submit"
                [disabled]="registerForm.invalid || isLoading"
                class="w-full px-6 py-4 bg-gradient-to-r from-primary to-secondary text-white font-bold text-lg rounded-2xl shadow-xl hover:shadow-2xl hover:scale-[1.02] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 relative overflow-hidden group"
              >
                <!-- Efecto de brillo -->
                <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
                <span class="relative flex items-center justify-center space-x-2">
                  <span *ngIf="!isLoading" class="text-xl">→</span>
                  <span *ngIf="isLoading" class="animate-spin">⏳</span>
                  <span>{{ isLoading ? 'Registrando...' : 'Crear Cuenta' }}</span>
                </span>
              </button>
            </div>
          </form>
        </div>

        <!-- Links adicionales -->
        <div class="text-center space-y-4">
          <div class="bg-white/60 backdrop-blur-sm rounded-2xl p-4 border border-white/30">
            <p class="text-sm text-gray-600">
              ¿Ya tienes cuenta?
              <a routerLink="/auth/login" class="text-primary hover:text-secondary font-bold transition-colors duration-300 hover:underline">
                Inicia sesión
              </a>
            </p>
          </div>
          
          <a routerLink="/" class="inline-flex items-center space-x-2 text-sm text-gray-500 hover:text-primary transition-all duration-300 hover:scale-105">
            <span>←</span>
            <span>Volver al inicio</span>
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