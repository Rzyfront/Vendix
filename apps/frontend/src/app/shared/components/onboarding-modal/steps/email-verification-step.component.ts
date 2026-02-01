import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  OnInit,
  OnDestroy,
} from '@angular/core';
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
  styles: [
    `
      .email-step {
        padding: 1rem 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .email-container {
        text-align: center;
        max-width: 400px;
        width: 100%;
      }

      .email-icon-wrapper {
        position: relative;
        margin-bottom: 1.25rem;
        display: inline-block;
      }

      .email-icon-bg {
        width: 72px;
        height: 72px;
        background: linear-gradient(135deg, var(--color-accent) 0%, #0891b2 100%);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: var(--shadow-lg);
        position: relative;
        z-index: 2;
      }

      .email-icon {
        color: var(--color-text-on-primary);
      }

      .email-icon-ring {
        position: absolute;
        top: -6px;
        left: -6px;
        right: -6px;
        bottom: -6px;
        border: 2px solid rgba(6, 182, 212, 0.2);
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
        font-size: var(--fs-xl);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
        margin-bottom: 0.5rem;
        text-align: center;
      }

      .email-description {
        color: var(--color-text-secondary);
        font-size: var(--fs-sm);
        line-height: 1.5;
        margin-bottom: 1rem;
        text-align: center;
      }

      .email-address {
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
        background: var(--color-accent-light);
        padding: 0.125rem 0.375rem;
        border-radius: var(--radius-sm);
        font-family: 'SF Mono', 'Monaco', 'Roboto Mono', monospace;
        font-size: var(--fs-xs);
      }

      .email-status-card {
        background: var(--color-warning-light);
        border: 1px solid rgba(251, 146, 60, 0.3);
        border-radius: var(--radius-lg);
        padding: 1rem;
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        margin-bottom: 1rem;
      }

      .status-icon {
        background: var(--color-surface);
        width: 40px;
        height: 40px;
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        box-shadow: var(--shadow-sm);
      }

      .status-icon-waiting {
        color: var(--color-warning);
      }

      .status-content h3 {
        font-size: var(--fs-base);
        font-weight: var(--fw-semibold);
        color: var(--color-warning);
        margin-bottom: 0.125rem;
      }

      .status-description {
        color: var(--color-text-secondary);
        font-size: var(--fs-xs);
        line-height: 1.4;
      }

      .email-instructions {
        background: var(--color-background);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: 1rem;
        margin-bottom: 1rem;
      }

      .instructions-header {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        margin-bottom: 0.75rem;
      }

      .instructions-icon {
        color: var(--color-accent);
      }

      .instructions-title {
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
        font-size: var(--fs-xs);
      }

      .steps-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .step-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .step-number {
        width: 20px;
        height: 20px;
        background: var(--color-accent);
        color: var(--color-text-on-primary);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: var(--fs-xs);
        font-weight: var(--fw-bold);
        flex-shrink: 0;
      }

      .step-text {
        color: var(--color-text-secondary);
        font-size: var(--fs-xs);
        line-height: 1.3;
      }

      .email-actions {
        display: flex;
        gap: 0.75rem;
        margin-bottom: 1rem;
      }

      .action-button {
        flex: 1;
        min-width: 0;
      }

      .email-help {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.5rem;
        background: var(--color-accent-light);
        border: 1px solid rgba(6, 182, 212, 0.2);
        border-radius: var(--radius-md);
      }

      .help-icon {
        color: var(--color-accent);
        flex-shrink: 0;
      }

      .help-text {
        color: var(--color-text-secondary);
        font-size: var(--fs-xs);
        line-height: 1.3;
      }

      @media (max-width: 640px) {
        .email-actions {
          flex-direction: column;
        }
      }
    `,
  ],
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
            Enviamos un enlace de verificación a:<br />
            <span class="email-address">{{ userEmail }}</span>
          </p>

          <!-- Status Card -->
          <div class="email-status-card">
            <div class="status-icon">
              <app-icon
                name="clock"
                size="24"
                class="status-icon-waiting"
              ></app-icon>
            </div>
            <div class="status-content">
              <h3 class="status-title">Esperando verificación</h3>
              <p class="status-description">
                Revisa tu bandeja de entrada y haz clic en el enlace que te
                enviamos
              </p>
            </div>
          </div>

          <!-- Instructions -->
          <div class="email-instructions">
            <div class="instructions-header">
              <app-icon
                name="info"
                size="20"
                class="instructions-icon"
              ></app-icon>
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
              [disabled]="isResendingEmail"
              class="action-button"
            >
              <app-icon
                name="refresh-cw"
                [size]="18"
                [spin]="isResendingEmail"
                slot="icon"
              ></app-icon>
              {{ isResendingEmail ? 'Enviando...' : 'Reenviar correo' }}
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
              ¿No recibiste el email? Revisa tu carpeta de spam o correo no
              deseado
            </span>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class EmailVerificationStepComponent implements OnInit, OnDestroy {
  @Input() userEmail: string = '';
  @Output() nextStep = new EventEmitter<void>();
  @Output() skipStep = new EventEmitter<void>();
  @Output() previousStep = new EventEmitter<void>();

  private destroy$ = new Subject<void>();
  private pollingSubscription: any = null;
  private maxPollingAttempts = 60; // Max 5 minutes (60 * 5s)
  private currentPollingAttempt = 0;

  // State (public for parent component access)
  isEmailVerified = false;
  isCheckingStatus = true;
  isResendingEmail = false;
  verificationStatus: 'pending' | 'verified' | 'error' = 'pending';
  resendCooldown = 0;
  lastResendTime: number | null = null;

  // Colors for Vendix branding
  primaryColor = '#7ed7a5';
  secondaryColor = '#2f6f4e';

  constructor(
    private wizardService: OnboardingWizardService,
    private authFacade: AuthFacade,
  ) { }

  ngOnInit(): void {
    this.loadUserEmail();
    this.checkEmailVerification();
    this.startPolling();

    // Set up resend cooldown timer
    interval(1000) // Update cooldown every second
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.updateResendCooldown();
      });
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private startPolling(): void {
    // Stop any existing polling
    this.stopPolling();

    // Reset counter
    this.currentPollingAttempt = 0;

    // Poll every 5 seconds with a maximum limit
    this.pollingSubscription = interval(5000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.currentPollingAttempt++;

        // Stop polling if verified or max attempts reached
        if (
          this.isEmailVerified ||
          this.currentPollingAttempt >= this.maxPollingAttempts
        ) {
          this.stopPolling();
          return;
        }

        // Check verification status
        if (this.verificationStatus !== 'error') {
          this.checkEmailVerificationSilently();
        }
      });
  }

  private stopPolling(): void {
    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
      this.pollingSubscription = null;
    }
  }

  private loadUserEmail(): void {
    this.authFacade.user$
      .pipe(takeUntil(this.destroy$))
      .subscribe((user: any) => {
        if (user?.email) {
          this.userEmail = user.email;
        }
      });
  }

  private checkEmailVerification(): void {
    this.isCheckingStatus = true;
    this.wizardService.checkEmailVerification().subscribe({
      next: (response: any) => {
        this.isCheckingStatus = false;
        if (response.data?.verified) {
          this.isEmailVerified = true;
          this.verificationStatus = 'verified';
          this.stopPolling(); // Stop polling once verified
          // Auto-advance to next step
          setTimeout(() => {
            this.nextStep.emit();
          }, 500);
        } else {
          this.verificationStatus = response.data?.state || 'pending';
        }
      },
      error: (error: any) => {
        this.isCheckingStatus = false;
        this.verificationStatus = 'error';
        console.error('Error checking email verification:', error);
      },
    });
  }

  /**
   * Silent check without showing loading state (used during polling)
   */
  private checkEmailVerificationSilently(): void {
    this.wizardService.checkEmailVerification().subscribe({
      next: (response: any) => {
        if (response.data?.verified) {
          this.isEmailVerified = true;
          this.verificationStatus = 'verified';
          this.stopPolling(); // Stop polling once verified
          // Auto-advance to next step
          setTimeout(() => {
            this.nextStep.emit();
          }, 500);
        } else {
          this.verificationStatus = response.data?.state || 'pending';
        }
      },
      error: (error: any) => {
        this.verificationStatus = 'error';
        console.error('Error checking email verification:', error);
      },
    });
  }

  private updateResendCooldown(): void {
    if (this.lastResendTime) {
      const elapsed = Date.now() - this.lastResendTime;
      const remaining = Math.max(0, 60 - Math.floor(elapsed / 1000)); // 60 second cooldown
      this.resendCooldown = remaining;
    }
  }

  resendVerification(): void {
    if (this.resendCooldown > 0) {
      return; // Still in cooldown
    }

    this.isResendingEmail = true;
    this.lastResendTime = Date.now();

    this.wizardService.resendVerificationEmail().subscribe({
      next: (response: any) => {
        this.isResendingEmail = false;
        if (response.success) {
          console.log('Verification email resent successfully');
          // Optionally show success message
        }
      },
      error: (error: any) => {
        this.isResendingEmail = false;
        this.lastResendTime = null; // Reset cooldown on error
        console.error('Error resending verification email:', error);
        // Optionally show error message
      },
    });
  }

  checkVerification(): void {
    this.checkEmailVerification();
  }
}
