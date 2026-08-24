import {
  Component,
  inject,
  computed,
  signal,
  OnInit,
  DestroyRef,
} from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { distinctUntilChanged, map } from 'rxjs/operators';
import { SubscriptionFacade } from '../../../core/store/subscription';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { IconComponent } from '../icon/icon.component';
import { StoreSubscriptionService } from '../../../private/modules/store/subscription/services/store-subscription.service';
import { PaymentMethod } from '../../../private/modules/store/subscription/interfaces/store-subscription.interface';

type BannerLevel = 'none' | 'info' | 'warning' | 'danger' | 'terminal';

interface BannerCopy {
  title: string;
  detail: string;
  ctaText: string;
  iconName: string;
}

function pluralize(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * Builds the grace-state detail line so it surfaces BOTH the overdue side
 * (days since `current_period_end`) and the deadline side (days left until
 * the next state transition). Single-side phrasing was ambiguous: "Te quedan
 * 2 días para regularizar" reads as "I've been here 2 days" to a fraction of
 * users because nothing anchors the count to the future deadline.
 */
function graceDetail(
  daysOverdue: number,
  daysRemaining: number,
  nextStepNoun: string,
): string {
  if (daysRemaining <= 0) {
    return `Regulariza el pago para evitar ${nextStepNoun}.`;
  }
  const overdueClause =
    daysOverdue > 0
      ? `Tu pago está vencido hace ${pluralize(daysOverdue, 'día', 'días')}. `
      : '';
  return `${overdueClause}${pluralize(daysRemaining, 'día', 'días')} restante${
    daysRemaining === 1 ? '' : 's'
  } antes de ${nextStepNoun}.`;
}

@Component({
  selector: 'app-subscription-banner',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    @if (visible()) {
      <div class="sub-banner" [class]="'sub-banner--' + level()" role="status">
        <div class="sub-banner__inner">
          <span class="sub-banner__icon" aria-hidden="true">
            <app-icon [name]="copy().iconName" [size]="18" />
          </span>
          <div class="sub-banner__text">
            <span class="sub-banner__title">{{ copy().title }}</span>
            @if (copy().detail) {
              <span class="sub-banner__detail">{{ copy().detail }}</span>
            }
            @if (autoRenewSecondaryNotice(); as notice) {
              <span class="sub-banner__detail">{{ notice }}</span>
            }
          </div>
          <a
            [attr.href]="ctaLink()"
            class="sub-banner__cta"
            [attr.aria-label]="copy().ctaText"
            (click)="onCtaClick($event)"
          >
            {{ copy().ctaText }}
            <app-icon name="chevron-right" [size]="14" />
          </a>
          <button
            type="button"
            class="sub-banner__dismiss"
            (click)="onDismiss()"
            aria-label="Cerrar aviso"
          >
            <app-icon name="close" [size]="16" />
          </button>
        </div>
      </div>
    }
  `,
  styleUrl: './subscription-banner.component.css',
})
export class SubscriptionBannerComponent implements OnInit {
  private readonly facade = inject(SubscriptionFacade);
  private readonly authFacade = inject(AuthFacade);
  private readonly router = inject(Router);
  private readonly subscriptionService = inject(StoreSubscriptionService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);

  private readonly dismissed = signal(false);

  // S1.2 — Track the active store. Banner is store-scoped only; if there's
  // no store context we render nothing. On every store change we also reset
  // the "dismissed" flag so a previous-tienda dismiss doesn't carry over.
  private readonly currentStoreId = signal<number | null>(null);

  // G11 — Payment methods loaded eagerly so the banner can warn about
  // expiring (≤14 days) or invalidated (3 consecutive failures) cards even
  // when the subscription itself is happily `active`. This sidesteps the
  // NgRx layer to keep the banner self-contained.
  private readonly paymentMethods = signal<PaymentMethod[]>([]);

  constructor() {
    // S1.2 — React to store-context changes BEFORE rendering anything.
    // - Wipes the NgRx subscription slice so stale data can't flash.
    // - Triggers the new store's loadCurrent() via the effect.
    // - Resets local UI state (dismissed flag, payment methods).
    this.authFacade.userStore$
      .pipe(
        map((s: any) => (s?.id ?? null) as number | null),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((storeId) => {
        this.currentStoreId.set(storeId);
        this.dismissed.set(false);
        this.paymentMethods.set([]);
        this.facade.contextChanged(storeId);
        if (storeId !== null) {
          this.loadPaymentMethodsForCurrentStore();
        }
      });
  }

  ngOnInit(): void {
    // Initial PM load is now handled inside the userStore$ subscription so
    // that a store switch refreshes them. Kept as a no-op to preserve the
    // OnInit signature in case callers wire to it.
  }

  private loadPaymentMethodsForCurrentStore(): void {
    this.subscriptionService
      .getPaymentMethods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && Array.isArray(res.data)) {
            this.paymentMethods.set(res.data);
          }
        },
        error: () => {
          // Silent — the banner falls back to the subscription-level state.
        },
      });
  }

  /** G11 — Highest-priority PM warning across the user's saved cards. */
  private readonly pmWarning = computed<
    'invalid' | 'expiring' | null
  >(() => {
    const methods = this.paymentMethods();
    if (methods.length === 0) return null;

    if (methods.some((m) => m.state === 'invalid')) {
      return 'invalid';
    }
    const now = Date.now();
    const fourteenDays = 14 * 24 * 60 * 60 * 1000;
    const expiringDefault = methods.some((m) => {
      if (!m.is_default) return false;
      if (!m.expiry_month || !m.expiry_year) return false;
      const mNum = parseInt(m.expiry_month, 10);
      let yNum = parseInt(m.expiry_year, 10);
      if (isNaN(mNum) || isNaN(yNum)) return false;
      if (yNum < 100) yNum += 2000;
      const expEnd = Date.UTC(yNum, mNum, 0, 23, 59, 59, 999);
      if (expEnd < now) return false;
      return expEnd - now <= fourteenDays;
    });
    return expiringDefault ? 'expiring' : null;
  });

  readonly level = computed<BannerLevel>(() => {
    // The banner only renders when `visible()` matches a known UI-state kind
    // (payment_due / expiring_soon / grace_* / billing-warning). Drive severity
    // from the SAME selector so the CSS modifier always matches a defined palette.
    const ui = this.facade.subscriptionUiState();
    if (ui.kind === 'grace_hard') return 'danger';
    if (ui.kind === 'grace_soft') return 'warning';
    if (ui.kind === 'payment_due') return 'warning';
    if (ui.kind === 'expiring_soon') {
      return ui.daysUntilRenewal <= 1 ? 'danger' : 'warning';
    }
    // Billing-warning detection — never block reads (mora / grace / suspend
    // remain the canonical write-blocking mechanism). Auto-renew disabled by
    // missing credential is recoverable, so it's a warning; a charge that
    // actually failed is the imminent failure mode → danger.
    if (ui.kind === 'auto_renew_disabled_no_credential') return 'warning';
    if (ui.kind === 'renewal_failed') return 'danger';
    // PM warnings only matter while subscription is healthy. They reach the
    // banner only if `visible()` is later expanded to allow them — kept here
    // for forward-compat.
    const pm = this.pmWarning();
    if (pm === 'invalid') return 'danger';
    if (pm === 'expiring') return 'warning';
    return 'none';
  });

  // Role gate — the banner exposes subscription-management CTAs that only the
  // store owner (and super_admin) can act on. Non-owner store users (cashiers,
  // staff) must never see it. Reads signal-backed AuthFacade flags so it stays
  // reactive under zoneless change detection.
  private readonly canManageSubscription = computed<boolean>(() => {
    return (
      this.authFacade.isOwner() ||
      this.authFacade.hasAnyRole([
        'owner',
        'OWNER',
        'super_admin',
        'STORE_OWNER',
        'ORG_OWNER',
      ])
    );
  });

  readonly visible = computed(() => {
    // S1.2 — Banner is STORE-only. Hide it for ORG_ADMIN / SUPER_ADMIN
    // / logout (currentStoreId === null) regardless of any cached state.
    if (this.currentStoreId() === null) return false;
    // Role gate — hide entirely for non-owner store users.
    if (!this.canManageSubscription()) return false;
    if (this.dismissed()) return false;
    // RNC-PaidPlan — Top alert is now driven by the unified subscription UI
    // state (ADR-4). Only `payment_due`, `expiring_soon`, `grace_*`, and
    // billing-warning kinds surface here.
    const ui = this.facade.subscriptionUiState();
    return (
      ui.kind === 'payment_due' ||
      ui.kind === 'expiring_soon' ||
      ui.kind === 'grace_soft' ||
      ui.kind === 'grace_hard' ||
      ui.kind === 'auto_renew_disabled_no_credential' ||
      ui.kind === 'renewal_failed'
    );
  });

  readonly copy = computed<BannerCopy>(() => {
    // Drive copy from the unified UI-state selector (same source as
    // `visible()`/`level()`) so kind ↔ message ↔ palette stay coherent.
    const ui = this.facade.subscriptionUiState();
    const scheduledCancelAt = this.facade.scheduledCancelAt();
    const status = this.facade.status();
    const isScheduledCancel =
      !!scheduledCancelAt &&
      (status === 'active' || status === 'trialing' || status === 'trial');

    if (ui.kind === 'payment_due') {
      const formattedTotal = new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: ui.invoice.currency || 'COP',
        maximumFractionDigits: 0,
      }).format(ui.invoice.total);

      const dueText = ui.invoice.due_at
        ? ` Vence el ${new Date(ui.invoice.due_at).toLocaleDateString('es-CO', {
            day: 'numeric',
            month: 'short',
          })}.`
        : '.';

      return {
        title: `Tienes un pago pendiente de ${formattedTotal}`,
        detail: `Tu período de suscripción requiere pago.${dueText}${
          ui.autoRenewPaused
            ? ' Deberás pagar cada período manualmente.'
            : ''
        }`,
        ctaText: 'Pagar',
        iconName: 'credit-card',
      };
    }

    if (ui.kind === 'expiring_soon') {
      // Scheduled cancel wins over the renewal-soon copy: explicit user action
      // takes priority and needs a concrete date + how to revert.
      if (isScheduledCancel && scheduledCancelAt) {
        const cancelDate = new Date(scheduledCancelAt).toLocaleDateString(
          'es-CO',
          { day: 'numeric', month: 'short', year: 'numeric' },
        );
        return {
          title: 'Tu suscripción se cancelará el ' + cancelDate,
          detail:
            'Tu plan sigue activo hasta esa fecha. Puedes reactivar la renovación cuando quieras.',
          ctaText: 'Gestionar',
          iconName: 'alert-triangle',
        };
      }
      const d = ui.daysUntilRenewal;
      return {
        title:
          d <= 1
            ? 'Tu suscripción se renueva mañana'
            : 'Tu suscripción se renueva pronto',
        detail:
          d <= 1
            ? 'Asegúrate de pagar tu factura a tiempo para evitar interrupciones en el servicio.'
            : `Te quedan ${d} días. Prepara tu pago para evitar interrupciones.`,
        ctaText: 'Gestionar',
        iconName: 'alert-triangle',
      };
    }

    if (ui.kind === 'grace_soft') {
      return {
        title: 'Tu suscripción está en período de gracia',
        detail: graceDetail(ui.daysOverdue, ui.daysRemaining, 'la suspensión'),
        ctaText: 'Pagar ahora',
        iconName: 'alert-triangle',
      };
    }

    if (ui.kind === 'grace_hard') {
      return {
        title: 'Tu suscripción entró en gracia crítica',
        detail: graceDetail(ui.daysOverdue, ui.daysRemaining, 'la suspensión total'),
        ctaText: 'Pagar ahora',
        iconName: 'alert-octagon',
      };
    }

    // Billing-warning detection — banner surfaces ONLY when the
    // subscription is otherwise `active` and has no pending invoice.
    if (ui.kind === 'auto_renew_disabled_no_credential') {
      return {
        title: 'Tu plan no se renovará solo',
        detail:
          'El medio con el que pagaste no admite cobros automáticos. Deberás pagar cada período manualmente.',
        ctaText: 'Ver mi plan',
        iconName: 'alert-triangle',
      };
    }
    if (ui.kind === 'renewal_failed') {
      return {
        title: 'No pudimos cobrar tu renovación',
        detail:
          'Tienes un pago pendiente de tu suscripción. Paga tu factura para continuar con el servicio.',
        ctaText: 'Pagar',
        iconName: 'alert-octagon',
      };
    }

    // PM warning fallback (only reachable if `visible()` is widened later).
    const pm = this.pmWarning();
    if (pm === 'invalid') {
      return {
        title: 'Tu tarjeta no es válida',
        detail: 'Actualízala para evitar la suspensión de tu suscripción.',
        ctaText: 'Cambiar tarjeta',
        iconName: 'alert-octagon',
      };
    }
    if (pm === 'expiring') {
      return {
        title: 'Tu tarjeta vence pronto',
        detail: 'Cámbiala para evitar interrupciones en el cobro.',
        ctaText: 'Cambiar tarjeta',
        iconName: 'alert-triangle',
      };
    }

    return { title: '', detail: '', ctaText: '', iconName: 'info' };
  });

  /**
   * Línea secundaria que informa del autopago pausado en los estados donde otro
   * aviso más urgente se queda con el título y el CTA.
   */
  readonly autoRenewSecondaryNotice = computed<string | null>(() => {
    const warning = this.facade.autoRenewWarning();
    if (!warning) return null;

    const kind = this.facade.subscriptionUiState().kind;
    if (
      kind === 'renewal_failed' ||
      kind === 'auto_renew_disabled_no_credential' ||
      kind === 'payment_due'
    ) {
      return null;
    }

    return warning.type === 'auto_renew_charge_failed'
      ? 'Además, tu renovación automática falló y quedó pausada.'
      : 'Además, tu renovación automática está pausada. Deberás pagar cada período manualmente.';
  });

  /**
   * Vista de pago del plan vigente, o `null` cuando no hay plan al que pagarle.
   */
  private readonly planPaymentUrl = computed<string | null>(() => {
    const sub = this.facade.current() as {
      plan_id?: number | string | null;
      paid_plan_id?: number | string | null;
    } | null;
    const planId = sub?.plan_id ?? sub?.paid_plan_id ?? null;
    if (planId === null || planId === undefined || planId === '') return null;
    return `/admin/subscription/checkout/${planId}`;
  });

  readonly ctaLink = computed(() => {
    const ui = this.facade.subscriptionUiState();
    if (ui.kind === 'payment_due') {
      return '/admin/subscription/payment';
    }
    if (ui.kind === 'auto_renew_disabled_no_credential') {
      return '/admin/subscription';
    }
    if (ui.kind === 'renewal_failed') {
      return '/admin/subscription/payment';
    }
    if (ui.kind === 'grace_soft' || ui.kind === 'grace_hard') {
      return '/admin/subscription/payment';
    }
    const subLevel = this.facade.bannerLevel();
    const pm = this.pmWarning();
    // G11 — PM warnings always route to the payment-method page.
    if ((subLevel === 'none' || subLevel === 'info') && pm) {
      return '/admin/subscription/payment';
    }

    const status = this.facade.status();
    // Terminal lifecycle (cancelled/expired): require a fresh subscription —
    // route to the plan catalog, not to dunning or payment.
    if (status === 'cancelled' || status === 'expired') {
      return '/admin/subscription/plans';
    }
    // Scheduled cancel: route to subscription overview where the user can
    // see the schedule and (eventually) reactivate auto_renew.
    if (this.facade.scheduledCancelAt()) {
      return '/admin/subscription';
    }
    // Respaldo por `status` cuando el backend no envió `state` y por tanto
    // `ui.kind` no resolvió a gracia: mismo destino que la rama de arriba.
    if (status === 'grace_soft' || status === 'grace_hard') {
      return this.planPaymentUrl() ?? '/admin/subscription/dunning';
    }
    // G6 — suspended/blocked siguen entrando por el tablero de mora: ahí no
    // basta con pagar (hay facturas vencidas, features perdidas y el CTA de
    // soporte), y su copy no promete "pagar ahora". Solo la gracia, cuyo CTA sí
    // lo promete, se salta el tablero.
    if (status === 'suspended' || status === 'blocked') {
      return '/admin/subscription/dunning';
    }
    // Default fallback — send to subscription overview. /payment ya permite dar
    // de alta una tarjeta, pero sigue siendo destino explícito (avisos de
    // autopago y de tarjeta), nunca la entrada por defecto.
    return '/admin/subscription';
  });

  onDismiss(): void {
    this.dismissed.set(true);
  }

  onCtaClick(event: MouseEvent): void {
    const target = this.ctaLink();
    const currentPath = this.router.url.split(/[?#]/)[0];

    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    if (target === '/admin/subscription/dunning' && currentPath === target) {
      event.preventDefault();
      this.document.getElementById('subscription-dunning-pay-now')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
      return;
    }

    event.preventDefault();
    this.router.navigateByUrl(target);
  }
}
