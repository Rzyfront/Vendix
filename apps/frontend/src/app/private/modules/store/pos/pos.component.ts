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

@Component({
  selector: 'app-pos',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent, SpinnerComponent],
  template: `
    <div class="h-screen flex flex-col bg-gray-100">
      <header class="bg-white border-b px-6 py-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-4">
            <div
              class="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center"
            >
              <app-icon
                name="shopping-cart"
                [size]="20"
                color="white"
              ></app-icon>
            </div>
            <div>
              <h1 class="text-xl font-bold text-gray-900">Vendix POS</h1>
              <p class="text-sm text-gray-600">Punto de Venta</p>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <div
              *ngIf="selectedCustomer"
              class="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg"
            >
              <app-icon name="user" [size]="16" color="blue"></app-icon>
              <span class="text-sm font-medium text-blue-600">{{
                selectedCustomer.name
              }}</span>
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

      <div class="flex-1 flex overflow-hidden">
        <div class="w-2/3 border-r bg-white p-4">
          <h2 class="text-lg font-semibold text-gray-900 mb-4">Productos</h2>
          <p class="text-sm text-gray-600">
            Selecciona productos para agregar al carrito
          </p>
        </div>

        <div class="w-1/3 flex flex-col bg-gray-50">
          <div class="p-4 border-b">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-lg font-semibold text-gray-900">Carrito</h2>
              <app-button
                *ngIf="!isEmpty"
                variant="ghost"
                size="sm"
                (clicked)="onClearCart()"
              >
                <app-icon name="trash-2" [size]="16" slot="icon"></app-icon>
              </app-button>
            </div>

            <div *ngIf="isEmpty" class="text-center py-8">
              <app-icon
                name="shopping-cart"
                [size]="48"
                color="gray"
              ></app-icon>
              <p class="mt-3 text-gray-600">Carrito vacío</p>
              <p class="text-sm text-gray-500">
                Agrega productos para comenzar
              </p>
            </div>

            <div *ngIf="!isEmpty" class="space-y-2 max-h-64 overflow-y-auto">
              <div
                *ngFor="let item of cartItems"
                class="flex items-center justify-between p-2 bg-white rounded-lg"
              >
                <div class="flex-1 min-w-0">
                  <p class="font-medium text-gray-900 text-sm truncate">
                    {{ item.product.name }}
                  </p>
                  <p class="text-xs text-gray-600">
                    {{ item.quantity }}x {{ item.unitPrice }}
                  </p>
                </div>
                <div class="flex items-center gap-2">
                  <span class="font-bold text-gray-900">{{
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

          <div *ngIf="!isEmpty" class="flex-1 p-4 space-y-4">
            <div class="space-y-2">
              <div class="flex justify-between text-sm">
                <span class="text-gray-600">Subtotal:</span>
                <span>{{ cartSummary.subtotal }}</span>
              </div>
              <div
                *ngIf="cartSummary.discountAmount > 0"
                class="flex justify-between text-sm"
              >
                <span class="text-gray-600">Descuento:</span>
                <span class="text-red-600"
                  >-{{ cartSummary.discountAmount }}</span
                >
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gray-600">Impuestos:</span>
                <span>{{ cartSummary.taxAmount }}</span>
              </div>
              <div class="flex justify-between text-lg font-bold pt-2 border-t">
                <span class="text-gray-900">Total:</span>
                <span class="text-blue-600">{{ cartSummary.total }}</span>
              </div>
            </div>

            <div class="space-y-3">
              <app-button
                variant="outline"
                size="md"
                class="w-full"
                (clicked)="onSaveDraft()"
              >
                <app-icon name="save" [size]="16" slot="icon"></app-icon>
                Guardar Borrador
              </app-button>
              <app-button
                variant="primary"
                size="lg"
                class="w-full"
                (clicked)="onCheckout()"
                [disabled]="isEmpty || loading"
              >
                <app-icon name="credit-card" [size]="16" slot="icon"></app-icon>
                Procesar Venta
              </app-button>
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

  onProductSelected(product: any): void {}

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
