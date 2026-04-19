import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  effect,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import { RouterModule, Router } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule} from '@angular/forms';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { ConfigFacade } from '../../../../core/store/config';


import { ToastService } from '../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../core/utils/api-error-handler';
import {
  InputComponent,
  ButtonComponent,
  CardComponent,
  IconComponent} from '../../../../shared/components';

export type LoginState =
  | 'idle'
  | 'loading'
  | 'success'
  | 'error'
  | 'network_error'
  | 'rate_limited'
  | 'too_many_attempts'
  | 'account_locked'
  | 'account_suspended'
  | 'email_not_verified'
  | 'password_expired'
  | 'disambiguation_required';

export interface LoginError {
  type: LoginState;
  message: string;
  details?: string;
  apiError?: string;
}

export interface OrganizationCandidate {
  name: string;
  slug: string;
  logo_url?: string | null;
}

@Component({
  selector: 'app-contextual-login',
  standalone: true,
  imports: [
    RouterModule,
    ReactiveFormsModule,
    InputComponent,
    ButtonComponent,
    CardComponent,
    IconComponent
],
  template: `
    <div
      class="min-h-screen flex flex-col justify-center px-4 py-6 sm:px-6 sm:py-12 lg:px-8 bg-[var(--color-background)]"
    >
      <div class="w-full max-w-sm mx-auto space-y-6 sm:space-y-8">
        <!-- Contextual Branding -->
        <div class="text-center">
          <div
            class="mx-auto flex items-center justify-center space-x-2 sm:space-x-3 mb-3 sm:mb-4"
          >
            @if (logoUrl()) {
              <div
                class="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center overflow-hidden"
              >
                <img
                  [src]="logoUrl()"
                  alt="Logo"
                  class="w-full h-full object-contain"
                />
              </div>
            } @else {
              <div
                class="w-8 h-8 sm:w-10 sm:h-10 bg-[var(--color-primary)] rounded-xl flex items-center justify-center"
              >
                <app-icon
                  name="cart"
                  [size]="20"
                  class="sm:hidden"
                  color="white"
                ></app-icon>
                <app-icon
                  name="cart"
                  [size]="24"
                  class="hidden sm:block"
                  color="white"
                ></app-icon>
              </div>
            }
            <h1
              class="text-lg sm:text-xl font-semibold text-[var(--color-text-primary)]"
            >
              {{ displayName() || 'Vendix' }}
            </h1>
          </div>

          <h2
            class="mt-4 sm:mt-6 text-xl sm:text-2xl font-extrabold text-[var(--color-text-primary)]"
          >
            {{ loginTitle }}
          </h2>
          @if (displayName()) {
            <p
              class="mt-1 sm:mt-2 mb-2 text-sm text-[var(--color-text-secondary)]"
            >
              {{ contextDescription() }}
            </p>
          }
          @if (!displayName()) {
            <p class="mt-1 mb-2 text-sm text-[var(--color-text-muted)]">
              {{ defaultDescription }}
            </p>
          }
        </div>

        <!-- Login Form -->
        @if (contextType() !== null) {
        <app-card
          shadow="md"
          class="!mt-6 sm:!mt-8"
          [animateOnLoad]="true"
          [responsivePadding]="true"
          overflow="visible"
        >
          <form
            [formGroup]="loginForm"
            (ngSubmit)="onSubmit()"
            class="space-y-4 sm:space-y-6"
          >
            <div class="space-y-4">
              <!-- Vlink Field (only for Vendix context) -->
              @if (contextType() === 'vendix') {
                <div class="vlink-field">
                  <app-input
                    label="V-link"
                    formControlName="vlink"
                    [control]="loginForm.get('vlink')"
                    type="text"
                    size="md"
                    placeholder="Nombre o ID de tu organización"
                    tooltipText="Puedes usar el nombre de tu organización o su identificador único (V-link)"
                    tooltipPosition="right"
                    [tooltipVisible]="showVlinkTooltip() ? true : undefined"
                  >
                  </app-input>
                </div>
              }

              <!-- Email Field -->
              <app-input
                [label]="emailLabel"
                formControlName="email"
                [control]="loginForm.get('email')"
                type="email"
                size="md"
                [placeholder]="emailPlaceholder"
              >
              </app-input>

              <!-- Password Field -->
              <app-input
                label="Contraseña"
                formControlName="password"
                [control]="loginForm.get('password')"
                type="password"
                size="md"
                placeholder="••••••••"
              >
              </app-input>
            </div>

            <!-- Error Display -->
            @if (hasError() && loginState() !== 'disambiguation_required') {
              <div
                class="rounded-md bg-[rgba(239, 68, 68, 0.1)] p-4 border border-[rgba(239, 68, 68, 0.2)]"
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
                      {{ errorMessage() }}
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
              [disabled]="!isFormValid()"
              [loading]="isLoading()"
              [fullWidth]="true"
              [showTextWhileLoading]="true"
              class="mt-4 w-full"
            >
              @if (isLoading()) {
                Iniciando sesión...
              } @else {
                Iniciar Sesión
              }
            </app-button>

            <!-- Actions -->
            <div class="flex justify-center mt-4">
              <a
                (click)="navigateToForgotPassword()"
                class="inline-block py-2 px-1 text-sm font-medium text-[var(--color-primary)] hover:text-[var(--color-secondary)] cursor-pointer active:opacity-70 transition-opacity"
              >
                ¿Olvidaste tu contraseña?
              </a>
            </div>
          </form>
        </app-card>
        }

        <!-- Back to Landing -->
        <div class="text-center mt-3 sm:mt-4">
          <a
            routerLink="/"
            class="inline-block py-1.5 px-1 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] active:opacity-70 transition-opacity"
          >
            ← Volver al inicio
          </a>
        </div>

        <!-- Additional Links -->
        @if (contextType() === 'vendix') {
          <div
            class="text-center text-sm text-[var(--color-text-secondary)] mt-1"
          >
            <p>
              ¿Necesitas una cuenta corporativa?
              <a
                routerLink="/auth/register"
                class="font-medium text-[var(--color-primary)] hover:text-[var(--color-secondary)] active:opacity-70 transition-opacity"
              >
                Solicitar acceso
              </a>
            </p>
          </div>
        }

        <!-- Context Info -->
        @if (displayName()) {
          <div
            class="text-center text-xs text-[var(--color-text-muted)] mt-2 sm:mt-3"
          >
            <p>{{ contextFooter() }}</p>
            <p class="mt-0.5">Powered by Vendix</p>
          </div>
        }
      </div>
    </div>

    <!-- Disambiguation Modal -->
    @if (showDisambiguationModal() && disambiguationCandidates().length > 0) {
      <div
        class="fixed inset-0 z-50 overflow-y-auto"
        aria-labelledby="modal-title"
        role="dialog"
        aria-modal="true"
      >
        <!-- Backdrop -->
        <div
          class="fixed inset-0 bg-black/50 transition-opacity"
          (click)="closeDisambiguationModal()"
        ></div>

        <!-- Modal -->
        <div class="flex min-h-full items-center justify-center p-4">
          <div
            class="relative transform overflow-hidden rounded-2xl bg-[var(--color-surface)] shadow-xl transition-all w-full max-w-md"
          >
            <!-- Header -->
            <div class="p-6 pb-4 border-b border-[var(--color-border)]">
              <div class="flex items-center gap-3">
                <div
                  class="w-10 h-10 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center"
                >
                  <app-icon
                    name="building"
                    [size]="20"
                    color="var(--color-primary)"
                  ></app-icon>
                </div>
                <div>
                  <h3
                    class="text-lg font-semibold text-[var(--color-text-primary)]"
                    id="modal-title"
                  >
                    Selecciona tu organización
                  </h3>
                  <p class="text-sm text-[var(--color-text-secondary)]">
                    Encontramos varias organizaciones
                  </p>
                </div>
              </div>
            </div>

            <!-- Body -->
            <div class="p-4 max-h-80 overflow-y-auto">
              <ul class="space-y-2">
                @for (org of disambiguationCandidates(); track org.slug) {
                  <li>
                    <button
                      type="button"
                      (click)="selectOrganization(org.slug)"
                      class="w-full flex items-center gap-3 p-3 rounded-xl border border-[var(--color-border)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 transition-all group cursor-pointer"
                    >
                      <!-- Org Logo/Avatar -->
                      <div
                        class="w-10 h-10 rounded-lg bg-[var(--color-muted)] flex items-center justify-center overflow-hidden shrink-0"
                      >
                        @if (org.logo_url) {
                          <img
                            [src]="org.logo_url"
                            [alt]="org.name"
                            class="w-full h-full object-cover"
                          />
                        } @else {
                          <span
                            class="text-lg font-semibold text-[var(--color-text-muted)]"
                          >
                            {{ org.name.charAt(0).toUpperCase() }}
                          </span>
                        }
                      </div>

                      <!-- Org Info -->
                      <div class="flex-1 text-left min-w-0">
                        <p
                          class="font-medium text-[var(--color-text-primary)] truncate group-hover:text-[var(--color-primary)]"
                        >
                          {{ org.name }}
                        </p>
                        <p
                          class="text-xs text-[var(--color-text-muted)] truncate"
                        >
                          ID: {{ org.slug }}
                        </p>
                      </div>

                      <!-- Arrow -->
                      <app-icon
                        name="chevron-right"
                        [size]="18"
                        class="text-[var(--color-text-muted)] group-hover:text-[var(--color-primary)] shrink-0"
                      ></app-icon>
                    </button>
                  </li>
                }
              </ul>
            </div>

            <!-- Footer -->
            <div class="p-4 pt-2 border-t border-[var(--color-border)]">
              <button
                type="button"
                (click)="closeDisambiguationModal()"
                class="w-full py-2.5 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
    `,
  ]})
