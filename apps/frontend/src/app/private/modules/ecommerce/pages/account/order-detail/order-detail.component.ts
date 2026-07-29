import {Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';


import { AccountService, OrderDetail } from '../../../services/account.service';
import { EcommerceBookingService } from '../../../services/ecommerce-booking.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { parseVariantAttributes } from '../../../../../../shared/utils';

@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent, CurrencyPipe],
  templateUrl: './order-detail.component.html',
  styleUrls: ['./order-detail.component.scss'] })
export class OrderDetailComponent implements OnInit, OnDestroy {
  private destroyRef = inject(DestroyRef);
  readonly order = signal<OrderDetail | null>(null);
  readonly is_loading = signal(true);
  readonly is_new_order = signal(false);

  // Wompi callback state
  readonly verifyingWompiPayment = signal(false);
  wompiPaymentVerified = false;

  readonly totalItems = computed(() => {
    const o = this.order();
    if (!o) return 0;
    return o.items.reduce((sum, item) => sum + item.quantity, 0);
  });

  readonly hasOnlyServices = computed(() => {
    const o = this.order();
    if (!o) return false;
    return o.items.every((item) => item.product_type === 'service');
  });

  readonly hasServiceItems = computed(() => {
    const o = this.order();
    if (!o) return false;
    return o.items.some((item) => item.product_type === 'service');
  });

  readonly hasPhysicalItems = computed(() => {
    const o = this.order();
    if (!o) return false;
    return o.items.some((item) => item.product_type !== 'service');
  });

  readonly postPurchaseMessage = computed(() => {
    const o = this.order();
    if (o?.bookings?.length) {
      const count = o.bookings.length;
      const suffix = count === 1 ? 'reserva confirmada' : 'reservas confirmadas';
      if (this.hasPhysicalItems()) {
        return `Tienes ${count} ${suffix}. Los productos serán enviados a tu dirección.`;
      }
      return `Tienes ${count} ${suffix}. Revisa los detalles abajo.`;
    }
    if (this.hasOnlyServices()) {
      return 'Recibirás instrucciones para tu servicio por correo electrónico.';
    }
    if (this.hasServiceItems() && this.hasPhysicalItems()) {
      return 'Los productos serán enviados y recibirás instrucciones para los servicios.';
    }
    return 'Te notificaremos cuando esté en camino.';
  });

  readonly shippingBlock = computed(() => {
    const o = this.order();
    if (!o || !this.hasPhysicalItems()) return null;

    const deliveryType = (o as any).delivery_type || 'other';
    const method = (o as any).shipping_method;
    const rate = (o as any).shipping_rate;

    if (deliveryType === 'pickup') {
      return {
        type: 'pickup' as const,
        title: o.state === 'shipped' ? '¡Tu pedido está listo para recoger!' : 'Retiro en tienda',
        method: method?.name || 'Retiro en tienda',
        storeName: (o as any).store_name || 'Tienda',
      };
    }

    if (deliveryType === 'home_delivery') {
      return {
        type: 'home_delivery' as const,
        title: 'Envío a domicilio',
        method: method?.name || 'Envío estándar',
        carrier: method?.provider_name || null,
        tracking: (o as any).tracking_number || null,
        minDays: method?.min_days || null,
        maxDays: method?.max_days || null,
        cost: o.shipping_cost || 0,
      };
    }

    return {
      type: 'other' as const,
      title: 'Envío coordinado',
      method: method?.name || 'Coordinar envío',
      note: 'Coordinaremos el envío contigo',
      cost: o.shipping_cost || 0,
    };
  });

  // ── Discount snapshots (read-only from order; never recalculated) ──
  readonly appliedPromotions = computed(() =>
    (this.order()?.applied_promotions ?? []).map((p) => ({
      ...p,
      discount_amount: Number(p.discount_amount || 0),
    })),
  );

  readonly appliedCoupons = computed(() =>
    (this.order()?.applied_coupons ?? []).map((c) => ({
      ...c,
      discount_applied: Number(c.discount_applied || 0),
    })),
  );

  readonly hasDiscountSnapshot = computed(
    () =>
      this.appliedPromotions().length > 0 || this.appliedCoupons().length > 0,
  );

