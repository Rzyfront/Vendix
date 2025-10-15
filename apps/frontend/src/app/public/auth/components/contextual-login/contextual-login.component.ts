import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { AppConfigService } from '../../../../core/services/app-config.service';
import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { ToastService } from '../../../../shared/components/toast/toast.service';

export type LoginState = 'idle' | 'loading' | 'success' | 'error' | 'network_error' | 'rate_limited' | 'too_many_attempts' | 'account_locked' | 'account_suspended' | 'email_not_verified' | 'password_expired';

export interface LoginError {
  type: LoginState;
  message: string;
  canRetry: boolean;
  retryAfter?: number;
  details?: string;
}

@Component({
  selector: 'app-contextual-login',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule
  ],
  template: `
    <div class="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8" [class]="backgroundClass">
      <div class="max-w-md w-full space-y-8">
        <!-- Contextual Branding -->
        <div class="text-center">
          @if (logoUrl) {
            <div class="mx-auto h-16 w-16 flex items-center justify-center mb-4">
              <img [src]="logoUrl" [alt]="displayName" class="h-15 w-15 rounded-md">
            </div>
          } @else {
            <div class="mx-auto h-16 w-16 bg-primary rounded-full flex items-center justify-center mb-4">
              <span class="text-white font-bold text-xl">{{ contextInitial }}</span>
            </div>
          }

          <h2 class="mt-6 text-3xl font-extrabold text-gray-900">
            {{ loginTitle }}
          </h2>
          @if (displayName) {
            <p class="mt-2 text-sm text-gray-600">
              {{ contextDescription }}
            </p>
          }
          @if (!displayName) {
            <p class="mt-1 text-sm text-gray-500">
              {{ defaultDescription }}
            </p>
          }
        </div>

        <!-- Login Form -->
        <form [formGroup]="loginForm" (ngSubmit)="onSubmit()" class="mt-8 space-y-6 bg-white p-8 rounded-lg shadow-lg">
          <div class="space-y-4">
            <!-- Vlink Field (only for Vendix context) -->
            @if (contextType === 'vendix') {
              <div>
                <label for="vlink" class="block text-sm font-medium text-gray-700">
                  Vlink
                </label>
                <input
                  id="vlink"
                  formControlName="vlink"
                  type="text"
                  autocomplete="organization"
                  [class]="getFieldClass('vlink')"
                  placeholder="mi-organizacion"
                  (blur)="onFieldBlur('vlink')"
                  (input)="onFieldInput('vlink')">
                @if (hasFieldError('vlink')) {
                  <div class="mt-1 text-sm text-red-600">
                    {{ getFieldError('vlink') }}
                  </div>
                }
                <p class="mt-1 text-xs text-gray-500">
                  Ingresa el vlink de tu organización o tienda
                </p>
              </div>
            }

            <!-- Email Field -->
            <div>
              <label for="email" class="block text-sm font-medium text-gray-700">
                {{ emailLabel }}
              </label>
              <input
                id="email"
                formControlName="email"
                type="email"
                autocomplete="email"
                [class]="getFieldClass('email')"
                [placeholder]="emailPlaceholder"
                (blur)="onFieldBlur('email')"
                (input)="onFieldInput('email')">
              @if (hasFieldError('email')) {
                <div class="mt-1 text-sm text-red-600">
                  {{ getFieldError('email') }}
                </div>
              }
            </div>

            <!-- Password Field -->
            <div>
              <label for="password" class="block text-sm font-medium text-gray-700">
                Contraseña
              </label>
              <input
                id="password"
                formControlName="password"
                type="password"
                autocomplete="current-password"
                [class]="getFieldClass('password')"
                placeholder="••••••••"
                (blur)="onFieldBlur('password')"
                (input)="onFieldInput('password')">
              @if (hasFieldError('password')) {
                <div class="mt-1 text-sm text-red-600">
                  {{ getFieldError('password') }}
                </div>
              }
            </div>
          </div>

          <!-- Error Display -->
          @if (hasError) {
            <div class="rounded-md bg-red-50 p-4">
              <div class="flex">
                <div class="flex-shrink-0">
                  <svg class="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
                  </svg>
                </div>
                <div class="ml-3">
                  <h3 class="text-sm font-medium text-red-800">
                    {{ errorMessage }}
                  </h3>
                  @if (errorDetails) {
                    <div class="mt-2 text-sm text-red-700">
                      {{ errorDetails }}
                    </div>
                  }
                  @if (canRetry && retryCountdown > 0) {
                    <div class="mt-2">
                      <p class="text-sm text-red-700">
                        Puedes reintentar en {{ retryCountdown }} segundos
                      </p>
                    </div>
                  }
                </div>
              </div>
            </div>
          }

          <!-- Actions -->
          <div class="flex items-center justify-between">
            <div class="text-sm">
              <a 
                (click)="navigateToForgotPassword()" 
                class="font-medium text-primary hover:text-primary-dark cursor-pointer">
                ¿Olvidaste tu contraseña?
              </a>
            </div>
          </div>

          <!-- Submit Button -->
          <div>
            <button
              type="submit"
              [disabled]="!isFormValid || isLoading"
              [class]="isLoading 
                ? 'w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary/70 cursor-not-allowed' 
                : 'w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary'">
              @if (isLoading) {
                <span class="flex items-center">
                  <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Iniciando sesión...
                </span>
              }
              @if (!isLoading) {
                <span>
                  Iniciar Sesión
                </span>
              }
            </button>
          </div>

          <!-- Special Actions -->
          @if (loginState === 'email_not_verified') {
            <div class="text-center">
              <button
                type="button"
                (click)="resendVerificationEmail()"
                class="text-sm font-medium text-primary hover:text-primary-dark">
                Reenviar email de verificación
              </button>
            </div>
          }

          @if (canRetry && retryCountdown === 0) {
            <div class="text-center">
              <button
                type="button"
                (click)="retryLogin()"
                class="text-sm font-medium text-primary hover:text-primary-dark">
                Reintentar inicio de sesión
              </button>
            </div>
          }
        </form>

        <!-- Additional Links -->
        <div class="text-center text-sm text-gray-600">
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
          <div class="text-center text-xs text-gray-500 mt-4">
            <p>{{ contextFooter }}</p>
            <p>Powered by Vendix Platform</p>
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
  retryCountdown = 0;
  retryTimer: any;
  
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
      this.loginState = loading ? 'loading' : 'idle';
    });

    this.authFacade.error$.pipe(takeUntil(this.destroy$)).subscribe(error => {
      if (error) {
        this.handleLoginError(error);
      }
    });

    // Subscribe to authentication success
    this.authFacade.isAuthenticated$.pipe(takeUntil(this.destroy$)).subscribe(isAuth => {
      if (isAuth) {
        const welcomeMessage = this.getWelcomeMessage();
        this.toast.success(welcomeMessage);
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

  private handleLoginError(error: any): void {
    this.loginAttempts++;
    const errorMessage = error?.message || error?.error?.message || error?.error || 'Error de autenticación';

    if (errorMessage.toLowerCase().includes('credenciales inválidas') || errorMessage.toLowerCase().includes('invalid credentials')) {
      if (this.loginAttempts >= this.maxAttempts) {
        this.setLoginError({
          type: 'too_many_attempts',
          message: `Demasiados intentos fallidos. Espera ${this.lockoutTime / 60} minutos.`,
          canRetry: true,
          retryAfter: this.lockoutTime
        });
      } else {
        this.setLoginError({
          type: 'error',
          message: 'Credenciales inválidas. Verifica tu email y contraseña.',
          canRetry: true
        });
      }
    } else if (errorMessage.toLowerCase().includes('email not verified') || errorMessage.toLowerCase().includes('verificar email')) {
      this.setLoginError({
        type: 'email_not_verified',
        message: 'Email no verificado. Revisa tu bandeja de entrada.',
        canRetry: false
      });
    } else if (errorMessage.toLowerCase().includes('too many') || errorMessage.toLowerCase().includes('demasiados') || errorMessage.toLowerCase().includes('cuenta bloqueada')) {
      this.setLoginError({
        type: 'too_many_attempts',
        message: 'Demasiados intentos fallidos. Espera unos minutos.',
        canRetry: true,
        retryAfter: this.lockoutTime
      });
    } else if (errorMessage.toLowerCase().includes('suspended') || errorMessage.toLowerCase().includes('suspendida')) {
      this.setLoginError({
        type: 'account_suspended',
        message: 'Cuenta suspendida. Contacta al administrador.',
        canRetry: false
      });
    } else if (errorMessage.toLowerCase().includes('expired') || errorMessage.toLowerCase().includes('expirada')) {
      this.setLoginError({
        type: 'password_expired',
        message: 'Contraseña expirada. Debes cambiarla.',
        canRetry: false
      });
    } else if (errorMessage.toLowerCase().includes('conexión') || errorMessage.toLowerCase().includes('connection')) {
      this.setLoginError({
        type: 'network_error',
        message: 'Error de conexión. Verifica tu conexión a internet.',
        canRetry: true
      });
    } else {
      this.setLoginError({
        type: 'error',
        message: errorMessage,
        canRetry: true
      });
    }
  }

  private setLoginError(error: LoginError): void {
    this.loginState = error.type;
    this.loginError = error;

    if (error.retryAfter) {
      this.startRetryCountdown(error.retryAfter);
    }

    switch (error.type) {
      case 'network_error':
        this.toast.error('Error de conexión. Verifica tu conexión a internet.', 'Error de red', 5000);
        break;
      case 'rate_limited':
      case 'too_many_attempts':
        this.toast.warning(error.message, 'Demasiados intentos', 5000);
        break;
      case 'account_locked':
      case 'account_suspended':
        this.toast.error(error.message, 'Cuenta no disponible', 5000);
        break;
      case 'email_not_verified':
        this.toast.info(error.message, 'Verificación requerida', 5000);
        break;
      default:
        this.toast.error(error.message, 'Error de inicio de sesión', 5000);
    }
  }

  private startRetryCountdown(seconds: number): void {
    this.retryCountdown = seconds;
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
    }

    this.retryTimer = setInterval(() => {
      this.retryCountdown--;
      if (this.retryCountdown <= 0) {
        clearInterval(this.retryTimer);
        this.retryTimer = undefined;
        this.clearError();
      }
    }, 1000);
  }

  private clearError(): void {
    this.loginState = 'idle';
    this.loginError = null;
    this.retryCountdown = 0;
  }


  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
    }
  }

  retryLogin(): void {
    if (this.canRetry && this.retryCountdown === 0) {
      this.clearError();
      this.onSubmit();
    } else if (this.retryCountdown > 0) {
      this.toast.info(`Espera ${this.retryCountdown} segundos antes de reintentar`, 'Tiempo de espera');
    }
  }

  resetForm(): void {
    this.clearError();
    this.loginForm.reset();
    this.loginAttempts = 0;
    localStorage.removeItem('login_lockout_until');
  }

  getFieldClass(fieldName: string): string {
    const field = this.loginForm.get(fieldName);
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
    const field = this.loginForm.get(fieldName);
    field?.markAsTouched();
  }

  onFieldInput(fieldName: string): void {
    const field = this.loginForm.get(fieldName);
    if (field) {
      field.markAsDirty();
    }
  }

  getFieldError(fieldName: string): string {
    const field = this.loginForm.get(fieldName);
    if (field?.errors && field?.touched) {
      if (field.errors['required']) {
        if (fieldName === 'vlink') {
          return 'El vlink es requerido';
        }
        return `${fieldName === 'email' ? 'El email' : 'La contraseña'} es requerida`;
      }
      if (field.errors['email']) {
        return 'Debe ser un email válido';
      }
      if (field.errors['minlength']) {
        return 'La contraseña debe tener al menos 6 caracteres';
      }
    }
    return '';
  }

  hasFieldError(fieldName: string): boolean {
    const field = this.loginForm.get(fieldName);
    return !!(field?.errors && field?.touched);
  }

  onSubmit(): void {
    if (this.loginForm.valid && this.loginState !== 'loading') {
      this.clearError();

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

  resendVerificationEmail(): void {
    const email = this.loginForm.get('email')?.value;
    if (email && this.loginForm.get('email')?.valid) {
      // This would need to be implemented in AuthService
      this.toast.warning('Función de reenvío de verificación no implementada aún');
    } else {
      this.toast.warning('Ingresa un email válido primero');
    }
  }

  navigateToForgotPassword(): void {
    this.router.navigate(['/auth/forgot-password']);
  }

  // Computed properties for template
  get hasError(): boolean {
    return this.loginState !== 'idle' && this.loginState !== 'loading' && this.loginState !== 'success';
  }

  get canRetry(): boolean {
    return this.loginError?.canRetry || false;
  }

  get isLoading(): boolean {
    return this.loginState === 'loading';
  }

  get isFormValid(): boolean {
    return this.loginForm.valid && this.loginState !== 'loading' && !this.hasError;
  }

  get errorMessage(): string {
    return this.loginError?.message || '';
  }

  get errorDetails(): string {
    return this.loginError?.details || '';
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
