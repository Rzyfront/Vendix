import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, take } from 'rxjs';

import { PopCartService, PopCartSummary } from './services/pop-cart.service';
import {
  cartToPurchaseOrderRequest,
  CreatePurchaseOrderRequest,
} from './interfaces/pop-order.interface';

// Shared Components
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../../shared/components/dialog/dialog.service';

// Services
import { PurchaseOrdersService } from '../services';
import { ProductsService } from '../../products/services/products.service';

// POP Components
import { PopProductSelectionComponent } from './components/pop-product-selection.component';
import { PopCartComponent } from './components/pop-cart.component';
import { PopHeaderComponent } from './components/pop-header.component';
import { PopSupplierQuickCreateComponent } from './components/pop-supplier-quick-create.component';
import { PopWarehouseQuickCreateComponent } from './components/pop-warehouse-quick-create.component';
import { PopLotModalComponent } from './components/pop-lot-modal.component';
import { PopPreBulkModalComponent } from './components/pop-prebulk-modal.component';

/**
 * POP (Point of Purchase) Main Component
 * Purchase order creation interface similar to POS
 */
@Component({
  selector: 'app-pop',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PopProductSelectionComponent,
    PopCartComponent,
    PopHeaderComponent,
    PopSupplierQuickCreateComponent,
    PopWarehouseQuickCreateComponent,
    PopLotModalComponent,
    PopPreBulkModalComponent,
  ],
  template: `
    <div
      class="h-full flex flex-col gap-4 overflow-hidden bg-[var(--color-background)]"
    >
      <!-- Main Content Container with Shadow/Card styling like POS -->
      <div
        class="flex-1 flex flex-col bg-surface rounded-card shadow-card border border-border min-h-0 overflow-hidden"
      >
        <!-- Header (Supplier, Location, Dates) -->
        <!-- We keep PopHeaderComponent but ensure it fits the visual style -->
        <app-pop-header
          class="flex-none border-b border-border"
          (openSupplierModal)="supplierModalOpen = true"
          (openWarehouseModal)="warehouseModalOpen = true"
        ></app-pop-header>

        <!-- Main Content Grid -->
        <div class="flex-1 p-4 sm:p-6 min-h-0 overflow-hidden">
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 h-full">
            <!-- Products Area (Left Side - 2 columns) -->
            <div class="lg:col-span-2 h-full min-h-0">
              <app-pop-product-selection
                class="h-full block"
                (productAddedToCart)="onProductAdded($event)"
                (requestManualAdd)="onManualAddRequested()"
                (bulkDataLoaded)="onBulkDataReceived($event)"
              ></app-pop-product-selection>
            </div>

            <!-- Cart Area (Right Side - 1 column) -->
            <div class="h-full min-h-0">
              <app-pop-cart
                class="h-full block"
                (saveDraft)="onSaveAsDraft()"
                (submitOrder)="onSubmitOrder()"
                (createAndReceive)="onCreateAndReceive()"
                (requestLotConfig)="openLotModal($event)"
              ></app-pop-cart>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modals -->
    <app-pop-prebulk-modal
      [(isOpen)]="prebulkModalOpen"
      (add)="onPrebulkAdded($event)"
    ></app-pop-prebulk-modal>

    <app-pop-supplier-quick-create
      [(isOpen)]="supplierModalOpen"
      (supplierCreated)="onSupplierCreated($event)"
    ></app-pop-supplier-quick-create>

    <app-pop-warehouse-quick-create
      [(isOpen)]="warehouseModalOpen"
      (warehouseCreated)="onWarehouseCreated($event)"
    ></app-pop-warehouse-quick-create>

    <app-pop-lot-modal
      [(isOpen)]="lotModalOpen"
      [initialLotInfo]="currentLotInfo"
      (save)="onLotSave($event)"
      (skip)="onLotSkip()"
    ></app-pop-lot-modal>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
    `,
  ],
})
export class PopComponent implements OnInit, OnDestroy {
  // Modal states
  supplierModalOpen = false;
  warehouseModalOpen = false;
  lotModalOpen = false;
  prebulkModalOpen = false;

