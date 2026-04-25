import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SubscriptionFacade } from '../store/subscription';

/**
 * Backend error codes that map to a paywall modal variant.
 *
 * Aligned with the `vendix-error-handling` registry and the
 * `vendix-subscription-gate` skill. Add new codes here ONLY when the backend
 * emits a matching `VendixHttpException`.
 */
export type PaywallCode =
  | 'SUBSCRIPTION_004'
  | 'SUBSCRIPTION_005'
  | 'SUBSCRIPTION_006'
  | 'SUBSCRIPTION_008'
  | 'SUBSCRIPTION_009'
  | 'PLAN_001'
  | 'TRIAL_001';

export interface PaywallVariant {
  /** Modal title shown in the header. */
  title: string;
  /** Default body text used when the backend does not provide a `message`. */
  description: string;
  /** Primary CTA label. */
  ctaLabel: string;
  /** Route the primary CTA should navigate to. */
  ctaRoute: string;
}

export interface PaywallState {
  code: PaywallCode;
  variant: PaywallVariant;
  message?: string;
}

/**
 * Variant catalog. The interceptor passes one of these codes; everything else
 * is rendered by `<app-ai-paywall-modal>` from this configuration.
 */
const PAYWALL_VARIANTS: Record<PaywallCode, PaywallVariant> = {
  SUBSCRIPTION_004: {
    title: 'Sin suscripción activa',
    description: 'Tu tienda no tiene una suscripción activa. Elige un plan para continuar.',
    ctaLabel: 'Elegir plan',
    ctaRoute: '/admin/subscription/plans',
  },
  SUBSCRIPTION_005: {
    title: 'Plan no incluye esta función',
    description: 'Esta función no está disponible en tu plan actual.',
    ctaLabel: 'Mejorar plan',
    ctaRoute: '/admin/subscription/plans',
  },
  SUBSCRIPTION_006: {
    title: 'Cuota de IA agotada',
    description: 'Has alcanzado el límite de IA de tu plan. Mejora tu plan para seguir usando esta función.',
    ctaLabel: 'Mejorar plan',
    ctaRoute: '/admin/subscription/plans',
  },
  SUBSCRIPTION_008: {
    title: 'Suscripción suspendida',
    description: 'Tu suscripción está suspendida por falta de pago. Regulariza para continuar.',
    ctaLabel: 'Pagar ahora',
    ctaRoute: '/admin/subscription/payment',
  },
  SUBSCRIPTION_009: {
    title: 'Suscripción bloqueada',
    description: 'Tu suscripción ha sido bloqueada. Realiza el pago pendiente para reactivarla.',
    ctaLabel: 'Pagar ahora',
    ctaRoute: '/admin/subscription/payment',
  },
  TRIAL_001: {
    title: 'Trial finalizado',
    description: 'Tu periodo de prueba ha terminado. Elige un plan para continuar.',
    ctaLabel: 'Elegir plan',
    ctaRoute: '/admin/subscription/plans',
  },
  PLAN_001: {
    title: 'Plan no disponible',
    description: 'El plan solicitado no está disponible. Revisa el catálogo de planes.',
    ctaLabel: 'Ver planes',
    ctaRoute: '/admin/subscription/plans',
  },
};

/**
 * Central service that brokers feature access checks and the paywall modal.
 *
 * - `canUseAI` / `aiBlockReason`: derived signals consumed by `MenuFilterService`
 *   and other UI gating points.
 * - `openPaywall(code, message?)`: idempotent — opening twice while a modal is
 *   already on screen is a no-op (deduped via `isOpen` signal).
 * - `paywallState` / `isPaywallOpen`: read-only signals consumed by the global
 *   `<app-ai-paywall-modal>` mounted in each admin layout.
 */
@Injectable({ providedIn: 'root' })
export class SubscriptionAccessService {
  private facade = inject(SubscriptionFacade);
  private router = inject(Router);

  /** Tracks whether a paywall modal is currently displayed (dedupe). */
  private readonly isOpen = signal(false);
  private readonly state = signal<PaywallState | null>(null);

  /** Public read-only view of the current paywall state. */
  readonly paywallState: Signal<PaywallState | null> = this.state.asReadonly();
  readonly isPaywallOpen: Signal<boolean> = this.isOpen.asReadonly();

  canUseAI(featureKey: string): Signal<boolean> {
    return computed(() => {
      const matrix = this.facade.featureMatrix();
      const feature = matrix[featureKey];
      if (!feature?.enabled) return false;
      const status = this.facade.status();
      return ['active', 'trialing'].includes(status);
    });
  }

  aiBlockReason(featureKey: string): Signal<string | null> {
    return computed(() => {
      const matrix = this.facade.featureMatrix();
      const feature = matrix[featureKey];
      if (!feature) return 'Feature not available';
      if (!feature.enabled) return 'Not included in plan';
      return null;
    });
  }

  /**
   * Open the paywall modal for the given backend `error_code`.
   *
   * Deduplicated — if a modal is already open, additional calls are ignored.
   * Unknown codes fall back to a generic plan variant so the user always sees
   * actionable UI.
   */
  openPaywall(code: string, message?: string): void {
    if (this.isOpen()) {
      return;
    }
    const knownCode = (PAYWALL_VARIANTS as Record<string, PaywallVariant>)[code]
      ? (code as PaywallCode)
      : 'PLAN_001';
    this.state.set({
      code: knownCode,
      variant: PAYWALL_VARIANTS[knownCode],
      message,
    });
    this.isOpen.set(true);
  }

  /** Close the paywall without performing the CTA navigation. */
  closePaywall(): void {
    this.isOpen.set(false);
    this.state.set(null);
  }

  /** Trigger the variant CTA — navigate to the plan / payment route, then close. */
  triggerCta(): void {
    const current = this.state();
    if (current) {
      void this.router.navigateByUrl(current.variant.ctaRoute);
    }
    this.closePaywall();
  }

  /**
   * Legacy resolver kept for backwards compatibility. The previous Promise-
   * based flow has been replaced by signal-driven UI; this method now just
   * routes the action to the appropriate finish handler.
   */
  resolvePaywall(action: 'upgrade' | 'pay' | 'dismiss'): void {
    if (action === 'dismiss') {
      this.closePaywall();
      return;
    }
    this.triggerCta();
  }
}
