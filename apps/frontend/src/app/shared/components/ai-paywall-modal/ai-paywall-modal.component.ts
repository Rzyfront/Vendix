import { Component, computed, input, model, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalComponent } from '../modal/modal.component';

/**
 * Legacy variant codes still consumed by older callers. New paywall flows
 * use the `variantConfig` input which carries an explicit `{title, ctaLabel,
 * ...}` object so the modal does not need to know about every backend
 * `error_code`.
 */
export type PaywallLegacyVariant = 'NOT_INCLUDED' | 'GRACE_HARD' | 'TRIAL_ENDED';

export interface PaywallVariantConfig {
  title: string;
  description: string;
  ctaLabel: string;
  ctaRoute?: string;
}

@Component({
  selector: 'app-ai-paywall-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent],
  template: `
    <app-modal [(isOpen)]="isOpen" [size]="'md'">
      <div slot="header">
        <h3 class="text-lg font-semibold">{{ resolvedTitle() }}</h3>
      </div>
      <div>
        <p>{{ resolvedDescription() }}</p>
      </div>
      <div slot="footer" class="flex gap-3 justify-end">
        <button (click)="dismiss()">{{ dismissText() }}</button>
        <button (click)="primaryAction()">{{ resolvedPrimaryText() }}</button>
      </div>
    </app-modal>
  `,
  styleUrl: './ai-paywall-modal.component.css',
})
export class AiPaywallModalComponent {
  /**
   * Legacy variant input — kept for callers that pre-date the
   * `error_code`-driven variant catalog. Prefer `variantConfig` in new code.
   */
  readonly variant = input<PaywallLegacyVariant>('NOT_INCLUDED');
  /**
   * New input. When provided, overrides `variant` and supplies title,
   * description, and CTA copy directly. Built by
   * `SubscriptionAccessService.openPaywall`.
   */
  readonly variantConfig = input<PaywallVariantConfig | null>(null);
  /** Optional override for the body copy (e.g. backend `message` field). */
  readonly messageOverride = input<string | null>(null);
  readonly featureName = input<string>('');
  readonly isOpen = model<boolean>(false);
  readonly action = output<'upgrade' | 'pay' | 'dismiss'>();
  readonly dismissText = input<string>('Cerrar');

  readonly resolvedTitle = computed(() => {
    const config = this.variantConfig();
    if (config) return config.title;
    switch (this.variant()) {
      case 'NOT_INCLUDED':
        return 'Función no disponible';
      case 'GRACE_HARD':
        return 'Suscripción en gracia';
      case 'TRIAL_ENDED':
        return 'Prueba finalizada';
      default:
        return 'Función no disponible';
    }
  });

  readonly resolvedDescription = computed(() => {
    const override = this.messageOverride();
    if (override) return override;
    const config = this.variantConfig();
    if (config) return config.description;
    switch (this.variant()) {
      case 'NOT_INCLUDED':
        return 'Esta función no está incluida en tu plan actual.';
      case 'GRACE_HARD':
        return 'Tu suscripción está en período de gracia. Regulariza tu pago para continuar.';
      case 'TRIAL_ENDED':
        return 'Tu periodo de prueba ha terminado. Elige un plan para continuar usando IA.';
      default:
        return 'Necesitas un plan activo para usar esta función.';
    }
  });

  readonly resolvedPrimaryText = computed(() => {
    const config = this.variantConfig();
    if (config) return config.ctaLabel;
    switch (this.variant()) {
      case 'NOT_INCLUDED':
        return 'Mejorar Plan';
      case 'GRACE_HARD':
        return 'Pagar Ahora';
      case 'TRIAL_ENDED':
        return 'Ver Planes';
      default:
        return 'Ver Planes';
    }
  });

  primaryAction(): void {
    // Legacy 'pay' channel is preserved for GRACE_HARD; the new flow always
    // emits 'upgrade' and lets the service decide the destination.
    if (!this.variantConfig() && this.variant() === 'GRACE_HARD') {
      this.action.emit('pay');
    } else {
      this.action.emit('upgrade');
    }
    this.isOpen.set(false);
  }

  dismiss(): void {
    this.action.emit('dismiss');
    this.isOpen.set(false);
  }
}
