import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { of } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';

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
    ReactiveFormsModule
  ],
  template: `
    <div class="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-gray-50 to-green-50">
      <div class="max-w-md w-full space-y-8">
        <div class="text-center">
          <div class="mx-auto h-16 w-16 bg-primary rounded-full flex items-center justify-center mb-4">
            <span class="text-white font-bold text-xl">V</span>
          </div>
          <h2 class="mt-6 text-3xl font-extrabold text-gray-900">
            Restablecer Contraseña
          </h2>
          <p class="mt-2 text-sm text-gray-600">
            Ingresa tu nueva contraseña.
          </p>
        </div>

        <!-- API Error Display -->
        @if (apiError) {
          <div class="bg-red-50 border border-red-200 rounded-md p-4">
            <div class="flex">
              <div class="flex-shrink-0">
                <svg class="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="ml-3">
                <h3 class="text-sm font-medium text-red-800">
                  Error
                </h3>
                <div class="mt-1 text-sm text-red-700">
                  {{ apiError }}
                </div>
              </div>
            </div>
          </div>
        }

        <form [formGroup]="resetPasswordForm" (ngSubmit)="onSubmit()" class="mt-8 space-y-6 bg-white p-8 rounded-lg shadow-lg">
          <div class="space-y-4">
            <div>
              <label for="new_password" class="block text-sm font-medium text-gray-700">
                Nueva Contraseña
              </label>
              <input
                id="new_password"
                formControlName="new_password"
                type="password"
                [class]="getFieldClass('new_password')"
                placeholder="••••••••">
              @if (hasFieldError('new_password')) {
                <div class="mt-1 text-sm text-red-600">
                  {{ getFieldError('new_password') }}
                </div>
              }
            </div>

            <div>
              <label for="confirmPassword" class="block text-sm font-medium text-gray-700">
                Confirmar Nueva Contraseña
              </label>
              <input
                id="confirmPassword"
                formControlName="confirmPassword"
                type="password"
                [class]="getFieldClass('confirmPassword')"
                placeholder="••••••••">
              @if (hasFieldError('confirmPassword')) {
                <div class="mt-1 text-sm text-red-600">
                  {{ getFieldError('confirmPassword') }}
                </div>
              }
              @if (resetPasswordForm.hasError('passwordsMismatch') && resetPasswordForm.get('confirmPassword')?.touched) {
                <div class="mt-1 text-sm text-red-600">
                  Las contraseñas no coinciden.
                </div>
              }
            </div>
          </div>

          <div>
            <button
              type="submit"
              [disabled]="!resetPasswordForm.valid || isLoading"
              [class]="isLoading
                ? 'w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary/70 cursor-not-allowed'
                : 'w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary'">
              @if (isLoading) {
                <span class="flex items-center">
                  <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Restableciendo...
                </span>
              }
              @if (!isLoading) {
                <span>
                  Restablecer Contraseña
                </span>
              }
            </button>
          </div>
        </form>

        <div class="text-center text-sm">
          <a routerLink="/auth/login" class="font-medium text-primary hover:text-primary-dark">
            Volver a Iniciar Sesión
          </a>
        </div>
      </div>
    </div>
  `,
  styleUrls: []
})
export class ResetOwnerPasswordComponent implements OnInit {
  resetPasswordForm: FormGroup;
  isLoading = false;
  token: string | null = null;
  apiError: string | null = null;

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

  ngOnInit(): void {
    this.route.queryParamMap.pipe(
      tap(params => {
        this.token = params.get('token');
        if (!this.token) {
          this.toast.error('Token de restablecimiento no encontrado o inválido.');
          this.router.navigate(['/auth/login']);
        }
      })
    ).subscribe();
  }

  onSubmit(): void {
    // Clear previous errors
    this.apiError = null;
    
    if (this.resetPasswordForm.valid && this.token) {
      const { new_password } = this.resetPasswordForm.value;
      this.authFacade.resetOwnerPassword(this.token, new_password);

      this.authFacade.loading$.subscribe(isLoading => {
        this.isLoading = isLoading;
      });

      this.authFacade.error$.subscribe(error => {
        if (error) {
          // Extract specific error message from API response
          let errorMessage = 'Error al restablecer la contraseña. Por favor, inténtalo de nuevo.';
          
          if (typeof error === 'object' && error !== null) {
            // Handle error object with nested message structure
            const errorObj = error as any;
            if (errorObj.message?.message) {
              errorMessage = errorObj.message.message;
            } else if (errorObj.message) {
              errorMessage = errorObj.message;
            } else if (errorObj.error?.message) {
              errorMessage = errorObj.error.message;
            }
          } else if (typeof error === 'string') {
            errorMessage = error;
          }
          
          this.apiError = errorMessage;
          this.toast.error(errorMessage, 'Error al restablecer contraseña');
        } else {
          this.toast.success('Contraseña restablecida con éxito.');
          this.router.navigate(['/auth/login']);
        }
      });
    } else {
      this.resetPasswordForm.markAllAsTouched();
    }
  }

  getFieldClass(fieldName: string): string {
    const field = this.resetPasswordForm.get(fieldName);
    const baseClasses = 'w-full px-4 py-3 rounded-input border transition-all duration-300 focus:outline-none focus:ring-2 text-gray-900 placeholder-gray-500';

    if ((field?.invalid && field?.touched) || (this.resetPasswordForm.hasError('passwordsMismatch') && fieldName === 'confirmPassword')) {
      return `${baseClasses} border-red-300 bg-red-50 focus:border-red-500 focus:ring-red-500/50`;
    }
    return `${baseClasses} border-gray-300 bg-white focus:border-primary focus:ring-primary/50`;
  }

  hasFieldError(fieldName: string): boolean {
    const field = this.resetPasswordForm.get(fieldName);
    return !!(field?.invalid && field?.touched);
  }

  getFieldError(fieldName: string): string {
    const field = this.resetPasswordForm.get(fieldName);
    if (field?.errors) {
      if (field.errors['required']) {
        return 'Este campo es requerido.';
      }
      if (field.errors['passwordStrength']) {
        const strengthErrors = field.errors['passwordStrength'];
        const requirements = [];
        
        if (!strengthErrors.isValidLength) {
          requirements.push('al menos 8 caracteres');
        }
        if (!strengthErrors.hasUpperCase) {
          requirements.push('una letra mayúscula');
        }
        if (!strengthErrors.hasLowerCase) {
          requirements.push('una letra minúscula');
        }
        if (!strengthErrors.hasNumeric) {
          requirements.push('un número');
        }
        if (!strengthErrors.hasSymbol) {
          requirements.push('un símbolo (!@#$%^&* etc.)');
        }
        
        return `La contraseña debe tener ${requirements.join(', ')}.`;
      }
    }
    return '';
  }
}