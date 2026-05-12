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
  | 'SUBSCRIPTION_002_PENDING'
  | 'SUBSCRIPTION_002_NO_RECORD'
  | 'SUBSCRIPTION_003'
  | 'SUBSCRIPTION_004'
  | 'SUBSCRIPTION_005'
  | 'SUBSCRIPTION_006'
  | 'SUBSCRIPTION_007'
  | 'SUBSCRIPTION_008'
  | 'SUBSCRIPTION_009'
  | 'PLAN_001'
  | 'TRIAL_001'
  // Synthetic variants driven by the local subscription state (not by an
  // HTTP error). Used by `openPaywallForState()` so the panel can display
  // the same modal at-rest, before the user has triggered a blocked write.
  | 'STATE_NO_PLAN'
  | 'STATE_PENDING_PAYMENT'
  | 'STATE_GRACE_SOFT'
  | 'STATE_GRACE_HARD'
  | 'STATE_SUSPENDED'
  | 'STATE_BLOCKED'
  | 'STATE_CANCELLED'
  | 'STATE_EXPIRED'
  | 'STATE_PAYMENT_SUCCEEDED';

/**
 * Subscription states that, when surfaced inside the panel (e.g. on entering
 * `/admin/subscription`), should automatically open an informational paywall
 * modal. Maps 1:1 to a STATE_* variant in the catalog.
 */
export const STATE_PAYWALL_MAP: Record<string, PaywallCode> = {
  no_plan: 'STATE_NO_PLAN',
  pending_payment: 'STATE_PENDING_PAYMENT',
  grace_soft: 'STATE_GRACE_SOFT',
  grace_hard: 'STATE_GRACE_HARD',
  suspended: 'STATE_SUSPENDED',
  blocked: 'STATE_BLOCKED',
  cancelled: 'STATE_CANCELLED',
  canceled: 'STATE_CANCELLED',
  expired: 'STATE_EXPIRED',
};

/**
 * Optional payload that the backend appends to subscription gate exceptions
 * via the `details` field. Used to derive synthetic variant keys (e.g. split
 * `SUBSCRIPTION_002` into PENDING vs NO_RECORD) and to resolve dynamic CTA
 * routes (e.g. resume a pending checkout for a specific plan).
 */
export interface PaywallDetails {
  subscription_state?: string;
  plan_id?: number | null;
  has_record?: boolean;
  /** Optional administrative reason supplied by super-admin lock workflows. */
  lock_reason?: string | null;
  /** Optional ISO date when the grace period ends. */
  grace_period_end?: string | null;
  /** Optional human-readable plan name for inline interpolation. */
  plan_name?: string | null;
}

/**
 * Visual severity drives gradient, badge color and animation on
 * `<app-ai-paywall-modal>`. Decoupled from the backend code so the same
 * severity can be reused across different `PaywallCode`s.
 */
export type PaywallSeverity = 'critical' | 'warning' | 'info' | 'upsell' | 'success';

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
  /**
   * Optional resolver invoked when the CTA route depends on runtime details
   * (e.g. resuming a pending checkout for a specific plan id). When provided,
   * takes precedence over the static `ctaRoute`.
   */
  ctaRouteResolver?: (details: PaywallDetails) => string;
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
  details?: PaywallDetails;
}

/**
 * Variant catalog. The interceptor passes one of these codes; everything else
 * is rendered by `<app-ai-paywall-modal>` from this configuration.
 */
