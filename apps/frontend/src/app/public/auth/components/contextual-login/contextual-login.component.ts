import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { AppConfigService } from '../../../../core/services/app-config.service';
import { takeUntil } from 'rxjs/operators';
import { Subject, Subscription } from 'rxjs';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../core/utils/api-error-handler';
import {
  InputComponent,
  ButtonComponent,
  CardComponent
} from '../../../../shared/components';

export type LoginState = 'idle' | 'loading' | 'success' | 'error' | 'network_error' | 'rate_limited' | 'too_many_attempts' | 'account_locked' | 'account_suspended' | 'email_not_verified' | 'password_expired';

export interface LoginError {
  type: LoginState;
  message: string;
  details?: string;
  apiError?: string; // raw `error` field from API (show in toast)
}

@Component({
  selector: 'app-contextual-login',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    InputComponent,
    ButtonComponent,
    CardComponent
  ],
  template: `
    <div class="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8" [class]="backgroundClass">
      <div class="max-w-sm w-full space-y-8">
        <!-- Contextual Branding -->
        <div class="text-center my-3">
          @if (logoUrl) {
            <div class="mx-auto h-16 w-16 flex items-center justify-center mb-4">
              <img [src]="logoUrl" [alt]="displayName" class="h-14 w-14 rounded-md">
            </div>
          } @else {
            <div class="mx-auto h-16 w-16 bg-primary rounded-full flex items-center justify-center mb-4">
              <span class="text-white font-bold text-xl">{{ contextInitial }}</span>
            </div>
          }

          <h2 class="mt-6 text-2xl font-extrabold text-text-primary">
            {{ loginTitle }}
          </h2>
          @if (displayName) {
            <p class="mt-2 text-sm text-text-secondary">
              {{ contextDescription }}
            </p>
          }
          @if (!displayName) {
            <p class="mt-1 text-sm text-text-tertiary">
              {{ defaultDescription }}
            </p>
          }
        </div>

        <!-- Login Form -->
        <app-card shadow="md" class="mt-20" [animateOnLoad]="true">
          <form [formGroup]="loginForm" (ngSubmit)="onSubmit()" class="space-y-8">
            <div>
              <!-- Vlink Field (only for Vendix context) -->
              @if (contextType === 'vendix') {
                <app-input
                  label="Vlink"
                  formControlName="vlink"
                  [control]="loginForm.get('vlink')"
                  type="text"
                  size="md"
                  placeholder="mi-organizacion"
                  (inputBlur)="onFieldBlur('vlink')"
                  (inputChange)="onFieldInput('vlink')"
                  >
                </app-input>
              }

              <!-- Email Field -->
              <app-input
                [label]="emailLabel"
                formControlName="email"
                [control]="loginForm.get('email')"
                type="email"
                size="md"
                [placeholder]="emailPlaceholder"
                (inputBlur)="onFieldBlur('email')"
                (inputChange)="onFieldInput('email')">
              </app-input>

              <!-- Password Field -->
              <app-input
                label="Contraseña"
                formControlName="password"
                [control]="loginForm.get('password')"
                type="password"
                size="md"
                placeholder="••••••••"
                (inputBlur)="onFieldBlur('password')"
                (inputChange)="onFieldInput('password')">
              </app-input>
            </div>

            <!-- Error Display -->
            @if (hasError) {
              <div class="rounded-md bg-red-50 p-4 border border-red-200">
                <div class="flex">
                  <div class="flex-shrink-0">
                    <svg class="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
                    </svg>
                  </div>
                  <div class="ml-3">
                    <!-- Login Error Messages -->
                    @if (hasError) {
                      <h3 class="text-sm font-medium text-red-800">
                        {{ errorMessage }}
                      </h3>
                      @if (errorDetails) {
                        <div class="mt-2 text-sm text-red-700">
                          {{ errorDetails }}
                        </div>
                      }
                    }
                  </div>
                </div>
              </div>
            }

            <!-- Submit Button -->
            <app-button
              type="submit"
              variant="primary"
              size="md"
              [disabled]="!isFormValid"
              [loading]="isLoading"
              [fullWidth]="true"
              [showTextWhileLoading]="true"
              class="mt-4 w-full">
              @if (isLoading) {
                Iniciando sesión...
              } @else {
                Iniciar Sesión
              }
            </app-button>

            <!-- Actions -->
            <div class="flex justify-center mt-4">
              <div class="text-sm">
                <a
                  (click)="navigateToForgotPassword()"
                  class="font-medium text-primary hover:text-primary-dark cursor-pointer">
                  ¿Olvidaste tu contraseña?
                </a>
              </div>
            </div>

          </form>
        </app-card>

        <!-- Additional Links -->
        <div class="text-center text-sm text-text-secondary">
          @if (contextType === 'vendix') {
            <p>
              ¿Necesitas una cuenta corporativa?
              <a routerLink="/auth/register" class="font-medium text-primary hover:text-primary-dark">
                Solicitar acceso
              </a>
            </p>
          }

          @if (contextType === 'organization') {
            <p>
              ¿Eres cliente?
              <a [routerLink]="['/shop']" class="font-medium text-primary hover:text-primary-dark">
                Accede a nuestra tienda
              </a>
            </p>
          }

          @if (contextType === 'store') {
            <p>
              ¿No tienes cuenta?
              <a [routerLink]="['/auth/register']" class="font-medium text-primary hover:text-primary-dark">
                Regístrate aquí
              </a>
            </p>
            <p class="mt-2">
              <a [routerLink]="['/']" class="font-medium text-primary hover:text-primary-dark">
                Continuar como invitado
              </a>
            </p>
          }
        </div>

        <!-- Context Info -->
        @if (displayName) {
          <div class="text-center text-xs text-text-tertiary mt-4">
            <p>{{ contextFooter }}</p>
            <p>Powered by Quickss</p>
          </div>
        }
      </div>
    </div>
  `,
  styleUrls: []
})
export class ContextualLoginComponent implements OnInit, OnDestroy {
  loginForm: FormGroup;
  loginState: LoginState = 'idle';
  loginError: LoginError | null = null;
  loginAttempts = 0;
  maxAttempts = 5;
  lockoutTime = 180;
  apiErrorMessage: string | null = null;
  
