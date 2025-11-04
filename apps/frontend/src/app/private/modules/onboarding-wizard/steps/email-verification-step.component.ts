import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OnboardingWizardService } from '../../../../core/services/onboarding-wizard.service';
import { interval } from 'rxjs';
import { takeWhile } from 'rxjs/operators';

@Component({
  selector: 'app-email-verification-step',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="max-w-md mx-auto text-center space-y-6">
      <div
        [class]="
          'p-6 rounded-lg ' +
          (emailStatus === 'verified' ? 'bg-green-50' : 'bg-yellow-50')
        "
      >
        <div class="text-4xl mb-4">
          {{ emailStatus === 'verified' ? '✅' : '📧' }}
        </div>

        <div *ngIf="emailStatus === 'verified'">
          <h3 class="text-lg font-semibold text-green-800 mb-2">
            ¡Email verificado!
          </h3>
          <p class="text-green-600">Ya puedes continuar con la configuración</p>
        </div>

        <div *ngIf="emailStatus !== 'verified'">
          <h3 class="text-lg font-semibold text-yellow-800 mb-2">
            Verifica tu email
          </h3>
          <p class="text-yellow-700 mb-4">
            Enviamos un enlace de verificación a tu correo
          </p>

          <div class="space-y-3">
            <button
              (click)="checkEmailStatus()"
              [disabled]="isChecking"
              class="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {{ isChecking ? 'Verificando...' : 'Verificar ahora' }}
            </button>

            <button
              (click)="resendVerification()"
              [disabled]="isResending"
              class="w-full bg-gray-200 text-gray-700 py-3 rounded-lg hover:bg-gray-300 disabled:opacity-50 transition-colors"
            >
              {{ isResending ? 'Enviando...' : 'Reenviar verificación' }}
            </button>
          </div>

          <div class="mt-4 text-sm text-gray-600" *ngIf="autoCheckCounter > 0">
            Verificando automáticamente en {{ autoCheckCounter }}s...
          </div>
        </div>
      </div>

      <div class="text-sm text-gray-500">
        ¿No recibiste el email? Revisa tu carpeta de spam
      </div>
    </div>
  `,
})
export class EmailVerificationStepComponent implements OnInit {
  emailStatus: 'pending' | 'verified' | 'error' = 'pending';
  isChecking = false;
  isResending = false;
  autoCheckCounter = 10;
  private autoCheckActive = false;

  constructor(private wizardService: OnboardingWizardService) {}

  ngOnInit(): void {
    this.checkEmailStatus();
    this.startAutoCheck();
  }

  checkEmailStatus(): void {
    this.isChecking = true;
    this.wizardService.checkEmailVerification().subscribe({
      next: (response: any) => {
        this.isChecking = false;
        if (response.success && response.data) {
          this.emailStatus = response.data.verified ? 'verified' : 'pending';
          if (this.emailStatus === 'verified') {
            this.autoCheckActive = false;
            // Auto-advance after 2 seconds
            setTimeout(() => {
              this.wizardService.nextStep();
            }, 2000);
          }
        }
      },
      error: () => {
        this.isChecking = false;
        this.emailStatus = 'error';
      },
    });
  }

  resendVerification(): void {
    this.isResending = true;
    // TODO: Implement resend verification endpoint
    setTimeout(() => {
      this.isResending = false;
      alert('Email de verificación reenviado. Por favor revisa tu bandeja de entrada.');
    }, 1000);
  }

  private startAutoCheck(): void {
    this.autoCheckActive = true;
    interval(1000)
      .pipe(takeWhile(() => this.autoCheckActive && this.emailStatus !== 'verified'))
      .subscribe(() => {
        this.autoCheckCounter--;
        if (this.autoCheckCounter <= 0) {
          this.checkEmailStatus();
          this.autoCheckCounter = 10;
        }
      });
  }
}
