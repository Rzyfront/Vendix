import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';

import {
  ButtonComponent,
  IconComponent,
  ToastService,
  SpinnerComponent,
} from '../../../../shared/components';
import { PosCartService, CartState } from './services/pos-cart.service';
import {
  PosCustomerService,
  PosCustomer,
} from './services/pos-customer.service';
import { PosOrderService } from './services/pos-order.service';
import { PosProductSelectionComponent } from './components/pos-product-selection.component';

@Component({
  selector: 'app-pos',
  standalone: true,
  imports: [
    CommonModule,
    ButtonComponent,
    IconComponent,
    SpinnerComponent,
    PosProductSelectionComponent,
  ],
  styleUrls: ['./pos.component.scss'],
  template: `
    <div class="pos-container">
      <header class="pos-header">
        <div class="header-content">
          <div class="header-brand">
            <div class="brand-icon-container">
              <app-icon
                name="store"
                [size]="20"
                color="white"
              ></app-icon>
            </div>
            <div class="brand-text">
              <h1>Vendix POS</h1>
              <p>Punto de Venta</p>
            </div>
          </div>

          <div class="header-actions">
            <div
              *ngIf="selectedCustomer"
              class="customer-badge"
            >
              <app-icon name="user" [size]="16"></app-icon>
              <span>{{ selectedCustomer.name }}</span>
            </div>

            <app-button
              *ngIf="!selectedCustomer"
              variant="outline"
              size="sm"
              (clicked)="onOpenCustomerModal()"
            >
              <app-icon name="user-plus" [size]="16" slot="icon"></app-icon>
              Agregar Cliente
            </app-button>
          </div>
        </div>
      </header>

      <div class="pos-main">
        <div class="product-section">
          <app-pos-product-selection
            (productSelected)="onProductSelected($event)"
            (productAddedToCart)="onProductAddedToCart($event)"
          ></app-pos-product-selection>
        </div>

        <div class="cart-section">
          <div class="cart-header">
            <div class="cart-title-row">
              <h2 class="cart-title">Carrito</h2>
              <app-button
                *ngIf="!isEmpty"
                variant="ghost"
                size="sm"
                (clicked)="onClearCart()"
              >
                <app-icon name="trash-2" [size]="16" slot="icon"></app-icon>
              </app-button>
            </div>

            <div *ngIf="isEmpty" class="cart-empty-state">
              <app-icon
                name="cart"
                [size]="48"
                class="cart-empty-icon"
              ></app-icon>
              <p class="cart-empty-text">Carrito vacío</p>
              <p class="cart-empty-subtext">
                Agrega productos para comenzar
              </p>
            </div>

            <div *ngIf="!isEmpty" class="cart-items-container">
              <div
                *ngFor="let item of cartItems"
                class="cart-item"
              >
                <div class="cart-item-info">
                  <p class="cart-item-name">
                    {{ item.product.name }}
                  </p>
                  <p class="cart-item-details">
                    {{ item.quantity }}x {{ item.unitPrice }}
                  </p>
                </div>
                <div class="cart-item-actions">
                  <span class="cart-item-price">{{
                    item.totalPrice
                  }}</span>
                  <app-button
                    variant="ghost"
                    size="sm"
                    (clicked)="onRemoveFromCart(item.id)"
                  >
                    <app-icon name="x" [size]="14"></app-icon>
                  </app-button>
                </div>
              </div>
            </div>
          </div>

          <div *ngIf="!isEmpty" class="cart-summary-section">
            <div class="space-y-2">
              <div class="summary-row">
                <span class="summary-label">Subtotal:</span>
                <span class="summary-value">{{ cartSummary.subtotal }}</span>
              </div>
              <div
                *ngIf="cartSummary.discountAmount > 0"
                class="summary-row discount"
              >
                <span class="summary-label">Descuento:</span>
                <span class="summary-value">
                  -{{ cartSummary.discountAmount }}
                </span>
              </div>
              <div class="summary-row">
                <span class="summary-label">Impuestos:</span>
                <span class="summary-value">{{ cartSummary.taxAmount }}</span>
              </div>
              <div class="summary-row total">
                <span class="summary-label">Total:</span>
                <span class="summary-value">{{ cartSummary.total }}</span>
              </div>
            </div>

            <div class="payment-actions">
              <app-button
                variant="outline"
                size="md"
                class="w-full"
                (clicked)="onSaveDraft()"
              >
                <app-icon name="save" [size]="16" slot="icon"></app-icon>
                Guardar Borrador
              </app-button>
              <button
                class="pay-button"
                (click)="onCheckout()"
                [disabled]="isEmpty || loading"
              >
                <app-icon name="credit-card" [size]="16"></app-icon>
                Procesar Venta
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        *ngIf="loading"
        class="absolute inset-0 bg-white bg-opacity-80 flex items-center justify-center z-50"
      >
        <div class="text-center">
          <app-spinner [size]="'xl'"></app-spinner>
          <p class="mt-4 text-gray-900">Procesando...</p>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100vh;
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

  currentOrderId: string | null = null;
  currentOrderNumber: string | null = null;
  completedOrder: any = null;

  public cartItems: any[] = [];
  public cartSummary: any = {
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
    private orderService: PosOrderService,
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
    console.log('Product selected:', product);
  }

  onProductAddedToCart(event: { product: any; quantity: number }): void {
    this.toastService.success(event.product.name + ' agregado al carrito');
  }

  onRemoveFromCart(itemId: string): void {
    this.cartService
      .removeFromCart(itemId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Producto eliminado del carrito');
        },
        error: (error: any) => {
          this.loading = false;
          this.toastService.error(
            error.message || 'Error al eliminar producto',
          );
        },
      });
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

    const storeId = 'store_001';
    const organizationId = 'org_001';
    const createdBy = 'current_user';

    this.orderService
      .createDraftOrder(this.cartState, storeId, organizationId, createdBy)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loading = false;
          this.toastService.success('Borrador guardado correctamente');
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

    this.loading = true;

    const storeId = 'store_001';
    const organizationId = 'org_001';
    const createdBy = 'current_user';

    this.orderService
      .createOrderFromCart(this.cartState, storeId, organizationId, createdBy)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (order: any) => {
          this.loading = false;
          this.currentOrderId = order.id;
          this.currentOrderNumber = order.orderNumber;
          this.toastService.success('Orden creada correctamente');
          this.onClearCart();
        },
        error: (error: any) => {
          this.loading = false;
          this.toastService.error(error.message || 'Error al crear orden');
        },
      });
  }

  onQuickSearch(): void {
    this.toastService.info('Usa Ctrl+F para búsqueda rápida');
  }

  onViewOrders(): void {
    this.toastService.info('Vista de órdenes próximamente');
  }
}
