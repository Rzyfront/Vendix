import {
  Component,
  signal,
  computed,
  effect,
  HostListener,
  inject,
  DestroyRef,
  viewChildren,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';

import { Router, ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';

import {
  ButtonComponent,
  IconComponent,
  ToastService,
  SpinnerComponent,
  CardComponent,
  BadgeComponent,
  DialogService,
  ModalComponent,
  InputComponent,
  SelectorComponent,
  TextareaComponent,
} from '../../../../shared/components';
import type { SelectorOption } from '../../../../shared/components/selector/selector.component';
import { CurrencyFormatService } from '../../../../shared/pipes/currency';
import {
  selectStoreSettings,
  selectUserDomainHostname,
} from '../../../../core/store/auth/auth.selectors';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
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
import { PosOrderService } from './services/pos-order.service';
import { StoreOrdersService } from '../orders/services/store-orders.service';
import { PosStatsComponent } from './components/pos-stats.component';
import { PosProductSelectionComponent } from './components/pos-product-selection.component';
import { PosBarcodeService } from './services/pos-barcode.service';
import {
  PosProductService,
  Product,
  PosProductVariant,
} from './services/pos-product.service';
import { PosCustomerModalComponent } from './components/pos-customer-modal.component';
import { PosPaymentInterfaceComponent } from './components/pos-payment-interface.component';
import { PosOrderConfirmationComponent } from './components/pos-order-confirmation.component';
import { PosCartComponent } from './cart/pos-cart.component';
import { PosMobileFooterComponent } from './components/pos-mobile-footer.component';
import { PosCartModalComponent } from './components/pos-cart-modal.component';
import { PosOrderCreateModalComponent, PosOrderCreateResult } from './components/pos-order-create-modal.component';
import { PosShippingModalComponent } from './components/pos-shipping-modal/pos-shipping-modal.component';
import { StoreSettingsService } from '../settings/general/services/store-settings.service';
import type { BusinessHours } from '../../../../core/models/store-settings.interface';
import { QuotationsService } from '../quotations/services/quotations.service';
import { LayawayApiService } from '../layaway/services/layaway.service';
import { LayawayConfigModalComponent } from './components/layaway-config-modal/layaway-config-modal.component';
import { CreateLayawayRequest } from '../layaway/interfaces/layaway.interface';
import {
  PosCashRegisterService,
  CashRegisterSession,
} from './services/pos-cash-register.service';
import { PosQueueService } from './services/pos-queue.service';
import { PosSessionStatusBarComponent } from './components/pos-session-status-bar.component';
import { PosSessionOpenModalComponent } from './components/pos-session-open-modal.component';
import { PosSessionCloseModalComponent } from './components/pos-session-close-modal.component';
import { PosCashMovementModalComponent } from './components/pos-cash-movement-modal.component';
import { PosSessionDetailModalComponent } from './components/pos-session-detail-modal.component';
import { PosScheduleIndicatorComponent } from './components/pos-schedule-indicator.component';
import { PosScheduleModalComponent } from './components/pos-schedule-modal.component';
import { PosHeaderDropdownComponent } from './components/pos-header-dropdown.component';
import { ReservationFormModalComponent } from '../reservations/components/reservation-form-modal/reservation-form-modal.component';
import { PosAISummaryModalComponent } from './components/pos-ai-summary-modal.component';
import {
  PosRestaurantIntegrationService,
  CounterOrderLine,
} from './services/pos-restaurant-integration.service';
import { TaxesService } from '../products/services/taxes.service';
import { TaxCategory } from '../products/interfaces';

const DEFAULT_CART_SUMMARY: CartSummary = {
  subtotal: 0,
  taxAmount: 0,
  discountAmount: 0,
  total: 0,
  itemCount: 0,
  totalItems: 0,
};

@Component({
  selector: 'app-pos',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    IconComponent,
    ModalComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    SpinnerComponent,
    CardComponent,
    PosStatsComponent,
    PosProductSelectionComponent,
    PosCustomerModalComponent,
    PosPaymentInterfaceComponent,
    PosOrderConfirmationComponent,
    PosCartComponent,
    BadgeComponent,
    PosMobileFooterComponent,
    PosCartModalComponent,
    PosShippingModalComponent,
    PosSessionStatusBarComponent,
    PosSessionOpenModalComponent,
    PosSessionCloseModalComponent,
    PosCashMovementModalComponent,
    PosSessionDetailModalComponent,
    PosScheduleIndicatorComponent,
    PosScheduleModalComponent,
    PosHeaderDropdownComponent,
    LayawayConfigModalComponent,
    ReservationFormModalComponent,
    PosAISummaryModalComponent,
    PosOrderCreateModalComponent,
  ],
  template: `
    <div class="flex flex-col overflow-hidden pos-container">
      <!--
        A/B TEST (2026-06): bloque de stats del POS (app-pos-stats) ocultado como
        prueba A/B. Antes mostraba las stats en desktop fuera de los modos
        cotizacion/separado. Restaurar este bloque tal cual si la metrica de
        conversion lo justifica:
        @if (!isQuotationMode() && !isLayawayMode()) {
          <div class="flex-none hidden lg:block pb-4">
            <app-pos-stats [cartState]="cartState()"></app-pos-stats>
          </div>
        }
      -->


      <!-- Main POS Interface -->
      <div
        class="flex-1 flex flex-col bg-surface rounded-card shadow-card border border-border min-h-0 overflow-hidden"
      >
        <!-- Header -->
        <div
          class="flex-none px-4 lg:px-6 py-2 lg:py-2.5 border-b border-border pos-header relative z-30"
        >
          <div class="flex justify-between items-center" style="gap: 0.75rem;">
            <!-- Left: Logo + Title -->
            <div class="flex items-center" style="gap: 0.5rem;">
              <div
                class="w-10 h-10 lg:w-12 lg:h-12 rounded-xl bg-primary/10 flex items-center justify-center"
              >
                <app-icon
                  name="shopping-bag"
                  [size]="isMobile() ? 20 : 24"
                  class="text-primary"
                ></app-icon>
              </div>
              <div class="flex flex-col leading-none" style="gap: 0;">
                <h1
                  class="font-bold text-text-primary text-base lg:text-lg leading-none flex items-center mb-0"
                  style="gap: 0.5rem;"
                >
                  @if (isQuotationMode()) {
                    <span>Modo Cotización</span>
                  } @else if (isLayawayMode()) {
                    <span>Modo Plan Separé</span>
                  } @else if (isEditMode()) {
                    <span>Editando Orden #{{ editingOrderNumber() }}</span>
                  } @else {
                    <span class="hidden sm:inline">Vendix</span> POS
                  }
                </h1>
                <span class="hidden sm:block leading-none">
                  @if (isQuotationMode()) {
                    <app-badge variant="primary" size="xs"
                      >Crear cotización</app-badge
                    >
                  } @else if (isLayawayMode()) {
                    <app-badge variant="warning" size="xs"
                      >Crear plan separé</app-badge
                    >
                  } @else if (isEditMode()) {
                    <app-badge variant="warning" size="xs"
                      >Modificar items de la orden</app-badge
                    >
                  } @else {
                    <app-badge variant="success" size="xs"
                      >Punto de venta</app-badge
                    >
                  }
                </span>
              </div>
            </div>

            <!-- Right: Customer + Schedule + Cash Register -->
            <div class="flex items-center gap-2 xl:gap-3">
              <!-- Mobile/Tablet/Small desktop: Compact dropdown -->
              <div class="flex xl:hidden">
                <app-pos-header-dropdown
                  [customer]="selectedCustomer()"
                  [scheduleEnabled]="enableScheduleValidation()"
                  [isWithinHours]="!isActuallyOutOfHours()"
                  [isDayClosed]="isTodayClosed"
                  [todayHours]="todaySchedule"
                  [cashSession]="activeSession()"
                  [showCashOpenButton]="cashRegisterEnabled()"
                  (customerClicked)="onOpenCustomerModal()"
                  (clearCustomer)="onClearCustomer()"
                  (scheduleClicked)="showScheduleModal.set(true)"
                  (cashOpenClicked)="showSessionOpenModal.set(true)"
                  (cashCloseClicked)="showSessionCloseModal.set(true)"
                  (cashMovementClicked)="showCashMovementModal.set(true)"
                  (cashDetailClicked)="showSessionDetailModal.set(true)"
                ></app-pos-header-dropdown>
              </div>

              <!-- Desktop: Full expanded view -->
              <div class="hidden xl:flex items-center gap-2 xl:gap-3">
                <!-- Customer Badge -->
                @if (selectedCustomer()) {
                  <div
                    class="group flex items-center gap-2 px-2.5 py-1.5 bg-gradient-to-r from-primary-light/50 to-primary-light/30 rounded-lg cursor-pointer hover:from-primary-light/70 hover:to-primary-light/50 transition-all border border-primary/30 shadow-sm"
                    (click)="onOpenCustomerModal()"
                  >
                    <div
                      class="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-primary flex-shrink-0"
                    >
                      <app-icon name="user" [size]="14"></app-icon>
                    </div>
                    <div class="flex flex-col min-w-0">
                      <span
                        class="font-semibold text-text-primary text-sm leading-none truncate"
                        [title]="selectedCustomer()?.name"
                        >{{ selectedCustomer()?.name }}</span
                      >
                      <span
                        class="text-xs text-text-secondary leading-none truncate mt-0.5"
                        [title]="selectedCustomer()?.email"
                        >{{ selectedCustomer()?.email }}</span
                      >
                    </div>
                    <div
                      class="w-5 h-5 rounded-full hover:bg-surface/60 flex items-center justify-center transition-colors flex-shrink-0"
                      (click)="$event.stopPropagation(); onClearCustomer()"
                    >
                      <app-icon
                        name="x"
                        [size]="12"
                        class="text-text-secondary group-hover:text-destructive transition-colors"
                      ></app-icon>
                    </div>
                  </div>
                }

                <!-- Schedule Indicator -->
                @if (enableScheduleValidation()) {
                  <app-pos-schedule-indicator
                    [isWithinHours]="!isActuallyOutOfHours()"
                    [todayHours]="todaySchedule"
                    [isDayClosed]="isTodayClosed"
                    [enabled]="enableScheduleValidation()"
                    (clicked)="showScheduleModal.set(true)"
                  ></app-pos-schedule-indicator>
                }

                @if (cashRegisterEnabled()) {
                  <app-pos-session-status-bar
                    [session]="activeSession()"
                    [showOpenButton]="true"
                    (openClicked)="showSessionOpenModal.set(true)"
                    (closeClicked)="showSessionCloseModal.set(true)"
                    (movementClicked)="showCashMovementModal.set(true)"
                    (detailClicked)="showSessionDetailModal.set(true)"
                  ></app-pos-session-status-bar>
                }
              </div>
            </div>
          </div>
        </div>

        @if (activeSession()?.register?.location) {
          <div
            class="flex-none px-4 lg:px-6 py-1 bg-blue-50 border-b border-blue-100 text-xs text-blue-600"
          >
            Descontando de: {{ activeSession()!.register!.location!.name }}
          </div>
        }

        <!-- Main Content Grid -->
        <div
          class="flex-1 flex flex-col p-3 lg:p-6 min-h-0 overflow-hidden pos-main-content relative"
        >
          @if (isOutOfHours() && !canBypassSchedule()) {
            <!-- Out of hours overlay -->
            <div
              class="absolute inset-0 z-40 bg-surface/90 backdrop-blur-sm flex items-center justify-center p-4"
            >
              <app-card
                class="max-w-md w-full shadow-xl border-border"
                [padding]="true"
              >
                <div
                  class="flex flex-col items-center text-center py-6 px-4 gap-4"
                >
                  <div
                    class="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center text-destructive mb-2"
                  >
                    <app-icon name="clock" [size]="40"></app-icon>
                  </div>
                  <h2 class="text-2xl font-bold text-text-primary">
                    POS Fuera de Horario
                  </h2>
                  <p class="text-text-secondary text-sm leading-relaxed">
                    {{
                      outOfHoursMessage() ||
                        'El punto de venta está fuera del horario de atención configurado. No se podrán realizar ventas hasta dentro del horario establecido.'
                    }}
                  </p>

                  @if (nextOpenTime()) {
                    <div
                      class="bg-primary/5 border border-primary/20 rounded-xl p-4 w-full mt-2 flex flex-col items-center"
                    >
                      <span
                        class="text-xs text-text-secondary font-medium uppercase tracking-wider mb-1"
                        >Próxima apertura</span
                      >
                      <span class="text-lg font-bold text-primary">{{
                        nextOpenTime()
                      }}</span>
                    </div>
                  }

                  <div
                    class="flex flex-col w-full gap-3 mt-6 pt-6 border-t border-border"
                  >
                    <p class="text-xs text-text-secondary mb-1">
                      ¿Necesitas modificar los horarios?
                    </p>
                    <app-button
                      variant="primary"
                      class="w-full"
                      (clicked)="goToSettings()"
                    >
                      <app-icon
                        name="settings"
                        [size]="18"
                        slot="icon"
                      ></app-icon>
                      Configuración de POS y Horarios
                    </app-button>
                    <app-button
                      variant="outline"
                      class="w-full"
                      (clicked)="goToDashboard()"
                    >
                      Volver al Dashboard
                    </app-button>
                  </div>
                </div>
              </app-card>
            </div>
          }

          <!-- Desktop: Flex layout with sidebar cart -->
          <div class="hidden lg:flex gap-6 flex-1 min-h-0 overflow-hidden">
            <!-- Products Area (Left Side - 2/3) -->
            <div class="flex-[2] min-h-0 min-w-0 overflow-hidden">
              <app-pos-product-selection
                class="h-full block"
                [refreshTrigger]="productRefreshCounter()"
                [selectedCustomer]="selectedCustomer()"
                [queueEnabled]="queueEnabled()"
                [queueCount]="queueCount()"
                (productSelected)="onProductSelected($event)"
                (productAddedToCart)="onProductAddedToCart($event)"
                (bookingRequired)="onBookingRequired($event)"
                (openCustomerModal)="onOpenCustomerModal()"
                (openQueueModal)="onOpenQueueModal()"
              ></app-pos-product-selection>
            </div>

            <!-- Cart Area (Right Side - 1/3) -->
            <div class="flex-1 min-h-0 min-w-0 overflow-hidden">
              <app-pos-cart
                class="h-full block"
                [isEditMode]="isEditMode()"
                [isQuotationMode]="isQuotationMode()"
                [isLayawayMode]="isLayawayMode()"
                (create)="onOpenCreateModal()"
                (shipping)="onShipping()"
                (checkout)="onCheckout()"
                (quote)="onQuote()"
                (layaway)="onLayaway()"
                ></app-pos-cart>
            </div>
          </div>

          <!-- Mobile: Full width products only -->
          <div class="lg:hidden flex-1 min-h-0 pb-20">
            <app-pos-product-selection
              class="h-full block"
              [refreshTrigger]="productRefreshCounter()"
              [selectedCustomer]="selectedCustomer()"
              (productSelected)="onProductSelected($event)"
              (productAddedToCart)="onProductAddedToCart($event)"
              (bookingRequired)="onBookingRequired($event)"
              (openCustomerModal)="onOpenCustomerModal()"
            ></app-pos-product-selection>
          </div>
        </div>
      </div>

      <!-- Mobile Footer (visible on mobile and tablet for sidebar sync) -->
      @if (isMobile() || isTablet()) {
        <app-pos-mobile-footer
          [cartSummary]="cartSummary()"
          [itemCount]="cartItems().length"
          [isTablet]="isTablet()"
          [isQuotationMode]="isQuotationMode()"
          [isLayawayMode]="isLayawayMode()"
          [canCreateCustomItems]="canCreateCustomItems()"
          (viewCart)="onOpenCartModal()"
          (customItem)="openCustomItemModal()"
          (create)="onOpenCreateModal()"
                (shipping)="onShipping()"
          (checkout)="onCheckout()"
          (quote)="onQuote()"
          (layaway)="onLayaway()"
        ></app-pos-mobile-footer>
      }

      <!-- Mobile Cart Modal -->
      <app-pos-cart-modal
        [isOpen]="showCartModal() && (isMobile() || isTablet())"
        [cartState]="cartState()"
        [canCreateCustomItems]="canCreateCustomItems()"
        [canOverridePrices]="canOverridePrices()"
        (closed)="onCloseCartModal()"
        (customItemRequested)="openCustomItemModal()"
        (itemPriceEditRequested)="editItemPriceFromMobile($event)"
        (itemQuantityChanged)="onCartItemQuantityChanged($event)"
        (itemRemoved)="onCartItemRemoved($event)"
        (clearCart)="onClearCart()"
        (shipping)="onShippingFromModal()"
        (checkout)="onCheckoutFromModal()"
      ></app-pos-cart-modal>

      <app-modal
        [isOpen]="customItemModalOpen()"
        title="Ítem personalizado"
        subtitle="Agrega una línea facturable sin afectar inventario"
        size="sm"
        (closed)="closeCustomItemModal()"
      >
        <div class="space-y-4">
          <app-input
            label="Nombre"
            placeholder="Servicio de instalación"
            [ngModel]="customItemDraft().name"
            (ngModelChange)="updateCustomItemDraft('name', $event)"
          ></app-input>

          <app-textarea
            label="Detalle"
            placeholder="Alcance, materiales, condiciones o notas visibles en la orden"
            [rows]="3"
            [ngModel]="customItemDraft().description"
            (ngModelChange)="updateCustomItemDraft('description', $event)"
          ></app-textarea>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <app-input
              label="Cantidad"
              type="number"
              min="1"
              [ngModel]="customItemDraft().quantity"
              (ngModelChange)="updateCustomItemDraft('quantity', $event)"
            ></app-input>

            <app-input
              label="Precio final"
              placeholder="$0"
              min="0"
              [currency]="true"
              [ngModel]="customItemDraft().finalPrice"
              (ngModelChange)="updateCustomItemDraft('finalPrice', $event)"
            ></app-input>
          </div>

          <app-selector
            label="IVA / impuesto"
            helpText="Usa los impuestos configurados para la tienda."
            [options]="taxCategoryOptions()"
            [ngModel]="customItemDraft().taxCategoryId ?? 0"
            (ngModelChange)="updateCustomItemDraft('taxCategoryId', $event)"
          ></app-selector>

          <div
            class="rounded-xl border border-border bg-[var(--color-background)]/60 px-3 py-2 text-xs"
          >
            <div class="flex justify-between">
              <span class="text-text-secondary">Base</span>
              <span class="font-semibold">{{
                formatCurrency(customItemBasePrice())
              }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-text-secondary">IVA / impuesto</span>
              <span class="font-semibold">{{
                formatCurrency(customItemTaxAmount())
              }}</span>
            </div>
            <div
              class="mt-1 flex justify-between border-t border-border/60 pt-1"
            >
              <span class="font-semibold text-text-primary">Total línea</span>
              <span class="font-bold text-[var(--color-primary)]">{{
                formatCurrency(customItemTotal())
              }}</span>
            </div>
          </div>
        </div>

        <div
          slot="footer"
          class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"
        >
          <app-button
            class="w-full sm:w-auto"
            variant="outline"
            size="md"
            customClasses="min-w-[120px]"
            (clicked)="closeCustomItemModal()"
          >
            Cancelar
          </app-button>
          <app-button
            class="w-full sm:w-auto"
            variant="primary"
            size="md"
            customClasses="min-w-[120px]"
            [disabled]="!canSubmitCustomItem()"
            (clicked)="addCustomItemFromMobile()"
          >
            Agregar
          </app-button>
        </div>
      </app-modal>

      <!-- Loading Overlay -->
      @if (loading()) {
        <div
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
      }

      <!-- Modals -->
      <app-pos-customer-modal
        [isOpen]="showCustomerModal()"
        [customer]="editingCustomer()"
        [queueEnabled]="queueEnabled()"
        [openInQueueMode]="openInQueueMode()"
        (closed)="onCustomerModalClosed()"
        (customerCreated)="onCustomerCreated($event)"
        (customerUpdated)="onCustomerUpdated($event)"
        (customerSelected)="onCustomerSelected($event)"
      ></app-pos-customer-modal>

      <app-pos-payment-interface
        [isOpen]="showPaymentModal()"
        [cartState]="cartState()"
        [isRestaurantWithPrepared]="isRestaurantWithPrepared()"
        [tableId]="restaurantIntegration.currentTableSession()?.table_id ?? null"
        (closed)="onPaymentModalClosed()"
        (paymentCompleted)="onPaymentCompleted($event)"
        (requestCustomer)="onOpenCustomerModal()"
        (customerSelected)="onPaymentCustomerSelected($event)"
      ></app-pos-payment-interface>

      <app-pos-shipping-modal
        [isOpen]="showShippingModal()"
        [cartState]="cartState()"
        (closed)="onShippingModalClosed()"
        (shippingCompleted)="onShippingCompleted($event)"
        (customerSelected)="onPaymentCustomerSelected($event)"
      ></app-pos-shipping-modal>

      <app-pos-order-confirmation
        [isOpen]="showOrderConfirmation()"
        [orderData]="completedOrder()"
        (closed)="onOrderConfirmationClosed()"
        (newSale)="onStartNewSale()"
        (viewDetail)="onViewOrderDetail($event)"
      ></app-pos-order-confirmation>

      <!-- Cash Register Modals -->
      @if (cashRegisterEnabled()) {
        @defer (when showSessionOpenModal()) {
          <app-pos-session-open-modal
            [isOpen]="showSessionOpenModal()"
            (isOpenChange)="showSessionOpenModal.set($event)"
            (sessionOpened)="onSessionOpened($event)"
          ></app-pos-session-open-modal>
        }

        @defer (when showSessionCloseModal()) {
          <app-pos-session-close-modal
            [isOpen]="showSessionCloseModal()"
            [session]="activeSession()"
            (isOpenChange)="showSessionCloseModal.set($event)"
            (sessionClosed)="onSessionClosed($event)"
          ></app-pos-session-close-modal>
        }

        @defer (when showAISummaryModal()) {
          <app-pos-ai-summary-modal
            [isOpen]="showAISummaryModal()"
            [sessionId]="closedSessionIdForSummary()"
            (isOpenChange)="showAISummaryModal.set($event)"
          ></app-pos-ai-summary-modal>
        }

        @defer (when showCashMovementModal()) {
          <app-pos-cash-movement-modal
            [isOpen]="showCashMovementModal()"
            [sessionId]="activeSession()?.id || null"
            (isOpenChange)="showCashMovementModal.set($event)"
            (movementCreated)="onMovementCreated($event)"
          ></app-pos-cash-movement-modal>
        }

        @defer (when showSessionDetailModal()) {
          <app-pos-session-detail-modal
            [isOpen]="showSessionDetailModal()"
            [session]="activeSession()"
            (isOpenChange)="showSessionDetailModal.set($event)"
          ></app-pos-session-detail-modal>
        }
      }

      @defer (when showScheduleModal()) {
        <app-pos-schedule-modal
          [isOpen]="showScheduleModal()"
          [businessHours]="businessHours()"
          [isWithinHours]="!isActuallyOutOfHours()"
          [todayKey]="todayKey"
          (isOpenChange)="showScheduleModal.set($event)"
          (goToSettings)="showScheduleModal.set(false); goToSettings()"
        ></app-pos-schedule-modal>
      }

      @defer (when showReservationModal()) {
        <app-reservation-form-modal
          [isOpen]="showReservationModal()"
          [initialProduct]="pendingBookingProduct()"
          [initialCustomer]="selectedCustomer()"
          [posMode]="true"
          (closed)="onBookingModalClosed()"
          (created)="onBookingCreated($event)"
        ></app-reservation-form-modal>
      }

      @defer (when showLayawayConfigModal()) {
        <app-layaway-config-modal
          [cartItems]="cartState()?.items || []"
          [cartTotal]="cartSummary().total"
          [customer]="selectedCustomer()"
          [isSaving]="loading()"
          (save)="onLayawayConfigSave($event)"
          (close)="showLayawayConfigModal.set(false)"
        ></app-layaway-config-modal>
      }

      <!-- Create order modal (Crear) — replaces the legacy 'Guardar' flow -->
      <app-pos-order-create-modal
        [isOpen]="showCreateOrderModal()"
        (isOpenChange)="showCreateOrderModal.set($event)"
        (created)="onCreateOrderConfirmed($event)"
        (cancelled)="showCreateOrderModal.set(false)"
      ></app-pos-order-create-modal>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        overflow: hidden;
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

      /* Mobile: space for fixed footer */
      @media (max-width: 1023px) {
        .pos-main-content {
          padding-bottom: 80px;
        }
      }

      /* Reservations side panel */
      .reservations-panel-wrapper {
        width: 320px;
        min-width: 320px;
        max-width: 320px;
        min-height: 0;
        overflow: hidden;
        border-radius: 12px;
        border: 1px solid var(--color-border);
        background: var(--color-surface);
        animation: slideInRight 0.2s ease-out;
      }

      @keyframes slideInRight {
        from {
          opacity: 0;
          transform: translateX(20px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }

      /* Mobile bottom sheet for reservations */
      .reservations-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.4);
        z-index: 49;
        animation: fadeIn 0.2s ease-out;
      }

      .reservations-panel-mobile {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        max-height: 70vh;
        height: 70vh;
        background: var(--color-surface);
        border-radius: 16px 16px 0 0;
        box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
        z-index: 50;
        overflow: hidden;
        animation: slideUp 0.25s ease-out;
      }

      .reservations-panel-mobile::before {
        content: '';
        display: block;
        width: 40px;
        height: 4px;
        background: var(--color-border);
        border-radius: 2px;
        margin: 8px auto;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      @keyframes slideUp {
        from {
          transform: translateY(100%);
        }
        to {
          transform: translateY(0);
        }
      }
    `,
  ],
})
export class PosComponent {
  cartState = signal<CartState | null>(null);
  cartItems = computed(() => this.cartState()?.items ?? []);
  cartSummary = computed(
    () => this.cartState()?.summary ?? DEFAULT_CART_SUMMARY,
  );
  /**
   * True when restaurant mode is on AND the cart holds at least one `prepared`
   * product line. Enables the "Enviar a cocina" action for counter / takeaway
   * orders that have no open table session — the backend only fires items
   * whose `product_type='prepared'` and skips the rest.
   */
  readonly hasUnfiredPreparedItems = computed(() => {
    if (!this.restaurantIntegration.isRestaurantMode()) return false;
    return this.cartItems().some(
      (it) =>
        it.itemType !== 'custom' && it.product?.product_type === 'prepared',
    );
  });
  /** Restaurant + cart with at least one `prepared` item. Drives the
   *  fulfillment selector inside the payment modal. */
  readonly isRestaurantWithPrepared = computed(
    () =>
      this.restaurantIntegration.isRestaurantMode() &&
      this.hasUnfiredPreparedItems(),
  );
  /** Convenience accessor for restaurant mode. */
  isRestaurantMode(): boolean {
    return this.restaurantIntegration.isRestaurantMode();
  }
  selectedCustomer = signal<PosCustomer | null>(null);
  loading = signal(false);

