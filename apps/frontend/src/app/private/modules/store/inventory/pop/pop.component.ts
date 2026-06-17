import {Component, OnInit, OnDestroy, ViewChild, signal, computed, HostListener, DestroyRef, inject} from '@angular/core';
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
} from './components/pop-product-config-modal.component';
import { PopOrderConfirmationModalComponent } from './components/pop-order-confirmation-modal.component';
import { InvoiceScannerModalComponent } from './components/invoice-scanner/invoice-scanner-modal.component';
import {
  InvoiceScanResult,
  InvoiceMatchResult,
  MatchedLineItem,
} from './interfaces/invoice-scanner.interface';
import { CostPreviewResponse } from '../interfaces';
import {
  PopProductConfigResult,
  PopProductModalResult,
} from './interfaces/pop-cart.interface';
import { POP_USE_UNIFIED_MODAL } from './pop.config';

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
    <!-- Legacy prebulk modal: only rendered when the unified modal is
         disabled (rollback path). With the flag on, creation is handled
         by the unified config modal in 'create' mode. -->
    @if (!useUnifiedModal) {
      <app-pop-prebulk-modal
        [(isOpen)]="prebulkModalOpen"
        (add)="onPrebulkAdded($event)"
      ></app-pop-prebulk-modal>
    }

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
      [mode]="configModalMode()"
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
      [orderType]="scannerOrderType()"
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
  /**
   * Fase 4: derive the AI scan profile from the current cart. If any
   * line is a pure ingredient (is_ingredient && !is_sellable), route to
   * the `invoice_ocr_ingredient` profile so the model also extracts
   * presentation / pack_size / uom_hint. Otherwise `retail`.
   */
  readonly scannerOrderType = computed<'retail' | 'ingredient'>(() => {
    const state = this.popCartService.currentState;
    const isIngredient = state.items.some((it: any) => {
      const p: any = it.product;
      if (!p) return false;
      const sellable =
        p.is_sellable === undefined || p.is_sellable === null
          ? true
          : !!p.is_sellable;
      return !!p.is_ingredient && !sellable;
    });
    return isIngredient ? 'ingredient' : 'retail';
  });

  supplierModalOpen = signal(false);
  warehouseModalOpen = signal(false);
  lotModalOpen = signal(false);
  prebulkModalOpen = signal(false);

  currentLotInfo?: any;
  currentLotItemId?: string;

  showConfigModal = signal(false);
  configModalProduct = signal<PopProduct | null>(null);
  editingCartItemId = signal<string | null>(null);
  /**
   * Mode forwarded to the unified product modal. 'configure' (default)
   * keeps the original flow; 'create' absorbs the prebulk-modal flow.
   * Always 'configure' when `POP_USE_UNIFIED_MODAL` is false (legacy
   * prebulk-modal handles creation).
   */
  configModalMode = signal<'create' | 'configure'>('configure');

  /**
   * Fase 5 rollout flag. When `true`, "Agregar producto nuevo" opens the
   * unified product modal in `create` mode and the legacy prebulk modal
   * is not rendered. Flip `POP_USE_UNIFIED_MODAL` to `false` in
   * `pop.config.ts` to roll back to the separate prebulk modal.
   */
  readonly useUnifiedModal = POP_USE_UNIFIED_MODAL;

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
          this.configModalMode.set('configure');
          this.showConfigModal.set(true);
        }
      },
      error: (err: any) => {
        console.error('Error auto-adding product:', err);
      },
    });
  }

  onConfigConfirmed(result: PopProductModalResult): void {
    // Fase 5: discriminator routes the unified modal's emit to the
    // existing cart calls. Configure-mode keeps the original behaviour;
    // create-mode is absorbed into `onPrebulkAdded` (same payload).
    if (result.mode === 'create') {
      this.onPrebulkAdded({
        prebulkData: result.prebulkData,
        quantity: result.quantity,
        unit_cost: result.unit_cost,
        notes: result.notes,
      });
      this.showConfigModal.set(false);
      this.configModalProduct.set(null);
      this.editingCartItemId.set(null);
      this.configModalMode.set('configure');
      return;
    }

    // Configure-mode: delegate to the original handler with a narrowed type.
    this.onProductConfigured(result);
  }

  private onProductConfigured(result: PopProductConfigResult): void {
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
    // Reset to the default so the next "Configurar" never inherits 'create'.
    this.configModalMode.set('configure');
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
          this.configModalMode.set('configure');
          this.showConfigModal.set(true);
        },
        error: () => {
          this.configModalProduct.set({ ...item.product });
          this.configModalMode.set('configure');
          this.showConfigModal.set(true);
        },
      });
    } else {
      this.configModalProduct.set({ ...item.product });
      this.configModalMode.set('configure');
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
    if (this.useUnifiedModal) {
      // Fase 5: open the unified modal in 'create' mode. No existing
      // product (fresh identity capture); the emit is routed back through
      // onConfigConfirmed → onPrebulkAdded, so the cart payload is
      // identical to the legacy prebulk flow.
      this.editingCartItemId.set(null);
      this.configModalProduct.set(null);
      this.configModalMode.set('create');
      this.showConfigModal.set(true);
      return;
    }
    // Rollback path: legacy prebulk modal.
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

      // Fase 4: UoM preseleccionadas por el scanner desde uom_hint (solo
      // flujo ingredient). Sugerencia editable; null en retail / sin match.
      const purchaseUomId = item.purchase_uom_id ?? null;
      const stockUomId = item.stock_uom_id ?? null;

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
            purchase_uom_id: purchaseUomId,
            stock_uom_id: stockUomId,
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
            purchase_uom_id: purchaseUomId,
            stock_uom_id: stockUomId,
            prebulk_data: {
              name: item.description,
              code: item.sku_if_visible || '',
              description: item.description,
              purchase_uom_id: purchaseUomId,
              stock_uom_id: stockUomId,
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

  private normalizeBulkKey(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeBulkRow(row: any): Record<string, any> {
    const normalizedRow: Record<string, any> = {};
    Object.keys(row).forEach((key) => {
      normalizedRow[this.normalizeBulkKey(key)] = row[key];
    });
    return normalizedRow;
  }

  private getBulkValue(row: Record<string, any>, ...aliases: string[]) {
    for (const alias of aliases) {
      const value = row[this.normalizeBulkKey(alias)];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
  }

  private parseBulkText(value: unknown, fallback = ''): string {
    if (value === undefined || value === null) return fallback;
    return String(value).trim();
  }

  private parseBulkNumber(value: unknown, fallback = 0): number {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;

    let normalized = String(value)
      .trim()
      .replace(/[^\d,.-]/g, '');
    const lastComma = normalized.lastIndexOf(',');
    const lastDot = normalized.lastIndexOf('.');

    if (lastComma > -1 && lastDot > -1) {
      normalized =
        lastComma > lastDot
          ? normalized.replace(/\./g, '').replace(',', '.')
          : normalized.replace(/,/g, '');
    } else if (lastComma > -1) {
      normalized = normalized.replace(',', '.');
    } else if (/^-?\d{1,3}(\.\d{3})+$/.test(normalized)) {
      normalized = normalized.replace(/\./g, '');
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private parseBulkOptionalNumber(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = this.parseBulkNumber(value, Number.NaN);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private parseBulkBoolean(value: unknown, fallback: boolean): boolean {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;

    const normalized = this.normalizeBulkKey(String(value));
    if (
      ['si', 'yes', 'true', 'verdadero', '1', 'activo', 'x'].includes(
        normalized,
      )
    ) {
      return true;
    }
    if (
      ['no', 'false', 'falso', '0', 'inactivo', 'ninguno'].includes(
        normalized,
      )
    ) {
      return false;
    }
    return fallback;
  }

  private parseBulkOptionalBoolean(value: unknown): boolean | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    return this.parseBulkBoolean(value, false);
  }

  private normalizeBulkProductType(value: unknown): string {
    const normalized = this.normalizeBulkKey(String(value ?? ''));
    return ['servicio', 'service'].includes(normalized) ? 'service' : 'physical';
  }

  private normalizeBulkState(value: unknown): string {
    const normalized = this.normalizeBulkKey(String(value ?? ''));
    if (['inactivo', 'inactive', 'deshabilitado'].includes(normalized)) {
      return 'inactive';
    }
    if (['archivado', 'archived'].includes(normalized)) {
      return 'archived';
    }
    return 'active';
  }

  private normalizeBulkPricingType(value: unknown): string {
    const normalized = this.normalizeBulkKey(String(value ?? ''));
    return ['peso', 'weight', 'por peso'].includes(normalized) ? 'weight' : 'unit';
  }

  private parseBulkTaxCategoryIds(value: unknown): number[] | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const values = Array.isArray(value)
      ? value
      : String(value)
          .split(/[;,]/)
          .map((item) => item.trim());
    const ids = values
      .map((item) => this.parseBulkOptionalNumber(item))
      .filter((item): item is number => item !== undefined && item > 0);
    return ids.length > 0 ? Array.from(new Set(ids)) : undefined;
  }

  onBulkDataReceived(items: any[]): void {
    if (!items || items.length === 0) return;

    let addedCount = 0;

    items.forEach((row) => {
      const normalizedRow = this.normalizeBulkRow(row);

      const name =
        this.getBulkValue(normalizedRow, 'name', 'nombre', 'producto', 'product');

      const sku =
        this.getBulkValue(normalizedRow, 'sku', 'code', 'codigo', 'id');

      if (!name || !sku) {
        return;
      }

      const product_type = this.normalizeBulkProductType(
        this.getBulkValue(normalizedRow, 'product_type', 'tipo'),
      );
      const track_inventory = this.parseBulkBoolean(
        this.getBulkValue(normalizedRow, 'track_inventory', 'controla inventario'),
        product_type !== 'service',
      );
      const unit_cost = this.parseBulkNumber(
        this.getBulkValue(
          normalizedRow,
          'cost',
          'costo',
          'price',
          'precio',
          'unit_cost',
          'cost_price',
          'precio compra',
        ),
      );
      const quantity =
        this.parseBulkNumber(
          this.getBulkValue(
            normalizedRow,
            'quantity',
            'qty',
            'cantidad',
            'cant',
            'cantidad inicial',
          ),
          1,
        ) || 1;

      const description = this.parseBulkText(
        this.getBulkValue(normalizedRow, 'description', 'descripción', 'detalle'),
      );
      const state = this.normalizeBulkState(
        this.getBulkValue(normalizedRow, 'state', 'estado', 'status'),
      );
      const weight = this.parseBulkNumber(
        this.getBulkValue(normalizedRow, 'weight', 'peso'),
      );
      const available_for_ecommerce = this.parseBulkBoolean(
        this.getBulkValue(
          normalizedRow,
          'available_for_ecommerce',
          'disponible ecommerce',
          'ecommerce',
        ),
        true,
      );
      const base_price = this.parseBulkNumber(
        this.getBulkValue(normalizedRow, 'base_price', 'precio venta'),
      );
      const profit_margin = this.parseBulkNumber(
        this.getBulkValue(normalizedRow, 'profit_margin', 'margen', 'margin'),
      );

      const brand = (
        this.getBulkValue(normalizedRow, 'brand_id', 'marca', 'brand') || ''
      )
        .toString()
        .trim();
      const categories = (
        this.getBulkValue(
          normalizedRow,
          'category_ids',
          'categorías',
          'categorias',
          'categories',
        ) || ''
      )
        .toString()
        .trim();
      const taxCategoryIds = this.parseBulkTaxCategoryIds(
        this.getBulkValue(normalizedRow, 'tax_category_ids', 'impuestos ids', 'impuestos'),
      );
      const pricingTypeRaw = this.getBulkValue(
        normalizedRow,
        'pricing_type',
        'tipo precio',
      );
      const pricingType =
        pricingTypeRaw === undefined
          ? undefined
          : this.normalizeBulkPricingType(pricingTypeRaw);
      const isFeatured = this.parseBulkOptionalBoolean(
        this.getBulkValue(normalizedRow, 'is_featured', 'destacado'),
      );
      const allowPosPriceOverride = this.parseBulkOptionalBoolean(
        this.getBulkValue(
          normalizedRow,
          'allow_pos_price_override',
          'permite cambiar precio pos',
        ),
      );
      const hasMultiplePriceTiers = this.parseBulkOptionalBoolean(
        this.getBulkValue(
          normalizedRow,
          'has_multiple_price_tiers',
          'usa listas de precio',
        ),
      );
      const isOnSale = this.parseBulkOptionalBoolean(
        this.getBulkValue(normalizedRow, 'en oferta', 'is_on_sale'),
      );
      const salePriceRaw = this.getBulkValue(
        normalizedRow,
        'precio oferta',
        'sale_price',
      );
      const salePrice =
        salePriceRaw === undefined
          ? undefined
          : this.parseBulkNumber(salePriceRaw);

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
            product_type,
            track_inventory,
            pricing_type: pricingType,
            tax_category_ids: taxCategoryIds,
            is_featured: isFeatured,
            allow_pos_price_override: allowPosPriceOverride,
            has_multiple_price_tiers: hasMultiplePriceTiers,
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
    this.header.addSupplier(supplier);
    this.popCartService.setSupplier(supplier.id);
  }

  onWarehouseCreated(warehouse: { id: number; name: string; code?: string }): void {
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
