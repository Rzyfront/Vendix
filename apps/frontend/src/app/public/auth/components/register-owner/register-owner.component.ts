import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';

@Component({
  selector: 'app-register-owner',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div class="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-gray-50 to-green-50">
      <div class="max-w-md w-full space-y-8">
        <!-- Branding -->
        <div class="text-center">
          <div class="mx-auto h-16 w-16 bg-primary rounded-full flex items-center justify-center mb-4">
            <span class="text-white font-bold text-xl">V</span>
          </div>
          <h2 class="mt-6 text-3xl font-extrabold text-gray-900">
            Crear tu organización
          </h2>
          <p class="mt-2 text-sm text-gray-600">
            Comienza tu viaje empresarial con Vendix
          </p>
        </div>

        <!-- Registration Form -->
        <form [formGroup]="registerForm" (ngSubmit)="onSubmit()" class="mt-8 space-y-6 bg-white p-8 rounded-lg shadow-lg">
          <div class="space-y-4">
            <!-- Información de la organización -->
            <div>
              <label for="organization_name" class="block text-sm font-medium text-gray-700">
                Nombre de la organización
              </label>
              <input
                id="organization_name"
                name="organization_name"
                type="text"
                formControlName="organization_name"
                [class]="getFieldClass('organization_name')"
                placeholder="Mi Empresa S.A.S"
                (blur)="onFieldBlur('organization_name')"
                (input)="onFieldInput('organization_name')"
              >
              <div *ngIf="hasFieldError('organization_name')" class="mt-1 text-sm text-red-600">
                {{ getFieldError('organization_name') }}
              </div>
            </div>

            <!-- Información personal -->
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label for="first_name" class="block text-sm font-medium text-gray-700">
                  Nombre
                </label>
                <input
                  id="first_name"
                  name="first_name"
                  type="text"
                  formControlName="first_name"
                  [class]="getFieldClass('first_name')"
                  placeholder="Juan"
                  (blur)="onFieldBlur('first_name')"
                  (input)="onFieldInput('first_name')"
                >
                <div *ngIf="hasFieldError('first_name')" class="mt-1 text-sm text-red-600">
                  {{ getFieldError('first_name') }}
                </div>
              </div>

              <div>
                <label for="last_name" class="block text-sm font-medium text-gray-700">
                  Apellido
                </label>
                <input
                  id="last_name"
                  name="last_name"
                  type="text"
                  formControlName="last_name"
                  [class]="getFieldClass('last_name')"
                  placeholder="Pérez"
                  (blur)="onFieldBlur('last_name')"
                  (input)="onFieldInput('last_name')"
                >
                <div *ngIf="hasFieldError('last_name')" class="mt-1 text-sm text-red-600">
                  {{ getFieldError('last_name') }}
                </div>
              </div>
            </div>

            <div>
              <label for="email" class="block text-sm font-medium text-gray-700">
                Correo electrónico
              </label>
              <input
                id="email"
                name="email"
                type="email"
                formControlName="email"
                [class]="getFieldClass('email')"
                placeholder="usuario@email.com"
                (blur)="onFieldBlur('email')"
                (input)="onFieldInput('email')"
              >
              <div *ngIf="hasFieldError('email')" class="mt-1 text-sm text-red-600">
                {{ getFieldError('email') }}
              </div>
            </div>

            <div>
              <label for="phone" class="block text-sm font-medium text-gray-700">
                Teléfono (opcional)
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                formControlName="phone"
                class="w-full px-4 py-3 rounded-input border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary text-gray-900 placeholder-gray-500 transition-all duration-300"
                placeholder="+57 123 456 7890"
              >
            </div>

            <div>
              <label for="password" class="block text-sm font-medium text-gray-700">
                Contraseña
              </label>
              <input
                id="password"
                name="password"
                type="password"
                formControlName="password"
                [class]="getFieldClass('password')"
                placeholder="••••••••"
                (blur)="onFieldBlur('password')"
                (input)="onFieldInput('password')"
              >
              <div *ngIf="hasFieldError('password')" class="mt-1 text-sm text-red-600">
                {{ getFieldError('password') }}
              </div>
            </div>
          </div>

          <div>
            <button
              type="submit"
              [disabled]="registerForm.invalid || isLoading"
              [class]="isLoading
                ? 'w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary/70 cursor-not-allowed'
                : 'w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary'"
            >
              <span *ngIf="isLoading" class="flex items-center">
                <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Creando cuenta...
              </span>
              <span *ngIf="!isLoading">Crear cuenta</span>
            </button>
          </div>

          <div class="text-center text-sm text-gray-600">
            <p>
              ¿Ya tienes una cuenta?
              <a [routerLink]="['/auth', 'login']" class="font-medium text-primary hover:text-primary-dark">
                Inicia sesión
              </a>
            </p>
          </div>
        </form>

        <!-- Context Info -->
        <div class="text-center text-xs text-gray-500 mt-4">
          <p>Acceso a Vendix Platform</p>
          <p>Powered by Vendix Platform</p>
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
export class RegisterOwnerComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);

  isLoading = false;

  registerForm: FormGroup = this.fb.group({
    organization_name: ['', [Validators.required]],
    first_name: ['', [Validators.required]],
    last_name: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    phone: [''],
    password: ['', [
      Validators.required,
      Validators.minLength(8),
      Validators.pattern(/^(?=.*[^A-Za-z0-9])(?=.*[A-Z]).*$/)
    ]]
  });

  getFieldClass(fieldName: string): string {
    const field = this.registerForm.get(fieldName);
    const baseClasses = 'w-full px-4 py-3 rounded-input border transition-all duration-300 focus:outline-none focus:ring-2 text-gray-900 placeholder-gray-500';
    
    if (field?.invalid && field?.touched) {
      return `${baseClasses} border-red-300 bg-red-50 focus:border-red-500 focus:ring-red-500/50`;
    } else if (field?.valid && field?.touched && field?.value) {
      return `${baseClasses} border-green-300 bg-green-50 focus:border-green-500 focus:ring-green-500/50`;
    } else {
      return `${baseClasses} border-gray-300 bg-white focus:border-primary focus:ring-primary/50`;
    }
  }

  onFieldBlur(fieldName: string): void {
    const field = this.registerForm.get(fieldName);
    field?.markAsTouched();
  }

  onFieldInput(fieldName: string): void {
    const field = this.registerForm.get(fieldName);
    if (field) {
      field.markAsDirty();
    }
  }

  getFieldError(fieldName: string): string {
    const field = this.registerForm.get(fieldName);
    if (field?.errors && field?.touched) {
      if (field.errors['required']) {
        if (fieldName === 'organization_name') {
          return 'El nombre de la organización es requerido';
        }
        return `${fieldName === 'email' ? 'El email' : 'La contraseña'} es requerida`;
      }
      if (field.errors['email']) {
        return 'Debe ser un email válido';
      }
      if (field.errors['minlength']) {
        return 'La contraseña debe tener al menos 8 caracteres';
      }
      if (field.errors['pattern']) {
        return 'La contraseña debe contener al menos un carácter especial y una letra mayúscula';
      }
    }
    return '';
  }

  hasFieldError(fieldName: string): boolean {
    const field = this.registerForm.get(fieldName);
    return !!(field?.errors && field?.touched);
  }

  onSubmit() {
    if (this.registerForm.valid) {
      this.isLoading = true;
      
      this.authService.registerOwner(this.registerForm.value).subscribe({
        next: (result) => {
          if (result.success) {
            // Redirigir al dashboard después del registro exitoso
            this.router.navigate(['/admin']);
          } else {
            // Manejar error (podría mostrar un toast o mensaje de error)
            console.error('Error en registro:', result.message);
          }
        },
        error: (error) => {
          console.error('Error en registro:', error);
        },
        complete: () => {
          this.isLoading = false;
        }
      });
    } else {
      Object.keys(this.registerForm.controls).forEach(key => {
        this.registerForm.get(key)?.markAsTouched();
      });
    }
  }
}