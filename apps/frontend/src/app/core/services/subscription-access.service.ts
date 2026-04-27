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

/**
 * Visual severity drives gradient, badge color and animation on
 * `<app-ai-paywall-modal>`. Decoupled from the backend code so the same
 * severity can be reused across different `PaywallCode`s.
 */
export type PaywallSeverity = 'critical' | 'warning' | 'info' | 'upsell';

/**
 * Functional grouping of the variants — used to decide layout details such
 * as whether the benefits list is shown or what the default icon is.
 */
export type PaywallCategory =
  | 'upgrade'
  | 'feature-locked'
  | 'quota-exhausted'
  | 'payment-due'
  | 'trial-ended';

export interface PaywallVariant {
  /** Modal title shown in the header. */
  title: string;
  /** Default body text used when the backend does not provide a `message`. */
  description: string;
  /** Primary CTA label. */
  ctaLabel: string;
  /** Route the primary CTA should navigate to. */
  ctaRoute: string;
  /** Visual tone of the modal — controls colors, badge, and animations. */
  severity?: PaywallSeverity;
  /** Functional grouping — decides icon fallback and benefits visibility. */
  category?: PaywallCategory;
  /** Lucide icon name shown in the hero zone (overrides category default). */
  iconName?: string;
  /** Short label for the floating badge above the title (e.g. "Pago pendiente"). */
  badgeLabel?: string;
  /** Optional 3-4 short bullets reinforcing the upgrade value proposition. */
  benefits?: string[];
  /** Optional helper line under the description (e.g. "Recomendado: Plan Pro"). */
  recommendedPlanHint?: string;
  /** Override for the secondary CTA label (defaults to "Cerrar"). */
  secondaryCtaLabel?: string;
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
    title: 'Activa tu suscripción',
    description: 'Tu tienda aún no tiene un plan activo. Elige uno y desbloquea todo el potencial de Vendix.',
    ctaLabel: 'Elegir plan',
    ctaRoute: '/admin/subscription/plans',
    severity: 'upsell',
    category: 'upgrade',
    iconName: 'crown',
    badgeLabel: 'Mejora tu plan',
    benefits: [
      'Inventario, ventas y POS sin límites',
      'IA integrada para automatizar tareas',
      'Soporte prioritario y onboarding guiado',
    ],
  },
  SUBSCRIPTION_005: {
    title: 'Función incluida en planes superiores',
    description: 'Esta función no está disponible en tu plan actual. Mejóralo para acceder a más herramientas.',
    ctaLabel: 'Mejorar plan',
    ctaRoute: '/admin/subscription/plans',
    severity: 'info',
    category: 'feature-locked',
    iconName: 'lock',
    badgeLabel: 'Función bloqueada',
    benefits: [
      'Acceso completo a esta y otras funciones',
      'Más usuarios, almacenes y reportes',
      'Sin sobreprecios sorpresa',
    ],
  },
  SUBSCRIPTION_006: {
    title: 'Cuota de IA agotada',
    description: 'Has alcanzado el límite de IA de tu plan en este periodo. Mejora tu plan para seguir disfrutando.',
    ctaLabel: 'Ampliar mi plan',
    ctaRoute: '/admin/subscription/plans',
    severity: 'warning',
    category: 'quota-exhausted',
    iconName: 'zap',
    badgeLabel: 'Cuota agotada',
  },
  SUBSCRIPTION_008: {
    title: 'Suscripción suspendida',
    description: 'Tu suscripción está suspendida por un pago pendiente. Regulariza ahora para retomar tu actividad sin perder datos.',
    ctaLabel: 'Pagar ahora',
    ctaRoute: '/admin/subscription/payment',
    severity: 'critical',
    category: 'payment-due',
    iconName: 'alert-octagon',
    badgeLabel: 'Pago pendiente',
    secondaryCtaLabel: 'Recordarme luego',
  },
  SUBSCRIPTION_009: {
    title: 'Suscripción bloqueada',
    description: 'Tu suscripción ha sido bloqueada por falta de pago. Realiza el pago pendiente para reactivarla de inmediato.',
    ctaLabel: 'Pagar ahora',
    ctaRoute: '/admin/subscription/payment',
    severity: 'critical',
    category: 'payment-due',
    iconName: 'pause-circle',
    badgeLabel: 'Acceso bloqueado',
    secondaryCtaLabel: 'Recordarme luego',
  },
  TRIAL_001: {
    title: 'Tu trial ha terminado',
    description: 'Esperamos que hayas disfrutado tu periodo de prueba. Elige un plan para seguir creciendo con Vendix.',
    ctaLabel: 'Elegir mi plan',
    ctaRoute: '/admin/subscription/plans',
    severity: 'upsell',
    category: 'trial-ended',
    iconName: 'sparkles',
    badgeLabel: 'Trial finalizado',
    benefits: [
      'Mantén tus datos, configuración y catálogo',
      'Plan flexible: cambia o cancela cuando quieras',
      'Atención humana para acompañarte',
    ],
  },
  PLAN_001: {
    title: 'Explora nuestros planes',
    description: 'Revisa el catálogo y elige el plan que mejor se adapte a tu negocio.',
    ctaLabel: 'Ver planes',
    ctaRoute: '/admin/subscription/plans',
    severity: 'upsell',
    category: 'upgrade',
    iconName: 'crown',
    badgeLabel: 'Mejora tu plan',
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
