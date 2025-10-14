import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AuthService } from '../../../../core/services/auth.service';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { AppResolverService } from '../../../../core/services/app-resolver.service';
import { DomainDetectorService } from '../../../../core/services/domain-detector.service';
import { AppEnvironment } from '../../../../core/models/domain-config.interface';

export type LoginState = 'idle' | 'loading' | 'success' | 'error' | 'network_error' | 'rate_limited' | 'too_many_attempts' | 'account_locked' | 'account_suspended' | 'email_not_verified' | 'password_expired';

export interface LoginError {
  type: LoginState;
  message: string;
  canRetry: boolean;
  retryAfter?: number;
  details?: string;
}

@Component({
  selector: 'app-org-login',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule
  ],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-50 py-12 px-4 sm:px-6 lg:px-8">
      <div class="max-w-md w-full space-y-8">
        <!-- Organization Branding -->
        <div class="text-center">
          <div class="mx-auto h-16 w-16 bg-primary rounded-full flex items-center justify-center mb-4" 
               *ngIf="organizationLogo; else defaultLogo">
            <img [src]="organizationLogo" [alt]="organizationName" class="h-10 w-10">
          </div>
          <ng-template #defaultLogo>
            <div class="mx-auto h-16 w-16 bg-primary rounded-full flex items-center justify-center mb-4">
              <span class="text-white font-bold text-xl">O</span>
            </div>
          </ng-template>
          
          <h2 class="mt-6 text-3xl font-extrabold text-gray-900">
            Iniciar Sesión
          </h2>
          <p class="mt-2 text-sm text-gray-600" *ngIf="organizationName">
            en {{ organizationName }}
          </p>
          <p class="mt-1 text-sm text-gray-500" *ngIf="!organizationName">
            Plataforma organizacional
          </p>
        </div>

        <!-- Login Form -->
        <form [formGroup]="loginForm" (ngSubmit)="onSubmit()" class="mt-8 space-y-6 bg-white p-8 rounded-lg shadow-lg">
          <div class="space-y-4">
            <!-- Email Field -->
            <div>
              <label for="email" class="block text-sm font-medium text-gray-700">
                Email Corporativo
              </label>
              <input
                id="email"
                formControlName="email"
                type="email"
                autocomplete="email"
                [class]="getFieldClass('email')"
                placeholder="usuario@empresa.com"
                (blur)="onFieldBlur('email')"
                (input)="onFieldInput('email')">
              <div class="mt-1 text-sm text-red-600" *ngIf="hasFieldError('email')">
                {{ getFieldError('email') }}
              </div>
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
              <div class="mt-1 text-sm text-red-600" *ngIf="hasFieldError('password')">
                {{ getFieldError('password') }}
              </div>
            </div>
          </div>

          <!-- Error Display -->
          <div *ngIf="hasError" class="rounded-md bg-red-50 p-4">
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
                <div class="mt-2 text-sm text-red-700" *ngIf="errorDetails">
                  {{ errorDetails }}
                </div>
                <div class="mt-2" *ngIf="canRetry && retryCountdown > 0">
                  <p class="text-sm text-red-700">
                    Puedes reintentar en {{ retryCountdown }} segundos
                  </p>
                </div>
              </div>
            </div>
          </div>

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
              <span *ngIf="isLoading" class="flex items-center">
                <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Iniciando sesión...
              </span>
              <span *ngIf="!isLoading">
                Iniciar Sesión
              </span>
            </button>
          </div>

          <!-- Special Actions -->
          <div *ngIf="loginState === 'email_not_verified'" class="text-center">
            <button
              type="button"
              (click)="resendVerificationEmail()"
              class="text-sm font-medium text-primary hover:text-primary-dark">
              Reenviar email de verificación
            </button>
          </div>

          <div *ngIf="canRetry && retryCountdown === 0" class="text-center">
            <button
              type="button"
              (click)="retryLogin()"
              class="text-sm font-medium text-primary hover:text-primary-dark">
              Reintentar inicio de sesión
            </button>
          </div>
        </form>

        <!-- Additional Links -->
        <div class="text-center text-sm text-gray-600">
          <p>
            ¿Eres cliente? 
            <a [routerLink]="['/shop']" class="font-medium text-primary hover:text-primary-dark">
              Accede a nuestra tienda
            </a>
          </p>
        </div>

        <!-- Organization Info -->
        <div class="text-center text-xs text-gray-500 mt-4" *ngIf="organizationName">
          <p>Acceso administrativo de {{ organizationName }}</p>
          <p>Powered by Vendix Platform</p>
        </div>
      </div>
    </div>
  `,
  styleUrls: []
})
export class OrgLoginComponent implements OnInit, OnDestroy {
  loginForm: FormGroup;
  loginState: LoginState = 'idle';
  loginError: LoginError | null = null;
  loginAttempts = 0;
  maxAttempts = 5;
  lockoutTime = 180;
  retryCountdown = 0;
  retryTimer: any;
  
  // Organization context
  organizationName: string = '';
  organizationLogo: string = '';
  
  private destroy$ = new Subject<void>();
  private toast = inject(ToastService);

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private tenantFacade: TenantFacade,
    private authFacade: AuthFacade,
    private router: Router,
    private appResolver: AppResolverService,
    private domainDetector: DomainDetectorService
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  ngOnInit(): void {
    // Load organization context
    this.loadOrganizationContext();
    
    // Subscribe to reactive auth state
    this.authFacade.loading$.pipe(takeUntil(this.destroy$)).subscribe(loading => {
      this.loginState = loading ? 'loading' : 'idle';
    });

    this.authFacade.error$.pipe(takeUntil(this.destroy$)).subscribe(error => {
      console.log('Org Login component - Error received:', error);
      if (error) {
        this.handleLoginError(error);
      }
    });

    // Subscribe to authentication success
    this.authFacade.isAuthenticated$.pipe(takeUntil(this.destroy$)).subscribe(isAuth => {
      if (isAuth) {
        console.log('Organization user authenticated, redirecting...');
        this.toast.success(`¡Bienvenido a ${this.organizationName || 'tu organización'}!`);
      }
    });
  }

  private loadOrganizationContext(): void {
    this.tenantFacade.tenantConfig$.pipe(takeUntil(this.destroy$)).subscribe(tenantConfig => {
      if (tenantConfig?.organization) {
        this.organizationName = tenantConfig.organization.name;
        this.organizationLogo = tenantConfig.branding.logo.url || '';
      }
      
      // Apply organization branding if available
      if (tenantConfig?.branding?.colors) {
        this.updateBrandingCSSVariables(tenantConfig.branding.colors);
      }
    });
  }

  private handleLoginError(error: any): void {
    console.log('Org handleLoginError called with:', error);
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
        message: 'Cuenta suspendida. Contacta al administrador de la organización.',
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

  private updateBrandingCSSVariables(colors: any): void {
    if (!colors) return;

    const root = document.documentElement;

    if (colors.primary) {
      root.style.setProperty('--primary', colors.primary);
      root.style.setProperty('--color-primary', colors.primary);
    }

    if (colors.secondary) {
      root.style.setProperty('--color-secondary', colors.secondary);
    }

    if (colors.accent) {
      root.style.setProperty('--accent', colors.accent);
    }

    if (colors.background) {
      root.style.setProperty('--bg', colors.background);
      root.style.setProperty('--color-background', colors.background);
    }

    if (colors.surface) {
      root.style.setProperty('--surface', colors.surface);
    }

    if (colors.text?.primary || colors.text) {
      const textColor = colors.text?.primary || colors.text;
      root.style.setProperty('--text', textColor);
      root.style.setProperty('--color-text-primary', textColor);
    }
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

      const { email, password } = this.loginForm.value;

      // Get organization slug from current domain
      const currentDomain = this.tenantFacade.getCurrentDomainConfig();
      const organizationSlug = currentDomain?.organizationSlug;

      if (organizationSlug) {
        this.authFacade.login(email, password, undefined, organizationSlug);
      } else {
        this.authFacade.login(email, password);
      }
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
      this.authService.resendVerification(email).subscribe({
        next: () => {
          this.toast.success('Email de verificación reenviado');
        },
        error: (error) => {
          this.toast.error('Error al reenviar email de verificación');
          console.error('Resend verification error:', error);
        }
      });
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
}