const PAYWALL_VARIANTS: Record<PaywallCode, PaywallVariant> = {
  SUBSCRIPTION_002_PENDING: {
    title: 'Tu suscripción está pendiente de pago',
    description:
      'Iniciaste el checkout pero el pago no se completó. Retoma desde donde lo dejaste para activar tu plan.',
    ctaLabel: 'Retomar pago',
    ctaRoute: '/admin/subscription/plans',
    ctaRouteResolver: (details) =>
      details?.plan_id != null
        ? `/admin/subscription/checkout/${details.plan_id}`
        : '/admin/subscription/plans',
    severity: 'warning',
    category: 'payment-due',
    iconName: 'credit-card',
    badgeLabel: 'Pago pendiente',
    benefits: [
      'Tu carrito de plan sigue guardado',
      'Activación inmediata al confirmar pago',
    ],
    secondaryCtaLabel: 'Recordarme luego',
  },
  SUBSCRIPTION_002_NO_RECORD: {
    title: 'Activa Vendix para empezar',
    description:
      'Para crear productos y operar tu tienda, elige el plan que mejor se ajuste a tu negocio.',
    ctaLabel: 'Ver planes',
    ctaRoute: '/admin/subscription/plans',
    severity: 'upsell',
    category: 'upgrade',
    iconName: 'crown',
    badgeLabel: 'Activa tu plan',
    benefits: [
      'Prueba gratis disponible',
      'Cancela cuando quieras',
    ],
  },
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
    // Canonical recovery path: dunning-board exposes "Pagar ahora" which mints
    // a fresh Wompi widget via retry-payment and auto-registers the PM on
    // approval. The /payment page is only for managing already-saved methods.
    ctaRoute: '/admin/subscription/dunning',
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
    // Same as SUBSCRIPTION_008 — recover via dunning-board widget flow.
    ctaRoute: '/admin/subscription/dunning',
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
  // ── SUBSCRIPTION_003 — cancelled / expired (read-only retention) ──────────
  SUBSCRIPTION_003: {
    title: 'Tu suscripción finalizó',
    description:
      'Tu plan ya no está activo. Puedes consultar y exportar tus datos en modo lectura. Para volver a operar, reactiva con un plan nuevo.',
    ctaLabel: 'Reactivar suscripción',
    ctaRoute: '/admin/subscription/plans',
    severity: 'critical',
    category: 'trial-ended',
    iconName: 'alert-octagon',
    badgeLabel: 'Acceso limitado',
    secondaryCtaLabel: 'Continuar en lectura',
  },
  // ── SUBSCRIPTION_007 — past_due / grace banner (informational) ───────────
  SUBSCRIPTION_007: {
    title: 'Pago pendiente',
    description:
      'Tu última factura quedó sin pagar. Regulariza pronto para evitar restricciones de acceso.',
    ctaLabel: 'Pagar ahora',
    ctaRoute: '/admin/subscription/dunning',
    severity: 'warning',
    category: 'payment-due',
    iconName: 'credit-card',
    badgeLabel: 'Pago pendiente',
    secondaryCtaLabel: 'Recordarme luego',
  },
  // ── State-driven variants — opened from `openPaywallForState(state)` ────
  STATE_NO_PLAN: {
    title: 'Selecciona un plan',
    description:
      'Tu organización ya consumió el período de prueba. Para activar esta tienda, elige uno de nuestros planes.',
    ctaLabel: 'Ver planes',
    ctaRoute: '/admin/subscription/picker',
    severity: 'upsell',
    category: 'upgrade',
    iconName: 'sparkles',
    badgeLabel: 'Activa tu tienda',
    benefits: [
      'Inventario, ventas y POS sin límites',
      'IA integrada para automatizar tareas',
      'Cancela cuando quieras',
    ],
    secondaryCtaLabel: 'Cerrar',
  },
  STATE_PENDING_PAYMENT: {
    title: 'Confirmando tu pago',
    description:
      'Estamos esperando la confirmación de tu pago. Si ya pagaste, puede tardar unos segundos. Si no, retoma el cobro.',
    ctaLabel: 'Reintentar pago',
    ctaRoute: '/admin/subscription',
    severity: 'warning',
    category: 'payment-due',
    iconName: 'credit-card',
    badgeLabel: 'Pago en proceso',
    secondaryCtaLabel: 'Cerrar',
  },
  STATE_GRACE_SOFT: {
    title: 'Pago pendiente',
    description:
      'Tu última factura quedó sin pagar. Tienes algunos días para regularizar antes de que se restrinja el acceso a tu tienda.',
    ctaLabel: 'Pagar ahora',
    ctaRoute: '/admin/subscription/dunning',
    severity: 'warning',
    category: 'payment-due',
    iconName: 'alert-triangle',
    badgeLabel: 'Pago pendiente',
    secondaryCtaLabel: 'Recordarme luego',
  },
  STATE_GRACE_HARD: {
    title: 'Acceso restringido',
    description:
      'Tu factura sigue sin pagar y algunas funciones están limitadas. Regulariza pronto para evitar la suspensión completa.',
    ctaLabel: 'Pagar ahora',
    ctaRoute: '/admin/subscription/dunning',
    severity: 'critical',
    category: 'payment-due',
    iconName: 'alert-octagon',
    badgeLabel: 'Acceso limitado',
    secondaryCtaLabel: 'Recordarme luego',
  },
  STATE_SUSPENDED: {
    title: 'Tienda suspendida',
    description:
      'Tu tienda fue suspendida por falta de pago. Para restaurar el acceso, paga la factura pendiente o contacta a soporte.',
    ctaLabel: 'Pagar ahora',
    ctaRoute: '/admin/subscription/dunning',
    severity: 'critical',
    category: 'payment-due',
    iconName: 'pause-circle',
    badgeLabel: 'Suspendida',
    secondaryCtaLabel: 'Recordarme luego',
  },
  STATE_BLOCKED: {
    title: 'Acceso bloqueado',
    description:
      'Tu tienda fue bloqueada manualmente por nuestro equipo. Contacta a soporte para más información y restablecer el acceso.',
    ctaLabel: 'Contactar soporte',
    ctaRoute: '/admin/subscription/dunning',
    severity: 'critical',
    category: 'payment-due',
    iconName: 'shield-alert',
    badgeLabel: 'Bloqueada',
    secondaryCtaLabel: 'Cerrar',
  },
  STATE_CANCELLED: {
    title: 'Suscripción cancelada',
    description:
      'Tu suscripción fue cancelada. Puedes seguir consultando y exportando tus datos en modo lectura. Para volver a operar, reactiva con un plan.',
    ctaLabel: 'Reactivar suscripción',
    ctaRoute: '/admin/subscription/plans',
    severity: 'critical',
    category: 'trial-ended',
    iconName: 'x-circle',
    badgeLabel: 'Cancelada',
    secondaryCtaLabel: 'Continuar en lectura',
  },
  STATE_EXPIRED: {
    title: 'Tu plan expiró',
    description:
      'El período de tu plan terminó sin renovación. Reactiva tu tienda eligiendo un plan para continuar operando.',
    ctaLabel: 'Ver planes',
    ctaRoute: '/admin/subscription/plans',
    severity: 'critical',
    category: 'trial-ended',
    iconName: 'clock',
    badgeLabel: 'Plan expirado',
    secondaryCtaLabel: 'Cerrar',
  },
  // ── Payment confirmation success — celebratory transitional state ─────────
  // Auto-dismiss microinteraction shown briefly when polling detects the
  // subscription has transitioned from `pending_payment` to `active`. Both
  // CTAs are hidden by the modal template (see `showPrimaryCta()` /
  // `showSecondaryCta()`); the host schedules a `closePaywall()` after ~2.5s.
  STATE_PAYMENT_SUCCEEDED: {
    title: '¡Bienvenido a {planName}!',
    description: 'Tu plan está activo. Disfruta todas las funciones.',
    ctaLabel: '',
    ctaRoute: '/admin/subscription',
    severity: 'success',
    category: 'upgrade',
    iconName: 'check-circle',
    badgeLabel: 'Pago confirmado',
    secondaryCtaLabel: '',
  },
};

