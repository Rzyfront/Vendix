import { Component, computed, inject, signal } from '@angular/core';
import { SubscriptionAccessService } from '../../../core/services/subscription-access.service';
import { AiPaywallModalComponent } from './ai-paywall-modal.component';
import { SupportRequestModalComponent } from '../../../private/modules/store/subscription/components/support-request-modal/support-request-modal.component';
import { ToastService } from '../toast/toast.service';

/**
 * RNC-24 — Backend dunning codes that should expose the "Contactar soporte"
 * secondary action in the paywall modal. When the customer is suspended /
 * blocked / past_due they often need human help (rejected gateway, tarjeta
 * reportada robada, datos contables erróneos, etc.).
 */
const DUNNING_PAYWALL_CODES = new Set<string>([
  'SUBSCRIPTION_003',
  'SUBSCRIPTION_007',
  'SUBSCRIPTION_008',
  'SUBSCRIPTION_009',
  // State-driven variants (no HTTP error) that still benefit from a direct
  // support shortcut — the user is in a hard-block state and needs human
  // help to recover access (RNC-24).
  'STATE_GRACE_SOFT',
  'STATE_GRACE_HARD',
  'STATE_SUSPENDED',
  'STATE_BLOCKED',
  'STATE_PENDING_PAYMENT',
  // NOTE: `SUBSCRIPTION_011` (plan retired from the catalog) is deliberately
  // NOT in this set. It is a hard block like 008/009, but it is not a dunning
  // case: the store owes nothing, so the payment-oriented support shortcut
  // (rejected gateway, stolen card, wrong accounting data) would frame it as a
  // billing problem. Its recovery is self-service — pick an active plan.
]);

/**
 * Codes whose body copy MUST come from the local variant catalog, ignoring the
 * backend `message`.
 *
 * The backend `message` is the `devMessage` from `error-codes.ts`. For
 * `SUBSCRIPTION_011` that is English developer copy ("Plan retired — choose an
 * active plan to continue"): rendering it would both leak dev text to the
 * merchant and drop the Spanish explanation that tells them what actually
 * happened and what to do. `<app-ai-paywall-modal>` gives `messageOverride`
 * precedence over `variantConfig.description`, so the override is withheld
 * here to let the truthful catalog copy win.
 */
const LOCALIZED_COPY_ONLY_CODES = new Set<string>(['SUBSCRIPTION_011']);

/**
 * Global paywall outlet. Mounts a single `<app-ai-paywall-modal>` in each
 * private layout (store-admin, organization-admin, super-admin) and binds
 * its visibility to `SubscriptionAccessService`.
 *
 * The outlet keeps the layouts decoupled from the modal: any service-driven
 * paywall trigger (e.g. the `subscriptionPaywallInterceptor`) flows through
 * the access service and surfaces here automatically.
 */
@Component({
  selector: 'app-paywall-outlet',
  standalone: true,
  imports: [AiPaywallModalComponent, SupportRequestModalComponent],
  template: `
    <app-ai-paywall-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onIsOpenChange($event)"
      [variantConfig]="variantConfig()"
      [messageOverride]="message()"
      [extraActionLabel]="extraActionLabel()"
      (action)="onAction($event)"
      (extraAction)="openSupport()"
    />

    <app-support-request-modal
      [(isOpen)]="supportModalOpen"
      (submitted)="onSupportSubmitted($event)"
    ></app-support-request-modal>
  `,
})
export class PaywallOutletComponent {
  private readonly access = inject(SubscriptionAccessService);
  private readonly toast = inject(ToastService);

  readonly isOpen = this.access.isPaywallOpen;
  readonly state = this.access.paywallState;

  readonly variantConfig = computed(() => this.state()?.variant ?? null);

  readonly message = computed(() => {
    const current = this.state();
    if (!current) return null;
    if (LOCALIZED_COPY_ONLY_CODES.has(current.code as string)) return null;
    return current.message ?? null;
  });

  // RNC-24 — Show the support shortcut whenever the paywall is in a dunning
  // mode (block=critical from suspended/blocked/past_due).
  readonly showSupportShortcut = computed(() => {
    const code = this.state()?.code;
    return !!code && DUNNING_PAYWALL_CODES.has(code as string);
  });

  readonly extraActionLabel = computed(() =>
    this.showSupportShortcut() ? 'Contactar soporte' : '',
  );

  readonly supportModalOpen = signal(false);

  onAction(action: 'upgrade' | 'pay' | 'dismiss'): void {
    if (action === 'dismiss') {
      this.access.closePaywall();
    } else {
      this.access.triggerCta();
    }
  }

  onIsOpenChange(open: boolean): void {
    if (!open) {
      this.access.closePaywall();
    }
  }

  openSupport(): void {
    // Close the paywall modal first to avoid stacking issues.
    this.access.closePaywall();
    this.supportModalOpen.set(true);
  }

  onSupportSubmitted(_payload: { ticketId: number }): void {
    this.toast.info(
      'Tu solicitud fue enviada al equipo de soporte. Te contactaremos pronto.',
    );
  }
}