  // Lot modal
  currentLotInfo?: any;
  currentLotItemId?: string;

  // Route params
  orderId?: number;

  private subscriptions: Subscription[] = [];

  constructor(
    private popCartService: PopCartService,
    private purchaseOrdersService: PurchaseOrdersService,
    private productsService: ProductsService,
    private route: ActivatedRoute,
    private router: Router,
    private toastService: ToastService,
    private dialogService: DialogService,
  ) { }

  ngOnInit(): void {
    // Check for editing existing order
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.orderId = Number(id);
        this.loadOrder(this.orderId);
      }
    });

    // Check for product_id in query params for auto-adding to cart
    this.route.queryParams.pipe(take(1)).subscribe((params) => {
      const productId = params['product_id'];
      if (productId) {
        this.autoAddProductById(Number(productId));
      }
    });
  }

  private autoAddProductById(productId: number): void {
    this.productsService.getProductById(productId).subscribe({
      next: (product: any) => {
        if (product) {
          const popProduct = {
            ...product,
            cost: Number(product.cost_price || product.price || 0),
          };
          this.popCartService.addItem(popProduct, 1);
          this.toastService.success(`${product.name} agregado automáticamente`);
        }
      },
      error: (err: any) => {
        console.error('Error auto-adding product:', err);
      },
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  // ============================================================
  // Handlers
  // ============================================================

  onProductAdded(event: any): void {
    // Logic handled in child, but we could show a global toast here if needed
  }

  onManualAddRequested(): void {
    this.prebulkModalOpen = true;
  }

  onBulkDataReceived(items: any[]): void {
    if (!items || items.length === 0) return;

    let addedCount = 0;

    // Process each row
    items.forEach((row) => {
      // Normalize keys to lowercase to be more forgiving
      const normalizedRow: any = {};
      Object.keys(row).forEach((key) => {
        normalizedRow[key.toLowerCase().trim()] = row[key];
      });

      // Attempt to find mandatory fields
      // Name: name, nombre, producto, product
      const name =
        normalizedRow['name'] ||
        normalizedRow['nombre'] ||
        normalizedRow['producto'] ||
        normalizedRow['product'];

      // SKU: sku, code, codigo, id
      const sku =
        normalizedRow['sku'] ||
        normalizedRow['code'] ||
        normalizedRow['codigo'] ||
        normalizedRow['id'];

      if (!name || !sku) {
        // Skip invalid rows
        return;
      }

      // Optional fields
      // Cost: cost, costo, price, precio, unit_cost, cost_price, precio compra
      const costRaw =
        normalizedRow['cost'] ||
        normalizedRow['costo'] ||
        normalizedRow['price'] ||
        normalizedRow['precio'] ||
        normalizedRow['unit_cost'] ||
        normalizedRow['cost_price'] ||
        normalizedRow['precio compra'] ||
        normalizedRow['precio_compra'] ||
        0;
      const unit_cost = Number(costRaw) || 0;

      // Quantity: quantity, qty, cantidad, cant, cantidad inicial
      const qtyRaw =
        normalizedRow['quantity'] ||
        normalizedRow['qty'] ||
        normalizedRow['cantidad'] ||
        normalizedRow['cant'] ||
        normalizedRow['cantidad inicial'] ||
        normalizedRow['cantidad_inicial'] ||
        1;
      const quantity = Number(qtyRaw) || 1;

      // New metadata fields
      const description = (normalizedRow['description'] || normalizedRow['descripción'] || normalizedRow['detalle'] || '').trim();
      const state = (normalizedRow['state'] || normalizedRow['estado'] || normalizedRow['status'] || 'active').trim();
      const weight = Number(normalizedRow['weight'] || normalizedRow['peso']) || 0;
      const available_for_ecommerce = normalizedRow['available_for_ecommerce'] || normalizedRow['disponible ecommerce'] || normalizedRow['ecommerce'] || true;
      const base_price = Number(normalizedRow['base_price'] || normalizedRow['precio venta'] || normalizedRow['precio_venta']) || 0;
      const profit_margin = Number(normalizedRow['profit_margin'] || normalizedRow['margen'] || normalizedRow['margin']) || 0;

      // Final metadata mapping for new requirement
      const brand = (normalizedRow['marca'] || normalizedRow['brand'] || '').trim();
      const categories = (normalizedRow['categorías'] || normalizedRow['categorias'] || normalizedRow['categories'] || '').trim();
      const isOnSale = normalizedRow['en oferta'] || normalizedRow['en_oferta'] || normalizedRow['is_on_sale'] || false;
      const salePrice = Number(normalizedRow['precio oferta'] || normalizedRow['precio_oferta'] || normalizedRow['sale_price']) || 0;

      // Construct dummy product
      const dummyProduct = {
        id: 0,
        name: String(name),
        code: String(sku),
        cost: unit_cost,
        price: base_price,
        stock: 0,
        is_active: true,
      };

      this.popCartService
        .addToCart({
          product: dummyProduct,
          quantity: quantity,
          unit_cost: unit_cost,
          is_prebulk: true,
          prebulk_data: {
            name: String(name),
            code: String(sku),
            description: String(description),
            state: String(state),
            weight: weight,
            available_for_ecommerce: available_for_ecommerce,
            base_price: base_price,
            profit_margin: profit_margin,
            brand_id: String(brand),
            category_ids: String(categories),
            is_on_sale: isOnSale,
            sale_price: salePrice,
          },
        })
        .subscribe();

      addedCount++;
    });

    if (addedCount > 0) {
      this.toastService.success(
        `Se importaron ${addedCount} productos al carrito`,
      );
    } else {
      this.toastService.warning(
        'No se encontraron productos válidos en el archivo (requiere Nombre y SKU)',
      );
    }
  }

  onPrebulkAdded(event: {
    prebulkData: any;
    quantity: number;
    unit_cost: number;
    notes?: string;
  }): void {
    // We need a dummy product object for the interface, even if it's prebulk
    const dummyProduct = {
      id: 0,
      name: event.prebulkData.name,
      code: event.prebulkData.code || 'MANUAL-TEMP',
      cost: event.unit_cost,
      price: 0,
      stock: 0,
      is_active: true,
    };

    this.popCartService
      .addToCart({
        product: dummyProduct,
        quantity: event.quantity,
        unit_cost: event.unit_cost,
        notes: event.notes,
        is_prebulk: true,
        prebulk_data: event.prebulkData,
      })
      .subscribe({
        next: () => {
          this.toastService.success('Producto manual agregado');
        },
        error: (err) => {
          console.error('Error adding manual item:', err);
          this.toastService.error('Error al agregar producto');
        },
      });
  }

  @ViewChild(PopHeaderComponent) header!: PopHeaderComponent;

  onSupplierCreated(supplierId: number): void {
    // 1. Trigger refresh to get the new supplier in the list
    this.header.refreshSuppliers();
    // 2. Set the ID in the service (Header will react to this state change)
    this.popCartService.setSupplier(supplierId);
  }

  onWarehouseCreated(warehouseId: number): void {
    this.header.refreshLocations();
    this.popCartService.setLocation(warehouseId);
  }

  onLotSave(lotInfo: any): void {
    if (this.currentLotItemId) {
      this.popCartService
        .updateItemLotInfo(this.currentLotItemId, lotInfo)
        .subscribe();
    }
    this.currentLotInfo = undefined;
    this.currentLotItemId = undefined;
  }

  onLotSkip(): void {
    this.currentLotInfo = undefined;
    this.currentLotItemId = undefined;
  }

  // Open lot modal from cart (method called by child components)
  openLotModal(item: any): void {
    this.currentLotItemId = item.id;
    this.currentLotInfo = item.lot_info;
    this.lotModalOpen = true;
  }

  // ============================================================
  // Order Actions
  // ============================================================

  onSaveAsDraft(): void {
    if (this.popCartService.currentState.items.length === 0) {
      this.toastService.warning('El carrito está vacío');
      return;
    }

    const state = this.popCartService.currentState;
    const draftState = { ...state, status: 'draft' as const };
    const userId = 0; // TODO: Get from AuthService

    const request = cartToPurchaseOrderRequest(draftState, userId, undefined);

    this.purchaseOrdersService.createPurchaseOrder(request).subscribe({
      next: (response) => {
        this.toastService.success('Orden guardada como borrador');
        this.popCartService.clearCart().subscribe();
        this.router.navigate(['/store/orders/purchase-orders']);
      },
      error: (error) => {
        console.error('Error saving draft:', error);
        const errorMsg = error.error?.message || error.message || 'Error al guardar el borrador';
        this.toastService.error(errorMsg);
      },
    });
  }

  onSubmitOrder(): void {
    const state = this.popCartService.currentState;

    if (!state.supplierId || !state.locationId || state.items.length === 0) {
      this.toastService.warning(
        'Por favor complete los campos requeridos: proveedor, bodega y al menos un producto.',
      );
      return;
    }

    const userId = 0; // TODO: Get from AuthService
    const request = cartToPurchaseOrderRequest(state, userId, undefined);

    request.status = 'approved';

    this.purchaseOrdersService.createPurchaseOrder(request).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.toastService.success('Orden creada exitosamente');
          this.popCartService.clearCart().subscribe();
          this.router.navigate(['/store/orders/purchase-orders']);
        }
      },
      error: (error) => {
        console.error('Error submitting order:', error);
        const errorMsg = error.error?.message || error.message || 'Error al enviar la orden';
        this.toastService.error(errorMsg);
      },
    });
  }

  onCreateAndReceive(): void {
    const state = this.popCartService.currentState;

    if (!state.supplierId || !state.locationId || state.items.length === 0) {
      this.toastService.warning(
        'Por favor complete los campos requeridos: proveedor, bodega y al menos un producto.',
      );
      return;
    }

    const userId = 0; // TODO: Get from AuthService
    const request = cartToPurchaseOrderRequest(state, userId, undefined);
    request.status = 'approved';

    this.toastService.info('Creando orden e ingresando inventario...');

    this.purchaseOrdersService.createPurchaseOrder(request).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          const orderId = response.data.id;
          const orderItems = response.data.purchase_order_items || [];

          // Prepare receive payload
          const receiveItems = orderItems.map((item: any) => ({
            id: item.id,
            quantity_received: item.quantity_ordered, // Receive full quantity
          }));

          this.purchaseOrdersService
            .receivePurchaseOrder(orderId, receiveItems)
            .subscribe({
              next: (res: any) => {
                this.toastService.success('Stock ingresado correctamente');
                this.popCartService.clearCart().subscribe();
                // Navigate to inventory or stay? Navigate to orders for now
                this.router.navigate(['/store/orders/purchase-orders']);
              },
              error: (err: any) => {
                console.error('Error receiving order:', err);
                this.toastService.error(
                  'Orden creada pero hubo error al recibir stock',
                );
                // Still clear cart as order was created? Yes to prevent dupes
                this.popCartService.clearCart().subscribe();
                this.router.navigate(['/store/orders/purchase-orders']);
              },
            });
        }
      },
      error: (error) => {
        console.error('Error creating order:', error);
        const errorMsg = error.error?.message || error.message || 'Error al crear la orden';
        this.toastService.error(errorMsg);
      },
    });
  }

  // ============================================================
  // Data Loading
  // ============================================================

  private loadOrder(orderId: number): void {
    this.purchaseOrdersService.getPurchaseOrderById(orderId).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.popCartService.loadOrder(response.data);
          this.toastService.info('Orden cargada exitosamente');
        } else {
          this.toastService.error('No se pudo encontrar la orden');
          this.router.navigate(['/store/inventory/pop']);
        }
      },
      error: (error) => {
        console.error('Error loading order:', error);
        this.toastService.error('Error loading order:', error);
        this.router.navigate(['/store/inventory/pop']);
      },
    });
  }
}