/**
 * Central service that brokers feature access checks and the paywall modal.
 *
 * - `canUseAI` / `aiBlockReason`: derived signals consumed by `MenuFilterService`
 *   and other UI gating points.
 * - `openPaywall(code, message?, details?)`: idempotent — opening twice while a modal is
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
   *
   * `details` is the optional payload that the backend appends to subscription
   * gate exceptions; it lets the service derive a synthetic variant key for
   * codes that have multiple visual flavors (e.g. `SUBSCRIPTION_002` splits
   * into PENDING vs NO_RECORD based on `subscription_state` / `has_record`).
   */
  openPaywall(code: string, message?: string, details?: PaywallDetails): void {
    if (this.isOpen()) {
      return;
    }

    // Derive a synthetic variant key only for codes that have multiple
    // visual flavors. Today only SUBSCRIPTION_002 splits — other codes pass
    // through untouched.
    let variantKey: string = code;
    if (code === 'SUBSCRIPTION_002') {
      variantKey =
        details?.subscription_state === 'pending_payment'
          ? 'SUBSCRIPTION_002_PENDING'
          : 'SUBSCRIPTION_002_NO_RECORD';
    }

    const knownCode = (PAYWALL_VARIANTS as Record<string, PaywallVariant>)[variantKey]
      ? (variantKey as PaywallCode)
      : 'PLAN_001';
    const baseVariant = PAYWALL_VARIANTS[knownCode];
    this.state.set({
      code: knownCode,
      variant: this.interpolateVariant(baseVariant, details),
      message,
      details,
    });
    this.isOpen.set(true);
  }

  /**
   * Open the paywall modal informationally, driven by the local subscription
   * state (e.g. on entering `/admin/subscription` while in `no_plan` /
   * `suspended` / `cancelled`). Bypasses HTTP error codes and uses the
   * `STATE_*` variant catalog.
   *
   * Returns silently when the state has no associated variant (active /
   * trial) — the panel renders normally with no modal on top.
   *
   * Deduped via `isOpen` so multiple effect runs do not stack modals.
   */
  openPaywallForState(state: string | null | undefined, details?: PaywallDetails): void {
    if (!state) return;
    const variantKey = STATE_PAYWALL_MAP[state];
    if (!variantKey) return;
    if (this.isOpen()) return;

    const baseVariant = PAYWALL_VARIANTS[variantKey];
    const enrichedDetails: PaywallDetails = {
      subscription_state: state,
      ...(details ?? {}),
    };
    this.state.set({
      code: variantKey,
      variant: this.interpolateVariant(baseVariant, enrichedDetails),
      details: enrichedDetails,
    });
    this.isOpen.set(true);
  }

  /**
   * Open the celebratory payment-success microinteraction. Used by the
   * subscription panel right after polling detects a `pending_payment →
   * active` transition. The host is responsible for scheduling the
   * auto-dismiss (typically ~2.5s) — this method only sets the variant.
   *
   * Bypasses the `isOpen` dedupe so the success state can replace any
   * previously open paywall (e.g. the warning shown while waiting).
   */
  openPaywallForPaymentSuccess(planName: string | null | undefined): void {
    const safeName = (planName ?? '').toString().trim() || 'tu plan';
    const baseVariant = PAYWALL_VARIANTS.STATE_PAYMENT_SUCCEEDED;
    const variant: PaywallVariant = {
      ...baseVariant,
      title: baseVariant.title.replace('{planName}', safeName),
    };
    this.state.set({
      code: 'STATE_PAYMENT_SUCCEEDED',
      variant,
      details: { plan_name: safeName },
    });
    this.isOpen.set(true);
  }

  /**
   * Inject runtime details (lock_reason, grace_period_end, plan_name) into
   * the variant copy so messages are concrete instead of generic. Returns a
   * new object — never mutates the catalog entry.
   */
  private interpolateVariant(
    base: PaywallVariant,
    details?: PaywallDetails,
  ): PaywallVariant {
    if (!details) return base;
    const lock = (details.lock_reason ?? '').toString().trim();
    if (!lock) return base;
    return {
      ...base,
      description: `${base.description} Motivo: ${lock}.`,
    };
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
      const route = current.variant.ctaRouteResolver
        ? current.variant.ctaRouteResolver(current.details ?? {})
        : current.variant.ctaRoute;
      void this.router.navigateByUrl(route);
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
