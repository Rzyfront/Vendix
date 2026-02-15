import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  HostListener,
  ChangeDetectorRef,
} from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
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
import { PosStatsComponent } from './components/pos-stats.component';
import { PosProductSelectionComponent } from './components/pos-product-selection.component';
import { PosCustomerModalComponent } from './components/pos-customer-modal.component';
import { PosPaymentInterfaceComponent } from './components/pos-payment-interface.component';
import { PosOrderConfirmationComponent } from './components/pos-order-confirmation.component';
import { PosCartComponent } from './cart/pos-cart.component';
import { PosRegisterConfigModalComponent } from './components/pos-register-config-modal.component';
import { PosMobileFooterComponent } from './components/pos-mobile-footer.component';
import { PosCartModalComponent } from './components/pos-cart-modal.component';

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
    PosRegisterConfigModalComponent,
    BadgeComponent,
    PosMobileFooterComponent,
    PosCartModalComponent,
  ],
  template: `
    <div class="h-full flex flex-col gap-4 overflow-hidden pos-container">
      <!-- POS Stats (hidden on mobile) -->
      <div class="flex-none hidden lg:block">
        <app-pos-stats [cartState]="cartState"></app-pos-stats>
      </div>

      <!-- Main POS Interface -->
      <div
        class="flex-1 flex flex-col bg-surface rounded-card shadow-card border border-border min-h-0 overflow-hidden"
      >
        <!-- Header -->
        <div class="flex-none px-4 lg:px-6 py-3 lg:py-4 border-b border-border pos-header">
          <div
            class="flex justify-between items-center gap-3"
          >
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
                <h1 class="font-bold text-text-primary text-base lg:text-lg leading-none flex items-center gap-2">
                  <span class="hidden sm:inline">Vendix</span> POS
                  <app-badge variant="success" class="hidden sm:inline-flex">Vende</app-badge>
                </h1>
                <span class="text-[10px] lg:text-xs text-text-secondary font-medium hidden sm:inline">
                  Punto de venta
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

              <!-- Settings Button -->
              <app-button
                variant="ghost"
                size="md"
                (clicked)="onOpenRegisterConfigModal()"
                title="Configurar Caja"
                class="w-9 h-9 lg:w-10 lg:h-10 !p-0 flex items-center justify-center rounded-lg text-text-secondary hover:text-primary hover:bg-primary-light/10 transition-colors"
              >
                <app-icon
                  name="settings"
                  [size]="isMobile() ? 18 : 20"
                  class="currentColor"
                ></app-icon>
              </app-button>
            </div>
          </div>
        </div>

        <!-- Main Content Grid -->
        <div class="flex-1 p-3 lg:p-6 min-h-0 overflow-hidden pos-main-content">
          <!-- Desktop: Grid 3 columns with sidebar cart -->
          <div class="hidden lg:grid lg:grid-cols-3 gap-6 h-full">
            <!-- Products Area (Left Side - 2 columns) -->
            <div class="lg:col-span-2 h-full min-h-0">
              <app-pos-product-selection
                class="h-full block"
                (productSelected)="onProductSelected($event)"
                (productAddedToCart)="onProductAddedToCart($event)"
              ></app-pos-product-selection>
            </div>

            <!-- Cart Area (Right Side - 1 column) -->
            <div class="h-full min-h-0">
              <app-pos-cart
                class="h-full block"
                (saveDraft)="onSaveDraft()"
                (checkout)="onCheckout()"
              ></app-pos-cart>
            </div>
          </div>

          <!-- Mobile: Full width products only -->
          <div class="lg:hidden h-full pb-20">
            <app-pos-product-selection
              class="h-full block"
              (productSelected)="onProductSelected($event)"
              (productAddedToCart)="onProductAddedToCart($event)"
            ></app-pos-product-selection>
          </div>
        </div>
      </div>

      <!-- Mobile Footer (only visible on mobile) -->
      <app-pos-mobile-footer
        *ngIf="isMobile()"
        [cartSummary]="cartSummary"
        [itemCount]="cartItems.length"
        (viewCart)="onOpenCartModal()"
        (saveDraft)="onSaveDraft()"
        (checkout)="onCheckout()"
      ></app-pos-mobile-footer>

      <!-- Mobile Cart Modal -->
      <app-pos-cart-modal
        [isOpen]="showCartModal && isMobile()"
        [cartState]="cartState"
        (closed)="onCloseCartModal()"
        (itemQuantityChanged)="onCartItemQuantityChanged($event)"
        (itemRemoved)="onCartItemRemoved($event)"
        (clearCart)="onClearCart()"
        (assignCustomer)="onOpenCustomerModal()"
        (saveDraft)="onSaveDraftFromModal()"
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
        (requestRegisterConfig)="onOpenRegisterConfigModal()"
        (customerSelected)="onPaymentCustomerSelected($event)"
      ></app-pos-payment-interface>

      <app-pos-order-confirmation
        [isOpen]="showOrderConfirmation"
        [orderData]="completedOrder"
        (closed)="onOrderConfirmationClosed()"
        (newSale)="onStartNewSale()"
      ></app-pos-order-confirmation>

      <app-pos-register-config-modal
        [isOpen]="showRegisterConfigModal"
        (closed)="onRegisterConfigModalClosed()"
        (saved)="onRegisterConfigSaved($event)"
      ></app-pos-register-config-modal>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      .pos-container {
        height: 100%;
      }

      /* iOS-style blur header */
      .pos-header {
        background: rgba(var(--color-surface-rgb, 255, 255, 255), 0.85);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
      }

      /* Mobile optimizations */
      @media (max-width: 1023px) {
        .pos-main-content {
          padding-bottom: 80px; /* Space for mobile footer */
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

  showRegisterConfigModal = false;

  showOrderConfirmation = false;
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

  // Mobile detection signal
  isMobile = signal(false);

  // Store settings for schedule validation
  storeSettingsSubscription: any;
  enableScheduleValidation = false;
  businessHours: Record<string, { open: string; close: string }> = {};

  private destroy$ = new Subject<void>();

  constructor(
    private cartService: PosCartService,
    private customerService: PosCustomerService,
    private paymentService: PosPaymentService,
    private toastService: ToastService,
    private dialogService: DialogService,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private store: Store,
  ) {}

  @HostListener('window:resize')
  onResize(): void {
    this.checkMobile();
  }

  private checkMobile(): void {
    this.isMobile.set(window.innerWidth < 1024);
  }

  ngOnInit(): void {
    this.checkMobile();
    this.setupSubscriptions();
    this.loadStoreSettings();
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

  onProductSelected(product: any): void {
    // Product selected from POS product selection
    // console.log('Product selected:', product);
  }

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

  onCheckout(): void {
    if (!this.cartState || this.isEmpty) return;

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
          : (paymentData.order?.customer_name || (this.selectedCustomer
              ? `${this.selectedCustomer.first_name} ${this.selectedCustomer.last_name}`
              : '')),
        customer_email: (!paymentData.isAnonymousSale && this.selectedCustomer?.email)
          ? this.selectedCustomer.email
          : paymentData.order?.customer_email || '',
        // For anonymous sales, use "000" as tax ID
        customer_tax_id: paymentData.isAnonymousSale
          ? '000'
          : (paymentData.order?.customer_tax_id || this.selectedCustomer?.document_number || ''),
        customer: paymentData.order?.customer || this.selectedCustomer,
        payment: paymentData.order?.payment || paymentData.payment,
      };

      this.showOrderConfirmation = true;
      const successMessage = paymentData.isCreditSale
        ? 'Venta a crédito procesada correctamente'
        : 'Venta procesada correctamente';

      this.toastService.success(successMessage);
      this.onClearCart();
    }
  }

  onOpenRegisterConfigModal(): void {
    this.showRegisterConfigModal = true;
  }

  onRegisterConfigModalClosed(): void {
    this.showRegisterConfigModal = false;
  }

  onRegisterConfigSaved(registerId: string): void {
    this.toastService.success(`Caja configurada: ${registerId}`);
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

  private loadStoreSettings(): void {
    this.storeSettingsSubscription = this.store.select(selectStoreSettings).pipe(takeUntil(this.destroy$)).subscribe((storeSettings: any) => {
      const settings = storeSettings;
      if (settings?.pos) {
        this.enableScheduleValidation = settings.pos.enable_schedule_validation || false;
        this.businessHours = settings.pos.business_hours || {};

        // Check if outside business hours and show modal
        if (this.enableScheduleValidation && !this.isWithinBusinessHours()) {
          this.showScheduleWarningModal();
        }
      }
    });
  }

  private isWithinBusinessHours(): boolean {
    if (!this.enableScheduleValidation) {
      return true;
    }

    const now = new Date();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDayName = dayNames[now.getDay()];

    const todayHours = this.businessHours?.[currentDayName];

    if (!todayHours) {
      return true;
    }

    if (todayHours.open === 'closed' || todayHours.close === 'closed') {
      return false;
    }

    const currentTime = now.getHours() * 60 + now.getMinutes();

    const [openHour, openMinute] = todayHours.open.split(':').map(Number);
    const [closeHour, closeMinute] = todayHours.close.split(':').map(Number);

    const openTime = openHour * 60 + openMinute;
    const closeTime = closeHour * 60 + closeMinute;

    return currentTime >= openTime && currentTime <= closeTime;
  }

  private showScheduleWarningModal(): void {
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const today = dayNames[new Date().getDay()];

    this.dialogService.confirm({
      title: 'POS Fuera de Horario',
      message: `El punto de venta está fuera del horario de atención configurado para hoy <strong>${today}</strong>. No se podrán realizar ventas hasta dentro del horario establecido.`,
      confirmText: 'Ir a Configuración',
      cancelText: 'Cerrar',
      confirmVariant: 'primary',
    }).then((confirmed) => {
      if (confirmed) {
        this.router.navigate(['/admin/settings/general']);
      }
    });
  }
}