  // Error tracking for showing one correction at a time
  currentErrorIndex = 0;
  previousFieldErrors: { field: string; message: string }[] = [];
  
  // Context properties
  contextType: 'vendix' | 'organization' | 'store' = 'vendix';
  displayName: string = '';
  logoUrl: string = '';
  primaryColor: string = '';

  private destroy$ = new Subject<void>();
  private toast = inject(ToastService);
  private appConfig = inject(AppConfigService);

  constructor(
    private fb: FormBuilder,
    private authFacade: AuthFacade,
    private tenantFacade: TenantFacade,
    private router: Router
  ) {
    this.loginForm = this.fb.group({
      vlink: [''],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  ngOnInit(): void {
    // Load auth context from AppConfig
    this.loadAuthContext();
    
    // Subscribe to reactive auth state
    this.authFacade.loading$.pipe(takeUntil(this.destroy$)).subscribe(loading => {
      if (loading) {
        this.loginState = 'loading';
      }
      // When loading becomes false, don't automatically set to idle
      // Let the error or success handlers manage the state
    });

    this.authFacade.error$.pipe(takeUntil(this.destroy$)).subscribe(error => {
      if (error) {
        // Normalize error to handle both string and NormalizedApiPayload types
        const normalizedError = typeof error === 'string' ? error : extractApiErrorMessage(error);
        this.handleLoginError(normalizedError);
      } else {
        // Clear error state when error becomes null (e.g., after retry)
        this.clearError();
      }
    });

    // Subscribe to authentication success
    this.authFacade.isAuthenticated$.pipe(takeUntil(this.destroy$)).subscribe(isAuth => {
      if (isAuth) {
        const welcomeMessage = this.getWelcomeMessage();
        this.toast.success(welcomeMessage);
        this.loginState = 'success';
      }
    });
  }

  private loadAuthContext(): void {
    const appConfig = this.appConfig.getCurrentConfig();
    if (!appConfig) {
      console.warn('[CONTEXTUAL-LOGIN] App config not available, using default context');
      return;
    }

    const domainConfig = appConfig.domainConfig;
    const tenantConfig = appConfig.tenantConfig;

    // Determine context type based on domain configuration
    if (domainConfig.domainType === 'vendix_core') {
      this.contextType = 'vendix';
      this.displayName = 'Vendix Platform';
      // Require vlink for vendix context
      this.loginForm.patchValue({ vlink: '' });
      this.loginForm.get('vlink')?.setValidators([Validators.required]);
      this.loginForm.get('vlink')?.updateValueAndValidity();
    } else if (domainConfig.domainType === 'organization') {
      this.contextType = 'organization';
      this.displayName = domainConfig.organization_slug || '';
      // Clear vlink field for organization context (will use domain slug)
      this.loginForm.patchValue({ vlink: '' });
      this.loginForm.get('vlink')?.clearValidators();
      this.loginForm.get('vlink')?.updateValueAndValidity();
    } else if (domainConfig.domainType === 'store' || domainConfig.domainType === 'ecommerce') {
      this.contextType = 'store';
      this.displayName = domainConfig.store_slug || '';
      // Clear vlink field for store context (will use domain slug)
      this.loginForm.patchValue({ vlink: '' });
      this.loginForm.get('vlink')?.clearValidators();
      this.loginForm.get('vlink')?.updateValueAndValidity();
    } else {
      // Fallback to vendix context if domain type is not recognized
      this.contextType = 'vendix';
      this.displayName = 'Vendix Platform';
      this.loginForm.patchValue({ vlink: '' });
      this.loginForm.get('vlink')?.setValidators([Validators.required]);
      this.loginForm.get('vlink')?.updateValueAndValidity();
    }

    // Apply branding
    this.logoUrl = tenantConfig?.branding?.logo?.url || '';
    this.primaryColor = tenantConfig?.branding?.colors?.primary || '#3b82f6';

    // Los estilos CSS ya fueron aplicados globalmente por ThemeService durante la inicialización
    // No es necesario actualizarlos aquí nuevamente
  }

  private handleLoginError(error: string): void {
    this.loginAttempts++;

    // El error ya está normalizado como string desde la suscripción
    let apiMessage = error;
    let apiErrorText = error;

    const combined = `${apiMessage} ${apiErrorText}`.toLowerCase();

    // Manejar tipos específicos de error basados en el mensaje combinado
    if (combined.includes('credenciales inválidas') || combined.includes('invalid credentials')) {
      if (this.loginAttempts >= this.maxAttempts) {
        this.setLoginError({
          type: 'too_many_attempts',
          message: `Demasiados intentos fallidos. Espera ${this.lockoutTime / 60} minutos.`
        });
      } else {
        this.setLoginError({
          type: 'error',
          message: apiMessage, // mostrar `message` en pantalla
          apiError: apiErrorText || undefined // preferir `error` en toast
        });
      }
  } else if (combined.includes('email not verified') || combined.includes('verificar email')) {
      this.setLoginError({
        type: 'email_not_verified',
        message: apiMessage,
        apiError: apiErrorText || undefined
      });
  } else if (combined.includes('too many') || combined.includes('demasiados') || combined.includes('cuenta bloqueada')) {
      this.setLoginError({
        type: 'too_many_attempts',
        message: apiMessage,
        apiError: apiErrorText || undefined
      });
  } else if (combined.includes('suspended') || combined.includes('suspendida')) {
      this.setLoginError({
        type: 'account_suspended',
        message: apiMessage,
        apiError: apiErrorText || undefined
      });
  } else if (combined.includes('expired') || combined.includes('expirada')) {
      this.setLoginError({
        type: 'password_expired',
        message: apiMessage,
        apiError: apiErrorText || undefined
      });
  } else if (combined.includes('conexión') || combined.includes('connection')) {
      this.setLoginError({
        type: 'network_error',
        message: apiMessage,
        apiError: apiErrorText || undefined
      });
    } else {
      this.setLoginError({
        type: 'error',
        message: apiMessage,
        apiError: apiErrorText || undefined
      });
    }
  }

  private setLoginError(error: LoginError): void {
    this.loginState = error.type;
    this.loginError = error;
    // Keep a local copy of the API message so transient clears from the facade
    // don't immediately hide the UI message while the user can retry.
    this.apiErrorMessage = error.message;


  // Prefer the server `error` field in toasts (English/internal code),
  // but keep `message` for UI display.
  const toastText = error.apiError || error.message;
  switch (error.type) {
      case 'network_error':
          this.toast.error('Error de conexión. Verifica tu conexión a internet.', 'Error de red', 5000);
        break;
      case 'rate_limited':
      case 'too_many_attempts':
          this.toast.warning(toastText, 'Demasiados intentos', 5000);
        break;
      case 'account_locked':
      case 'account_suspended':
          this.toast.error(toastText, 'Cuenta no disponible', 5000);
        break;
      case 'email_not_verified':
          this.toast.info(toastText, 'Verificación requerida', 5000);
        break;
      default:
          this.toast.error(toastText, 'Error de inicio de sesión', 5000);
    }
  }

  private clearError(): void {
    this.loginState = 'idle';
    this.loginError = null;
    this.apiErrorMessage = null;
  }


  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  resetForm(): void {
    this.clearError();
    this.loginForm.reset();
    this.loginAttempts = 0;
    localStorage.removeItem('login_lockout_until');
  }

  onFieldBlur(fieldName: string): void {
    const field = this.loginForm.get(fieldName);
    field?.markAsTouched();
  }

  onFieldInput(fieldName: string): void {
    const field = this.loginForm.get(fieldName);
    if (field) {
      field.markAsDirty();
    }
  }

  onSubmit(): void {
    if (this.loginForm.valid && this.loginState !== 'loading') {
      // Clear previous transient errors for new attempt
      this.apiErrorMessage = null;
      this.loginError = null;

      // Clear previous transient errors for new attempt; rely on the global
      // authFacade.error$ subscription in ngOnInit to handle errors and toasts.
      // Avoid creating local subscriptions here to prevent duplicate toasts.

      const { vlink, email, password } = this.loginForm.value;

      let store_slug: string | undefined;
      let organization_slug: string | undefined;

      // Determine which slug to use based on context
      if (this.contextType === 'vendix') {
        // En contexto Vendix, el vlink ingresado por el usuario se usa como organization_slug
        organization_slug = vlink;
      } else if (this.contextType === 'organization') {
        // En contexto organización, usar el slug del dominio
        organization_slug = this.displayName;
      } else if (this.contextType === 'store') {
        // En contexto tienda, usar el slug del dominio
        store_slug = this.displayName;
      }

      // Use direct authentication through AuthFacade with appropriate slug context
      this.authFacade.login(email, password, store_slug, organization_slug);
    } else {
      Object.keys(this.loginForm.controls).forEach(key => {
        this.loginForm.get(key)?.markAsTouched();
      });

      if (this.hasError) {
        this.toast.warning('Corrige los errores antes de continuar');
      }
    }
  }


  navigateToForgotPassword(): void {
    this.router.navigate(['/auth/forgot-owner-password']);
  }

  // Computed properties for template
  get hasError(): boolean {
    return this.loginState !== 'idle' && this.loginState !== 'loading' && this.loginState !== 'success';
  }

  get isLoading(): boolean {
    return this.loginState === 'loading';
  }

  get isFormValid(): boolean {
    return this.loginForm.valid && this.loginState !== 'loading';
  }

  get errorMessage(): string {
    return this.loginError?.message || '';
  }

  get errorDetails(): string {
    return this.loginError?.details || '';
  }

  get apiError(): string | null {
    return this.apiErrorMessage || this.loginError?.message || null;
  }

  // Contextual computed properties
  get backgroundClass(): string {
    switch (this.contextType) {
      case 'vendix':
        return 'bg-gradient-to-br from-gray-50 to-green-50';
      case 'organization':
        return 'bg-gradient-to-br from-blue-50 to-indigo-50';
      case 'store':
        return 'bg-gradient-to-br from-orange-50 to-red-50';
      default:
        return 'bg-gray-50';
    }
  }

  get contextInitial(): string {
    switch (this.contextType) {
      case 'vendix': return 'V';
      case 'organization': return 'O';
      case 'store': return 'S';
      default: return 'L';
    }
  }

  get loginTitle(): string {
    switch (this.contextType) {
      case 'vendix':
        return 'Iniciar Sesión en Vendix';
      case 'organization':
      case 'store':
        return 'Iniciar Sesión';
      default:
        return 'Iniciar Sesión';
    }
  }

  get contextDescription(): string {
    switch (this.contextType) {
      case 'vendix':
        return 'Plataforma de gestión multi-tenant';
      case 'organization':
        return `en ${this.displayName}`;
      case 'store':
        return `en ${this.displayName}`;
      default:
        return '';
    }
  }

  get defaultDescription(): string {
    switch (this.contextType) {
      case 'vendix':
        return 'Plataforma de gestión multi-tenant';
      case 'organization':
        return 'Plataforma organizacional';
      case 'store':
        return 'Tienda en línea';
      default:
        return '';
    }
  }

  get emailLabel(): string {
    switch (this.contextType) {
      case 'vendix':
      case 'organization':
        return 'Email Corporativo';
      case 'store':
        return 'Email';
      default:
        return 'Email';
    }
  }

  get emailPlaceholder(): string {
    switch (this.contextType) {
      case 'vendix':
      case 'organization':
        return 'usuario@empresa.com';
      case 'store':
        return 'cliente@email.com';
      default:
        return 'usuario@email.com';
    }
  }

  get contextFooter(): string {
    switch (this.contextType) {
      case 'vendix':
        return 'Acceso a Vendix Platform';
      case 'organization':
        return `Acceso administrativo de ${this.displayName}`;
      case 'store':
        return `Acceso a ${this.displayName}`;
      default:
        return '';
    }
  }

  private getWelcomeMessage(): string {
    switch (this.contextType) {
      case 'vendix':
        return '¡Bienvenido a Vendix Platform!';
      case 'organization':
        return `¡Bienvenido a ${this.displayName || 'tu organización'}!`;
      case 'store':
        return `¡Bienvenido a ${this.displayName || 'nuestra tienda'}!`;
      default:
        return '¡Bienvenido!';
    }
  }
}
