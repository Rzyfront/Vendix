import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  HostListener,
} from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';

import {
  ButtonComponent,
  IconComponent,
  ToastService,
  SpinnerComponent,
  CardComponent,
  BadgeComponent,
  DialogService,
} from '../../../../shared/components';
import { selectStoreSettings } from '../../../../core/store/auth/auth.selectors';
import {
  PosCartService,
  CartState,
  CartItem,
} from './services/pos-cart.service';
import { CartSummary } from './models/cart.model';
import {
  PosCustomerService,
  PosCustomer,
} from './services/pos-customer.service';
import { PosPaymentService } from './services/pos-payment.service';
import { PosOrderService } from './services/pos-order.service';
import { StoreOrdersService } from '../orders/services/store-orders.service';
import { PosStatsComponent } from './components/pos-stats.component';
import { PosProductSelectionComponent } from './components/pos-product-selection.component';
import { PosCustomerModalComponent } from './components/pos-customer-modal.component';
import { PosPaymentInterfaceComponent } from './components/pos-payment-interface.component';
import { PosOrderConfirmationComponent } from './components/pos-order-confirmation.component';
import { PosCartComponent } from './cart/pos-cart.component';
import { PosMobileFooterComponent } from './components/pos-mobile-footer.component';
import { PosCartModalComponent } from './components/pos-cart-modal.component';
import { PosShippingModalComponent } from './components/pos-shipping-modal/pos-shipping-modal.component';
import { StoreSettingsService } from '../settings/general/services/store-settings.service';
import { QuotationsService } from '../quotations/services/quotations.service';
import { PosCashRegisterService, CashRegisterSession } from './services/pos-cash-register.service';
import { PosSessionStatusBarComponent } from './components/pos-session-status-bar.component';
import { PosSessionOpenModalComponent } from './components/pos-session-open-modal.component';
import { PosSessionCloseModalComponent } from './components/pos-session-close-modal.component';
import { PosCashMovementModalComponent } from './components/pos-cash-movement-modal.component';
import { PosSessionDetailModalComponent } from './components/pos-session-detail-modal.component';

