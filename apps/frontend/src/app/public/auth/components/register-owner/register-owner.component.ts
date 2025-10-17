import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';
import { ButtonComponent, InputComponent, CardComponent } from '../../../../shared/components';

@Component({
  selector: 'app-register-owner',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, InputComponent, ButtonComponent, CardComponent],
  template: `
    <div class="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-gray-50 to-green-50">
      <div class="max-w-2xl w-full space-y-8">
        <!-- Branding -->
        <div class="text-center my-3">
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
        <app-card [animateOnLoad]="true" shadow="lg">
          <form [formGroup]="registerForm" (ngSubmit)="onSubmit()">
            <div>
              <!-- Información de la organización -->
              <app-input
                label="Nombre de la organización"
                formControlName="organization_name"
                [control]="registerForm.get('organization_name')"
                type="text"
                placeholder="Mi Empresa S.A.S"
              ></app-input>

              <!-- Información personal -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <app-input
                  label="Nombre"
                  formControlName="first_name"
                  [control]="registerForm.get('first_name')"
                  type="text"
                  placeholder="Juan"
                ></app-input>

                <app-input
                  label="Apellido"
                  formControlName="last_name"
                  [control]="registerForm.get('last_name')"
                  type="text"
                  placeholder="Pérez"
                ></app-input>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <app-input
                  label="Correo electrónico"
                  formControlName="email"
                  [control]="registerForm.get('email')"
                  type="email"
                  placeholder="usuario@email.com"
                ></app-input>

                <app-input
                  label="Teléfono (opcional)"
                  formControlName="phone"
                  type="tel"
                  placeholder="+57 123 456 7890"
                ></app-input>
              </div>

              <app-input
                label="Contraseña"
                formControlName="password"
                [control]="registerForm.get('password')"
                type="password"
                placeholder="••••••••"
              ></app-input>
            </div>

            <div class="pt-4">
              <app-button
                type="submit"
                variant="primary"
                size="md"
                [disabled]="registerForm.invalid"
                [loading]="isLoading"
                [fullWidth]="true"
                [showTextWhileLoading]="true"
                class="mt-4 w-full">
                @if (!isLoading) {
                  <span>Crear cuenta</span>
                }
                @if (isLoading) {
                  <span>Creando cuenta...</span>
                }
              </app-button>
            </div>

            <div class="text-center text-sm text-gray-600 pt-4">
              <p>
                ¿Ya tienes una cuenta?
                <a [routerLink]="['/auth', 'login']" class="font-medium text-primary hover:text-primary-dark">
                  Inicia sesión
                </a>
              </p>
            </div>
          </form>
        </app-card>

        <!-- Context Info -->
        <div class="text-center text-xs text-gray-500 mt-4">
          <p>Acceso a Vendix Platform</p>
          <p>Powered by Quickss</p>
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

  onSubmit() {
    if (this.registerForm.valid) {
      this.isLoading = true;
      
      this.authService.registerOwner(this.registerForm.value).subscribe({
        next: (result) => {
          if (result.success) {
            // Redirigir al dashboard después del registro exitoso
            this.router.navigate(['/admin']);
          }
          else {
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
    }
    else {
      Object.keys(this.registerForm.controls).forEach(key => {
        this.registerForm.get(key)?.markAsTouched();
      });
    }
  }
}