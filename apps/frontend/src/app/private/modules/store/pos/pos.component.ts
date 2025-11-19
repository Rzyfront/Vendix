import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';

import {
  ButtonComponent,
  IconComponent,
  ToastService,
  SpinnerComponent,
  CardComponent,
} from '../../../../shared/components';
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
  ],
  template: `
    <div class="h-full flex flex-col gap-4 p-4 overflow-hidden">
      <!-- POS Stats -->
      <div class="flex-none">
        <app-pos-stats [cartState]="cartState"></app-pos-stats>
      </div>

      <!-- Main POS Interface -->
      <div
        class="flex-1 flex flex-col bg-surface rounded-card shadow-card border border-border min-h-0 overflow-hidden"
      >
        <!-- Header -->
        <div class="flex-none px-6 py-4 border-b border-border">
          <div
            class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
          >
            <div class="flex items-center gap-3">
              <div
                class="w-10 h-10 bg-primary rounded-lg flex items-center justify-center shadow-md"
              >
                <app-icon
                  name="store"
                  [size]="20"
                  class="text-white"
                ></app-icon>
              </div>
              <div class="flex flex-col">
                <h1 class="font-bold text-text-primary text-lg leading-none">
                  Vendix POS
                </h1>
                <span class="text-xs text-text-secondary font-medium">
                  Point of Sale
                </span>
              </div>
            </div>

            <div class="flex items-center gap-3">
              <!-- Customer Badge -->
              <div
                *ngIf="selectedCustomer"
                class="group flex items-center gap-3 bg-primary-light px-4 py-2 rounded-lg cursor-pointer hover:bg-primary-light/80 transition-all border border-primary/20"
                (click)="onOpenCustomerModal()"
              >
                <div
                  class="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary"
                >
                  <app-icon name="user" [size]="16"></app-icon>
                </div>
                <div class="flex flex-col">
                  <span
                    class="text-xs text-text-secondary font-medium leading-none"
                    >Cliente</span
                  >
                  <span
                    class="font-semibold text-text-primary leading-none truncate max-w-[150px]"
                    >{{ selectedCustomer.name }}</span
                  >
                </div>
                <div
                  class="w-6 h-6 rounded-full hover:bg-surface/50 flex items-center justify-center ml-1 transition-colors"
                  (click)="$event.stopPropagation(); onClearCustomer()"
                >
                  <app-icon
                    name="x"
                    [size]="14"
                    class="text-text-secondary group-hover:text-destructive transition-colors"
                  ></app-icon>
                </div>
              </div>

              <app-button
                *ngIf="!selectedCustomer"
                variant="outline"
                size="md"
                (clicked)="onOpenCustomerModal()"
                class="rounded-lg"
              >
                <app-icon
                  name="user-plus"
                  [size]="18"
                  slot="icon"
                  class="text-primary"
                ></app-icon>
                Asignar Cliente
              </app-button>

              <div class="flex gap-2 items-center">
                <app-button
                  variant="ghost"
                  size="md"
                  (clicked)="onViewOrders()"
                  title="Ver órdenes"
                  class="w-10 h-10 !p-0 flex items-center justify-center rounded-lg"
                >
                  <app-icon
                    name="history"
                    [size]="20"
                    class="text-text-secondary"
                  ></app-icon>
                </app-button>

                <app-button
                  variant="ghost"
                  size="md"
                  (clicked)="onQuickSearch()"
                  title="Búsqueda rápida"
                  class="w-10 h-10 !p-0 flex items-center justify-center rounded-lg"
                >
                  <app-icon
                    name="search"
                    [size]="20"
                    class="text-text-secondary"
                  ></app-icon>
                </app-button>
              </div>
            </div>
          </div>
        </div>

        <!-- Main Content Grid -->
        <div class="flex-1 p-4 sm:p-6 min-h-0 overflow-hidden">
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 h-full">
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
        </div>
      </div>

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
      ></app-pos-customer-modal>

      <app-pos-payment-interface
        [isOpen]="showPaymentModal"
        [cartState]="cartState"
        (closed)="onPaymentModalClosed()"
        (paymentCompleted)="onPaymentCompleted($event)"
      ></app-pos-payment-interface>

      <app-pos-order-confirmation
        [isOpen]="showOrderConfirmation"
        [orderData]="completedOrder"
        (closed)="onOrderConfirmationClosed()"
        (newSale)="onStartNewSale()"
      ></app-pos-order-confirmation>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
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

  showOrderConfirmation = false;

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

  private destroy$ = new Subject<void>();

  constructor(
    private cartService: PosCartService,
    private customerService: PosCustomerService,
    private paymentService: PosPaymentService,
    private toastService: ToastService,
  ) {}

  ngOnInit(): void {
    this.setupSubscriptions();
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
    this.toastService.info('Cliente removido de la venta');
  }

  onCustomerModalClosed(): void {
    this.showCustomerModal = false;
    this.editingCustomer = null;
  }

  onCustomerCreated(customer: PosCustomer): void {
    this.customerService.selectCustomer(customer);
    this.showCustomerModal = false;
    this.toastService.success('Cliente agregado correctamente');
  }

  onCustomerUpdated(customer: PosCustomer): void {
    this.customerService.selectCustomer(customer);
    this.showCustomerModal = false;
    this.toastService.success('Cliente actualizado correctamente');
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

    this.loading = true;
    this.showPaymentModal = false;

    const createdBy = 'current_user';

    if (paymentData.isCreditSale) {
      // Handle credit sale
      this.paymentService
        .processCreditSale(this.cartState, createdBy)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (result: any) => {
            this.loading = false;
            this.currentOrderId = result.order?.id;
            this.currentOrderNumber = result.order?.order_number;
            this.completedOrder = {
              ...result.order,
              isCreditSale: true,
            };
            this.showOrderConfirmation = true;
            this.toastService.success(
              'Venta a crédito procesada correctamente',
            );
            this.onClearCart();
          },
          error: (error: any) => {
            this.loading = false;
            this.toastService.error(
              error.message || 'Error al procesar la venta a crédito',
            );
          },
        });
    } else {
      // Process sale with payment using orquestrator
      this.paymentService
        .processSaleWithPayment(this.cartState, paymentData, createdBy)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (result: any) => {
            this.loading = false;
            this.currentOrderId = result.order?.id;
            this.currentOrderNumber = result.order?.order_number;
            this.completedOrder = result.order;
            this.showOrderConfirmation = true;
            this.toastService.success('Venta procesada correctamente');
            this.onClearCart();
          },
          error: (error: any) => {
            this.loading = false;
            this.toastService.error(
              error.message || 'Error al procesar la venta',
            );
          },
        });
    }
  }

  onQuickSearch(): void {
    // Dispatch an event or focus the search input
    const searchInput = document.querySelector(
      'input[type="search"]',
    ) as HTMLInputElement;
    if (searchInput) {
      searchInput.focus();
    }
  }

  onViewOrders(): void {
    this.toastService.info('Historial de ventas próximamente');
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
}