@Component({
  selector: 'app-pos',
  standalone: true,
  imports: [
    CommonModule,
    ButtonComponent,
    IconComponent,
    SpinnerComponent,
    CardComponent,
    PosStatsComponent,
    PosProductSelectionComponent,
    PosCustomerModalComponent,
    PosPaymentInterfaceComponent,
    PosOrderConfirmationComponent,
    PosCartComponent,
    BadgeComponent,
    PosMobileFooterComponent,
    PosCartModalComponent,
    PosShippingModalComponent,
    PosSessionStatusBarComponent,
    PosSessionOpenModalComponent,
    PosSessionCloseModalComponent,
    PosCashMovementModalComponent,
    PosSessionDetailModalComponent,
  ],
  template: `
    <div class="flex flex-col gap-4 lg:gap-6 overflow-hidden pos-container">
      <!-- POS Stats (hidden on mobile and in quotation mode) -->
      @if (!isQuotationMode()) {
        <div class="flex-none hidden lg:block">
          <app-pos-stats [cartState]="cartState"></app-pos-stats>
        </div>
      }

      <!-- Main POS Interface -->
      <div
        class="flex-1 flex flex-col bg-surface rounded-card shadow-card border border-border min-h-0 overflow-hidden"
      >
        <!-- Header -->
        <div
          class="flex-none px-4 lg:px-6 py-3 lg:py-4 border-b border-border pos-header"
        >
          <div class="flex justify-between items-center gap-3">
            <!-- Left: Logo + Title -->
            <div class="flex items-center gap-2 lg:gap-3">
              <div
                class="w-10 h-10 lg:w-12 lg:h-12 rounded-xl bg-primary/10 flex items-center justify-center"
              >
                <app-icon
                  name="shopping-bag"
                  [size]="isMobile() ? 20 : 24"
                  class="text-primary"
                ></app-icon>
              </div>
              <div class="flex flex-col">
                <h1
                  class="font-bold text-text-primary text-base lg:text-lg leading-none flex items-center gap-2"
                >
                  @if (isQuotationMode()) {
                    <span>Modo Cotización</span>
                    <app-badge variant="primary" class="hidden sm:inline-flex"
                      >Cotización</app-badge
                    >
                  } @else if (isEditMode()) {
                    <span>Editando Orden #{{ editingOrderNumber() }}</span>
                    <app-badge variant="warning" class="hidden sm:inline-flex"
                      >Edición</app-badge
                    >
                  } @else {
                    <span class="hidden sm:inline">Vendix</span> POS
                    <app-badge variant="success" class="hidden sm:inline-flex"
                      >Vende</app-badge
                    >
                  }
                </h1>
                <span
                  class="text-[10px] lg:text-xs text-text-secondary font-medium hidden sm:inline"
                >
                  {{
                    isQuotationMode()
                      ? 'Crear cotización'
                      : isEditMode()
                        ? 'Modificar items de la orden'
                        : 'Punto de venta'
                  }}
                </span>
              </div>
            </div>

            <!-- Right: Customer + Settings -->
            <div class="flex items-center gap-2 lg:gap-3">
              <!-- Customer Badge (desktop only) -->
              <div
                *ngIf="selectedCustomer && !isMobile()"
                class="group flex items-center gap-2.5 bg-gradient-to-r from-primary-light/50 to-primary-light/30 px-3 py-2 rounded-lg cursor-pointer hover:from-primary-light/70 hover:to-primary-light/50 transition-all border border-primary/30 shadow-sm"
                (click)="onOpenCustomerModal()"
              >
                <div
                  class="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary flex-shrink-0"
                >
                  <app-icon name="user" [size]="16"></app-icon>
                </div>
                <div class="flex flex-col min-w-0 flex-1">
                  <span
                    class="font-semibold text-text-primary text-sm leading-tight truncate"
                    [title]="selectedCustomer.name"
                    >{{ selectedCustomer.name }}</span
                  >
                  <span
                    class="text-xs text-text-secondary leading-tight truncate"
                    [title]="selectedCustomer.email"
                    >{{ selectedCustomer.email }}</span
                  >
                </div>
                <div
                  class="w-6 h-6 rounded-full hover:bg-surface/60 flex items-center justify-center transition-colors flex-shrink-0"
                  (click)="$event.stopPropagation(); onClearCustomer()"
                >
                  <app-icon
                    name="x"
                    [size]="14"
                    class="text-text-secondary group-hover:text-destructive transition-colors"
                  ></app-icon>
                </div>
              </div>

              <!-- Add Customer Button (desktop only) -->
              <app-button
                *ngIf="!selectedCustomer && !isMobile()"
                variant="outline"
                size="sm"
                (clicked)="onOpenCustomerModal()"
                class="rounded-lg h-9"
              >
                <app-icon
                  name="user-plus"
                  [size]="16"
                  slot="icon"
                  class="text-primary"
                ></app-icon>
                <span class="hidden sm:inline">Cliente</span>
              </app-button>

              <!-- Cash Register Session Status Bar -->
              @if (cashRegisterEnabled) {
                <app-pos-session-status-bar
                  [session]="activeSession"
                  [showOpenButton]="true"
                  (openClicked)="showSessionOpenModal = true"
                  (closeClicked)="showSessionCloseModal = true"
                  (movementClicked)="showCashMovementModal = true"
                  (detailClicked)="showSessionDetailModal = true"
                ></app-pos-session-status-bar>
              }

            </div>
          </div>
        </div>

        <!-- Main Content Grid -->
        <div
          class="flex-1 flex flex-col p-3 lg:p-6 min-h-0 overflow-hidden pos-main-content relative"
        >
          @if (isOutOfHours && !canBypassSchedule) {
            <!-- Out of hours overlay -->
            <div
              class="absolute inset-0 z-40 bg-surface/90 backdrop-blur-sm flex items-center justify-center p-4"
            >
              <app-card
                class="max-w-md w-full shadow-xl border-border"
                [padding]="true"
              >
                <div
                  class="flex flex-col items-center text-center py-6 px-4 gap-4"
                >
                  <div
                    class="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center text-destructive mb-2"
                  >
                    <app-icon name="clock" [size]="40"></app-icon>
                  </div>
                  <h2 class="text-2xl font-bold text-text-primary">
                    POS Fuera de Horario
                  </h2>
                  <p class="text-text-secondary text-sm leading-relaxed">
                    {{
                      outOfHoursMessage ||
                        'El punto de venta está fuera del horario de atención configurado. No se podrán realizar ventas hasta dentro del horario establecido.'
                    }}
                  </p>

                  @if (nextOpenTime) {
                    <div
                      class="bg-primary/5 border border-primary/20 rounded-xl p-4 w-full mt-2 flex flex-col items-center"
                    >
                      <span
                        class="text-xs text-text-secondary font-medium uppercase tracking-wider mb-1"
                        >Próxima apertura</span
                      >
                      <span class="text-lg font-bold text-primary">{{
                        nextOpenTime
                      }}</span>
                    </div>
                  }

                  <div
                    class="flex flex-col w-full gap-3 mt-6 pt-6 border-t border-border"
                  >
                    <p class="text-xs text-text-secondary mb-1">
                      ¿Necesitas modificar los horarios?
                    </p>
                    <app-button
                      variant="primary"
                      class="w-full"
                      (clicked)="goToSettings()"
                    >
                      <app-icon
                        name="settings"
                        [size]="18"
                        slot="icon"
                      ></app-icon>
                      Configuración de POS y Horarios
                    </app-button>
                    <app-button
                      variant="outline"
                      class="w-full"
                      (clicked)="goToDashboard()"
                    >
                      Volver al Dashboard
                    </app-button>
                  </div>
                </div>
              </app-card>
            </div>
          }

          <!-- Desktop: Flex layout with sidebar cart -->
          <div class="hidden lg:flex gap-6 flex-1 min-h-0 overflow-hidden">
            <!-- Products Area (Left Side - 2/3) -->
            <div class="flex-[2] min-h-0 min-w-0 overflow-hidden">
              <app-pos-product-selection
                class="h-full block"
                [refreshTrigger]="productRefreshCounter"
                (productSelected)="onProductSelected($event)"
                (productAddedToCart)="onProductAddedToCart($event)"
              ></app-pos-product-selection>
            </div>

            <!-- Cart Area (Right Side - 1/3) -->
            <div class="flex-1 min-h-0 min-w-0 overflow-hidden">
              <app-pos-cart
                class="h-full block"
                [isEditMode]="isEditMode()"
                [isQuotationMode]="isQuotationMode()"
                (saveDraft)="onSaveDraft()"
                (shipping)="onShipping()"
                (checkout)="onCheckout()"
                (quote)="onQuote()"
              ></app-pos-cart>
            </div>
          </div>

          <!-- Mobile: Full width products only -->
          <div class="lg:hidden flex-1 min-h-0 pb-20">
            <app-pos-product-selection
              class="h-full block"
              [refreshTrigger]="productRefreshCounter"
              (productSelected)="onProductSelected($event)"
              (productAddedToCart)="onProductAddedToCart($event)"
            ></app-pos-product-selection>
          </div>
        </div>
      </div>

      <!-- Mobile Footer (visible on mobile and tablet for sidebar sync) -->
      <app-pos-mobile-footer
        *ngIf="isMobile() || isTablet()"
        [cartSummary]="cartSummary"
        [itemCount]="cartItems.length"
        [isTablet]="isTablet()"
        [isQuotationMode]="isQuotationMode()"
        (viewCart)="onOpenCartModal()"
        (saveDraft)="onSaveDraft()"
        (shipping)="onShipping()"
        (checkout)="onCheckout()"
        (quote)="onQuote()"
      ></app-pos-mobile-footer>

      <!-- Mobile Cart Modal -->
      <app-pos-cart-modal
        [isOpen]="showCartModal && isMobile()"
        [cartState]="cartState"
        (closed)="onCloseCartModal()"
        (itemQuantityChanged)="onCartItemQuantityChanged($event)"
        (itemRemoved)="onCartItemRemoved($event)"
        (clearCart)="onClearCart()"
        (saveDraft)="onSaveDraftFromModal()"
        (shipping)="onShippingFromModal()"
        (checkout)="onCheckoutFromModal()"
      ></app-pos-cart-modal>

      <!-- Loading Overlay -->
      <div
        *ngIf="loading"
        class="fixed inset-0 z-50 bg-surface/80 backdrop-blur-sm flex items-center justify-center"
      >
        <app-card class="w-auto min-w-[200px]" [padding]="true">
          <div class="flex flex-col items-center py-6 px-4">
            <app-spinner [size]="'lg'" color="primary"></app-spinner>
            <p class="mt-4 text-text-primary font-medium text-sm">
              Procesando solicitud...
            </p>
          </div>
        </app-card>
      </div>

      <!-- Modals -->
      <app-pos-customer-modal
        [isOpen]="showCustomerModal"
        [customer]="editingCustomer"
        (closed)="onCustomerModalClosed()"
        (customerCreated)="onCustomerCreated($event)"
        (customerUpdated)="onCustomerUpdated($event)"
        (customerSelected)="onCustomerSelected($event)"
      ></app-pos-customer-modal>

      <app-pos-payment-interface
        [isOpen]="showPaymentModal"
        [cartState]="cartState"
        (closed)="onPaymentModalClosed()"
        (paymentCompleted)="onPaymentCompleted($event)"
        (requestCustomer)="onOpenCustomerModal()"
        (customerSelected)="onPaymentCustomerSelected($event)"
      ></app-pos-payment-interface>

      <app-pos-shipping-modal
        [isOpen]="showShippingModal"
        [cartState]="cartState"
        (closed)="onShippingModalClosed()"
        (shippingCompleted)="onShippingCompleted($event)"
        (customerSelected)="onPaymentCustomerSelected($event)"
      ></app-pos-shipping-modal>

      <app-pos-order-confirmation
        [isOpen]="showOrderConfirmation"
        [orderData]="completedOrder"
        (closed)="onOrderConfirmationClosed()"
        (newSale)="onStartNewSale()"
        (viewDetail)="onViewOrderDetail($event)"
      ></app-pos-order-confirmation>

      <!-- Cash Register Modals -->
      @if (cashRegisterEnabled) {
        <app-pos-session-open-modal
          [isOpen]="showSessionOpenModal"
          (isOpenChange)="showSessionOpenModal = $event"
          (sessionOpened)="onSessionOpened($event)"
        ></app-pos-session-open-modal>

        <app-pos-session-close-modal
          [isOpen]="showSessionCloseModal"
          [session]="activeSession"
          (isOpenChange)="showSessionCloseModal = $event"
          (sessionClosed)="onSessionClosed($event)"
        ></app-pos-session-close-modal>

        <app-pos-cash-movement-modal
          [isOpen]="showCashMovementModal"
          [sessionId]="activeSession?.id || null"
          (isOpenChange)="showCashMovementModal = $event"
          (movementCreated)="onMovementCreated($event)"
        ></app-pos-cash-movement-modal>

        <app-pos-session-detail-modal
          [isOpen]="showSessionDetailModal"
          [session]="activeSession"
          (isOpenChange)="showSessionDetailModal = $event"
        ></app-pos-session-detail-modal>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        overflow: hidden;
      }
      .pos-container { height: 100%; }

      /* iOS-style blur header */
      .pos-header {
        background: rgba(var(--color-surface-rgb, 255, 255, 255), 0.85);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
      }

      /* Mobile: space for fixed footer */
      @media (max-width: 1023px) {
        .pos-main-content {
          padding-bottom: 80px;
        }
      }
    `,
  ],
})
export class PosComponent implements OnInit, OnDestroy {
  cartState: CartState | null = null;
  selectedCustomer: PosCustomer | null = null;
  loading: boolean = false;

