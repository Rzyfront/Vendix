import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent, IconComponent } from '../../index';
import { OnboardingWizardService } from '../../../../core/services/onboarding-wizard.service';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { Subject, takeUntil, interval } from 'rxjs';

@Component({
  selector: 'app-email-verification-step',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .email-step {
      padding: 0;
      min-height: 500px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .email-container {
      text-align: center;
      max-width: 480px;
      width: 100%;
    }

    .email-icon-wrapper {
      position: relative;
      margin-bottom: 2rem;
      display: inline-block;
    }

    .email-icon-bg {
      width: 96px;
      height: 96px;
      background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 8px 32px rgba(59, 130, 246, 0.24);
      position: relative;
      z-index: 2;
    }

    .email-icon {
      color: white;
    }

    .email-icon-ring {
      position: absolute;
      top: -8px;
      left: -8px;
      right: -8px;
      bottom: -8px;
      border: 2px solid rgba(59, 130, 246, 0.2);
      border-radius: 50%;
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0% {
        transform: scale(1);
        opacity: 1;
      }
      50% {
        transform: scale(1.05);
        opacity: 0.7;
      }
      100% {
        transform: scale(1);
        opacity: 1;
      }
    }

    .email-content {
      text-align: left;
    }

    .email-title {
      font-size: 1.75rem;
      font-weight: 700;
      color: #1F2937;
      margin-bottom: 0.75rem;
      text-align: center;
    }

    .email-description {
      color: #6B7280;
      font-size: 1rem;
      line-height: 1.6;
      margin-bottom: 1.5rem;
      text-align: center;
    }

    .email-address {
      font-weight: 600;
      color: #1F2937;
      background: rgba(59, 130, 246, 0.08);
      padding: 0.25rem 0.5rem;
      border-radius: 0.375rem;
      font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
      font-size: 0.875rem;
    }

    .email-status-card {
      background: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%);
      border: 1px solid #F59E0B;
      border-radius: 0.75rem;
      padding: 1.25rem;
      display: flex;
      align-items: flex-start;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .status-icon {
      background: white;
      width: 48px;
      height: 48px;
      border-radius: 0.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 2px 8px rgba(245, 158, 11, 0.2);
    }

    .status-icon-waiting {
      color: #F59E0B;
    }

    .status-content h3 {
      font-size: 1.125rem;
      font-weight: 600;
      color: #92400E;
      margin-bottom: 0.25rem;
    }

    .status-description {
      color: #78350F;
      font-size: 0.875rem;
      line-height: 1.5;
    }

    .email-instructions {
      background: #F9FAFB;
      border: 1px solid #E5E7EB;
      border-radius: 0.75rem;
      padding: 1.25rem;
      margin-bottom: 1.5rem;
    }

    .instructions-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    .instructions-icon {
      color: #3B82F6;
    }

    .instructions-title {
      font-weight: 600;
      color: #1F2937;
      font-size: 0.875rem;
    }

    .steps-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .step-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .step-number {
      width: 24px;
      height: 24px;
      background: #3B82F6;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      font-weight: 600;
      flex-shrink: 0;
    }

    .step-text {
      color: #4B5563;
      font-size: 0.875rem;
      line-height: 1.4;
    }

    .email-actions {
      display: flex;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .action-button {
      flex: 1;
      min-width: 0;
    }

    .email-help {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem;
      background: #EFF6FF;
      border: 1px solid #BFDBFE;
      border-radius: 0.5rem;
    }

    .help-icon {
      color: #3B82F6;
      flex-shrink: 0;
    }

    .help-text {
      color: #1E40AF;
      font-size: 0.875rem;
      line-height: 1.4;
    }

    @media (max-width: 640px) {
      .email-container {
        padding: 0 1rem;
      }

      .email-actions {
        flex-direction: column;
      }

      .email-title {
        font-size: 1.5rem;
      }

      .email-status-card {
        flex-direction: column;
        text-align: center;
        gap: 0.75rem;
      }
    }
  `],
  template: `
    <div class="step-content email-step">
      <div class="email-container">
        <!-- Email Icon with Animation -->
        <div class="email-icon-wrapper">
          <div class="email-icon-bg">
            <app-icon name="mail" size="48" class="email-icon"></app-icon>
          </div>
          <div class="email-icon-ring"></div>
        </div>

        <!-- Main Content -->
        <div class="email-content">
          <h2 class="email-title">Verifica tu correo electrónico</h2>
          <p class="email-description">
            Enviamos un enlace de verificación a:<br>
            <span class="email-address">{{ userEmail }}</span>
          </p>

          <!-- Status Card -->
          <div class="email-status-card">
            <div class="status-icon">
              <app-icon name="clock" size="24" class="status-icon-waiting"></app-icon>
            </div>
            <div class="status-content">
              <h3 class="status-title">Esperando verificación</h3>
              <p class="status-description">
                Revisa tu bandeja de entrada y haz clic en el enlace que te enviamos
              </p>
            </div>
          </div>

          <!-- Instructions -->
          <div class="email-instructions">
            <div class="instructions-header">
              <app-icon name="info" size="20" class="instructions-icon"></app-icon>
              <span class="instructions-title">Pasos rápidos</span>
            </div>
            <div class="steps-list">
              <div class="step-item">
                <div class="step-number">1</div>
                <span class="step-text">Abre tu bandeja de entrada</span>
              </div>
              <div class="step-item">
                <div class="step-number">2</div>
                <span class="step-text">Busca el email de "Vendix"</span>
              </div>
              <div class="step-item">
                <div class="step-number">3</div>
                <span class="step-text">Haz clic en "Verificar email"</span>
              </div>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="email-actions">
            <app-button
              variant="outline"
              size="lg"
              (clicked)="resendVerification()"
              [disabled]="isResending"
              class="action-button"
            >
              <app-icon name="refresh-cw" [size]="18" [spin]="isResending" slot="icon"></app-icon>
              {{ isResending ? 'Enviando...' : 'Reenviar correo' }}
            </app-button>

            <app-button
              variant="primary"
              size="lg"
              (clicked)="checkVerification()"
              class="action-button"
            >
              <app-icon name="check-circle" size="18" slot="icon"></app-icon>
              Verifiqué mi email
            </app-button>
          </div>

          <!-- Help Text -->
          <div class="email-help">
            <app-icon name="help-circle" size="16" class="help-icon"></app-icon>
            <span class="help-text">
              ¿No recibiste el email? Revisa tu carpeta de spam o correo no deseado
            </span>
          </div>
        </div>
      </div>
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