  readonly orderTimelineSteps = computed(() => {
    const o = this.order();
    if (!o) return [];

    const deliveryType = (o as any).delivery_type || 'other';
    const states = [
      { key: 'created', label: 'Pedido creado' },
      { key: 'processing', label: 'En preparación' },
      { key: 'shipped', label: deliveryType === 'pickup' ? 'Listo para recoger' : 'Enviado' },
      { key: 'delivered', label: deliveryType === 'pickup' ? 'Recogido' : 'Entregado' },
    ];

    const stateOrder = ['created', 'pending_payment', 'processing', 'shipped', 'delivered', 'finished'];
    const currentState = o.state || 'created';
    const currentIndex = stateOrder.indexOf(currentState);

    return states.map((step) => {
      const stepIndex = stateOrder.indexOf(step.key);
      let status: 'completed' | 'current' | 'upcoming' = 'upcoming';
      if (currentIndex >= stepIndex) status = 'completed';
      if (step.key === currentState || (step.key === 'shipped' && currentState === 'shipped')) {
        if (status !== 'completed' || step.key === currentState) status = 'current';
      }
      if (status === 'completed' && step.key !== currentState && currentIndex === stepIndex) {
        status = 'current';
      }
      return { ...step, status };
    });
  });

  private wompiPollTimer: ReturnType<typeof setInterval> | null = null;
private toast = inject(ToastService);