  showCustomerModal = false;
  editingCustomer: PosCustomer | null = null;

  showPaymentModal = false;
  selectedPaymentMethod: any = null;

  showShippingModal = false;


  showOrderConfirmation = false;
  productRefreshCounter = 0;
  showCartModal = false;

  currentOrderId: string | null = null;
  currentOrderNumber: string | null = null;
  completedOrder: any = null;

  public cartItems: CartItem[] = [];
  public cartSummary: CartSummary = {
    subtotal: 0,
    taxAmount: 0,
    discountAmount: 0,
    total: 0,
    itemCount: 0,
    totalItems: 0,
  };

  // Edit mode
  isEditMode = signal(false);
  editingOrderId = signal<string | null>(null);
  editingOrderNumber = signal<string | null>(null);

  // Cash Register
  cashRegisterEnabled = false;
  activeSession: CashRegisterSession | null = null;
  showSessionOpenModal = false;
  showSessionCloseModal = false;
  showCashMovementModal = false;
  showSessionDetailModal = false;

  // Quotation mode
  isQuotationMode = signal(false);
  editingQuotationId = signal<string | null>(null);

  // Mobile detection signal
  isMobile = signal(false);

  // Tablet detection (md breakpoint: 768px-1023px) - for sidebar synchronization
  isTablet = signal(false);

