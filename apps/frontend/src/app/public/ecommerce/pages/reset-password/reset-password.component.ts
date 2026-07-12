import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
  AbstractControl,
} from '@angular/forms';
import { tap } from 'rxjs/operators';

import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../core/utils/api-error-handler';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
// Reuse the owner reset-password validators — do NOT redefine them.
import {
  passwordStrengthValidator,
  passwordsMatchValidator,
} from '../../../auth/components/reset-owner-password/reset-owner-password';

/**
 * Public reset-password page for STORE_ECOMMERCE customers.
 *
 * Opened from the email recovery link as `/reset-password?token=...`.
 * Reads the token from the query params, collects and validates the new
 * password, and dispatches `authFacade.resetCustomerPassword(token, pwd)`.
 *
 * Success toast + navigation to `/` are handled by the
 * `resetCustomerPasswordSuccess$` effect — this page does NOT navigate on
 * success. Failure toasts are handled by the auth `failureToast$` effect;
 * the inline error block below mirrors the current `authError` signal.
 */
@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [
    RouterModule,
    ReactiveFormsModule,
    CardComponent,
    InputComponent,
    ButtonComponent,
  ],
  template: `
    <div
      class="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-[var(--color-background)]"
    >
      <div class="max-w-sm w-full space-y-8">
        <!-- Header -->
        <div class="text-center my-3">
          <div
            class="mx-auto h-16 w-16 bg-[var(--color-primary)] rounded-full flex items-center justify-center mb-4"
          >
            <span class="text-white font-bold text-xl">V</span>
          </div>
          <h2
            class="mt-6 text-2xl font-extrabold text-[var(--color-text-primary)]"
          >
            Restablecer Contraseña
          </h2>
          <p class="mt-2 text-sm text-[var(--color-text-secondary)]">
            Ingresa tu nueva contraseña.
          </p>
        </div>

        <!-- Card with form -->
        <app-card shadow="md" [animateOnLoad]="true">
          <form
            [formGroup]="resetPasswordForm"
            (ngSubmit)="onSubmit()"
            class="space-y-8"
          >
            <div class="space-y-4">
              <!-- Error message display -->
              @if (errorMessage()) {
                <div
                  class="rounded-md bg-[rgba(239,68,68,0.1)] p-4 border border-[rgba(239,68,68,0.2)]"
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

              <app-input
                label="Nueva Contraseña"
                formControlName="new_password"
                [control]="newPasswordControl"
                type="password"
                size="md"
                placeholder="••••••••"
              ></app-input>

              <app-input
                label="Confirmar Nueva Contraseña"
                formControlName="confirmPassword"
                [control]="confirmPasswordControl"
                type="password"
                size="md"
                placeholder="••••••••"
              ></app-input>

              <!-- Passwords mismatch error -->
              @if (
                resetPasswordForm.hasError('passwordsMismatch') &&
                confirmPasswordControl?.touched
              ) {
                <div class="text-sm text-[var(--color-destructive)]">
                  Las contraseñas no coinciden.
                </div>
              }
            </div>

            <app-button
              type="submit"
              variant="primary"
              size="md"
              [disabled]="!resetPasswordForm.valid || isLoading()"
              [loading]="isLoading()"
              [fullWidth]="true"
              [showTextWhileLoading]="true"
              class="mt-4 w-full"
            >
              @if (isLoading()) {
                Restableciendo contraseña...
              } @else {
                Restablecer Contraseña
              }
            </app-button>

            <!-- Back to store link -->
            <div class="flex justify-center mt-4">
              <div class="text-sm">
                <a
                  routerLink="/"
                  class="font-medium text-[var(--color-primary)] hover:text-[var(--color-secondary)]"
                >
                  Volver a la tienda
                </a>
              </div>
            </div>
          </form>
        </app-card>
      </div>
    </div>
  `,
  styleUrls: [],
})
export class ResetPasswordComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly authFacade = inject(AuthFacade);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** Recovery token read from the `?token=` query param. */
  readonly token = signal<string | null>(null);

  /** Loading + error state come straight from the auth facade signals. */
  readonly isLoading = this.authFacade.authLoading;
  readonly errorMessage = computed<string | null>(() => {
    const error = this.authFacade.authError();
    if (!error) {
      return null;
    }
    return typeof error === 'string' ? error : extractApiErrorMessage(error);
  });

  readonly resetPasswordForm: FormGroup = this.fb.group(
    {
      new_password: ['', [Validators.required, passwordStrengthValidator]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: passwordsMatchValidator },
  );

  get newPasswordControl(): AbstractControl | null {
    return this.resetPasswordForm.get('new_password');
  }

  get confirmPasswordControl(): AbstractControl | null {
    return this.resetPasswordForm.get('confirmPassword');
  }

  ngOnInit(): void {
    // Clear any stale error so we don't show a previous screen's message.
    this.authFacade.setAuthError(null);

    this.route.queryParamMap
      .pipe(
        tap((params) => {
          this.token.set(params.get('token'));
          if (!this.token()) {
            this.toast.error(
              'Token de restablecimiento no encontrado o inválido.',
            );
            this.router.navigateByUrl('/');
          }
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  ngOnDestroy(): void {
    // Avoid leaking this page's error into other components.
    this.authFacade.setAuthError(null);
  }

  onSubmit(): void {
    this.authFacade.setAuthError(null);

    const token = this.token();
    if (this.resetPasswordForm.valid && token) {
      const { new_password } = this.resetPasswordForm.value;
      // Success toast + navigation to '/' are handled by the
      // resetCustomerPasswordSuccess$ effect — do not duplicate them here.
      this.authFacade.resetCustomerPassword(token, new_password);
    } else {
      this.resetPasswordForm.markAllAsTouched();
    }
  }
}
