import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  signal,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, take } from 'rxjs';

import {
  PopCartService,
  PopCartSummary,
  PopCartState,
  PopCartItem,
  PopProduct,
} from './services/pop-cart.service';
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

// Auth
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';

// POP Components
import { PopProductSelectionComponent } from './components/pop-product-selection.component';
import { PopCartComponent } from './components/pop-cart.component';
import { PopHeaderComponent } from './components/pop-header.component';
import { PopSupplierQuickCreateComponent } from './components/pop-supplier-quick-create.component';
import { PopWarehouseQuickCreateComponent } from './components/pop-warehouse-quick-create.component';
import { PopLotModalComponent } from './components/pop-lot-modal.component';
import { PopPreBulkModalComponent } from './components/pop-prebulk-modal.component';
import { PopMobileFooterComponent } from './components/pop-mobile-footer.component';
import { PopCartModalComponent } from './components/pop-cart-modal.component';
import {
  PopProductConfigModalComponent,
  PopProductConfigResult,
} from './components/pop-product-config-modal.component';
import { PopOrderConfirmationModalComponent } from './components/pop-order-confirmation-modal.component';
import { InvoiceScannerModalComponent } from './components/invoice-scanner/invoice-scanner-modal.component';
import {
  InvoiceScanResult,
  InvoiceMatchResult,
  MatchedLineItem,
} from './interfaces/invoice-scanner.interface';
import { CostPreviewResponse } from '../interfaces';

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
    PopMobileFooterComponent,
    PopCartModalComponent,
    PopProductConfigModalComponent,
    PopOrderConfirmationModalComponent,
    InvoiceScannerModalComponent,
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
        <app-pop-header
          class="flex-none border-b border-border"
          (openSupplierModal)="supplierModalOpen = true"
          (openWarehouseModal)="warehouseModalOpen = true"
        ></app-pop-header>

        <!-- Main Content Grid -->
        <div class="flex-1 p-4 sm:p-6 min-h-0 overflow-hidden">
          <div
            class="h-full flex flex-col lg:grid lg:grid-cols-3 gap-4 sm:gap-6"
          >
            <!-- Products Area (single instance for both layouts) -->
            <div
              class="lg:col-span-2 h-full min-h-0 flex-1 pb-32 lg:pb-0 overflow-y-auto lg:overflow-hidden"
            >
              <app-pop-product-selection
                class="h-full block"
                (productAddedToCart)="onProductAdded($event)"
                (requestManualAdd)="onManualAddRequested()"
                (bulkDataLoaded)="onBulkDataReceived($event)"
                (scanInvoice)="showInvoiceScanner.set(true)"
              ></app-pop-product-selection>
            </div>

            <!-- Cart Area (Right Side - 1 column) - Hidden on mobile -->
            <div class="hidden lg:block h-full min-h-0">
              <app-pop-cart
                class="h-full block"
                (saveDraft)="onSaveAsDraft()"
                (submitOrder)="onSubmitOrder()"
                (createAndReceive)="onCreateAndReceive()"
                (requestLotConfig)="openLotModal($event)"
                (requestItemConfig)="openItemConfigModal($event)"
              ></app-pop-cart>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Mobile Footer -->
    <app-pop-mobile-footer
      *ngIf="isMobile()"
      [cartSummary]="cartSummary"
      [itemCount]="cartItemCount"
      (viewOrder)="onOpenCartModal()"
      (saveDraft)="onSaveAsDraft()"
      (createOrder)="onSubmitOrder()"
      (createAndReceive)="onCreateAndReceive()"
    ></app-pop-mobile-footer>

    <!-- Mobile Cart Modal -->
    <app-pop-cart-modal
      [isOpen]="showCartModal && isMobile()"
      [cartState]="cartState"
      [supplierName]="selectedSupplierName"
      [locationName]="selectedLocationName"
      [isProcessing]="isProcessingOrder"
      (closed)="onCloseCartModal()"
      (itemQuantityChanged)="onItemQuantityChanged($event)"
      (itemCostChanged)="onItemCostChanged($event)"
      (itemRemoved)="onItemRemoved($event)"
      (clearCart)="onClearCart()"
      (configureLot)="openLotModal($event)"
      (saveDraft)="onSaveDraftFromModal()"
      (createOrder)="onCreateOrderFromModal()"
      (createAndReceive)="onCreateAndReceiveFromModal()"
      (configure)="onConfigureFromModal()"
    ></app-pop-cart-modal>

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

    <app-pop-order-confirmation-modal
      [isOpen]="showOrderConfirmModal"
      (isOpenChange)="showOrderConfirmModal = $event"
      [cartState]="cartState"
      [supplierName]="currentSupplierName"
      [locationName]="currentLocationName"
      [actionType]="confirmOrderAction"
      [costPreview]="costPreview"
      [loadingPreview]="loadingCostPreview"
      (confirmed)="onOrderConfirmed()"
      (cancelled)="showOrderConfirmModal = false"
      (navigateToSettings)="onNavigateToSettings()"
    ></app-pop-order-confirmation-modal>

    <app-pop-product-config-modal
      [isOpen]="showConfigModal"
      [product]="configModalProduct"
      [initialVariant]="editingCartItemVariant"
      [initialLotInfo]="editingCartItemLotInfo"
      [initialPricingType]="editingCartItemPricingType"
      [isEditing]="!!editingCartItemId"
      (confirmed)="onConfigConfirmed($event)"
      (closed)="
        showConfigModal = false;
        configModalProduct = null;
        editingCartItemId = null
      "
    ></app-pop-product-config-modal>

    <app-invoice-scanner-modal
      [isOpen]="showInvoiceScanner()"
      (isOpenChange)="showInvoiceScanner.set($event)"
      (confirmed)="onInvoiceScanConfirmed($event)"
    ></app-invoice-scanner-modal>
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
  // Invoice scanner
  showInvoiceScanner = signal(false);

  // Modal states
  supplierModalOpen = false;
  warehouseModalOpen = false;
  lotModalOpen = false;
  prebulkModalOpen = false;

  // Lot modal
  currentLotInfo?: any;
  currentLotItemId?: string;

  // Config modal (for products with variants or batch tracking)
  showConfigModal = false;
  configModalProduct: PopProduct | null = null;
  editingCartItemId: string | null = null; // When editing an existing cart item

  get editingCartItemVariant(): any {
    if (!this.editingCartItemId) return null;
    return (
      this.popCartService.getItemById(this.editingCartItemId)?.variant || null
    );
  }

  get editingCartItemLotInfo(): any {
    if (!this.editingCartItemId) return null;
    return (
      this.popCartService.getItemById(this.editingCartItemId)?.lot_info || null
    );
  }

  get editingCartItemPricingType(): 'unit' | 'weight' {
    if (!this.editingCartItemId) return 'unit';
    return (
      this.popCartService.getItemById(this.editingCartItemId)?.product
        ?.pricing_type || 'unit'
    );
  }

  get currentSupplierName(): string {
    const state = this.popCartService.currentState;
    if (!state.supplierId || !this.header) return '';
    return this.header.suppliers.find(s => s.id === state.supplierId)?.name || '';
  }

  get currentLocationName(): string {
    const state = this.popCartService.currentState;
    if (!state.locationId || !this.header) return '';
    return this.header.locations.find(l => l.id === state.locationId)?.name || '';
  }

  // Route params
  orderId?: number;

  // Mobile responsive
  isMobile = signal(false);
  showCartModal = false;
  isProcessingOrder = false;

  // Order confirmation modal
  showOrderConfirmModal = false;
  confirmOrderAction: 'create' | 'create-receive' = 'create';

  // Cost preview
  costPreview: CostPreviewResponse | null = null;
  loadingCostPreview = false;

  // Cart state for mobile components
  cartState: PopCartState | null = null;
  cartSummary: PopCartSummary | null = null;
  cartItemCount = 0;
  selectedSupplierName = '';
  selectedLocationName = '';

  private subscriptions: Subscription[] = [];

  constructor(
    private popCartService: PopCartService,
    private purchaseOrdersService: PurchaseOrdersService,
    private productsService: ProductsService,
    private route: ActivatedRoute,
    private router: Router,
    private toastService: ToastService,
    private dialogService: DialogService,
    private authFacade: AuthFacade,
  ) {}

  ngOnInit(): void {
    // Initialize mobile detection
    this.checkMobile();

    // Subscribe to cart state for mobile components
    this.subscriptions.push(
      this.popCartService.cartState$.subscribe((state) => {
        this.cartState = state;
        this.cartSummary = state.summary;
        this.cartItemCount = state.items.length;
      }),
    );

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

  @HostListener('window:resize')
  onResize(): void {
    this.checkMobile();
  }

  private checkMobile(): void {
    this.isMobile.set(window.innerWidth < 1024);
  }

  private autoAddProductById(productId: number): void {
    this.productsService.getProductById(productId).subscribe({
      next: (product: any) => {
        if (product) {
          const popProduct: PopProduct = {
            ...product,
            cost: Number(product.cost_price || product.price || 0),
          };

          // Always open config modal in POP
          this.configModalProduct = popProduct;
          this.showConfigModal = true;
        }
      },
      error: (err: any) => {
        console.error('Error auto-adding product:', err);
      },
    });
  }

  onConfigConfirmed(result: PopProductConfigResult): void {
    if (!this.configModalProduct) return;

    if (this.editingCartItemId) {
      if (result.variants?.length) {
        const originalItemId = this.editingCartItemId;
        const product: PopProduct = {
          ...this.configModalProduct,
          pricing_type:
            result.pricing_type || this.configModalProduct.pricing_type,
        };

        this.popCartService.removeFromCart(originalItemId).subscribe({
          next: () => {
            result.variants!.forEach((variant) => {
              this.popCartService
                .addToCart({
                  product,
                  variant,
                  quantity: 1,
                  unit_cost: variant.cost_price
                    ? Number(variant.cost_price)
                    : result.unit_cost,
                  lot_info: result.lot_info,
                })
                .subscribe();
            });
            if (this.productSelection) {
              this.productSelection.updateProductVariants(
                this.configModalProduct!.id,
                result.variants!,
              );
            }
            this.toastService.success(
              `${result.variants!.length === 1 ? '1 variante' : `${result.variants!.length} variantes`} de ${this.configModalProduct?.name} agregadas`,
            );
          },
        });
      } else if (result.variant) {
        this.popCartService
          .updateCartItem({
            itemId: this.editingCartItemId,
            unit_cost: result.unit_cost,
            lot_info: result.lot_info,
            variant: result.variant,
            pricing_type: result.pricing_type,
          })
          .subscribe({
            next: () => {
              this.toastService.success('Configuración actualizada');
            },
          });
      } else {
        this.popCartService
          .updateCartItem({
            itemId: this.editingCartItemId,
            unit_cost: result.unit_cost,
            lot_info: result.lot_info,
            pricing_type: result.pricing_type,
          })
          .subscribe({
            next: () => {
              this.toastService.success('Configuración actualizada');
            },
          });
      }
    } else if (result.variants?.length) {
      // Adding multiple variants — one cart item per variant
      const product: PopProduct = {
        ...this.configModalProduct,
        pricing_type:
          result.pricing_type || this.configModalProduct.pricing_type,
      };

      result.variants.forEach((variant) => {
        this.popCartService
          .addToCart({
            product,
            variant,
            quantity: 1,
            unit_cost: variant.cost_price
              ? Number(variant.cost_price)
              : result.unit_cost,
            lot_info: result.lot_info,
          })
          .subscribe();
      });

      if (this.productSelection) {
        this.productSelection.updateProductVariants(
          this.configModalProduct!.id,
          result.variants,
        );
      }

      const count = result.variants.length;
      this.toastService.success(
        count === 1
          ? `${this.configModalProduct.name} agregado al carrito`
          : `${count} variantes de ${this.configModalProduct.name} agregadas al carrito`,
      );
    } else {
      // Adding a single item without variants
      const product: PopProduct = {
        ...this.configModalProduct,
        pricing_type:
          result.pricing_type || this.configModalProduct.pricing_type,
      };

      this.popCartService
        .addToCart({
          product,
          quantity: result.quantity,
          unit_cost: result.unit_cost,
          lot_info: result.lot_info,
        })
        .subscribe({
          next: () => {
            this.toastService.success(
              `${this.configModalProduct?.name} agregado al carrito`,
            );
          },
          error: (err) => {
            console.error('Error adding configured product:', err);
            this.toastService.error('Error al agregar producto');
          },
        });
    }

    // Always clean up modal state
    this.showConfigModal = false;
    this.configModalProduct = null;
    this.editingCartItemId = null;
  }

  /**
   * Open config modal to edit an existing cart item's variant/lot/unit settings.
   * Re-fetches the product from the backend to get full variant data.
   */
  openItemConfigModal(item: PopCartItem): void {
    this.editingCartItemId = item.id;

    // If product has id > 0, fetch fresh data to get variants
    if (item.product.id > 0) {
      this.productsService.getProductById(item.product.id).subscribe({
        next: (product: any) => {
          if (product) {
            this.configModalProduct = {
              ...product,
              cost: Number(product.cost_price || product.price || 0),
              cost_price: Number(product.cost_price || 0),
              pricing_type:
                product.pricing_type || item.product.pricing_type || 'unit',
              product_variants: product.product_variants || [],
            };
          } else {
            this.configModalProduct = { ...item.product };
          }
          this.showConfigModal = true;
        },
        error: () => {
          this.configModalProduct = { ...item.product };
          this.showConfigModal = true;
        },
      });
    } else {
      // Prebulk product
      this.configModalProduct = { ...item.product };
      this.showConfigModal = true;
    }
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

  onInvoiceScanConfirmed(data: {
    scanResult: InvoiceScanResult;
    matchResult: InvoiceMatchResult;
    editedItems: MatchedLineItem[];
    invoiceNumber?: string;
    invoiceDate?: string;
  }): void {
    this.showInvoiceScanner.set(false);

    // 1. Set supplier if matched
    if (data.matchResult.supplier_match.matched_id) {
      this.popCartService.setSupplier(data.matchResult.supplier_match.matched_id);
    }

    // 2. Add each item to cart
    let addedCount = 0;
    for (const item of data.editedItems) {
      const candidate = item.selected_product_id
        ? item.candidates.find((c) => c.id === item.selected_product_id)
        : null;

      if (candidate) {
        // Matched product → regular cart item
        this.popCartService.addToCart({
          product: {
            id: candidate.id,
            name: candidate.name,
            code: candidate.sku || '',
            cost: item.unit_price,
            price: 0,
            stock: 0,
            is_active: true,
          },
          quantity: item.quantity,
          unit_cost: item.unit_price,
        }).subscribe();
      } else {
        // Unmatched → prebulk item
        this.popCartService.addToCart({
          product: {
            id: 0,
            name: item.description,
            code: item.sku_if_visible || '',
            cost: item.unit_price,
            price: 0,
            stock: 0,
            is_active: true,
          },
          quantity: item.quantity,
          unit_cost: item.unit_price,
          is_prebulk: true,
          prebulk_data: {
            name: item.description,
            code: item.sku_if_visible || '',
            description: item.description,
          },
        }).subscribe();
      }
      addedCount++;
    }

    // 3. Invoice metadata as notes
    if (data.invoiceNumber) {
      const currentNotes = this.popCartService.currentState.notes || '';
      const invoiceNote = `Factura escaneada: ${data.invoiceNumber}`;
      this.popCartService.setNotes(
        currentNotes ? `${currentNotes}\n${invoiceNote}` : invoiceNote,
      );
    }

    // 4. Toast — stay on page, don't navigate
    this.toastService.success(
      `${addedCount} producto(s) agregados al carrito desde factura`,
    );
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
      const description = (
        normalizedRow['description'] ||
        normalizedRow['descripción'] ||
        normalizedRow['detalle'] ||
        ''
      ).trim();
      const state = (
        normalizedRow['state'] ||
        normalizedRow['estado'] ||
        normalizedRow['status'] ||
        'active'
      ).trim();
      const weight =
        Number(normalizedRow['weight'] || normalizedRow['peso']) || 0;
      const available_for_ecommerce =
        normalizedRow['available_for_ecommerce'] ||
        normalizedRow['disponible ecommerce'] ||
        normalizedRow['ecommerce'] ||
        true;
      const base_price =
        Number(
          normalizedRow['base_price'] ||
            normalizedRow['precio venta'] ||
            normalizedRow['precio_venta'],
        ) || 0;
      const profit_margin =
        Number(
          normalizedRow['profit_margin'] ||
            normalizedRow['margen'] ||
            normalizedRow['margin'],
        ) || 0;

      // Final metadata mapping for new requirement
      // Note: The modal already maps 'Marca' -> 'brand_id' and 'Categorías' -> 'category_ids'
      const brand = (
        normalizedRow['brand_id'] ||
        normalizedRow['marca'] ||
        normalizedRow['brand'] ||
        ''
      )
        .toString()
        .trim();
      const categories = (
        normalizedRow['category_ids'] ||
        normalizedRow['categorías'] ||
        normalizedRow['categorias'] ||
        normalizedRow['categories'] ||
        ''
      )
        .toString()
        .trim();
      const isOnSale =
        normalizedRow['en oferta'] ||
        normalizedRow['en_oferta'] ||
        normalizedRow['is_on_sale'] ||
        false;
      const salePrice =
        Number(
          normalizedRow['precio oferta'] ||
            normalizedRow['precio_oferta'] ||
            normalizedRow['sale_price'],
        ) || 0;

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
      price: event.prebulkData.base_price || 0,
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
  @ViewChild(PopProductSelectionComponent)
  productSelection!: PopProductSelectionComponent;

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
  // Mobile Modal Handlers
  // ============================================================

  onOpenCartModal(): void {
    this.showCartModal = true;
  }

  onCloseCartModal(): void {
    this.showCartModal = false;
  }

  onConfigureFromModal(): void {
    // Close modal and expand header settings
    this.showCartModal = false;
    if (this.header) {
      this.header.showMobileSettings = true;
      // Delay flash so the DOM renders the expanded settings first
      setTimeout(() => this.header.flashConfigWarning(), 50);
    }
  }

  onItemQuantityChanged(event: { itemId: string; quantity: number }): void {
    this.popCartService
      .updateCartItem({
        itemId: event.itemId,
        quantity: event.quantity,
      })
      .subscribe();
  }

  onItemCostChanged(event: { itemId: string; cost: number }): void {
    this.popCartService
      .updateCartItem({
        itemId: event.itemId,
        unit_cost: event.cost,
      })
      .subscribe();
  }

  onItemRemoved(itemId: string): void {
    this.popCartService.removeFromCart(itemId).subscribe({
      next: () => {
        this.toastService.success('Producto eliminado de la orden');
      },
    });
  }

  async onClearCart(): Promise<void> {
    const confirm = await this.dialogService.confirm({
      title: 'Vaciar Orden',
      message: '¿Estás seguro de que quieres eliminar todos los productos?',
      confirmText: 'Vaciar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });

    if (confirm) {
      this.popCartService.clearCart().subscribe({
        next: () => {
          this.toastService.info('Orden vaciada');
        },
      });
    }
  }

  onSaveDraftFromModal(): void {
    this.showCartModal = false;
    this.onSaveAsDraft();
  }

  onCreateOrderFromModal(): void {
    this.showCartModal = false;
    this.onSubmitOrder();
  }

  onCreateAndReceiveFromModal(): void {
    // Don't close modal - let onCreateAndReceive handle it after success
    this.onCreateAndReceiveWithModal();
  }

  /**
   * Create and receive order from modal - shows confirmation modal first
   */
  private onCreateAndReceiveWithModal(): void {
    const state = this.popCartService.currentState;

    if (!state.supplierId || !state.locationId || state.items.length === 0) {
      if ((!state.supplierId || !state.locationId) && this.header) {
        this.header.flashConfigWarning();
      }
      this.toastService.warning(
        'Por favor complete los campos requeridos: proveedor, bodega y al menos un producto.',
      );
      return;
    }

    this.showCartModal = false;
    this.confirmOrderAction = 'create-receive';
    this.loadCostPreview();
    this.showOrderConfirmModal = true;
  }

  // ============================================================
  // Order Actions
  // ============================================================

  onSaveAsDraft(): void {
    const state = this.popCartService.currentState;

    if (state.items.length === 0) {
      this.toastService.warning('El carrito está vacío');
      return;
    }

    if (!state.supplierId || !state.locationId) {
      if (this.header) {
        this.header.flashConfigWarning();
      }
      this.toastService.warning(
        'Por favor selecciona proveedor y bodega antes de guardar.',
      );
      return;
    }
    const draftState = { ...state, status: 'draft' as const };
    const userId = this.authFacade.getUserId() || 0;

    const request = cartToPurchaseOrderRequest(draftState, userId, undefined);

    this.purchaseOrdersService.createPurchaseOrder(request).subscribe({
      next: (response) => {
        this.toastService.success('Orden guardada como borrador');
        this.popCartService.clearCart().subscribe();
        this.router.navigate(['/admin/products']);
      },
      error: (error) => {
        console.error('Error saving draft:', error);
        const errorMsg =
          error.error?.message ||
          error.message ||
          'Error al guardar el borrador';
        this.toastService.error(errorMsg);
      },
    });
  }

  onSubmitOrder(): void {
    const state = this.popCartService.currentState;

    if (!state.supplierId || !state.locationId || state.items.length === 0) {
      if (this.isMobile()) {
        this.showCartModal = true;
      }
      if ((!state.supplierId || !state.locationId) && this.header) {
        this.header.flashConfigWarning();
      }
      this.toastService.warning(
        'Por favor complete los campos requeridos: proveedor, bodega y al menos un producto.',
      );
      return;
    }

    this.confirmOrderAction = 'create';
    this.showOrderConfirmModal = true;
  }

  onCreateAndReceive(): void {
    const state = this.popCartService.currentState;

    if (!state.supplierId || !state.locationId || state.items.length === 0) {
      if (this.isMobile()) {
        this.showCartModal = true;
      }
      if ((!state.supplierId || !state.locationId) && this.header) {
        this.header.flashConfigWarning();
      }
      this.toastService.warning(
        'Por favor complete los campos requeridos: proveedor, bodega y al menos un producto.',
      );
      return;
    }

    this.confirmOrderAction = 'create-receive';
    this.loadCostPreview();
    this.showOrderConfirmModal = true;
  }

  // ============================================================
  // Order Confirmation Modal Handlers
  // ============================================================

  onOrderConfirmed(): void {
    this.showOrderConfirmModal = false;
    if (this.confirmOrderAction === 'create') {
      this._executeSubmitOrder();
    } else {
      this._executeCreateAndReceive();
    }
  }

  onNavigateToSettings(): void {
    this.showOrderConfirmModal = false;
    this.router.navigate(['/store/settings/general']);
  }

  private loadCostPreview(): void {
    const state = this.popCartService.currentState;
    if (!state.locationId || state.items.length === 0) return;

    this.costPreview = null;
    this.loadingCostPreview = true;

    const request = {
      location_id: state.locationId,
      items: state.items
        .filter(item => !item.is_prebulk && item.product?.id)
        .map(item => ({
          product_id: item.product.id,
          product_variant_id: item.variant?.id,
          quantity: item.quantity,
          unit_cost: item.unit_cost,
        })),
    };

    if (request.items.length === 0) {
      this.loadingCostPreview = false;
      return;
    }

    this.purchaseOrdersService.getCostPreview(request).subscribe({
      next: (response) => {
        this.costPreview = response.success ? response.data : null;
        this.loadingCostPreview = false;
      },
      error: () => {
        this.costPreview = null;
        this.loadingCostPreview = false;
      },
    });
  }

  private _executeSubmitOrder(): void {
    const state = this.popCartService.currentState;
    const userId = this.authFacade.getUserId() || 0;
    const request = cartToPurchaseOrderRequest(state, userId, undefined);
    request.status = 'approved';

    this.purchaseOrdersService.createPurchaseOrder(request).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.toastService.success('Orden creada exitosamente');
          this.popCartService.clearCart().subscribe();
          this.router.navigate(['/admin/products']);
        }
      },
      error: (error) => {
        console.error('Error submitting order:', error);
        const errorMsg =
          error.error?.message || error.message || 'Error al enviar la orden';
        this.toastService.error(errorMsg);
      },
    });
  }

  private _executeCreateAndReceive(): void {
    const state = this.popCartService.currentState;
    const userId = this.authFacade.getUserId() || 0;
    const request = cartToPurchaseOrderRequest(state, userId, undefined);
    request.status = 'approved';

    this.toastService.info('Creando orden e ingresando inventario...');

    this.purchaseOrdersService.createPurchaseOrder(request).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          const orderId = response.data.id;
          const orderItems = response.data.purchase_order_items || [];

          const receiveItems = orderItems.map((item: any) => ({
            id: item.id,
            quantity_received: item.quantity_ordered,
          }));

          this.purchaseOrdersService
            .receivePurchaseOrder(orderId, receiveItems)
            .subscribe({
              next: () => {
                this.toastService.success('Stock ingresado correctamente');
                this.popCartService.clearCart().subscribe();
                this.router.navigate(['/admin/products']);
              },
              error: (err: any) => {
                console.error('Error receiving order:', err);
                this.toastService.error(
                  'Orden creada pero hubo error al recibir stock',
                );
                this.popCartService.clearCart().subscribe();
                this.router.navigate(['/admin/products']);
              },
            });
        }
      },
      error: (error) => {
        console.error('Error creating order:', error);
        const errorMsg =
          error.error?.message || error.message || 'Error al crear la orden';
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
