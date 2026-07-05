import {
  Component,
  OnInit,
  inject,
  signal,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Router, ActivatedRoute } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';

// Custom validator: passwords must match.
export function passwordsMatchValidator(
  control: AbstractControl,
): ValidationErrors | null {
  const new_password = control.get('new_password');
  const confirmPassword = control.get('confirmPassword');
  return new_password &&
    confirmPassword &&
    new_password.value !== confirmPassword.value
    ? { passwordsMismatch: true }
    : null;
}

// Custom validator: password strength (8+ chars, mixed case, number, symbol).
export function passwordStrengthValidator(
  control: AbstractControl,
): ValidationErrors | null {
  const value = control.value;
  if (!value) {
    return null;
  }

  const hasUpperCase = /[A-Z]/.test(value);
  const hasLowerCase = /[a-z]/.test(value);
  const hasNumeric = /[0-9]/.test(value);
  const hasSymbol = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(value);
  const isValidLength = value.length >= 8;

  const passwordValid =
    hasUpperCase && hasLowerCase && hasNumeric && hasSymbol && isValidLength;

  if (!passwordValid) {
    return {
      passwordStrength: {
        hasUpperCase,
        hasLowerCase,
        hasNumeric,
        hasSymbol,
        isValidLength,
      },
    };
  }

  return null;
}

/**
 * Customer-facing reset-password page reached from the email link sent
 * by `forgotCustomerPassword`. After the token is consumed the customer
 * is logged in (if their account was pending_verification the backend
 * activates it in the same transaction) and we redirect to the store
 * homepage.
 */
@Component({
  selector: 'app-reset-customer-password',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    CardComponent,
    InputComponent,
    ButtonComponent,
  ],
  template: `
    <div
      class="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-[var(--color-background)] to-[rgba(126, 215, 165, 0.1)]"
    >
      <div class="max-w-sm w-full space-y-8">
        <div class="text-center my-3">
          <div
            class="mx-auto h-16 w-16 bg-[var(--color-primary)] rounded-full flex items-center justify-center mb-4"
          >
            <span class="text-white font-bold text-xl">V</span>
          </div>
          <h2
            class="mt-6 text-2xl font-extrabold text-[var(--color-text-primary)]"
          >
            Activar tu cuenta
          </h2>
          <p class="mt-2 text-sm text-[var(--color-text-secondary)]">
            Crea la contraseña con la que vas a entrar a la tienda.
          </p>
        </div>

        <app-card shadow="md" class="mt-20" [animateOnLoad]="true">
          @if (!token()) {
            <div
              class="p-4 rounded-lg bg-red-50 border border-red-200"
              role="alert"
            >
              <p class="text-sm text-red-800">
                El link de activación no es válido o ya expiró. Solicita uno
                nuevo desde la tienda.
              </p>
            </div>
          } @else {
            <form
              [formGroup]="resetPasswordForm"
              (ngSubmit)="onSubmit()"
              class="space-y-8"
            >
              <div class="space-y-4">
                <app-input
                  label="Nueva Contraseña"
                  formControlName="new_password"
                  [control]="resetPasswordForm.get('new_password')"
                  type="password"
                  size="md"
                  placeholder="••••••••"
                ></app-input>

                <app-input
                  label="Confirmar Nueva Contraseña"
                  formControlName="confirmPassword"
                  [control]="resetPasswordForm.get('confirmPassword')"
                  type="password"
                  size="md"
                  placeholder="••••••••"
                ></app-input>

                @if (
                  resetPasswordForm.hasError('passwordsMismatch') &&
                  resetPasswordForm.get('confirmPassword')?.touched
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
                  Activando cuenta...
                } @else {
                  Activar cuenta
                }
              </app-button>
            </form>
          }
        </app-card>
      </div>
    </div>
  `,
  styleUrls: [],
})
export class ResetCustomerPasswordComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  resetPasswordForm: FormGroup;
  readonly isLoading = signal(false);
  readonly token = signal<string | null>(null);

  private toast = inject(ToastService);

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
  ) {
    this.resetPasswordForm = this.fb.group(
      {
        new_password: ['', [Validators.required, passwordStrengthValidator]],
        confirmPassword: ['', [Validators.required]],
      },
      { validators: passwordsMatchValidator },
    );
  }

  ngOnInit(): void {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const t = params.get('token');
        if (!t) {
          this.toast.error(
            'Link de activación inválido o expirado.',
          );
        }
        this.token.set(t);
      });
  }

  onSubmit(): void {
    if (!this.resetPasswordForm.valid || !this.token()) {
      this.resetPasswordForm.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);
    const { new_password } = this.resetPasswordForm.value;
    this.authService
      .resetCustomerPassword(this.token()!, new_password)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resp: any) => {
          this.isLoading.set(false);
          const message =
            resp?.data?.message ??
            resp?.message ??
            'Cuenta activada y contraseña restablecida';
          this.toast.success(message, 'Listo');
          // The user is now logged in (or their account is activated).
          // Hand off to the ecommerce homepage — the store layout will
          // pick up the authenticated session from localStorage on next
          // navigation.
          this.router.navigate(['/']);
        },
        error: (err: any) => {
          this.isLoading.set(false);
          const message =
            err?.error?.message ??
            err?.message ??
            'No se pudo activar la cuenta. El link puede haber expirado.';
          this.toast.error(message);
        },
      });
  }
}