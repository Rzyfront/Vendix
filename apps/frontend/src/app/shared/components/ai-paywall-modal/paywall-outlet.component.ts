import { Component, computed, inject } from '@angular/core';
import { SubscriptionAccessService } from '../../../core/services/subscription-access.service';
import { AiPaywallModalComponent } from './ai-paywall-modal.component';

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
  imports: [AiPaywallModalComponent],
  template: `
    <app-ai-paywall-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onIsOpenChange($event)"
      [variantConfig]="variantConfig()"
      [messageOverride]="message()"
      (action)="onAction($event)"
    />
  `,
})
export class PaywallOutletComponent {
  private readonly access = inject(SubscriptionAccessService);

  readonly isOpen = this.access.isPaywallOpen;
  readonly state = this.access.paywallState;

  readonly variantConfig = computed(() => this.state()?.variant ?? null);
  readonly message = computed(() => this.state()?.message ?? null);

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
}