  // Store settings for schedule validation
  storeSettingsSubscription: any;
  enableScheduleValidation = false;
  businessHours: Record<string, { open: string; close: string }> = {};

  // Admin bypass for schedule validation
  isAdmin = false;
  canBypassSchedule = false;
  scheduleStatusChecked = false;

  // Schedule UI State
  isOutOfHours = false;
  nextOpenTime?: string;
  outOfHoursMessage?: string;
  scheduleHandledByBackend = false;
  storeTimezone = 'America/Bogota';

  private destroy$ = new Subject<void>();

  constructor(
    private cartService: PosCartService,
    private customerService: PosCustomerService,
    private paymentService: PosPaymentService,
    private toastService: ToastService,
    private dialogService: DialogService,
    private router: Router,
    private store: Store,
    private route: ActivatedRoute,
    private posOrderService: PosOrderService,
    private ordersService: StoreOrdersService,
    private settingsService: StoreSettingsService,
    private quotationsService: QuotationsService,
    private cashRegisterService: PosCashRegisterService,
  ) {}

  @HostListener('window:resize')
  onResize(): void {
    this.checkMobile();
  }

  private checkMobile(): void {
    const width = window.innerWidth;
    this.isMobile.set(width < 768);
    // Tablet range: 768px - 1023px (where sidebar can be collapsed/expanded)
    this.isTablet.set(width >= 768 && width < 1024);
  }

