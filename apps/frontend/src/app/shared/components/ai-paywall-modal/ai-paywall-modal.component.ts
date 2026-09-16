import { Component, computed, inject, input, model, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalComponent } from '../modal/modal.component';
import { IconComponent } from '../icon/icon.component';
import { ButtonComponent } from '../button/button.component';
import { BadgeComponent, BadgeVariant } from '../badge/badge.component';
import {
  AI_FEATURE_LABELS,
  PaywallCategory,
  PaywallSeverity,
  PaywallVariant,
  SubscriptionAccessService,
} from '../../../core/services/subscription-access.service';

/**
 * Legacy variant codes still consumed by older callers. New paywall flows
 * use the `variantConfig` input which carries an explicit `{title, ctaLabel,
 * ...}` object so the modal does not need to know about every backend
 * `error_code`.
 */
export type PaywallLegacyVariant = 'NOT_INCLUDED' | 'GRACE_HARD' | 'TRIAL_ENDED';

/**
 * Re-exported alias so existing imports keep working. The canonical
 * definition lives in `SubscriptionAccessService`.
 */
export type PaywallVariantConfig = PaywallVariant;

const SEVERITY_BADGE: Record<PaywallSeverity, BadgeVariant> = {
  critical: 'error',
  warning: 'warning',
  info: 'info',
  upsell: 'success',
  success: 'success',
};

const CATEGORY_ICON: Record<PaywallCategory, string> = {
  upgrade: 'crown',
  'feature-locked': 'lock',
  'quota-exhausted': 'zap',
  'payment-due': 'alert-octagon',
  'trial-ended': 'sparkles',
};

const CATEGORIES_WITH_BENEFITS: ReadonlySet<PaywallCategory> = new Set([
  'upgrade',
  'feature-locked',
  'trial-ended',
]);

