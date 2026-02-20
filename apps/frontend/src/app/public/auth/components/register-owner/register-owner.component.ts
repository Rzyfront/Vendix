import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  Validators,
  FormGroup,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { AuthService } from '../../../../core/services/auth.service';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import * as AuthActions from '../../../../core/store/auth/auth.actions';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../core/utils/api-error-handler';
import { passwordValidator } from '../../../../core/utils/validators';
import {
  ButtonComponent,
  InputComponent,
  CardComponent,
  IconComponent,
} from '../../../../shared/components';
import { NavigationService } from '../../../../core/services/navigation.service';
import { AppConfigService } from '../../../../core/services/app-config.service';
import { ConfigFacade } from '../../../../core/store/config';
import * as ConfigActions from '../../../../core/store/config/config.actions';

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
      class="min-h-screen flex flex-col justify-center px-4 py-6 sm:px-6 sm:py-12 lg:px-8 bg-[var(--color-background)]"
    >
      <div class="w-full max-w-md sm:max-w-lg md:max-w-xl lg:max-w-2xl mx-auto space-y-4 sm:space-y-6">
        <!-- Branding -->
        <div class="text-center">
          <div class="mx-auto flex items-center justify-center space-x-2 sm:space-x-3 mb-3 sm:mb-4">
            @if (logoUrl) {
              <div class="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center overflow-hidden">
                <img [src]="logoUrl" alt="Logo" class="w-full h-full object-contain" />
              </div>
            } @else {
              <div
                class="w-8 h-8 sm:w-10 sm:h-10 bg-[var(--color-primary)] rounded-xl flex items-center justify-center"
              >
                <app-icon name="cart" [size]="20" class="sm:hidden" color="white"></app-icon>
                <app-icon name="cart" [size]="24" class="hidden sm:block" color="white"></app-icon>
              </div>
            }
            <h1 class="text-lg sm:text-xl font-semibold text-[var(--color-text-primary)]">
              Vendix
            </h1>
          </div>
          <h2
            class="mt-4 sm:mt-6 text-xl sm:text-2xl md:text-3xl font-extrabold text-[var(--color-text-primary)]"
          >
            Crear tu organización
          </h2>
          <p class="mt-1 sm:mt-2 mb-2 text-xs sm:text-sm text-[var(--color-text-secondary)]">
            Comienza tu viaje empresarial
          </p>
        </div>

        <!-- Registration Form -->
        <app-card class="!mt-6 sm:!mt-8" [animateOnLoad]="true" shadow="lg" [responsivePadding]="true">
          <form [formGroup]="registerForm" (ngSubmit)="onSubmit()" class="space-y-4">
            <!-- Información de la organización -->
            <app-input
              label="Nombre de la organización"
              formControlName="organization_name"
              [control]="registerForm.get('organization_name')"
              type="text"
              placeholder="Mi Empresa S.A.S"
            ></app-input>

            <!-- Información personal -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
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

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <app-input
                label="Email"
                formControlName="email"
                [control]="registerForm.get('email')"
                type="email"
                placeholder="usuario@email.com"
              ></app-input>

              <app-input
                label="Teléfono"
                formControlName="phone"
                type="tel"
                placeholder="+57 123 456 7890"
                helperText="Opcional"
              ></app-input>
            </div>

            <app-input
              label="Contraseña"
              formControlName="password"
              [control]="registerForm.get('password')"
              type="password"
              placeholder="••••••••"
              helperText="Mín. 8 caracteres, 1 mayúscula y 1 especial"
            ></app-input>

            <!-- Error Display -->
            @if (hasError) {
              <div
                class="rounded-md bg-[rgba(239,68,68,0.1)] p-3 sm:p-4 border border-[rgba(239,68,68,0.2)] mt-3 sm:mt-4"
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
                      class="text-xs sm:text-sm font-medium text-[var(--color-destructive)]"
                    >
                      {{ errorMessage }}
                    </h3>
                  </div>
                </div>
              </div>
            }

            <div class="pt-3 sm:pt-4">
              <app-button
                type="submit"
                variant="primary"
                size="md"
                [disabled]="registerForm.invalid"
                [loading]="isLoading"
                [fullWidth]="true"
                [showTextWhileLoading]="true"
              >
                @if (!isLoading) {
                  <span>Crear cuenta</span>
                }
                @if (isLoading) {
                  <span>Creando...</span>
                }
              </app-button>
            </div>

            <div
              class="flex justify-center items-center text-xs sm:text-sm text-[var(--color-text-secondary)] pt-3 sm:pt-4"
            >
              <p>
                ¿Ya tienes cuenta?
                <a
                  [routerLink]="['/auth', 'login']"
                  class="font-medium text-[var(--color-primary)] hover:text-[var(--color-secondary)] active:opacity-70 transition-opacity"
                >
                  Inicia sesión
                </a>
              </p>
            </div>
          </form>
        </app-card>

        <!-- Back to Landing -->
        <div class="text-center mt-4 sm:mt-6">
          <a
            routerLink="/"
            class="inline-block py-2 px-1 text-sm sm:text-base font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] active:opacity-70 transition-opacity"
          >
            ← Volver al inicio
          </a>
        </div>

        <!-- Context Info -->
        <div class="text-center text-xs text-[var(--color-text-muted)] mt-3 sm:mt-4">
          <p>Acceso a Vendix Platform</p>
          <p class="mt-1">Powered by Vendix</p>
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
export class RegisterOwnerComponent implements OnInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private authFacade = inject(AuthFacade);
  private router = inject(Router);
  private toast = inject(ToastService);
  private navigationService = inject(NavigationService);
  private appConfigService = inject(AppConfigService);
  private configFacade = inject(ConfigFacade);
  private store = inject(Store);

  registrationState: RegistrationState = 'idle';
  registrationError: RegistrationError | null = null;
  logoUrl: string = '';

  isLoading = false;

  registerForm: FormGroup = this.fb.group({
    organization_name: ['', [Validators.required]],
    first_name: ['', [Validators.required]],
    last_name: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    phone: [
      '',
      [
        Validators.pattern(/^[\d+#*\s()-]*$/),
        Validators.minLength(8),
        Validators.maxLength(15),
      ],
    ],
    password: ['', [Validators.required, passwordValidator]],
  });

  ngOnInit(): void {
    const appConfig = this.configFacade.getCurrentConfig();
    if (appConfig) {
      this.logoUrl = appConfig.branding?.logo?.url || '';
      if (!this.logoUrl && appConfig.domainConfig?.isVendixDomain) {
        this.logoUrl = 'vlogo.png';
      }
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

  onSubmit() {
    if (this.registerForm.valid) {
      this.isLoading = true;
      this.clearError();

      this.authService.registerOwner(this.registerForm.value).subscribe({
        next: async (result) => {
          if (result.success && result.data) {
            // Restaurar el estado de la aplicación con el nuevo usuario
            const { user, user_settings, access_token, refresh_token } =
              result.data;

            // 🔒 LIMPIEZA ADICIONAL: Asegurar que no haya residuos del environment anterior
            if (typeof localStorage !== 'undefined') {
              localStorage.removeItem('vendix_user_environment');
              localStorage.removeItem('vendix_app_config');
            }

            // 🚀 Usar la acción de loginSuccess para aprovechar toda la maquinaria de redirección
            // y configuración de entorno que ya funciona en el login.
            this.store.dispatch(
              AuthActions.loginSuccess({
                user,
                user_settings,
                tokens: { access_token, refresh_token },
                permissions: result.data.permissions,
                roles: user.roles,
                message: '¡Registro exitoso! Bienvenido a Vendix.',
                updated_environment: (result as any).updatedEnvironment,
              }),
            );

            this.registrationState = 'success';
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
