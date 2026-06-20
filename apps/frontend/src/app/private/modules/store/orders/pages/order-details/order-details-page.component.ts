import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, FormControl, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, firstValueFrom } from 'rxjs';
import { StoreOrdersService } from '../../services/store-orders.service';
import { GenerateDispatchWizardComponent } from '../../components/generate-dispatch-wizard/generate-dispatch-wizard.component';
import {
  DispatchMethodSelectorModalComponent,
  DispatchMethod,
} from '../../components/dispatch-method-selector-modal/dispatch-method-selector-modal.component';
import {
  Order,
  OrderItem,
  Payment,
  OrderState,
  OrderInstallment,
  OrderFlowMetadata,
  PaymentType,
  DeliveryType,
  OrderActionConfig,
  PayOrderDto,
  RefundRecord,
  FastTrackOrderDto,
  AssignShippingMethodDto,
  ReactivateOrderDto,
} from '../../interfaces/order.interface';
import { PosShippingService } from '../../../pos/services/pos-shipping.service';
import { KitchenTicketsService } from '../../../restaurant-ops/kds/services/kitchen-tickets.service';
import { PosShippingOption } from '../../../pos/models/shipping.model';
import { AlertBannerComponent, DialogService, ModalComponent, ToastService, TimelineComponent } from '../../../../../../shared/components';
import { TimelineStep, TimelineVariant } from '../../../../../../shared/components/timeline/timeline.interfaces';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  StickyHeaderComponent,
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
} from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { PaymentMethodsService } from '../../../settings/payments/services/payment-methods.service';
import { StorePaymentMethod, PaymentMethodState } from '../../../settings/payments/interfaces/payment-methods.interface';
import { ShippingMethodsService } from '../../../settings/shipping/services/shipping-methods.service';
import { StoreShippingMethod } from '../../../settings/shipping/interfaces/shipping-methods.interface';
import { ShippingRate } from '../../../settings/shipping/interfaces/shipping-zones.interface';
import { CurrencyFormatService, CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { OrderPaymentModalComponent } from '../../components/order-payment-modal/order-payment-modal.component';
import { OrderRefundModalComponent } from '../../components/order-refund-modal/order-refund-modal.component';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { PosTicketService } from '../../../pos/services/pos-ticket.service';
import { TicketData, TicketItem } from '../../../pos/models/ticket.model';
import { parseVariantAttributes, VariantAttribute } from '../../../../../../shared/utils';

export interface LifecycleStep {
  key: string;
  label: string;
  status: 'completed' | 'current' | 'upcoming' | 'terminal';
}

type PaymentReceiptPreviewKind = 'image' | 'pdf';

interface PaymentReceiptPreview {
  url: string;
  safeUrl: SafeResourceUrl;
  kind: PaymentReceiptPreviewKind;
  uploadedAt?: string | null;
}

@Component({
  selector: 'app-order-details-page',
  standalone: true,
  imports: [
    RouterModule,
    ReactiveFormsModule,
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    StickyHeaderComponent,
    ModalComponent,
    CurrencyPipe,
    OrderPaymentModalComponent,
    OrderRefundModalComponent,
    TimelineComponent,
    GenerateDispatchWizardComponent,
    DispatchMethodSelectorModalComponent,
    NgClass,
  ],
  templateUrl: './order-details-page.component.html',
  styleUrls: ['./order-details-page.component.css'],
})
export class OrderDetailsPageComponent {
  private destroyRef = inject(DestroyRef);
  orderId: string | null = null;
  order = signal<Order | null>(null);
  readonly appliedTierSummary = computed(() => {
    const order = this.order();
    const groups = new Map<string, { name: string; total: number; count: number }>();
    for (const item of order?.order_items ?? []) {
      const name = item.applied_price_tier_name_snapshot;
      if (!name) continue;
      const current = groups.get(name) ?? { name, total: 0, count: 0 };
      current.total += Number(item.total_price || 0);
      current.count += 1;
      groups.set(name, current);
    }
    return Array.from(groups.values());
  });

  // ── Discount snapshots (read-only from order; never recalculated) ──
  readonly appliedPromotions = computed(() =>
    (this.order()?.order_promotions ?? []).map((op) => ({
      id: op.id,
      promotion_id: op.promotion_id,
      name: op.promotions?.name ?? `Promoción #${op.promotion_id}`,
      code: op.promotions?.code ?? null,
      type: op.promotions?.type ?? null,
      scope: op.promotions?.scope ?? null,
      discount_amount: Number(op.discount_amount || 0),
    })),
  );

  readonly appliedCoupons = computed(() =>
    (this.order()?.coupon_uses ?? []).map((cu) => ({
      id: cu.id,
      coupon_id: cu.coupon_id,
      code: cu.coupon?.code ?? `CUP-${cu.coupon_id}`,
      name: cu.coupon?.name ?? null,
      discount_applied: Number(cu.discount_applied || 0),
    })),
  );

  readonly hasDiscountSnapshot = computed(
    () => this.appliedPromotions().length > 0 || this.appliedCoupons().length > 0,
  );
  orderRefunds = signal<RefundRecord[]>([]);
  private rawTimeline = signal<any[]>([]);
  isLoading = signal(false);
  error: string | null = null;

  // Role check
  isPrivilegedUser = signal(false);

  // Flow modal visibility signals
  showPayModal = signal(false);
  showShipModal = signal(false);
  showDeliverModal = signal(false);
  showCancelModal = signal(false);
  showReactivateModal = signal(false);
  showRefundModal = signal(false);
  showPaymentReceiptModal = signal(false);
  showDispatchModal = signal(false);
  /** Chooser modal: "con remisión" vs "sin remisión" (single dispatch entry). */
  showDispatchSelector = signal(false);

  // Processing state
  isProcessingAction = signal(false);
  // Plan KDS fire-flows (F3): loading flag for the manual fire button.
  isSendingToKitchen = signal(false);
  /**
   * Plan KDS fire-flows (F3): set of `order_item.id` the operator has
   * checked for selective fire. Empty by default — when empty the fire
   * action falls back to "all pending" (todo-o-nada legacy behaviour).
   */
  readonly selectedKitchenItemIds = signal<Set<number>>(new Set<number>());
  /**
   * Plan KDS fire-flows (F3): loading flag for the batch fire action.
   * Mirrors `isSendingToKitchen` (kept as a backward-compat alias) so the
   * template can bind a single, clearly-named signal.
   */
  readonly isFiringKitchen = this.isSendingToKitchen;
  /**
   * Items on the current order that are `prepared`, not flagged
   * `skip_kds`, and have no kitchen_ticket_items yet (i.e. the
   * auto-fire did not catch them, or the order predates the
   * auto-fire path). The detail page renders the selective
   * "Enviar a cocina" UI only when this is non-empty.
   */
  readonly pendingKitchenItems = computed<OrderItem[]>(() => {
    const order = this.order();
    if (!order?.order_items) return [];
    return order.order_items.filter(
      (it) =>
        it.product_id != null &&
        it.skip_kds !== true &&
        it.inventory_consumed_at_fire !== true &&
        (it.kitchen_ticket_items?.length ?? 0) === 0 &&
        it.products?.product_type === 'prepared',
    );
  });
  /**
   * Backward-compat alias for the legacy name used elsewhere on this page.
   */
  readonly unfiredPreparedItems = this.pendingKitchenItems;
  /** True if the active store is a restaurant (industries cascade). */
  readonly isRestaurant = computed<boolean>(() => this.authFacade.isRestaurant());
  /**
   * Plan KDS fire-flows (F3): show the per-plate kitchen dispatch UI only
   * for restaurant stores, when there is at least one pending prepared
   * item, and the order is not in a terminal state (cancelled/refunded).
   */
  readonly canShowKitchenDispatch = computed<boolean>(() => {
    const order = this.order();
    if (!order) return false;
    if (!this.isRestaurant()) return false;
    if (this.pendingKitchenItems().length === 0) return false;
    const terminalStates: OrderState[] = ['cancelled', 'refunded'];
    if (terminalStates.includes(order.state as OrderState)) return false;
    return true;
  });
  isLoadingPaymentReceipt = signal(false);
  loadingPaymentReceiptId = signal<number | null>(null);
  paymentReceiptPreview = signal<PaymentReceiptPreview | null>(null);

  // Pre-selected installment for pay modal
  preSelectedInstallment = signal<any>(null);

  // Manual mode flags (use modals but call updateOrderStatus instead of flow endpoints)
  isManualShipMode = signal(false);
  isManualDeliverMode = signal(false);

  // Payment methods for pay modal
  paymentMethods = signal<StorePaymentMethod[]>([]);

  // Shipping method assignment
  shippingMethods = signal<StoreShippingMethod[]>([]);
  isLoadingShippingMethods = signal(false);
  showShippingMethodCard = signal(false);
  selectedShippingMethodId = signal<number | null>(null);
  selectedShippingRateId = signal<number | null>(null);
  shippingAssignForm!: FormGroup;

  // Shipping rate auto-calculation
  isCalculatingRate = signal(false);
  calculatedRate = signal<{ rate_id: number; cost: number; rate_name?: string; zone?: string } | null>(null);
  manualCostOverride = signal(false);

  // Fast-track
  showFastTrackModal = signal(false);
  fastTrackEnabled = signal(false);
  fastTrackForm!: FormGroup;

  // Reactive forms (ship, deliver, cancel — pay and refund are in their own components)
  shipForm!: FormGroup;
  deliverForm!: FormGroup;
  cancelForm!: FormGroup;
  reactivateForm!: FormGroup;

  // Currency
  currencySymbol;

  // ── Computed signals ───────────────────────────────────────

  readonly flowMetadata = computed<OrderFlowMetadata>(() => {
    const order = this.order();
    if (!order?.internal_notes) return {};
    try {
      return JSON.parse(order.internal_notes) as OrderFlowMetadata;
    } catch {
      return {};
    }
  });

  private readonly HAPPY_PATH: OrderState[] = [
    'created',
    'pending_payment',
    'processing',
    'shipped',
    'delivered',
    'finished',
  ];

  // ── Step Labels (delivery-type aware) ──────────────────────

  readonly stepLabels = computed<Record<string, string>>(() => {
    const delivery = this.order()?.delivery_type || 'direct_delivery';

    const labels: Record<DeliveryType, Record<string, string>> = {
      home_delivery: {
        created: 'Creada',
        pending_payment: 'Pago Pendiente',
        processing: 'Procesando',
        shipped: 'Enviada',
        delivered: 'Entregada',
        finished: 'Finalizada',
      },
      pickup: {
        created: 'Creada',
        pending_payment: 'Pago Pendiente',
        processing: 'Preparando',
        shipped: 'Lista para Recoger',
        delivered: 'Recogida',
        finished: 'Finalizada',
      },
      direct_delivery: {
        created: 'Creada',
        pending_payment: 'Pago Pendiente',
        processing: 'Procesando',
        shipped: 'Despachada',
        delivered: 'Entregada',
        finished: 'Finalizada',
      },
      other: {
        created: 'Creada',
        pending_payment: 'Pago Pendiente',
        processing: 'Procesando',
        shipped: 'Despachada',
        delivered: 'Entregada',
        finished: 'Finalizada',
      },
    };

    return labels[delivery] || labels.direct_delivery;
  });

  readonly lifecycleSteps = computed<LifecycleStep[]>(() => {
    const order = this.order();
    if (!order) return [];

    const state = order.state;
    const labels = this.stepLabels();

    // Terminal states
    if (state === 'cancelled' || state === 'refunded') {
      const terminalLabel = state === 'cancelled' ? 'Cancelada' : 'Reembolsada';
      return [
        ...this.HAPPY_PATH.slice(0, 1).map((key) => ({
          key,
          label: labels[key] || key,
          status: 'completed' as const,
        })),
        { key: state, label: terminalLabel, status: 'terminal' as const },
      ];
    }

    const currentIndex = this.HAPPY_PATH.indexOf(state);
    if (currentIndex === -1) return [];

    return this.HAPPY_PATH.map((key, i) => ({
      key,
      label: labels[key] || key,
      status:
        i < currentIndex
          ? ('completed' as const)
          : i === currentIndex
            ? ('current' as const)
            : ('upcoming' as const),
    }));
  });

  // ── Channel Config ─────────────────────────────────────────

  readonly channelConfig = computed(() => {
    const channel = this.order()?.channel;
    const configs: Record<string, { label: string; icon: string; color: string }> = {
      pos: { label: 'POS', icon: 'monitor', color: 'blue' },
      ecommerce: { label: 'E-commerce', icon: 'shopping-cart', color: 'green' },
      whatsapp: { label: 'WhatsApp', icon: 'message-circle', color: 'emerald' },
      agent: { label: 'Agente', icon: 'headphones', color: 'purple' },
      marketplace: { label: 'Marketplace', icon: 'store', color: 'orange' },
    };
    return configs[channel || 'pos'] || configs['pos'];
  });

  readonly deliveryConfig = computed(() => {
    const delivery = this.order()?.delivery_type || 'direct_delivery';
    const configs: Record<string, { label: string; icon: string }> = {
      home_delivery: { label: 'Envio a domicilio', icon: 'truck' },
      pickup: { label: 'Retiro en tienda', icon: 'map-pin' },
      direct_delivery: { label: 'Entrega directa', icon: 'package' },
      other: { label: 'Otro', icon: 'box' },
    };
    return configs[delivery] || configs['direct_delivery'];
  });

  readonly showShippingAssignment = computed(() => {
    const order = this.order();
    if (!order) return false;
    const terminalStates: OrderState[] = ['shipped', 'delivered', 'finished', 'cancelled', 'refunded'];
    if (terminalStates.includes(order.state as OrderState)) return false;
    if (order.delivery_type === 'direct_delivery') return false;
    return !order.shipping_method_id;
  });

  readonly shippingMethodInfo = computed(() => {
    const order = this.order();
    if (!order?.shipping_method) return null;
    const method = order.shipping_method;
    return {
      name: method.name,
      type: method.type,
      provider: method.provider_name,
      minDays: method.min_days,
      maxDays: method.max_days,
      logoUrl: method.logo_url,
      rate: order.shipping_rate?.name || null,
      cost: order.shipping_cost,
    };
  });

  readonly canEditShipping = computed(() => {
    const order = this.order();
    if (!order) return false;
    const lockedStates: OrderState[] = ['shipped', 'delivered', 'finished', 'cancelled', 'refunded'];
    return !lockedStates.includes(order.state as OrderState) && order.delivery_type !== 'direct_delivery';
  });

  readonly selectedShippingMethod = computed(() => {
    const id = this.selectedShippingMethodId();
    if (!id) return null;
    return this.shippingMethods().find(m => m.id === id) || null;
  });

  readonly shippingRatesForSelectedMethod = computed<ShippingRate[]>(() => {
    const m = this.selectedShippingMethod() as (StoreShippingMethod & { shipping_rates?: ShippingRate[]; rates?: ShippingRate[] }) | null;
    if (!m) return [];
    return m.shipping_rates ?? m.rates ?? [];
  });

  readonly finalShippingRateId = computed(() => {
    if (this.manualCostOverride()) return null;
    return this.calculatedRate()?.rate_id ?? null;
  });

  readonly finalShippingCost = computed(() => {
    if (this.manualCostOverride()) {
      return Number(this.shippingAssignForm?.get('shipping_cost')?.value) || 0;
    }
    return this.calculatedRate()?.cost ?? 0;
  });

  readonly blockedByMissingShipping = computed(() => {
    const o = this.order();
    if (!o) return false;
    const needsShipping = o.delivery_type !== 'direct_delivery' && o.delivery_type !== 'other';
    const terminal = ['cancelled', 'refunded', 'finished'].includes(o.state);
    return needsShipping && !o.shipping_method_id && !terminal;
  });

  readonly canFastTrack = computed(() => {
    const o = this.order();
    if (!o) return false;
    if (['finished', 'cancelled', 'refunded'].includes(o.state)) return false;
    if (this.blockedByMissingShipping()) return false;
    return (o.order_items?.length ?? 0) > 0;
  });

  // ── Sorted Timeline (chronological ascending, deduplicated) ──

  readonly sortedTimeline = computed(() => {
    const logs = this.rawTimeline();
    if (!logs || logs.length === 0) return [];

    // Sort ascending by created_at (oldest first)
    const sorted = [...logs].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    // Deduplicate: keep only the first CREATE event
    let seenCreate = false;
    return sorted.filter((log) => {
      const isCreate = log.action?.toUpperCase() === 'CREATE';
      if (isCreate) {
        if (seenCreate) return false;
        seenCreate = true;
      }
      return true;
    });
  });

  // ── Available Actions (state + delivery_type + payment aware) ──
  //
  // Matrix:
  // | State           | Delivery    | Payment | Actions                                            |
  // |-----------------|-------------|---------|----------------------------------------------------|
  // | pending_payment | shipping    | -       | Confirm Pay, Manual-Ship (modal), Cancel            |
  // | pending_payment | pickup      | -       | Confirm Pay, Manual-Ready-Pickup (dialog), Cancel   |
  // | processing      | shipping    | paid    | Ship (standard), Cancel                             |
  // | processing      | pickup      | paid    | Ship (standard), Direct-Deliver (modal), Cancel     |
  // | shipped         | any         | unpaid  | Confirm Payment only (no deliver)                   |
  // | shipped         | any         | paid    | Deliver (standard modal)                            |
  // | delivered       | any         | paid    | Finish (safety net), Refund                         |

  // ── Kitchen-order detection ──
  //
  // A POS/restaurant order is considered a "kitchen order" when at least one
  // of its items has been fired to the kitchen. The only kitchen signal the
  // detail payload (GET /store/orders/:id) exposes on `order_items` is the
  // `kitchen_ticket_items` array — populated only for prepared items sent to
  // the KDS. For kitchen orders in `processing`, shipping/dispatch actions are
  // irrelevant: the operator finalizes the order directly once the kitchen is
  // done (backend allows `processing → finished`).
  readonly isKitchenOrder = computed<boolean>(() => {
    const order = this.order();
    if (!order) return false;
    return (order.order_items ?? []).some(
      (item) => (item.kitchen_ticket_items?.length ?? 0) > 0,
    );
  });

  /**
   * Whether this order can produce a remisión (dispatch note). Mirrors the
   * backend gate in `createFromOrder`: kitchen orders finalize directly and
   * `direct_delivery` hands goods over at the counter — neither goes through
   * the remisión + recaudo cycle. Drives whether the unified "Despachar orden"
   * button opens the con/sin-remisión chooser or ships directly.
   */
  readonly canGenerateRemision = computed<boolean>(() => {
    const order = this.order();
    if (!order) return false;
    const delivery = order.delivery_type || 'direct_delivery';
    return !this.isKitchenOrder() && delivery !== 'direct_delivery';
  });

  readonly availableActions = computed<OrderActionConfig[]>(() => {
    const order = this.order();
    if (!order) return [];

    if (this.blockedByMissingShipping()) {
      return [
        {
          id: 'info',
          type: 'alert',
          color: 'warning',
          icon: 'alert-triangle',
          label: 'Asigna un metodo de envio para continuar con el flujo.',
        } as OrderActionConfig,
        { id: 'cancel', label: 'Cancelar Orden', icon: 'x-circle', variant: 'danger' },
      ];
    }

    const state = order.state;
    const delivery = order.delivery_type || 'direct_delivery';
    const channel = order.channel || 'pos';
    const isShipping = delivery === 'home_delivery' || delivery === 'direct_delivery' || delivery === 'other';
    const isPickup = delivery === 'pickup';
    const hasPaid = this.hasSuccessfulPayment();
    const actions: OrderActionConfig[] = [];

    switch (state) {
      // `draft` (POS counter orders before confirmation) behaves exactly like
      // `created`: register payment, modify (privileged), cancel. Fall-through.
      case 'draft':
      case 'created':
        if (channel !== 'pos' || !hasPaid) {
          actions.push({ id: 'pay', label: 'Registrar Pago', icon: 'credit-card', variant: 'primary' });
        }
        if (this.isPrivilegedUser()) {
          actions.push({ id: 'edit-order', label: 'Modificar Orden', icon: 'edit', variant: 'info' });
        }
        actions.push({ id: 'cancel', label: 'Cancelar Orden', icon: 'x-circle', variant: 'danger' });
        break;

      case 'pending_payment':
        actions.push({ id: 'confirm-payment', label: 'Confirmar Pago', icon: 'check-circle', variant: 'primary' });
        actions.push({ id: 'info', label: 'Esperando confirmacion de pago', icon: 'clock', type: 'alert', color: 'warning' });

        // COD (contra-entrega): dispatching is allowed BEFORE the payment is
        // confirmed so the route can carry the order and collect on delivery.
        if (this.canGenerateRemision()) {
          // Unified entry: one button → con/sin-remisión chooser. Both paths
          // ship the order without confirming payment (collect on delivery).
          actions.push({
            id: 'dispatch-order',
            label: 'Despachar sin confirmar pago',
            icon: 'truck',
            variant: 'warning',
          });
        } else if (isShipping) {
          // direct_delivery: no remisión; manual ship without confirming payment.
          actions.push({
            id: 'manual-ship',
            label: 'Despachar sin confirmar pago',
            icon: 'truck',
            variant: 'warning',
          });
        } else if (isPickup) {
          // Pickup: can mark "ready to pick up" without payment (confirm dialog)
          actions.push({
            id: 'manual-ready-pickup',
            label: 'Listo para Recoger',
            icon: 'package',
            variant: 'primary',
          });
        }

        actions.push({ id: 'cancel', label: 'Cancelar Orden', icon: 'x-circle', variant: 'danger' });

        // Si es crédito, reemplazar "Confirmar Pago" por "Registrar Pago"
        if (order.payment_form === '2') {
          const idx = actions.findIndex(a => a.id === 'confirm-payment');
          if (idx !== -1) {
            actions[idx] = { id: 'credit-payment', label: 'Registrar Pago', icon: 'credit-card', variant: 'primary' };
          }
          const infoIdx = actions.findIndex(a => a.id === 'info');
          if (infoIdx !== -1) actions.splice(infoIdx, 1);
        }
        break;

      case 'processing':
        if (this.isKitchenOrder()) {
          // Kitchen orders skip shipping/dispatch entirely: once the kitchen
          // finishes, the operator finalizes directly. Reuse the exact same
          // `finish` action config/handler as `delivered` (backend allows
          // `processing → finished`).
          actions.push({ id: 'finish', label: 'Finalizar Orden', icon: 'check-circle', variant: 'success' });
        } else if (this.canGenerateRemision()) {
          // Unified dispatch entry point: ONE button opens the con/sin-remisión
          // chooser. "Con remisión" runs the wizard (document + optional route)
          // then ships the order; "sin remisión" just marks it shipped. Both
          // paths converge with the order in `shipped` — no more duplicate
          // "Despachar Orden" + "Generar Remisión" buttons.
          actions.push({ id: 'dispatch-order', label: 'Despachar Orden', icon: 'truck', variant: 'primary' });
          if (isPickup) {
            // Pickup + paid: keep the "hand over at the counter now" shortcut
            // (skip shipped → delivered → auto-finalize).
            actions.push({
              id: 'direct-deliver',
              label: 'Entregar directamente',
              icon: 'package-check',
              variant: 'warning',
            });
          }
        } else {
          // direct_delivery: counter handover, no remisión cycle. Ship directly.
          actions.push({ id: 'ship', label: 'Despachar Orden', icon: 'package', variant: 'primary' });
        }
        if (this.isPrivilegedUser()) {
          actions.push({ id: 'cancel-payment', label: 'Cancelar Pago', icon: 'credit-card', variant: 'warning' });
        }
        actions.push({ id: 'cancel', label: 'Cancelar Orden', icon: 'x-circle', variant: 'danger' });
        break;

      case 'shipped':
        if (!hasPaid) {
          // Unpaid in shipped: open payment modal to register payment
          actions.push({
            id: 'pay',
            label: 'Registrar Pago',
            icon: 'credit-card',
            variant: 'primary',
          });
        } else {
          // Paid: standard deliver
          if (delivery === 'home_delivery') {
            actions.push({ id: 'deliver', label: 'Marcar como Entregado', icon: 'package-check', variant: 'primary' });
          } else if (isPickup) {
            actions.push({ id: 'deliver', label: 'Confirmar Recogida', icon: 'user-check', variant: 'primary' });
          } else {
            actions.push({ id: 'deliver', label: 'Confirmar Entrega', icon: 'check-circle', variant: 'primary' });
          }
        }
        break;

      case 'delivered':
        actions.push({ id: 'finish', label: 'Finalizar Orden', icon: 'check-circle', variant: 'success' });
        actions.push({ id: 'refund', label: 'Procesar Reembolso', icon: 'rotate-ccw', variant: 'warning' });
        break;

      case 'finished':
        if (order.payment_form === '2' && Number(order.remaining_balance) > 0.01) {
          actions.push({ id: 'credit-payment', label: 'Registrar Pago', icon: 'credit-card', variant: 'primary' });
        }
        actions.push({ id: 'refund', label: 'Procesar Reembolso', icon: 'rotate-ccw', variant: 'warning' });
        break;

      case 'cancelled':
        if (this.isPrivilegedUser()) {
          actions.push({
            id: 'reactivate',
            label: 'Reactivar Orden',
            icon: 'rotate-ccw',
            variant: 'warning',
          });
        }
        break;
      case 'refunded':
        break;
    }

    return actions;
  });

  // ── Ship Modal Config (delivery-type aware) ────────────────

  readonly shipModalConfig = computed(() => {
    const order = this.order();
    const delivery = order?.delivery_type || 'direct_delivery';
    const hasShippingInfo = !!order?.shipping_method;

    switch (delivery) {
      case 'home_delivery':
        return {
          title: 'Marcar como Enviado',
          showTracking: true,
          showCarrier: !hasShippingInfo,
          showNotes: true,
          showShippingInfo: hasShippingInfo,
          confirmLabel: 'Confirmar Envio',
        };
      case 'pickup':
        return {
          title: 'Marcar Listo para Recoger',
          showTracking: false,
          showCarrier: false,
          showNotes: true,
          showShippingInfo: hasShippingInfo,
          confirmLabel: 'Confirmar',
        };
      case 'direct_delivery':
      default:
        return {
          title: 'Despachar Orden',
          showTracking: false,
          showCarrier: !hasShippingInfo,
          showNotes: true,
          showShippingInfo: hasShippingInfo,
          confirmLabel: 'Confirmar Despacho',
        };
    }
  });

  // ── Shipment Tracking ─────────────────────────────────────

  readonly showShipmentTracking = computed(() => {
    const order = this.order();
    if (!order) return false;
    const delivery = order.delivery_type || 'direct_delivery';
    return (
      delivery === 'home_delivery' ||
      !!this.flowMetadata().tracking_number ||
      !!this.flowMetadata().carrier
    );
  });

  readonly trackingSteps = computed(() => {
    const order = this.order();
    if (!order) return [];

    const state = order.state;
    const stateOrder = ['created', 'pending_payment', 'processing', 'shipped', 'delivered', 'finished'];
    const stateIndex = stateOrder.indexOf(state);

    const steps = [
      { key: 'received', label: 'Orden recibida', status: 'pending' as string },
      { key: 'preparing', label: 'Preparando envio', status: 'pending' as string },
      { key: 'in_transit', label: 'En camino', status: 'pending' as string },
      { key: 'delivered', label: 'Entregado', status: 'pending' as string },
    ];

    // Map order states to tracking steps
    if (stateIndex >= 0) steps[0].status = 'completed'; // received
    if (stateIndex >= 2) steps[1].status = 'completed'; // preparing (processing)
    if (stateIndex >= 3) {
      steps[1].status = 'completed';
      steps[2].status = stateIndex === 3 ? 'current' : 'completed'; // in_transit (shipped)
    }
    if (stateIndex >= 4) {
      steps[2].status = 'completed';
      steps[3].status = 'completed'; // delivered
    }

    // Mark current step
    if (stateIndex === 2) steps[1].status = 'current';
    if (stateIndex <= 1 && stateIndex >= 0) steps[0].status = 'current';

    return steps;
  });

  // ── Timeline Computed Signals (mapped to TimelineStep[]) ──

  readonly history_timeline_steps = computed<TimelineStep[]>(() => {
    const logs = this.sortedTimeline();
    if (logs.length === 0) {
      const order = this.order();
      return [{
        key: 'created',
        label: 'Orden Creada',
        status: 'current' as const,
        date: order ? this.formatDate(order.created_at) : '',
      }];
    }
    return logs.map((log, i) => ({
      key: `log-${i}`,
      label: this.getTimelineLabel(log),
      status: i === logs.length - 1 ? 'current' as const : 'completed' as const,
      date: this.formatDate(log.created_at),
      data: log,
    }));
  });

  readonly lifecycle_steps_timeline = computed<TimelineStep[]>(() =>
    this.lifecycleSteps().map(step => ({
      ...step,
      variant: step.status === 'terminal'
        ? (step.key === 'cancelled' ? 'danger' : 'warning') as TimelineVariant
        : 'default' as TimelineVariant,
    })),
  );

  readonly tracking_steps_timeline = computed<TimelineStep[]>(() =>
    this.trackingSteps().map(step => ({
      key: step.key,
      label: step.label,
      status: step.status as TimelineStep['status'],
      variant: 'default' as TimelineVariant,
    })),
  );

  // ── Credit Order Computed Signals ────────────────────────────
  readonly isCreditOrder = computed(() => this.order()?.payment_form === '2');

  readonly isInstallmentCredit = computed(() =>
    this.isCreditOrder() && this.order()?.credit_type === 'installments'
  );

  readonly isFreeCredit = computed(() =>
    this.isCreditOrder() && this.order()?.credit_type === 'free'
  );

  readonly creditTotal = computed(() => {
    const order = this.order();
    if (!order) return 0;
    return Number(order.total_with_interest || order.grand_total) || 0;
  });

  readonly totalPaid = computed(() => Number(this.order()?.total_paid) || 0);

  readonly remainingBalance = computed(() => Number(this.order()?.remaining_balance) || 0);

  readonly paymentProgress = computed(() => {
    const total = this.creditTotal();
    if (total <= 0) return 0;
    return Math.min(Math.round((this.totalPaid() / total) * 100), 100);
  });

  readonly nextInstallment = computed(() => {
    const installments = this.order()?.order_installments;
    if (!installments) return null;
    return installments.find(
      (i) => i.state === 'overdue' || i.state === 'pending' || i.state === 'partial'
    ) || null;
  });

  readonly overdueCount = computed(() => {
    const installments = this.order()?.order_installments;
    if (!installments) return 0;
    return installments.filter((i) => i.state === 'overdue').length;
  });

  readonly interestTypeLabel = computed(() => {
    const type = this.order()?.interest_type;
    if (!type) return '';
    return type === 'simple' ? 'Simple' : 'Compuesto';
  });

  readonly totalInterestAmount = computed(() => {
    const installments = this.order()?.order_installments;
    if (!installments?.length) {
      const twi = Number(this.order()?.total_with_interest) || 0;
      const gt = Number(this.order()?.grand_total) || 0;
      return twi > gt ? Math.round((twi - gt) * 100) / 100 : 0;
    }
    return Math.round(installments.reduce((sum: number, i: any) => sum + (Number(i.interest_amount) || 0), 0) * 100) / 100;
  });

  readonly effectiveInterestPercent = computed(() => {
    const principal = Number(this.order()?.grand_total) || 0;
    if (principal <= 0 || this.totalInterestAmount() <= 0) return 0;
    return Math.round((this.totalInterestAmount() / principal) * 10000) / 100;
  });

  // ── Sticky Header Configuration ───────────────────────────

  readonly headerTitle = computed(() => {
    const order = this.order();
    return order ? `Orden #${order.order_number}` : 'Cargando...';
  });

  readonly headerSubtitle = computed(() => {
    const order = this.order();
    if (!order) return '';
    const date = this.formatDate(order.created_at);
    const store = order.stores?.name || order.store_id;
    return `${date} • Tienda: ${store}`;
  });

  readonly headerBadgeText = computed(() => {
    const order = this.order();
    return order ? this.formatStatus(order.state) : '';
  });

  readonly headerBadgeColor = computed<StickyHeaderBadgeColor>(() => {
    const order = this.order();
    if (!order) return 'gray';
    const colorMap: Record<string, StickyHeaderBadgeColor> = {
      draft: 'gray',
      created: 'gray',
      pending_payment: 'yellow',
      processing: 'blue',
      shipped: 'blue',
      delivered: 'green',
      cancelled: 'red',
      refunded: 'yellow',
      finished: 'green',
    };
    return colorMap[order.state || ''] || 'gray';
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    { id: 'print', label: 'Imprimir', variant: 'outline', icon: 'printer' },
  ]);

  readonly paymentReceiptSubtitle = computed(() => {
    const receipt = this.paymentReceiptPreview();
    if (!receipt) return '';
    return receipt.uploadedAt
      ? `Subido ${this.formatDate(receipt.uploadedAt)}`
      : 'Archivo adjunto por el cliente';
  });

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private ordersService = inject(StoreOrdersService);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);
  private paymentMethodsService = inject(PaymentMethodsService);
  public shippingMethodsService = inject(ShippingMethodsService);
  private currencyService = inject(CurrencyFormatService);
  private authFacade = inject(AuthFacade);
  private ticketService = inject(PosTicketService);
  private posShippingService = inject(PosShippingService);
  // Plan KDS fire-flows (F3): manual selective fire for online orders
  // with `prepared` items that were never auto-fired (the auto-fire
  // runs in the payment $transaction; for orders paid before this
  // patch, or for online orders not auto-fireable, the operator can
  // dispatch them from this page).
  private kitchenTicketsService = inject(KitchenTicketsService);
  private sanitizer = inject(DomSanitizer);

  constructor() {
    this.currencySymbol = this.currencyService.currencySymbol;
    this.isPrivilegedUser.set(this.authFacade.isAdmin() || this.authFacade.isOwner());

    this.shippingAssignForm = this.fb.group({
      shipping_method_id: [null],
      shipping_cost: [0],
    });

    this.shipForm = this.fb.group({
      tracking_number: [''],
      carrier: [''],
      notes: [''],
    });

    this.deliverForm = this.fb.group({
      delivered_to: [''],
      delivery_notes: [''],
    });

    this.cancelForm = this.fb.group({
      reason: ['', [Validators.required, Validators.minLength(3)]],
    });

    this.reactivateForm = this.fb.group({
      reason: ['', [Validators.minLength(3)]],
    });

    this.fastTrackForm = this.fb.group({
      payment: this.fb.group({
        payment_method_id: this.fb.control<number | null>(null),
        amount: this.fb.control<number | null>(null),
        reference: this.fb.control<string>(''),
      }),
      ship: this.fb.group({
        tracking_number: this.fb.control<string>(''),
        carrier: this.fb.control<string>(''),
        notes: this.fb.control<string>(''),
      }),
      deliver: this.fb.group({
        delivered_to: this.fb.control<string>(''),
        delivery_notes: this.fb.control<string>(''),
      }),
    });

    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.orderId = params.get('id');
      if (this.orderId) {
        this.loadData();
      }
    });
  }

  loadData(): void {
    if (!this.orderId) return;

    this.isLoading.set(true);
    this.error = null;

    forkJoin({
      order: this.ordersService.getOrderById(this.orderId),
      timeline: this.ordersService.getOrderTimeline(this.orderId),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ order, timeline }) => {
          const orderData = (order as any).data || order;
          this.order.set({
            ...orderData,
            grand_total: Number(orderData.grand_total),
            subtotal_amount: Number(orderData.subtotal_amount),
            tax_amount: Number(orderData.tax_amount),
            shipping_cost: Number(orderData.shipping_cost),
            discount_amount: Number(orderData.discount_amount),
            total_paid: Number(orderData.total_paid) || 0,
            remaining_balance: Number(orderData.remaining_balance) || 0,
            total_with_interest: orderData.total_with_interest ? Number(orderData.total_with_interest) : undefined,
            interest_rate: orderData.interest_rate ? Number(orderData.interest_rate) : undefined,
            order_installments: (orderData.order_installments || []).map((inst: any) => ({
              ...inst,
              amount: Number(inst.amount),
              capital_amount: Number(inst.capital_amount),
              interest_amount: Number(inst.interest_amount),
              amount_paid: Number(inst.amount_paid),
              remaining_balance: Number(inst.remaining_balance),
            })),
            order_items: (orderData.order_items || []).map((item: any) => ({
              ...item,
              unit_price: Number(item.unit_price),
              total_price: Number(item.total_price),
              quantity: Number(item.quantity),
              stock_units_consumed:
                item.stock_units_consumed != null
                  ? Number(item.stock_units_consumed)
                  : null,
            })),
            // Persisted discount snapshots — numeric coercion only,
            // never recalculated against current promotions/coupons.
            order_promotions: (orderData.order_promotions || []).map(
              (op: any) => ({
                ...op,
                discount_amount: Number(op.discount_amount || 0),
              }),
            ),
            coupon_uses: (orderData.coupon_uses || []).map((cu: any) => ({
              ...cu,
              discount_applied: Number(cu.discount_applied || 0),
            })),
          });

          this.rawTimeline.set((timeline as any).data || timeline || []);
          this.isLoading.set(false);

          // Load payment methods if order can accept payment
          const needsPayment = orderData.state === 'created' ||
            orderData.payment_form === '2' ||
            (orderData.state === 'shipped' && !(orderData.payments || []).some((p: any) => p.state === 'succeeded'));
          if (needsPayment) {
            this.loadPaymentMethods();
          }

          // Load refund history
          this.loadRefunds();
        },
        error: (err) => {
          console.error('Error loading order data:', err);
          this.error = 'No se pudo cargar la informacion de la orden.';
          this.isLoading.set(false);
        },
      });
  }

  loadPaymentMethods(): void {
    this.paymentMethodsService
      .getStorePaymentMethods({ state: PaymentMethodState.ENABLED, limit: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          const methods = res?.data || res || [];
          this.paymentMethods.set(Array.isArray(methods) ? methods : []);
        },
        error: () => {
          this.paymentMethods.set([]);
        },
      });
  }

  loadRefunds(): void {
    if (!this.orderId) return;
    this.ordersService
      .getOrderRefunds(this.orderId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (refunds) => {
          this.orderRefunds.set(
            (Array.isArray(refunds) ? refunds : []).map((r: any) => ({
              ...r,
              amount: Number(r.amount),
            })),
          );
        },
        error: () => {
          this.orderRefunds.set([]);
        },
      });
  }

  // ── Action Dispatcher ──────────────────────────────────────

  executeAction(actionId: string): void {
    switch (actionId) {
      case 'pay':
        this.openPayModal();
        break;
      case 'confirm-payment':
      case 'confirm-payment-shipped':
        this.confirmPayment();
        break;
      case 'cancel-payment':
        this.cancelPayment();
        break;
      case 'edit-order':
        this.editOrderInPos();
        break;
      case 'ship':
        this.openShipModal();
        break;
      case 'deliver':
        this.openDeliverModal();
        break;
      case 'finish':
        this.confirmDelivery();
        break;
      case 'cancel':
        this.openCancelModal();
        break;
      case 'reactivate':
        this.openReactivateModal();
        break;
      case 'refund':
        this.openRefundModal();
        break;
      case 'manual-ship':
        this.handleManualShip();
        break;
      case 'manual-ready-pickup':
        this.submitManualStateTransition('shipped');
        break;
      case 'direct-deliver':
        this.handleDirectDeliver();
        break;
      case 'credit-payment':
        this.openPayModal();
        break;
      case 'generate-dispatch':
        this.openDispatchModal();
        break;
      case 'dispatch-order':
        this.openDispatchSelector();
        break;
    }
  }

  // ── Flow Actions ───────────────────────────────────────────

  openPayModal(): void {
    if (this.paymentMethods().length === 0) {
      this.loadPaymentMethods();
    }
    this.preSelectedInstallment.set(null);
    this.showPayModal.set(true);
  }

  onPaymentSubmitted(dto: PayOrderDto): void {
    if (!this.orderId) return;
    this.isProcessingAction.set(true);

    const request$ = this.isCreditOrder()
      ? this.ordersService.flowCreditPayment(this.orderId, dto)
      : this.ordersService.flowPayOrder(this.orderId, dto);

    request$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.showPayModal.set(false);
          this.isProcessingAction.set(false);
          const changeMsg = res.payment?.change
            ? ` — Cambio: ${this.currencyService.format(res.payment.change)}`
            : '';
          this.toastService.success(`Pago registrado exitosamente${changeMsg}`);
          this.loadData();
        },
        error: (err) => {
          this.isProcessingAction.set(false);
          this.toastService.error(err.message || 'Error al registrar el pago');
        },
      });
  }

  openShipModal(): void {
    this.shipForm.reset();
    this.showShipModal.set(true);
  }

  handleManualShip(): void {
    this.isManualShipMode.set(true);
    this.openShipModal();
  }

  submitShipment(): void {
    if (!this.orderId) return;

    this.isProcessingAction.set(true);
    const dto = this.shipForm.value;
    Object.keys(dto).forEach((key) => {
      if (dto[key] === '' || dto[key] === null) delete dto[key];
    });

    const isManual = this.isManualShipMode();
    const request$ = isManual
      ? this.ordersService.updateOrderStatus(this.orderId, 'shipped')
      : this.ordersService.flowShipOrder(this.orderId, dto);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.showShipModal.set(false);
        this.isProcessingAction.set(false);
        this.isManualShipMode.set(false);
        this.toastService.success(
          isManual ? 'Orden despachada sin confirmar pago' : 'Orden marcada como enviada',
        );
        this.loadData();
      },
      error: (err) => {
        this.isProcessingAction.set(false);
        this.isManualShipMode.set(false);
        this.toastService.error(err.message || 'Error al enviar la orden');
      },
    });
  }

  // ── Generar Remision (dispatch note from order) ────────────

  openDispatchModal(): void {
    this.showDispatchModal.set(true);
  }

  // ── Unified dispatch entry (con/sin remisión) ──────────────

  /**
   * Single dispatch entry point. Orders that can produce a remisión open the
   * con/sin-remisión chooser; `direct_delivery` (no remisión possible) ships
   * straight away. This is what collapses the old two-button UX into one flow.
   */
  openDispatchSelector(): void {
    if (!this.canGenerateRemision()) {
      this.startShipWithoutNote();
      return;
    }
    this.showDispatchSelector.set(true);
  }

  /** Route the chooser outcome to the wizard or the plain ship flow. */
  onDispatchMethodSelected(method: DispatchMethod): void {
    this.showDispatchSelector.set(false);
    if (method === 'with-note') {
      this.openDispatchModal();
    } else {
      this.startShipWithoutNote();
    }
  }

  /**
   * "Sin remisión" path: mark the order shipped without any dispatch document.
   * For COD (`pending_payment`) we go through the manual ship mode, which
   * advances the state without confirming payment (collect on delivery). For
   * `processing` it's the regular flow ship. Both reuse the existing ship modal.
   */
  private startShipWithoutNote(): void {
    const order = this.order();
    if (!order) return;
    if (order.state === 'pending_payment') {
      this.isManualShipMode.set(true);
    }
    this.openShipModal();
  }

  /**
   * Called by the generate-dispatch wizard once the dispatch note (and, if
   * requested, its route) is created in a single backend transaction. The
   * remisión is the document; here we make the flow converge by advancing the
   * order to `shipped`, then offer navigation to the new remisión.
   */
  onDispatchGenerated(dispatchNoteId: number): void {
    this.showDispatchModal.set(false);
    this.shipAfterDispatch(dispatchNoteId);
  }

  /**
   * Advance the order to `shipped` after a remisión was generated, so the
   * "con remisión" path converges with "sin remisión". Picks the right
   * transition: `processing` → flow ship; COD `pending_payment` → manual
   * state change (no payment confirmation). If the order is already past
   * shipment we skip straight to the navigation prompt. A failed ship is
   * non-fatal: the remisión already exists, so we surface a warning and still
   * offer to view it.
   */
  private shipAfterDispatch(dispatchNoteId: number): void {
    const order = this.order();
    if (!order || !this.orderId) {
      this.promptViewDispatchNote(dispatchNoteId);
      return;
    }

    if (order.state !== 'processing' && order.state !== 'pending_payment') {
      this.promptViewDispatchNote(dispatchNoteId);
      return;
    }

    const ship$ =
      order.state === 'processing'
        ? this.ordersService.flowShipOrder(this.orderId, {})
        : this.ordersService.updateOrderStatus(this.orderId, 'shipped');

    this.isProcessingAction.set(true);
    ship$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.isProcessingAction.set(false);
        this.toastService.success('Orden despachada y marcada como enviada');
        this.promptViewDispatchNote(dispatchNoteId);
      },
      error: (err) => {
        this.isProcessingAction.set(false);
        // The remisión was created; only the state advance failed.
        this.toastService.warning(
          err?.message ||
            'Remisión creada. No se pudo marcar la orden como enviada automáticamente.',
        );
        this.promptViewDispatchNote(dispatchNoteId);
      },
    });
  }

  private promptViewDispatchNote(dispatchNoteId: number): void {
    this.dialogService
      .confirm({
        title: 'Remision generada',
        message: 'La remision se creo correctamente. Deseas verla ahora?',
        confirmText: 'Ver remision',
        cancelText: 'Seguir aqui',
        confirmVariant: 'primary',
      })
      .then((confirmed: boolean) => {
        if (confirmed) {
          this.router.navigate(['/admin/orders/dispatch-notes', dispatchNoteId]);
        } else {
          this.loadData();
        }
      });
  }

  openDeliverModal(): void {
    this.deliverForm.reset();
    this.showDeliverModal.set(true);
  }

  handleDirectDeliver(): void {
    this.isManualDeliverMode.set(true);
    this.openDeliverModal();
  }

  submitDelivery(): void {
    if (!this.orderId) return;

    this.isProcessingAction.set(true);
    const dto = this.deliverForm.value;
    Object.keys(dto).forEach((key) => {
      if (dto[key] === '' || dto[key] === null) delete dto[key];
    });

    const isManual = this.isManualDeliverMode();
    const request$ = isManual
      ? this.ordersService.updateOrderStatus(this.orderId, 'delivered')
      : this.ordersService.flowDeliverOrder(this.orderId, dto);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.showDeliverModal.set(false);
        this.isProcessingAction.set(false);

        if (isManual) {
          this.isManualDeliverMode.set(false);
          const order = this.order();
          const isPickup = order?.delivery_type === 'pickup';
          const hasPaid = this.hasSuccessfulPayment();

          // Auto-finalize for pickup + paid orders
          if (isPickup && hasPaid && this.orderId) {
            this.toastService.success('Orden entregada. Finalizando...');
            this.ordersService
              .flowConfirmDelivery(this.orderId)
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe({
                next: () => {
                  this.toastService.success('Orden finalizada exitosamente');
                  this.loadData();
                },
                error: () => {
                  this.toastService.warning(
                    'La entrega fue exitosa, pero no se pudo finalizar automaticamente. Usa el boton "Finalizar" como respaldo.',
                  );
                  this.loadData();
                },
              });
          } else {
            this.toastService.success('Orden marcada como entregada');
            this.loadData();
          }
        } else {
          this.toastService.success('Orden marcada como entregada');
          this.loadData();
        }
      },
      error: (err) => {
        this.isProcessingAction.set(false);
        this.isManualDeliverMode.set(false);
        this.toastService.error(err.message || 'Error al marcar la entrega');
      },
    });
  }

  confirmPayment(): void {
    if (!this.orderId) return;

    this.dialogService
      .confirm({
        title: 'Confirmar Pago',
        message: '¿Confirmar que el pago de esta orden ha sido recibido?',
        confirmText: 'Confirmar Pago',
        cancelText: 'Cancelar',
        confirmVariant: 'primary',
      })
      .then((confirmed: boolean) => {
        if (!confirmed || !this.orderId) return;

        this.isProcessingAction.set(true);
        this.ordersService
          .flowConfirmPayment(this.orderId)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.isProcessingAction.set(false);
              this.toastService.success('Pago confirmado exitosamente');
              this.loadData();
            },
            error: (err) => {
              this.isProcessingAction.set(false);
              this.toastService.error(err.message || 'Error al confirmar el pago');
            },
          });
      });
  }

  confirmDelivery(): void {
    if (!this.orderId) return;

    this.dialogService
      .confirm({
        title: 'Finalizar Orden',
        message: '¿Confirmar que esta orden ha sido completada exitosamente?',
        confirmText: 'Finalizar',
        cancelText: 'Cancelar',
        confirmVariant: 'primary',
      })
      .then((confirmed: boolean) => {
        if (!confirmed || !this.orderId) return;

        this.isProcessingAction.set(true);
        this.ordersService
          .flowConfirmDelivery(this.orderId)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.isProcessingAction.set(false);
              this.toastService.success('Orden finalizada exitosamente');
              this.loadData();
            },
            error: (err) => {
              this.isProcessingAction.set(false);
              this.toastService.error(err.message || 'Error al finalizar la orden');
            },
          });
      });
  }

  submitManualStateTransition(target: OrderState): void {
    if (!this.orderId) return;

    this.dialogService
      .confirm({
        title: 'Listo para recoger sin pago',
        message: '¿Marcar esta orden como lista para recoger sin confirmar el pago? El pago deberá confirmarse antes de entregar al cliente.',
        confirmText: 'Marcar como lista',
        cancelText: 'Cancelar',
        confirmVariant: 'primary',
      })
      .then((confirmed: boolean) => {
        if (!confirmed || !this.orderId) return;

        this.isProcessingAction.set(true);
        this.ordersService
          .updateOrderStatus(this.orderId, target)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.isProcessingAction.set(false);
              this.toastService.success('Orden marcada como lista para recoger');
              this.loadData();
            },
            error: (err) => {
              this.isProcessingAction.set(false);
              this.toastService.error(err.message || 'Error al actualizar el estado de la orden');
            },
          });
      });
  }

  openCancelModal(): void {
    this.cancelForm.reset();
    this.showCancelModal.set(true);
  }

  submitCancellation(): void {
    if (this.cancelForm.invalid || !this.orderId) return;

    this.isProcessingAction.set(true);
    this.ordersService
      .flowCancelOrder(this.orderId, this.cancelForm.value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.showCancelModal.set(false);
          this.isProcessingAction.set(false);
          this.toastService.success('Orden cancelada');
          this.loadData();
        },
        error: (err) => {
          this.isProcessingAction.set(false);
          this.toastService.error(err.message || 'Error al cancelar la orden');
        },
      });
  }

  openReactivateModal(): void {
    this.reactivateForm.reset();
    this.showReactivateModal.set(true);
  }

  submitReactivation(): void {
    if (!this.orderId) return;

    // Build DTO from the form; reason is optional but must be at least
    // 3 chars when present (validator enforces that).
    const formValue = this.reactivateForm.value as { reason: string | null };
    const dto: ReactivateOrderDto = formValue.reason
      ? { reason: formValue.reason }
      : {};

    this.isProcessingAction.set(true);
    this.ordersService
      .flowReactivateOrder(this.orderId, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.showReactivateModal.set(false);
          this.isProcessingAction.set(false);
          this.toastService.success('Orden reactivada');
          this.loadData();
        },
        error: (err) => {
          this.isProcessingAction.set(false);
          // Backend may return a list of missing products under
          // err.error.details.missing. Surface them so the operator knows
          // exactly what to restock before retrying.
          const missing: Array<{ product_name: string; available: number; required: number }> | undefined =
            err?.error?.details?.missing;
          const base = err.message || 'Error al reactivar la orden';
          if (Array.isArray(missing) && missing.length > 0) {
            const list = missing
              .map(
                (m) =>
                  `  - ${m.product_name} (disponible ${m.available}, requerido ${m.required})`,
              )
              .join('\n');
            this.toastService.error(`${base}\n${list}`);
          } else {
            this.toastService.error(base);
          }
        },
      });
  }

  openFastTrackModal(): void {
    if (this.paymentMethods().length === 0) {
      this.loadPaymentMethods();
    }
    const order = this.order();
    if (order && !this.hasSuccessfulPayment()) {
      this.fastTrackForm.get('payment')?.patchValue({ amount: Number(order.grand_total) || 0 });
    }
    this.showFastTrackModal.set(true);
  }

  submitFastTrack(): void {
    if (!this.orderId) return;

    const paymentGroup = this.fastTrackForm.get('payment')!.value as { payment_method_id: number | null; amount: number | null; reference: string };
    const shipGroup = this.fastTrackForm.get('ship')!.value as Record<string, unknown>;
    const deliverGroup = this.fastTrackForm.get('deliver')!.value as Record<string, unknown>;

    const dto: FastTrackOrderDto = {};
    if (!this.hasSuccessfulPayment() && paymentGroup.payment_method_id) {
      dto.payment = {
        payment_method_id: Number(paymentGroup.payment_method_id),
        amount: Number(paymentGroup.amount) || undefined,
        reference: paymentGroup.reference || undefined,
      } as any;
    }
    const shipClean = this.compactObject(shipGroup);
    if (Object.keys(shipClean).length) dto.ship = shipClean as any;
    const deliverClean = this.compactObject(deliverGroup);
    if (Object.keys(deliverClean).length) dto.deliver = deliverClean as any;

    this.isProcessingAction.set(true);
    this.ordersService
      .flowFastTrack(this.orderId, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isProcessingAction.set(false);
          this.showFastTrackModal.set(false);
          this.fastTrackEnabled.set(false);
          this.toastService.success('Orden procesada exitosamente');
          this.loadData();
        },
        error: (err) => {
          this.isProcessingAction.set(false);
          this.toastService.error(err.message || 'Error al procesar la orden');
        },
      });
  }

  private compactObject<T extends Record<string, any>>(obj: T): Partial<T> {
    const out: any = {};
    Object.keys(obj).forEach(k => {
      if (obj[k] !== '' && obj[k] !== null && obj[k] !== undefined) out[k] = obj[k];
    });
    return out;
  }

  openRefundModal(): void {
    this.showRefundModal.set(true);
  }

  onRefundSubmitted(): void {
    this.showRefundModal.set(false);
    this.toastService.success('Reembolso procesado exitosamente');
    this.loadData();
  }

  copyTrackingNumber(): void {
    const tracking = this.flowMetadata().tracking_number;
    if (tracking) {
      navigator.clipboard.writeText(tracking).then(() => {
        this.toastService.success('Numero de rastreo copiado');
      });
    }
  }

  // ── Header & Navigation ────────────────────────────────────

  onHeaderAction(actionId: string): void {
    if (actionId === 'print') {
      this.printOrder();
    } else if (actionId === 'credit-payment') {
      this.openPayModal();
    }
  }

  async viewPaymentReceipt(payment: Payment): Promise<void> {
    if (!this.orderId) return;

    this.isLoadingPaymentReceipt.set(true);
    this.loadingPaymentReceiptId.set(payment.id);

    try {
      const res = await firstValueFrom(
        this.ordersService.getPaymentReceiptUrl(this.orderId, payment.id),
      );

      this.paymentReceiptPreview.set({
        url: res.url,
        safeUrl: this.sanitizer.bypassSecurityTrustResourceUrl(res.url),
        kind: this.getPaymentReceiptPreviewKind(
          res.content_type,
          payment.receipt_s3_key,
          res.url,
        ),
        uploadedAt: payment.receipt_uploaded_at,
      });
      this.showPaymentReceiptModal.set(true);
    } catch (err: unknown) {
      this.toastService.error(
        err instanceof Error ? err.message : 'No se pudo abrir el comprobante',
        'Error',
      );
    } finally {
      this.isLoadingPaymentReceipt.set(false);
      this.loadingPaymentReceiptId.set(null);
    }
  }

  closePaymentReceiptModal(): void {
    this.showPaymentReceiptModal.set(false);
    this.paymentReceiptPreview.set(null);
  }

  private getPaymentReceiptPreviewKind(
    contentType?: string,
    receiptKey?: string | null,
    url?: string,
  ): PaymentReceiptPreviewKind {
    const normalizedContentType = (contentType ?? '').toLowerCase();
    if (normalizedContentType.startsWith('image/')) return 'image';
    if (normalizedContentType.includes('pdf')) return 'pdf';

    const source = `${receiptKey ?? ''} ${url ?? ''}`
      .split('?')[0]
      .toLowerCase();
    if (/\.(jpe?g|png|webp)$/.test(source)) return 'image';
    return 'pdf';
  }

  async printOrder(): Promise<void> {
    const orderData = this.order();
    if (!orderData) return;

    try {
      const ticketData = this.buildTicketData(orderData);
      const html = await this.ticketService.generateTicketHTML(ticketData);

      // Use iframe-based printing to avoid popup blockers
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = 'none';
      document.body.appendChild(iframe);

      const iframeDoc = iframe.contentWindow?.document;
      if (!iframeDoc) {
        document.body.removeChild(iframe);
        this.toastService.error('No se pudo preparar la impresion');
        return;
      }

      iframeDoc.open();
      iframeDoc.write(`
        <html>
          <head>
            <title>Ticket #${orderData.order_number}</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #fff; }
              .ticket { background: white; border: 1px solid #ccc; border-radius: 8px; }
              @media print {
                body { padding: 0; margin: 0; }
                .ticket { border: none; border-radius: 0; }
              }
            </style>
          </head>
          <body>${html}</body>
        </html>
      `);
      iframeDoc.close();

      // Wait for content to render, then print
      iframe.onload = () => {
        iframe.contentWindow?.print();
        // Clean up after print dialog closes
        setTimeout(() => {
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
          }
        }, 1000);
      };
    } catch (err) {
      console.error('Error generating ticket:', err);
      this.toastService.error('Error al generar el ticket');
    }
  }

  private buildTicketData(orderData: Order): TicketData {
    const items: TicketItem[] = (orderData.order_items || []).map((item) => ({
      id: String(item.id || '0'),
      name: item.product_name || 'Producto',
      sku: item.variant_sku || 'N/A',
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unit_price) || 0,
      totalPrice: Number(item.total_price) || 0,
      tax: Number(item.tax_amount_item) || 0,
      appliedPriceTierName: item.applied_price_tier_name_snapshot ?? null,
      isPackageUnit: this.hasPackageStockConsumption(item),
      unitsPerPackage: this.getPackageMultiplier(item),
    }));

    // Determine payment method from the latest succeeded payment
    const succeededPayment = (orderData.payments || []).find((p) => p.state === 'succeeded');
    const paymentMethod = succeededPayment?.gateway_response?.metadata?.payment_method || 'N/A';
    const cashReceived = succeededPayment?.gateway_response?.metadata?.amount_received;
    const change = succeededPayment?.gateway_response?.change;

    // Get cashier name from current user
    const user = this.authFacade.getCurrentUser();
    const cashierName = user ? `${user.first_name} ${user.last_name}` : 'Administrador';

    return {
      id: orderData.order_number || 'N/A',
      date: new Date(orderData.created_at || Date.now()),
      items,
      subtotal: Number(orderData.subtotal_amount) || 0,
      tax: Number(orderData.tax_amount) || 0,
      discount: Number(orderData.discount_amount) || 0,
      total: Number(orderData.grand_total) || 0,
      paymentMethod,
      cashReceived: cashReceived ? Number(cashReceived) : undefined,
      change: cashReceived ? Number(change || 0) : undefined,
      cashier: cashierName,
      transactionId: orderData.order_number,
      customer: orderData.users
        ? {
            name: `${orderData.users.first_name || ''} ${orderData.users.last_name || ''}`.trim() || 'Consumidor Final',
            email: orderData.users.email,
            phone: orderData.users.phone,
          }
        : { name: 'Consumidor Final' },
      store: orderData.stores
        ? {
            name: orderData.stores.name,
            address: '',
            phone: '',
            email: '',
            taxId: '',
            id: orderData.stores.id,
          }
        : undefined,
    };
  }

  goBack(): void {
    this.router.navigate(['/admin/orders']);
  }

  // ── Shipping Assignment ──────────────────────────────────

  openShippingAssignCard(): void {
    this.showShippingMethodCard.set(true);
    if (this.shippingMethods().length === 0) {
      this.isLoadingShippingMethods.set(true);
      this.shippingMethodsService
        .getStoreShippingMethods()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (methods) => {
            this.shippingMethods.set(methods.filter(m => m.is_active));
            this.isLoadingShippingMethods.set(false);
          },
          error: () => {
            this.shippingMethods.set([]);
            this.isLoadingShippingMethods.set(false);
          },
        });
    }
  }

  onShippingMethodSelect(methodId: number): void {
    this.selectedShippingMethodId.set(methodId);
    this.selectedShippingRateId.set(null);
    this.calculatedRate.set(null);
    this.manualCostOverride.set(false);
    this.shippingAssignForm.patchValue({ shipping_method_id: methodId, shipping_cost: 0 });

    const order = this.order();
    const address = order?.addresses_orders_shipping_address_idToaddresses;
    const items = order?.order_items ?? [];

    if (!address || items.length === 0) {
      this.manualCostOverride.set(true);
      this.toastService.warning('Sin direccion o items: ingresa el costo manualmente');
      return;
    }

    this.isCalculatingRate.set(true);
    const payloadItems = items.map(i => ({
      product_id: Number(i.product_id),
      quantity: Number(i.quantity),
      price: Number(i.unit_price),
    }));

    this.posShippingService
      .calculateShipping(payloadItems, {
        country_code: address.country_code || '',
        state_province: address.state_province,
        city: address.city,
        address_line1: address.address_line1,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (options: PosShippingOption[]) => {
          this.isCalculatingRate.set(false);
          const match = options.find(o => o.method_id === methodId);
          if (match && (match as any).rate_id) {
            this.calculatedRate.set({
              rate_id: (match as any).rate_id,
              cost: Number(match.cost),
              rate_name: (match as any).rate_name,
              zone: (match as any).zone_name,
            });
            this.shippingAssignForm.patchValue({ shipping_cost: Number(match.cost) });
          } else {
            this.manualCostOverride.set(true);
            this.toastService.warning('Este metodo no tiene tarifa para la direccion del cliente. Ingresa el costo manual.');
          }
        },
        error: () => {
          this.isCalculatingRate.set(false);
          this.manualCostOverride.set(true);
          this.toastService.error('No se pudo calcular la tarifa. Ingresa el costo manual.');
        },
      });
  }

  toggleManualCost(checked: boolean): void {
    this.manualCostOverride.set(checked);
    if (!checked && this.calculatedRate()) {
      this.shippingAssignForm.patchValue({ shipping_cost: this.calculatedRate()!.cost });
    }
  }

  submitShippingAssignment(): void {
    const methodId = this.selectedShippingMethodId();
    if (!this.orderId || !methodId) return;

    this.isProcessingAction.set(true);
    const dto: AssignShippingMethodDto = {
      shipping_method_id: methodId,
      shipping_rate_id: this.finalShippingRateId(),
      shipping_cost: this.finalShippingCost(),
    };

    this.ordersService
      .assignShippingMethod(this.orderId, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isProcessingAction.set(false);
          this.showShippingMethodCard.set(false);
          this.selectedShippingMethodId.set(null);
          this.selectedShippingRateId.set(null);
          this.calculatedRate.set(null);
          this.manualCostOverride.set(false);
          this.toastService.success('Metodo de envio asignado exitosamente');
          this.loadData();
        },
        error: (err) => {
          this.isProcessingAction.set(false);
          this.toastService.error(err.message || 'Error al asignar metodo de envio');
        },
      });
  }

  skipShippingAssignment(): void {
    this.showShippingMethodCard.set(false);
    this.selectedShippingMethodId.set(null);
    this.selectedShippingRateId.set(null);
    this.calculatedRate.set(null);
    this.manualCostOverride.set(false);
  }

  // ── Installment Actions ─────────────────────────────────────

  forgiveInstallment(installmentId: number, installmentNumber: number): void {
    if (!this.orderId) return;

    this.dialogService
      .confirm({
        title: 'Condonar Cuota',
        message: `¿Estás seguro de condonar la cuota #${installmentNumber}? El saldo pendiente de esta cuota se eliminará y no se podrá revertir.`,
        confirmText: 'Condonar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed: boolean) => {
        if (!confirmed || !this.orderId) return;

        this.isProcessingAction.set(true);
        this.ordersService
          .flowForgiveInstallment(this.orderId, installmentId)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.isProcessingAction.set(false);
              this.toastService.success(`Cuota #${installmentNumber} condonada exitosamente`);
              this.loadData();
            },
            error: (err: any) => {
              this.isProcessingAction.set(false);
              this.toastService.error(err.error?.message || err.message || 'Error al condonar la cuota');
            },
          });
      });
  }

  payInstallment(installment: any): void {
    if (this.paymentMethods().length === 0) {
      this.loadPaymentMethods();
    }
    this.preSelectedInstallment.set(installment);
    this.showPayModal.set(true);
  }

  // ── Helpers ────────────────────────────────────────────────

  getInstallmentStateClass(state: string): string {
    const classes: Record<string, string> = {
      pending: 'bg-yellow-500/20 text-yellow-400',
      paid: 'bg-green-500/20 text-green-400',
      partial: 'bg-blue-500/20 text-blue-400',
      overdue: 'bg-red-500/20 text-red-400',
      forgiven: 'bg-gray-500/20 text-gray-400',
    };
    return classes[state] || 'bg-gray-500/20 text-gray-400';
  }

  getInstallmentStateLabel(state: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      paid: 'Pagada',
      partial: 'Parcial',
      overdue: 'Vencida',
      forgiven: 'Condonada',
    };
    return labels[state] || state;
  }

  hasSuccessfulPayment(): boolean {
    const order = this.order();
    if (!order?.payments) return false;
    return order.payments.some((p) => p.state === 'succeeded');
  }

  cancelPayment(): void {
    if (!this.orderId) return;

    this.dialogService
      .confirm({
        title: 'Cancelar Pago',
        message: '¿Estás seguro de cancelar el pago de esta orden? La orden volverá al estado "Creada" y podrás registrar un nuevo pago.',
        confirmText: 'Cancelar Pago',
        cancelText: 'Volver',
        confirmVariant: 'danger',
      })
      .then((confirmed: boolean) => {
        if (!confirmed || !this.orderId) return;

        this.isProcessingAction.set(true);
        this.ordersService
          .flowCancelPayment(this.orderId, { reason: 'Cancelado desde panel de administración' })
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.isProcessingAction.set(false);
              this.toastService.success('Pago cancelado exitosamente. La orden ha vuelto a estado "Creada".');
              this.loadData();
            },
            error: (err) => {
              this.isProcessingAction.set(false);
              this.toastService.error(err.message || 'Error al cancelar el pago');
            },
          });
      });
  }

  editOrderInPos(): void {
    const order = this.order();
    if (!order) return;
    this.router.navigate(['/admin/pos'], { queryParams: { editOrder: order.id } });
  }

  getShippingTypeBadgeClass(type: string): string {
    const map: Record<string, string> = {
      own_fleet: 'bg-blue-100 text-blue-700',
      carrier: 'bg-purple-100 text-purple-700',
      third_party_provider: 'bg-amber-100 text-amber-700',
      pickup: 'bg-emerald-100 text-emerald-700',
      custom: 'bg-gray-100 text-gray-700',
    };
    return map[type] || 'bg-gray-100 text-gray-700';
  }

  getPaymentStateClass(state: string): string {
    const classes: Record<string, string> = {
      pending: 'bg-yellow-500/20 text-yellow-400',
      succeeded: 'bg-green-500/20 text-green-400',
      failed: 'bg-red-500/20 text-red-400',
      cancelled: 'bg-gray-500/20 text-gray-400',
      refunded: 'bg-orange-500/20 text-orange-400',
      authorized: 'bg-blue-500/20 text-blue-400',
      captured: 'bg-green-500/20 text-green-400',
      partially_refunded: 'bg-orange-500/20 text-orange-400',
    };
    return classes[state] || 'bg-gray-500/20 text-gray-400';
  }

  getPaymentStateLabel(state: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      succeeded: 'Exitoso',
      failed: 'Fallido',
      cancelled: 'Cancelado',
      refunded: 'Reembolsado',
      authorized: 'Autorizado',
      captured: 'Capturado',
      partially_refunded: 'Reembolso Parcial',
    };
    return labels[state] || state;
  }

  getStatusColor(status: string | undefined): string {
    const colors: Record<string, string> = {
      created: 'bg-gray-100 text-gray-800',
      pending_payment: 'bg-yellow-100 text-yellow-800',
      processing: 'bg-blue-100 text-blue-800',
      shipped: 'bg-indigo-100 text-indigo-800',
      delivered: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
      refunded: 'bg-orange-100 text-orange-800',
      finished: 'bg-green-100 text-green-800',
    };
    return colors[status || ''] || 'bg-gray-100 text-gray-800';
  }

  formatStatus(status: string | undefined): string {
    if (!status) return 'Desconocido';
    const labels: Record<string, string> = {
      draft: 'Borrador',
      created: 'Creada',
      pending_payment: 'Pago Pendiente',
      processing: 'Procesando',
      shipped: 'Enviada',
      delivered: 'Entregada',
      cancelled: 'Cancelada',
      refunded: 'Reembolsada',
      finished: 'Finalizada',
    };
    return labels[status] || status;
  }

  formatDate(dateString: string | undefined): string {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString();
  }

  getTimelineLabel(log: any): string {
    const newState = log.new_values?.state;
    const oldState = log.old_values?.state;

    if (newState) {
      // Detect manual transitions (skip payment flow)
      if (oldState === 'pending_payment' && newState === 'shipped') {
        return 'Despachada sin confirmar pago';
      }
      if (oldState === 'pending_payment' && newState === 'delivered') {
        return 'Entregada sin confirmar pago';
      }

      // Standard flow labels
      const stateLabels: Record<string, string> = {
        pending_payment: 'Pago Iniciado',
        processing: 'Pago Confirmado',
        shipped: 'Orden Enviada',
        delivered: 'Orden Entregada',
        finished: 'Orden Finalizada',
        cancelled: 'Orden Cancelada',
        refunded: 'Orden Reembolsada',
      };
      if (stateLabels[newState]) return stateLabels[newState];
    }

    // Fallback to generic action labels
    const action = log.action?.toUpperCase();
    const actionLabels: Record<string, string> = {
      CREATE: 'Orden Creada',
      UPDATE: 'Orden Actualizada',
      DELETE: 'Orden Eliminada',
    };
    return actionLabels[action] || log.action || 'Evento';
  }

  parseVariantAttributes(raw: unknown): VariantAttribute[] {
    return parseVariantAttributes(raw);
  }

  hasPackageStockConsumption(item: OrderItem): boolean {
    const consumed = Number(item.stock_units_consumed || 0);
    const quantity = Number(item.quantity || 0);
    return consumed > 0 && quantity > 0 && consumed !== quantity;
  }

  getPackageMultiplier(item: OrderItem): number | null {
    if (!this.hasPackageStockConsumption(item)) return null;
    const consumed = Number(item.stock_units_consumed || 0);
    const quantity = Number(item.quantity || 0);
    if (quantity <= 0) return null;
    return consumed / quantity;
  }

  // ─── Restaurant Suite — Fase K Gap 2: per-item KDS state ─────
  /**
   * Picks the kitchen_ticket_item we want to surface for this
   * order_item. Preference: a non-terminal (in-flight) row first,
   * then the most recent row (highest id). Returns `null` if the
   * item has never been fired to the kitchen.
   */
  kitchenStateFor(item: OrderItem):
    | { status: string; kitchen_ticket_id?: number }
    | null {
    const items = item.kitchen_ticket_items;
    if (!items || items.length === 0) return null;
    const inFlight = items.find(
      (k) => k.status === 'pending' || k.status === 'in_preparation' || k.status === 'ready',
    );
    if (inFlight) return inFlight;
    return items[0]; // items are pre-sorted desc by the backend include
  }

  // ─── Plan KDS fire-flows (F3): per-plate selection ───────────
  /** Toggle a single pending item in/out of the fire selection. */
  toggleKitchenItem(id: number): void {
    this.selectedKitchenItemIds.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** True if the given order_item is currently selected for fire. */
  isKitchenItemSelected(id: number): boolean {
    return this.selectedKitchenItemIds().has(id);
  }

  /** Select every pending (prepared, unfired) item. */
  selectAllPendingKitchen(): void {
    this.selectedKitchenItemIds.set(
      new Set(this.pendingKitchenItems().map((it) => it.id)),
    );
  }

  /** Clear the fire selection. */
  clearKitchenSelection(): void {
    this.selectedKitchenItemIds.set(new Set<number>());
  }

  /**
   * Plan KDS fire-flows (F3): fire the SELECTED `prepared` items to the
   * kitchen from the order detail page. If nothing is selected, falls back
   * to firing all pending items (legacy all-or-nothing behaviour). Re-fetches
   * the order on success so the kitchen_ticket_items badges refresh (the SSE
   * stream is not always live on this page).
   */
  fireSelectedToKitchen(): void {
    const order = this.order();
    if (!order?.id) return;
    const selected = this.selectedKitchenItemIds();
    const ids = selected.size
      ? this.pendingKitchenItems()
          .filter((it) => selected.has(it.id))
          .map((it) => it.id)
      : this.pendingKitchenItems().map((it) => it.id);
    if (ids.length === 0) return;
    this.isFiringKitchen.set(true);
    this.kitchenTicketsService
      .fireOrderItems({ order_id: order.id, order_item_ids: ids })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isFiringKitchen.set(false);
          this.clearKitchenSelection();
          this.toastService.success('Enviado a cocina');
          // Re-fetch the order so the kitchen_ticket_items badges update.
          this.refreshOrder();
        },
        error: (err: unknown) => {
          this.isFiringKitchen.set(false);
          // Generic error — the backend may reject with
          // RESTAURANT_NOT_ENABLED on a non-restaurant store, or
          // KITCHEN_FIRE_ALL_ALREADY_CONSUMED if the items are
          // already fired. We do not leak the recipe check
          // (Plan F3: error toast must be generic; the recipe error
          // belongs to startPreparation, not the fire path).
          this.toastService.error('No se pudo enviar a cocina');
          console.error('KDS fire-from-detail failed', err);
        },
      });
  }

  /**
   * Plan KDS fire-flows (F3): re-fetch the current order so the
   * kitchen_ticket_items badges + the unfired-prepared computed
   * stay in sync after a fire mutation. Lightweight: same endpoint
   * the page already loaded from, no extra roundtrip beyond a
   * refetch.
   */
  private refreshOrder(): void {
    const id = this.order()?.id;
    if (!id) return;
    this.ordersService
      .getOrderById(String(id))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          const data = res?.data ?? res;
          if (data) this.order.set(data);
        },
        error: () => undefined,
      });
  }

  /** Localised label for the KDS state badge. */
  kitchenStateLabel(ks: { status: string }): string {
    switch (ks.status) {
      case 'pending':
        return 'Pendiente';
      case 'in_preparation':
        return 'En preparación';
      case 'ready':
        return 'Listo';
      case 'delivered':
        return 'Entregado';
      case 'cancelled':
        return 'Cancelado';
      default:
        return ks.status;
    }
  }

  /**
   * Tailwind class set for the KDS badge — kept aligned with the
   * board's status palette. Returned as a string to play well with
   * the existing `[class]="..."` binding style used in this
   * template.
   */
  kitchenBadgeClass(ks: { status: string }): string {
    switch (ks.status) {
      case 'pending':
        return 'bg-gray-100 text-gray-700 border border-gray-200';
      case 'in_preparation':
        return 'bg-amber-100 text-amber-800 border border-amber-200';
      case 'ready':
        return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
      case 'delivered':
        return 'bg-sky-100 text-sky-800 border border-sky-200';
      case 'cancelled':
        return 'bg-red-100 text-red-700 border border-red-200';
      default:
        return 'bg-gray-100 text-gray-700 border border-gray-200';
    }
  }

  getAuditActionLabel(action: string): string {
    const labels: Record<string, string> = {
      create: 'Orden Creada',
      update: 'Orden Actualizada',
      delete: 'Orden Eliminada',
      view: 'Orden Vista',
      CREATE: 'Orden Creada',
      UPDATE: 'Orden Actualizada',
      DELETE: 'Orden Eliminada',
      VIEW: 'Orden Vista',
    };
    return labels[action] || action;
  }
}