  constructor(
    private account_service: AccountService,
    private booking_service: EcommerceBookingService,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    const order_id = this.route.snapshot.params['id'];
    this.is_new_order.set(this.route.snapshot.queryParams['success'] === 'true');

    // Handle Wompi payment callback
    this.route.queryParams
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        if (params['wompi_callback'] === 'true' && !this.wompiPaymentVerified) {
          this.verifyingWompiPayment.set(true);
          this.pollOrderPaymentStatus(+order_id);
        }
      });

    this.loadOrder(+order_id);
  }

  ngOnDestroy(): void {

if (this.wompiPollTimer) {
      clearInterval(this.wompiPollTimer);
    }
  }

  /**
   * Polls the order detail to check if payment status has been updated by the webhook.
   * Stops polling after payment is no longer pending or after 60 attempts (5 minutes).
   */
  private pollOrderPaymentStatus(orderId: number): void {
    let attempts = 0;
    const maxAttempts = 60;

    this.wompiPollTimer = setInterval(() => {
      attempts++;

      this.account_service.getOrderDetail(orderId).subscribe({
        next: (response) => {
          if (response.success) {
            this.order.set(response.data);
            const currentOrder = response.data;

            // Check if any payment is no longer pending
            const hasCompletedPayment = currentOrder.payments?.some(
              (p: any) =>
                p.state === 'completed' ||
                p.state === 'paid' ||
                p.state === 'succeeded',
            );
            const hasFailedPayment = currentOrder.payments?.some(
              (p: any) => p.state === 'failed' || p.state === 'declined',
            );

            if (
              hasCompletedPayment ||
              hasFailedPayment ||
              attempts >= maxAttempts
            ) {
              this.verifyingWompiPayment.set(false);
              this.wompiPaymentVerified = true;
              if (hasCompletedPayment) {
                this.is_new_order.set(true);
              }
              if (
                !hasCompletedPayment &&
                !hasFailedPayment &&
                attempts >= maxAttempts
              ) {
                this.toast.warning(
                  'La verificación del pago está tardando más de lo esperado. Tu pago puede estar siendo procesado. Recarga la página en unos minutos.',
                  'Verificación en progreso',
                );
              }
              if (this.wompiPollTimer) {
                clearInterval(this.wompiPollTimer);
                this.wompiPollTimer = null;
              }
            }
          }
        },
        error: () => {
          if (attempts >= maxAttempts) {
            this.verifyingWompiPayment.set(false);
            this.toast.warning(
              'No pudimos verificar el estado del pago. Recarga la página en unos minutos para ver la actualización.',
              'Verificación interrumpida',
            );
            if (this.wompiPollTimer) {
              clearInterval(this.wompiPollTimer);
              this.wompiPollTimer = null;
            }
          }
        } });
    }, 5000); // Poll every 5 seconds
  }

  loadOrder(order_id: number): void {
    this.is_loading.set(true);
    this.account_service.getOrderDetail(order_id).subscribe({
      next: (response) => {
        if (response.success) {
          this.order.set(response.data);
        }
        this.is_loading.set(false);
      },
      error: () => {
        this.is_loading.set(false);
      } });
  }

  /**
   * Show the "Reagendar" CTA only when the order contains a service
   * booking whose status the customer can still change. A booking
   * that is already in progress, completed, cancelled, or no_show can't
   * be re-scheduled — only pending or confirmed can.
   */
  /**
   * The booking the customer can reschedule. Prefers the real row
   * (the canonical source of date/time/address), but falls back to
   * a synthetic booking derived from the order itself when:
   *  - The order is a service (hasServiceItems) but has no bookings
   *    row (e.g. older orders or test data where the booking insert
   *    was skipped)
   *  - The order has a `delivery_type` set (home_delivery / pickup)
   *    and a `shipping_address_snapshot` that we can use to derive
   *    the address for the reschedule modal
   *
   * The synthetic booking only carries the fields the modal actually
   * reads; it does NOT have a real `id` (passes 0) so the
   * PATCH /reschedule endpoint must validate it has a real id.
   * For the order-only path, the modal won't be functional but the
   * button still appears so the user knows the option exists.
   */
  readonly firstReschedulableBooking = computed(() => {
    const o = this.order();
    if (!o) return null;

    // 1) Real booking, if present and in a reschedulable status.
    const real = o.bookings?.[0];
    if (real) {
      const status = (real as any).status;
      if (status === 'pending' || status === 'confirmed') return real;
    }

    // 2) Synthetic fallback: show the "Reagendar reserva" CTA for ANY
    //    service-only order, even if the backend never persisted a
    //    `bookings` row (orphan from the pre-fix checkout silent-failure
    //    bug, or older orders). Without this the customer never sees
    //    the option to manage the reservation. The modal will detect
    //    `id === 0` and refuse to PATCH /reschedule, surfacing a clear
    //    message so the customer knows to create the booking first.
    if (!this.hasServiceItems()) return null;
    const firstServiceItem = o.items.find(
      (i: any) => i.product_type === 'service',
    );
    if (!firstServiceItem) return null;

    const addr = (o as any).shipping_address_snapshot as
      | {
          address_line1: string;
          address_line2: string | null;
          city: string;
          state_province: string | null;
          country_code: string;
          postal_code: string | null;
          phone_number: string | null;
        }
      | null
      | undefined;

    return {
      // id: 0 marks this as a synthetic row — the modal can still
      // display the address but the API PATCH won't be functional.
      id: 0,
      booking_number: o.order_number,
      date: o.placed_at ?? o.created_at,
      start_time: '',
      end_time: '',
      status: 'pending',
      product_id: firstServiceItem.product_id,
      product_name: firstServiceItem.product_name,
      // The "home vs shop" comes from the order's delivery_type
      service_location_type:
        o.delivery_type === 'pickup' ? 'shop' : 'home',
      service_address: addr
        ? {
            id: 0,
            address_line1: addr.address_line1,
            address_line2: addr.address_line2,
            city: addr.city,
            state_province: addr.state_province,
            country_code: addr.country_code,
            postal_code: addr.postal_code,
          }
        : null,
    };
  });

  openRescheduleModal(): void {
    const booking = this.firstReschedulableBooking();
    // Synthetic booking (id=0) means no reservation was ever persisted.
    // Mirror the admin flow: redirect to the product page so the customer
    // picks a real date/time and creates the reservation from scratch.
    if (!booking || booking.id === 0) {
      const productId = booking?.product_id;
      if (productId) {
        this.router.navigate(['/products', productId]);
      } else {
        this.toast.warning(
          'No se encontró el servicio para crear la reserva. Contacta soporte.',
        );
      }
      return;
    }
    this.showRescheduleModal.set(true);
  }

  closeRescheduleModal(): void {
    this.showRescheduleModal.set(false);
  }

  onRescheduleComplete(): void {
    this.closeRescheduleModal();
    // Refresh the order so the new date/time is reflected in the UI.
    const id = this.order()?.id;
    if (id) this.loadOrder(id);

    // Appointment redesign phase 2 — si la tienda requiere aprobación
    // (`settings.reservations.allow_direct_reschedule === false`), el
    // booking NO se mueve al instante: el backend crea una solicitud
    // pending y devuelve el booking ORIGINAL. Detectamos eso mirando
    // las solicitudes pendientes del customer — si hay una para este
    // booking, mostramos "Pendiente de aprobación" en lugar del toast
    // de éxito del reschedule directo.
    const booking = this.firstReschedulableBooking();
    if (booking?.id) {
      this.booking_service.listMyRescheduleRequests().subscribe({
        next: (rows) => {
          const isPending = rows.some((r) => r.booking_id === booking.id);
          if (isPending) {
            this.toast.info(
              'Solicitud enviada al admin. Te avisaremos cuando sea aprobada.',
            );
          } else {
            this.toast.success('Reserva reagendada correctamente');
          }
        },
        error: () => {
          // Si falla el check de pendientes, caemos al éxito conservador.
          this.toast.success('Reserva reagendada correctamente');
        },
      });
    } else {
      this.toast.success('Reserva reagendada correctamente');
    }
  }

  getVariantLabel(item: any): string {
    const attrs = parseVariantAttributes(item?.variant_attributes);
    if (attrs.length) {
      return attrs.map(a => (a.name ? `${a.name}: ${a.value}` : a.value)).join(' · ');
    }
    return item?.variant_sku || '';
  }

  getStateLabel(state: string): string {
    const o = this.order();
    const deliveryType = o ? (o as any).delivery_type : null;
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      confirmed: 'Confirmado',
      processing: 'En proceso',
      shipped: deliveryType === 'pickup' ? 'Listo para recoger' : 'Enviado',
      delivered: deliveryType === 'pickup' ? 'Recogido' : 'Entregado',
      completed: 'Completado',
      cancelled: 'Cancelado',
    };
    return labels[state] || state;
  }

  getStateClass(state: string): string {
    const classes: Record<string, string> = {
      pending: 'warning',
      confirmed: 'info',
      processing: 'info',
      shipped: 'info',
      delivered: 'success',
      completed: 'success',
      cancelled: 'error' };
    return classes[state] || 'default';
  }

  getStateIcon(state: string): string {
    const o = this.order();
    const deliveryType = o ? (o as any).delivery_type : null;
    const icons: Record<string, string> = {
      pending: 'clock',
      confirmed: 'check-circle',
      processing: 'loader-2',
      shipped: deliveryType === 'pickup' ? 'package-check' : 'truck',
      delivered: 'package-check',
      completed: 'check-circle',
      cancelled: 'circle-x',
    };
    return icons[state] || 'circle';
  }

  getPaymentMethodLabel(method: string | null): string {
    if (!method) return 'Método de pago';
    const labels: Record<string, string> = {
      cash: 'Efectivo',
      card: 'Tarjeta',
      transfer: 'Transferencia',
      cash_on_delivery: 'Contra entrega' };
    return labels[method] || method;
  }

  getPaymentIcon(method: string | null): string {
    if (!method) return 'credit-card';
    const icons: Record<string, string> = {
      cash: 'banknote',
      card: 'credit-card',
      transfer: 'send',
      cash_on_delivery: 'coins' };
    return icons[method] || 'credit-card';
  }

  /** Returns the item type label for badge display */
  getItemTypeLabel(item: any): string {
    return item.product_type === 'service' ? 'Servicio' : 'Producto';
  }

  /** Returns true if item is a service */
  isServiceItem(item: any): boolean {
    return item.product_type === 'service';
  }

  getBookingStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      confirmed: 'Confirmada',
      completed: 'Completada',
      cancelled: 'Cancelada',
      no_show: 'No asistió' };
    return labels[status] || status;
  }

  getBookingStatusClass(status: string): string {
    const classes: Record<string, string> = {
      pending: 'warning',
      confirmed: 'info',
      completed: 'success',
      cancelled: 'error',
      no_show: 'error' };
    return classes[status] || 'default';
  }

  getInvoiceUrl(): string {
    return this.order()?.invoice_url || '#';
  }
}
