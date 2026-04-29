import {
  Component,
  OnInit,
  OnDestroy,
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
  ],
  templateUrl: './dunning-board.component.html',
  styleUrls: ['./dunning-board.component.scss'],
})
export class DunningBoardComponent implements OnInit, OnDestroy {
  private readonly facade = inject(SubscriptionFacade);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly dunning = this.facade.dunning;
  readonly retrying = this.facade.retryingPayment;
  readonly currentSubscription = this.facade.current;

  // Live tick for countdown updates (refreshed once per minute).
  private readonly tickMs = signal(Date.now());
  private intervalHandle: any = null;

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

  constructor() {
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

  // Track whether the user has actually clicked retry, so we don't auto-leave
  // the page on the first load if the subscription happens to already be
  // active (e.g. the user navigated here manually).
  private readonly didRetry = signal(false);

  ngOnInit(): void {
    this.facade.loadCurrent();
    this.facade.loadDunningState();
    this.intervalHandle = setInterval(
      () => this.tickMs.set(Date.now()),
      30 * 1000,
    );
  }

  ngOnDestroy(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
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
   * S2.2 — Send the user to the payment-method page where Wompi tokenization
   * + the new "Reemplazar" flow live. After tokenizing a fresh card the user
   * can come back to this board and click "Pagar ahora" — or, if they want
   * automatic retry, the payment-method page emits replacePaymentMethod()
   * which already triggers a retry on the backend (subscription-payment
   * service hook).
   */
  onUpdatePaymentMethod(): void {
    this.router.navigateByUrl('/admin/subscription/payment');
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