  ngOnInit(): void {
    this.checkMobile();
    this.setupSubscriptions();
    this.loadStoreSettings();
    this.checkEditMode();
    this.checkQuotationMode();
    this.validateScheduleOnInit();

    // Listen for lazy session validation from payment service
    this.paymentService.sessionRequired$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.showSessionOpenModal = true;
      });
  }

  /**
   * Valida el horario de atención al iniciar el componente
   * Usa el endpoint del backend para obtener el estado con info de admin
   */
  private validateScheduleOnInit(): void {
    this.settingsService
      .getScheduleStatus()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          if (response?.success && response?.data) {
            const status = response.data;
            this.isAdmin = status.isAdmin || false;
            this.canBypassSchedule = status.canBypass || false;
            this.scheduleStatusChecked = true;
            this.scheduleHandledByBackend = true;

            // Si está fuera de horario y no es admin
            if (!status.isWithinBusinessHours && !this.canBypassSchedule) {
              this.isOutOfHours = true;
              this.nextOpenTime = status.nextOpenTime;
              this.outOfHoursMessage = status.message;
            }
            // Si está fuera de horario pero es admin, mostrar warning info
            else if (!status.isWithinBusinessHours && this.canBypassSchedule) {
              this.showAdminScheduleWarning(status.message ?? '');
            }
          }
        },
        error: (err) => {
          console.error('Error validating schedule:', err);
          // En caso de error, permitir acceso pero usar validación local
          this.scheduleStatusChecked = true;
        },
      });
  }

  goToSettings(): void {
    this.router.navigate(['/admin/settings/general']);
  }

  goToDashboard(): void {
    this.router.navigate(['/admin/dashboard']);
  }

  /**
   * Muestra warning para admins (info nada más)
   */
  private showAdminScheduleWarning(message: string): void {
    this.toastService.info(
      message ||
        'Fuera de horario de atención. Tienes acceso de administrador.',
      'Horario de Atención',
      8000,
    );
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setupSubscriptions(): void {
    this.cartService.cartState
      .pipe(takeUntil(this.destroy$))
      .subscribe((cartState: CartState) => {
        this.cartState = cartState;
        this.cartItems = cartState?.items || [];
        this.cartSummary = cartState?.summary || {
          subtotal: 0,
          taxAmount: 0,
          discountAmount: 0,
          total: 0,
          itemCount: 0,
          totalItems: 0,
        };
      });

    this.cartService.customer
      .pipe(takeUntil(this.destroy$))
      .subscribe((customer: PosCustomer | null) => {
        this.selectedCustomer = customer;
      });

    this.cartService.loading
      .pipe(takeUntil(this.destroy$))
      .subscribe((loading: boolean) => {
        this.loading = Boolean(loading);
      });
  }

  get isEmpty(): boolean {
    return !this.cartState || this.cartState.items.length === 0;
  }

  onOpenCustomerModal(): void {
    this.editingCustomer = null;
    this.showCustomerModal = true;
  }

  onClearCustomer(): void {
    this.customerService.clearSelectedCustomer();
    this.cartService
      .setCustomer(null)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.toastService.info('Cliente removido de la venta');
      });
  }

  onCustomerModalClosed(): void {
    this.showCustomerModal = false;
    this.editingCustomer = null;
  }

  onCustomerCreated(customer: PosCustomer): void {
    this.customerService.selectCustomer(customer);
    this.cartService
      .setCustomer(customer)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.showCustomerModal = false;
        this.toastService.success('Cliente agregado correctamente');
      });
  }

  onCustomerUpdated(customer: PosCustomer): void {
    this.customerService.selectCustomer(customer);
    this.cartService
      .setCustomer(customer)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.showCustomerModal = false;
        this.toastService.success('Cliente actualizado correctamente');
      });
  }

  onCustomerSelected(customer: PosCustomer): void {
    this.customerService.selectCustomer(customer);
    this.cartService
      .setCustomer(customer)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.showCustomerModal = false;
        this.toastService.success('Cliente asignado correctamente');
      });
  }

  onPaymentCustomerSelected(customer: PosCustomer): void {
    // Customer selected from the payment modal's internal selector
    this.customerService.selectCustomer(customer);
    this.cartService
      .setCustomer(customer)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.toastService.success('Cliente asignado correctamente');
      });
  }

  onProductSelected(product: any): void {}

  onProductAddedToCart(event: { product: any; quantity: number }): void {
    // Toast is already handled in the child component
  }

  onClearCart(): void {
    this.cartService
      .clearCart()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Carrito vaciado');
        },
        error: (error: any) => {
          this.loading = false;
          this.toastService.error(error.message || 'Error al vaciar carrito');
        },
      });
  }

  onSaveDraft(): void {
    if (!this.cartState || this.isEmpty) return;

    this.loading = true;

    const createdBy = 'current_user';

    this.paymentService
      .saveDraft(this.cartState, createdBy)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          this.loading = false;
          this.toastService.success(
            response.message || 'Borrador guardado correctamente',
          );
          this.onClearCart();
        },
        error: (error: any) => {
          this.loading = false;
          this.toastService.error(error.message || 'Error al guardar borrador');
        },
      });
  }

  onQuote(): void {
    if (!this.selectedCustomer) {
      this.toastService.warning('Debes asignar un cliente para crear una cotización');
      this.onOpenCustomerModal();
      return;
    }

    if (!this.cartState || this.isEmpty) {
      this.toastService.warning('El carrito está vacío');
      return;
    }

    this.loading = true;
    const items = this.cartState.items.map((item) => ({
      product_id: typeof item.product.id === 'string' ? parseInt(item.product.id, 10) : item.product.id,
      product_name: item.product.name,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      discount_amount: 0,
      tax_amount_item: item.taxAmount || 0,
      total_price: item.totalPrice,
    }));

    const dto = {
      customer_id: this.selectedCustomer
        ? this.selectedCustomer.id
        : undefined,
      channel: 'pos' as const,
      items,
      notes: '',
    };

    const editId = this.editingQuotationId();
    const obs$ = editId
      ? this.quotationsService.updateQuotation(Number(editId), dto as any)
      : this.quotationsService.createQuotation(dto as any);

    obs$
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.loading = false;
          const qNumber =
            res?.data?.quotation_number || res?.quotation_number || '';
          this.toastService.success(
            editId
              ? `Cotización ${qNumber} actualizada correctamente`
              : `Cotización ${qNumber} creada correctamente`,
          );
          this.onClearCart();
          if (this.isQuotationMode()) {
            this.router.navigate(['/admin/orders/quotations']);
          }
        },
        error: (err: any) => {
          this.loading = false;
          this.toastService.error(
            err?.error?.message || 'Error al crear cotización',
          );
        },
      });
  }

  onCheckout(): void {
    if (!this.cartState || this.isEmpty) return;

    if (this.isEditMode()) {
      this.updateExistingOrder();
      return;
    }

    // Open payment modal instead of processing directly
    this.showPaymentModal = true;
  }

  onPaymentModalClosed(): void {
    this.showPaymentModal = false;
    this.selectedPaymentMethod = null;
  }

  onPaymentCompleted(paymentData: any): void {
    if (!this.cartState || this.isEmpty) return;

    this.loading = false;
    this.showPaymentModal = false;

    if (paymentData.success) {
      this.currentOrderId = paymentData.order?.id;
      this.currentOrderNumber = paymentData.order?.order_number;

      // Enrich completedOrder with cart state data before clearing it
      this.completedOrder = {
        ...(paymentData.order || {}),
        isCreditSale: !!paymentData.isCreditSale,
        isAnonymousSale: !!paymentData.isAnonymousSale,
        // Ensure we have current cart details for the ticket
        items:
          paymentData.order?.items ||
          this.cartState?.items.map((item) => ({
            product_id: item.product.id,
            product_name: item.product.name,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            total_price: item.totalPrice,
            variant_id: item.variant_id,
            variant_sku: item.variant_sku,
            variant_attributes: item.variant_attributes,
            variant_display_name: item.variant_display_name,
            weight: item.weight || undefined,
            weight_unit: item.weight_unit || undefined,
          })),
        subtotal: paymentData.order?.subtotal || this.cartSummary.subtotal,
        tax_amount: paymentData.order?.tax_amount || this.cartSummary.taxAmount,
        discount_amount:
          paymentData.order?.discount_amount || this.cartSummary.discountAmount,
        total_amount: paymentData.order?.total_amount || this.cartSummary.total,
        // For anonymous sales, use "Consumidor Final" as customer name
        // For regular sales, use customer data from backend or selected customer
        customer_name: paymentData.isAnonymousSale
          ? 'Consumidor Final'
          : paymentData.order?.customer_name ||
            (this.selectedCustomer
              ? `${this.selectedCustomer.first_name} ${this.selectedCustomer.last_name}`
              : ''),
        customer_email:
          !paymentData.isAnonymousSale && this.selectedCustomer?.email
            ? this.selectedCustomer.email
            : paymentData.order?.customer_email || '',
        // For anonymous sales, use "000" as tax ID
        customer_tax_id: paymentData.isAnonymousSale
          ? '000'
          : paymentData.order?.customer_tax_id ||
            this.selectedCustomer?.document_number ||
            '',
        customer: paymentData.order?.customer || this.selectedCustomer,
        payment: paymentData.order?.payment || paymentData.payment,
      };

      this.showOrderConfirmation = true;
      const successMessage = paymentData.isCreditSale
        ? 'Venta a crédito procesada correctamente'
        : 'Venta procesada correctamente';

      this.toastService.success(successMessage);
      this.onClearCart();
      this.productRefreshCounter++;
    }
  }


  onOrderConfirmationClosed(): void {
    this.showOrderConfirmation = false;
    this.completedOrder = null;
  }

  onStartNewSale(): void {
    this.showOrderConfirmation = false;
    this.completedOrder = null;
    this.onClearCart();
  }

  onViewOrderDetail(orderId: string): void {
    const targetOrderId = orderId || this.currentOrderId;
    if (!targetOrderId) {
      this.toastService.error(
        'No se pudo determinar la orden para mostrar el detalle',
      );
      return;
    }

    this.showOrderConfirmation = false;
    this.completedOrder = null;
    this.router.navigate(['/admin/orders', targetOrderId]);
  }

  // Mobile Cart Modal Methods
  onOpenCartModal(): void {
    this.showCartModal = true;
  }

  onCloseCartModal(): void {
    this.showCartModal = false;
  }

  onCartItemQuantityChanged(event: { itemId: string; quantity: number }): void {
    if (event.quantity <= 0) {
      this.onCartItemRemoved(event.itemId);
      return;
    }

    this.cartService
      .updateCartItem({ itemId: event.itemId, quantity: event.quantity })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        error: (error: any) => {
          this.toastService.error(
            error.message || 'Error al actualizar cantidad',
          );
        },
      });
  }

  onCartItemRemoved(itemId: string): void {
    this.cartService
      .removeFromCart(itemId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Producto eliminado del carrito');
        },
        error: (error: any) => {
          this.toastService.error(
            error.message || 'Error al eliminar producto',
          );
        },
      });
  }

  onSaveDraftFromModal(): void {
    this.showCartModal = false;
    this.onSaveDraft();
  }

  onCheckoutFromModal(): void {
    this.showCartModal = false;
    this.onCheckout();
  }

  // Shipping Modal Methods
  onShipping(): void {
    if (!this.cartState || this.isEmpty) {
      this.toastService.warning('El carrito está vacío');
      return;
    }
    this.showShippingModal = true;
  }

  onShippingFromModal(): void {
    this.showCartModal = false;
    this.onShipping();
  }

  onShippingModalClosed(): void {
    this.showShippingModal = false;
  }

  onShippingCompleted(shippingData: any): void {
    if (!this.cartState || this.isEmpty) return;

    this.loading = false;
    this.showShippingModal = false;

    if (shippingData.success) {
      this.currentOrderId = shippingData.order?.id;
      this.currentOrderNumber = shippingData.order?.order_number;

      this.completedOrder = {
        ...(shippingData.order || {}),
        isShippingSale: true,
        items:
          shippingData.order?.items ||
          this.cartState?.items.map((item) => ({
            product_id: item.product.id,
            product_name: item.product.name,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            total_price: item.totalPrice,
            variant_id: item.variant_id,
            variant_sku: item.variant_sku,
            variant_attributes: item.variant_attributes,
            variant_display_name: item.variant_display_name,
            weight: item.weight || undefined,
            weight_unit: item.weight_unit || undefined,
          })),
        subtotal: shippingData.order?.subtotal || this.cartSummary.subtotal,
        tax_amount:
          shippingData.order?.tax_amount || this.cartSummary.taxAmount,
        discount_amount:
          shippingData.order?.discount_amount ||
          this.cartSummary.discountAmount,
        total_amount:
          shippingData.order?.total_amount || this.cartSummary.total,
        customer_name: this.selectedCustomer
          ? `${this.selectedCustomer.first_name} ${this.selectedCustomer.last_name}`
          : shippingData.order?.customer_name || '',
        customer_email:
          this.selectedCustomer?.email ||
          shippingData.order?.customer_email ||
          '',
        customer_tax_id:
          this.selectedCustomer?.document_number ||
          shippingData.order?.customer_tax_id ||
          '',
        customer: shippingData.order?.customer || this.selectedCustomer,
        payment: shippingData.order?.payment || shippingData.payment,
      };

      this.showOrderConfirmation = true;
      this.toastService.success('Orden con envío creada correctamente');
      this.onClearCart();
      this.productRefreshCounter++;
    }
  }

  private checkEditMode(): void {
    this.route.queryParams
      .pipe(takeUntil(this.destroy$))
      .subscribe((params) => {
        const editOrderId = params['editOrder'];
        if (editOrderId) {
          this.loadOrderForEditing(editOrderId.toString());
        }
      });
  }

  private checkQuotationMode(): void {
    this.route.queryParams
      .pipe(takeUntil(this.destroy$))
      .subscribe((params) => {
        const mode = params['mode'];
        const editQuotationId = params['editQuotation'];

        if (mode === 'quotation') {
          this.isQuotationMode.set(true);

          if (editQuotationId) {
            this.loadQuotationForEditing(editQuotationId);
          }
        } else {
          this.isQuotationMode.set(false);
          this.editingQuotationId.set(null);
        }
      });
  }

  private loadQuotationForEditing(quotationId: string): void {
    this.loading = true;
    this.quotationsService.getQuotationById(Number(quotationId))
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          const quotation = response?.data || response;
          const items = (quotation.quotation_items || []).map((item: any) => ({
            product: {
              id: item.product_id?.toString() || item.product?.id?.toString(),
              name: item.product_name || item.product?.name,
              price: item.unit_price,
              image_url: item.product?.image_url || '',
              stock: 999,
              track_inventory: false,
              tax_assignments: item.product?.tax_assignments || [],
            },
            quantity: item.quantity,
            unitPrice: item.unit_price,
            totalPrice: item.total_price,
            taxAmount: item.tax_amount_item || 0,
          }));

          // Load items into cart
          this.cartService.clearCart().pipe(takeUntil(this.destroy$)).subscribe(() => {
            items.forEach((item: any) => {
              this.cartService.addToCart({
                product: item.product,
                quantity: item.quantity,
              }).pipe(takeUntil(this.destroy$)).subscribe();
            });
          });

          // Set customer if available
          if (quotation.customer) {
            const customer: PosCustomer = {
              id: quotation.customer.id,
              first_name: quotation.customer.first_name,
              last_name: quotation.customer.last_name,
              name: `${quotation.customer.first_name} ${quotation.customer.last_name}`,
              email: quotation.customer.email || '',
              phone: quotation.customer.phone || '',
              document_number: quotation.customer.document_number || '',
              created_at: quotation.customer.created_at || new Date(),
              updated_at: quotation.customer.updated_at || new Date(),
            };
            this.customerService.selectCustomer(customer);
            this.cartService.setCustomer(customer).pipe(takeUntil(this.destroy$)).subscribe();
          }

          this.editingQuotationId.set(quotationId);
          this.loading = false;
          this.toastService.info(`Editando Cotización #${quotation.quotation_number}`);
        },
        error: () => {
          this.loading = false;
          this.toastService.error('Error al cargar cotización');
          this.router.navigate(['/admin/orders/quotations']);
        },
      });
  }

  private loadOrderForEditing(orderId: string): void {
    this.loading = true;
    this.ordersService
      .getOrderById(orderId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          const order = response.data || response;

          if (order.state !== 'created') {
            this.loading = false;
            this.toastService.error(
              'Solo se pueden editar ordenes en estado "Creada"',
            );
            this.router.navigate(['/admin/orders', orderId]);
            return;
          }

          // Load order items into cart
          this.cartService
            .loadFromOrder(order)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: () => {
                this.isEditMode.set(true);
                this.editingOrderId.set(orderId);
                this.editingOrderNumber.set(order.order_number);
                this.loading = false;
                this.toastService.info(`Editando Orden #${order.order_number}`);
              },
              error: (err) => {
                this.loading = false;
                this.toastService.error(
                  'Error al cargar los productos de la orden',
                );
              },
            });
        },
        error: (err) => {
          this.loading = false;
          this.toastService.error('Error al cargar la orden para edición');
          this.router.navigate(['/admin/orders']);
        },
      });
  }

  private updateExistingOrder(): void {
    if (!this.cartState || !this.editingOrderId()) return;

    this.loading = true;
    this.posOrderService
      .updateOrderItems(this.editingOrderId()!, this.cartState)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loading = false;
          this.toastService.success('Orden actualizada exitosamente');
          this.cartService
            .clearCart()
            .pipe(takeUntil(this.destroy$))
            .subscribe();
          this.isEditMode.set(false);
          this.router.navigate(['/admin/orders', this.editingOrderId()]);
        },
        error: (err) => {
          this.loading = false;
          this.toastService.error(
            err.message || 'Error al actualizar la orden',
          );
        },
      });
  }

  private loadStoreSettings(): void {
    this.storeSettingsSubscription = this.store
      .select(selectStoreSettings)
      .pipe(takeUntil(this.destroy$))
      .subscribe((storeSettings: any) => {
        const settings = storeSettings;
        if (settings?.general?.timezone) {
          this.storeTimezone = settings.general.timezone;
        }
        if (settings?.pos) {
          this.enableScheduleValidation =
            settings.pos.enable_schedule_validation || false;
          this.businessHours = settings.pos.business_hours || {};

          // Initialize cash register feature
          const crEnabled = settings.pos.cash_register?.enabled || false;
          this.cashRegisterEnabled = crEnabled;
          this.cashRegisterService.setFeatureEnabled(crEnabled);
          this.paymentService.setRequireSessionForSales(
            settings.pos.cash_register?.require_session_for_sales || false,
          );
          if (crEnabled) {
            this.initCashRegisterSession();
          }

          // Fallback: si NgRx no tiene cash_register (localStorage desactualizado),
          // consultar directamente al backend
          if (!settings.pos.cash_register) {
            this.settingsService
              .getSettings()
              .pipe(takeUntil(this.destroy$))
              .subscribe((response) => {
                const freshSettings = response?.data;
                if (freshSettings?.pos?.cash_register) {
                  const crFresh =
                    freshSettings.pos.cash_register.enabled || false;
                  this.cashRegisterEnabled = crFresh;
                  this.cashRegisterService.setFeatureEnabled(crFresh);
                  this.paymentService.setRequireSessionForSales(
                    freshSettings.pos.cash_register
                      .require_session_for_sales || false,
                  );
                  if (crFresh) {
                    this.initCashRegisterSession();
                  }
                }
              });
          }

          // Only apply local fallback if backend hasn't handled schedule validation
          if (
            !this.scheduleHandledByBackend &&
            this.scheduleStatusChecked &&
            this.enableScheduleValidation &&
            !this.isWithinBusinessHours() &&
            !this.canBypassSchedule
          ) {
            this.isOutOfHours = true;
            this.nextOpenTime = this.getLocalNextOpenDay();
            this.outOfHoursMessage =
              'El punto de venta está fuera del horario de atención configurado (Validación local).';
          }
        }
      });
  }

  /**
   * Gets day/hour/minute in the store's timezone using Intl.DateTimeFormat
   */
  private getDateInTimezone(): { day: number; hours: number; minutes: number } {
    const now = new Date();
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: this.storeTimezone,
        weekday: 'short',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      }).formatToParts(now);

      const weekdayStr = parts.find((p) => p.type === 'weekday')?.value || '';
      const hoursVal = parseInt(
        parts.find((p) => p.type === 'hour')?.value || '0',
        10,
      );
      const minutesVal = parseInt(
        parts.find((p) => p.type === 'minute')?.value || '0',
        10,
      );

      const weekdayMap: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      const dayVal = weekdayMap[weekdayStr] ?? now.getDay();

      return { day: dayVal, hours: hoursVal, minutes: minutesVal };
    } catch {
      return {
        day: now.getDay(),
        hours: now.getHours(),
        minutes: now.getMinutes(),
      };
    }
  }

  private isWithinBusinessHours(): boolean {
    if (!this.enableScheduleValidation) {
      return true;
    }

    const { day, hours, minutes } = this.getDateInTimezone();
    const dayNames = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];
    const currentDayName = dayNames[day];

    const todayHours = this.businessHours?.[currentDayName];

    if (!todayHours) {
      return true;
    }

    if (todayHours.open === 'closed' || todayHours.close === 'closed') {
      return false;
    }

    const currentTime = hours * 60 + minutes;

    const [openHour, openMinute] = todayHours.open.split(':').map(Number);
    const [closeHour, closeMinute] = todayHours.close.split(':').map(Number);

    const openTime = openHour * 60 + openMinute;
    const closeTime = closeHour * 60 + closeMinute;

    return currentTime >= openTime && currentTime <= closeTime;
  }

  /**
   * Iterates business hours to find the next open day for the local fallback
   */
  private getLocalNextOpenDay(): string {
    const dayNames = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];
    const spanishDays: Record<string, string> = {
      sunday: 'Domingo',
      monday: 'Lunes',
      tuesday: 'Martes',
      wednesday: 'Miércoles',
      thursday: 'Jueves',
      friday: 'Viernes',
      saturday: 'Sábado',
    };

    const { day, hours, minutes } = this.getDateInTimezone();
    const curMinutes = hours * 60 + minutes;

    // Check if today opens later
    const todayName = dayNames[day];
    const todayHours = this.businessHours?.[todayName];
    if (
      todayHours &&
      todayHours.open !== 'closed' &&
      todayHours.close !== 'closed'
    ) {
      const [openH, openM] = todayHours.open.split(':').map(Number);
      if (curMinutes < openH * 60 + openM) {
        return `Hoy ${todayHours.open} - ${todayHours.close}`;
      }
    }

    for (let i = 1; i <= 7; i++) {
      const dayIndex = (day + i) % 7;
      const dayName = dayNames[dayIndex];
      const bh = this.businessHours?.[dayName];
      if (bh && bh.open !== 'closed' && bh.close !== 'closed') {
        return `${spanishDays[dayName]} ${bh.open} - ${bh.close}`;
      }
    }

    return 'Consultar configuración';
  }

  // =============================================
  // Cash Register Methods
  // =============================================

  private initCashRegisterSession(): void {
    this.cashRegisterService.fetchActiveSession()
      .pipe(takeUntil(this.destroy$))
      .subscribe((session) => {
        this.activeSession = session;
        // Status bar shows session state — no auto-pop modal.
        // User can open session voluntarily via status bar button,
        // or will be prompted at the moment of a transactional action.
      });
  }

  onSessionOpened(session: CashRegisterSession): void {
    this.activeSession = session;
    this.showSessionOpenModal = false;
    this.toastService.success(`Caja "${session.register?.name}" abierta`);
  }

  onSessionClosed(session: CashRegisterSession): void {
    this.activeSession = null;
    this.showSessionCloseModal = false;

    const diff = Number(session.difference || 0);
    const diffStr = diff >= 0 ? `+$${diff.toFixed(2)}` : `-$${Math.abs(diff).toFixed(2)}`;
    this.toastService.info(
      `Caja cerrada. Diferencia: ${diffStr}`,
      'Cierre de Caja',
      6000,
    );
  }

  onMovementCreated(_movement: any): void {
    this.showCashMovementModal = false;
  }
}
