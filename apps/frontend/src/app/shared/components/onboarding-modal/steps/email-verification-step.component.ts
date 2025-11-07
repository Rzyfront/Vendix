import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../../../button/button.component';
import { IconComponent } from '../../../icon/icon.component';
import { OnboardingWizardService } from '../../../../core/services/onboarding-wizard.service';

@Component({
  selector: 'app-email-verification-step',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="step-container welcome-step">
      <div class="welcome-icon">
        <app-icon name="mail" size="40"></app-icon>
      </div>

      <h2 class="welcome-title">Verifica tu email</h2>
      <p class="welcome-description">
        Te hemos enviado un correo de verificación a <strong>{{ userEmail }}</strong>
      </p>

      <div class="bg-[var(--color-background)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-4 mb-6">
        <div class="flex items-center space-x-3">
          <app-icon name="info" class="text-[var(--color-primary)]" size="20"></app-icon>
          <div class="text-left">
            <div class="font-medium text-[var(--color-text-primary)]">Pasos a seguir:</div>
            <ol class="text-sm text-[var(--color-text-secondary)] mt-1 space-y-1">
              <li>1. Abre tu bandeja de entrada</li>
              <li>2. Busca el email de "Vendix"</li>
              <li>3. Haz clic en el botón de verificación</li>
            </ol>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-center space-x-4">
        <app-button
          variant="outline"
          size="md"
          (clicked)="resendVerification()"
          [disabled]="isResending"
        >
          <app-icon name="refresh-cw" [size]="16" [spin]="isResending" slot="icon"></app-icon>
          {{ isResending ? 'Enviando...' : 'Reenviar email' }}
        </app-button>

        <app-button
          variant="primary"
          size="md"
          (clicked)="checkVerification()"
        >
          <app-icon name="check" size="16" slot="icon"></app-icon>
          Ya verifiqué mi email
        </app-button>
      </div>

      <p class="text-sm text-[var(--color-text-secondary)] mt-4">
        ¿No recibiste el email? Revisa tu carpeta de spam o correo no deseado.
      </p>
    </div>
  `,
})
export class EmailVerificationStepComponent {
  @Input() userEmail: string = '';
  @Output() nextStep = new EventEmitter<void>();
  @Output() skipStep = new EventEmitter<void>();

  isResending = false;

  constructor(private wizardService: OnboardingWizardService) {}

  resendVerification(): void {
    this.isResending = true;
    // Implementation would call the service to resend verification
    setTimeout(() => {
      this.isResending = false;
    }, 2000);
  }

  checkVerification(): void {
    // Implementation would check email verification status
    this.nextStep.emit();
  }
}