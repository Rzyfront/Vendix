import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AuthService } from '../../../../core/services/auth.service';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { takeUntil, combineLatest } from 'rxjs/operators';
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
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule
  ],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit, OnDestroy {
  loginForm: FormGroup;
  loginState: LoginState = 'idle';
  loginError: LoginError | null = null;
  loginAttempts = 0;
  maxAttempts = 5;
  lockoutTime = 180; // 3 minutes in seconds
  retryCountdown = 0;
  retryTimer: any;
  private destroy$ = new Subject<void>();

  // Branding colors from domain config - reactive (no defaults)
  brandingColors: any = {};

  private toast = inject(ToastService);

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private tenantFacade: TenantFacade,
    private authFacade: AuthFacade,
    private router: Router
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  ngOnInit(): void {
    // Subscribe to reactive auth state
    // Subscribe to reactive auth state
    this.authFacade.loading$.pipe(takeUntil(this.destroy$)).subscribe(loading => {
      this.loginState = loading ? 'loading' : 'idle';
    });

    this.authFacade.error$.pipe(takeUntil(this.destroy$)).subscribe(error => {
      console.log('Login component - Error received:', error);
      if (error) {
        this.handleLoginError(error);
      }
    });

    // Subscribe to authentication success to show success message
    this.authFacade.isAuthenticated$.pipe(takeUntil(this.destroy$)).subscribe(isAuth => {
      if (isAuth) {
        console.log('User authenticated, redirecting to admin dashboard...');
        this.toast.success('¡Bienvenido a Vendix!');
        // Navigation is now handled exclusively by auth.effects.ts
      }
    });

    // Subscribe to tenant branding colors
    this.tenantFacade.tenantConfig$.pipe(takeUntil(this.destroy$)).subscribe(tenantConfig => {
      if (tenantConfig?.branding?.colors) {
        const colors = tenantConfig.branding.colors;
        this.brandingColors = {
          primary: colors.primary,
          secondary: colors.secondary,
          accent: colors.accent,
          background: colors.background,
          text: colors.text?.primary || colors.text,
          border: colors.surface
        };

        // Update CSS custom properties for dynamic branding
        this.updateBrandingCSSVariables(colors);
      }
    });
  }

  private handleLoginError(error: any): void {
    console.log('handleLoginError called with:', error);
    this.loginAttempts++;
    const errorMessage = error?.message || error?.error?.message || error?.error || 'Error de autenticación';
    console.log('Extracted error message:', errorMessage);

    // Since we now return standardized responses, check message content for error types
    if (errorMessage.toLowerCase().includes('credenciales inválidas') || errorMessage.toLowerCase().includes('invalid credentials')) {
      // Invalid credentials
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
      // Network error
      this.setLoginError({
        type: 'network_error',
        message: 'Error de conexión. Verifica tu conexión a internet.',
        canRetry: true
      });
    } else {
      // Generic error
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

    // Show toast notification with more descriptive messages
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
      // Show a notification that they need to wait
      this.toast.info(`Espera ${this.retryCountdown} segundos antes de reintentar`, 'Tiempo de espera');
    }
  }

  resetForm(): void {
    this.clearError();
    this.loginForm.reset();
    this.loginAttempts = 0;
    localStorage.removeItem('login_lockout_until');
  }


  getBackgroundGradient(): string {
    const background = this.brandingColors?.background || '#F4F4F4';
    const secondary = this.brandingColors?.secondary || '#2F6F4E';
    return `linear-gradient(to bottom right, ${background}80, ${secondary}20)`;
  }

  // Helper methods for template colors with defaults
  get primaryColor(): string {
    return this.brandingColors?.primary || '#7ED7A5';
  }

  get secondaryColor(): string {
    return this.brandingColors?.secondary || '#2F6F4E';
  }

  get accentColor(): string {
    return this.brandingColors?.accent || '#FFFFFF';
  }

  get textColor(): string {
    return this.brandingColors?.text || '#222222';
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

  onSubmit(): void {
    if (this.loginForm.valid && this.loginState !== 'loading') {
      this.clearError();

      const { email, password } = this.loginForm.value;

      // Get tenant information from reactive state
      let storeSlug: string | undefined;
      let organizationSlug: string | undefined;

      const currentStore = this.tenantFacade.getCurrentStore();
      const currentOrganization = this.tenantFacade.getCurrentOrganization();

      if (currentStore?.slug) {
        storeSlug = currentStore.slug;
      } else if (currentOrganization?.slug) {
        organizationSlug = currentOrganization.slug;
      }

      this.authFacade.login(email, password, storeSlug, organizationSlug);
    } else {
      // Mark all fields as touched to show validation errors
      Object.keys(this.loginForm.controls).forEach(key => {
        this.loginForm.get(key)?.markAsTouched();
      });

      if (this.hasError) {
        this.toast.warning('Corrige los errores antes de continuar');
      }
    }
  }

  // Field interaction methods
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
    // Optional: Add real-time validation logic here if needed
    // For now, just ensure the field is marked as dirty
    const field = this.loginForm.get(fieldName);
    if (field) {
      field.markAsDirty();
    }
  }

  getFieldStatusIcon(fieldName: string): string {
    const field = this.loginForm.get(fieldName);
    if (!field?.touched) return '';

    if (field.valid && field.value) {
      return '✅'; // Valid
    } else if (field.invalid) {
      return '❌'; // Invalid
    }
    return '';
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

  private updateBrandingCSSVariables(colors: any): void {
    if (!colors) return;

    const root = document.documentElement;

    // Update primary and secondary colors for branding
    if (colors.primary) {
      root.style.setProperty('--primary', colors.primary);
      root.style.setProperty('--color-primary', colors.primary);
    }

    if (colors.secondary) {
      root.style.setProperty('--color-secondary', colors.secondary);
    }

    // Update other branding colors if available
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
}
