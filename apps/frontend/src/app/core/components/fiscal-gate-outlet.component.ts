import { Component, computed, inject } from '@angular/core';
import { AiPaywallModalComponent } from '../../shared/components/ai-paywall-modal/ai-paywall-modal.component';
import { FiscalGateService } from '../services/fiscal-gate.service';

/**
 * F4 — Outlet global del gate "no responsable de IVA".
 *
 * Clon del molde `PaywallOutletComponent`: monta un único
 * `<app-ai-paywall-modal>` en cada layout privado (store-admin,
 * organization-admin, super-admin) y enlaza su visibilidad a
 * `FiscalGateService`. Reutiliza el modal `variantConfig`-driven del paywall
 * para no duplicar chrome.
 *
 * Cualquier disparo del gate (form de producto o `fiscalGateInterceptor`)
 * fluye por el servicio y aparece aquí automáticamente.
 */
@Component({
  selector: 'app-fiscal-gate-outlet',
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
export class FiscalGateOutletComponent {
  private readonly gate = inject(FiscalGateService);

  readonly isOpen = this.gate.isFiscalGateOpen;
  readonly state = this.gate.fiscalGateState;

  readonly variantConfig = computed(() => this.state()?.variant ?? null);
  readonly message = computed(() => this.state()?.message ?? null);

  onAction(action: 'upgrade' | 'pay' | 'dismiss'): void {
    if (action === 'dismiss') {
      this.gate.closeGate();
    } else {
      this.gate.triggerCta();
    }
  }

  onIsOpenChange(open: boolean): void {
    if (!open) {
      this.gate.closeGate();
    }
  }
}
