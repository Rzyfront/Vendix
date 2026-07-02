import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { OnboardingModalComponent } from '../../../shared/components/onboarding-modal';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AuthFacade } from '../../../core/store/auth/auth.facade';

/**
 * Dedicated full-screen host for the owner onboarding wizard.
 *
 * Route: `/admin/onboarding` (child of the private `admin` shell in both the
 * org and store admin route trees). Reached only when `onboardingGuard`
 * decides an OWNER still has `organizations.onboarding !== true`.
 *
 * This host owns no business logic: it renders the reusable
 * `OnboardingModalComponent` non-cancelable and always open. The wizard's
 * `completeWizard()` already performs the environment switch and navigation,
 * so this component only refreshes the current user on completion and keeps a
 * defensive navigation fallback.
 *
 * Because the host is a top-most overlay (`--z-modal-overlay`), it deliberately
 * covers the app chrome — including the sidebar/header logout control. To avoid
 * trapping the owner, it surfaces its own "Cerrar sesión" affordance. Logging
 * out is NOT an onboarding bypass: `onboardingGuard` re-forces the wizard on the
 * next login, and the wizard resumes from the backend-persisted step.
 */
@Component({
  selector: 'app-onboarding-page',
  standalone: true,
  imports: [OnboardingModalComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="onboarding-page-host">
      <app-onboarding-modal
        [isOpen]="true"
        (completed)="onCompleted()"
      ></app-onboarding-modal>

      <!-- Escape hatch: the full-screen overlay hides the chrome's logout on
           purpose, but the owner must never be trapped. Re-login returns here
           (guard re-forces onboarding), so this is not a bypass. -->
      <button type="button" class="onboarding-logout" (click)="onLogout()">
        <app-icon name="logout" size="16"></app-icon>
        <span>Cerrar sesión</span>
      </button>
    </div>
  `,
  styles: [
    `
      .onboarding-page-host {
        position: fixed;
        inset: 0;
        /* Top-most "cover everything" tier (above sidebar 30, header 35,
         * modals 50, toasts 70, mobile sidebar 55). \`position: fixed\` creates
         * its own stacking context, so without an explicit high z-index the
         * chrome (which sets its own z-index) would paint over this host and
         * the owner could still see/click the shell behind the wizard. This
         * makes the onboarding a real full-screen, unavoidable overlay. */
        z-index: var(--z-modal-overlay);
        overflow-y: auto;
        background-color: var(--background);
      }

      .onboarding-logout {
        position: fixed;
        top: 1rem;
        right: 1rem;
        /* Above the wizard modal, which renders at z-[9999] inside this host's
         * stacking context, so the logout affordance stays clickable. */
        z-index: calc(var(--z-modal-overlay) + 1);
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.5rem 0.75rem;
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--color-text-secondary);
        background-color: var(--color-surface, var(--background));
        border: 1px solid var(--color-border, rgba(0, 0, 0, 0.1));
        border-radius: 0.5rem;
        cursor: pointer;
        transition:
          color 0.15s ease,
          border-color 0.15s ease;
      }

      .onboarding-logout:hover {
        color: var(--color-text);
        border-color: var(--color-primary);
      }
    `,
  ],
})
export class OnboardingPageComponent {
  private readonly auth = inject(AuthFacade);
  private readonly router = inject(Router);

  onCompleted(): void {
    // Refresh /auth/me so `organizations.onboarding` reflects the completed
    // state for the guard. The modal already handles the env-switch +
    // navigation, so we do NOT duplicate aggressive navigation here.
    this.auth.refreshUser();

    // Defensive fallback only: if the env-switch failed to move us, don't
    // strand the owner on the onboarding page.
    if (this.router.url.includes('/admin/onboarding')) {
      this.router.navigateByUrl('/admin/dashboard');
    }
  }

  onLogout(): void {
    // Clean, explicit logout (toast + session teardown + redirect handled by
    // SessionService). Re-login re-triggers `onboardingGuard`, which brings the
    // owner straight back to the wizard resumed at the persisted step.
    this.auth.logout();
  }
}
