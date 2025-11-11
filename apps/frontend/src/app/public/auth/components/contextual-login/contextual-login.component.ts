import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { ConfigFacade } from '../../../../core/store/config';
import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
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
  apiError?: string;
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
    <div class="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8" [class]="'bg-[var(--color-background)]'">
      <div class="max-w-sm w-full space-y-8">
        <!-- Contextual Branding -->
        <div class="text-center my-3">
          @if (logoUrl) {
            <div class="mx-auto h-16 w-16 flex items-center justify-center mb-4">
              <img [src]="logoUrl" [alt]="displayName" class="h-14 w-14 rounded-md">
            </div>
          } @else {
            <div class="mx-auto h-16 w-16 bg-[var(--color-primary)] rounded-full flex items-center justify-center mb-4">
              <span class="text-white font-bold text-xl">{{ contextInitial }}</span>
            </div>
          }

          <h2 class="mt-6 text-2xl font-extrabold text-[var(--color-text-primary)]">
            {{ loginTitle }}
          </h2>
          @if (displayName) {
            <p class="mt-2 text-sm text-[var(--color-text-secondary)]">
              {{ contextDescription }}
            </p>
          }
          @if (!displayName) {
            <p class="mt-1 text-sm text-[var(--color-text-muted)]">
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
                [placeholder]="emailPlaceholder">
              </app-input>

              <!-- Password Field -->
              <app-input
                label="Contraseña"
                formControlName="password"
                [control]="loginForm.get('password')"
                type="password"
                size="md"
                placeholder="••••••••">
              </app-input>
            </div>

            <!-- Error Display -->
            @if (hasError) {
              <div class="rounded-md bg-[rgba(239, 68, 68, 0.1)] p-4 border border-[rgba(239, 68, 68, 0.2)]">
                <div class="flex">
                  <div class="flex-shrink-0">
                    <svg class="h-5 w-5 text-[var(--color-destructive)]" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
                    </svg>
                  </div>
                  <div class="ml-3">
                    <h3 class="text-sm font-medium text-[var(--color-destructive)]">
                      {{ errorMessage }}
                    </h3>
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
                  class="font-medium text-[var(--color-primary)] hover:text-[var(--color-secondary)] cursor-pointer">
                  ¿Olvidaste tu contraseña?
                </a>
              </div>
            </div>

          </form>
        </app-card>

        <!-- Additional Links -->
        <div class="text-center text-sm text-[var(--color-text-secondary)]">
          @if (contextType === 'vendix') {
            <p>
              ¿Necesitas una cuenta corporativa?
              <a routerLink="/auth/register" class="font-medium text-[var(--color-primary)] hover:text-[var(--color-secondary)]">
                Solicitar acceso
              </a>
            </p>
          }
        </div>

        <!-- Context Info -->
        @if (displayName) {
          <div class="text-center text-xs text-[var(--color-text-muted)] mt-4">
            <p>{{ contextFooter }}</p>
            <p>Powered by Vendix</p>
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
  apiErrorMessage: string | null = null;
  contextType: 'vendix' | 'organization' | 'store' = 'vendix';
  displayName: string = '';
  logoUrl: string = '';

  private destroy$ = new Subject<void>();
  private toast = inject(ToastService);
  private appConfigFacade = inject(ConfigFacade);

  constructor(
    private fb: FormBuilder,
    private authFacade: AuthFacade,
    private router: Router
  ) {
    this.loginForm = this.fb.group({
      vlink: [''],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  ngOnInit(): void {
    this.loadAuthContext();
    
    this.authFacade.loading$.pipe(takeUntil(this.destroy$)).subscribe(loading => {
      if (loading) this.loginState = 'loading';
    });

    this.authFacade.error$.pipe(takeUntil(this.destroy$)).subscribe(error => {
      if (error) {
        const normalizedError = typeof error === 'string' ? error : extractApiErrorMessage(error);
        this.handleLoginError(normalizedError);
      } else {
        this.clearError();
      }
    });

    this.authFacade.isAuthenticated$.pipe(takeUntil(this.destroy$)).subscribe(isAuth => {
      if (isAuth) {
        const welcomeMessage = this.getWelcomeMessage();
        this.toast.success(welcomeMessage);
        this.loginState = 'success';
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadAuthContext(): void {
    const appConfig = this.appConfigFacade.getCurrentConfig();
    if (!appConfig) {
      console.warn('[CONTEXTUAL-LOGIN] App config not available, using default context');
      return;
    }

    const domainConfig = appConfig.domainConfig;
    if (domainConfig.domainType === 'vendix_core') {
      this.contextType = 'vendix';
      this.displayName = 'Vendix Platform';
      this.loginForm.get('vlink')?.setValidators([Validators.required]);
    } else if (domainConfig.domainType === 'organization') {
      this.contextType = 'organization';
      this.displayName = domainConfig.organization_slug || '';
      this.loginForm.get('vlink')?.clearValidators();
    } else if (domainConfig.domainType === 'store' || domainConfig.domainType === 'ecommerce') {
      this.contextType = 'store';
      this.displayName = domainConfig.store_slug || '';
      this.loginForm.get('vlink')?.clearValidators();
    }
    this.loginForm.get('vlink')?.updateValueAndValidity();
    this.logoUrl = appConfig.branding?.logo?.url || '';
  }

  private handleLoginError(error: string): void {
    this.setLoginError({ type: 'error', message: error, apiError: error });
  }

  private setLoginError(error: LoginError): void {
    this.loginState = error.type;
    this.loginError = error;
    this.apiErrorMessage = error.message;
    this.toast.error(error.apiError || error.message, 'Error de inicio de sesión', 5000);
  }

  private clearError(): void {
    this.loginState = 'idle';
    this.loginError = null;
    this.apiErrorMessage = null;
  }

  onSubmit(): void {
    if (this.loginForm.valid && this.loginState !== 'loading') {
      this.apiErrorMessage = null;
      this.loginError = null;
      const { vlink, email, password } = this.loginForm.value;
      let store_slug: string | undefined;
      let organization_slug: string | undefined;

      if (this.contextType === 'vendix') {
        organization_slug = vlink;
      } else if (this.contextType === 'organization') {
        organization_slug = this.displayName;
      } else if (this.contextType === 'store') {
        store_slug = this.displayName;
      }

      this.authFacade.login(email, password, store_slug, organization_slug);
    } else {
      this.loginForm.markAllAsTouched();
      if (this.loginForm.invalid) {
        this.toast.warning('Corrige los errores antes de continuar');
      }
    }
  }

  navigateToForgotPassword(): void {
    this.router.navigate(['/auth/forgot-owner-password']);
  }

  get hasError(): boolean { return this.loginState !== 'idle' && this.loginState !== 'loading' && this.loginState !== 'success'; }
  get isLoading(): boolean { return this.loginState === 'loading'; }
  get isFormValid(): boolean { return this.loginForm.valid && this.loginState !== 'loading'; }
  get errorMessage(): string { return this.loginError?.message || ''; }
  get errorDetails(): string { return this.loginError?.details || ''; }
  get apiError(): string | null { return this.apiErrorMessage || this.loginError?.message || null; }
  get backgroundClass(): string { return 'bg-[var(--color-background)]'; } // Using token
  get contextInitial(): string { return this.displayName.charAt(0).toUpperCase() || 'V'; }
  get loginTitle(): string { return 'Iniciar Sesión'; }
  get contextDescription(): string { return `en ${this.displayName}`; }
  get defaultDescription(): string { return 'Plataforma de gestión'; }
  get emailLabel(): string { return 'Email'; }
  get emailPlaceholder(): string { return 'usuario@email.com'; }
  get contextFooter(): string { return `Acceso a ${this.displayName}`}

  private getWelcomeMessage(): string {
    switch (this.contextType) {
      case 'vendix': return '¡Bienvenido a Vendix Platform!';
      case 'organization': return `¡Bienvenido a ${this.displayName || 'tu organización'}!`;
      case 'store': return `¡Bienvenido a ${this.displayName || 'nuestra tienda'}!`;
      default: return '¡Bienvenido!';
    }
  }
}