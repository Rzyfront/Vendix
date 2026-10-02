import {Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';


import { AccountService, OrderDetail } from '../../../services/account.service';
import { EcommerceBookingService } from '../../../services/ecommerce-booking.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  BadgeComponent,
  BadgeVariant,
} from '../../../../../../shared/components/badge/badge.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import {
  CurrencyPipe,
  CurrencyFormatService,
} from '../../../../../../shared/pipes/currency';
import { IconName } from '../../../../../../shared/components/icon/icons.registry';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { RescheduleModalComponent } from '../../../../store/reservations/components/reschedule-modal/reschedule-modal.component';
import { OrderTrackingProgressComponent } from '../../../../../../shared/components/order-tracking-progress/order-tracking-progress.component';
import { ThemeService } from '../../../../../../core/services/theme.service';
import { TenantFacade } from '../../../../../../core/store/tenant/tenant.facade';
import { parseVariantAttributes } from '../../../../../../shared/utils';

@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    IconComponent,
    BadgeComponent,
    ButtonComponent,
    CurrencyPipe,
    RescheduleModalComponent,
    OrderTrackingProgressComponent,
  ],
  templateUrl: './order-detail.component.html',
  styleUrls: ['./order-detail.component.scss'] })
export class OrderDetailComponent implements OnInit, OnDestroy {
  private destroyRef = inject(DestroyRef);
  private readonly tenantFacade = inject(TenantFacade);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly themeService = inject(ThemeService);
  readonly order = signal<OrderDetail | null>(null);
  readonly is_loading = signal(true);
  readonly is_new_order = signal(false);
  readonly load_failed = signal(false);
  // Header: si el logo no carga, se muestra el fallback de la tienda.
  readonly storeLogoFailed = signal(false);
  /** Logo firmado o null (fallback). Señal para que el @if estreche el tipo. */
  readonly storeLogo = computed(() =>
    !this.storeLogoFailed() ? (this.order()?.store?.logo_url ?? null) : null,
  );

  // Wompi callback state
  readonly verifyingWompiPayment = signal(false);
  /**
   * Appointment redesign phase 2 — drives `<app-reschedule-modal>`. Opened by
   * `openRescheduleModal()` only AFTER the pending-request check resolves, so
   * a customer with a request already awaiting approval never sees the form.
   */
  readonly showRescheduleModal = signal(false);
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

  /**
   * La orden tiene cocina real: al menos un plato prepared (o líneas sin
   * tipo, legacy: se preserva "En preparación"). Solo con todas las líneas
   * en físico/servicio conocido el timeline dice "Procesando".
   */
  readonly hasPreparedItems = computed(() => {
    const o = this.order();
    if (!o) return false;
    const items = o.items ?? [];
    if (!items.length) return true;
    return items.some(
      (item) => item.product_type == null || item.product_type === 'prepared',
    );
  });

  /** "Servicios (N)" solo si todo es servicio; si no, "Productos (N)". */
  readonly itemsSectionTitle = computed(() => {
    const o = this.order();
    const items = o?.items ?? [];
    const allService =
      items.length > 0 &&
      items.every((item) => item.product_type === 'service');
    return `${allService ? 'Servicios' : 'Productos'} (${this.totalItems()})`;
  });