  showCustomerModal = signal(false);
  editingCustomer = signal<PosCustomer | null>(null);

  showPaymentModal = signal(false);
  /** Fulfillment type chosen for the current payment. Mirrors the
   *  payment-modal selector so the parent can react when the modal closes. */
  paymentFulfillment = signal<'consumo' | 'entrega' | null>(null);
  /** Table id chosen for the current payment. */
  paymentTableId = signal<number | null>(null);

  showShippingModal = signal(false);

  showOrderConfirmation = signal(false);
  productRefreshCounter = signal(0);
  showCartModal = signal(false);
  customItemModalOpen = signal(false);
  customItemDraft = signal({
    name: '',
    description: '',
    quantity: 1,
    finalPrice: 0,
    taxCategoryId: null as number | null,
  });
  taxCategories = signal<TaxCategory[]>([]);
  readonly taxCategoryOptions = computed<SelectorOption[]>(() => [
    { value: 0, label: 'Sin impuesto' },
    ...this.taxCategories().map((tax) => ({
      value: tax.id,
      label: `${tax.name} (${this.formatPercentRate(tax)})`,
    })),
  ]);
  readonly canSubmitCustomItem = computed(() => {
    const draft = this.customItemDraft();
    return (
      draft.name.trim().length > 0 &&
      Number(draft.quantity || 0) > 0 &&
      Number(draft.finalPrice || 0) >= 0
    );
  });