export class ContextualLoginComponent implements OnInit {
  loginForm: FormGroup;
  private readonly formStatus;

  readonly loginState = signal<LoginState>('idle');
  readonly loginError = signal<LoginError | null>(null);
  readonly apiErrorMessage = signal<string | null>(null);
  readonly contextType = signal<'vendix' | 'organization' | 'store' | null>(
    null,
  );
  readonly displayName = signal<string>('');
  readonly logoUrl = signal<string>('');
  readonly showVlinkTooltip = signal(true);

  readonly showDisambiguationModal = signal(false);
  readonly disambiguationCandidates = signal<OrganizationCandidate[]>([]);

  private toast = inject(ToastService);
  private appConfigFacade = inject(ConfigFacade);

  constructor(
    private fb: FormBuilder,
    private authFacade: AuthFacade,
    private router: Router,
  ) {
    this.loginForm = this.fb.group({
      vlink: [''],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
    });

    this.formStatus = toSignal(this.loginForm.statusChanges, {
      initialValue: this.loginForm.status,
    });

    effect(() => {
      if (this.authFacade.authLoading()) {
        this.loginState.set('loading');
      }
    });

    effect(() => {
      const error = this.authFacade.authError();
      if (error) {
        if (this.isDisambiguationError(error)) {
          this.handleDisambiguationRequired(error);
        } else {
          const normalizedError =
            typeof error === 'string' ? error : extractApiErrorMessage(error);
          this.handleLoginError(normalizedError);
        }
      } else {
        this.clearError();
      }
    });

    effect(() => {
      if (this.authFacade.isAuthenticated()) {
        const welcomeMessage = this.getWelcomeMessage();
        this.toast.success(welcomeMessage);
        this.loginState.set('success');
      }
    });

    effect(() => {
      const appConfig = this.appConfigFacade.appConfig();
      if (!appConfig) return;
      this.applyAuthContext(appConfig);
    });
  }

