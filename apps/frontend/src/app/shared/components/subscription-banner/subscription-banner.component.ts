import {
  Component,
  inject,
  computed,
  signal,
  OnInit,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
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

@Component({
  selector: 'app-subscription-banner',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
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
          </div>
          <a
            [routerLink]="ctaLink()"
            class="sub-banner__cta"
            [attr.aria-label]="copy().ctaText"
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
    // G11 — surface PM warnings ONLY when the subscription itself is not
    // already in a `warning`/`danger`/`terminal` state — those messages take
    // priority because the user already sees a CTA to pay/regularize/reactivate.
    const subLevel = this.facade.bannerLevel();
    if (
      subLevel === 'warning' ||
      subLevel === 'danger' ||
      subLevel === 'terminal'
    ) {
      return subLevel;
    }
    const pm = this.pmWarning();
    if (pm === 'invalid') return 'danger';
    if (pm === 'expiring') return 'warning';
    return subLevel;
  });

  readonly visible = computed(
    () =>
      // S1.2 — Banner is STORE-only. Hide it for ORG_ADMIN / SUPER_ADMIN
      // / logout (currentStoreId === null) regardless of any cached state.
      this.currentStoreId() !== null &&
      !this.dismissed() &&
      this.level() !== 'none',
  );

  readonly copy = computed<BannerCopy>(() => {
    const subLevel = this.facade.bannerLevel();
    const pm = this.pmWarning();

    // G11 — PM banner copy wins when subscription is healthy.
    if ((subLevel === 'none' || subLevel === 'info') && pm) {
      if (pm === 'invalid') {
        return {
          title: 'Tu tarjeta no es válida',
          detail: 'Actualízala para evitar la suspensión de tu suscripción.',
          ctaText: 'Cambiar tarjeta',
          iconName: 'alert-octagon',
        };
      }
      // expiring
      return {
        title: 'Tu tarjeta vence pronto',
        detail: 'Cámbiala para evitar interrupciones en el cobro.',
        ctaText: 'Cambiar tarjeta',
        iconName: 'alert-triangle',
      };
    }

    const status = this.facade.status();
    const days = this.facade.daysUntilDue();
    const scheduledCancelAt = this.facade.scheduledCancelAt();
    const isScheduledCancel =
      !!scheduledCancelAt &&
      (status === 'active' || status === 'trialing' || status === 'trial');

    switch (this.level()) {
      case 'info':
        return {
          title: 'Tu suscripción está activa',
          detail: days > 0 ? `Próxima renovación en ${days} días.` : '',
          ctaText: 'Gestionar',
          iconName: 'shield-check',
        };
      case 'warning':
        // Scheduled cancel takes priority over the trial-ending-soon copy
        // because it represents an explicit user action — they need to know
        // the date and how to revert if they change their mind.
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
        return {
          title: status === 'grace_hard'
            ? 'Tu suscripción entró en período de gracia'
            : 'Tu suscripción vence pronto',
          detail: days > 0
            ? `Te quedan ${days} días. Renueva para evitar interrupciones.`
            : 'Renueva ahora para evitar interrupciones en tu servicio.',
          ctaText: 'Pagar ahora',
          iconName: 'alert-triangle',
        };
      case 'danger':
        return {
          title: status === 'grace_hard' || status === 'grace_soft'
            ? 'Tu suscripción está en período de gracia'
            : 'Tu suscripción está vencida',
          detail: 'Regulariza el pago para recuperar el acceso completo.',
          ctaText: 'Regularizar',
          iconName: 'alert-octagon',
        };
      case 'terminal':
        return {
          title:
            status === 'cancelled'
              ? 'Tu suscripción está cancelada'
              : 'Tu suscripción ha expirado',
          detail:
            'Reactívala eligiendo un plan para recuperar el acceso completo.',
          ctaText: 'Elegir plan',
          iconName: 'alert-octagon',
        };
      default:
        return { title: '', detail: '', ctaText: '', iconName: 'info' };
    }
  });

  readonly ctaLink = computed(() => {
    // S1.2 — Banner is STORE-ONLY (super-admin only manages plans, never
    // consumes them; org-admin is plan-agnostic). visible() already gates
    // rendering on `currentStoreId !== null`, so every CTA below targets a
    // store-admin route.
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
    // G6 — grace/suspended/blocked stores recover via the dunning board.
    if (
      status === 'grace_soft' ||
      status === 'grace_hard' ||
      status === 'suspended' ||
      status === 'blocked'
    ) {
      return '/admin/subscription/dunning';
    }
    return '/admin/subscription/payment';
  });

  onDismiss(): void {
    this.dismissed.set(true);
  }
}
