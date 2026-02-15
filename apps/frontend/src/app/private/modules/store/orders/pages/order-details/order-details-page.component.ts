import { Component, OnInit, OnDestroy, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subject, takeUntil, forkJoin } from 'rxjs';
import { StoreOrdersService } from '../../services/store-orders.service';
import { Order, OrderState, OrderFlowMetadata, PaymentType } from '../../interfaces/order.interface';
import { DialogService, ModalComponent, ToastService } from '../../../../../../shared/components';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  StickyHeaderComponent,
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
} from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { PaymentMethodsService } from '../../../settings/payments/services/payment-methods.service';
import { StorePaymentMethod, PaymentMethodState } from '../../../settings/payments/interfaces/payment-methods.interface';

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
    IconComponent,
    StickyHeaderComponent,
    ModalComponent,
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

  // Reactive forms
  payForm!: FormGroup;
  shipForm!: FormGroup;
  deliverForm!: FormGroup;
  cancelForm!: FormGroup;
  refundForm!: FormGroup;

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

  private readonly STEP_LABELS: Record<string, string> = {
    created: 'Creada',
    pending_payment: 'Pago Pendiente',
    processing: 'Procesando',
    shipped: 'Enviada',
    delivered: 'Entregada',
    finished: 'Finalizada',
  };

  readonly lifecycleSteps = computed<LifecycleStep[]>(() => {
    const order = this.order();
    if (!order) return [];

    const state = order.state;

    // Terminal states get special handling
    if (state === 'cancelled' || state === 'refunded') {
      const terminalLabel = state === 'cancelled' ? 'Cancelada' : 'Reembolsada';
      // Show steps up to where the order was before terminal + the terminal step
      const steps: LifecycleStep[] = this.HAPPY_PATH.map((key) => ({
        key,
        label: this.STEP_LABELS[key],
        status: 'completed' as const,
      }));
      // Mark all as completed up to a reasonable point, then add terminal
      // We can infer how far the order got from the metadata
      return [
        ...steps.slice(0, 1).map((s) => ({ ...s, status: 'completed' as const })),
        { key: state, label: terminalLabel, status: 'terminal' as const },
      ];
    }

    const currentIndex = this.HAPPY_PATH.indexOf(state);
    if (currentIndex === -1) return [];

    return this.HAPPY_PATH.map((key, i) => ({
      key,
      label: this.STEP_LABELS[key],
      status:
        i < currentIndex
          ? ('completed' as const)
          : i === currentIndex
            ? ('current' as const)
            : ('upcoming' as const),
    }));
  });

  // Sticky Header Configuration
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
  ) {
    this.payForm = this.fb.group({
      store_payment_method_id: [null, Validators.required],
      payment_type: ['direct' as PaymentType, Validators.required],
      amount_received: [null],
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

          // Load payment methods if order is in created state
          if (orderData.state === 'created') {
            this.loadPaymentMethods();
          }
        },
        error: (err) => {
          console.error('Error loading order data:', err);
          this.error = 'No se pudo cargar la información de la orden.';
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

  // ── Flow Actions ───────────────────────────────────────────

  openPayModal(): void {
    this.payForm.reset({ payment_type: 'direct' });
    if (this.paymentMethods().length === 0) {
      this.loadPaymentMethods();
    }
    this.showPayModal.set(true);
  }

  submitPayment(): void {
    if (this.payForm.invalid || !this.orderId) return;

    this.isProcessingAction.set(true);
    const dto = this.payForm.value;
    dto.store_payment_method_id = Number(dto.store_payment_method_id);
    if (dto.amount_received) {
      dto.amount_received = Number(dto.amount_received);
    } else {
      delete dto.amount_received;
    }

    this.ordersService
      .flowPayOrder(this.orderId, dto)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.showPayModal.set(false);
          this.isProcessingAction.set(false);
          const changeMsg = res.payment?.change ? ` — Cambio: $${res.payment.change.toFixed(2)}` : '';
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
    // Remove empty strings
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

  getAuditActionLabel(action: string): string {
    const labels: Record<string, string> = {
      create: 'Orden Creada',
      update: 'Orden Actualizada',
      delete: 'Orden Eliminada',
      view: 'Orden Vista',
    };
    return labels[action] || action;
  }
}