  /** "2 productos · 1 servicio" en unidades, solo partes no-cero. */
  readonly itemsSummary = computed(() => {
    const o = this.order();
    const items = o?.items ?? [];
    let products = 0;
    let services = 0;
    for (const item of items) {
      if (item.product_type === 'service') services += item.quantity;
      else products += item.quantity;
    }
    const parts: string[] = [];
    if (products > 0)
      parts.push(`${products} producto${products === 1 ? '' : 's'}`);
    if (services > 0)
      parts.push(`${services} servicio${services === 1 ? '' : 's'}`);
    return parts.join(' · ') || '0 productos';
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

  /**
   * Appointment redesign phase 2 — where the booked service happens.
   *
   * `shippingBlock` above returns null for a service-only order (it is gated
   * on `hasPhysicalItems()`), so without this the customer loses the address
   * once the order is placed. `delivery_type === 'pickup'` means the customer
   * goes to the store ("En el local"); anything else means the technician
   * travels to the address captured at checkout ("A domicilio").
   *
   * The shop address is not part of the order payload — it lives in
   * `store_settings.services.local_address` — so the 'shop' branch shows only
   * the label and defers the street to the confirmation email.
   */
  readonly serviceLocationBlock = computed(() => {
    const o = this.order();
    if (!o || !this.hasServiceItems()) return null;

    if (o.delivery_type === 'pickup') {
      return {
        type: 'shop' as const,
        title: 'En el local',
        addressLine1: 'El servicio se realiza en la tienda.',
        addressLine2: null as string | null,
      };
    }

    // The backend exposes the snapshot under `shipping_address` (it falls back
    // to the live address row when no snapshot was taken).
    const addr = o.shipping_address as
      | {
          address_line1?: string | null;
          address_line2?: string | null;
          city?: string | null;
          state_province?: string | null;
        }
      | null
      | undefined;
    if (!addr?.address_line1) return null;

    const locality = [addr.city, addr.state_province].filter(Boolean).join(', ');
    return {
      type: 'home' as const,
      title: 'A domicilio',
      addressLine1: addr.address_line1,
      addressLine2:
        [addr.address_line2, locality].filter(Boolean).join(' · ') || null,
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

  // Seguimiento: usa `app-order-tracking-progress` (mismo que guest),
  // con `hasPreparedItems` para "En preparación" vs "Procesando".

  private wompiPollTimer: ReturnType<typeof setInterval> | null = null;
private toast = inject(ToastService);

  constructor(
    private account_service: AccountService,
    private booking_service: EcommerceBookingService,
    private route: ActivatedRoute,
    private router: Router,
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
    this.load_failed.set(false);
    this.account_service.getOrderDetail(order_id).subscribe({
      next: (response) => {
        if (response.success) {
          this.order.set(response.data);
          this.applyStoreBranding(response.data.store);
        } else {
          this.load_failed.set(true);
        }
        this.is_loading.set(false);
      },
      error: () => {
        this.load_failed.set(true);
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

    // The backend maps the snapshot (or the live address row) onto
    // `shipping_address`; there is no `shipping_address_snapshot` key in the
    // response payload.
    const addr = (o as any).shipping_address as
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
    // Appointment redesign phase 2 — if the customer already has a
    // PENDING reschedule request for this booking, block the action and
    // show a long-lived toast explaining the state. Once the admin
    // approves/rejects (status leaves 'pending'), the button re-enables.
    // Only matters when the store has approval enabled; when `direct`,
    // the booking just moves and there's no pending state.
    this.booking_service.listMyRescheduleRequests().subscribe({
      next: (rows) => {
        const pending = rows.find((r) => r.booking_id === booking.id);
        if (pending) {
          this.toast.info(
            'Ya enviaste una solicitud de reagenda para esta reserva. Espera la respuesta del administrador — te avisaremos por email y en la campanita (🔔) cuando sea aprobada o rechazada.',
            '⏳ Solicitud pendiente',
            9000,
          );
          return;
        }
        this.showRescheduleModal.set(true);
      },
      error: () => {
        // If the check fails, fall through to opening the modal —
        // the backend will still reject duplicate pending requests with
        // a 409, so this isn't a hard guarantee but keeps the UX alive
        // if /reschedule-requests is briefly down.
        this.showRescheduleModal.set(true);
      },
    });
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
              'Tu solicitud de reagenda fue enviada al administrador. Te avisaremos por email y en la campanita de notificaciones (🔔 arriba a la derecha) cuando sea aprobada o rechazada.',
              '⏳ Solicitud pendiente de aprobación',
              9000,
            );
          } else {
            this.toast.success(
              'Tu reserva fue reagendada al instante.',
              '✅ Reagenda confirmada',
              5000,
            );
          }
        },
        error: () => {
          // Si falla el check de pendientes, caemos al éxito conservador.
          this.toast.success(
            'Tu reserva fue reagendada al instante.',
            '✅ Reagenda confirmada',
            5000,
          );
        },
      });
    } else {
      this.toast.success(
        'Tu reserva fue reagendada al instante.',
        '✅ Reagenda confirmada',
        5000,
      );
    }
  }

  getVariantLabel(item: any): string {
    const attrs = parseVariantAttributes(item?.variant_attributes);
    if (attrs.length) {
      return attrs.map(a => (a.name ? `${a.name}: ${a.value}` : a.value)).join(' · ');
    }
    return item?.variant_sku || '';
  }

  // === E2 — helpers de cancelación de línea =================================

  /**
   * True si el item fue cancelado (soft cancel vía D2). El backend persiste
   * `cancelled_at` en order_items; el cliente ve el item en su posición
   * original, tachado, con distintivo 'Cancelado'.
   */
  isItemCancelled(item: { cancelled_at?: string | null }): boolean {
    return !!item?.cancelled_at;
  }

  /**
   * El motivo se muestra al cliente SOLO si aporta. Filtra:
   *  - Vacío / null / solo espacios.
   *  - Marcador interno `legacy:` que dejó la ruta vieja de compatibilidad.
   */
  hasVisibleCancellationReason(item: {
    cancellation_reason?: string | null;
  }): boolean {
    const reason = (item?.cancellation_reason ?? '').trim();
    if (!reason) return false;
    if (reason.startsWith('legacy:')) return false;
    return true;
  }

  // STATE HELPERS — order_state_enum (9 estados, paridad guest).
  // Antes solo mapeaba 7 claves legacy y estados reales como
  // `pending_payment` se pintaban crudos en el badge.

  getStateLabel(state: string): string {
    const o = this.order();
    const deliveryType = o ? (o as any).delivery_type : null;
    const labels: Record<string, string> = {
      draft: 'Borrador',
      created: 'Creada',
      pending_payment: 'Pendiente de pago',
      processing: 'En proceso',
      shipped:
        deliveryType === 'pickup' ? 'Lista para recoger' : 'Enviada',
      pending_delivery: 'Pendiente de entrega',
      delivered: deliveryType === 'pickup' ? 'Recogida' : 'Entregada',
      finished: 'Finalizada',
      cancelled: 'Cancelada',
      refunded: 'Reembolsada',
    };
    return labels[state] || state;
  }

  getStateVariant(state: string): BadgeVariant {
    const variants: Record<string, BadgeVariant> = {
      delivered: 'success',
      finished: 'success',
      processing: 'primary',
      shipped: 'primary',
      pending_delivery: 'primary',
      pending_payment: 'warning',
      created: 'warning',
      draft: 'warning',
      cancelled: 'error',
      refunded: 'info',
    };
    return variants[state] || 'neutral';
  }

  getStateIcon(state: string): IconName {
    const o = this.order();
    const deliveryType = o ? (o as any).delivery_type : null;
    const icons: Record<string, IconName> = {
      draft: 'clock',
      created: 'clock',
      pending_payment: 'clock',
      processing: 'loader-2',
      shipped: deliveryType === 'pickup' ? 'package-check' : 'truck',
      pending_delivery: 'truck',
      delivered: 'check-circle',
      finished: 'check-circle',
      cancelled: 'circle-x',
      refunded: 'coins',
    };
    return icons[state] || 'clock';
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

  getBookingBadgeVariant(status: string): BadgeVariant {
    const variants: Record<string, BadgeVariant> = {
      pending: 'warning',
      confirmed: 'info',
      completed: 'success',
      cancelled: 'error',
      no_show: 'error',
    };
    return variants[status] || 'neutral';
  }

  getInvoiceUrl(): string {
    return (
      this.order()?.invoice?.pdf_url || this.order()?.invoice_url || '#'
    );
  }

  hasInvoice(): boolean {
    return this.getInvoiceUrl() !== '#';
  }

  // ==========================================================================
  // MARCA / WHATSAPP / ETA / PAGOS / COCINA — paridad guest-order-summary
  // ==========================================================================

  /**
   * Viste la ruta con la marca del comercio. Sin marca configurada no
   * toca nada (el preset sigue mandando). Usa el transform central del
   * ThemeService — nada de mapeo ad-hoc en el componente.
   */
  private applyStoreBranding(store?: OrderDetail['store']): void {
    const branding = store?.branding;
    if (!branding) return;
    void this.themeService.applyBranding(
      this.themeService.transformBrandingFromApi({
        ...branding,
        logo_url: store?.logo_url,
        name: store?.name,
      }),
    );
  }

  whatsappEnabled(): boolean {
    const config = this.tenantFacade.getCurrentDomainConfig();
    return !!config?.customConfig?.ecommerce?.checkout?.whatsapp_checkout;
  }

  sendToWhatsApp(order: OrderDetail): void {
    const config = this.tenantFacade.getCurrentDomainConfig();
    const phone = (
      config?.customConfig?.ecommerce?.checkout?.whatsapp_number || ''
    ).replace(/\D/g, '');
    if (!phone) {
      this.toast.warning('La tienda no tiene un WhatsApp configurado');
      return;
    }

    const storeName =
      config?.store_name || order.store?.name || 'la tienda';
    // Mensaje de CONSULTA con los datos de la orden para que la tienda
    // la identifique sin repreguntar (paridad guest).
    const itemLines = (order.items ?? [])
      .map(
        (i) =>
          `  - ${i.product_name}${i.variant_sku ? ' (' + i.variant_sku + ')' : ''} x${i.quantity}`,
      )
      .join('\n');
    const waItems = order.items ?? [];
    const waItemsHeader =
      waItems.length > 0 && waItems.every((i) => i.product_type === 'service')
        ? 'Servicios'
        : 'Productos';
    const message = encodeURIComponent(
      `¡Hola! 👋 Quisiera consultar el estado de mi pedido en ${storeName}.\n\n` +
        `*Pedido:* #${order.order_number}\n` +
        `*Estado:* ${this.getStateLabel(order.state)}\n` +
        (itemLines ? `\n*${waItemsHeader}:*\n${itemLines}\n` : '') +
        `\n*Total:* ${this.currencyService.format(Number(order.grand_total || 0))}\n\n¡Muchas gracias!`,
    );
    window.open(`https://wa.me/${phone}?text=${message}`, '_blank');
  }

  // PAGO — mapa completo de estados + multipago peor-primero (paridad guest)

  getPaymentStateLabel(state: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente de confirmación',
      authorized: 'Autorizado',
      succeeded: 'Pagado',
      captured: 'Pagado',
      paid: 'Pagado',
      failed: 'Fallido',
      partially_refunded: 'Reembolso parcial',
      refunded: 'Reembolsado',
      cancelled: 'Cancelado',
      // Alias legacy: el enum anterior usaba `partial`.
      partial: 'Parcial',
    };
    return labels[state] || state;
  }

  getPaymentStateVariant(state: string): BadgeVariant {
    const variants: Record<string, BadgeVariant> = {
      succeeded: 'success',
      captured: 'success',
      paid: 'success',
      pending: 'warning',
      authorized: 'primary',
      partially_refunded: 'info',
      refunded: 'info',
      partial: 'info',
      failed: 'error',
      cancelled: 'neutral',
    };
    return variants[state] || 'neutral';
  }

  /** Severidad peor-primero para multipago (paridad guest). */
  private paymentSeverity(state: string): number {
    const order = [
      'failed',
      'pending',
      'authorized',
      'partially_refunded',
      'cancelled',
      'refunded',
      'succeeded',
    ];
    const legacyAlias: Record<string, string> = {
      captured: 'succeeded',
      paid: 'succeeded',
      partial: 'partially_refunded',
    };
    const idx = order.indexOf(legacyAlias[state] ?? state);
    return idx === -1 ? order.length : idx;
  }

  /** Pagos ordenados peor-primero (copia; no muta la orden). */
  paymentsWorstFirst(
    payments?: OrderDetail['payments'] | null,
  ): OrderDetail['payments'] {
    return [...(payments ?? [])].sort(
      (a, b) => this.paymentSeverity(a.state) - this.paymentSeverity(b.state),
    );
  }

  /** Estado agregado del pago: el peor de todos (o null sin pagos). */
  worstPaymentState(
    payments?: OrderDetail['payments'] | null,
  ): string | null {
    const sorted = this.paymentsWorstFirst(payments);
    return sorted.length ? sorted[0].state : null;
  }

  /** True si el pago sigue pendiente (dispara la nota del ETA). */
  isPaymentPending(order: OrderDetail): boolean {
    const worst = this.worstPaymentState(order.payments);
    if (worst) return worst === 'pending';
    return order.state === 'pending_payment';
  }

  // ETA — persistido o prep_minutes_max, tras hide_prep_eta (paridad guest)

  /** `prefers-reduced-motion` para el tracking (sin SSE en cuenta). */
  prefersReducedMotion(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  etaVisible(): boolean {
    const config = this.tenantFacade.getCurrentDomainConfig();
    if (config?.customConfig?.ecommerce?.orders?.hide_prep_eta === true) {
      return false;
    }
    const order = this.order();
    if (!order) return false;
    return order.estimated_ready_at != null || this.etaMinutes(order) != null;
  }

  etaMinutes(order: OrderDetail): number | null {
    const m = order.prep_minutes_max;
    return typeof m === 'number' && Number.isFinite(m) ? m : null;
  }

  /** "Tiempo estimado: ~X min" + hora persistida si existe. */
  etaLabel(order: OrderDetail): string {
    const parts: string[] = [];
    const minutes = this.etaMinutes(order);
    if (minutes != null) parts.push(`~${minutes} min`);
    const readyAt = this.formatReadyTime(order.estimated_ready_at);
    if (readyAt) parts.push(`listo aprox. ${readyAt}`);
    return `Tiempo estimado: ${parts.join(' · ') || '—'}`;
  }

  /**
   * `estimated_ready_at` es un instante: se muestra en la hora local del
   * lector (quien consulta su pedido).
   */
  private formatReadyTime(iso?: string | null): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString('es-CO', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }

  /** Nota de pago pendiente sin palabra "preparación" si no hay cocina. */
  paymentPendingNote(order: OrderDetail): string {
    return this.orderHasPreparedItems(order)
      ? 'Tu pago está pendiente de confirmación; la preparación inicia al confirmarse y el tiempo puede variar.'
      : 'Tu pago está pendiente de confirmación; tu pedido se procesa al confirmarse y el tiempo puede variar.';
  }

  // COCINA — port del guest (kitchenStateFor/Label/Badge/PrepLine)

  kitchenStateFor(
    item: OrderDetail['items'][number],
  ): string | null {
    // Solo prepared muestra cocina; físico/servicio explícitos nunca
    // (null = legacy: se respeta el ticket como hasta ahora).
    if (item.product_type != null && item.product_type !== 'prepared') {
      return null;
    }
    return item.kitchen_status ?? null;
  }

  /** 5 labels ES, idénticos al admin. */
  kitchenStateLabel(status: string): string {
    switch (status) {
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
        return status;
    }
  }

  /**
   * El badge antepone "Preparación: " salvo en `in_preparation`, cuyo
   * label ya dice lo mismo que el prefijo (paridad guest + voucher).
   */
  kitchenPrepLine(status: string): string {
    const label = this.kitchenStateLabel(status);
    return status === 'in_preparation' ? label : `Preparación: ${label}`;
  }

  /**
   * Paleta KDS del admin mapeada a variantes de `app-badge`:
   * pending→neutral, in_preparation→warning, ready→success,
   * delivered→info, cancelled→error.
   */
  kitchenBadgeVariant(status: string): BadgeVariant {
    switch (status) {
      case 'pending':
        return 'neutral';
      case 'in_preparation':
        return 'warning';
      case 'ready':
        return 'success';
      case 'delivered':
        return 'info';
      case 'cancelled':
        return 'error';
      default:
        return 'neutral';
    }
  }

  // TIPOS — "En preparación" solo con cocina real (paridad guest)

  /**
   * La orden tiene cocina real: al menos un plato prepared (o líneas sin
   * tipo, legacy: se preserva "En preparación" como hasta ahora). Solo
   * cuando TODAS las líneas son físico/servicio conocido se apaga el
   * lenguaje de cocina (tracking, ETA, badges).
   */
  orderHasPreparedItems(order: OrderDetail): boolean {
    const items = order.items ?? [];
    if (!items.length) return true;
    return items.some(
      (i) => i.product_type == null || i.product_type === 'prepared',
    );
  }
}
