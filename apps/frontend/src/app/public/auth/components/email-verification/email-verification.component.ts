import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';

@Component({
  selector: 'app-email-verification',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-gray-50 to-green-50">
      <div class="max-w-md w-full space-y-8">
        <!-- Branding -->
        <div class="text-center">
          <div class="mx-auto h-16 w-16 bg-primary rounded-full flex items-center justify-center mb-4">
            <span class="text-white font-bold text-xl">V</span>
          </div>
          <h2 class="mt-6 text-3xl font-extrabold text-gray-900">
            Verificación de Email
          </h2>
        </div>

        <!-- Verification Card -->
        <div class="mt-8 space-y-6 bg-white p-8 rounded-lg shadow-lg">
          <div class="text-center">
            @if (verificationState === 'loading') {
              <div class="space-y-4">
                <div class="flex justify-center">
                  <svg class="animate-spin h-12 w-12 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
                <p class="text-lg font-medium text-gray-700">Verificando tu email...</p>
                <p class="text-sm text-gray-500">Por favor espera un momento</p>
              </div>
            }

            @if (verificationState === 'success') {
              <div class="space-y-4">
                <div class="flex justify-center">
                  <svg class="h-12 w-12 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p class="text-lg font-medium text-gray-700">¡Email verificado exitosamente!</p>
                <p class="text-sm text-gray-500">Tu cuenta ha sido activada correctamente</p>
                <button
                  (click)="navigateToLogin()"
                  class="mt-4 w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                >
                  Iniciar Sesión
                </button>
              </div>
            }

            @if (verificationState === 'error') {
              <div class="space-y-4">
                <div class="flex justify-center">
                  <svg class="h-12 w-12 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p class="text-lg font-medium text-gray-700">Error en la verificación</p>
                <p class="text-sm text-gray-500">{{ errorMessage }}</p>
                <div class="space-y-2">
                  <button
                    (click)="retryVerification()"
                    class="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                  >
                    Reintentar
                  </button>
                  <button
                    (click)="navigateToLogin()"
                    class="w-full flex justify-center py-3 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                  >
                    Volver al Login
                  </button>
                </div>
              </div>
            }

            @if (verificationState === 'invalid_token') {
              <div class="space-y-4">
                <div class="flex justify-center">
                  <svg class="h-12 w-12 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.35 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <p class="text-lg font-medium text-gray-700">Token inválido o expirado</p>
                <p class="text-sm text-gray-500">El enlace de verificación no es válido o ha expirado</p>
                <button
                  (click)="navigateToLogin()"
                  class="mt-4 w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                >
                  Volver al Login
                </button>
              </div>
            }
          </div>
        </div>

        <!-- Context Info -->
        <div class="text-center text-xs text-gray-500 mt-4">
          <p>Powered by Vendix Platform</p>
        </div>
      </div>
    </div>
  `
})
export class EmailVerificationComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private authService = inject(AuthService);

  verificationState: 'loading' | 'success' | 'error' | 'invalid_token' = 'loading';
  errorMessage = '';

  ngOnInit() {
    this.verifyEmailToken();
  }

  verifyEmailToken() {
    this.route.queryParams.subscribe(params => {
      const token = params['token'];
      
      if (!token) {
        this.verificationState = 'invalid_token';
        this.errorMessage = 'No se encontró token de verificación en la URL';
        return;
      }

      this.authService.verifyEmail(token).subscribe({
        next: (response) => {
          if (response.success) {
            this.verificationState = 'success';
          } else {
            this.verificationState = 'error';
            this.errorMessage = response.message || 'Error al verificar el email';
          }
        },
        error: (error) => {
          console.error('Error verifying email:', error);
          this.verificationState = 'error';
          this.errorMessage = error.error?.message || 'Error de conexión al verificar el email';
        }
      });
    });
  }

  retryVerification() {
    this.verificationState = 'loading';
    this.verifyEmailToken();
  }

  navigateToLogin() {
    this.router.navigate(['/auth/login']);
  }
}