  ngOnInit(): void {
    setTimeout(() => {
      this.showVlinkTooltip.set(false);
    }, 3000);
  }

  private applyAuthContext(appConfig: any): void {
    const allowedEnvs = ['VENDIX_LANDING', 'ORG_LANDING', 'STORE_LANDING'];
    const domainConfig = appConfig.domainConfig;
    const env = domainConfig.environment;

    if (env && !allowedEnvs.includes(env)) {
      this.router.navigate(['/']);
      return;
    }

    if (env === 'VENDIX_LANDING' || env === 'VENDIX_ADMIN') {
      this.contextType.set('vendix');
      this.displayName.set('Vendix Platform');
      this.loginForm.get('vlink')?.setValidators([Validators.required]);
    } else if (env === 'ORG_ADMIN' || env === 'ORG_LANDING') {
      this.contextType.set('organization');
      this.displayName.set(domainConfig.organization_slug || '');
      this.loginForm.get('vlink')?.clearValidators();
    } else if (
      ['STORE_ADMIN', 'STORE_LANDING', 'STORE_ECOMMERCE'].includes(env)
    ) {
      this.contextType.set('store');
      this.displayName.set(domainConfig.store_slug || '');
      this.loginForm.get('vlink')?.clearValidators();
    }
    this.loginForm.get('vlink')?.updateValueAndValidity();

    let logo = appConfig.branding?.logo?.url || '';
    if (!logo && domainConfig.isMainVendixDomain) {
      logo = 'vlogo.png';
    }
    this.logoUrl.set(logo);
  }

