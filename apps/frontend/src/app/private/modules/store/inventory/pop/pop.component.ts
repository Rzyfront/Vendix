import {Component, OnInit, OnDestroy, ViewChild, signal, computed, HostListener, DestroyRef, inject, viewChild, effect} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subscription, firstValueFrom, of, throwError } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';

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
import { PopOrderConfirmationModalComponent } from './components/pop-checkout-shell/pop-order-confirmation-modal/pop-order-confirmation-modal.component';
import { PopPricingOverridesMap } from './components/pop-checkout-shell/steps/pop-receive-step.component';
import { InvoiceScannerModalComponent } from './components/invoice-scanner/invoice-scanner-modal.component';
import {
  InvoiceScanResult,
  InvoiceMatchResult,
  MatchedLineItem,
} from './interfaces/invoice-scanner.interface';
import {
  PopCostPreviewItem,
  PopCostPreviewRequest,
  PopCostPreviewRequestItem,
  PopCostPreviewResponse,
  PopShippingAllocation,
} from './interfaces';
import {
  PopProductConfigResult,
  PopProductModalResult,
} from './interfaces/pop-cart.interface';
import { POP_USE_UNIFIED_MODAL } from './pop.config';
import { toLocalDateString } from '../../../../../shared/utils/date.util';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
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

    <app-pop-lot-modal
      [(isOpen)]="lotModalOpen"
      [initialLotInfo]="currentLotInfo"
      (save)="onLotSave($event)"
      (skip)="onLotSkip()"
    ></app-pop-lot-modal>

    <!-- El checkout shell va ANTES de los quick-create para que el orden del
         DOM no los tape: app-modal monta fixed inset-0 z-[9999], todos los
         modales comparten z-index, y gana quien aparece MÁS TARDE en el
         template. El shell abre primero en flujo y debe quedar por debajo de
         los quick-create de proveedor/bodega cuando se disparan desde el
         paso Configuración. -->
    <app-pop-checkout-shell
      [isOpen]="showOrderConfirmModal()"
      (isOpenChange)="showOrderConfirmModal.set($event)"
      [cartState]="cartState()"
      [supplierName]="currentSupplierName"
      [locationName]="currentLocationName"
      [actionType]="confirmOrderAction"
      [costPreview]="costPreview()"
      [loadingCostPreview]="loadingCostPreview()"
      [costPreviewError]="costPreviewError()"
      [isProcessing]="isProcessingOrder()"
      [retryOrderRef]="retryOrderRef()"
      [orderResult]="orderResult()"
      [orderError]="orderError()"
      [needsConfig]="shellNeedsConfig()"
      [supplierOptions]="shellSupplierOptions()"
      [locationOptions]="shellLocationOptions()"
      [shippingMethodOptions]="shellShippingMethodOptions"
      [minExpectedDate]="shellMinExpectedDate()"
      [selectedSupplierId]="cartState()?.supplierId ?? null"
      [selectedLocationId]="cartState()?.locationId ?? null"
      [orderDate]="shellOrderDate()"
      [expectedDate]="shellExpectedDate()"
      [shippingMethod]="shellShippingMethod()"
      [shippingCost]="shellShippingCost()"
      [shippingCostAllocation]="shellShippingCostAllocation()"
      (confirmed)="onOrderConfirmed()"
      (cancelled)="showOrderConfirmModal.set(false)"
      (navigateToSettings)="onNavigateToSettings()"
      (retryOrder)="onOrderConfirmed()"
      (pricingOverridesChange)="onPricingOverridesChange($event)"
      (ackReceiveChange)="ackReceive.set($event)"
      (paymentPlanChange)="paymentPlan.set($event)"
      (configComplete)="loadCostPreview()"
      (configSupplierChange)="onShellSupplierChange($event)"
      (configLocationChange)="onShellLocationChange($event)"
      (configOrderDateChange)="onShellOrderDateChange($event)"
      (configExpectedDateChange)="onShellExpectedDateChange($event)"
      (configShippingMethodChange)="onShellShippingMethodChange($event)"
      (configShippingCostChange)="onShellShippingCostChange($event)"
      (configShippingCostAllocationChange)="onShellShippingCostAllocationChange($event)"
      (retryCostPreview)="loadCostPreview()"
      (navigateToFiscalWizard)="onNavigateToFiscalWizard($event)"
      (configOpenSupplierModal)="supplierModalOpen.set(true)"
      (configOpenWarehouseModal)="warehouseModalOpen.set(true)"
    ></app-pop-checkout-shell>

    <!--
      CP-ID-VNDX-2026-08-21-POP-MODAL — Modal standalone post-creación.
      Aparece SOLO en éxito pleno (sin failedStage). El wizard se baja
      automáticamente vía el effect del constructor (en cuanto orderResult
      es no-null y sin failedStage), así que NO hay stack: el modal
      reemplaza al wizard, no se monta encima. El cierre del modal (X,
      overlay, ESC) re-emplea «Nueva compra» para no obligar al operador
      a elegir ruta.
    -->
    <app-pop-order-confirmation-modal
      [isOpen]="!!orderResult() && !orderResult()?.failedStage"
      [orderNumber]="orderResult()?.orderNumber ?? ''"
      [total]="orderResult()?.total ?? 0"
      [state]="orderResult()?.state ?? ''"
      [orderId]="orderResult()?.id ?? null"
      (newPurchase)="onNewPurchase()"
      (viewOrder)="onViewOrder()"
    ></app-pop-order-confirmation-modal>

    <!-- Quick-create de proveedor/bodega: AFTER el shell para que el orden
         del DOM los deje ARRIBA del wizard (z-index 9999 compartido, gana
         quien aparece después). El handler refresca las listas del shell
         tras crear: ver onSupplierCreated y onWarehouseCreated. -->
    <app-pop-supplier-quick-create
      [(isOpen)]="supplierModalOpen"
      (supplierCreated)="onSupplierCreated($event)"
    ></app-pop-supplier-quick-create>

    <app-pop-warehouse-quick-create
      [(isOpen)]="warehouseModalOpen"
      (warehouseCreated)="onWarehouseCreated($event)"
    ></app-pop-warehouse-quick-create>

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
   * CP-ID-VNDX-2026-08-18-PO-PROD — F2.S6: resultado post-creación.
   * `orderResult` se popula cuando el POST de la OC termina OK; el shell
   * renderiza un panel `app-success` con el id y un botón "Ver detalle"
   * que navega a /admin/orders/purchase-orders/:id (en lugar de
   * /admin/products como antes).
   *
   * 5.3 — La forma se extiende con `stages[]` para que el shell pueda
   * pintar el estado por etapa (creada / recibida / pagada con su icono)
   * cuando la cadena `create → receive → pay` falla a MITAD. Sin esto el
   * panel aparecía verde aunque el pago no se hubiera registrado.
   */
  readonly orderResult = signal<{
    id: number;
    total: number;
    orderNumber: string;
    /**
     * CP-ID-VNDX-2026-08-21-POP-MODAL — Estado backend de la OC. Lo usa el
     * modal post-creación para mapear a una etiqueta legible + variante de
     * badge.
     *
     * CP-PURCHASE-TRANSPARENCY (T2/D.2) — es SIEMPRE un valor de
     * `purchase_order_status_enum` (`draft | approved | partial | received |
     * cancelled`), releído del servidor DESPUÉS de recibir y pagar (ver
     * `_readOrderStatus$`). Antes se congelaba el estado que devolvía la
     * creación: una compra con recepción inmediata terminaba en `received` en
     * base de datos y el modal anunciaba «Aprobada», invitando al operador a
     * recibirla otra vez. Vacío significa «el servidor no lo informó», y el
     * modal lo dice en esas palabras en vez de elegir un estado.
     */
    state?: string;
    stages?: Array<{
      name: 'create' | 'receive' | 'pay';
      label: string;
      status: 'success' | 'failed' | 'skipped';
      errorMessage?: string;
    }>;
    failedStage?: 'create' | 'receive' | 'pay';
  } | null>(null);
  readonly orderError = signal<string | null>(null);

  /**
   * QUI-647 — snapshot de "el POP no estaba configurado (sin proveedor/bodega)"
   * al ABRIR el wizard. Mientras sea true, el shell arranca en el paso 1
   * Configuración. Se congela en la apertura (no se recalcula en vivo), así el
   * paso Configuración no desaparece del stepper al elegir proveedor a mitad
   * de sesión; en la siguiente apertura se re-evalúa desde el carrito.
   */
  readonly shellNeedsConfig = signal(false);

  /** Opciones del paso Configuración del wizard (dueño de data: pop-header).
   *  Usamos el signal `headerRef()` para registrar el ViewChild como dep del
   *  computed: cuando Angular resuelve el header, el signal cambia, el computed
   *  re-corre, y entonces `header.supplierOptions()` se lee y queda registrado.
   *  Sin esto el optional-chain `?.` cortocircuitaba en la primera evaluación
   *  (header todavía undefined) y las options nunca se enteraban de la
   *  actualización que traía el backend. */
  readonly shellSupplierOptions = computed<SelectorOption[]>(() => {
    const header = this.headerRef();
    return header ? header.supplierOptions() : [];
  });
  readonly shellLocationOptions = computed<SelectorOption[]>(() => {
    const header = this.headerRef();
    return header ? header.locationOptions() : [];
  });
  readonly shellShippingMethodOptions = SHIPPING_METHOD_OPTIONS;

  /**
   * A.13 — método de envío VIVO del carrito.
   *
   * El shell montaba sin esta entrada, así que el paso Configuración
   * re-sembraba `'pickup'` en cada apertura y pisaba lo que el carrito ya
   * tenía. Con flete elegido, esa re-siembra borraba silenciosamente el modo
   * de envío antes de que el operador llegara a Confirmación.
   */
  readonly shellShippingMethod = computed<string>(
    () => this.cartState()?.shippingMethod ?? 'pickup',
  );
  readonly shellShippingCost = computed<number>(
    () => Number(this.cartState()?.shippingCost ?? 0) || 0,
  );
  readonly shellShippingCostAllocation = computed<
    PopShippingAllocation | undefined
  >(() => this.cartState()?.shippingCostAllocation);

  /** Fechas del carrito en formato YYYY-MM-DD para los inputs date del wizard. */
  readonly shellOrderDate = computed<string>(() => {
    const fromCart = this.toISODate(this.cartState()?.orderDate);
    if (fromCart) return fromCart;
    // Fallback al abrir el wizard antes de que la suscripción del carrito
    // haya propagado estado (cartState() todavía es null). Garantiza que el
    // input date no quede vacío en el primer render del paso Configuración.
    return toLocalDateString(new Date());
  });
  readonly shellExpectedDate = computed<string>(() => {
    const fromCart = this.toISODate(this.cartState()?.expectedDate);
    if (fromCart) return fromCart;
    // Fecha de entrega por defecto: misma fecha que la orden (el operador puede
    // moverla libremente; el shell la bloquea con `minExpectedDate`).
    return toLocalDateString(new Date());
  });
  /**
   * Floor para el input de fecha esperada: si llega vacía cae al día actual
   * (Zoneless ya exige que el `<input type="date" [min]>` sea siempre un
   * YYYY-MM-DD válido, nunca '' que el navegador interpreta como "sin mínimo").
   */
  readonly shellMinExpectedDate = computed<string>(() => {
    const order = this.toISODate(this.cartState()?.orderDate);
    return order || toLocalDateString(new Date());
  });

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

  costPreview = signal<PopCostPreviewResponse | null>(null);
  loadingCostPreview = signal(false);
  /**
   * A.5 — motivo del fallo de la vista previa, para PINTARLO.
   *
   * Antes el `error:` del preview caía en un catch mudo que dejaba
   * `costPreview` en null: el paso Recepción se veía vacío, indistinguible de
   * «esta compra no mueve inventario», y el operador confirmaba una recepción
   * sin haber visto jamás el costo que se iba a sellar. Mientras este signal
   * tenga valor el shell bloquea «Confirmar».
   */
  readonly costPreviewError = signal<string | null>(null);
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
  ) {
    // CP-ID-VNDX-2026-08-21-POP-MODAL — Bajar el wizard cuando llega un
    // resultado pleno (no failedStage). El modal deriva su `isOpen` de
    // `orderResult()`, así que aparece en cuanto el POST termina OK; el
    // wizard, en cambio, sigue abierto hasta que cerremos
    // `showOrderConfirmModal` explícitamente. Sin este effect, el modal
    // queda apilado encima del wizard (doble-modal). El effect es
    // idempotente: set(false) cuando ya está false no hace nada, y en
    // transiciones a null tampoco (cerrar el wizard de un éxito previo
    // sería regresión).
    effect(() => {
      const result = this.orderResult();
      if (result && !result.failedStage) {
        this.showOrderConfirmModal.set(false);
      }
    });
  }

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
    //
    // REVIERTE a propósito el comportamiento "3.4": ya NO se llama
    // `setPricesIncludeTax(true)` cuando la IA declara "precios con IVA
    // incluido". El payload del escáner llega en NETO —`normalizeOcrResponse`
    // ya aplanó `unit_price` y `discount_amount`—, así que declarar ese modo en
    // la cabecera del carrito afirma que el IVA está DENTRO de un número que ya
    // no lo tiene, y el backend se lo restaría por segunda vez: el costo que se
    // capitaliza al inventario baja ~16% sin que nadie lo pida.
    //
    // El dato declarado no se pierde: viaja como texto informativo a la nota de
    // la orden (ver más abajo), donde documenta la factura sin alterar ninguna
    // cifra.
    const invoiceDeclaredIncludeTax =
      data.scanResult?.prices_include_tax === true;
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
    // El descuento POR LÍNEA no pasa por acá: viaja en cada `editedItems` como
    // MONTO y entra al carrito tal cual, sin convertirse a porcentaje. Nunca se
    // reportan los dos sobre el mismo dinero — el prompt lo prohíbe
    // explícitamente.
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
      // SIEMPRE modo adicional, también para las líneas exentas (rate 0).
      // La rama que preservaba `scanResult.prices_include_tax` para esas líneas
      // marcaba "IVA incluido" sobre un precio que `normalizeOcrResponse` ya
      // había dejado en neto. En una línea exenta no cambia el número hoy, pero
      // deja el flag persistido y armado: basta que alguien le ponga tasa a esa
      // línea para que el IVA se extraiga de un precio que no lo contiene.
      const scannedIncludeMode = false;

      // El descuento viaja como PORCENTAJE y nada más. En este punto no se
      // convierte, no se prorratea y no se resta: se copia el mismo número que
      // el operador acaba de ver y aprobar en la precarga al campo de descuento
      // de la línea del carrito. Si la factura dice 5%, el carrito dice 5.
      //
      // Todo lo que vivía aquí antes —convertir pesos a porcentaje con
      // `Math.round`, clampar a 1% cuando el redondeo daba 0, y empujar el
      // residuo al descuento de CABECERA— movía dinero entre líneas al
      // prorratearse, y las capas de costo FIFO se escriben por línea. El
      // porcentaje no tiene ese problema: es invariante a la base y a la
      // cantidad, así que copiarlo tal cual es exacto y además es lo que el
      // operador puede cotejar de un vistazo contra el papel.
      const scannedDiscountPct = Math.min(
        100,
        Math.max(0, Math.round(Number(item.discount_percentage) || 0)),
      );

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
            // Solo el porcentaje. `discount_amount` se deja fuera a propósito:
            // si viajara con valor ganaría por precedencia en `deriveLineTax` y
            // el % que muestra el carrito dejaría de ser el que se aplica.
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
            // También en el producto NUEVO: el descuento no depende de que el
            // producto exista en el catálogo, depende de lo que imprimió la
            // factura. Mismo porcentaje, misma vía.
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

    // El número de factura y —cuando la IA lo declaró— el modo de precios de
    // la factura quedan en la nota. El modo ya no se usa como flag del carrito
    // (el payload viene en neto), pero perderlo del todo dejaría sin rastro un
    // dato que el operador puede necesitar al conciliar contra el papel.
    const invoiceNoteLines: string[] = [];
    if (data.invoiceNumber) {
      invoiceNoteLines.push(`Factura escaneada: ${data.invoiceNumber}`);
    }
    if (invoiceDeclaredIncludeTax) {
      invoiceNoteLines.push(
        'La factura declara precios con IVA incluido; los importes se capturaron en neto.',
      );
    }
    if (invoiceNoteLines.length > 0) {
      const currentNotes = this.popCartService.currentState.notes || '';
      const invoiceNote = invoiceNoteLines.join('\n');
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
      barcode: event.prebulkData.barcode,
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

  @ViewChild(PopProductSelectionComponent)
  productSelection!: PopProductSelectionComponent;

  /**
   * ViewChild reactivo del header. Usar la forma `viewChild(...)` (signal) en
   * lugar del decorador `@ViewChild` era el bug raíz del modal de Configuración:
   * el computed `shellSupplierOptions` dependía del short-circuit
   * `this.header?.supplierOptions()` que, cuando el header aún era `undefined`
   * en la primera evaluación, dejaba `supplierOptions` FUERA de los deps y la
   * signal nunca notificaba al computed cuando llegaba. El pop-header tiene
   * `supplierOptions` y `locationOptions` como signals, así que la forma signal
   * del query propaga la dependencia del ViewChild Y de los options al
   * computed, y el wizard muestra la lista apenas el header termina de
   * hidratar suppliers/locations vía los endpoints del backend.
   */
  private readonly headerRef = viewChild(PopHeaderComponent);

  /** Getter compat para los call-sites imperativos (`this.header.addX(...)`),
   *  templates antiguos (`<app-pop-header #header>`) y referencias dentro de
   *  observables (suscripción sin reactividad). Devuelve `undefined` antes de
   *  que Angular resuelva el ViewChild. */
  get header(): PopHeaderComponent | undefined {
    return this.headerRef();
  }

  onSupplierCreated(supplier: { id: number; name: string; code?: string }): void {
    if (this.header) {
      // Append en memoria: selector lo ve al instante, sin esperar el server.
      this.header.addSupplier(supplier);
      // Forzar reload contra el backend para reconciliar (puede traer registros
      // concurrentes que el header no vio) y propagar al `shellSupplierOptions`
      // del wizard, que re-evalúa porque ya registramos ese signal como dep
      // del computed (ver `headerRef = viewChild(...)`).
      this.header.refreshSuppliers().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    }
    this.popCartService.setSupplier(supplier.id);
  }

  onWarehouseCreated(warehouse: { id: number; name: string; code?: string }): void {
    if (this.header) {
      this.header.addLocation(warehouse);
      this.header.refreshLocations().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    }
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
   * C.5 — flete tecleado en el paso Configuración.
   *
   * El carrito siembra `prorate` en cuanto el monto es > 0 y limpia el modo al
   * volver a 0: el backend responde 400 a `shipping_cost > 0` sin modo, y a
   * `prorate` sin monto. La vista previa se recarga porque el flete prorrateado
   * cambia el costo unitario que el operador va a aprobar.
   */
  onShellShippingCostChange(value: number): void {
    this.popCartService.setShippingCost(value);
    this.loadCostPreview();
  }

  /**
   * CP-PURCHASE-TRANSPARENCY (T2/D.1) — red de seguridad del rechazo.
   *
   * El paso Configuración ya deja el conmutador inactivo sin flete, así que
   * este rechazo no debería ocurrir por la pantalla. Si ocurre por cualquier
   * otra vía, se DICE: `setShippingCostAllocation` devuelve `false` y el
   * operador se entera de que su elección no se guardó, en vez de quedarse con
   * una pantalla que afirma una imputación que el carrito no tiene.
   */
  onShellShippingCostAllocationChange(value: PopShippingAllocation): void {
    const applied = this.popCartService.setShippingCostAllocation(value);
    if (!applied) {
      this.toastService.warning(
        'Escribe primero el costo del flete: sin monto no hay nada que repartir, así que la imputación no se guardó.',
      );
      return;
    }
    this.loadCostPreview();
  }

  /**
   * CTA del aviso fiscal. La ruta la manda el BACKEND en
   * `fiscal_explanation.cta.route`: la pantalla no la inventa, así el destino
   * del asistente se mueve en un solo lugar.
   */
  onNavigateToFiscalWizard(route: string): void {
    if (!route) return;
    this.router.navigate([route]);
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

    // Primera línea a propósito: una apertura NUNCA puede empezar mostrando la
    // valoración de la compra anterior. `loadCostPreview` retorna temprano si
    // no hay bodega o el carrito está vacío, así que sin este reset el paso
    // Recepción pintaba el costo de otra orden como si fuera el de ésta.
    this.costPreview.set(null);
    this.costPreviewError.set(null);

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
    // CP-ID-VNDX-2026-08-18-PO-PROD — F2.S6: NO cerrar el modal antes del POST.
    // Antes `showOrderConfirmModal.set(false)` corría como primera línea y el
    // operador quedaba sin feedback durante el RTT. Ahora el modal se mantiene
    // abierto durante el POST, muestra spinner, y al terminar pinta un panel
    // `app-success` con id + total + botón "Ver detalle".
    this.orderResult.set(null);
    this.orderError.set(null);
    this.isProcessingOrder.set(true);

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

  /**
   * CP-ID-VNDX-2026-08-21-POP-MODAL — El operador eligió «Nueva compra»
   * en el modal de confirmación post-creación. Limpiamos el resultado y
   * vaciamos el carrito para volver a empezar en el taller. La ruta
   * `/admin/inventory/pop` ya está activa (no navegamos): el wizard
   * lo cerró el `effect()` del constructor al poblar `orderResult` con
   * un éxito pleno.
   */
  onNewPurchase(): void {
    this.orderResult.set(null);
    this.orderError.set(null);
    this.popCartService.clearCart().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        /* Ya estamos en /admin/inventory/pop; nada más que hacer. */
      },
      error: (err) => {
        console.error('Error clearing cart after new purchase:', err);
      },
    });
  }

  /**
   * CP-ID-VNDX-2026-08-21-POP-MODAL — El operador eligió «Ver orden».
   * Limpiamos el resultado y el error, y navegamos al detalle de la OC
   * recién creada. Si el id no llegó (caso defensivo), no navegamos.
   */
  onViewOrder(): void {
    const id = this.orderResult()?.id;
    this.orderResult.set(null);
    this.orderError.set(null);
    if (typeof id === 'number' && id > 0) {
      this.router.navigate(['/admin/orders/purchase-orders', id]);
    }
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

  // Público: el template lo invoca desde `(configComplete)` del paso de config.
  loadCostPreview(): void {
    const state = this.popCartService.currentState;
    if (!state.locationId || state.items.length === 0) return;

    this.costPreview.set(null);
    this.costPreviewError.set(null);
    this.loadingCostPreview.set(true);

    // A.5 — la vista previa recibe EXACTAMENTE las mismas entradas que la
    // creación y la recepción. Mandaba sólo bodega + (producto, cantidad,
    // costo): sin descuentos, sin IVA y sin flete la simulación partía de una
    // base que la orden nunca iba a tener, y el operador aprobaba un costo
    // irreproducible. El mapeo por línea replica `cartToPurchaseOrderRequest`
    // a propósito — si divergen, vuelve el defecto que este paso cierra.
    const previewItems: PopCostPreviewRequestItem[] = state.items
      .filter((item) => !item.is_prebulk && item.product?.id)
      .map((item) => ({
        product_id: item.product.id,
        product_variant_id: item.variant?.id,
        quantity: item.quantity,
        unit_cost: item.unit_cost,
        // El maestro `has_vat` gatea la tasa igual que en la creación: sin él
        // la tasa sembrada (19) se colaba y la vista previa mostraba un IVA
        // que la orden no iba a tener.
        tax_rate: state.has_vat ? Number(item.tax_rate) || 0 : 0,
        tax_type: item.tax_type ?? 'iva',
        ...(Number(item.discount) > 0
          ? { discount_percentage: Number(item.discount) }
          : {}),
        ...(Number(item.discount_amount) > 0
          ? { discount_amount: Number(item.discount_amount) }
          : {}),
        ...(state.has_vat && item.prices_include_tax !== undefined
          ? { prices_include_tax: item.prices_include_tax }
          : {}),
      }));

    // Flete a 2 decimales: la columna es `Decimal(12,2)` y el DTO rechaza el
    // tercero con 400.
    const rawShipping = Number(state.shippingCost);
    const shippingCost =
      Number.isFinite(rawShipping) && rawShipping > 0
        ? Math.round(rawShipping * 100) / 100
        : 0;

    // El validador cruzado del backend rechaza «precios con IVA incluido» sin
    // una sola línea gravada. Se exige aquí el mismo `some(tax_rate > 0)` para
    // no mandar una cabecera que se contradice y volver con un 400 sin campo.
    const headerPricesIncludeTax =
      state.has_vat &&
      !!state.prices_include_tax &&
      previewItems.some((it) => Number(it.tax_rate) > 0);

    const request: PopCostPreviewRequest = {
      location_id: state.locationId,
      prices_include_tax: headerPricesIncludeTax,
      discount_amount: Number(state.discountAmount) || 0,
      shipping_cost: shippingCost,
      // `prorate` sin monto también es 400: el modo sólo viaja con flete.
      ...(shippingCost > 0
        ? {
            shipping_cost_allocation:
              state.shippingCostAllocation ?? 'prorate',
          }
        : {}),
      items: previewItems,
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
        newRows.length ? { costing_method: null, items: newRows } : null,
      );
      this.loadingCostPreview.set(false);
      return;
    }

    this.purchaseOrdersService.getCostPreview(request).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        const data = response.success
          ? (response.data as PopCostPreviewResponse | null)
          : null;
        if (!data) {
          // 200 con `success:false`: el backend contestó, pero no hay
          // valoración. Es un fallo, no un «no aplica» — se dice.
          this.costPreviewError.set(
            (response as any)?.message ||
              'El servidor respondió sin datos de valoración.',
          );
          this.costPreview.set(
            newRows.length ? { costing_method: null, items: newRows } : null,
          );
          this.loadingCostPreview.set(false);
          return;
        }
        this.costPreview.set({
          ...data,
          items: [...(data.items ?? []), ...newRows],
        });
        this.loadingCostPreview.set(false);
      },
      error: (err) => {
        // A.5 — el error se PINTA. Las filas de producto nuevo se conservan
        // (no dependen del backend) pero el paso queda marcado como fallido:
        // el shell no deja confirmar mientras `costPreviewError` tenga valor.
        this.costPreviewError.set(
          err?.error?.message ||
            err?.message ||
            'No se pudo calcular la valoración de inventario.',
        );
        this.costPreview.set(
          newRows.length ? { costing_method: null, items: newRows } : null,
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
  private buildNewProductPreviewRows(): PopCostPreviewItem[] {
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
    // A.10 — el `status` ya no viaja en el payload (nacía aprobada a petición
    // del navegador). La orden se crea en borrador y se aprueba con la ACCIÓN
    // de aprobar, que pasa por su permiso y deja `approved_by_user_id`.
    // QUI-647: adjunta la configuración de pago elegida en el modal.
    this.attachPaymentPlan(request);
    // F1: mapea el contenido por envase capturado → purchase_to_stock_factor.
    this.attachPurchaseToStockFactor(request, state);
    // QUI-648: unidad de venta configurada en el modal.
    this.attachSaleUnitConfig(request, state);

    this.purchaseOrdersService.createPurchaseOrder(request).pipe(
      switchMap((response) => {
        if (!response?.success || !response.data) return of(response);
        // La aprobación NO puede tumbar una orden que ya existe: si falla, la
        // orden queda en borrador y se dice con nombre y motivo. Reintentar
        // crearía una segunda compra por la misma factura.
        return this._approveCreatedOrder$(response.data).pipe(
          map((approved) => ({ ...response, data: approved })),
          catchError((err: any) => {
            this.toastService.warning(
              this._errorMessage(
                err?.err,
                'La orden se creó como BORRADOR: no se pudo aprobar',
              ),
            );
            return of(response);
          }),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (response) => {
        // 5.4 — HISTÓRICO: el backend respondía 200/201 con `success:false`
        // porque `responseService.error` RETORNA el sobre en vez de lanzar, y
        // el `if` solo atendía éxito, dejando `isProcessingOrder` atascado.
        // CP-PURCHASE-TRANSPARENCY quitó ese envoltorio de los 24 handlers de
        // compras: un fallo llega ahora por `error:` con su estado HTTP real.
        // La rama `else` de abajo queda como red de seguridad, no como
        // contrato. NO diseñes encima de `success:false`: ya no llega.
        if (response?.success && response.data) {
          // CP-ID-VNDX-2026-08-18-PO-PROD — F2.S6: en lugar de navegar a
          // /admin/products, pintar panel `app-success` con id + total.
          this.toastService.success('Orden creada exitosamente');
          this.popCartService.clearCart().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
          this._setOrderResultFromCreated(response.data);
          this.isProcessingOrder.set(false);
          return;
        }
        // El sobre de éxito viene tipado sin `error` (el backend lo agrega solo
        // al rechazar), así que se lee con el extractor que ya conoce ambas
        // formas en vez de forzar el tipo aquí.
        const envelopeMessage =
          extractApiErrorMessage(response) ||
          'El servidor rechazó la creación de la orden.';
        this.orderError.set(envelopeMessage);
        this.toastService.error(envelopeMessage);
        // Carrito preservado: el operador puede tocar "Reintentar" desde el
        // shell o corregir el formulario.
        this.isProcessingOrder.set(false);
      },
      error: (error) => {
        console.error('Error submitting order:', error);
        this.orderError.set(this._errorMessage(error, 'Error al enviar la orden'));
        this.toastService.error(this.orderError() || 'Error al enviar la orden');
        this.isProcessingOrder.set(false);
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
          const payment$ = reception$.pipe(
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

          // CP-PURCHASE-TRANSPARENCY (T2/D.2) — releer el estado REAL antes de
          // pintar el modal de éxito. `createdOrder` es la foto que dejó la
          // creación (+ aprobación): decía `approved` incluso después de que
          // la recepción hubiera dejado la orden en `received`, y el operador
          // leía «Aprobada» y podía intentar recibirla otra vez. No es
          // inferencia — es el estado que responde el servidor.
          return payment$.pipe(
            switchMap(() => this._readOrderStatus$(createdOrder?.id)),
            tap((status) => {
              if (status && createdOrder) {
                createdOrder = { ...createdOrder, status };
              }
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.isProcessingOrder.set(false);
          // CP-ID-VNDX-2026-08-18-PO-PROD — F2.S6: pintar panel `app-success`
          // también en el flujo create-receive. Antes solo
          // `_executeSubmitOrder` (action='create') populaba `orderResult`,
          // así que al confirmar "Crear y Recibir" el modal se quedaba
          // abierto con el wizard visible aunque la OC ya existía en DB.
          this._setOrderResultFromCreated(createdOrder, {
            stages: this._buildStageTrail(doReceive, doPay, {
              create: 'success',
              receive: doReceive ? 'success' : 'skipped',
              pay: doPay ? 'success' : 'skipped',
            }),
          });
          this.toastService.success(this._buildSuccessMessage(doReceive, doPay));
          this._finalizeAfterOrder();
        },
        error: (err: any) => {
          console.error('Error in create/receive/pay flow:', err);
          this.isProcessingOrder.set(false);
          const stage = err?.stage;
          // La aprobación falló DESPUÉS de crear: la orden existe (en
          // borrador). Se rescata del marcador porque `createdOrder` todavía
          // no se había asignado — sin esto el flujo la daría por no creada y
          // el reintento duplicaría la compra.
          if (stage === 'approve' && err?.order) {
            createdOrder = err.order;
            const approveDetail = this._errorMessage(
              err?.err,
              'La orden se creó como BORRADOR: no se pudo aprobar, así que la mercancía no se recibió',
            );
            this.toastService.error(approveDetail);
            // Se recuerda la OC para que «Reintentar» no cree una segunda: la
            // reanudación intentará recibir y el backend dirá con todas sus
            // letras que un borrador no puede recibirse.
            this.pendingReceptionOrder.set(createdOrder);
            this._setOrderResultFromCreated(createdOrder, {
              stages: this._buildStageTrail(doReceive, doPay, {
                create: 'success',
                receive: 'failed',
                pay: 'skipped',
                receiveError: approveDetail,
              }),
              failedStage: 'receive',
            });
            return;
          }
          if (stage === 'create' || !createdOrder) {
            // La OC no se creó → no limpiamos el carrito (permite reintentar).
            this.toastService.error(
              this._errorMessage(err?.err ?? err, 'Error al crear la orden'),
            );
            return;
          }
          // 5.3 — A partir de acá la OC SÍ existe, así que el panel pasa a
          // estado PARCIAL: pintamos la OC creada con su rastro de etapas
          // y nombramos la que falló para que el operador decida reintentar.
          let failedDetail = '';
          if (stage === 'receive') {
            failedDetail = this._errorMessage(
              err?.err,
              'Orden creada pero hubo error al recibir por remisión',
            );
            this.toastService.error(failedDetail);
            // La OC existe pero la mercancía NO entró. Conservamos carrito y
            // ruta (nada de `_finalizeAfterOrder`): una recepción fallida no
            // puede parecer una operación completada. Recordamos la OC para
            // que el reintento no cree una segunda.
            this.pendingReceptionOrder.set(createdOrder);
            this._setOrderResultFromCreated(createdOrder, {
              stages: this._buildStageTrail(doReceive, doPay, {
                create: 'success',
                receive: 'failed',
                pay: 'skipped',
                receiveError: failedDetail,
              }),
              failedStage: 'receive',
            });
            return;
          }
          if (stage === 'pay') {
            failedDetail = this._errorMessage(
              err?.err,
              'Orden creada pero hubo error al registrar el pago',
            );
            this.toastService.error(failedDetail);
            this._setOrderResultFromCreated(createdOrder, {
              stages: this._buildStageTrail(doReceive, doPay, {
                create: 'success',
                receive: doReceive ? 'success' : 'skipped',
                pay: 'failed',
                payError: failedDetail,
              }),
              failedStage: 'pay',
            });
            this._finalizeAfterOrder();
            return;
          }
          // Etapa desconocida (no debería ocurrir): pintamos parcial genérico
          // para que el operador vea la OC y no la crea perdida.
          failedDetail = 'Orden creada pero una etapa posterior falló';
          this.toastService.error(failedDetail);
          this._setOrderResultFromCreated(createdOrder, {
            stages: this._buildStageTrail(doReceive, doPay, {
              create: 'success',
              receive: doReceive ? 'success' : 'skipped',
              pay: doPay ? 'success' : 'skipped',
            }),
          });
          this._finalizeAfterOrder();
        },
      });
  }

  /**
   * 5.3 — Construye el rastro de etapas para que el shell pueda pintarlo
   * con sus iconos. Las claves `<stage>Error` opcionales adjuntan el motivo
   * de fallo a la entrada correspondiente del rastro.
   */
  private _buildStageTrail(
    doReceive: boolean,
    doPay: boolean,
    statuses: {
      create: 'success' | 'failed' | 'skipped';
      receive: 'success' | 'failed' | 'skipped';
      pay: 'success' | 'failed' | 'skipped';
      receiveError?: string;
      payError?: string;
    },
  ): Array<{
    name: 'create' | 'receive' | 'pay';
    label: string;
    status: 'success' | 'failed' | 'skipped';
    errorMessage?: string;
  }> {
    const trail: Array<{
      name: 'create' | 'receive' | 'pay';
      label: string;
      status: 'success' | 'failed' | 'skipped';
      errorMessage?: string;
    }> = [
      { name: 'create', label: 'Orden creada', status: statuses.create },
    ];
    if (doReceive) {
      trail.push({
        name: 'receive',
        label: 'Mercancía recibida',
        status: statuses.receive,
        errorMessage: statuses.receiveError,
      });
    } else {
      trail.push({ name: 'receive', label: 'Mercancía recibida', status: 'skipped' });
    }
    if (doPay) {
      trail.push({
        name: 'pay',
        label: 'Pago registrado',
        status: statuses.pay,
        errorMessage: statuses.payError,
      });
    } else {
      trail.push({ name: 'pay', label: 'Pago registrado', status: 'skipped' });
    }
    return trail;
  }

  /**
   * CP-ID-VNDX-2026-08-18-PO-PROD — F2.S6: pinta el panel `app-success` del
   * shell con id + total + orderNumber. Se usa tras crear (en `_executeSubmitOrder`
   * y en ambos caminos de `_executeCreateReceivePay`) para que el modal deje
   * de mostrar el wizard y muestre el resultado. Sin esto, el modal se quedaba
   * abierto con el formulario aunque la OC ya existía en DB.
   *
   * 5.3 — Acepta `stages` y `failedStage` para que el shell pueda distinguir
   * éxito pleno de éxito parcial (OC creada pero pago o recepción caídos).
   */
  private _setOrderResultFromCreated(
    order: any,
    extras: {
      stages?: Array<{
        name: 'create' | 'receive' | 'pay';
        label: string;
        status: 'success' | 'failed' | 'skipped';
        errorMessage?: string;
      }>;
      failedStage?: 'create' | 'receive' | 'pay';
    } = {},
  ): void {
    if (!order) return;
    this.orderResult.set({
      id: order.id,
      total: Number(order.total_amount ?? 0),
      orderNumber: order.order_number ?? '',
      // CP-ID-VNDX-2026-08-21-POP-MODAL — el modal pinta este campo en el
      // badge.
      //
      // CP-PURCHASE-TRANSPARENCY (T2/D.2) — `purchase_orders` NO tiene columna
      // `state`; el estado vive en `status`. Se conserva la lectura de `state`
      // por si alguna respuesta lo trae, pero el fallback ya no inventa
      // 'created': un estado ausente se declara ausente.
      state: order.state ?? order.status ?? '',
      ...(extras.stages ? { stages: extras.stages } : {}),
      ...(extras.failedStage ? { failedStage: extras.failedStage } : {}),
    });
  }

  /**
   * A.10 — aprueba la OC recién creada por la VÍA CORRECTA.
   *
   * El payload de creación mandaba `status: 'approved'` y el backend lo
   * escribía tal cual: la orden nacía aprobada a petición del navegador y el
   * permiso `store:orders:purchase_orders:approve` no se consultaba nunca.
   * Ahora la orden nace en borrador y esta etapa la aprueba con
   * `PATCH /:id/approve`, que sí exige el permiso, registra
   * `approved_by_user_id` y deja rastro de auditoría.
   *
   * Lanza `{ stage: 'approve', err, order }` LLEVÁNDOSE la orden creada: sin
   * ella el manejador de error no distinguiría «no se creó» de «se creó y no
   * se aprobó», conservaría el carrito y el reintento crearía una SEGUNDA
   * compra por la misma factura.
   */
  private _approveCreatedOrder$(order: any): Observable<any> {
    const id = Number(order?.id);
    if (!id) return of(order);
    return this.purchaseOrdersService.approvePurchaseOrder(id).pipe(
      switchMap((response) =>
        response?.success && response.data
          ? of(response.data)
          : throwError(() => ({
              stage: 'approve' as const,
              err: response,
              order,
            })),
      ),
      catchError((err: any) =>
        err?.stage === 'approve'
          ? throwError(() => err)
          : throwError(() => ({ stage: 'approve' as const, err, order })),
      ),
    );
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
    // A.10 — sin `status` en el payload: se crea en borrador y se aprueba por
    // la vía que exige el permiso de aprobación (ver `_approveCreatedOrder$`).
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
      // Recibir exige una orden APROBADA (`draft` sólo transita a `approved` o
      // `cancelled`), así que la aprobación es una etapa propia de la cadena.
      switchMap((order) => this._approveCreatedOrder$(order)),
    );
  }

  /**
   * QUI-486 — Normaliza el error de `PurchaseOrdersService` a un mensaje legible.
   *
   * El servicio YA NO aplasta el `HttpErrorResponse` a un string: lo propaga
   * crudo para que el consumidor pueda enrutar por `status` y conservar
   * `error_code`. Acá resolvemos el mensaje UX con `parseApiError` (que
   * desenvaina `HttpErrorResponse` → `error.error` y mapea por código), pero
   * **el encabezado sigue siendo la etapa** (es lo que el operador NECESITA
   * ver primero). El motivo del backend va como detalle debajo.
   *
   * Se contemplan tres formas porque el error puede llegar como:
   *  - `HttpErrorResponse` (vía `PurchaseOrdersService`).
   *  - un marcador `{ stage, err }` lanzado en el pipe de la cadena.
   *  - cualquier `Error` genérico.
   */
  private _errorMessage(err: unknown, fallback: string): string {
    if (typeof err === 'string' && err.trim()) return err;
    const apiMessage = parseApiError(err as any).userMessage;
    // parseApiError SIEMPRE devuelve un mensaje; si es el genérico de fallback
    // y nosotros tenemos stage info, preferimos el nuestro. Si la API nos dio
    // algo específico, lo honramos como detalle.
    if (apiMessage && apiMessage !== 'Error desconocido') {
      // Si el `fallback` ya menciona la etapa, conservamos sufijo con el
      // motivo del backend entre paréntesis (no se rompe el copy existente).
      return `${fallback} (${apiMessage})`;
    }
    return fallback;
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

  /**
   * CP-PURCHASE-TRANSPARENCY (T2/D.2) — estado REAL de la OC leído del
   * servidor tras la cadena `crear → recibir → pagar`.
   *
   * Ni la recepción por remisión ni el registro de pago devuelven la orden:
   * la primera responde la remisión y el segundo el pago. Sin esta relectura
   * el modal se queda con el estado de la creación. Falla en silencio a
   * propósito (`null`): la OC ya existe y el operador tiene que ver su modal
   * — el badge dirá «Sin confirmar» antes que un estado equivocado.
   */
  private _readOrderStatus$(id: unknown): Observable<string | null> {
    const orderId = Number(id);
    if (!orderId) return of(null);
    return this.purchaseOrdersService.getPurchaseOrderById(orderId).pipe(
      map((response: any) => {
        const status = response?.success ? response?.data?.status : null;
        return typeof status === 'string' && status ? status : null;
      }),
      catchError(() => of(null)),
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
    // CP-ID-VNDX-2026-08-18-PO-PROD — F2.S6: ya no navegamos a /products.
    // El panel `app-success` queda pintado en el shell. El usuario decide
    // cuándo cerrarlo (botón "Ver detalle" o "Nueva compra").
    this.isProcessingOrder.set(false);
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
// triggered rebuild at Tue Aug 18 14:43:20 -05 2026