  currentOrderId = signal<string | null>(null);
  currentOrderNumber = signal<string | null>(null);
  completedOrder = signal<any>(null);

  // Edit mode
  isEditMode = signal(false);
  editingOrderId = signal<string | null>(null);
  editingOrderNumber = signal<string | null>(null);

  // Cash Register
  cashRegisterEnabled = signal(false);
  activeSession = signal<CashRegisterSession | null>(null);
  showSessionOpenModal = signal(false);
  showSessionCloseModal = signal(false);
  showCashMovementModal = signal(false);
  showSessionDetailModal = signal(false);
  showAISummaryModal = signal(false);
  closedSessionIdForSummary = signal<number | null>(null);

  // Schedule
  showScheduleModal = signal(false);

  /** Key of the current day (e.g. 'monday') based on store timezone */
  get todayKey(): string {
    const days = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];
    try {
      const now = new Date(
        new Date().toLocaleString('en-US', { timeZone: this.storeTimezone() }),
      );
      return days[now.getDay()];
    } catch {
      return days[new Date().getDay()];
    }
  }

  get todaySchedule(): BusinessHours | null {
    const hours = this.businessHours()[this.todayKey];
    if (!hours) return null;
    return hours;
  }

  get isTodayClosed(): boolean {
    const schedule = this.todaySchedule;
    if (!schedule) return true;
    if (schedule.blocks && schedule.blocks.length > 0) {
      return schedule.blocks.every(b => b.open === 'closed' || b.close === 'closed');
    }
    return !schedule.open || !schedule.close || schedule.open === 'closed' || schedule.close === 'closed';
  }

  // Customer Queue
  queueEnabled = signal(false);
  queueCount = signal(0);
  openInQueueMode = signal(false);

  // Booking desde POS
  showReservationModal = signal(false);
  pendingBookingProduct = signal<any>(null);
  pendingBookingVariant = signal<any>(null);

  // Quotation mode
  isQuotationMode = signal(false);
  editingQuotationId = signal<string | null>(null);

  // Layaway mode
  isLayawayMode = signal(false);
  showLayawayConfigModal = signal(false);

  // Create order modal (Crear action — replaces the legacy 'Guardar')
  showCreateOrderModal = signal(false);

  // Mobile detection signal
  isMobile = signal(false);

  // Tablet detection (md breakpoint: 768px-1023px) - for sidebar synchronization
  isTablet = signal(false);

  // Store settings for schedule validation
  enableScheduleValidation = signal(false);
  businessHours = signal<Record<string, BusinessHours>>({});

  // Admin bypass for schedule validation
  isAdmin = signal(false);
  canBypassSchedule = signal(false);
  scheduleStatusChecked = signal(false);

  // Schedule UI State
  isOutOfHours = signal(false);
  isActuallyOutOfHours = signal(false);
  nextOpenTime = signal<string | undefined>(undefined);
  outOfHoursMessage = signal<string | undefined>(undefined);
  scheduleHandledByBackend = signal(false);
  storeTimezone = signal('America/Bogota');

  // Store domain for QR URL construction
  private storeDomainHostname: string | null = null;
  private posSettingsHydrationRequested = false;
  private queueSubscriptionInitialized = false;
  private cashRegisterSessionInitialized = false;

  private destroyRef = inject(DestroyRef);
  private cartService = inject(PosCartService);
  private barcodeService = inject(PosBarcodeService);
  private productService = inject(PosProductService);

  /**
   * Both desktop and mobile templates render an `app-pos-product-selection`
   * (one hidden by CSS), so we query all instances and drive whichever is
   * currently connected. We reuse the child's existing public add-to-cart /
   * variant-selection methods so stock validation, variant mapping, sourcing
   * fallback and success/error toasts stay consistent with a manual tap.
   */
  private readonly productSelectionList = viewChildren(
    PosProductSelectionComponent,
  );
  private customerService = inject(PosCustomerService);
  private paymentService = inject(PosPaymentService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private store = inject(Store);
  private route = inject(ActivatedRoute);
  private posOrderService = inject(PosOrderService);
  private ordersService = inject(StoreOrdersService);
  private settingsService = inject(StoreSettingsService);
  private quotationsService = inject(QuotationsService);
  private layawayService = inject(LayawayApiService);
  private cashRegisterService = inject(PosCashRegisterService);
  private queueService = inject(PosQueueService);
  private authFacade = inject(AuthFacade);
  private taxesService = inject(TaxesService);
  private currencyService = inject(CurrencyFormatService);
  // protected: el template referencia isRestaurantMode()/hasOpenTableSession()
  // directamente (bindings del footer móvil + @defer de los modales de Fase H).
  protected restaurantIntegration = inject(PosRestaurantIntegrationService);

  readonly canCreateCustomItems = computed(() =>
    this.hasPermission('store:pos:custom_items:create'),
  );
  readonly canOverridePrices = computed(() =>
    this.hasPermission('store:pos:price_override'),
  );

  constructor() {
    this.checkMobile();
    this.setupSubscriptions();
    this.loadStoreSettings();
    this.checkEditMode();
    this.checkQuotationMode();
    this.checkLayawayMode();
    this.validateScheduleOnInit();
    this.loadTaxCategories();

    this.store
      .select(selectUserDomainHostname)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((hostname) => {
        this.storeDomainHostname = hostname;
      });

    this.paymentService.sessionRequired$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.showSessionOpenModal.set(true);
      });

    // Barcode scanner: PosBarcodeService gates emission behind the
    // `barcode_scanner.enabled` setting, so scans$ only fires when the feature
    // is enabled. We subscribe once and route each scan into the existing
    // add-to-cart flow.
    this.barcodeService.scans$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((code) => this.handleBarcodeScan(code));

    effect(() => {
      const serviceSession = this.cashRegisterService.activeSession();
      this.activeSession.set(serviceSession);
    });
  }

  @HostListener('window:resize')
  onResize(): void {
    this.checkMobile();
  }

  private checkMobile(): void {
    const width = window.innerWidth;
    this.isMobile.set(width < 768);
    // Tablet range: 768px - 1023px (where sidebar can be collapsed/expanded)
    this.isTablet.set(width >= 768 && width < 1024);
  }

  /**
   * Valida el horario de atención al iniciar el componente
   * Usa el endpoint del backend para obtener el estado con info de admin
   */
  private validateScheduleOnInit(): void {
    this.settingsService
      .getScheduleStatus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response?.success && response?.data) {
            const status = response.data;
            this.isAdmin.set(status.isAdmin || false);
            this.canBypassSchedule.set(status.canBypass || false);
            this.scheduleStatusChecked.set(true);
            this.scheduleHandledByBackend.set(true);

            if (!status.isWithinBusinessHours && !this.canBypassSchedule()) {
              this.isOutOfHours.set(true);
              this.isActuallyOutOfHours.set(true);
              this.nextOpenTime.set(status.nextOpenTime);
              this.outOfHoursMessage.set(status.message);
            } else if (
              !status.isWithinBusinessHours &&
              this.canBypassSchedule()
            ) {
              this.isActuallyOutOfHours.set(true);
              this.showAdminScheduleWarning(status.message ?? '');
            } else {
              this.isActuallyOutOfHours.set(false);
            }
          }
        },
        error: (err) => {
          console.error('Error validating schedule:', err);
          this.scheduleStatusChecked.set(true);
        },
      });
  }

  goToSettings(): void {
    this.router.navigate(['/admin/settings/general']);
  }

  goToDashboard(): void {
    this.router.navigate(['/admin/dashboard']);
  }

  /**
   * Muestra warning para admins (info nada más)
   */
  private showAdminScheduleWarning(message: string): void {
    this.toastService.info(
      message ||
        'Fuera de horario de atención. Tienes acceso de administrador.',
      'Horario de Atención',
      8000,
    );
  }

  private setupSubscriptions(): void {
    toObservable(this.cartService.cartState)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((cartState: CartState) => {
        this.cartState.set(cartState);
      });

    this.cartService.customer
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((customer: PosCustomer | null) => {
        this.selectedCustomer.set(customer);
      });

    toObservable(this.cartService.loading)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((loading: boolean) => {
        this.loading.set(Boolean(loading));
      });
  }

  private loadTaxCategories(): void {
    this.taxesService
      .getTaxCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (taxCategories) => this.taxCategories.set(taxCategories || []),
        error: () => this.taxCategories.set([]),
      });
  }

  private hasPermission(permission: string): boolean {
    const permissions = this.authFacade.userPermissions();
    const roles = this.authFacade.userRoles();
    return (
      permissions.includes(permission) ||
      roles.includes('super_admin') ||
      roles.includes('SUPER_ADMIN')
    );
  }

  get isEmpty(): boolean {
    return !this.cartState() || this.cartState()!.items.length === 0;
  }

  onOpenCustomerModal(): void {
    this.editingCustomer.set(null);
    this.showCustomerModal.set(true);
  }

  onClearCustomer(): void {
    this.customerService.clearSelectedCustomer();
    this.cartService
      .setCustomer(null)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.toastService.info('Cliente removido de la venta');
      });
  }

  onCustomerModalClosed(): void {
    this.showCustomerModal.set(false);
    this.editingCustomer.set(null);
    this.openInQueueMode.set(false);
  }

  onCustomerCreated(customer: PosCustomer): void {
    this.customerService.selectCustomer(customer);
    this.cartService
      .setCustomer(customer)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.showCustomerModal.set(false);
        this.toastService.success('Cliente agregado correctamente');
      });
  }

  onCustomerUpdated(customer: PosCustomer): void {
    this.customerService.selectCustomer(customer);
    this.cartService
      .setCustomer(customer)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.showCustomerModal.set(false);
        this.toastService.success('Cliente actualizado correctamente');
      });
  }

  onCustomerSelected(customer: PosCustomer): void {
    this.customerService.selectCustomer(customer);
    this.cartService
      .setCustomer(customer)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.showCustomerModal.set(false);
        this.toastService.success('Cliente asignado correctamente');
      });
  }

  onPaymentCustomerSelected(customer: PosCustomer): void {
    // Customer selected from the payment modal's internal selector
    this.customerService.selectCustomer(customer);
    this.cartService
      .setCustomer(customer)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.toastService.success('Cliente asignado correctamente');
      });
  }

  onProductSelected(product: any): void {}

  onProductAddedToCart(event: { product: any; quantity: number }): void {
    // Toast is already handled in the child component
  }

  /**
   * Handle a completed barcode scan: resolve the product/variant by barcode and
   * route it through the product-selection child's existing add-to-cart flow.
   *
   * Resolution:
   * - Product not found -> warning toast.
   * - Product without variants -> add directly (child.onAddToCart, quantity 1).
   * - Product with variants:
   *   - A variant's barcode matches the scan -> add THAT exact variant via the
   *     child's onVariantSelected (full stock/sourcing/toast path).
   *   - The scan hit the product-level barcode of a variant-based product
   *     (no variant matches) -> reuse child.onAddToCart, which opens the
   *     existing variant-selection modal so the cashier picks the variant.
   *
   * Stock validation, variant mapping and toasts are all owned by the child's
   * methods; we never reimplement cart logic here.
   *
   * Note: the POS search box (`searchQuery`) lives inside the
   * PosProductSelectionComponent child, not the root, so it is not reset here.
   * The scanner only suppresses the terminating Enter, so a scan does not leave
   * residue in that input unless it happens to be focused; reaching across the
   * component boundary to clear it is out of scope.
   */
  private handleBarcodeScan(code: string): void {
    // Defensive gate: scans$ already only fires when enabled, but guard anyway.
    if (!this.barcodeService.enabled()) {
      return;
    }

    const child = this.productSelectionList()[0];
    if (!child) {
      return;
    }

    this.productService
      .getProductByBarcode(code)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((product: Product | null) => {
        if (!product) {
          this.toastService.warning(`Producto no encontrado: ${code}`);
          return;
        }

        const variants = product.product_variants ?? [];

        if (variants.length > 0) {
          const matchedVariant = variants.find(
            (v: PosProductVariant) => v.barcode === code,
          );

          if (matchedVariant) {
            // Exact variant scanned: add that variant directly. The child reads
            // `selectedProductForVariant` inside onVariantSelected, so seed it
            // before invoking the existing variant-add path.
            child.selectedProductForVariant.set(product);
            void child.onVariantSelected(matchedVariant);
            return;
          }

          // Product-level barcode on a variant product: let the child open its
          // existing variant-selection modal so the cashier picks the variant.
          void child.onAddToCart(product);
          return;
        }

        // No variants: reuse the standard add-to-cart path (quantity 1).
        void child.onAddToCart(product);
      });
  }

  onClearCart(): void {
    this.cartService
      .clearCart()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Carrito vaciado');
        },
        error: (error: any) => {
          this.loading.set(false);
          this.toastService.error(error.message || 'Error al vaciar carrito');
        },
      });
  }

  /**
   * Legacy entrypoint kept for any call site that still binds to it.
   * The "Crear" UX is now handled by `onOpenCreateModal` which opens the
   * order-create modal (with the fulfillment selector for restaurant
   * stores and the anti-double-fire KDS guard).
   */
  onSaveDraft(): void {
    this.onOpenCreateModal();
  }

  /**
   * Open the "Crear orden" modal. The modal owns the create flow
   * (retail draft / restaurant counter draft / append-to-table) and the
   * KDS fire. On success the cart is cleared.
   */
  onOpenCreateModal(): void {
    if (!this.cartState() || this.isEmpty) return;
    this.showCreateOrderModal.set(true);
  }

  /**
   * Post-create handler invoked by `app-pos-order-create-modal`. Persists
   * the new order id so the operator can re-print / track it, and
   * surfaces the order-confirmation screen.
   */
  onCreateOrderConfirmed(result: PosOrderCreateResult): void {
    this.showCreateOrderModal.set(false);
    if (!result?.order) return;
    this.currentOrderId.set(result.order.id ? String(result.order.id) : null);
    this.currentOrderNumber.set(result.order.order_number ?? null);
    this.completedOrder.set({
      ...(result.order || {}),
      isCreateOrder: true,
      fulfillment: result.fulfillment,
      tableId: result.tableId,
      firedToKitchen: result.firedToKitchen,
      items: this.cartState()?.items.map((it) => ({
        product_id: (it.product as any).id,
        product_name: it.product.name,
        quantity: it.quantity,
        unit_price: it.unitPrice,
        total_price: it.totalPrice,
        variant_id: it.variant_id,
      })) ?? [],
    });
    this.showOrderConfirmation.set(true);
  }

  onQuote(): void {
    if (!this.selectedCustomer()) {
      this.toastService.warning(
        'Debes asignar un cliente para crear una cotización',
      );
      this.onOpenCustomerModal();
      return;
    }

    if (!this.cartState() || this.isEmpty) {
      this.toastService.warning('El carrito está vacío');
      return;
    }

    this.loading.set(true);
    const items = this.cartState()!.items.map((item) => ({
      product_id:
        typeof item.product.id === 'string'
          ? parseInt(item.product.id, 10)
          : item.product.id,
      product_name: item.product.name,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      discount_amount: 0,
      tax_amount_item: item.taxAmount || 0,
      total_price: item.totalPrice,
    }));

    const dto = {
      customer_id: this.selectedCustomer()
        ? this.selectedCustomer()!.id
        : undefined,
      channel: 'pos' as const,
      items,
      notes: '',
    };

    const editId = this.editingQuotationId();
    const obs$ = editId
      ? this.quotationsService.updateQuotation(Number(editId), dto as any)
      : this.quotationsService.createQuotation(dto as any);

    obs$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res: any) => {
        this.loading.set(false);
        const qNumber =
          res?.data?.quotation_number || res?.quotation_number || '';
        this.toastService.success(
          editId
            ? `Cotización ${qNumber} actualizada correctamente`
            : `Cotización ${qNumber} creada correctamente`,
        );
        this.onClearCart();
        if (this.isQuotationMode()) {
          this.router.navigate(['/admin/orders/quotations']);
        }
      },
      error: (err: any) => {
        this.loading.set(false);
        this.toastService.error(
          err?.error?.message || 'Error al crear cotización',
        );
      },
    });
  }

  onLayaway(): void {
    if (!this.selectedCustomer()) {
      this.toastService.warning(
        'Debes asignar un cliente para crear un plan separé',
      );
      this.onOpenCustomerModal();
      return;
    }

    if (!this.cartState() || this.isEmpty) {
      this.toastService.warning('El carrito está vacío');
      return;
    }

    this.showLayawayConfigModal.set(true);
  }

  onLayawayConfigSave(config: any): void {
    if (!this.cartState() || !this.selectedCustomer()) return;

    this.loading.set(true);
    this.showLayawayConfigModal.set(false);

    const items = this.cartState()!.items.map((item) => ({
      product_id:
        typeof item.product.id === 'string'
          ? parseInt(item.product.id, 10)
          : item.product.id,
      product_name: item.product.name,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      tax_amount: item.taxAmount || 0,
      discount_amount: 0,
    }));

    const dto: CreateLayawayRequest = {
      customer_id: this.selectedCustomer()!.id,
      down_payment_amount: config.down_payment_amount || 0,
      notes: config.notes || undefined,
      internal_notes: config.internal_notes || undefined,
      items,
      installments: config.installments || [],
    };

    this.layawayService
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          this.loading.set(false);
          const planNumber = res?.data?.plan_number || res?.plan_number || '';
          this.toastService.success(
            `Plan Separé ${planNumber} creado correctamente`,
          );
          this.onClearCart();
          this.router.navigate(['/admin/orders/layaway']);
        },
        error: (err: any) => {
          this.loading.set(false);
          this.toastService.error(
            err?.error?.message || 'Error al crear plan separé',
          );
        },
      });
  }

  onFireKitchen(): void {
    const session = this.restaurantIntegration.currentTableSession();
    // No open table → counter / takeaway flow (mostrador / para llevar).
    if (!session?.order_id) {
      this.fireCounterOrder();
      return;
    }

    const cart = this.cartState();
    const items: Array<{ product_id: number; quantity: number; product_variant_id?: number }> = [];
    for (const it of cart?.items ?? []) {
      if (it.itemType === 'custom') continue;
      const productId = parseInt(
        typeof it.product.id === 'string'
          ? it.product.id
          : String(it.product.id),
        10,
      );
      if (!Number.isFinite(productId)) continue;
      const line: { product_id: number; quantity: number; product_variant_id?: number } = {
        product_id: productId,
        quantity: it.quantity,
      };
      if (it.variant_id != null) {
        line.product_variant_id = it.variant_id;
      }
      items.push(line);
    }

    if (items.length === 0) {
      this.toastService.warning('Agrega productos al carrito antes de enviar a cocina');
      return;
    }

    this.loading.set(true);
    this.restaurantIntegration
      .addItemsToTableSession(session.id, items)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updatedSession) => {
          const orderItemIds = (updatedSession.order?.order_items ?? [])
            .filter(
              (it) =>
                items.some(
                  (i) =>
                    i.product_id === it.product_id &&
                    i.quantity === it.quantity,
                ),
            )
            .map((it) => it.id);
          if (orderItemIds.length === 0) {
            this.loading.set(false);
            this.toastService.success('Items enviados a la mesa');
            return;
          }
          this.restaurantIntegration
            .fireOrderItems(session.order_id, orderItemIds)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (fireResult) => {
                this.loading.set(false);
                this.toastService.success(
                  `Enviado a cocina (ticket #${fireResult.kitchen_ticket_id})`,
                );
                this.cartService
                  .clearCart()
                  .pipe(takeUntilDestroyed(this.destroyRef))
                  .subscribe({ next: () => undefined, error: () => undefined });
                this.restaurantIntegration
                  .refreshTableSession(session.id)
                  .pipe(takeUntilDestroyed(this.destroyRef))
                  .subscribe({
                    next: () => undefined,
                    error: () => undefined,
                  });
              },
              error: (err) => {
                this.loading.set(false);
                this.toastService.error(
                  err?.message || 'Error al enviar a cocina',
                );
              },
            });
        },
        error: (err) => {
          this.loading.set(false);
          this.toastService.error(
            err?.message || 'Error al agregar items a la mesa',
          );
        },
      });
  }

  /**
   * Counter / takeaway fire-to-kitchen (no open table session). Creates a
   * draft `orders` row seeded with the cart's PREPARED lines, then fires the
   * resulting `order_items` to the kitchen. Inventory consumption + COGS are
   * handled server-side at fire (same seam as the table flow); we never
   * decrement stock here. Retail / non-prepared lines stay in the cart for the
   * normal checkout path and are NOT sent to the kitchen.
   */
  private fireCounterOrder(): void {
    const cart = this.cartState();
    const preparedLines: CounterOrderLine[] = [];
    for (const it of cart?.items ?? []) {
      if (it.itemType === 'custom') continue;
      if (it.product?.product_type !== 'prepared') continue;
      const productId = parseInt(
        typeof it.product.id === 'string'
          ? it.product.id
          : String(it.product.id),
        10,
      );
      if (!Number.isFinite(productId)) continue;
      const line: CounterOrderLine = {
        product_id: productId,
        product_name: it.product.name,
        quantity: it.quantity,
        unit_price: Number(it.unitPrice ?? 0),
        total_price: Number(it.totalPrice ?? 0),
        tax_rate: it.taxRate,
      };
      if (it.variant_id != null) {
        line.product_variant_id = it.variant_id;
      }
      preparedLines.push(line);
    }

    if (preparedLines.length === 0) {
      this.toastService.warning(
        'No hay platos preparados en el carrito para enviar a cocina',
      );
      return;
    }

    // Cliente General fallback (id=1) mirrors the unified POS sale path.
    const customerId = Number(this.selectedCustomer()?.id ?? 1) || 1;

    this.loading.set(true);
    this.restaurantIntegration
      .createCounterDraftOrder(customerId, preparedLines, cart?.notes)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (order) => {
          const orderItemIds = (order.order_items ?? []).map((oi) => oi.id);
          if (!order.id || orderItemIds.length === 0) {
            this.loading.set(false);
            this.toastService.error('La orden de mostrador no generó ítems');
            return;
          }
          this.restaurantIntegration
            .fireOrderItems(order.id, orderItemIds)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (fireResult) => {
                this.loading.set(false);
                this.toastService.success(
                  `Enviado a cocina (ticket #${fireResult.kitchen_ticket_id})`,
                );
                this.cartService
                  .clearCart()
                  .pipe(takeUntilDestroyed(this.destroyRef))
                  .subscribe({ next: () => undefined, error: () => undefined });
              },
              error: (err) => {
                this.loading.set(false);
                this.toastService.error(
                  err?.message || 'Error al enviar a cocina',
                );
              },
            });
        },
        error: (err) => {
          this.loading.set(false);
          this.toastService.error(
            err?.message || 'Error al crear la orden de mostrador',
          );
        },
      });
  }

  onCheckout(): void {
    if (!this.cartState() || this.isEmpty) return;

    if (this.isEditMode()) {
      this.updateExistingOrder();
      return;
    }

    this.showPaymentModal.set(true);
  }

  onPaymentModalClosed(): void {
    this.showPaymentModal.set(false);
  }


  private fireKitchenFromCompletedOrder(order: any): void {
    if (!order?.id) return;
    if (!this.isRestaurantMode() || !this.hasUnfiredPreparedItems()) return;
    if (this.restaurantIntegration.preparedFiredForCurrentCart()) return;
    // The POS payment backend does not surface `order_items` in the same
    // shape as the counter-draft order. We pull ids from the response when
    // available, otherwise we fall back to a no-op (the operator can
    // re-fire from the KDS page).
    const orderItemIds: number[] = Array.isArray(order?.order_items)
      ? order.order_items.map((it: any) => Number(it.id)).filter(Number.isFinite)
      : [];
    if (orderItemIds.length === 0) return;
    this.restaurantIntegration
      .maybeFireKitchen(Number(order.id), orderItemIds)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res && res.fired_item_ids.length > 0) {
            this.toastService.success('Orden cobrada y enviada a cocina');
          }
        },
        error: (err) => {
          console.error('KDS fire-after-pay failed', err);
        },
      });
  }
  onPaymentCompleted(paymentData: any): void {
    if (!this.cartState() || this.isEmpty) return;

    this.loading.set(false);
    this.showPaymentModal.set(false);

    // Capture fulfillment + tableId chosen in the payment modal so the
    // parent can audit / forward them, then reset the local signals.
    const paymentFulfillment: 'consumo' | 'entrega' | null =
      paymentData.fulfillment ?? this.paymentFulfillment();
    const paymentTableId: number | null =
      paymentData.tableId ?? this.paymentTableId();
    this.paymentFulfillment.set(paymentFulfillment);
    this.paymentTableId.set(paymentTableId);

    if (paymentData.success) {
      this.currentOrderId.set(paymentData.order?.id);
      this.currentOrderNumber.set(paymentData.order?.order_number);
      this.fireKitchenFromCompletedOrder(paymentData.order);


      const cs = this.cartState();
      const csm = this.cartSummary();
      const sc = this.selectedCustomer();

      this.completedOrder.set({
        ...(paymentData.order || {}),
        isCreditSale: !!paymentData.isCreditSale,
        isAnonymousSale: !!paymentData.isAnonymousSale,
        items:
          paymentData.order?.items ||
          cs?.items.map((item) => ({
            product_id: item.product.id,
            product_name: item.product.name,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            total_price: item.totalPrice,
            variant_id: item.variant_id,
            variant_sku: item.variant_sku,
            variant_attributes: item.variant_attributes,
            variant_display_name: item.variant_display_name,
            weight: item.weight || undefined,
            weight_unit: item.weight_unit || undefined,
          })),
        subtotal: paymentData.order?.subtotal || csm.subtotal,
        tax_amount: paymentData.order?.tax_amount || csm.taxAmount,
        discount_amount:
          paymentData.order?.discount_amount || csm.discountAmount,
        total_amount: paymentData.order?.total_amount || csm.total,
        customer_name: paymentData.isAnonymousSale
          ? 'Consumidor Final'
          : paymentData.order?.customer_name ||
            (sc ? `${sc.first_name} ${sc.last_name}` : ''),
        customer_email:
          !paymentData.isAnonymousSale && sc?.email
            ? sc.email
            : paymentData.order?.customer_email || '',
        customer_tax_id: paymentData.isAnonymousSale
          ? '000'
          : paymentData.order?.customer_tax_id || sc?.document_number || '',
        customer: paymentData.order?.customer || sc,
        payment: paymentData.order?.payment || paymentData.payment,
        invoiceDataToken: paymentData.order?.invoice_data_token,
        invoiceDataQrUrl:
          paymentData.order?.invoice_data_token && this.storeDomainHostname
            ? `${window.location.protocol}//${this.storeDomainHostname}/factura/${paymentData.order.invoice_data_token}`
            : undefined,
      });

      this.showOrderConfirmation.set(true);
      const successMessage = paymentData.isCreditSale
        ? 'Venta a crédito procesada correctamente'
        : 'Venta procesada correctamente';

      this.toastService.success(successMessage);
      this.onClearCart();
      this.productRefreshCounter.update((v) => v + 1);

      if (sc?.fromQueue && sc?.queueEntryId && paymentData.order?.id) {
        this.queueService
          .consumeEntry(sc.queueEntryId, paymentData.order.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            error: (err: any) =>
              console.error('Error consuming queue entry:', err),
          });
      }
    }
  }

  onOrderConfirmationClosed(): void {
    this.showOrderConfirmation.set(false);
    this.completedOrder.set(null);
  }

  onStartNewSale(): void {
    this.showOrderConfirmation.set(false);
    this.completedOrder.set(null);
    this.onClearCart();
  }

  onBookingRequired(event: any): void {
    const product = event?.product ?? event;
    const variant = event?.variant ?? null;
    this.pendingBookingProduct.set(
      variant ? { ...product, selected_variant: variant } : product,
    );
    this.pendingBookingVariant.set(variant);
    this.showReservationModal.set(true);
  }

  onBookingCreated(event?: any): void {
    this.showReservationModal.set(false);

    const reservationCustomer = event?.customer || event;
    const booking = event?.booking;

    if (reservationCustomer && !this.selectedCustomer()) {
      const posCustomer: PosCustomer = {
        id: reservationCustomer.id,
        email: reservationCustomer.email || '',
        first_name: reservationCustomer.first_name || '',
        last_name: reservationCustomer.last_name || '',
        name: `${reservationCustomer.first_name || ''} ${reservationCustomer.last_name || ''}`.trim(),
        phone: reservationCustomer.phone || '',
        created_at: reservationCustomer.created_at || new Date(),
        updated_at: reservationCustomer.updated_at || new Date(),
      };
      this.customerService.selectCustomer(posCustomer);
      this.cartService
        .setCustomer(posCustomer)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe();
    }

    if (booking) {
      this.cartService
        .addPendingBooking({
          id: booking.id,
          booking_number: booking.booking_number,
          product_id: booking.product_id || booking.product?.id,
          product_name:
            booking.product?.name ||
            this.pendingBookingProduct()?.name ||
            'Servicio',
          product_variant_id:
            booking.product_variant_id || this.pendingBookingVariant()?.id,
          variant_name:
            booking.product_variant?.name || this.pendingBookingVariant()?.name,
          customer_id: booking.customer_id || booking.customer?.id,
          date: booking.date,
          start_time: booking.start_time,
          end_time: booking.end_time,
          provider_name: booking.provider?.display_name,
        })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe();
    }

    if (this.pendingBookingProduct()) {
      this.cartService
        .addToCart({
          product: this.pendingBookingProduct(),
          quantity: 1,
          variant: this.pendingBookingVariant() ?? undefined,
        })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.toastService.success(
              'Reserva creada y servicio agregado al carrito',
            );
            this.pendingBookingProduct.set(null);
            this.pendingBookingVariant.set(null);
          },
          error: () => {
            this.toastService.error(
              'Reserva creada, pero no se pudo agregar al carrito',
            );
            this.pendingBookingProduct.set(null);
            this.pendingBookingVariant.set(null);
          },
        });
    }
  }

  onBookingModalClosed(): void {
    this.showReservationModal.set(false);
    this.pendingBookingProduct.set(null);
    this.pendingBookingVariant.set(null);
  }

  onViewOrderDetail(orderId: string): void {
    const targetOrderId = orderId || this.currentOrderId();
    if (!targetOrderId) {
      this.toastService.error(
        'No se pudo determinar la orden para mostrar el detalle',
      );
      return;
    }

    this.showOrderConfirmation.set(false);
    this.completedOrder.set(null);
    this.router.navigate(['/admin/orders', targetOrderId]);
  }

  // Mobile Cart Modal Methods
  onOpenCartModal(): void {
    this.showCartModal.set(true);
  }

  onCloseCartModal(): void {
    this.showCartModal.set(false);
  }

  openCustomItemModal(): void {
    if (!this.canCreateCustomItems()) {
      this.toastService.warning(
        'No tienes permiso para agregar ítems personalizados',
      );
      return;
    }

    this.customItemDraft.set({
      name: '',
      description: '',
      quantity: 1,
      finalPrice: 0,
      taxCategoryId: null,
    });
    this.customItemModalOpen.set(true);
  }

  closeCustomItemModal(): void {
    this.customItemModalOpen.set(false);
  }

  updateCustomItemDraft(
    field: 'name' | 'description' | 'quantity' | 'finalPrice' | 'taxCategoryId',
    value: string | number | null,
  ): void {
    this.customItemDraft.update((draft) => ({
      ...draft,
      [field]:
        field === 'quantity' || field === 'finalPrice'
          ? Number(value || 0)
          : field === 'taxCategoryId'
            ? value === null || value === '' || Number(value) <= 0
              ? null
              : Number(value)
            : String(value || ''),
    }));
  }

  addCustomItemFromMobile(): void {
    if (!this.canSubmitCustomItem()) {
      this.toastService.warning(
        'Completa el nombre y un valor válido para el ítem',
      );
      return;
    }

    const draft = this.customItemDraft();
    const taxCategory = this.getSelectedTaxCategory();

    this.cartService
      .addCustomItem({
        name: draft.name.trim(),
        description: draft.description.trim(),
        quantity: Number(draft.quantity || 1),
        finalPrice: Number(draft.finalPrice || 0),
        taxCategory,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.customItemModalOpen.set(false);
          this.showCartModal.set(true);
          this.toastService.success('Ítem personalizado agregado');
        },
        error: (error: any) => {
          this.toastService.error(error.message || 'Error al agregar el ítem');
        },
      });
  }

  async editItemPriceFromMobile(item: CartItem): Promise<void> {
    if (!this.canEditItemPrice(item)) {
      this.toastService.warning('No tienes permiso para editar este precio');
      return;
    }

    const value = await this.dialogService.prompt(
      {
        title: 'Editar precio de venta',
        message: item.product.name,
        placeholder: 'Precio final',
        defaultValue: item.finalPrice.toString(),
        confirmText: 'Actualizar',
        cancelText: 'Cancelar',
        inputType: 'number',
      },
      { size: 'sm' },
    );

    if (value === undefined) return;
    const finalPrice = Number(value);
    if (Number.isNaN(finalPrice) || finalPrice < 0) {
      this.toastService.warning('El precio debe ser un número válido');
      return;
    }

    let reason = item.priceOverrideReason;
    if (item.itemType !== 'custom') {
      reason = await this.dialogService.prompt(
        {
          title: 'Motivo del cambio',
          message: 'Opcional, queda como referencia de auditoría de la orden.',
          placeholder: 'Ej. precio negociado con el cliente',
          defaultValue: item.priceOverrideReason || '',
          confirmText: 'Guardar',
          cancelText: 'Omitir',
        },
        { size: 'sm' },
      );
    }

    this.cartService
      .updateCartItemPrice({ itemId: item.id, finalPrice, reason })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.toastService.success('Precio actualizado'),
        error: (error: any) =>
          this.toastService.error(
            error.message || 'Error al actualizar precio',
          ),
      });
  }

  private canEditItemPrice(item: CartItem): boolean {
    return item.itemType === 'custom'
      ? this.canCreateCustomItems()
      : item.product.allow_pos_price_override === true &&
          this.canOverridePrices();
  }

  getTaxCategoryRate(taxCategory?: TaxCategory | null): number {
    return (
      taxCategory?.tax_rates?.reduce(
        (sum, rate: any) => sum + Number(rate.rate || 0),
        0,
      ) || 0
    );
  }

  formatPercentRate(taxCategory: TaxCategory): string {
    return `${(this.getTaxCategoryRate(taxCategory) * 100).toFixed(2)}%`;
  }

  getSelectedTaxCategory(): TaxCategory | null {
    const selectedId = this.customItemDraft().taxCategoryId;
    if (!selectedId) return null;
    return this.taxCategories().find((tax) => tax.id === selectedId) || null;
  }

  customItemBasePrice(): number {
    const draft = this.customItemDraft();
    const finalPrice = Number(draft.finalPrice || 0);
    const rate = this.getTaxCategoryRate(this.getSelectedTaxCategory());
    return rate > 0 ? finalPrice / (1 + rate) : finalPrice;
  }

  customItemTaxAmount(): number {
    const draft = this.customItemDraft();
    const quantity = Number(draft.quantity || 1);
    return (
      (Number(draft.finalPrice || 0) - this.customItemBasePrice()) * quantity
    );
  }

  customItemTotal(): number {
    const draft = this.customItemDraft();
    return Number(draft.finalPrice || 0) * Number(draft.quantity || 1);
  }

  formatCurrency(amount: number): string {
    return this.currencyService.format(amount);
  }

  onCartItemQuantityChanged(event: { itemId: string; quantity: number }): void {
    if (event.quantity <= 0) {
      this.onCartItemRemoved(event.itemId);
      return;
    }

    this.cartService
      .updateCartItem({ itemId: event.itemId, quantity: event.quantity })
      .pipe(takeUntilDestroyed(this.destroyRef))
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
      .pipe(takeUntilDestroyed(this.destroyRef))
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

  onCheckoutFromModal(): void {
    this.showCartModal.set(false);
    this.onCheckout();
  }

  // Shipping Modal Methods
  onShipping(): void {
    if (!this.cartState() || this.isEmpty) {
      this.toastService.warning('El carrito está vacío');
      return;
    }
    this.showShippingModal.set(true);
  }

  onShippingFromModal(): void {
    this.showCartModal.set(false);
    this.onShipping();
  }

  onShippingModalClosed(): void {
    this.showShippingModal.set(false);
  }

  onShippingCompleted(shippingData: any): void {
    if (!this.cartState() || this.isEmpty) return;

    this.loading.set(false);
    this.showShippingModal.set(false);

    if (shippingData.success) {
      this.currentOrderId.set(shippingData.order?.id);
      this.currentOrderNumber.set(shippingData.order?.order_number);

      // Restaurant + prepared: fire KDS too (Envío is a full sale, not just shipping)
      this.fireKitchenFromCompletedOrder(shippingData.order);

      const cs = this.cartState();
      const csm = this.cartSummary();
      const sc = this.selectedCustomer();

      this.completedOrder.set({
        ...(shippingData.order || {}),
        isShippingSale: true,
        items:
          shippingData.order?.items ||
          cs?.items.map((item) => ({
            product_id: item.product.id,
            product_name: item.product.name,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            total_price: item.totalPrice,
            variant_id: item.variant_id,
            variant_sku: item.variant_sku,
            variant_attributes: item.variant_attributes,
            variant_display_name: item.variant_display_name,
            weight: item.weight || undefined,
            weight_unit: item.weight_unit || undefined,
          })),
        subtotal: shippingData.order?.subtotal || csm.subtotal,
        tax_amount: shippingData.order?.tax_amount || csm.taxAmount,
        discount_amount:
          shippingData.order?.discount_amount || csm.discountAmount,
        total_amount: shippingData.order?.total_amount || csm.total,
        customer_name: sc
          ? `${sc.first_name} ${sc.last_name}`
          : shippingData.order?.customer_name || '',
        customer_email: sc?.email || shippingData.order?.customer_email || '',
        customer_tax_id:
          sc?.document_number || shippingData.order?.customer_tax_id || '',
        customer: shippingData.order?.customer || sc,
        payment: shippingData.order?.payment || shippingData.payment,
      });

      this.showOrderConfirmation.set(true);
      this.toastService.success('Orden con envío creada correctamente');
      this.onClearCart();
      this.productRefreshCounter.update((v) => v + 1);

      if (sc?.fromQueue && sc?.queueEntryId && shippingData.order?.id) {
        this.queueService
          .consumeEntry(sc.queueEntryId, shippingData.order.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            error: (err: any) =>
              console.error('Error consuming queue entry:', err),
          });
      }
    }
  }

  private checkEditMode(): void {
    this.route.queryParams
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const editOrderId = params['editOrder'];
        if (editOrderId) {
          this.loadOrderForEditing(editOrderId.toString());
        }
      });
  }

  private checkQuotationMode(): void {
    this.route.queryParams
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const mode = params['mode'];
        const editQuotationId = params['editQuotation'];

        if (mode === 'quotation') {
          this.isQuotationMode.set(true);

          if (editQuotationId) {
            this.loadQuotationForEditing(editQuotationId);
          }
        } else {
          this.isQuotationMode.set(false);
          this.editingQuotationId.set(null);
        }
      });
  }

  private checkLayawayMode(): void {
    this.route.queryParams
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const mode = params['mode'];
        if (mode === 'layaway') {
          this.isLayawayMode.set(true);
        } else {
          this.isLayawayMode.set(false);
        }
      });
  }

  private loadQuotationForEditing(quotationId: string): void {
    this.loading.set(true);
    this.quotationsService
      .getQuotationById(Number(quotationId))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const quotation = response?.data || response;
          const items = (quotation.quotation_items || []).map((item: any) => ({
            product: {
              id: item.product_id?.toString() || item.product?.id?.toString(),
              name: item.product_name || item.product?.name,
              price: item.unit_price,
              image_url: item.product?.image_url || '',
              stock: 999,
              track_inventory: false,
              tax_assignments: item.product?.tax_assignments || [],
            },
            quantity: item.quantity,
            unitPrice: item.unit_price,
            totalPrice: item.total_price,
            taxAmount: item.tax_amount_item || 0,
          }));

          this.cartService
            .clearCart()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => {
              items.forEach((item: any) => {
                this.cartService
                  .addToCart({
                    product: item.product,
                    quantity: item.quantity,
                  })
                  .pipe(takeUntilDestroyed(this.destroyRef))
                  .subscribe();
              });
            });

          if (quotation.customer) {
            const customer: PosCustomer = {
              id: quotation.customer.id,
              first_name: quotation.customer.first_name,
              last_name: quotation.customer.last_name,
              name: `${quotation.customer.first_name} ${quotation.customer.last_name}`,
              email: quotation.customer.email || '',
              phone: quotation.customer.phone || '',
              document_number: quotation.customer.document_number || '',
              created_at: quotation.customer.created_at || new Date(),
              updated_at: quotation.customer.updated_at || new Date(),
            };
            this.customerService.selectCustomer(customer);
            this.cartService
              .setCustomer(customer)
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe();
          }

          this.editingQuotationId.set(quotationId);
          this.loading.set(false);
          this.toastService.info(
            `Editando Cotización #${quotation.quotation_number}`,
          );
        },
        error: () => {
          this.loading.set(false);
          this.toastService.error('Error al cargar cotización');
          this.router.navigate(['/admin/orders/quotations']);
        },
      });
  }

  private loadOrderForEditing(orderId: string): void {
    this.loading.set(true);
    this.ordersService
      .getOrderById(orderId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const order = response.data || response;

          if (order.state !== 'created') {
            this.loading.set(false);
            this.toastService.error(
              'Solo se pueden editar ordenes en estado "Creada"',
            );
            this.router.navigate(['/admin/orders', orderId]);
            return;
          }

          this.cartService
            .loadFromOrder(order)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: () => {
                this.isEditMode.set(true);
                this.editingOrderId.set(orderId);
                this.editingOrderNumber.set(order.order_number);
                this.loading.set(false);
                this.toastService.info(`Editando Orden #${order.order_number}`);
              },
              error: (err) => {
                this.loading.set(false);
                this.toastService.error(
                  'Error al cargar los productos de la orden',
                );
              },
            });
        },
        error: (err) => {
          this.loading.set(false);
          this.toastService.error('Error al cargar la orden para edición');
          this.router.navigate(['/admin/orders']);
        },
      });
  }

  private updateExistingOrder(): void {
    if (!this.cartState() || !this.editingOrderId()) return;

    this.loading.set(true);
    this.posOrderService
      .updateOrderItems(this.editingOrderId()!, this.cartState()!)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.toastService.success('Orden actualizada exitosamente');
          this.cartService
            .clearCart()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe();
          this.isEditMode.set(false);
          this.router.navigate(['/admin/orders', this.editingOrderId()]);
        },
        error: (err) => {
          this.loading.set(false);
          this.toastService.error(
            err.message || 'Error al actualizar la orden',
          );
        },
      });
  }

  private loadStoreSettings(): void {
    this.store
      .select(selectStoreSettings)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((storeSettings: any) => {
        if (!storeSettings) {
          return;
        }

        if (!storeSettings.pos) {
          this.hydrateMissingPosSettings();
          return;
        }

        this.applyPosSettings(storeSettings);
      });
  }

  private applyPosSettings(settings: any): void {
    if (settings?.general?.timezone) {
      this.storeTimezone.set(settings.general.timezone);
    }

    const posSettings = settings?.pos;
    if (!posSettings) {
      return;
    }

    this.enableScheduleValidation.set(
      posSettings.enable_schedule_validation === true,
    );
    this.businessHours.set(posSettings.business_hours || {});

    const cashRegisterSettings = posSettings.cash_register;
    const crEnabled = cashRegisterSettings?.enabled === true;
    this.cashRegisterEnabled.set(crEnabled);
    this.cashRegisterService.setFeatureEnabled(crEnabled);
    this.paymentService.setRequireSessionForSales(
      cashRegisterSettings?.require_session_for_sales === true,
    );

    if (crEnabled && !this.cashRegisterSessionInitialized) {
      this.cashRegisterSessionInitialized = true;
      this.initCashRegisterSession();
    } else if (!crEnabled) {
      this.cashRegisterSessionInitialized = false;
      this.cashRegisterService.clearSession();
      this.activeSession.set(null);
    }

    const customerQueueSettings = posSettings.customer_queue;
    const cqEnabled = customerQueueSettings?.enabled === true;
    this.queueEnabled.set(cqEnabled);
    if (cqEnabled && !this.queueSubscriptionInitialized) {
      this.queueSubscriptionInitialized = true;
      this.initQueueSubscription();
    } else if (!cqEnabled) {
      this.queueSubscriptionInitialized = false;
    }

    if (!cashRegisterSettings || !customerQueueSettings) {
      this.hydrateMissingPosSettings();
    }

    this.validateLocalScheduleIfNeeded();
  }

  private hydrateMissingPosSettings(): void {
    if (this.posSettingsHydrationRequested) {
      return;
    }

    this.posSettingsHydrationRequested = true;
    this.settingsService
      .getSettings({ forceRefresh: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response?.data?.pos) {
            this.applyPosSettings(response.data);
          }
        },
        error: (error) => {
          console.warn('No se pudo hidratar la configuración POS', error);
        },
      });
  }

  private validateLocalScheduleIfNeeded(): void {
    if (
      this.scheduleHandledByBackend() ||
      !this.scheduleStatusChecked() ||
      !this.enableScheduleValidation()
    ) {
      return;
    }

    const localOutOfHours = !this.isWithinBusinessHours();
    if (!localOutOfHours) {
      return;
    }

    this.isActuallyOutOfHours.set(true);
    if (this.canBypassSchedule()) {
      return;
    }

    this.isOutOfHours.set(true);
    this.nextOpenTime.set(this.getLocalNextOpenDay());
    this.outOfHoursMessage.set(
      'El punto de venta está fuera del horario de atención configurado (Validación local).',
    );
  }

  private initQueueSubscription(): void {
    this.queueService
      .loadQueue()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();

    this.queueService.waitingCount
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((count) => {
        this.queueCount.set(count);
      });
  }

  onOpenQueueModal(): void {
    this.editingCustomer.set(null);
    this.openInQueueMode.set(true);
    this.showCustomerModal.set(true);
  }

  private getDateInTimezone(): { day: number; hours: number; minutes: number } {
    const now = new Date();
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: this.storeTimezone(),
        weekday: 'short',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      }).formatToParts(now);

      const weekdayStr = parts.find((p) => p.type === 'weekday')?.value || '';
      const hoursVal = parseInt(
        parts.find((p) => p.type === 'hour')?.value || '0',
        10,
      );
      const minutesVal = parseInt(
        parts.find((p) => p.type === 'minute')?.value || '0',
        10,
      );

      const weekdayMap: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      const dayVal = weekdayMap[weekdayStr] ?? now.getDay();

      return { day: dayVal, hours: hoursVal, minutes: minutesVal };
    } catch {
      return {
        day: now.getDay(),
        hours: now.getHours(),
        minutes: now.getMinutes(),
      };
    }
  }

  private isWithinBusinessHours(): boolean {
    if (!this.enableScheduleValidation()) {
      return true;
    }

    const { day, hours, minutes } = this.getDateInTimezone();
    const dayNames = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];
    const currentDayName = dayNames[day];

    const todayHours = this.businessHours()?.[currentDayName];

    if (!todayHours) {
      return true;
    }

    const currentTime = hours * 60 + minutes;

    // Custom mode: multiple blocks
    if (todayHours.blocks && todayHours.blocks.length > 0) {
      for (const block of todayHours.blocks) {
        if (block.open === 'closed' || block.close === 'closed') continue;
        const [oH, oM] = block.open.split(':').map(Number);
        const [cH, cM] = block.close.split(':').map(Number);
        const openTime = oH * 60 + oM;
        const closeTime = cH * 60 + cM;
        if (currentTime >= openTime && currentTime <= closeTime) return true;
      }
      return false;
    }

    // Continuous mode: single block
    if (todayHours.open === 'closed' || todayHours.close === 'closed') {
      return false;
    }

    const [openHour, openMinute] = todayHours.open.split(':').map(Number);
    const [closeHour, closeMinute] = todayHours.close.split(':').map(Number);

    const openTime = openHour * 60 + openMinute;
    const closeTime = closeHour * 60 + closeMinute;

    return currentTime >= openTime && currentTime <= closeTime;
  }

  private getLocalNextOpenDay(): string {
    const dayNames = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];
    const spanishDays: Record<string, string> = {
      sunday: 'Domingo',
      monday: 'Lunes',
      tuesday: 'Martes',
      wednesday: 'Miércoles',
      thursday: 'Jueves',
      friday: 'Viernes',
      saturday: 'Sábado',
    };

    const { day, hours, minutes } = this.getDateInTimezone();
    const curMinutes = hours * 60 + minutes;

    const todayName = dayNames[day];
    const todayHours = this.businessHours()?.[todayName];

    if (todayHours) {
      if (todayHours.blocks && todayHours.blocks.length > 0) {
        for (const block of todayHours.blocks) {
          if (block.open !== 'closed' && block.close !== 'closed') {
            const [openH, openM] = block.open.split(':').map(Number);
            if (curMinutes < openH * 60 + openM) {
              return `Hoy ${this.formatBlocksForDisplay(todayHours.blocks)}`;
            }
          }
        }
      } else if (todayHours.open !== 'closed' && todayHours.close !== 'closed') {
        const [openH, openM] = todayHours.open.split(':').map(Number);
        if (curMinutes < openH * 60 + openM) {
          return `Hoy ${todayHours.open} - ${todayHours.close}`;
        }
      }
    }

    for (let i = 1; i <= 7; i++) {
      const dayIndex = (day + i) % 7;
      const dayName = dayNames[dayIndex];
      const bh = this.businessHours()?.[dayName];
      if (!bh) continue;

      if (bh.blocks && bh.blocks.length > 0) {
        const hasOpen = bh.blocks.some(b => b.open !== 'closed' && b.close !== 'closed');
        if (hasOpen) {
          return `${spanishDays[dayName]} ${this.formatBlocksForDisplay(bh.blocks)}`;
        }
      } else if (bh.open !== 'closed' && bh.close !== 'closed') {
        return `${spanishDays[dayName]} ${bh.open} - ${bh.close}`;
      }
    }

    return 'Consultar configuración';
  }

  private formatBlocksForDisplay(blocks: Array<{ open: string; close: string }>): string {
    return blocks
      .filter(b => b.open !== 'closed' && b.close !== 'closed')
      .map(b => `${b.open} - ${b.close}`)
      .join(', ');
  }

  private initCashRegisterSession(): void {
    this.cashRegisterService
      .fetchActiveSession()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((session) => {
        if (session !== null) {
          this.cashRegisterService.activeSession.set(session);
        }
      });
  }

  onSessionOpened(session: CashRegisterSession): void {
    this.cashRegisterService.activeSession.set(session);
    this.showSessionOpenModal.set(false);
    this.toastService.success(`Caja "${session.register?.name}" abierta`);
  }

  onSessionClosed(session: CashRegisterSession): void {
    this.cashRegisterService.activeSession.set(null);
    this.showSessionCloseModal.set(false);

    this.closedSessionIdForSummary.set(session.id);
    this.showAISummaryModal.set(true);

    const diff = Number(session.difference || 0);
    const diffStr =
      diff >= 0 ? `+$${diff.toFixed(2)}` : `-$${Math.abs(diff).toFixed(2)}`;
    this.toastService.info(
      `Caja cerrada. Diferencia: ${diffStr}`,
      'Cierre de Caja',
      6000,
    );
  }

  onMovementCreated(_movement: any): void {
    this.showCashMovementModal.set(false);
  }
}