  /**
   * Check if the error is a disambiguation required response (HTTP 300)
   */
  private isDisambiguationError(error: any): boolean {
    if (!error) return false;

    // Check for the disambiguation_required flag in the error payload
    const errorData = error?.error || error?.data || error;
    return (
      errorData?.disambiguation_required === true ||
      errorData?.statusCode === 300 ||
      error?.status === 300
    );
  }

  private handleDisambiguationRequired(error: any): void {
    const errorData = error?.error || error?.data || error;
    const candidates = errorData?.candidates || [];

    if (candidates.length > 0) {
      this.disambiguationCandidates.set(candidates);
      this.showDisambiguationModal.set(true);
      this.loginState.set('disambiguation_required');
      this.authFacade.setLoading(false);
    } else {
      this.handleLoginError('No se encontraron organizaciones con ese nombre');
    }
  }

  private handleLoginError(error: string): void {
    this.setLoginError({ type: 'error', message: error, apiError: error });
  }

  private setLoginError(error: LoginError): void {
    this.loginState.set(error.type);
    this.loginError.set(error);
    this.apiErrorMessage.set(error.message);
    this.toast.error(
      error.apiError || error.message,
      'Error de inicio de sesión',
      5000,
    );
  }

  private clearError(): void {
    this.loginState.set('idle');
    this.loginError.set(null);
    this.apiErrorMessage.set(null);
  }

  onSubmit(): void {
    if (this.loginForm.valid && this.loginState() !== 'loading') {
      this.apiErrorMessage.set(null);
      this.loginError.set(null);
      const { vlink, email, password } = this.loginForm.value;
      let store_slug: string | undefined;
      let organization_slug: string | undefined;

      const ctx = this.contextType();
      if (ctx === 'vendix') {
        organization_slug = vlink;
      } else if (ctx === 'organization') {
        organization_slug = this.displayName();
      } else if (ctx === 'store') {
        store_slug = this.displayName();
      }

      this.authFacade.login(email, password, store_slug, organization_slug);
    } else {
      this.loginForm.markAllAsTouched();
      if (this.loginForm.invalid) {
        this.toast.warning('Corrige los errores antes de continuar');
      }
    }
  }

  selectOrganization(slug: string): void {
    this.showDisambiguationModal.set(false);
    this.disambiguationCandidates.set([]);
    this.loginState.set('idle');

    const { email, password } = this.loginForm.value;
    this.authFacade.login(email, password, undefined, slug);
  }

  closeDisambiguationModal(): void {
    this.showDisambiguationModal.set(false);
    this.disambiguationCandidates.set([]);
    this.loginState.set('idle');
    this.authFacade.setAuthError(null);
  }

  navigateToForgotPassword(): void {
    this.router.navigate(['/auth/forgot-owner-password']);
  }

  readonly hasError = computed(() => {
    const s = this.loginState();
    return (
      s !== 'idle' &&
      s !== 'loading' &&
      s !== 'success' &&
      s !== 'disambiguation_required'
    );
  });
  readonly isLoading = computed(() => this.loginState() === 'loading');
  readonly isFormValid = computed(
    () => this.formStatus() === 'VALID' && this.loginState() !== 'loading',
  );
  readonly errorMessage = computed(() => this.loginError()?.message || '');
  readonly contextDescription = computed(() => `en ${this.displayName()}`);
  readonly contextFooter = computed(() => `Acceso a ${this.displayName()}`);

  readonly loginTitle = 'Iniciar Sesión';
  readonly defaultDescription = 'Plataforma de gestión';
  readonly emailLabel = 'Email';
  readonly emailPlaceholder = 'usuario@email.com';

  private getWelcomeMessage(): string {
    const name = this.displayName();
    switch (this.contextType()) {
      case 'vendix':
        return '¡Bienvenido a Vendix Platform!';
      case 'organization':
        return `¡Bienvenido a ${name || 'tu organización'}!`;
      case 'store':
        return `¡Bienvenido a ${name || 'nuestra tienda'}!`;
      default:
        return '¡Bienvenido!';
    }
  }
}
