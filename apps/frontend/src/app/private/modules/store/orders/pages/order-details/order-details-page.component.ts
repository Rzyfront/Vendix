import { Component, OnInit, OnDestroy, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subject, takeUntil, forkJoin } from 'rxjs';
import { StoreOrdersService } from '../../services/store-orders.service';
import {
  Order,
  OrderState,
  OrderFlowMetadata,
  PaymentType,
  DeliveryType,
  OrderActionConfig,
  PayOrderDto,
} from '../../interfaces/order.interface';
import { DialogService, ModalComponent, ToastService } from '../../../../../../shared/components';
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
import { CurrencyFormatService, CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { OrderPaymentModalComponent } from '../../components/order-payment-modal/order-payment-modal.component';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';

export interface LifecycleStep {
  key: string;
  label: string;
  status: 'completed' | 'current' | 'upcoming' | 'terminal';
}

@Component({
  selector: 'app-order-details-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    ButtonComponent,
    CardComponent,
    IconComponent,
    StickyHeaderComponent,
    ModalComponent,
    CurrencyPipe,
    OrderPaymentModalComponent,
  ],
  templateUrl: './order-details-page.component.html',
  styleUrls: ['./order-details-page.component.css'],
})
export class OrderDetailsPageComponent implements OnInit, OnDestroy {
  orderId: string | null = null;
  order = signal<Order | null>(null);
  timeline: any[] = [];
  isLoading = signal(false);
  error: string | null = null;

  // Role check
  isPrivilegedUser = signal(false);

  // Flow modal visibility signals
  showPayModal = signal(false);
  showShipModal = signal(false);
  showDeliverModal = signal(false);
  showCancelModal = signal(false);
  showRefundModal = signal(false);

  // Processing state
  isProcessingAction = signal(false);

  // Payment methods for pay modal
  paymentMethods = signal<StorePaymentMethod[]>([]);

  // Reactive forms (ship, deliver, cancel, refund — pay is now in its own component)
  shipForm!: FormGroup;
  deliverForm!: FormGroup;
  cancelForm!: FormGroup;
  refundForm!: FormGroup;

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

  // ── Available Actions (state + delivery_type + channel aware) ──

