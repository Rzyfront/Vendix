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
import { IconComponent } from '../../index';
import { OnboardingWizardService } from '../../../../core/services/onboarding-wizard.service';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { Subject, takeUntil, interval } from 'rxjs';

@Component({
  selector: 'app-email-verification-step',
  standalone: true,
  imports: [CommonModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      /* ===== Mobile-First Design ===== */
      .email-step {
        padding: 0;
        width: 100%;
      }

      .email-container {
        width: 100%;
        max-width: 100%;
      }

      /* Icon Section - Elegant circles */
      .icon-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        margin-bottom: 1.5rem;
      }

      .email-icon-wrapper {
        position: relative;
        margin-bottom: 1.25rem;
      }

      .icon-outer-ring {
        width: 80px;
        height: 80px;
        background: rgba(var(--color-primary-rgb, 99, 211, 166), 0.1);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .icon-inner-circle {
        width: 56px;
        height: 56px;
        background: var(--color-surface);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      }

      .email-main-icon {
        color: var(--color-primary);
      }

      .email-title {
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--color-text-primary);
        margin-bottom: 0.5rem;
        line-height: 1.3;
      }

      .email-subtitle {
        font-size: 0.875rem;
        color: var(--color-text-secondary);
        margin-bottom: 0.25rem;
      }

      .email-badge {
        display: inline-block;
        background: var(--color-background);
        padding: 0.25rem 0.75rem;
        border-radius: 0.375rem;
      }

      .email-address {
        font-size: 0.875rem;
        font-family: 'SF Mono', 'Monaco', 'Roboto Mono', monospace;
        font-weight: 500;
        color: var(--color-text-primary);
        letter-spacing: -0.025em;
      }

      /* Status Card - Orange warning style */
      .status-card {
        background: rgba(251, 146, 60, 0.08);
        border: 1px solid rgba(251, 146, 60, 0.2);
        border-radius: 1rem;
        padding: 1rem;
        display: flex;
        align-items: flex-start;
        gap: 1rem;
        margin-bottom: 1.25rem;
      }

      .status-icon-wrapper {
        padding: 0.5rem;
        background: rgba(251, 146, 60, 0.15);
        border-radius: 50%;
        flex-shrink: 0;
      }

      .status-icon {
        color: #f97316;
      }

      .status-content h3 {
        font-size: 0.875rem;
        font-weight: 700;
        color: #ea580c;
        margin-bottom: 0.25rem;
      }

      .status-description {
        font-size: 0.8125rem;
        color: rgba(234, 88, 12, 0.85);
        line-height: 1.4;
      }

      /* Instructions Card */
      .instructions-card {
        background: var(--color-background);
        border-radius: 1rem;
        padding: 1.25rem;
        margin-bottom: 1.25rem;
      }

      .instructions-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 1rem;
      }

      .instructions-icon {
        color: var(--color-text-tertiary);
      }

      .instructions-title {
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--color-text-secondary);
      }

      .steps-list {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .step-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .step-dot-wrapper {
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 50%;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .step-dot {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 50%;
        background: var(--color-text-tertiary);
      }

      .step-text {
        font-size: 0.875rem;
        color: var(--color-text-secondary);
      }

      .step-highlight {
        font-weight: 600;
        color: var(--color-text-primary);
      }

      /* Action Buttons - Grid layout for mobile */
      .action-buttons {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.75rem;
        margin-bottom: 1.25rem;
      }

      .action-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 0.875rem 1rem;
        border-radius: 1rem;
        font-weight: 700;
        font-size: 0.8125rem;
        line-height: 1.3;
        text-align: center;
        cursor: pointer;
        transition: transform 0.1s ease, box-shadow 0.15s ease;
        border: none;
        min-height: 5rem;
      }

      .action-btn:active {
        transform: scale(0.97);
      }

      .action-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .action-btn-outline {
        background: transparent;
        border: 2px solid rgba(var(--color-primary-rgb, 99, 211, 166), 0.4);
        color: var(--color-primary);
      }

      .action-btn-outline:hover:not(:disabled) {
        background: rgba(var(--color-primary-rgb, 99, 211, 166), 0.05);
      }

      .action-btn-primary {
        background: var(--color-primary);
        color: white;
        box-shadow: 0 4px 12px rgba(var(--color-primary-rgb, 99, 211, 166), 0.25);
      }

      .action-btn-primary:hover:not(:disabled) {
        box-shadow: 0 6px 16px rgba(var(--color-primary-rgb, 99, 211, 166), 0.35);
      }

      .btn-icon {
        margin-bottom: 0.25rem;
      }

      .btn-text {
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .btn-text-line {
        display: block;
      }

      /* Help Card - Blue info style */
      .help-card {
        background: rgba(59, 130, 246, 0.06);
        border: 1px solid rgba(59, 130, 246, 0.15);
        border-radius: 0.75rem;
        padding: 0.75rem;
        display: flex;
        gap: 0.75rem;
        align-items: flex-start;
      }

      .help-icon {
        color: #3b82f6;
        flex-shrink: 0;
        margin-top: 0.125rem;
      }

      .help-text {
        font-size: 0.75rem;
        color: #2563eb;
        line-height: 1.5;
      }

      /* ===== Desktop Enhancements ===== */
      @media (min-width: 640px) {
        .email-step {
          padding: 1rem 0;
          display: flex;
          justify-content: center;
        }

        .email-container {
          max-width: 420px;
        }

        .icon-outer-ring {
          width: 88px;
          height: 88px;
        }

        .icon-inner-circle {
          width: 64px;
          height: 64px;
        }

        .email-title {
          font-size: 1.375rem;
        }

        .action-buttons {
          gap: 1rem;
        }

        .action-btn {
          padding: 1rem 1.25rem;
          font-size: 0.875rem;
        }
      }

      /* Loading spinner animation */
      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .spinning {
        animation: spin 1s linear infinite;
      }
    `,
  ],
  template: `
    <div class="email-step">
      <div class="email-container">
        <!-- Icon Section with elegant circles -->
        <div class="icon-section">
          <div class="email-icon-wrapper">
            <div class="icon-outer-ring">
              <div class="icon-inner-circle">
                <app-icon name="mail" size="28" class="email-main-icon"></app-icon>
              </div>
            </div>
          </div>

          <h2 class="email-title">Verifica tu correo electrónico</h2>
          <p class="email-subtitle">Enviamos un enlace de verificación a:</p>
          <div class="email-badge">
            <span class="email-address">{{ userEmail }}</span>
          </div>
        </div>

        <!-- Status Card - Warning style -->
        <div class="status-card">
          <div class="status-icon-wrapper">
            <app-icon name="clock" size="20" class="status-icon"></app-icon>
          </div>
          <div class="status-content">
            <h3>Esperando verificación</h3>
            <p class="status-description">
              Revisa tu bandeja de entrada y haz clic en el enlace que te enviamos
            </p>
          </div>
        </div>

        <!-- Instructions Card -->
        <div class="instructions-card">
          <div class="instructions-header">
            <app-icon name="info" size="18" class="instructions-icon"></app-icon>
            <span class="instructions-title">Pasos rápidos</span>
          </div>
          <div class="steps-list">
            <div class="step-item">
              <div class="step-dot-wrapper">
                <div class="step-dot"></div>
              </div>
              <span class="step-text">Abre tu bandeja de entrada</span>
            </div>
            <div class="step-item">
              <div class="step-dot-wrapper">
                <div class="step-dot"></div>
              </div>
              <span class="step-text">
                Busca el email de <span class="step-highlight">Vendix</span>
              </span>
            </div>
            <div class="step-item">
              <div class="step-dot-wrapper">
                <div class="step-dot"></div>
              </div>
              <span class="step-text">Haz clic en "Verificar email"</span>
            </div>
          </div>
        </div>

        <!-- Action Buttons - Mobile grid -->
        <div class="action-buttons">
          <button
            class="action-btn action-btn-outline"
            (click)="resendVerification()"
            [disabled]="isResendingEmail || resendCooldown > 0"
          >
            <app-icon
              [name]="isResendingEmail ? 'loader-2' : 'refresh-cw'"
              size="20"
              class="btn-icon"
              [class.spinning]="isResendingEmail"
            ></app-icon>
            <span class="btn-text">
              <span class="btn-text-line">Reenviar</span>
              <span class="btn-text-line">
                {{ resendCooldown > 0 ? '(' + resendCooldown + 's)' : 'correo' }}
              </span>
            </span>
          </button>

          <button
            class="action-btn action-btn-primary"
            (click)="checkVerification()"
            [disabled]="isCheckingStatus"
          >
            <app-icon
              [name]="isCheckingStatus ? 'loader-2' : 'check-circle'"
              size="20"
              class="btn-icon"
              [class.spinning]="isCheckingStatus"
            ></app-icon>
            <span class="btn-text">
              <span class="btn-text-line">Verifiqué mi</span>
              <span class="btn-text-line">email</span>
            </span>
          </button>
        </div>

        <!-- Help Card - Blue info style -->
        <div class="help-card">
          <app-icon name="help-circle" size="16" class="help-icon"></app-icon>
          <span class="help-text">
            ¿No recibiste el email? Revisa tu carpeta de spam o correo no deseado
          </span>
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
