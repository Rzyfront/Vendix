import {Component, OnInit, OnDestroy, ViewChild, signal, computed, HostListener, DestroyRef, inject} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subscription, firstValueFrom, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import type { SelectorOption } from '../../../../../shared/components/selector/selector.component';

import {
  PopCartService,
  PopCartSummary,
  PopCartState,
  PopCartItem,
  PopProduct,
  ShippingMethod,
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
import { DispatchNotesService } from '../../dispatch-notes/services/dispatch-notes.service';
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
import { PopCheckoutShellComponent } from './components/pop-checkout-shell/pop-checkout-shell.component';
import { PopPricingOverridesMap } from './components/pop-checkout-shell/steps/pop-receive-step.component';
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
import {
  VexiUiHost,
  VexiUiHostRegistry,
} from '../../../../../core/services/vexi-ui-host.registry';

/** Opciones del selector "Método Envío" del paso Configuración del wizard. */
const SHIPPING_METHOD_OPTIONS: SelectorOption[] = [
  { value: 'supplier_transport', label: 'Transporte Proveedor' },
  { value: 'freight', label: 'Flete' },
  { value: 'pickup', label: 'Recolección' },
  { value: 'other', label: 'Otro' },
];

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
    PopCheckoutShellComponent,
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
          (configDone)="onConfigDone()"
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

    <app-pop-checkout-shell
      [isOpen]="showOrderConfirmModal()"
      (isOpenChange)="showOrderConfirmModal.set($event)"
      [cartState]="cartState()"
      [supplierName]="currentSupplierName"
      [locationName]="currentLocationName"
      [actionType]="confirmOrderAction"
      [costPreview]="costPreview()"
      [loadingCostPreview]="loadingCostPreview()"
      [isProcessing]="isProcessingOrder()"
      [retryOrderRef]="retryOrderRef()"
      [needsConfig]="shellNeedsConfig()"
      (confirmed)="onOrderConfirmed()"
      (cancelled)="showOrderConfirmModal.set(false)"
      (navigateToSettings)="onNavigateToSettings()"
      (pricingOverridesChange)="onPricingOverridesChange($event)"
      (ackReceiveChange)="ackReceive.set($event)"
      (paymentPlanChange)="paymentPlan.set($event)"
      (configComplete)="loadCostPreview()"
      (configSupplierChange)="onShellSupplierChange($event)"
      (configLocationChange)="onShellLocationChange($event)"
      (configOrderDateChange)="onShellOrderDateChange($event)"
      (configExpectedDateChange)="onShellExpectedDateChange($event)"
      (configShippingMethodChange)="onShellShippingMethodChange($event)"
    ></app-pop-checkout-shell>

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
  private vexiHosts = inject(VexiUiHostRegistry);
  private dispatchNotesService = inject(DispatchNotesService);
  /**
   * PASO 1 — Acción diferida. Cuando el usuario dispara guardar/crear/recibir
   * sin proveedor+bodega, la recordamos, abrimos el config modal y la
   * reconectamos al cerrar el modal ya configurado (`onConfigDone`).
   */
  private pendingAction = signal<'draft' | 'create' | 'create-receive' | null>(
    null,
  );
  /**
   * PASO 2/3 — Acuse de recepción del wizard (create-receive). ON por defecto:
   * genera la remisión de entrada. Lo sincroniza el shell (paso Recepción) y
   * el shell lo resetea a true en cada apertura. El "pago total" ya no es un
   * acuse independiente: lo deriva el plan de pago (ver `onOrderConfirmed`).
   */
  readonly ackReceive = signal(true);
  showInvoiceScanner = signal(false);
  /**
   * Fase 4: derive the AI scan profile from the current cart. If any
   * line is a pure ingredient (is_ingredient && !is_sellable), route to
   * the `invoice_ocr_ingredient` profile so the model also extracts
   * presentation / pack_size / uom_hint. Otherwise `retail`.
   */
  readonly scannerOrderType = computed<'retail' | 'ingredient'>(() => {
    const state = this.popCartService.currentState;
    const cartHasIngredient = state.items.some((it: any) => {
      const p: any = it.product;
      if (!p) return false;
      const sellable =
        p.is_sellable === undefined || p.is_sellable === null
          ? true
          : !!p.is_sellable;
      return !!p.is_ingredient && !sellable;
    });
    // Punto 1 (a): el default sugerido combina el carrito con la capacidad de
    // industria. Si la tienda soporta insumos (restaurante, etc.) el escaneo
    // arranca en modo `ingredient` aunque el carrito esté vacío. Es solo la
    // semilla: el usuario puede cambiar el perfil dentro del modal.
    const industrySupportsIngredients = this.authFacade.storeSupportsIngredients();
    return cartHasIngredient || industrySupportsIngredients
      ? 'ingredient'
      : 'retail';
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

  /**
   * QUI-647 — snapshot de "el POP no estaba configurado (sin proveedor/bodega)"
   * al ABRIR el wizard. Mientras sea true, el shell arranca en el paso 1
   * Configuración. Se congela en la apertura (no se recalcula en vivo), así el
   * paso Configuración no desaparece del stepper al elegir proveedor a mitad
   * de sesión; en la siguiente apertura se re-evalúa desde el carrito.
   */
  readonly shellNeedsConfig = signal(false);

  /** Opciones del paso Configuración del wizard (dueño de data: pop-header). */
  readonly shellSupplierOptions = computed<SelectorOption[]>(() =>
    this.header?.supplierOptions() ?? [],
  );
  readonly shellLocationOptions = computed<SelectorOption[]>(() =>
    this.header?.locationOptions() ?? [],
  );
  readonly shellShippingMethodOptions = SHIPPING_METHOD_OPTIONS;

  /** Fechas del carrito en formato YYYY-MM-DD para los inputs date del wizard. */
  readonly shellOrderDate = computed<string>(() =>
    this.toISODate(this.cartState()?.orderDate),
  );
  readonly shellExpectedDate = computed<string>(() =>
    this.toISODate(this.cartState()?.expectedDate),
  );

  /**
   * OC ya creada por un intento cuya RECEPCIÓN falló. Mientras esté seteada, el
   * carrito y la ruta se conservan (una recepción fallida no puede parecer una
   * operación completada) y el siguiente "crear y recibir" reanuda la recepción
   * sobre ESTA orden en vez de crear una segunda OC para la misma compra.
   */
  readonly pendingReceptionOrder = signal<any>(null);

  /**
   * QUI-647 — ref legible de la OC pendiente de recepción para el banner de
   * reintento del wizard ("La orden #X ya fue creada..."). Null cuando no hay
   * reintento → el wizard muestra el flujo normal.
   */
  readonly retryOrderRef = computed<string | null>(() => {
    const pending = this.pendingReceptionOrder();
    if (!pending) return null;
    return pending.order_number || `#${pending.id}`;
  });

  costPreview = signal<CostPreviewResponse | null>(null);
  loadingCostPreview = signal(false);
  /**
   * QUI-425 (D4) — Latest pricing overrides captured by the confirmation
   * modal. Mirrored here so the parent can grab them synchronously on confirm.
   * Default to an empty Map so `?.get()` is always safe.
   *
   * Se aplican por la vía remisión: el DTO de la remisión de compra acepta
   * `new_base_price`/`new_profit_margin` opcionales y los propaga a `receive()`;
   * ver `_buildReceptionViaDispatch$`.
   */
  pricingOverrides = signal<PopPricingOverridesMap>(new Map());

  /**
   * QUI-647 — configuración de pago elegida en el modal. Viaja al backend en
   * el payload de creación; el backend valida que las cuotas cierren el saldo
   * y las persiste como plan contra la orden hasta que exista la CxP.
   */
  paymentPlan = signal<{
    payment_plan: 'immediate' | 'partial' | 'deferred' | 'installments';
    down_payment_amount: number;
    payment_due_date?: string;
    payment_installments: Array<{ scheduled_date: string; amount: number }>;
  } | null>(null);

  cartState = signal<PopCartState | null>(null);
  cartSummary = signal<PopCartSummary | null>(null);
  cartItemCount = signal(0);
  selectedSupplierName = signal('');
  selectedLocationName = signal('');

  private subscriptions: Subscription[] = [];

  // ── Host de Vexi ────────────────────────────────────────────────────────
  //
  // El POP es el taller de la orden de compra, así que es lo que Vexi necesita
  // poder leer y conducir cuando alguien le pide una. `runAction` NO expone
  // "crear la orden": esa es la decisión del negocio y pasa por la tarjeta de
  // aprobación del agente o por el botón de la persona, nunca por un comando de
  // interfaz que dispara un POST sin que nadie lo haya visto.
  private readonly vexiHostAdapter: VexiUiHost = {
    vexiModuleKey: 'pop',
    readScreen: () => {
      const summary = this.cartSummary();
      const supplier = this.selectedSupplierName();
      const location = this.selectedLocationName();

      const pending: string[] = [];
      if (!supplier) pending.push('proveedor');
      if (!location) pending.push('bodega');

      return {
        module_key: 'pop',
        title: 'POP — Orden de compra',
        visible_count: this.cartItemCount(),
        selection: supplier || null,
        notes:
          `${this.cartItemCount()} línea(s) en el carrito` +
          (summary?.total != null ? `, total ${summary.total}` : '') +
          (supplier ? `, proveedor ${supplier}` : '') +
          (location ? `, bodega ${location}` : '') +
          (pending.length ? `. Falta elegir ${pending.join(' y ')}.` : '.') +
          (this.showInvoiceScanner() ? ' El escáner de factura está abierto.' : ''),
      };
    },
    listActions: () => [
      { id: 'escanear_factura', label: 'Abrir el escáner de factura de proveedor' },
      { id: 'elegir_proveedor', label: 'Abrir el selector de proveedor' },
      { id: 'elegir_bodega', label: 'Abrir el selector de bodega' },
      { id: 'guardar_borrador', label: 'Guardar la orden como borrador' },
    ],
    runAction: async (id) => {
      switch (id) {
        case 'escanear_factura':
          this.showInvoiceScanner.set(true);
          return {
            status: 'needs_user_input' as const,
            message:
              'Abrí el escáner de factura. La persona sube el archivo desde ahí y revisa lo extraído antes de que entre al carrito.',
          };
        case 'elegir_proveedor':
          this.supplierModalOpen.set(true);
          return {
            status: 'needs_user_input' as const,
            message: 'Abrí el selector de proveedor.',
          };
        case 'elegir_bodega':
          this.warehouseModalOpen.set(true);
          return {
            status: 'needs_user_input' as const,
            message: 'Abrí el selector de bodega.',
          };
        case 'guardar_borrador':
          if (!this.cartItemCount()) {
            return {
              status: 'error' as const,
              message: 'El carrito está vacío: no hay nada que guardar como borrador.',
            };
          }
          this.onSaveAsDraft();
          return {
            status: 'ok' as const,
            message: 'Disparé el guardado como borrador.',
          };
        default:
          return {
            status: 'not_found' as const,
            message: `El POP no tiene una acción "${id}".`,
          };
      }
    },
    openModal: (id) => this.vexiHostAdapter.runAction!(id),
  };

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
    this.vexiHosts.register(this.vexiHostAdapter);
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

    // `?scan=invoice` abre el escáner nativo de factura al entrar. Es la vía por
    // la que otro módulo (o Vexi, desde Órdenes de compra) trae a la persona
    // directo al escáner en vez de dejarla buscar el botón: el modal es el mismo
    // que abre la barra de acciones, así que el flujo posterior no cambia.
    if (params['scan'] === 'invoice') {
      this.showInvoiceScanner.set(true);
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
                  purchase_uom_id: result.purchase_uom_id,
                  stock_uom_id: result.stock_uom_id,
                  // F1: contenido por envase (factor manual envase→stock).
                  contentPerPackage: result.contentPerPackage,
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
            purchase_uom_id: result.purchase_uom_id,
            stock_uom_id: result.stock_uom_id,
            // F1: contenido por envase (factor manual envase→stock).
            contentPerPackage: result.contentPerPackage,
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
          // Propagar las FKs de UoM del insumo (antes se descartaban → la
          // línea quedaba sin unidad de compra/stock y el backend no derivaba
          // el factor al recibir).
          purchase_uom_id: result.purchase_uom_id,
          stock_uom_id: result.stock_uom_id,
          // F1: contenido por envase (factor manual envase→stock).
          contentPerPackage: result.contentPerPackage,
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
    this.vexiHosts.unregister(this.vexiHostAdapter);
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
    supplierId?: number | null;
  }): void {
    this.showInvoiceScanner.set(false);

    // Punto 2 (i): usa el proveedor ELEGIDO en el modal (preseleccionado desde
    // el match pero editable). Si es null no tocamos el proveedor actual.
    if (data.supplierId != null) {
      this.popCartService.setSupplier(data.supplierId);
    }

    // Punto 2 (ii) — BUG: `invoiceDate` llegaba pero nunca se aplicaba. La
    // cableamos a la fecha de la orden validando que parsee antes (evita
    // Invalid Date con inputs vacíos o mal formados).
    if (data.invoiceDate) {
      const parsedDate = new Date(data.invoiceDate);
      if (!Number.isNaN(parsedDate.getTime())) {
        this.popCartService.setOrderDate(parsedDate);
      }
    }

    // IVA cycle (maestro): si el escáner detectó IVA en alguna línea, enciende
    // "¿Esta compra tiene IVA?" ANTES del loop para que las líneas nuevas se
    // agreguen con el maestro ya activo. El neto ya viene aplastado y el modo es
    // adicional (prices_include_tax=false) ⇒ no hay doble resta. No se apaga si
    // el usuario ya lo tenía encendido.
    const scanHasVat = data.editedItems.some(
      (it) => it.tax_rate != null && Number(it.tax_rate) > 0,
    );
    if (scanHasVat) {
      this.popCartService.setHasVat(true);
    }

    // QUI-661 Fase 4 — descuento GENERAL de pie de factura. Va al carrito, no a
    // las líneas: el backend lo prorratea contra el peso de cada una. Se aplica
    // sólo si el escáner lo detectó; un escaneo sin descuento no debe pisar el
    // que el usuario haya tecleado a mano antes de escanear.
    //
    // El descuento POR LÍNEA no pasa por acá: viaja en cada `editedItems` y se
    // convierte a porcentaje al agregar al carrito. Nunca se reportan los dos
    // sobre el mismo dinero — el prompt lo prohíbe explícitamente.
    const scannedHeaderDiscount = Number(data.scanResult?.discount_amount) || 0;
    if (scannedHeaderDiscount > 0) {
      this.popCartService.setDiscountAmount(scannedHeaderDiscount);
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

      // IVA cycle (F3 wiring): el escáner emite `tax_rate` como FRACCIÓN (0.19)
      // y ya aplastó `unit_price` a neto (`normalizeOcrResponse`). Convertimos a
      // PORCENTAJE (×100) para el carrito y forzamos modo adicional
      // (`prices_include_tax=false`) para que el IVA se sume sobre el neto y el
      // costeo lo trate según el estado fiscal. Sin tasa detectada ⇒ undefined
      // (el carrito hereda header + default). Tasa 0 (exento) se respeta.
      const scannedRate =
        item.tax_rate != null ? Number(item.tax_rate) * 100 : undefined;
      const scannedIncludeMode = scannedRate != null ? false : undefined;

      // QUI-661 Fase 4: la factura imprime el descuento en PESOS y el carrito
      // trabaja en PORCENTAJE, así que se convierte acá contra el importe neto
      // de la línea. Se hace en este punto y no en el backend porque es el
      // carrito el que necesita el porcentaje para su preview; el backend
      // recibe después el porcentaje y resuelve el monto otra vez, que es su
      // fuente de verdad.
      const lineGross =
        (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
      const scannedDiscountAmount = Number(item.discount_amount) || 0;
      const scannedDiscountPct =
        lineGross > 0 && scannedDiscountAmount > 0
          ? Math.min(100, (scannedDiscountAmount / lineGross) * 100)
          : undefined;

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
            tax_rate: scannedRate,
            tax_type: 'iva',
            prices_include_tax: scannedIncludeMode,
            discount: scannedDiscountPct,
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
            tax_rate: scannedRate,
            tax_type: 'iva',
            prices_include_tax: scannedIncludeMode,
            // QUI-661 Fase 4: también en el producto NUEVO. El descuento no
            // depende de que el producto exista en el catálogo — depende de lo
            // que imprimió la factura.
            discount: scannedDiscountPct,
            prebulk_data: {
              name: item.description,
              code: item.sku_if_visible || '',
              description: item.description,
              purchase_uom_id: purchaseUomId,
              stock_uom_id: stockUomId,
              // IVA cycle (F3): categoría de impuesto sugerida por el escáner
              // (null si el comercio no es responsable de IVA — gate en origen).
              tax_category_ids: item.suggested_tax_category_id
                ? [item.suggested_tax_category_id]
                : undefined,
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
      this.header.openConfigModal();
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
      // Vaciar el carrito descarta el reintento pendiente: el próximo carrito ya
      // no corresponde a esa OC y reanudar su recepción ignoraría la compra nueva.
      this.pendingReceptionOrder.set(null);
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

    if (state.items.length === 0) {
      this.toastService.warning(
        'Por favor agrega al menos un producto antes de crear la orden.',
      );
      return;
    }

    // QUI-647: sin proveedor/bodega el wizard arranca con Configuración como
    // PASO 1 (antes abría el modal de configuración aparte y bloqueaba).
    this.openCheckoutShell('create-receive');
  }

  /**
   * PASO 1 — El config modal se cerró con "Listo" ya configurado (pop-header
   * solo emite `configDone` cuando `isConfigured()` es true). Si había una
   * acción pendiente y el carrito confirma proveedor+bodega, la re-disparamos.
   *
   * Si el usuario cierra el modal SIN completar la config, pop-header no emite
   * y `pendingAction` se conserva para el próximo intento; se limpia al
   * re-disparar aquí o al proceder normalmente en cualquier handler.
   */
  onConfigDone(): void {
    const action = this.pendingAction();
    if (!action) return;

    const state = this.popCartService.currentState;
    if (!state.supplierId || !state.locationId) return;

    this.pendingAction.set(null);
    if (action === 'draft') {
      this.onSaveAsDraft();
    } else if (action === 'create') {
      this.onSubmitOrder();
    } else {
      this.onCreateAndReceive();
    }
  }

  // ============================================================
  // Wizard shell — paso Configuración (QUI-647)
  // ============================================================

  /**
   * El paso Configuración emite cada cambio en vivo (igual que el modal del
   * header): aquí se persiste en el carrito. Al avanzar a Pago el módulo ya
   * queda "Configurado" y el header muestra proveedor/bodega.
   */
  onShellSupplierChange(value: number | null | string): void {
    this.popCartService.setSupplier(value ? Number(value) : null);
  }

  onShellLocationChange(value: number | null | string): void {
    this.popCartService.setLocation(value ? Number(value) : null);
  }

  onShellOrderDateChange(value: string): void {
    if (!value) return;
    const [year, month, day] = value.split('-').map(Number);
    this.popCartService.setOrderDate(new Date(year, month - 1, day));
  }

  onShellExpectedDateChange(value: string): void {
    if (value) {
      const [year, month, day] = value.split('-').map(Number);
      this.popCartService.setExpectedDate(new Date(year, month - 1, day));
    } else {
      this.popCartService.setExpectedDate(undefined);
    }
  }

  onShellShippingMethodChange(value: string): void {
    this.popCartService.setShippingMethod(value as ShippingMethod);
  }

  /**
   * El paso Configuración quedó completo (proveedor+bodega): ya hay bodega
   * para costear, así que recargamos el preview de costeo que el wizard
   * necesita en el paso Recepción.
   */
  onShellConfigComplete(): void {
    this.loadCostPreview();
  }

  /** `Date` → `YYYY-MM-DD` (hora local) para los inputs date del wizard. */
  private toISODate(date: Date | undefined | null): string {
    if (!date) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
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
        // PASO 1: recuerda "guardar borrador" para reconectarla al configurar.
        this.pendingAction.set('draft');
        this.header.openConfigModal();
      }
      this.toastService.warning(
        'Por favor selecciona proveedor y bodega antes de guardar.',
      );
      return;
    }
    this.pendingAction.set(null);
    const draftState = { ...state, status: 'draft' as const };
    const userId = this.authFacade.getUserId() || 0;

    const request = cartToPurchaseOrderRequest(draftState, userId, undefined);
    // F1: mapea el contenido por envase capturado → purchase_to_stock_factor.
    this.attachPurchaseToStockFactor(request, draftState);
    // QUI-648: unidad de venta configurada en el modal.
    this.attachSaleUnitConfig(request, draftState);

    this.purchaseOrdersService.createPurchaseOrder(request).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        this.toastService.success('Orden guardada como borrador');
        this.popCartService.clearCart().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
        this.router.navigate(['/admin/products']);
      },
      error: (error) => {
        console.error('Error saving draft:', error);
        this.toastService.error(
          this._errorMessage(error, 'Error al guardar el borrador'),
        );
      },
    });
  }

  onSubmitOrder(): void {
    const state = this.popCartService.currentState;

    if (state.items.length === 0) {
      if (this.isMobile()) {
        this.showCartModal.set(true);
      }
      this.toastService.warning(
        'Por favor agrega al menos un producto antes de crear la orden.',
      );
      return;
    }

    // QUI-647: sin proveedor/bodega el wizard arranca con Configuración como
    // PASO 1 (antes abría el modal de configuración aparte y bloqueaba).
    this.openCheckoutShell('create');
  }

  onCreateAndReceive(): void {
    const state = this.popCartService.currentState;

    if (state.items.length === 0) {
      if (this.isMobile()) {
        this.showCartModal.set(true);
      }
      this.toastService.warning(
        'Por favor agrega al menos un producto antes de crear la orden.',
      );
      return;
    }

    // QUI-647: sin proveedor/bodega el wizard arranca con Configuración como
    // PASO 1 (antes abría el modal de configuración aparte y bloqueaba).
    this.openCheckoutShell('create-receive');
  }

  /**
   * QUI-647 — Abre el wizard (shell) para una acción de creación. Si el POP
   * no tiene proveedor+bodega, el shell arranca en el PASO 1 Configuración
   * (el wizard ya no se bloquea en el modal de configuración); si ya hay
   * config, arranca en Pago (comportamiento previo intacto).
   */
  private openCheckoutShell(action: 'create' | 'create-receive'): void {
    const state = this.popCartService.currentState;

    this.pendingAction.set(null);
    this.showCartModal.set(false);
    this.confirmOrderAction = action;
    // Snapshot de "necesita config" en la APERTURA (no en vivo): el paso
    // Configuración no desaparece del stepper al elegir proveedor a mitad
    // de sesión; la siguiente apertura re-evalúa desde el carrito.
    this.shellNeedsConfig.set(!state.supplierId || !state.locationId);
    // Cada apertura arranca con acuses por defecto (recibir ON) y overrides
    // limpios. El plan de pago se resetea: pertenece a la instancia del
    // carrito y no debe sobrevivir entre aperturas (bug de prod QUI-647).
    this.ackReceive.set(true);
    this.paymentPlan.set(null);
    this.pricingOverrides.set(new Map());
    // Sin bodega el preview de costeo no tiene dónde costear: el service lo
    // ignora y se recarga cuando el paso Configuración queda completo.
    this.loadCostPreview();
    this.showOrderConfirmModal.set(true);
  }

  // ============================================================
  // Order Confirmation Modal Handlers
  // ============================================================

  /**
   * PASO 3/4 — Cierra el shell y orquesta los efectos. El "diálogo intermedio"
   * ya no existe: la confirmación es el paso terminal del wizard.
   *
   * Matriz anti-doble-registro de pagos (derivada del plan de pago):
   *  - `create` + immediate → `_executeSubmitOrder` crea y el backend registra
   *    el pago al crear (sin down_payment_amount en el payload).
   *  - `create-receive` + immediate → doPay=true: el pago se registra DESPUÉS
   *    de la recepción (el backend resuelve `is_advance=false` por conteo de
   *    recepciones). El request de creación NO lleva down_payment_amount.
   *  - `partial` → el abono viaja como anticipo en el payload de creación
   *    (attachPaymentPlan); aquí NO se registra pago (doPay=false).
   *  - `deferred` / `installments` → ningún pago hoy (doPay=false).
   *  - Reintento de recepción (`pendingReceptionOrder`) → nunca se registra
   *    pago: la OC ya existe y solo falta que entre la mercancía.
   */
  onOrderConfirmed(): void {
    this.showOrderConfirmModal.set(false);

    const action = this.confirmOrderAction;
    const doReceive = this.ackReceive();

    if (action === 'create') {
      // `_executeSubmitOrder` ya enruta a la recepción si hay un reintento.
      this._executeSubmitOrder();
      return;
    }

    const plan = this.paymentPlan();
    const doPay =
      !this.pendingReceptionOrder() && plan?.payment_plan === 'immediate';
    this._executeCreateReceivePay(doReceive, doPay);
  }

  onNavigateToSettings(): void {
    this.showOrderConfirmModal.set(false);
    this.router.navigate(['/store/settings/general']);
  }

  /**
   * QUI-425 (D4) — keep the latest override Map in sync with the modal. We
   * accept a Map directly (no copy) because the modal emits the same Map it
   * stores; downstream consumers must treat it as read-only. Se aplican al
   * recibir por remisión (ver `_buildReceptionViaDispatch$`).
   */
  onPricingOverridesChange(overrides: PopPricingOverridesMap): void {
    this.pricingOverrides.set(overrides);
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

    // QUI-645 — los productos NUEVOS (prebulk) no tienen nada que consultar en
    // el backend: no hay stock, ni costo previo, ni precio de catálogo. Pero
    // sí tienen que aparecer en el modal de confirmación, porque hoy es el
    // único punto del flujo donde el operador puede fijarles margen y precio
    // de venta antes de que el producto exista. Se arman filas sintéticas con
    // la misma forma que devuelve el backend para que la UX de margen de
    // QUI-425 las trate igual que a las existentes.
    const newRows = this.buildNewProductPreviewRows();

    if (request.items.length === 0) {
      // Solo hay productos nuevos: no hay nada que pedirle al backend, pero el
      // modal igual debe mostrarlos para poder fijarles precio.
      this.costPreview.set(
        newRows.length
          ? ({ costing_method: null, items: newRows } as any)
          : null,
      );
      this.loadingCostPreview.set(false);
      return;
    }

    this.purchaseOrdersService.getCostPreview(request).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        const data = response.success ? response.data : null;
        this.costPreview.set(
          data
            ? ({ ...data, items: [...(data.items ?? []), ...newRows] } as any)
            : newRows.length
              ? ({ costing_method: null, items: newRows } as any)
              : null,
        );
        this.loadingCostPreview.set(false);
      },
      error: () => {
        this.costPreview.set(
          newRows.length
            ? ({ costing_method: null, items: newRows } as any)
            : null,
        );
        this.loadingCostPreview.set(false);
      },
    });
  }

  /**
   * QUI-645 — synthetic cost-preview rows for products that do not exist yet.
   *
   * `product_id` is a NEGATIVE index-derived id: the modal keys its pricing
   * overrides by `${product_id}-${variant_id || 0}`, and a new product has no
   * id to key on. Negative values can never collide with a real product id and
   * stay stable while the cart is untouched, which is what the override map
   * needs. `applyNewProductPricing` maps them back to the cart line.
   */
  private buildNewProductPreviewRows(): any[] {
    const state = this.popCartService.currentState;
    return state.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.is_prebulk && item.prebulk_data)
      .map(({ item, index }) => {
        // Cost the product will be born with: the NET unit cost of the line,
        // discount included (QUI-661). `item.subtotal` is already Σ neto.
        const qty = Number(item.quantity) || 1;
        const netUnitCost = qty > 0 ? Number(item.subtotal || 0) / qty : 0;
        const margin = Number(item.prebulk_data?.profit_margin ?? 0);
        return {
          product_id: -(index + 1),
          product_variant_id: null,
          product_name: item.prebulk_data?.name || 'Producto nuevo',
          current_stock: 0,
          current_cost_per_unit: 0,
          global_stock: 0,
          global_cost_per_unit: 0,
          new_stock: qty,
          new_cost_per_unit: Math.round(netUnitCost * 100) / 100,
          incoming_quantity: qty,
          incoming_cost: Number(item.subtotal || 0),
          incoming_gross_cost: Number(item.unit_cost || 0) * qty,
          unit_price_net: netUnitCost,
          incoming_tax_per_unit:
            qty > 0 ? Number(item.tax_amount || 0) / qty : 0,
          incoming_tax_amount: Number(item.tax_amount || 0),
          effective_include: !!item.prices_include_tax,
          // A brand-new product is not a "reactivation" — it never had stock.
          is_reactivation: false,
          current_base_price: Number(item.prebulk_data?.base_price ?? 0),
          current_profit_margin: margin,
          // Decisión de negocio (QUI-645): margen 0 % por defecto. El producto
          // nace al costo y el operador lo sube si quiere, en vez de heredar
          // un margen implícito que nadie eligió.
          resulting_margin: margin,
          is_new_product: true,
        };
      });
  }

  /**
   * QUI-645 — carries the margin/price the operator set in the confirmation
   * modal back onto the cart line, so the create payload persists it and the
   * product is born already priced instead of landing in the catalog at 0.
   */
  /**
   * QUI-647 — adjunta el plan de pago al payload de creación.
   *
   * Matriz anti-doble-registro de pagos (la contraparte de `onOrderConfirmed`):
   *  - `immediate` (create Y create-receive): NO viaja `down_payment_amount`.
   *    El pago se registra al crear (create) o después de la recepción con
   *    `is_advance=false` (create-receive, lo resuelve el backend por conteo de
   *    recepciones). Mandar un abono aquí duplicaría el pago.
   *  - `partial`: SIEMPRE viaja `down_payment_amount` como anticipo (el backend
   *    lo registra al crear, source 'po_advance', DR 133005/CR 1110).
   *  - `deferred` / `installments`: ningún pago hoy; solo fecha/cuotas.
   */
  private attachPaymentPlan(request: any): void {
    const plan = this.paymentPlan();
    if (!plan) return;
    if (plan.payment_plan === 'immediate') return;
    request.payment_plan = plan.payment_plan;
    if (plan.payment_plan === 'partial' && plan.down_payment_amount > 0) {
      request.down_payment_amount = plan.down_payment_amount;
    }
    if (plan.payment_due_date) {
      request.payment_due_date = plan.payment_due_date;
    }
    if (plan.payment_installments.length > 0) {
      request.payment_installments = plan.payment_installments;
    }
  }

  private applyNewProductPricing(): void {
    const overrides = this.pricingOverrides();
    if (!overrides || overrides.size === 0) return;

    const state = this.popCartService.currentState;
    state.items.forEach((item, index) => {
      if (!item.is_prebulk || !item.prebulk_data) return;
      const override = overrides.get(`${-(index + 1)}-0`);
      if (!override) return;
      if (override.new_base_price !== undefined) {
        item.prebulk_data.base_price = override.new_base_price;
      }
      if (override.new_profit_margin !== undefined) {
        item.prebulk_data.profit_margin = override.new_profit_margin;
      }
    });
  }

  private _executeSubmitOrder(): void {
    const state = this.popCartService.currentState;

    // La OC de un intento con recepción fallida YA existe: crear otra desde el
    // mismo carrito duplicaría la compra. Reanudamos su recepción.
    if (this.pendingReceptionOrder()) {
      this._executeCreateReceivePay(true, false);
      return;
    }

    const userId = this.authFacade.getUserId() || 0;
    // QUI-645: baja al carrito el margen/precio fijado en el modal para los
    // productos nuevos, antes de armar el payload.
    this.applyNewProductPricing();
    const request = cartToPurchaseOrderRequest(state, userId, undefined);
    request.status = 'approved';
    // QUI-647: adjunta la configuración de pago elegida en el modal.
    this.attachPaymentPlan(request);
    // F1: mapea el contenido por envase capturado → purchase_to_stock_factor.
    this.attachPurchaseToStockFactor(request, state);
    // QUI-648: unidad de venta configurada en el modal.
    this.attachSaleUnitConfig(request, state);

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
        this.toastService.error(
          this._errorMessage(error, 'Error al enviar la orden'),
        );
      },
    });
  }

  /**
   * PASO 3 — Orquestación de efectos individuales para "Crear y Recibir".
   * SIEMPRE crea la OC (aprobada); luego, opcionalmente y en este orden:
   *   1. recibir → remisión de entrada (createPurchaseReceipt→confirm→receive)
   *   2. pagar   → registerPurchaseOrderPayment (total, hoy, método 'cash')
   * Cada efecto es individual: doReceive=false + doPay=true crea + paga sin
   * recibir (anticipo — la contabilidad correcta la maneja el backend); ambos
   * false equivale a crear. `doPay` lo deriva `onOrderConfirmed` del plan de
   * pago (solo `immediate` registra aquí; `partial` viaja como anticipo en el
   * payload de creación). Encadenado con switchMap; errores por etapa con
   * toasts claros. Si la OC ya existe, limpia carrito y navega igual.
   */
  private _executeCreateReceivePay(doReceive: boolean, doPay: boolean): void {
    const state = this.popCartService.currentState;

    // Snapshot del total del carrito ANTES de limpiar: respaldo del monto de
    // pago si la respuesta de la OC no trae `total_amount`.
    const cartTotal = Number(state.summary?.total) || 0;

    // Reintento en contexto: un intento anterior YA creó la OC y solo falló la
    // recepción. Reanudamos desde la etapa de recepción — crear otra OC
    // duplicaría la compra (el carrito sobrevive al fallo, así que el operador
    // puede volver a pulsar el botón).
    const pendingOrder = this.pendingReceptionOrder();

    // Nos permite distinguir en el error si la OC llegó a crearse (limpiar
    // carrito) o si falló la creación (conservar carrito para reintentar).
    let createdOrder: any = pendingOrder;

    const order$: Observable<any> = pendingOrder
      ? of(pendingOrder)
      : this._createApprovedOrder$(state);

    this.toastService.info(
      pendingOrder
        ? 'Reintentando la recepción de la orden ya creada...'
        : this._buildProgressMessage(doReceive, doPay),
    );
    this.isProcessingOrder.set(true);

    order$
      .pipe(
        switchMap((order) => {
          createdOrder = order;

          // Etapa recepción (por remisión de entrada, único camino). El error
          // original viaja junto al marcador de etapa: descartarlo dejaba al
          // operador con un mensaje genérico y el motivo real solo en consola.
          const reception$: Observable<unknown> = doReceive
            ? this._buildReceptionViaDispatch$(order).pipe(
                catchError((err) =>
                  throwError(() => ({ stage: 'receive' as const, err })),
                ),
              )
            : of(null);

          // Etapa pago (tras crear y, si aplica, tras recibir).
          return reception$.pipe(
            switchMap(() => {
              if (!doPay) return of(null);
              const amount =
                Number(order.total_amount) > 0
                  ? Number(order.total_amount)
                  : cartTotal;
              return this.purchaseOrdersService
                .registerPurchaseOrderPayment(order.id, {
                  amount,
                  payment_date: this._todayISO(),
                  // TODO: leer el método de pago por defecto de store_settings
                  // si existe; por ahora 'cash'.
                  payment_method: 'cash',
                })
                .pipe(
                  catchError((err) =>
                    throwError(() => ({ stage: 'pay' as const, err })),
                  ),
                );
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.isProcessingOrder.set(false);
          this.toastService.success(this._buildSuccessMessage(doReceive, doPay));
          this._finalizeAfterOrder();
        },
        error: (err: any) => {
          console.error('Error in create/receive/pay flow:', err);
          this.isProcessingOrder.set(false);
          const stage = err?.stage;
          if (stage === 'create' || !createdOrder) {
            // La OC no se creó → no limpiamos el carrito (permite reintentar).
            this.toastService.error(
              this._errorMessage(err?.err ?? err, 'Error al crear la orden'),
            );
            return;
          }
          if (stage === 'receive') {
            // La OC existe pero la mercancía NO entró. Conservamos carrito y
            // ruta (nada de `_finalizeAfterOrder`): una recepción fallida no
            // puede parecer una operación completada. Recordamos la OC para
            // que el reintento no cree una segunda.
            this.pendingReceptionOrder.set(createdOrder);
            this.toastService.error(
              this._errorMessage(
                err?.err,
                'Orden creada pero hubo error al recibir por remisión',
              ),
            );
            return;
          }
          if (stage === 'pay') {
            this.toastService.error(
              this._errorMessage(
                err?.err,
                'Orden creada pero hubo error al registrar el pago',
              ),
            );
          } else {
            this.toastService.error(
              'Orden creada pero una etapa posterior falló',
            );
          }
          // La OC existe y la mercancía ya entró: limpiamos y navegamos como el
          // flujo previo.
          this._finalizeAfterOrder();
        },
      });
  }

  /**
   * Crea la OC aprobada a partir del carrito. Lanza `{ stage: 'create' }`
   * cuando el backend responde sin `data`, para que el manejador de error
   * conserve el carrito y permita reintentar.
   */
  private _createApprovedOrder$(state: PopCartState): Observable<any> {
    const userId = this.authFacade.getUserId() || 0;
    // QUI-645: baja al carrito el margen/precio que el operador fijó en el
    // modal para los productos nuevos, antes de armar el payload.
    this.applyNewProductPricing();
    const request = cartToPurchaseOrderRequest(state, userId, undefined);
    request.status = 'approved';
    // QUI-647: adjunta la configuración de pago elegida en el modal.
    this.attachPaymentPlan(request);
    // F1: mapea el contenido por envase capturado → purchase_to_stock_factor.
    this.attachPurchaseToStockFactor(request, state);
    // QUI-648: unidad de venta configurada en el modal.
    this.attachSaleUnitConfig(request, state);

    return this.purchaseOrdersService.createPurchaseOrder(request).pipe(
      switchMap((response) =>
        response.success && response.data
          ? of(response.data)
          : throwError(() => ({ stage: 'create' as const })),
      ),
    );
  }

  /**
   * QUI-486 — Normaliza el error de `PurchaseOrdersService` a un mensaje legible.
   *
   * `PurchaseOrdersService.handleError` ya extrae `error.error.message` y
   * re-lanza un **string plano**, no el `HttpErrorResponse`. Sobre un string,
   * `err.error?.message` y `err.message` son `undefined`, así que la cadena
   * `err?.error?.message || err?.message || fallback` caía SIEMPRE al fallback
   * genérico y sepultaba el motivo real del backend (p. ej. `PO_VARIANT_001`:
   * "el producto tiene variantes y debes seleccionar cuál estás comprando").
   *
   * Se contemplan ambas formas porque no todos los errores del flujo pasan por
   * el servicio: los de etapa (`{ stage: 'receive' }`) se lanzan dentro del pipe.
   */
  private _errorMessage(err: unknown, fallback: string): string {
    if (typeof err === 'string' && err.trim()) return err;
    const e = err as { error?: { message?: string }; message?: string } | null;
    return e?.error?.message || e?.message || fallback;
  }

  /** Mensaje de progreso (toast info) según los efectos elegidos. */
  private _buildProgressMessage(doReceive: boolean, doPay: boolean): string {
    if (doReceive && doPay)
      return 'Creando orden, remisión de entrada y registrando pago...';
    if (doReceive) return 'Creando orden y remisión de entrada...';
    if (doPay) return 'Creando orden y registrando pago...';
    return 'Creando orden...';
  }

  /** Mensaje de éxito (toast success) según los efectos ejecutados. */
  private _buildSuccessMessage(doReceive: boolean, doPay: boolean): string {
    if (doReceive && doPay)
      return 'Orden creada, recibida por remisión y pagada';
    if (doReceive) return 'Stock ingresado por remisión correctamente';
    if (doPay) return 'Orden creada y pago registrado';
    return 'Orden creada exitosamente';
  }

  /**
   * Cadena de recepción POR REMISIÓN de entrada (único camino de recepción;
   * ya no existe recepción directa). Emite una remisión de compra (entrada)
   * enlazada a la OC vía `purchase_order_id`, la confirma y la recibe. El
   * backend delega en `PurchaseOrdersService.receive`.
   *
   * QUI-425 — El backend amplió `CreateDispatchNoteItemDto` para aceptar
   * `new_base_price?`/`new_profit_margin?` opcionales, persistirlos y
   * propagarlos a `receive()`. Por eso ahora SÍ adjuntamos los pricingOverrides
   * por línea (mismo patrón condicional que el receive directo): solo cuando
   * están definidos, para no forzar el path de pricing en el backend cuando el
   * operador ancla el costo (sin override).
   */
  private _buildReceptionViaDispatch$(order: any): Observable<unknown> {
    const orderItems = order.purchase_order_items || [];

    // Overrides de precio/margen keyed por `${product_id}-${variant_id || 0}`
    // (mismo shape que usa el modal de confirmación).
    const overrides = this.pricingOverrides();

    const items = orderItems.map((item: any) => {
      const key = `${item.product_id}-${item.product_variant_id || 0}`;
      const lineOverride = overrides?.get(key);
      return {
        product_id: item.product_id,
        product_variant_id: item.product_variant_id ?? undefined,
        location_id: order.location_id,
        ordered_quantity: item.quantity_ordered,
        dispatched_quantity: item.quantity_ordered,
        // `purchase_order_items.unit_cost` es Decimal(12,4) y guarda el neto sin
        // redondear (p. ej. 840.3361 para una línea de 1000 con IVA 19%
        // incluido). El destino `dispatch_note_items.unit_price` es
        // Decimal(12,2): redondeamos aquí para no mandar decimales que la
        // columna no admite. (`purchase_order_items` no tiene `unit_price`, así
        // que este valor SIEMPRE sale de `unit_cost`.)
        unit_price: this._round2(item.unit_price ?? item.unit_cost ?? 0),
        purchase_order_item_id: item.id,
        // Solo adjuntar cuando esté definido — el backend aplica el ancla-a-costo
        // por defecto cuando AMBOS campos están ausentes. Se redondean porque el
        // modal reenvía el valor tipeado por el operador tal cual (el derivado ya
        // viene a 2 decimales, el tipeado no).
        ...(lineOverride?.new_base_price !== undefined && {
          new_base_price: this._round2(lineOverride.new_base_price),
        }),
        ...(lineOverride?.new_profit_margin !== undefined && {
          new_profit_margin: this._round2(lineOverride.new_profit_margin),
        }),
      };
    });

    // Inbound purchase_receipt destination is `to_location_id` (the only
    // location key whitelisted on CreatePurchaseReceiptDispatchDto);
    // `dispatch_location_id` would trip `forbidNonWhitelisted` (400).
    const dto = {
      direction: 'inbound',
      subtype: 'purchase_receipt',
      reason: 'normal_purchase',
      supplier_id: order.supplier_id,
      purchase_order_id: order.id,
      to_location_id: order.location_id,
      items,
    } as any;

    return this.dispatchNotesService.createPurchaseReceipt(dto).pipe(
      switchMap((dn) =>
        this.dispatchNotesService.confirm(dn.id).pipe(map(() => dn)),
      ),
      switchMap((dn) => this.dispatchNotesService.receive(dn.id)),
    );
  }

  /** Redondeo a 2 decimales para valores que viajan a una columna Decimal(x,2). */
  private _round2(v: number | string): number {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }

  /** Cierre común tras crear/recibir/pagar: limpia overrides + carrito y navega. */
  private _finalizeAfterOrder(): void {
    this.pricingOverrides.set(new Map());
    this.pendingReceptionOrder.set(null);
    this.popCartService
      .clearCart()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
    this.router.navigate(['/admin/products']);
  }

  /** Fecha de hoy en formato YYYY-MM-DD (hora local) para el pago. */
  private _todayISO(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * F1 (contenido por envase): adjunta `purchase_to_stock_factor` a cada línea
   * del request de orden. El `pop-cart.service` arma el `PopCartItem` con
   * campos explícitos (no propaga columnas nuevas top-level), así que el factor
   * viaja dentro de `prebulk_data.contentPerPackage` (productos nuevos = flujo
   * principal de alta de insumo). Aquí lo leemos por índice (mapeo 1:1 con
   * `cartToPurchaseOrderRequest`) y lo escribimos con el nombre EXACTO que
   * espera el backend. Solo se adjunta con un contenido válido (>=1); en el
   * resto el backend deriva el factor por UoM (misma dimensión).
   */
  private attachPurchaseToStockFactor(
    request: CreatePurchaseOrderRequest,
    state: PopCartState,
  ): void {
    request.items.forEach((reqItem, i) => {
      const cartItem: any = state.items[i];
      if (!cartItem) return;
      const raw =
        cartItem.prebulk_data?.contentPerPackage ?? cartItem.contentPerPackage;
      const content = Number(raw);
      if (Number.isFinite(content) && content >= 1) {
        (reqItem as any).purchase_to_stock_factor = Math.round(content);
      }
    });
  }

  /**
   * QUI-648: mapea la unidad de venta capturada en el modal → campos
   * `sale_unit_*` del ítem de compra. El backend usa `sale_unit_name` como
   * interruptor: sin nombre no configura nada.
   *
   * Mismo patrón que `attachPurchaseToStockFactor`: el carrito copia
   * `prebulk_data` completo, así que el dato puede venir de ahí o del ítem.
   */
  private attachSaleUnitConfig(
    request: CreatePurchaseOrderRequest,
    state: PopCartState,
  ): void {
    request.items.forEach((reqItem, i) => {
      const cartItem: any = state.items[i];
      if (!cartItem) return;
      const source = cartItem.prebulk_data ?? cartItem;
      const name = String(source.sale_unit_name ?? '').trim();
      if (!name) return;

      const target = reqItem as any;
      target.sale_unit_name = name;
      const factor = Number(source.sale_unit_units_per_package);
      if (Number.isFinite(factor) && factor >= 2) {
        target.sale_unit_units_per_package = Math.round(factor);
      }
      const price = Number(source.sale_unit_price);
      if (Number.isFinite(price) && price > 0) {
        target.sale_unit_price = price;
      }
      const margin = Number(source.sale_unit_profit_margin);
      if (Number.isFinite(margin)) {
        target.sale_unit_profit_margin = margin;
      }
      if (source.sale_unit_is_default === true) {
        target.sale_unit_is_default = true;
      }
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