  readonly availableActions = computed<OrderActionConfig[]>(() => {
    const order = this.order();
    if (!order) return [];

    const state = order.state;
    const delivery = order.delivery_type || 'direct_delivery';
    const channel = order.channel || 'pos';
    const actions: OrderActionConfig[] = [];

    switch (state) {
      case 'created':
        if (channel !== 'pos' || !this.hasSuccessfulPayment()) {
          actions.push({ id: 'pay', label: 'Registrar Pago', icon: 'credit-card', variant: 'primary' });
        }
        if (this.isPrivilegedUser()) {
          actions.push({ id: 'edit-order', label: 'Modificar Orden', icon: 'edit', variant: 'warning' });
        }
        actions.push({ id: 'cancel', label: 'Cancelar Orden', icon: 'x-circle', variant: 'danger' });
        break;

      case 'pending_payment':
        actions.push({ id: 'confirm-payment', label: 'Confirmar Pago', icon: 'check-circle', variant: 'primary' });
        actions.push({ id: 'info', label: 'Esperando confirmacion de pago', icon: 'clock', type: 'alert', color: 'warning' });
        actions.push({ id: 'cancel', label: 'Cancelar Orden', icon: 'x-circle', variant: 'danger' });
        break;

      case 'processing':
        if (delivery === 'home_delivery') {
          actions.push({ id: 'ship', label: 'Marcar como Enviado', icon: 'truck', variant: 'primary' });
        } else if (delivery === 'pickup') {
          actions.push({ id: 'ship', label: 'Listo para Recoger', icon: 'package', variant: 'primary' });
        } else {
          actions.push({ id: 'ship', label: 'Despachar Orden', icon: 'package', variant: 'primary' });
        }
        if (this.isPrivilegedUser()) {
          actions.push({ id: 'cancel-payment', label: 'Cancelar Pago', icon: 'credit-card', variant: 'warning' });
        }
        actions.push({ id: 'cancel', label: 'Cancelar Orden', icon: 'x-circle', variant: 'danger' });
        break;

      case 'shipped':
        if (delivery === 'home_delivery') {
          actions.push({ id: 'deliver', label: 'Marcar como Entregado', icon: 'package-check', variant: 'primary' });
        } else if (delivery === 'pickup') {
          actions.push({ id: 'deliver', label: 'Confirmar Recogida', icon: 'user-check', variant: 'primary' });
        } else {
          actions.push({ id: 'deliver', label: 'Confirmar Entrega', icon: 'check-circle', variant: 'primary' });
        }
        break;

      case 'delivered':
        actions.push({ id: 'finish', label: 'Finalizar Orden', icon: 'check-circle', variant: 'success' });
        actions.push({ id: 'refund', label: 'Procesar Reembolso', icon: 'rotate-ccw', variant: 'warning' });
        break;

      case 'finished':
        actions.push({ id: 'refund', label: 'Procesar Reembolso', icon: 'rotate-ccw', variant: 'warning' });
        break;

      case 'cancelled':
      case 'refunded':
        // No actions
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

  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private fb: FormBuilder,
    private ordersService: StoreOrdersService,
    private dialogService: DialogService,
    private toastService: ToastService,
    private paymentMethodsService: PaymentMethodsService,
    private currencyService: CurrencyFormatService,
    private authFacade: AuthFacade,
  ) {
    this.currencySymbol = this.currencyService.currencySymbol;
    this.isPrivilegedUser.set(this.authFacade.isAdmin() || this.authFacade.isOwner());

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

    this.refundForm = this.fb.group({
      amount: [null],
      reason: ['', [Validators.required, Validators.minLength(3)]],
    });
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.orderId = params.get('id');
      if (this.orderId) {
        this.loadData();
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadData(): void {
    if (!this.orderId) return;

    this.isLoading.set(true);
    this.error = null;

    forkJoin({
      order: this.ordersService.getOrderById(this.orderId),
      timeline: this.ordersService.getOrderTimeline(this.orderId),
    })
      .pipe(takeUntil(this.destroy$))
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
            order_items: (orderData.order_items || []).map((item: any) => ({
              ...item,
              unit_price: Number(item.unit_price),
              total_price: Number(item.total_price),
              quantity: Number(item.quantity),
            })),
          });

          this.timeline = (timeline as any).data || timeline || [];
          this.isLoading.set(false);

          // Load payment methods if order can accept payment
          if (orderData.state === 'created') {
            this.loadPaymentMethods();
          }
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
      .pipe(takeUntil(this.destroy$))
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

  // ── Action Dispatcher ──────────────────────────────────────

  executeAction(actionId: string): void {
    switch (actionId) {
      case 'pay':
        this.openPayModal();
        break;
      case 'confirm-payment':
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
      case 'refund':
        this.openRefundModal();
        break;
    }
  }

  // ── Flow Actions ───────────────────────────────────────────

  openPayModal(): void {
    if (this.paymentMethods().length === 0) {
      this.loadPaymentMethods();
    }
    this.showPayModal.set(true);
  }

  onPaymentSubmitted(dto: PayOrderDto): void {
    if (!this.orderId) return;
    this.isProcessingAction.set(true);

    this.ordersService
      .flowPayOrder(this.orderId, dto)
      .pipe(takeUntil(this.destroy$))
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

  submitShipment(): void {
    if (!this.orderId) return;

    this.isProcessingAction.set(true);
    const dto = this.shipForm.value;
    Object.keys(dto).forEach((key) => {
      if (dto[key] === '' || dto[key] === null) delete dto[key];
    });

    this.ordersService
      .flowShipOrder(this.orderId, dto)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.showShipModal.set(false);
          this.isProcessingAction.set(false);
          this.toastService.success('Orden marcada como enviada');
          this.loadData();
        },
        error: (err) => {
          this.isProcessingAction.set(false);
          this.toastService.error(err.message || 'Error al enviar la orden');
        },
      });
  }

  openDeliverModal(): void {
    this.deliverForm.reset();
    this.showDeliverModal.set(true);
  }

  submitDelivery(): void {
    if (!this.orderId) return;

    this.isProcessingAction.set(true);
    const dto = this.deliverForm.value;
    Object.keys(dto).forEach((key) => {
      if (dto[key] === '' || dto[key] === null) delete dto[key];
    });

    this.ordersService
      .flowDeliverOrder(this.orderId, dto)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.showDeliverModal.set(false);
          this.isProcessingAction.set(false);
          this.toastService.success('Orden marcada como entregada');
          this.loadData();
        },
        error: (err) => {
          this.isProcessingAction.set(false);
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
          .pipe(takeUntil(this.destroy$))
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
          .pipe(takeUntil(this.destroy$))
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

  openCancelModal(): void {
    this.cancelForm.reset();
    this.showCancelModal.set(true);
  }

  submitCancellation(): void {
    if (this.cancelForm.invalid || !this.orderId) return;

    this.isProcessingAction.set(true);
    this.ordersService
      .flowCancelOrder(this.orderId, this.cancelForm.value)
      .pipe(takeUntil(this.destroy$))
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

  openRefundModal(): void {
    const order = this.order();
    this.refundForm.reset({
      amount: order?.grand_total || 0,
      reason: '',
    });
    this.showRefundModal.set(true);
  }

  submitRefund(): void {
    if (this.refundForm.invalid || !this.orderId) return;

    this.isProcessingAction.set(true);
    const dto = this.refundForm.value;
    if (dto.amount) {
      dto.amount = Number(dto.amount);
    } else {
      delete dto.amount;
    }

    this.ordersService
      .flowRefundOrder(this.orderId, dto)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.showRefundModal.set(false);
          this.isProcessingAction.set(false);
          this.toastService.success('Reembolso procesado exitosamente');
          this.loadData();
        },
        error: (err) => {
          this.isProcessingAction.set(false);
          this.toastService.error(err.message || 'Error al procesar el reembolso');
        },
      });
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
    }
  }

  printOrder(): void {
    window.print();
  }

  goBack(): void {
    this.router.navigate(['/admin/orders']);
  }

  // ── Helpers ────────────────────────────────────────────────

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
          .pipe(takeUntil(this.destroy$))
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
    // Flow-specific labels based on the new state in the audit log
    const newState = log.new_values?.state;
    if (newState) {
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
