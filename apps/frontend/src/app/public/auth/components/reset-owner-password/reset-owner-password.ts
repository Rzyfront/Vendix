import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { tap } from 'rxjs/operators';
import { extractApiErrorMessage } from '../../../../core/utils/api-error-handler';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';

// Custom validator to check if passwords match
export function passwordsMatchValidator(control: AbstractControl): ValidationErrors | null {
  const new_password = control.get('new_password');
  const confirmPassword = control.get('confirmPassword');
  return new_password && confirmPassword && new_password.value !== confirmPassword.value ? { passwordsMismatch: true } : null;
}

// Custom validator for password strength
export function passwordStrengthValidator(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  if (!value) {
    return null;
  }

  const hasUpperCase = /[A-Z]/.test(value);
  const hasLowerCase = /[a-z]/.test(value);
  const hasNumeric = /[0-9]/.test(value);
  const hasSymbol = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(value);
  const isValidLength = value.length >= 8;

  const passwordValid = hasUpperCase && hasLowerCase && hasNumeric && hasSymbol && isValidLength;

  if (!passwordValid) {
    return {
      passwordStrength: {
        hasUpperCase,
        hasLowerCase,
        hasNumeric,
        hasSymbol,
        isValidLength
      }
    };
  }

  return null;
}

@Component({
  selector: 'app-reset-owner-password',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    CardComponent,
    InputComponent,
    ButtonComponent
  ],
  template: `
    <div class="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-[var(--color-background)] to-[rgba(126, 215, 165, 0.1)]">
      <div class="max-w-sm w-full space-y-8">
        <!-- Header section with logo and title -->
        <div class="text-center my-3">
          <div class="mx-auto h-16 w-16 bg-[var(--color-primary)] rounded-full flex items-center justify-center mb-4">
            <span class="text-white font-bold text-xl">V</span>
          </div>
          <h2 class="mt-6 text-2xl font-extrabold text-[var(--color-text-primary)]">
            Restablecer Contraseña
          </h2>
          <p class="mt-2 text-sm text-[var(--color-text-secondary)]">
            Ingresa tu nueva contraseña.
          </p>
        </div>

        <!-- Card with form -->
        <app-card shadow="md" class="mt-20" [animateOnLoad]="true">
          <form [formGroup]="resetPasswordForm" (ngSubmit)="onSubmit()" class="space-y-8">
            <div>
              <!-- Error message display -->
              <div *ngIf="error" class="rounded-md bg-[rgba(239, 68, 68, 0.1)] p-4 border border-[rgba(239, 68, 68, 0.2)]">
                <div class="flex">
                  <div class="flex-shrink-0">
                    <svg class="h-5 w-5 text-[var(--color-destructive)]" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
                    </svg>
                  </div>
                  <div class="ml-3">
                    <h3 class="text-sm font-medium text-[var(--color-destructive)]">
                      {{ error }}
                    </h3>
                  </div>
                </div>
              </div>

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

              <!-- Passwords mismatch error -->
              <div *ngIf="resetPasswordForm.hasError('passwordsMismatch') && resetPasswordForm.get('confirmPassword')?.touched" 
                   class="mt-2 text-sm text-[var(--color-destructive)]">
                Las contraseñas no coinciden.
              </div>
            </div>

            <app-button
              type="submit"
              variant="primary"
              size="md"
              [disabled]="!resetPasswordForm.valid || isLoading"
              [loading]="isLoading"
              [fullWidth]="true"
              [showTextWhileLoading]="true"
              class="mt-4 w-full">
              @if (isLoading) {
                Restableciendo contraseña...
              } @else {
                Restablecer Contraseña
              }
            </app-button>

            <!-- Back to login link -->
            <div class="flex justify-center mt-4">
              <div class="text-sm">
                <a
                  routerLink="/auth/login"
                  class="font-medium text-[var(--color-primary)] hover:text-[var(--color-secondary)]">
                  Volver a Iniciar Sesión
                </a>
              </div>
            </div>
          </form>
        </app-card>
      </div>
    </div>
  `,
  styleUrls: []
})
export class ResetOwnerPasswordComponent implements OnInit, OnDestroy {
  resetPasswordForm: FormGroup;
  isLoading = false;
  token: string | null = null;
  error: string | null = null;

  private toast = inject(ToastService);

  constructor(
    private fb: FormBuilder,
    private authFacade: AuthFacade,
    private router: Router,
    private route: ActivatedRoute
  ) {
    this.resetPasswordForm = this.fb.group({
      new_password: ['', [Validators.required, passwordStrengthValidator]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: passwordsMatchValidator });
  }

  ngOnDestroy(): void {
    // Clear error state when component is destroyed to prevent affecting other components
    this.authFacade.setAuthError(null);
  }

  ngOnInit(): void {
    // Clear any previous error state when component initializes to avoid showing old errors
    this.authFacade.setAuthError(null);
    
    this.route.queryParamMap.pipe(
      tap(params => {
        this.token = params.get('token');
        if (!this.token) {
          this.toast.error('Token de restablecimiento no encontrado o inválido.');
          this.router.navigate(['/auth/login']);
        }
      })
    ).subscribe();

    // Subscribe to error changes to display them on screen
    this.authFacade.error$.subscribe(error => {
      if (error) {
        const errorMessage = typeof error === 'string' ? error : extractApiErrorMessage(error);
        this.error = errorMessage;
      } else {
        this.error = null;
      }
    });
  }

  onSubmit(): void {
    // Clear any previous error state before making the request
    this.authFacade.setAuthError(null);
    this.error = null;
    
    if (this.resetPasswordForm.valid && this.token) {
      const { new_password } = this.resetPasswordForm.value;
      this.authFacade.resetOwnerPassword(this.token, new_password);

      // Subscribe to loading state
      const loadingSubscription = this.authFacade.loading$.subscribe(isLoading => {
        this.isLoading = isLoading;
      });

      // Subscribe to error state - only handle errors with on-screen display (toast is handled by effects)
      const errorSubscription = this.authFacade.error$.subscribe(error => {
        if (error) {
          // Error is already handled in ngOnInit for on-screen display
          // Normalize error to handle both string and NormalizedApiPayload types
          const errorMessage = typeof error === 'string' ? error : extractApiErrorMessage(error);
          this.error = errorMessage;
          
          // Unsubscribe to prevent memory leaks
          loadingSubscription.unsubscribe();
          errorSubscription.unsubscribe();
        } else {
          // Only clear the error if there was a previous error
          this.error = null;
        }
      });

    } else {
      this.resetPasswordForm.markAllAsTouched();
    }
  }
}