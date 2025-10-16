import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../core/utils/api-error-handler';

@Component({
  selector: 'app-forgot-owner-password',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule
  ],
  template: `
    <div class="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-gray-50 to-blue-50">
      <div class="max-w-md w-full space-y-8">
        <div class="text-center">
          <div class="mx-auto h-16 w-16 bg-primary rounded-full flex items-center justify-center mb-4">
            <span class="text-white font-bold text-xl">V</span>
          </div>
          <h2 class="mt-6 text-3xl font-extrabold text-gray-900">
            Recuperar Contraseña de Propietario
          </h2>
          <p class="mt-2 text-sm text-gray-600">
            Ingresa el Vlink de tu organización y tu email para recibir instrucciones.
          </p>
        </div>

        <form [formGroup]="forgotPasswordForm" (ngSubmit)="onSubmit()" class="mt-8 space-y-6 bg-white p-8 rounded-lg shadow-lg">
          <div class="space-y-4">
            <div>
              <label for="vlink" class="block text-sm font-medium text-gray-700">
                Vlink (slug de la organización)
              </label>
              <input
                id="vlink"
                formControlName="vlink"
                type="text"
                autocomplete="organization"
                [class]="getFieldClass('vlink')"
                placeholder="mi-organizacion">
              @if (hasFieldError('vlink')) {
                <div class="mt-1 text-sm text-red-600">
                  {{ getFieldError('vlink') }}
                </div>
              }
            </div>

            <div>
              <label for="email" class="block text-sm font-medium text-gray-700">
                Email de Propietario
              </label>
              <input
                id="email"
                formControlName="email"
                type="email"
                autocomplete="email"
                [class]="getFieldClass('email')"
                placeholder="propietario@empresa.com">
              @if (hasFieldError('email')) {
                <div class="mt-1 text-sm text-red-600">
                  {{ getFieldError('email') }}
                </div>
              }
            </div>
          </div>

          <div>
            <button
              type="submit"
              [disabled]="!forgotPasswordForm.valid || isLoading"
              [class]="isLoading
                ? 'w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary/70 cursor-not-allowed'
                : 'w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary'">
              @if (isLoading) {
                <span class="flex items-center">
                  <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Enviando...
                </span>
              }
              @if (!isLoading) {
                <span>
                  Enviar Instrucciones
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
export class ForgotOwnerPasswordComponent implements OnInit {
  forgotPasswordForm: FormGroup;
  isLoading = false;

  private toast = inject(ToastService);

  constructor(
    private fb: FormBuilder,
    private authFacade: AuthFacade,
    private router: Router
  ) {
    this.forgotPasswordForm = this.fb.group({
      vlink: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]]
    });
  }

  ngOnInit(): void {}

  onSubmit(): void {
    if (this.forgotPasswordForm.valid) {
      const { vlink, email } = this.forgotPasswordForm.value;
      this.authFacade.forgotOwnerPassword(vlink, email);

      const loadingSubscription = this.authFacade.loading$.subscribe(isLoading => {
        this.isLoading = isLoading;
      });

      const errorSubscription = this.authFacade.error$.subscribe(error => {
        if (error) {
          // Normalize error to handle both string and NormalizedApiPayload types
          const errorMessage = typeof error === 'string' ? error : extractApiErrorMessage(error);
          this.toast.error(errorMessage, 'Error al enviar instrucciones');
          
          // Unsubscribe to prevent memory leaks
          loadingSubscription.unsubscribe();
          errorSubscription.unsubscribe();
        } else {
          this.toast.success('Si los datos son correctos, recibirás un email con instrucciones.');
          this.router.navigate(['/auth/login']);
          
          // Unsubscribe on success as well
          loadingSubscription.unsubscribe();
          errorSubscription.unsubscribe();
        }
      });
    } else {
      this.forgotPasswordForm.markAllAsTouched();
    }
  }

  getFieldClass(fieldName: string): string {
    const field = this.forgotPasswordForm.get(fieldName);
    const baseClasses = 'w-full px-4 py-3 rounded-input border transition-all duration-300 focus:outline-none focus:ring-2 text-gray-900 placeholder-gray-500';

    if (field?.invalid && field?.touched) {
      return `${baseClasses} border-red-300 bg-red-50 focus:border-red-500 focus:ring-red-500/50`;
    }
    return `${baseClasses} border-gray-300 bg-white focus:border-primary focus:ring-primary/50`;
  }

  hasFieldError(fieldName: string): boolean {
    const field = this.forgotPasswordForm.get(fieldName);
    return !!(field?.invalid && field?.touched);
  }

  getFieldError(fieldName: string): string {
    const field = this.forgotPasswordForm.get(fieldName);
    if (field?.errors) {
      if (field.errors['required']) {
        return 'Este campo es requerido.';
      }
      if (field.errors['email']) {
        return 'Debe ser un email válido.';
      }
    }
    return '';
  }
}