import {Component, OnInit, OnDestroy, ViewChild, signal, HostListener, DestroyRef, inject} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';

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
          (openSupplierModal)="supplierModalOpen.set(true)"
          (openWarehouseModal)="warehouseModalOpen.set(true)"
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
    @if (isMobile()) {
      <app-pop-mobile-footer
        [cartSummary]="cartSummary()"
        [itemCount]="cartItemCount()"
        (viewOrder)="onOpenCartModal()"
        (saveDraft)="onSaveAsDraft()"
        (createOrder)="onSubmitOrder()"
        (createAndReceive)="onCreateAndReceive()"
      ></app-pop-mobile-footer>
    }

    <!-- Mobile Cart Modal -->
    <app-pop-cart-modal
      [isOpen]="showCartModal() && isMobile()"
      [cartState]="cartState()"
      [supplierName]="selectedSupplierName()"
      [locationName]="selectedLocationName()"
      [isProcessing]="isProcessingOrder()"
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
      [isOpen]="showOrderConfirmModal()"
      (isOpenChange)="showOrderConfirmModal.set($event)"
      [cartState]="cartState()"
      [supplierName]="currentSupplierName"
      [locationName]="currentLocationName"
      [actionType]="confirmOrderAction"
      [costPreview]="costPreview()"
      [loadingPreview]="loadingCostPreview()"
      (confirmed)="onOrderConfirmed()"
      (cancelled)="showOrderConfirmModal.set(false)"
      (navigateToSettings)="onNavigateToSettings()"
    ></app-pop-order-confirmation-modal>

    <app-pop-product-config-modal
      [isOpen]="showConfigModal()"
      [product]="configModalProduct()"
      [initialVariant]="editingCartItemVariant"
      [initialLotInfo]="editingCartItemLotInfo"
      [initialPricingType]="editingCartItemPricingType"
      [isEditing]="!!editingCartItemId()"
      (confirmed)="onConfigConfirmed($event)"
      (closed)="onConfigClosed()"
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
  private destroyRef = inject(DestroyRef);
  showInvoiceScanner = signal(false);

  supplierModalOpen = signal(false);
  warehouseModalOpen = signal(false);
  lotModalOpen = signal(false);
  prebulkModalOpen = signal(false);

  currentLotInfo?: any;
  currentLotItemId?: string;

  showConfigModal = signal(false);
  configModalProduct = signal<PopProduct | null>(null);
  editingCartItemId = signal<string | null>(null);

  get editingCartItemVariant(): any {
    const id = this.editingCartItemId();
    if (!id) return null;
    return this.popCartService.getItemById(id)?.variant || null;
  }

  get editingCartItemLotInfo(): any {
    const id = this.editingCartItemId();
    if (!id) return null;
    return this.popCartService.getItemById(id)?.lot_info || null;
  }

  get editingCartItemPricingType(): 'unit' | 'weight' {
    const id = this.editingCartItemId();
    if (!id) return 'unit';
    return this.popCartService.getItemById(id)?.product?.pricing_type || 'unit';
  }

  get currentSupplierName(): string {
    const state = this.popCartService.currentState;
    if (!state.supplierId || !this.header) return '';
    return (
      this.header.suppliers().find((s) => s.id === state.supplierId)?.name || ''
    );
  }

  get currentLocationName(): string {
    const state = this.popCartService.currentState;
    if (!state.locationId || !this.header) return '';
    return (
      this.header.locations().find((l) => l.id === state.locationId)?.name || ''
    );
  }

  orderId?: number;

  isMobile = signal(false);
  showCartModal = signal(false);
  isProcessingOrder = signal(false);

  showOrderConfirmModal = signal(false);
  confirmOrderAction: 'create' | 'create-receive' = 'create';

  costPreview = signal<CostPreviewResponse | null>(null);
  loadingCostPreview = signal(false);

  cartState = signal<PopCartState | null>(null);
  cartSummary = signal<PopCartSummary | null>(null);
  cartItemCount = signal(0);
  selectedSupplierName = signal('');
  selectedLocationName = signal('');

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

  async ngOnInit(): Promise<void> {
    this.checkMobile();

    this.subscriptions.push(
      this.popCartService.cartState$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((state) => {
        this.cartState.set(state);
        this.cartSummary.set(state.summary);
        this.cartItemCount.set(state.items.length);
      }),
    );

    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.orderId = Number(id);
        this.loadOrder(this.orderId);
      }
    });

    const params = await firstValueFrom(this.route.queryParams);
    const productId = params['product_id'];
    if (productId) {
      this.autoAddProductById(Number(productId));
    }
  }

  @HostListener('window:resize')
  onResize(): void {
    this.checkMobile();
  }

  private checkMobile(): void {
    this.isMobile.set(window.innerWidth < 1024);
  }

  private autoAddProductById(productId: number): void {
    this.productsService.getProductById(productId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (product: any) => {
        if (product) {
          const popProduct: PopProduct = {
            ...product,
            cost: Number(product.cost_price || product.price || 0),
          };

          this.configModalProduct.set(popProduct);
          this.showConfigModal.set(true);
        }
      },
      error: (err: any) => {
        console.error('Error auto-adding product:', err);
      },
    });
  }

  onConfigConfirmed(result: PopProductConfigResult): void {
    const product = this.configModalProduct();
    if (!product) return;

    const editingId = this.editingCartItemId();

    if (editingId) {
      if (result.variants?.length) {
        const originalItemId = editingId;
        const p: PopProduct = {
          ...product,
          pricing_type: result.pricing_type || product.pricing_type,
        };

        this.popCartService.removeFromCart(originalItemId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: () => {
            result.variants!.forEach((variant) => {
              this.popCartService
                .addToCart({
                  product: p,
                  variant,
                  quantity: 1,
                  unit_cost: variant.cost_price
                    ? Number(variant.cost_price)
                    : result.unit_cost,
                  lot_info: result.lot_info,
                })
                .pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
            });
            if (this.productSelection) {
              this.productSelection.updateProductVariants(
                product!.id,
                result.variants!,
              );
            }
            this.toastService.success(
              `${result.variants!.length === 1 ? '1 variante' : `${result.variants!.length} variantes`} de ${product?.name} agregadas`,
            );
          },
        });
      } else if (result.variant) {
        this.popCartService
          .updateCartItem({
            itemId: editingId,
            unit_cost: result.unit_cost,
            lot_info: result.lot_info,
            variant: result.variant,
            pricing_type: result.pricing_type,
          })
          .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: () => {
              this.toastService.success('Configuración actualizada');
            },
          });
      } else {
        this.popCartService
          .updateCartItem({
            itemId: editingId,
            unit_cost: result.unit_cost,
            lot_info: result.lot_info,
            pricing_type: result.pricing_type,
          })
          .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: () => {
              this.toastService.success('Configuración actualizada');
            },
          });
      }
    } else if (result.variants?.length) {
      const p: PopProduct = {
        ...product,
        pricing_type: result.pricing_type || product.pricing_type,
      };

      result.variants.forEach((variant) => {
        this.popCartService
          .addToCart({
            product: p,
            variant,
            quantity: 1,
            unit_cost: variant.cost_price
              ? Number(variant.cost_price)
              : result.unit_cost,
            lot_info: result.lot_info,
          })
          .pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
      });

      if (this.productSelection) {
        this.productSelection.updateProductVariants(
          product!.id,
          result.variants,
        );
      }

      const count = result.variants.length;
      this.toastService.success(
        count === 1
          ? `${product.name} agregado al carrito`
          : `${count} variantes de ${product.name} agregadas al carrito`,
      );
    } else {
      const p: PopProduct = {
        ...product,
        pricing_type: result.pricing_type || product.pricing_type,
      };

      this.popCartService
        .addToCart({
          product: p,
          quantity: result.quantity,
          unit_cost: result.unit_cost,
          lot_info: result.lot_info,
        })
        .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: () => {
            this.toastService.success(`${product?.name} agregado al carrito`);
          },
          error: (err) => {
            console.error('Error adding configured product:', err);
            this.toastService.error('Error al agregar producto');
          },
        });
    }

    this.showConfigModal.set(false);
    this.configModalProduct.set(null);
    this.editingCartItemId.set(null);
  }

  onConfigClosed(): void {
    this.showConfigModal.set(false);
    this.configModalProduct.set(null);
    this.editingCartItemId.set(null);
  }

  openItemConfigModal(item: PopCartItem): void {
    this.editingCartItemId.set(item.id);

    if (item.product.id > 0) {
      this.productsService.getProductById(item.product.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (product: any) => {
          if (product) {
            this.configModalProduct.set({
              ...product,
              cost: Number(product.cost_price || product.price || 0),
              cost_price: Number(product.cost_price || 0),
              pricing_type:
                product.pricing_type || item.product.pricing_type || 'unit',
              product_variants: product.product_variants || [],
            });
          } else {
            this.configModalProduct.set({ ...item.product });
          }
          this.showConfigModal.set(true);
        },
        error: () => {
          this.configModalProduct.set({ ...item.product });
          this.showConfigModal.set(true);
        },
      });
    } else {
      this.configModalProduct.set({ ...item.product });
      this.showConfigModal.set(true);
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  // ============================================================
  // Handlers
  // ============================================================

  onProductAdded(event: any): void {}

  onManualAddRequested(): void {
    this.prebulkModalOpen.set(true);
  }

  onInvoiceScanConfirmed(data: {
    scanResult: InvoiceScanResult;
    matchResult: InvoiceMatchResult;
    editedItems: MatchedLineItem[];
    invoiceNumber?: string;
    invoiceDate?: string;
  }): void {
    this.showInvoiceScanner.set(false);

    if (data.matchResult.supplier_match.matched_id) {
      this.popCartService.setSupplier(
        data.matchResult.supplier_match.matched_id,
      );
    }

    let addedCount = 0;
    for (const item of data.editedItems) {
      const candidate = item.selected_product_id
        ? item.candidates.find((c) => c.id === item.selected_product_id)
        : null;

      if (candidate) {
        this.popCartService
          .addToCart({
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
          })
          .pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
      } else {
        this.popCartService
          .addToCart({
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
          })
          .pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
      }
      addedCount++;
    }

    if (data.invoiceNumber) {
      const currentNotes = this.popCartService.currentState.notes || '';
      const invoiceNote = `Factura escaneada: ${data.invoiceNumber}`;
      this.popCartService.setNotes(
        currentNotes ? `${currentNotes}\n${invoiceNote}` : invoiceNote,
      );
    }

    this.toastService.success(
      `${addedCount} producto(s) agregados al carrito desde factura`,
    );
  }

  onBulkDataReceived(items: any[]): void {
    if (!items || items.length === 0) return;

    let addedCount = 0;

    items.forEach((row) => {
      const normalizedRow: any = {};
      Object.keys(row).forEach((key) => {
        normalizedRow[key.toLowerCase().trim()] = row[key];
      });

      const name =
        normalizedRow['name'] ||
        normalizedRow['nombre'] ||
        normalizedRow['producto'] ||
        normalizedRow['product'];

      const sku =
        normalizedRow['sku'] ||
        normalizedRow['code'] ||
        normalizedRow['codigo'] ||
        normalizedRow['id'];

      if (!name || !sku) {
        return;
      }

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

      const qtyRaw =
        normalizedRow['quantity'] ||
        normalizedRow['qty'] ||
        normalizedRow['cantidad'] ||
        normalizedRow['cant'] ||
        normalizedRow['cantidad inicial'] ||
        normalizedRow['cantidad_inicial'] ||
        1;
      const quantity = Number(qtyRaw) || 1;

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
        .pipe(takeUntilDestroyed(this.destroyRef)).subscribe();

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
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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

  onSupplierCreated(supplier: { id: number; name: string; code?: string }): void {
    // Add in-memory to the selector options (no HTTP refetch), then select it.
    // This avoids the race where a full `refreshSuppliers()` reload could
    // interact with the cart state subscription and clear cart items.
    this.header.addSupplier(supplier);
    this.popCartService.setSupplier(supplier.id);
  }

  onWarehouseCreated(warehouse: { id: number; name: string; code?: string }): void {
    // Add in-memory to the selector options (no HTTP refetch), then select it.
    // Symmetric to onSupplierCreated.
    this.header.addLocation(warehouse);
    this.popCartService.setLocation(warehouse.id);
  }

  onLotSave(lotInfo: any): void {
    if (this.currentLotItemId) {
      this.popCartService
        .updateItemLotInfo(this.currentLotItemId, lotInfo)
        .pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    }
    this.currentLotInfo = undefined;
    this.currentLotItemId = undefined;
  }

  onLotSkip(): void {
    this.currentLotInfo = undefined;
    this.currentLotItemId = undefined;
  }

  openLotModal(item: any): void {
    this.currentLotItemId = item.id;
    this.currentLotInfo = item.lot_info;
    this.lotModalOpen.set(true);
  }

  // ============================================================
  // Mobile Modal Handlers
  // ============================================================

  onOpenCartModal(): void {
    this.showCartModal.set(true);
  }

  onCloseCartModal(): void {
    this.showCartModal.set(false);
  }

  onConfigureFromModal(): void {
    this.showCartModal.set(false);
    if (this.header) {
      this.header.showMobileSettings.set(true);
      setTimeout(() => this.header.flashConfigWarning(), 50);
    }
  }

  onItemQuantityChanged(event: { itemId: string; quantity: number }): void {
    this.popCartService
      .updateCartItem({
        itemId: event.itemId,
        quantity: event.quantity,
      })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  onItemCostChanged(event: { itemId: string; cost: number }): void {
    this.popCartService
      .updateCartItem({
        itemId: event.itemId,
        unit_cost: event.cost,
      })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  onItemRemoved(itemId: string): void {
    this.popCartService.removeFromCart(itemId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
      this.popCartService.clearCart().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.toastService.info('Orden vaciada');
        },
      });
    }
  }

  onSaveDraftFromModal(): void {
    this.showCartModal.set(false);
    this.onSaveAsDraft();
  }

  onCreateOrderFromModal(): void {
    this.showCartModal.set(false);
    this.onSubmitOrder();
  }

  onCreateAndReceiveFromModal(): void {
    this.onCreateAndReceiveWithModal();
  }

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

    this.showCartModal.set(false);
    this.confirmOrderAction = 'create-receive';
    this.loadCostPreview();
    this.showOrderConfirmModal.set(true);
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

    this.purchaseOrdersService.createPurchaseOrder(request).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        this.toastService.success('Orden guardada como borrador');
        this.popCartService.clearCart().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
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
        this.showCartModal.set(true);
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
    this.showOrderConfirmModal.set(true);
  }

  onCreateAndReceive(): void {
    const state = this.popCartService.currentState;

    if (!state.supplierId || !state.locationId || state.items.length === 0) {
      if (this.isMobile()) {
        this.showCartModal.set(true);
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
    this.showOrderConfirmModal.set(true);
  }

  // ============================================================
  // Order Confirmation Modal Handlers
  // ============================================================

  onOrderConfirmed(): void {
    this.showOrderConfirmModal.set(false);
    if (this.confirmOrderAction === 'create') {
      this._executeSubmitOrder();
    } else {
      this._executeCreateAndReceive();
    }
  }

  onNavigateToSettings(): void {
    this.showOrderConfirmModal.set(false);
    this.router.navigate(['/store/settings/general']);
  }

  private loadCostPreview(): void {
    const state = this.popCartService.currentState;
    if (!state.locationId || state.items.length === 0) return;

    this.costPreview.set(null);
    this.loadingCostPreview.set(true);

    const request = {
      location_id: state.locationId,
      items: state.items
        .filter((item) => !item.is_prebulk && item.product?.id)
        .map((item) => ({
          product_id: item.product.id,
          product_variant_id: item.variant?.id,
          quantity: item.quantity,
          unit_cost: item.unit_cost,
        })),
    };

    if (request.items.length === 0) {
      this.loadingCostPreview.set(false);
      return;
    }

    this.purchaseOrdersService.getCostPreview(request).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        this.costPreview.set(response.success ? response.data : null);
        this.loadingCostPreview.set(false);
      },
      error: () => {
        this.costPreview.set(null);
        this.loadingCostPreview.set(false);
      },
    });
  }

  private _executeSubmitOrder(): void {
    const state = this.popCartService.currentState;
    const userId = this.authFacade.getUserId() || 0;
    const request = cartToPurchaseOrderRequest(state, userId, undefined);
    request.status = 'approved';

    this.purchaseOrdersService.createPurchaseOrder(request).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.toastService.success('Orden creada exitosamente');
          this.popCartService.clearCart().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
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

    this.purchaseOrdersService.createPurchaseOrder(request).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
            .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
              next: () => {
                this.toastService.success('Stock ingresado correctamente');
                this.popCartService.clearCart().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
                this.router.navigate(['/admin/products']);
              },
              error: (err: any) => {
                console.error('Error receiving order:', err);
                this.toastService.error(
                  'Orden creada pero hubo error al recibir stock',
                );
                this.popCartService.clearCart().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
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
    this.purchaseOrdersService.getPurchaseOrderById(orderId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