@Component({
  selector: 'app-ai-paywall-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, IconComponent, ButtonComponent, BadgeComponent],
  template: `
    <app-modal [(isOpen)]="isOpen" [size]="'md'" [showCloseButton]="false">
      <div class="paywall-shell" [class]="'severity-' + severityKey()">
        <!-- Hero zone -->
        <div class="paywall-hero">
          <div class="paywall-hero-bg"></div>
          <div class="paywall-hero-icon">
            <span class="paywall-hero-halo" aria-hidden="true"></span>
            @if (severityKey() === 'success') {
              <svg
                class="paywall-success-checkmark relative z-10"
                viewBox="0 0 52 52"
                aria-hidden="true"
              >
                <circle
                  cx="26"
                  cy="26"
                  r="25"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                />
                <path
                  d="M14 27 l8 8 l16 -16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            } @else {
              <app-icon
                [name]="iconName()"
                [size]="44"
                class="relative z-10 text-white drop-shadow-sm"
              />
            }
          </div>
          @if (badgeLabel()) {
            <div class="paywall-hero-badge">
              <app-badge [variant]="badgeVariant()" size="sm" badgeStyle="solid">
                {{ badgeLabel() }}
              </app-badge>
            </div>
          }
        </div>

        <!-- Body -->
        <div class="paywall-body">
          <h3 class="paywall-title">{{ resolvedTitle() }}</h3>
          <p class="paywall-description">{{ resolvedDescription() }}</p>

          <!-- F7 — bloque de upgrade para 005/006: funcionalidad pedida,
               plan actual (nombre + qué incluye) y siguiente plan sugerido
               con datos vivos del catálogo. Sin sugerencia (cargando o sin
               candidato) se muestra el copy base del variant. -->
          @if (showUpgradeBlock()) {
            <div class="paywall-upgrade">
              @if (requestedFeatureLabel()) {
                <p class="paywall-upgrade-feature">
                  <app-icon name="zap" [size]="14" class="paywall-hint-icon" />
                  Función solicitada: <strong>{{ requestedFeatureLabel() }}</strong>
                </p>
              }
              @if (currentPlanName()) {
                <p class="paywall-upgrade-current">
                  Tu plan actual: <strong>{{ currentPlanName() }}</strong>
                  @if (currentPlanIncludesLabel()) {
                    <span class="paywall-upgrade-includes"> — incluye {{ currentPlanIncludesLabel() }}</span>
                  }
                </p>
              }
              @if (upgradeLoading()) {
                <p class="paywall-upgrade-loading" aria-busy="true">Buscando el mejor plan para ti…</p>
              } @else if (suggestedPlanName()) {
                <div class="paywall-upgrade-suggestion">
                  <app-icon name="crown" [size]="16" class="paywall-hint-icon" />
                  <span>
                    Te recomendamos <strong>{{ suggestedPlanName() }}</strong>
                    @if (suggestedPlanPriceLabel()) {
                      <span> ({{ suggestedPlanPriceLabel() }})</span>
                    }
                  </span>
                </div>
              }
            </div>
          }

          @if (showBenefits()) {
            <ul class="paywall-benefits">
              @for (benefit of benefits(); track benefit) {
                <li class="paywall-benefit-item">
                  <span class="paywall-benefit-check" aria-hidden="true">
                    <app-icon name="check" [size]="14" />
                  </span>
                  <span>{{ benefit }}</span>
                </li>
              }
            </ul>
          }

          @if (recommendedHint()) {
            <p class="paywall-hint">
              <app-icon name="sparkles" [size]="14" class="paywall-hint-icon" />
              {{ recommendedHint() }}
            </p>
          }
        </div>
      </div>

      <div slot="footer" class="paywall-footer">
        @if (showExtraAction()) {
          <button
            type="button"
            class="paywall-extra-link"
            (click)="emitExtra()"
          >
            {{ extraActionLabel() }}
          </button>
        }
        @if (showSecondaryCta()) {
          <app-button
            variant="ghost"
            size="md"
            (click)="dismiss()"
            [class]="'paywall-secondary-btn'"
          >
            {{ resolvedSecondaryLabel() }}
          </app-button>
        }
        @if (showPrimaryCta()) {
          <app-button
            variant="primary"
            size="md"
            (click)="primaryAction()"
            [class]="'paywall-primary-btn paywall-primary-' + severityKey()"
          >
            {{ resolvedPrimaryText() }}
          </app-button>
        }
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
  /**
   * RNC-24 — Optional tertiary action (e.g. "Contactar soporte"). When the
   * label is non-empty the button is rendered next to the regular CTAs and
   * `extraAction` is emitted on click. The host (paywall-outlet) decides
   * what to do — typically open the support modal.
   */
  readonly extraActionLabel = input<string>('');
  readonly extraAction = output<void>();

  readonly showExtraAction = computed(
    () => (this.extraActionLabel() ?? '').trim().length > 0,
  );

  /**
   * Hide the primary CTA when the variant supplies an empty label (e.g. the
   * payment-success microinteraction auto-dismisses without user action).
   */
  readonly showPrimaryCta = computed(
    () => (this.resolvedPrimaryText() ?? '').trim().length > 0,
  );

  /**
   * Hide the secondary CTA when the variant explicitly sets an empty
   * `secondaryCtaLabel`. We can't rely on the resolved value because it
   * falls back to `dismissText()` ("Cerrar"); only treat the variant's
   * explicit `''` as "hide".
   */
  readonly showSecondaryCta = computed(() => {
    const config = this.variantConfig();
    if (config && config.secondaryCtaLabel === '') return false;
    return (this.resolvedSecondaryLabel() ?? '').trim().length > 0;
  });

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

  readonly resolvedSecondaryLabel = computed(
    () => this.variantConfig()?.secondaryCtaLabel ?? this.dismissText(),
  );

  readonly severityKey = computed<PaywallSeverity>(
    () => this.variantConfig()?.severity ?? this.legacySeverity(),
  );

  readonly badgeVariant = computed<BadgeVariant>(
    () => SEVERITY_BADGE[this.severityKey()],
  );

  readonly badgeLabel = computed(() => this.variantConfig()?.badgeLabel ?? '');

  readonly iconName = computed<string>(() => {
    const config = this.variantConfig();
    if (config?.iconName) return config.iconName;
    if (config?.category) return CATEGORY_ICON[config.category];
    return this.legacyIcon();
  });

  readonly benefits = computed(() => this.variantConfig()?.benefits ?? []);

  readonly showBenefits = computed(() => {
    const config = this.variantConfig();
    if (!config?.benefits?.length) return false;
    if (!config.category) return true;
    return CATEGORIES_WITH_BENEFITS.has(config.category);
  });

  readonly recommendedHint = computed(
    () => this.variantConfig()?.recommendedPlanHint ?? '',
  );

  /**
   * F7 — estado vivo del paywall para el bloque de upgrade. El outlet no se
   * toca: el modal lee directo del servicio (mismo singleton que abre el
   * interceptor), así el bloque aparece en cuanto llega la sugerencia sin
   * re-abrir el modal.
   */
  private readonly access = inject(SubscriptionAccessService);

  private readonly upgradeCode = computed(
    () => this.access.paywallState()?.code ?? null,
  );

  private readonly isUpgradePaywall = computed(() => {
    const code = this.upgradeCode();
    if (code === 'SUBSCRIPTION_005' || code === 'SUBSCRIPTION_006') return true;
    // Uso standalone (sin estado del servicio): decide por categoría.
    if (!code) {
      const category = this.variantConfig()?.category;
      return category === 'feature-locked' || category === 'quota-exhausted';
    }
    return false;
  });

  private readonly requestedFeatureKey = computed(
    () =>
      this.access.suggestionFeature() ??
      this.access.paywallState()?.details?.feature ??
      null,
  );

  readonly requestedFeatureLabel = computed(() => {
    const key = this.requestedFeatureKey();
    if (!key) return '';
    return AI_FEATURE_LABELS[key] ?? key;
  });

  readonly currentPlanName = computed(
    () =>
      this.access.suggestion()?.currentPlan?.name ??
      this.access.paywallState()?.details?.plan_name ??
      '',
  );

  readonly currentPlanIncludesLabel = computed(() => {
    const includes = this.access.suggestion()?.currentPlan?.includes ?? [];
    return includes
      .map((key) => AI_FEATURE_LABELS[key] ?? key)
      .join(', ');
  });

  readonly upgradeLoading = computed(() => this.access.suggestionLoading());

  readonly suggestedPlanName = computed(
    () => this.access.suggestion()?.suggestedPlan?.name ?? '',
  );

  readonly suggestedPlanPriceLabel = computed(() => {
    const price = this.access.suggestion()?.suggestedPlan?.price;
    if (typeof price !== 'number' || !Number.isFinite(price)) return '';
    return `$${price.toLocaleString('es-CO')}`;
  });

  readonly showUpgradeBlock = computed(
    () =>
      this.isUpgradePaywall() &&
      (this.requestedFeatureKey() != null ||
        this.currentPlanName() !== '' ||
        this.upgradeLoading() ||
        this.suggestedPlanName() !== ''),
  );

  primaryAction(): void {
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

  emitExtra(): void {
    this.extraAction.emit();
  }

  private legacySeverity(): PaywallSeverity {
    switch (this.variant()) {
      case 'GRACE_HARD':
        return 'critical';
      case 'TRIAL_ENDED':
        return 'upsell';
      default:
        return 'info';
    }
  }

  private legacyIcon(): string {
    switch (this.variant()) {
      case 'GRACE_HARD':
        return 'alert-octagon';
      case 'TRIAL_ENDED':
        return 'sparkles';
      default:
        return 'lock';
    }
  }
}
