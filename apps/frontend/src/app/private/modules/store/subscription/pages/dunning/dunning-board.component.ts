import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  inject,
  computed,
  signal,
  effect,
} from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import {
  CardComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { SubscriptionFacade } from '../../../../../../core/store/subscription/subscription.facade';
import { SupportRequestModalComponent } from '../../components/support-request-modal/support-request-modal.component';

/**
 * G6 — Dunning board.
 *
 * Surfaces the dunning snapshot (state, deadlines, overdue invoices, features
 * lost vs kept) and exposes a single CTA to retry payment of the most recent
 * unpaid invoice. When the retry succeeds and the subscription returns to
 * `active`, the component navigates back to the subscription home.
 *
 * Skills: vendix-subscription-gate, vendix-saas-billing, vendix-frontend-state,
 * vendix-frontend-component, vendix-zoneless-signals.
 */
@Component({
  selector: 'app-dunning-board',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    ButtonComponent,
    IconComponent,
    CurrencyPipe,
    DatePipe,
    SupportRequestModalComponent,
  ],
  templateUrl: './dunning-board.component.html',
  styleUrls: ['./dunning-board.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DunningBoardComponent {
  private readonly facade = inject(SubscriptionFacade);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly dunning = this.facade.dunning;
  readonly retrying = this.facade.retryingPayment;
  readonly currentSubscription = this.facade.current;
  readonly loading = this.facade.loading;

  // Live tick for countdown updates (refreshed every 30s). Writing to the
  // signal is what triggers re-render — fully Zoneless-compatible because
  // signals propagate via the reactive graph, not via the NgZone task queue.
  private readonly tickMs = signal(Date.now());

  // Page is "ready" once dunning snapshot is loaded — gates the template
  // against the empty-default flash where bannerTitle falls to the catch-all
  // "Tu suscripción requiere atención" while the real payload is in flight.
  readonly ready = computed(() => this.dunning() !== null);

  readonly state = computed(() => this.dunning()?.state ?? 'none');

  readonly bannerTitle = computed(() => {
    switch (this.state()) {
      case 'grace_soft':
      case 'grace_hard':
        return 'Tu suscripción está en período de gracia';
      case 'suspended':
        return 'Tu suscripción está suspendida';
      case 'blocked':
        return 'Tu cuenta está bloqueada';
      default:
        return 'Tu suscripción requiere atención';
    }
  });

  readonly bannerSubtitle = computed(() => {
    switch (this.state()) {
      case 'grace_soft':
        return 'Aún tienes acceso completo, pero debes regularizar el pago para evitar interrupciones.';
      case 'grace_hard':
        return 'Algunas funciones premium están limitadas. Regulariza el pago para recuperarlas.';
      case 'suspended':
        return 'Las operaciones de la tienda están temporalmente bloqueadas. Realiza el pago para reactivar el servicio.';
      case 'blocked':
        return 'Tu cuenta no podrá operar hasta resolver el saldo pendiente.';
      default:
        return 'Revisa el estado de tu suscripción y los pagos pendientes.';
    }
  });

  readonly hasInvoices = computed(
    () => (this.dunning()?.invoices_overdue?.length ?? 0) > 0,
  );

  readonly totalDue = computed(() => this.dunning()?.total_due ?? 0);

  readonly featuresLost = computed(() => this.dunning()?.features_lost ?? []);
  readonly featuresKept = computed(() => this.dunning()?.features_kept ?? []);

  /**
   * S2.2 — show the "Actualizar método de pago" CTA when the backend reports
   * `payment_method_invalid=true` AND we are in a recoverable grace window.
   * Outside grace_*, this CTA is redundant with the regular payment-method UI.
   */
  readonly needsPaymentMethodUpdate = computed(() => {
    const d = this.dunning();
    if (!d?.payment_method_invalid) return false;
    return d.state === 'grace_soft' || d.state === 'grace_hard';
  });

  readonly nextDeadline = computed<{
    label: string;
    at: string | null;
  } | null>(() => {
    const d = this.dunning()?.deadlines;
    if (!d) return null;
    if (d.grace_hard_at && this.isFuture(d.grace_hard_at)) {
      return { label: 'Entra en período crítico en', at: d.grace_hard_at };
    }
    if (d.suspend_at && this.isFuture(d.suspend_at)) {
      return { label: 'Suspensión en', at: d.suspend_at };
    }
    if (d.cancel_at && this.isFuture(d.cancel_at)) {
      return { label: 'Cancelación definitiva en', at: d.cancel_at };
    }
    return null;
  });

  readonly countdown = computed(() => {
    const next = this.nextDeadline();
    if (!next?.at) return '';
    // Read tick to make this computed reactive to clock changes.
    const now = this.tickMs();
    const ms = new Date(next.at).getTime() - now;
    if (ms <= 0) return 'Vencido';
    const totalMinutes = Math.floor(ms / (60 * 1000));
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    if (days >= 1) return `${days} día${days === 1 ? '' : 's'} ${hours} h`;
    const minutes = totalMinutes % 60;
    return `${hours} h ${minutes} min`;
  });

  // Track whether the user has actually clicked retry, so we don't auto-leave
  // the page on the first load if the subscription happens to already be
  // active (e.g. the user navigated here manually).
  private readonly didRetry = signal(false);

  constructor() {
    this.facade.loadCurrent();
    this.facade.loadDunningState();

    // Tick every 30s. DestroyRef-based cleanup avoids the OnDestroy
    // interface + handle-field ceremony and keeps the lifecycle co-located
    // with the constructor.
    const handle = setInterval(() => this.tickMs.set(Date.now()), 30 * 1000);
    this.destroyRef.onDestroy(() => clearInterval(handle));

    // When retry transitions the subscription back to active, redirect home.
    effect(() => {
      const sub = this.currentSubscription();
      const status =
        sub?.state ?? sub?.status ?? this.dunning()?.state ?? null;
      if (
        !this.retrying() &&
        (status === 'active' || status === 'trial') &&
        this.dunning() // only after a snapshot was loaded
      ) {
        // Avoid the redirect on the first render before any retry.
        if (this.didRetry()) {
          this.router.navigateByUrl('/admin/subscription');
        }
      }
    });
  }

  onRetryPayment(): void {
    if (!this.hasInvoices()) {
      this.toast.error('No hay invoices pendientes de pago');
      return;
    }
    this.didRetry.set(true);
    this.facade.retryPayment();
    this.toast.info('Procesando pago…');
  }

  /**
   * Single entry point for the "Pagar ahora" CTA. Two paths:
   *   1. There's an overdue invoice → retry it inline (current dunning flow).
   *   2. No invoice yet (grace triggered without a generated invoice — happens
   *      with manual fixtures or when the renewal job hasn't created one) →
   *      route the user to the checkout for their current plan so they can
   *      complete the renewal manually.
   * Routing to the existing `/admin/subscription/checkout/:planId` keeps the
   * dunning board out of the payment-form business; the checkout page already
   * handles preview, Wompi widget, COF tokenize and PM persistence.
   */
  onPayNow(): void {
    if (this.hasInvoices()) {
      this.onRetryPayment();
      return;
    }
    const sub = this.currentSubscription();
    const planId = sub?.plan_id ?? sub?.paid_plan_id;
    if (!planId) {
      this.toast.error('No se encontró un plan vigente para renovar');
      return;
    }
    this.router.navigateByUrl(`/admin/subscription/checkout/${planId}`);
  }

  /**
   * Trigger the canonical retry-payment flow. The backend mints a fresh Wompi
   * widget config and `subscription-payment` auto-registers the new PM on
   * APPROVED. This avoids redirecting the user to `/payment` (which is opt-in
   * for managing already-saved methods) and keeps the recovery path inline
   * with the dunning-board — same as clicking "Pagar ahora".
   */
  onUpdatePaymentMethod(): void {
    this.onRetryPayment();
  }

  /**
   * RNC-24 — Open the contact-support modal. Visible on every dunning state
   * so the customer can reach Vendix even when the gateway flow is broken.
   */
  readonly supportModalOpen = signal(false);

  onContactSupport(): void {
    this.supportModalOpen.set(true);
  }

  onSupportSubmitted(_payload: { ticketId: number }): void {
    this.toast.info(
      'Tu solicitud fue enviada al equipo de soporte. Te contactaremos pronto.',
    );
  }

  featureLabel(key: string): string {
    const labels: Record<string, string> = {
      text_generation: 'Generación de texto IA',
      streaming_chat: 'Chat en streaming IA',
      conversations: 'Historial de conversaciones',
      tool_agents: 'Agentes con herramientas',
      rag_embeddings: 'Búsqueda semántica (RAG)',
      async_queue: 'Procesamiento en cola',
    };
    return labels[key] ?? key;
  }

  private isFuture(iso: string): boolean {
    return new Date(iso).getTime() > this.tickMs();
  }
}
