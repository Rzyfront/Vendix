import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  Validators,
  FormGroup,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../core/utils/api-error-handler';
import { passwordValidator } from '../../../../core/utils/validators';
import {
  ButtonComponent,
  InputComponent,
  CardComponent,
  IconComponent,
} from '../../../../shared/components';

type RegistrationState = 'idle' | 'loading' | 'success' | 'error';

interface RegistrationError {
  type: RegistrationState;
  message: string;
  details?: string;
}

@Component({
  selector: 'app-register-owner',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    InputComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
  ],
  template: `
    <div
      class="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-[var(--color-background)]"
    >
      <div class="max-w-2xl w-full space-y-8">
        <!-- Branding -->
        <div class="text-center my-3">
          <div class="mx-auto flex items-center justify-center space-x-3 mb-4">
            <div
              class="w-10 h-10 bg-[var(--color-primary)] rounded-xl flex items-center justify-center"
            >
              <app-icon name="cart" [size]="24" color="white"></app-icon>
            </div>
            <h1 class="text-xl font-semibold text-[var(--color-text-primary)]">
              Vendix
            </h1>
          </div>
          <h2
            class="mt-6 text-3xl font-extrabold text-[var(--color-text-primary)]"
          >
            Crear tu organización
          </h2>
          <p class="mt-2 text-sm text-[var(--color-text-secondary)]">
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
                helperText="La contraseña debe tener al menos 8 caracteres, una letra mayúscula y un carácter especial."
              ></app-input>
            </div>

            <!-- Error Display -->
            @if (hasError) {
              <div
                class="rounded-md bg-[rgba(239, 68, 68, 0.1)] p-4 border border-[rgba(239, 68, 68, 0.2)] mt-4"
              >
                <div class="flex">
                  <div class="flex-shrink-0">
                    <svg
                      class="h-5 w-5 text-[var(--color-destructive)]"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </div>
                  <div class="ml-3">
                    <h3
                      class="text-sm font-medium text-[var(--color-destructive)]"
                    >
                      {{ errorMessage }}
                    </h3>
                  </div>
                </div>
              </div>
            }

            <div class="pt-4">
              <app-button
                type="submit"
                variant="primary"
                size="md"
                [disabled]="registerForm.invalid"
                [loading]="isLoading"
                [fullWidth]="true"
                [showTextWhileLoading]="true"
                class="mt-4 w-full"
              >
                @if (!isLoading) {
                  <span>Crear cuenta</span>
                }
                @if (isLoading) {
                  <span>Creando cuenta...</span>
                }
              </app-button>
            </div>

            <div
              class="flex justify-center items-center text-sm text-[var(--color-text-secondary)] pt-4"
            >
              <p>
                ¿Ya tienes una cuenta?
                <a
                  [routerLink]="['/auth', 'login']"
                  class="font-medium text-[var(--color-primary)] hover:text-[var(--color-secondary)]"
                >
                  Inicia sesión
                </a>
              </p>
            </div>
          </form>
        </app-card>

        <!-- Back to Landing -->
        <div class="text-center mt-6">
          <a
            routerLink="/"
            class="font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary)]"
          >
            ← Volver al inicio
          </a>
        </div>

        <!-- Context Info -->
        <div class="text-center text-xs text-[var(--color-text-muted)] mt-4">
          <p>Acceso a Vendix Platform</p>
          <p>Powered by Vendix</p>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class RegisterOwnerComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastService);

  registrationState: RegistrationState = 'idle';
  registrationError: RegistrationError | null = null;

  isLoading = false;

  registerForm: FormGroup = this.fb.group({
    organization_name: ['', [Validators.required]],
    first_name: ['', [Validators.required]],
    last_name: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    phone: [
      '',
      [
        Validators.pattern(/^[0-9+ ]+$/),
        Validators.minLength(8),
        Validators.maxLength(15),
      ],
    ],
    password: ['', [Validators.required, passwordValidator]],
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
      this.clearError();

      this.authService.registerOwner(this.registerForm.value).subscribe({
        next: (result) => {
          if (result.success) {
            // Redirigir al dashboard después del registro exitoso
            this.registrationState = 'success';
            this.toast.success('¡Registro exitoso! Bienvenido a Vendix.');
            this.router.navigate(['/admin']);
          } else {
            // Manejar error (mostrar mensaje de error)
            if (result.message) {
              this.handleRegistrationError(result.message);
            }
          }
        },
        error: (error) => {
          // Manejar error de red u otros errores
          const errorMessage =
            typeof error === 'string' ? error : extractApiErrorMessage(error);
          this.handleRegistrationError(errorMessage);
        },
        complete: () => {
          this.isLoading = false;
        },
      });
    } else {
      Object.keys(this.registerForm.controls).forEach((key) => {
        this.registerForm.get(key)?.markAsTouched();
      });

      if (this.registerForm.invalid) {
        this.toast.warning(
          'Por favor, corrige los errores en el formulario antes de continuar',
        );
      }
    }
  }

  private handleRegistrationError(error: string): void {
    this.registrationState = 'error';
    this.setRegistrationError({
      type: 'error',
      message: error,
    });
  }

  private setRegistrationError(error: RegistrationError): void {
    this.registrationState = error.type;
    this.registrationError = error;

    // Mostrar mensaje en toast
    const toastText = error.message;
    switch (error.type) {
      case 'error':
        this.toast.error(toastText, 'Error de registro', 5000);
        break;
      default:
        this.toast.error(toastText, 'Error', 5000);
    }
  }

  private clearError(): void {
    this.registrationState = 'idle';
    this.registrationError = null;
  }

  // Computed properties for template
  get hasError(): boolean {
    return this.registrationState === 'error';
  }

  get errorMessage(): string {
    return this.registrationError?.message || '';
  }
}
