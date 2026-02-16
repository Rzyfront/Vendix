import { Component, OnInit, inject, OnDestroy } from '@angular/core';
import { ConfigFacade } from '../../../../core/store/config';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../core/utils/api-error-handler';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { SpinnerComponent } from '../../../../shared/components/spinner/spinner.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../shared/components';

@Component({
  selector: 'app-email-verification',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    CardComponent,
    ButtonComponent,
    SpinnerComponent,
    IconComponent,
  ],
  template: `
    <div
      class="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-[var(--color-background)] to-[rgba(126, 215, 165, 0.1)]"
    >
      <div class="max-w-sm w-full space-y-8">
        <!-- Header section with logo and title -->
        <div class="text-center my-3">
          <div class="mx-auto flex items-center justify-center space-x-3 mb-4">
            @if (logoUrl) {
              <div class="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden">
                <img [src]="logoUrl" alt="Vendix" class="w-full h-full object-contain" />
              </div>
            } @else {
              <div
                class="w-10 h-10 bg-[var(--color-primary)] rounded-xl flex items-center justify-center"
              >
                <app-icon name="cart" [size]="24" color="white"></app-icon>
              </div>
            }
            <h1 class="text-xl font-semibold text-[var(--color-text-primary)]">
              Vendix
            </h1>
          </div>
          <h2
            class="mt-6 text-2xl font-extrabold text-[var(--color-text-primary)]"
          >
            Verificación de Email
          </h2>
          <p class="mt-2 text-sm text-[var(--color-text-secondary)]">
            {{ verificationMessage }}
          </p>
        </div>

        <!-- Card with verification status -->
        <app-card shadow="md" [animateOnLoad]="true" class="mt-8">
          <div class="space-y-8">
            <!-- Error message display -->
            <div class="flex flex-col items-center justify-center py-8">
              <app-spinner
                *ngIf="isLoading"
                size="lg"
                color="text-primary"
                text="Verificando tu email..."
                class="my-4"
              ></app-spinner>

              @if (!isLoading && verificationStatus === 'success') {
                <div class="text-center">
                  <div
                    class="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-[rgba(126, 215, 165, 0.1)]"
                  >
                    <svg
                      class="h-6 w-6 text-[var(--color-primary)]"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  <h3
                    class="mt-4 text-lg font-medium text-[var(--color-text-primary)]"
                  >
                    ¡Email verificado!
                  </h3>
                  <p class="mt-2 text-sm text-[var(--color-text-secondary)]">
                    Tu cuenta ha sido verificada correctamente.
                  </p>
                  <div class="mt-6">
                    <a
                      routerLink="/auth/login"
                      class="font-medium text-[var(--color-primary)] hover:text-[var(--color-secondary)]"
                    >
                      Iniciar sesión
                    </a>
                  </div>
                </div>
              }

              <div
                *ngIf="!isLoading && verificationStatus === 'error'"
                class="text-center"
              >
                <div
                  class="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-[rgba(239, 68, 68, 0.1)]"
                >
                  <svg
                    class="h-6 w-6 text-[var(--color-destructive)]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </div>
                <h3
                  class="mt-4 text-lg font-medium text-[var(--color-text-primary)]"
                >
                  Verificación fallida
                </h3>
                <p class="mt-2 text-sm text-[var(--color-text-secondary)]">
                  No se pudo verificar tu email. El token puede haber expirado o
                  ser inválido.
                </p>

                <div class="mt-6">
                  <app-button
                    (clicked)="resendVerificationEmail()"
                    [loading]="resendLoading"
                    variant="primary"
                  >
                    Reenviar email de verificación
                    <ng-container slot="icon">
                      <app-spinner
                        *ngIf="resendLoading"
                        size="sm"
                        color="text-white"
                      ></app-spinner>
                    </ng-container>
                  </app-button>
                </div>
              </div>
            </div>
          </div>
        </app-card>
      </div>
    </div>
  `,
  styleUrls: [],
})
export class EmailVerificationComponent implements OnInit, OnDestroy {
  verificationStatus: 'pending' | 'success' | 'error' = 'pending';
  isLoading = true;
  error: string | null = null;
  resendLoading = false;
  token: string | null = null;
  logoUrl: string = '';

  private toast = inject(ToastService);
  private configFacade = inject(ConfigFacade);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroy$ = new Subject<void>();

  constructor(private authFacade: AuthFacade) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnInit(): void {
    // Load branding logo
    const appConfig = this.configFacade.getCurrentConfig();
    if (appConfig) {
      this.logoUrl = appConfig.branding?.logo?.url || '';
      if (!this.logoUrl && appConfig.domainConfig?.isVendixDomain) {
        this.logoUrl = 'vlogo.png';
      }
    }

    // Get the token from the route parameters
    this.token = this.route.snapshot.queryParamMap.get('token');

    if (this.token) {
      // Verify the email using the token
      this.verifyEmail();
    } else {
      // If no token is provided, show an error
      this.isLoading = false;
      this.verificationStatus = 'error';
      this.error = 'No se proporcionó un token de verificación válido.';
    }
  }

  private verifyEmail(): void {
    this.authFacade.verifyEmail(this.token!);

    this.authFacade.loading$
      .pipe(takeUntil(this.destroy$))
      .subscribe((isLoading) => {
        this.isLoading = isLoading;
      });

    this.authFacade.error$.pipe(takeUntil(this.destroy$)).subscribe((error) => {
      if (error) {
        // Normalize error to handle both string and NormalizedApiPayload types
        const errorMessage =
          typeof error === 'string' ? error : extractApiErrorMessage(error);
        this.error = errorMessage;
        this.verificationStatus = 'error';
        this.isLoading = false;

        this.toast.error(errorMessage, 'Error de verificación');
      } else {
        // Success case - email verified
        this.verificationStatus = 'success';
        this.isLoading = false;

        this.toast.success(
          'Tu email ha sido verificado exitosamente.',
          'Verificación exitosa',
        );
      }
    });
  }

  get verificationMessage(): string {
    if (this.isLoading) {
      return 'Verificando tu email...';
    } else if (this.verificationStatus === 'success') {
      return 'Tu cuenta ha sido verificada correctamente.';
    } else {
      return 'Completando proceso de verificación de email.';
    }
  }

  resendVerificationEmail(): void {
    // Get the email from the route or from local storage if available
    const email = this.route.snapshot.queryParamMap.get('email');

    if (!email) {
      this.toast.error(
        'No se puede reenviar el email de verificación sin un email válido.',
        'Error',
      );
      return;
    }

    this.resendLoading = true;
    this.authFacade.resendVerification(email);

    this.authFacade.loading$
      .pipe(takeUntil(this.destroy$))
      .subscribe((isLoading) => {
        this.resendLoading = isLoading;
      });

    this.authFacade.error$.pipe(takeUntil(this.destroy$)).subscribe((error) => {
      if (error) {
        // Normalize error to handle both string and NormalizedApiPayload types
        const errorMessage =
          typeof error === 'string' ? error : extractApiErrorMessage(error);
        this.toast.error(errorMessage, 'Error al reenviar email');
      } else {
        // Success case - email resent
        this.toast.success(
          'Email de verificación reenviado exitosamente.',
          'Email enviado',
        );
      }
    });
  }
}
