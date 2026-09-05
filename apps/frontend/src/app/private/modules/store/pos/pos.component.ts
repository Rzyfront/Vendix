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
import type {
  FirePreview,
  FireItemExclusion,
  FireConfirmPayload,
} from '../restaurant-ops/kds/interfaces';
import { KitchenConfirmModalComponent } from '../restaurant-ops/kds/components/kitchen-confirm-modal/kitchen-confirm-modal.component';
import { take, switchMap, catchError } from 'rxjs/operators';
import { of as rxjsOf } from 'rxjs';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import {
  VexiPosBridgeService,
  type VexiPosActionResult,
  type VexiPosCartSnapshot,
} from '../../../../core/services/vexi-pos-bridge.service';
import { VexiUiContextService } from '../../../../core/services/vexi-ui-context.service';
import {
  VexiUiHostRegistry,
  type VexiUiAction,
  type VexiUiActionResult,
  type VexiUiHost,
  type VexiUiScreen,
} from '../../../../core/services/vexi-ui-host.registry';

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
} from '../../../../shared/components';
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
import { AddCustomItemRequest, CartSummary } from './models/cart.model';
import { PosCustomItemModalComponent } from './components/pos-custom-item-modal/pos-custom-item-modal.component';
import { resolveSaleQuantity } from './utils/line-units.util';
import { environment } from '../../../../../environments/environment';
import {
  PosCustomerService,
  PosCustomer,
} from './services/pos-customer.service';
import { PosPaymentService } from './services/pos-payment.service';
import { PosOrderService } from './services/pos-order.service';
import { StoreOrdersService } from '../orders/services/store-orders.service';
import { PosProductSelectionComponent } from './components/pos-product-selection.component';
import { PosBarcodeService } from './services/pos-barcode.service';
import {
  PosProductService,
  Product,
  PosProductVariant,
} from './services/pos-product.service';
import { PosCustomerModalComponent } from './components/pos-customer-modal.component';
import { PosCheckoutShellComponent } from './components/pos-checkout-shell/pos-checkout-shell.component';
import { PosOrderConfirmationComponent } from './components/pos-order-confirmation.component';
import { PosCartComponent } from './cart/pos-cart.component';
import { PosMobileFooterComponent } from './components/pos-mobile-footer.component';
import { PosCartModalComponent } from './components/pos-cart-modal.component';
import { PosOrderCreateResult } from './models/order.model';
import { StoreSettingsService } from '../settings/general/services/store-settings.service';
import { HttpClient } from '@angular/common/http';
import { StoreSettingsFacade } from '../../../../core/store/store-settings/store-settings.facade';
import { DispatchTicketPrintService } from '../dispatch-ticket/services/dispatch-ticket-print.service';
import type { DispatchTicketData } from '../dispatch-ticket/models/dispatch-ticket-data.model';
import {
  shouldAutoPrintDispatchTicket,
  type ShouldAutoPrintDispatchTicketContext,
} from '../../../../shared/services/print/dispatch-ticket-autoprint';
import { PaymentMethodsCatalogService } from '../../../../shared/services/payment-methods-catalog.service';
import { OrderPaymentModalComponent } from '../orders/components/order-payment-modal/order-payment-modal.component';
import type { Order } from '../orders/interfaces/order.interface';
import type { PayOrderDto } from '../orders/interfaces/order.interface';
import {
  PaymentMethodState,
  type StorePaymentMethod,
} from '../settings/payments/interfaces/payment-methods.interface';
import type { PaymentMethod as CanonicalPaymentMethod } from '../../../../shared/models/payment-method.model';
import { EMPTY_CART_MESSAGE } from '../../../../core/utils/error-messages';
import type { PaymentSubmit } from '../../../../shared/components';
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
import { BookingSchedulerModalComponent } from '../../../../shared/components/booking-scheduler-modal/booking-scheduler-modal.component';
import { PosAISummaryModalComponent } from './components/pos-ai-summary-modal.component';
import {
  PosRestaurantIntegrationService,
  CounterOrderLine,
  PosFireItemNote,
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
    KitchenConfirmModalComponent,
    FormsModule,
    ButtonComponent,
    IconComponent,
    PosCustomItemModalComponent,
    SpinnerComponent,
    CardComponent,
    PosProductSelectionComponent,
    PosCustomerModalComponent,
    PosCheckoutShellComponent,
    PosOrderConfirmationComponent,
    PosCartComponent,
    BadgeComponent,
    PosMobileFooterComponent,
    PosCartModalComponent,
    PosSessionStatusBarComponent,
    PosSessionOpenModalComponent,
    PosSessionCloseModalComponent,
    PosCashMovementModalComponent,
    PosSessionDetailModalComponent,
    PosScheduleIndicatorComponent,
    PosScheduleModalComponent,
    PosHeaderDropdownComponent,
    LayawayConfigModalComponent,
    BookingSchedulerModalComponent,
    PosAISummaryModalComponent,
    OrderPaymentModalComponent,
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
                [readyToPayOrder]="readyToPayOrder()"
                [isCharging]="isCharging()"
                (create)="onOpenCreateModal()"
                (saveDraft)="onSaveDraft()"
                (shipping)="onShipping()"
                (checkout)="onCheckout()"
                (charge)="onCharge()"
                (quote)="onQuote()"
                (layaway)="onLayaway()"
                (customerSelected)="onCustomerSelected($event)"
                (bookingsChanged)="onBookingsChanged($event)"
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
          [isEditMode]="isEditMode()"
          [readyToPayOrder]="readyToPayOrder()"
          [isCharging]="isCharging()"
          [canCreateCustomItems]="canCreateCustomItems()"
          (viewCart)="onOpenCartModal()"
          (customItem)="openCustomItemModal()"
          (create)="onOpenCreateModal()"
          (saveDraft)="onSaveDraft()"
          (shipping)="onShipping()"
          (checkout)="onCheckout()"
          (charge)="onCharge()"
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
        [isEditMode]="isEditMode()"
        [readyToPayOrder]="readyToPayOrder()"
        [isCharging]="isCharging()"
        (closed)="onCloseCartModal()"
        (customItemRequested)="openCustomItemModal()"
        (itemPriceEditRequested)="editItemPriceFromMobile($event)"
        (itemQuantityChanged)="onCartItemQuantityChanged($event)"
        (itemRemoved)="onCartItemRemoved($event)"
        (clearCart)="onClearCart()"
        (create)="onOpenCreateModal()"
        (saveDraft)="onSaveDraft()"
        (shipping)="onShippingFromModal()"
        (checkout)="onCheckoutFromModal()"
        (charge)="onCharge()"
      ></app-pos-cart-modal>

      <!--
        Ítem personalizado (camino móvil). Mismo modal compartido que usa el
        carrito de escritorio y el carril fiscal: una sola captura, un solo
        contrato. Ver pos-custom-item-modal.component.ts.
      -->
      <app-pos-custom-item-modal
        [open]="customItemModalOpen()"
        [taxCategories]="taxCategories()"
        (added)="addCustomItemFromMobile($event)"
        (closed)="closeCustomItemModal()"
      ></app-pos-custom-item-modal>

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

      <!-- Fase 5·B3: SHELL de checkout con stepper — único checkout del POS
           (cobro, cliente, envío y "Guardar borrador" en el footer). El paso
           Cobro autocarga sus métodos, por eso no se bindea [paymentMethods]. -->
      <app-pos-checkout-shell
        [isOpen]="showCheckoutModal()"
        [cartState]="cartState()"
        [checkoutIntent]="checkoutIntent()"
        [isRestaurantWithPrepared]="isRestaurantWithPrepared()"
        [tableId]="restaurantIntegration.currentTableSession()?.table_id ?? null"
        [mode]="checkoutMode()"
        [editingOrderId]="editingOrderIdAsNumber()"
        (isOpenChange)="showCheckoutModal.set($event)"
        (closed)="showCheckoutModal.set(false)"
        (checkoutCompleted)="onPaymentCompleted($event)"
        (shippingCompleted)="onShippingCompleted($event)"
        (requestCustomer)="onOpenCustomerModal()"
        (customerSelected)="onPaymentCustomerSelected($event)"
        (tableSessionOpened)="onPaymentTableSessionOpened($event)"
        (draftSaved)="onCreateOrderConfirmed($event)"
        (editorUpdated)="onEditorUpdated($event)"
      ></app-pos-checkout-shell>

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

      @if (showReservationModal()) {
        <app-booking-scheduler-modal
          [product]="pendingBookingProduct()"
          [posCustomer]="selectedCustomer()"
          (customerSelected)="onCustomerSelected($event)"
          (scheduled)="onPosServiceScheduled($event)"
          (cancelled)="showReservationModal.set(false)"
        ></app-booking-scheduler-modal>
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
    </div>
    <!--
      QUI-655 — el POS es el SEGUNDO camino de envio a cocina. Sin este modal, un
      envio hecho desde el POS consumia la receta completa sin darle al cajero la
      chance de excluir.
    -->
    <app-kitchen-confirm-modal
      [isOpen]="kitchenConfirmOpen()"
      [preview]="kitchenPreview()"
      [isLoading]="kitchenPreviewLoading()"
      [isSubmitting]="loading()"
      (confirmed)="onKitchenConfirmed($event)"
      (cancelled)="onKitchenCancelled()"
    />

    <!--
      Phase D.3 — Cobrar sobre la orden recién actualizada.
      El POS NO abre el payment collector del checkout-shell aquí: reutiliza el
      componente de pago OrderPaymentModalComponent que ya existe para
      order-details, alimentado con la orden fresca (readyToPayOrder), los
      métodos habilitados del catálogo y los datos de solo-lectura (cuotas,
      balance, crédito). El submit va al endpoint canónico flow/pay. NO navega
      a detalle.
    -->
    <app-order-payment-modal
      [isOpen]="chargeModalOpen()"
      [order]="readyToPayOrder()"
      [paymentMethods]="storePaymentMethodsForModal()"
      [isCreditOrder]="false"
      [remainingBalance]="0"
      [installments]="[]"
      [isProcessing]="isCharging()"
      (isOpenChange)="chargeModalOpen.set($event)"
      (closed)="onChargeModalClosed()"
      (paymentSubmitted)="onPaymentSubmitted($event)"
    ></app-order-payment-modal>
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
    // Bug 1 (Fase K): lines flagged skipKds don't go to the kitchen,
    // so they must not be counted as "unfired prepared". The kitchen
    // dispatch and the table-append gate both depend on this signal.
    return this.cartItems().some(
      (it) =>
        it.itemType !== 'custom' &&
        it.product?.product_type === 'prepared' &&
        it.skipKds !== true,
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

  /**
   * CP-POS-SVC-PERF-001 / Annotation-4 — read-once from
   * `settings.reservations.allow_bookings_without_payment`. Defaults to
   * `true` while settings are loading so an empty cache can't lock the
   * cashier out of scheduling. Refreshed via `loadReservationsPolicy()`
   * whenever the user opens the POS so a config change in
   * /admin/settings/general/reservas takes effect without a full
   * reload.
   */
  readonly allowBookingsWithoutPayment = signal<boolean>(true);

  /**
   * CP-POS-SVC-PERF-001 / D.2 — booking blocks emitted by the cart
   * scheduler, keyed by `cartItemId`. The editor attaches the matching
   * block to each item when building the `UpdateOrderEditorDto`.
   * Re-agendamiento sends `booking_id` so the existing row is updated.
   */
  cartBookingsFromChild = signal<Map<string, any>>(new Map());

  onBookingsChanged(map: Map<string, any>): void {
    const sz = map ? map.size : -1;
    console.log('POS-DBG onBookingsChanged size=', sz);
    this.cartBookingsFromChild.set(new Map(map ?? []));
  }

  /**
   * CP-POS-SVC-PERF-001 / Annotation-3 — fire any pending booking blocks
   * collected by the cart scheduler once the order is persisted. New
   * bookings hit POST /api/store/reservations with order_id so the
   * booking row is born attached to the order. Re-agendar hits PUT
   * /api/store/reservations/:id to update the existing row in place.
   * Failures are surfaced via toast and logged so the cashier can
   * retry; the order is already saved, so a failed booking never
   * orphans the draft.
   */
  private firePendingBookingsAfterDraft(orderId: number, opts?: { force?: boolean }): void {
    // CP-POS-SVC-PERF-001 / Annotation-4 — respect the store-level
    // `allow_bookings_without_payment` flag unless forced (e.g. on direct Cobrar/payment).
    if (!opts?.force && !this.allowBookingsWithoutPayment()) return;

    const map = this.cartBookingsFromChild();
    const customerId = this.cartState()?.customer?.id ?? null;
    const blocksToFire: any[] = [];
    const seenKeys = new Set<string>();

    // 1. Check cartBookingsFromChild map
    if (map && map.size > 0) {
      for (const [key, block] of map.entries()) {
        if (block && (block.date || block.start_time)) {
          blocksToFire.push({ ...block, _cartKey: key });
          seenKeys.add(String(key));
          if (block.cart_item_id) seenKeys.add(String(block.cart_item_id));
        }
      }
    }

    // 2. Check cartState().items for attached .booking
    const items = this.cartState()?.items ?? [];
    for (const item of items) {
      if (item.booking && (item.booking.date || item.booking.start_time)) {
        const itemId = String(item.id);
        if (!seenKeys.has(itemId) && !seenKeys.has(`cart-${itemId}`)) {
          blocksToFire.push({
            ...item.booking,
            product_id: Number(item.product?.id),
            product_variant_id: item.variant_id ?? null,
            cart_item_id: item.id,
            _cartKey: itemId,
          });
          seenKeys.add(itemId);
          seenKeys.add(`cart-${itemId}`);
        }
      }
    }

    // 3. Check cartState().pendingBookings
    const pending = this.cartState()?.pendingBookings ?? [];
    for (const pb of pending) {
      if (pb && (pb.date || pb.start_time)) {
        const alreadyIncluded = blocksToFire.some(
          (b) =>
            Number(b.product_id) === Number(pb.product_id) &&
            b.date === pb.date &&
            b.start_time === pb.start_time,
        );
        if (!alreadyIncluded) {
          blocksToFire.push({
            ...pb,
            product_id: Number(pb.product_id),
            product_variant_id: pb.product_variant_id ?? null,
            cart_item_id: `cart-${pb.product_id}`,
          });
        }
      }
    }

    console.log('[POS-DBG] firePendingBookingsAfterDraft orderId=', orderId, 'force=', opts?.force, 'totalBlocks=', blocksToFire.length, blocksToFire);
    if (blocksToFire.length === 0) return;

    for (const block of blocksToFire) {
      let resolvedProductId = block.product_id;
      let resolvedVariantId = block.product_variant_id ?? null;
      if (!resolvedProductId) {
        const cartItem = items.find(
          (it) =>
            it.id === block.cart_item_id ||
            `cart-${it.id}` === block.cart_item_id ||
            String(it.id) === String(block._cartKey),
        );
        if (cartItem) {
          resolvedProductId = Number(cartItem.product?.id) || null;
          resolvedVariantId = resolvedVariantId ?? cartItem.variant_id ?? null;
        }
      }
      if (!resolvedProductId) {
        console.warn('[POS-DBG] Skipping booking with no resolved product_id:', block);
        continue;
      }

      const payload: any = {
        product_id: Number(resolvedProductId),
        product_variant_id: resolvedVariantId ? Number(resolvedVariantId) : null,
        customer_id: customerId ? Number(customerId) : (block.customer_id ? Number(block.customer_id) : null),
        provider_id: block.provider_id ? Number(block.provider_id) : null,
        date: block.date,
        start_time: block.start_time,
        end_time: block.end_time,
        notes: block.notes ?? '',
        service_location_type: block.service_location_type ?? 'shop',
        channel: 'pos',
        cart_item_id: block.cart_item_id ?? null,
        order_id: Number(orderId),
      };

      const existingId = Number(block.booking_id || block.id);
      const isUpdate = Number.isFinite(existingId) && existingId > 0;
      const request$ = isUpdate
        ? this.http.put(
            `${environment.apiUrl}/store/reservations/${existingId}`,
            payload,
          )
        : this.http.post(`${environment.apiUrl}/store/reservations`, payload);

      request$
        .pipe(
          catchError((err) => {
            console.error('[POS-DBG] Failed to persist booking for order', orderId, err);
            this.toastService.error(
              err?.error?.message ??
                'No se pudo agendar la cita. Intenta desde el detalle.',
            );
            return rxjsOf(null);
          }),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((res) => {
          console.log('[POS-DBG] Successfully persisted booking for order', orderId, res);
        });
    }
  }

  showCustomerModal = signal(false);
  editingCustomer = signal<PosCustomer | null>(null);

  /**
   * Fase 5·B3: SHELL unificado de checkout (stepper) — único punto de entrada
   * del cobro. Cubre cobro sin envío ('pickup'), delivery y "Guardar borrador"
   * desde el footer; los 3 modales viejos ya fueron retirados.
   */
  showCheckoutModal = signal(false);
  checkoutIntent = signal<'pickup' | 'delivery'>('pickup');
  /** Fulfillment type chosen for the current payment. Mirrors the
   *  payment-modal selector so the parent can react when the modal closes. */
  paymentFulfillment = signal<'consumo' | 'entrega' | null>(null);
  /** Table id chosen for the current payment. */
  paymentTableId = signal<number | null>(null);

  showOrderConfirmation = signal(false);
  productRefreshCounter = signal(0);
  showCartModal = signal(false);
  customItemModalOpen = signal(false);
  taxCategories = signal<TaxCategory[]>([]);

  currentOrderId = signal<string | null>(null);
  currentOrderNumber = signal<string | null>(null);
  completedOrder = signal<any>(null);

  // Edit mode
  isEditMode = signal(false);
  editingOrderId = signal<string | null>(null);
  editingOrderNumber = signal<string | null>(null);
  /**
   * Phase D.1 — order-level metadata (shipping method/rate/cost/address,
   * payment/installments/credit read-only, KDS read-only). Lives outside the
   * cart because the cart only owns lines + customer + discounts. The backend
   * response from `GET /store/orders/:id` is the source of truth for these
   * fields; the cart uses them for the editor preview only.
   */
  editingOrder = signal<Order | null>(null);
  /**
   * Phase D.2 / D.3 — explicit mode for create-vs-edit. `create-draft` saves
   * a draft without opening payment; `edit` updates the order in place and
   * keeps the cashier in POS; `create-payment` would be reserved for future
   * direct-charge flows. Today only the first two are wired.
   */
  mode = signal<'create-draft' | 'edit' | 'create-payment'>('create-draft');

  // CP-POS-MODAL-SCOPE-001 / Phase A.4 — `checkoutMode` projects the internal
  // `mode` signal onto the value the shell expects, defaulting to
  // 'create-draft' for any caller that does not bind it explicitly.
  readonly checkoutMode = computed<'create-draft' | 'edit' | 'create-payment'>(
    () => this.mode(),
  );

  // CP-POS-MODAL-SCOPE-001 / Phase A.4 — `editingOrderId` is stored as a
  // string (matches the route param convention); the shell expects a number.
  readonly editingOrderIdAsNumber = computed<number | null>(() => {
    const id = this.editingOrderId();
    if (!id) return null;
    const n = Number(id);
    return Number.isFinite(n) ? n : null;
  });
  /**
   * Phase D.3 — fresh order returned by `PUT /store/orders/:id/editor`. The
   * `Cobrar` CTA in the cart footer and mobile footer renders ONLY when this
   * is non-null; clicking it mounts the reused `OrderPaymentModalComponent`
   * with the canonical `flow/pay` submit. Cleared on success or exit.
   */
  readyToPayOrder = signal<Order | null>(null);
  chargeModalOpen = signal(false);
  isCharging = signal(false);
  /**
   * Enabled payment methods for the active store, fetched once via the shared
   * catalog. Stored in the canonical `PaymentMethod` shape from
   * `payment-method.model`. The OrderPaymentModal needs the richer
   * `StorePaymentMethod[]` shape, so we expose a converter (see
   * `storePaymentMethodsForModal()`) rather than mutate the signal type —
   * keeps the catalog consumer-readable and avoids a parallel cache.
   */
  paymentMethodsCatalog = signal<CanonicalPaymentMethod[]>([]);

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
  private vexiPos = inject(VexiPosBridgeService);
  private vexiHosts = inject(VexiUiHostRegistry);
  private vexiUiContext = inject(VexiUiContextService);
  private paymentService = inject(PosPaymentService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private store = inject(Store);
  private route = inject(ActivatedRoute);
  private posOrderService = inject(PosOrderService);
  private ordersService = inject(StoreOrdersService);
  private settingsService = inject(StoreSettingsService);
  // CP-POS-SVC-PERF-001 / Annotation-3 — fire orphan bookings on Guardar
  // so a draft order with a service line carries its `bookings` row even
  // when the cashier never opens Actualizar / Cobrar. The editor atomic
  // path already handles bookings on the Actualizar / Cobrar side.
  private http = inject(HttpClient);
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
  // Phase D.3 — settings facade + payment catalog are read-only inputs here.
  private readonly settingsFacade = inject(StoreSettingsFacade);
  private readonly paymentMethodsCatalogService = inject(
    PaymentMethodsCatalogService,
  );
  // CP-DTLP Phase E.2 — disparador POS del tiquete de despacho (cadena
  // explícita al cierre de venta, defense-in-depth del `maybeAutoPrint`).
  private readonly dispatchTicketPrint = inject(DispatchTicketPrintService);

  readonly canCreateCustomItems = computed(() =>
    this.hasPermission('store:pos:custom_items:create'),
  );
  readonly canOverridePrices = computed(() =>
    this.hasPermission('store:pos:price_override'),
  );

  constructor() {
    // Vexi reaches the POS through this handle while the screen is mounted.
    // Registering here rather than letting the command service query the URL
    // means "is the POS open" is answered by the component's own lifetime —
    // the two disagree during a route transition, and an item added to a
    // screen that is tearing down is silently lost.
    this.vexiPos.register(this);
    this.destroyRef.onDestroy(() => this.vexiPos.unregister(this));

    // Registered on the generic registry too, through an adapter rather than by
    // implementing the interface on the component. The POS already owns method
    // names like `refresh`, and the adapter keeps the two contracts from
    // colliding while still exposing what the generic commands need — chiefly
    // `ui_read_screen`, so "cóbrame esto" has a referent while the person is
    // looking at the cart.
    this.vexiHosts.register(this.vexiHostAdapter);
    this.destroyRef.onDestroy(() =>
      this.vexiHosts.unregister(this.vexiHostAdapter),
    );

    // The cart travels with every turn as prompt context, not as a tool result.
    // `ui_pos_read_cart` is a `clientSide` tool, so the browser runs it and the
    // server never learns the answer — for a *read* that is the whole point of
    // the call, which left Vexi asked "¿qué llevo?" with nothing to say. The
    // context channel and its backend renderer (`buildUiContext`) already
    // existed and simply had no producer; this is it. Pushed from an effect so
    // the snapshot is current at send time, and cleared on destroy because a
    // cart reported from a screen the user already left is worse than none.
    effect(() => {
      const summary = this.cartSummary();
      const customer = this.selectedCustomer();
      this.vexiUiContext.contribute('pos', {
        pos: {
          item_count: this.cartItems().length,
          total: summary.total,
          customer: customer
            ? `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() ||
              null
            : null,
        },
      });
    });
    this.destroyRef.onDestroy(() => this.vexiUiContext.clear('pos'));

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

  /**
   * Bug 1 (Fase K): a table session was opened from inside the payment
   * modal. The integration service already updated its
   * `currentTableSession` signal inside `openTableSession`; we only
   * need to mirror the tableId on the local payment state so the next
   * open of the modal keeps it.
   */
  onPaymentTableSessionOpened(result: any): void {
    const tableId = result?.session?.table_id ?? null;
    if (tableId != null) {
      this.paymentTableId.set(tableId);
    }
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
        //
        // QUI-648: cuando el código pistoleado es el de una PRESENTACIÓN, el
        // backend devuelve `scanned_price_tier_id` sobre el mismo producto y
        // `onAddToCart` lo agrega con esa presentación ya aplicada. No se
        // ramifica acá a propósito: todo add sigue pasando por el hijo, que es
        // el que valida stock y emite los toasts.
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
   * CP-POS-CREAR-EDITAR-COBRAR-001 — Guardar must open the customer-selection
   * modal (Venta Anónima / Con Cliente) before persisting the order, like
   * Cobrar does. The operator chooses the sale type first; the shell's
   * "Guardar borrador" footer button then calls `paymentService.saveDraft`
   * with `is_draft=true, requires_payment=false` and NEVER opens the payment
   * step — the Cobrar button is the only one that drives `flow/pay`.
   *
   * Reusing the unified checkout shell (vs. a dedicated customer modal) keeps
   * the two-button contract on a single component: same Venta Anónima
   * default from `pos.anonymous_sales_as_default`, same POS-side customer
   * gate from `pos.allow_anonymous_sales`, same `canBeAnonymous()` guard.
   * The shell's internal `onSaveDraft` already validates `state.customer` and
   * surfaces `POS_CUSTOMER_REQUIRED_001` if the backend rejects the request.
   */
  onSaveDraft(): void {
    if (!this.cartState() || this.isEmpty) {
      this.toastService.warning(EMPTY_CART_MESSAGE);
      return;
    }
    // Close the mobile cart modal so the checkout shell is the only
    // full-screen dialog open at a time.
    this.showCartModal.set(false);
    // Phase D.2 — explicit draft-create mode. The shell owns the customer
    // gate + saveDraft call; the parent just opens it. The (checkoutCompleted)
    // output stays reserved for the flow-pay path that Cobrar drives.
    this.mode.set('create-draft');
    this.checkoutIntent.set('pickup');
    this.showCheckoutModal.set(true);
  }

  /**
   * Fase 5·B3: the "Crear orden / Guardar borrador" flow now lives inside
   * the checkout shell footer. This entrypoint just opens the shell in
   * pickup intent; the shell owns the create flow (retail draft /
   * restaurant counter draft / append-to-table) and the KDS fire, and
   * clears the cart on success.
   */
  onOpenCreateModal(): void {
    if (!this.cartState() || this.isEmpty) return;
    // Close the mobile cart modal so the checkout shell is the only
    // full-screen dialog open at a time.
    this.showCartModal.set(false);
    // Phase D.2 — explicit mode: this branch is a draft-create, never a
    // payment. The checkout-shell's `(checkoutCompleted)` is reserved for
    // the flow-pay path; the draft path emits `(draftSaved)` and never opens
    // a payment collector.
    this.mode.set('create-draft');
    this.checkoutIntent.set('pickup');
    this.showCheckoutModal.set(true);
  }

  /**
   * Phase D.2 — draft-only post-create handler invoked by the checkout
   * shell `(draftSaved)` output.
   *
   * - Persists the new order id so the operator can re-print / track it.
   * - Surfaces the order-confirmation screen.
   * - DOES NOT open a payment collector.
   * - DOES NOT navigate to the order detail page.
   *
   * The previous flow conflated create-with-payment and create-with-draft,
   * so this handler is the explicit "draft saved, pending payment" path.
   */
  onCreateOrderConfirmed(result: PosOrderCreateResult): void {
    if (!result?.order) return;
    this.mode.set('create-draft');
    this.currentOrderId.set(result.order.id ? String(result.order.id) : null);
    this.currentOrderNumber.set(result.order.order_number ?? null);
    // CP-POS-SVC-PERF-001 / Annotation-3 — fire any pending booking blocks
    // collected by the cart scheduler if store policy allows bookings without payment.
    if (result.order?.id) {
      this.firePendingBookingsAfterDraft(Number(result.order.id));
    }
    const sc = this.selectedCustomer();
    const customerName =
      result.order?.customer_name ||
      (result.order?.customer?.first_name
        ? `${result.order.customer.first_name} ${result.order.customer.last_name || ''}`.trim()
        : null) ||
      (sc?.first_name ? `${sc.first_name} ${sc.last_name || ''}`.trim() : null) ||
      result.order?.customer?.name ||
      null;

    this.completedOrder.set({
      ...(result.order || {}),
      customer: result.order?.customer || sc || undefined,
      customer_name: customerName,
      customer_email:
        result.order?.customer_email ||
        result.order?.customer?.email ||
        sc?.email ||
        null,
      customer_tax_id:
        result.order?.customer_tax_id ||
        result.order?.customer?.document_number ||
        sc?.document_number ||
        null,
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
      this.toastService.warning(EMPTY_CART_MESSAGE);
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

    // La nota que el cajero escribió en el carrito (botón "Nota" →
    // `PosCartService.updateNotes`) es la nota de la cotización: antes se
    // enviaba `notes: ''` fijo y el texto se perdía sin aviso, así que la
    // cotización se guardaba sin nota y el papel salía sin ella.
    //
    // Se omite la clave cuando no hay texto, en vez de mandar '': al editar
    // una cotización existente `quotations.service.ts` hace
    // `updateQuotationDto.notes ?? quotation.notes`, y una cadena vacía
    // borraría la nota guardada. Mismo criterio que `onCreateOrder`.
    const cartNotes = this.cartState()?.notes?.trim();

    const dto = {
      customer_id: this.selectedCustomer()
        ? this.selectedCustomer()!.id
        : undefined,
      channel: 'pos' as const,
      items,
      ...(cartNotes ? { notes: cartNotes } : {}),
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
      this.toastService.warning(EMPTY_CART_MESSAGE);
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
    const items: Array<{
      product_id: number;
      quantity: number;
      product_variant_id?: number;
      is_takeaway?: boolean;
      notes?: string;
    }> = [];
    for (const it of cart?.items ?? []) {
      if (it.itemType === 'custom') continue;
      const productId = parseInt(
        typeof it.product.id === 'string'
          ? it.product.id
          : String(it.product.id),
        10,
      );
      if (!Number.isFinite(productId)) continue;
      const line: {
        product_id: number;
        quantity: number;
        product_variant_id?: number;
        is_takeaway?: boolean;
        notes?: string;
      } = {
        product_id: productId,
        quantity: it.quantity,
      };
      // QUI-653 — la decision "para llevar" viaja desde la linea del carrito
      // hasta `order_items.is_takeaway`. Solo se envia cuando esta marcada: el
      // backend ya tiene default false.
      if (it.isTakeaway) {
        line.is_takeaway = true;
      }
      if (it.variant_id != null) {
        line.product_variant_id = it.variant_id;
      }
      // QUI-787 — nota por linea del mesero para cocina ("sin cebolla",
      // "termino medio"). `TableSessionAddItem.notes` ya acepta el campo y
      // `kitchen-fire.service.ts` la propaga a `kitchen_ticket_items.notes`.
      // Trim para descartar whitespace-only y omitir si queda vacia.
      const trimmedNote = it.notes?.trim();
      if (trimmedNote) {
        line.notes = trimmedNote;
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
                ) && !this.isCartItemSkipKds(it.product_id, (it as any).product_variant_id ?? null),
            )
            .map((it) => it.id);
          if (orderItemIds.length === 0) {
            this.loading.set(false);
            this.toastService.success('Items enviados a la mesa');
            return;
          }
          this.fireWithKitchenConfirm(session.order_id, orderItemIds)
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
      // Restaurant Suite — Fase K Gap 1: items flagged skipKds
      // (cashier chose "Usar stock") are excluded from the kitchen
      // dispatch list. Their product stock is consumed at payment.
      if (it.skipKds) continue;
      preparedLines.push(line);
    }

    if (preparedLines.length === 0) {
      this.toastService.warning(
        'No hay platos preparados en el carrito para enviar a cocina',
      );
      return;
    }

    // Bug 4 (Fase K): orders.customer_id is optional. Only forward the
    // id when the operator actually picked a customer; otherwise the
    // integration service omits the field and the backend stores an
    // anonymous Consumidor Final order.
    const customer = this.selectedCustomer();
    const customerId =
      customer && Number.isFinite(Number(customer.id)) && Number(customer.id) > 0
        ? Number(customer.id)
        : 0;

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
          this.fireWithKitchenConfirm(order.id, orderItemIds)
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

    // CP-POS-MODAL-SCOPE-001 / Phase A.4 — edit mode now opens the shell
    // with `mode='edit'` (full wizard: Cliente + Cobro). The shell emits
    // `editorUpdated` after PUT /editor so the cashier can immediately
    // Cobrar from the same modal without leaving the POS. The legacy
    // `updateExistingOrder()` direct path (which produced "error al
    // validar") is removed in favour of the shell handler.
    if (this.isEditMode()) {
      this.mode.set('edit');
      this.checkoutIntent.set('pickup');
      this.showCheckoutModal.set(true);
      return;
    }

    // Fase 5·B3: el checkout sin envío ('pickup') pasa por el SHELL con
    // stepper — único checkout del POS. mode='create-payment' so the shell
    // skips Actualizar and shows only the Cobro CTA.
    this.mode.set('create-payment');
    this.checkoutIntent.set('pickup');
    this.showCheckoutModal.set(true);
  }

  /**
   * CP-POS-MODAL-SCOPE-001 / Phase A.4 — handler for the shell's
   * `(editorUpdated)` output. Refreshes `readyToPayOrder`, `editingOrder`,
   * and `cartState` so the cashier can immediately `Cobrar` the updated
   * order from the same shell without leaving the POS. We also surface a
   * confirmation screen so the cashier sees what changed.
   */
  onEditorUpdated(updatedOrder: Order | null): void {
    // CP-POS-MODAL-SCOPE-001 / Phase F.5 — the shell emits a no-op
    // `editorUpdated` with `null` when the PUT /editor request fails,
    // so the parent can release its own `loading` flag without waiting
    // for a fresh Order. On success the Order is non-null.
    if (!updatedOrder?.id) {
      this.loading.set(false);
      return;
    }
    this.readyToPayOrder.set(updatedOrder);
    this.editingOrder.set(updatedOrder);
    this.currentOrderId.set(String(updatedOrder.id));
    this.currentOrderNumber.set(updatedOrder.order_number ?? null);
    // Keep the cart in sync with the persisted order — items/prices/
    // totals now match what the backend returned. We do NOT clear the
    // cart (the cashier should be able to continue editing).
    const state = this.cartState();
    if (state) {
      this.cartState.set({ ...state, summary: state.summary });
    }
  }

  /**
   * Phase D.3 — open the reused `OrderPaymentModalComponent` over the fresh
   * `readyToPayOrder`. ALWAYS re-fetches the catalog: the operator may have
   * enabled a new method between the last editor save and the Cobrar click,
   * and the previous "skip when non-empty" guard silently kept the modal on
   * a stale method set. No navigation. No new modal definition.
   */
  onCharge(): void {
    // CP-POS-MODAL-SCOPE-001 / Phase A.4 — when editing, route the Cobrar
    // CTA through the shell (mode='edit') so the cashier re-validates
    // cliente + payment before POST flow/pay. The shell still falls back to
    // the legacy OrderPaymentModalComponent for non-edit flows.
    if (this.isEditMode()) {
      this.mode.set('edit');
      this.checkoutIntent.set('pickup');
      this.showCheckoutModal.set(true);
      return;
    }
    const order = this.readyToPayOrder();
    if (!order) {
      this.toastService.warning(
        'Primero actualiza la orden antes de cobrar.',
      );
      return;
    }
    this.fetchPaymentMethodsCatalog();
    this.chargeModalOpen.set(true);
  }

  /**
   * Adapt the canonical catalog (`PaymentMethod[]`) to the `StorePaymentMethod[]`
   * shape that `OrderPaymentModalComponent` expects. We re-hydrate the fields the
   * modal's `fromStorePaymentMethod` mapper reads:
   *  - `id`            → numeric when possible (the modal forwards it to
   *                       `flow/pay` as `store_payment_method_id`).
   *  - `display_name`  → catalog's `displayName` || `name`.
   *  - `state`         → 'enabled' for every catalog row (the catalog only
   *                       returns enabled methods).
   *  - `system_payment_method.{ type, name, provider, dian_code }` →
   *                       mirrored from the catalog `type` / `provider`.
   *  - `min_amount` / `max_amount` → forwarded as-is.
   *
   * Anything the catalog does not know about (e.g. the original `custom_config`,
   * `display_order`) is left undefined; the modal does not require those for
   * charging.
   */
  storePaymentMethodsForModal(): StorePaymentMethod[] {
    const nowIso = new Date().toISOString();
    return (this.paymentMethodsCatalog() ?? []).map((m) => ({
      id: String(m.id),
      store_id: 'catalog',
      system_payment_method_id: String(m.id),
      display_name: m.displayName ?? m.name ?? '',
      custom_config: {},
      state: m.enabled ? PaymentMethodState.ENABLED : PaymentMethodState.DISABLED,
      display_order: 0,
      min_amount: m.minAmount ?? undefined,
      max_amount: m.maxAmount ?? undefined,
      created_at: nowIso,
      updated_at: nowIso,
      system_payment_method: {
        id: String(m.id),
        name: m.name ?? '',
        display_name: m.displayName ?? m.name ?? '',
        description: '',
        type: m.type as any,
        provider: m.provider ?? '',
        is_active: m.enabled,
        requires_config: false,
        config_schema: {},
        default_config: {},
        supported_currencies: [],
        processing_fee_type: 'FIXED' as any,
        processing_fee_value: 0,
        dian_code: m.dianCode,
        created_at: nowIso,
        updated_at: nowIso,
      },
    }));
  }

  /**
   * Phase D.3 — modal close (Cancel / Escape / backdrop). Clearing
   * `readyToPayOrder` here would lose the next-step context; we keep it so the
   * cashier can reopen the modal until they leave the POS or pick a fresh
   * order. Only an explicit success clears it.
   */
  onChargeModalClosed(): void {
    this.chargeModalOpen.set(false);
  }

  /**
   * Phase D.3 — submit from `OrderPaymentModalComponent` maps to the canonical
   * `flow/pay` endpoint via `StoreOrdersService.flowPayOrder`. The modal emits
   * the collector's normalized `PaymentSubmit` (camelCase superset); we map it
   * to the `PayOrderDto` snake_case shape the backend expects, mirroring the
   * `order-details-page.component.ts` translation so the two call sites stay
   * in lock-step. `submit as any` is gone — the DTO is typed end-to-end.
   */
  onPaymentSubmitted(submit: PaymentSubmit): void {
    const order = this.readyToPayOrder();
    if (!order || !order.id) {
      this.toastService.error('No hay una orden lista para cobrar.');
      return;
    }
    if (submit.storePaymentMethodId == null) {
      this.toastService.error('Selecciona un método de pago válido');
      return;
    }
    // Round 3 MAJOR #6 — `payment_type` was decided by a binary check on
    // `methodType === 'wompi'`. That hardcoded 'wompi' as the only online
    // method, while `epayco`, `mercadopago` (and any future provider) would
    // silently map to 'direct' — a wrong classification that drives the
    // backend down the direct-payment code path with an async gateway payload.
    // The canonical, future-proof rule: a method is online iff its
    // `PaymentMethod.type` is one of the known online gateways.
    const ONLINE_PAYMENT_TYPES = new Set(['wompi', 'epayco', 'mercadopago']);
    const dto: PayOrderDto = {
      store_payment_method_id: Number(submit.storePaymentMethodId),
      payment_type: ONLINE_PAYMENT_TYPES.has(String(submit.methodType))
        ? 'online'
        : 'direct',
      ...(submit.amountReceived != null
        ? { amount_received: Number(submit.amountReceived) }
        : {}),
      ...(submit.amount != null ? { amount: Number(submit.amount) } : {}),
      ...(submit.reference ? { payment_reference: submit.reference } : {}),
      ...(submit.tip != null ? { tip_amount: Number(submit.tip) } : {}),
      ...(submit.installmentId != null
        ? { installment_id: Number(submit.installmentId) }
        : {}),
      ...(submit.wompi
        ? { wompi_payment_method: submit.wompi as unknown as never }
        : {}),
      ...(submit.walletId != null ? { wallet_id: Number(submit.walletId) } : {}),
    };
    this.isCharging.set(true);
    this.ordersService
      .flowPayOrder(String(order.id), dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          this.isCharging.set(false);
          this.chargeModalOpen.set(false);
          // CP-POS-SVC-PERF-001 / Annotation-4 — once payment clears,
          // any booking blocks the cashier attached during the
          // wizard have to land on the order, regardless of the
          // `allow_bookings_without_payment` toggle (the toggle only
          // governs Guardar-alone). `force` bypasses that gate.
          this.firePendingBookingsAfterDraft(Number(order.id), { force: true });
          // QUI-audit-round-1: el toast de éxito se ataba al response del
          // POST, pero el refresh sub-siguiente silenciosamente dejaba
          // `readyToPayOrder` en null si la red fallaba — el cajero perdía
          // el rastro de la orden sin saber por qué. Ahora el toast sólo
          // se dispara si el refresh confirma el estado final. Si el refresh
          // falla, conservamos `readyToPayOrder` para que pueda re-abrir el
          // modal y le decimos qué pasó.
          this.refreshReadyToPayOrder({
            onRefreshOk: () => {
              this.toastService.success('Pago registrado correctamente');
            },
            onRefreshFail: () => {
              this.toastService.warning(
                'Pago aplicado, no se pudo refrescar el detalle. Reabre el cobro para ver el estado.',
              );
            },
          });
        },
        error: (err) => {
          this.isCharging.set(false);
          const parsed = this.ordersService.extractApiError(err);
          this.toastService.error(
            parsed.message || 'No se pudo registrar el cobro',
          );
        },
      });
  }

  /**
   * Re-fetch the current order so `readyToPayOrder` reflects the post-payment
   * state. If the backend dropped the order to a terminal state we clear the
   * signal so the `Cobrar` CTA hides.
   *
   * `onRefreshOk` / `onRefreshFail` decouple the post-payment toast from the
   * refresh outcome: when the GET fails, the cashier still sees a hint AND the
   * signal is preserved so they can re-open the modal and recover.
   */
  private refreshReadyToPayOrder(callbacks?: {
    onRefreshOk?: () => void;
    onRefreshFail?: () => void;
  }): void {
    const order = this.readyToPayOrder();
    if (!order || !order.id) {
      this.readyToPayOrder.set(null);
      callbacks?.onRefreshFail?.();
      return;
    }
    this.ordersService
      .getOrderById(String(order.id))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const fresh: Order | null = response?.data || response || null;
          this.readyToPayOrder.set(fresh);
          // If the order is past a payable state, hide the CTA.
          if (
            fresh &&
            (fresh.state === 'delivered' ||
              fresh.state === 'cancelled' ||
              fresh.state === 'refunded' ||
              fresh.state === 'finished' ||
              fresh.state === 'shipped')
          ) {
            this.readyToPayOrder.set(null);
          }
          callbacks?.onRefreshOk?.();
        },
        error: () => {
          // QUI-audit-round-1: antes esto era `readyToPayOrder.set(null)`
          // ciego. Si el GET de refresh falla después de un cobro exitoso, el
          // cajero pierde la orden sin entender por qué. Conservamos la señal
          // para que pueda re-abrir el modal y le avisamos vía callback.
          callbacks?.onRefreshFail?.();
        },
      });
  }

  /**
   * Fetch the enabled payment methods from the shared catalog. The catalog
   * already maps the response through `fromPosBackendMethod` and falls back
   * to a sensible local default on error.
   */
  private fetchPaymentMethodsCatalog(): void {
    this.paymentMethodsCatalogService
      .getEnabledMethods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (methods) => this.paymentMethodsCatalog.set(methods ?? []),
        // QUI-audit-round-1: si la red se cae o el backend no responde, antes
        // el catálogo quedaba en [] y el cajero veía el modal sin métodos.
        // Ahora registramos el intento fallido; `onCharge` reintenta al abrir
        // el modal y el usuario puede reabrirlo para que el re-fetch dispare.
        error: () => this.paymentMethodsCatalog.set([]),
      });
  }

  /**
   * Restaurant Suite — Fase K Gap 1: returns true when the cart item
   * matching `productId`+`variantId` was added with `skipKds=true`
   * (cashier chose "Usar stock" in the prepared-choice modal). Used
   * to filter such items OUT of the fire-to-kitchen call list.
   */
  private isCartItemSkipKds(
    productId: number | null,
    variantId?: number | null,
  ): boolean {
    if (productId == null) return false;
    const items = this.cartState()?.items ?? [];
    return items.some((it: any) => {
      const pid = Number(it?.product?.id);
      if (pid !== productId) return false;
      const vid = it?.variant_id ?? null;
      if (vid !== (variantId ?? null)) return false;
      return it?.skipKds === true;
    });
  }

  // Plan KDS fire-flows (F2): the fire post-pago is now done by the
  // backend inside the payment $transaction (PaymentsService
  // auto-fire). This method is a NO-OP kept for backward compat with
  // any external caller; it intentionally does not invoke the network
  // because the backend is the single source of truth for the KDS
  // dispatch on sale.
  private fireKitchenFromCompletedOrder(_order: any): void {
    // Deprecated: see comment above.
    return;
  }
  onPaymentCompleted(paymentData: any): void {
    if (!this.cartState() || this.isEmpty) return;

    this.loading.set(false);
    // Fase 5·B3: la venta directa finaliza aquí; cierra el shell (espeja envío).
    this.showCheckoutModal.set(false);

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
      // CP-POS-SVC-PERF-001 / Annotation-4 + HU-B second half — the unified
      // shell route (Cobrar in mode='cobrar' or the post-Actualizar flip in
      // mode='edit') reaches this branch after flow/pay. Pending booking
      // blocks attached during the wizard still sit in cartBookingsFromChild
      // and need to land on the paid order — `force` ignores the toggle so
      // toggle-OFF stores still get the booking on the Cobrar path.
      console.log('[POS-DBG] onPaymentCompleted fire pre', this.cartBookingsFromChild?.()?.size, paymentData?.order?.id);
      this.firePendingBookingsAfterDraft(
        Number(paymentData.order?.id ?? this.currentOrderId()),
        { force: true },
      );
      // Plan KDS fire-flows (F2): the backend auto-fires `prepared`
      // items inside the payment $transaction for restaurant stores,
      // so the fire from the frontend is no longer needed (and was a
      // silent no-op because POS payment does not surface
      // `order.order_items` with ids). Surface the server's
      // `kitchen_fire.fired_count` as a toast so the cashier sees the
      // KDS dispatch without polling.
      const fireInfo: any = (paymentData as any)?.order?.kitchen_fire ??
        (paymentData as any)?.kitchen_fire;
      if (fireInfo && Number(fireInfo.fired_count) > 0) {
        this.toastService.success(
          `${fireInfo.fired_count} plato(s) enviados a cocina (ticket #${fireInfo.kitchen_ticket_id})`,
        );
      }

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
            // QUI-648 — la escala en la que el cajero capturó la línea, para
            // que el tiquete diga "3 m" y no "3000". `quantity` sigue siendo
            // la unidad mínima, que es lo que el backend persistió.
            sale_unit_code: item.sale_unit_code || undefined,
            sale_quantity: resolveSaleQuantity(item),
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

      // Finalización: limpia el estado residual del padre a su valor inicial.
      this.selectedCustomer.set(null);
      this.paymentFulfillment.set(null);
      this.paymentTableId.set(null);
      // QUI-535: el cobro ya cerró la sesión de mesa en el backend. Soltar la
      // sesión cacheada evita que la venta siguiente arranque con la mesa de la
      // anterior preseleccionada (y con needsTable() en false).
      this.restaurantIntegration.clearTableSession();

      // CP-POS-MODAL-SCOPE-001 / Phase F.8 — clear residual edit state after a
      // successful charge so the cart rail no longer renders "Actualizar"
      // (the edit-mode label) on the next sale. Without this, after paying an
      // edited order the cashier sees the shell in `mode='edit'` (button still
      // reads Actualizar) until Nueva compra runs the F.7 reset.
      this.editingOrderId.set(null);
      this.editingOrder.set(null);
      this.readyToPayOrder.set(null);
      this.mode.set('create-draft');
      this.checkoutIntent.set('pickup');
    }

    // CP-DTLP Phase E.2 / QUI-764 — encadenar tiquete de despacho
    // (`'automatic'`) al cierre de venta POS. La bandera de auto es
    // `print_dispatch_ticket_auto_with_pos` (origen = POS). El predicado
    // compartido considera además `print_dispatch_ticket_on_counter`
    // para imprimir también en mostrador/para-llevar.
    void this.printDispatchTicketIfNeededForOrder(
      paymentData.order,
      'auto_with_pos',
    );
  }

  onOrderConfirmationClosed(): void {
    this.showOrderConfirmation.set(false);
    this.completedOrder.set(null);
  }

  onStartNewSale(): void {
    this.showOrderConfirmation.set(false);
    this.completedOrder.set(null);

    // CP-POS-MODAL-SCOPE-001 / Phase F.7 — Nueva compra must hand the cashier
    // a fresh POS regardless of how they got into the previous sale. If the
    // cashier was editing an order (the URL had `?editOrder=`), every signal
    // that was pinned to that order is still in memory: `editingOrderId`,
    // `editingOrder`, `currentOrderId`, `currentOrderNumber`, `linkedOrderId`,
    // `linkedOrderNumber`, the shell `mode`, the parent's `readyToPayOrder`.
    // Without a reset, the next sale hits `PUT /store/orders/:id/items` on
    // the previous order's id and silently edits the previous order again.
    this.editingOrderId.set(null);
    this.editingOrder.set(null);
    this.currentOrderId.set(null);
    this.currentOrderNumber.set(null);
    this.readyToPayOrder.set(null);
    this.mode.set('create-draft');
    this.checkoutIntent.set('pickup');
    this.showCheckoutModal.set(false);

    // Drop the `editOrder` query param too so a browser refresh on the same
    // URL does not re-enter the edit flow.
    this.router.navigate(
      ['/admin/pos'],
      { queryParams: { editOrder: null }, queryParamsHandling: 'merge' },
    );

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

  onPosServiceScheduled(booking: any): void {
    this.showReservationModal.set(false);
    const prod = this.pendingBookingProduct();
    const variant = this.pendingBookingVariant();
    if (!prod) return;

    if (booking.customer && (!this.selectedCustomer() || this.selectedCustomer()?.id !== booking.customer.id)) {
      this.onCustomerSelected(booking.customer);
    }

    this.cartService
      .addToCart({
        product: prod,
        quantity: 1,
        variant: variant || undefined,
        booking: {
          booking_id: booking.booking_id,
          provider_id: booking.provider_id,
          provider_name: booking.provider_name,
          date: booking.date,
          start_time: booking.start_time,
          end_time: booking.end_time,
          notes: booking.notes,
          service_location_type: booking.service_location_type,
        },
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cartState) => {
          const addedItem = cartState.items[cartState.items.length - 1] ?? cartState.items[0];
          if (addedItem) {
            const next = new Map(this.cartBookingsFromChild());
            next.set(addedItem.id, {
              ...booking,
              product_id: Number(prod.id),
              product_variant_id: variant?.id ?? booking.product_variant_id ?? null,
              cart_item_id: `cart-${addedItem.id}`,
            });
            this.cartBookingsFromChild.set(next);
          }
          this.cartService
            .addPendingBooking({
              id: booking.booking_id ?? 0,
              booking_number: '',
              product_id: booking.product_id ?? Number(prod.id),
              product_name: prod.name ?? '',
              product_variant_id: booking.product_variant_id ?? variant?.id ?? null,
              variant_name: variant?.name ?? undefined,
              customer_id: booking.customer_id ?? this.selectedCustomer()?.id ?? 0,
              date: booking.date,
              start_time: booking.start_time,
              end_time: booking.end_time,
              provider_name: booking.provider_name ?? undefined,
            })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe();

          this.pendingBookingProduct.set(null);
          this.pendingBookingVariant.set(null);
          this.toastService.success('Servicio agregado al carrito con su horario');
        },
        error: (err) => {
          this.toastService.error(err?.message || 'Error al agregar servicio al carrito');
        },
      });
  }

  onBookingCreated(event?: any): void {
    this.showReservationModal.set(false);

    const reservationCustomer = event?.customer || event;
    const booking = event?.booking;

    // QUI-649 — when the backend returns `booking.order`, the reservation
    // was created with an auto-linked order. The POS adopts that order as
    // the current cart so any items the cashier adds afterward go into the
    // same order (via `PUT /store/orders/:id/items`) and the cash-out at
    // the end charges THAT order, not a brand-new one.
    //
    // We only call `adoptOrder` when an order is present. Legacy flows
    // (admin-created bookings, fallback paths) still take the
    // `addPendingBooking` route, which the existing payment payload merges
    // into the freshly-created order at cash-out.
    if (booking?.order?.id) {
      this.cartService
        .adoptOrder(booking.order.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.toastService.success(
              `Reserva creada y orden #${booking.order.order_number ?? booking.order.id} adoptada`,
            );
            this.pendingBookingProduct.set(null);
            this.pendingBookingVariant.set(null);
          },
          error: () => {
            // Adoption failed (network blip, order disappeared, etc.) —
            // fall back to the legacy add-to-cart + pending-booking flow so
            // the cashier can still operate. The reservation itself is
            // safe in the backend.
            this.fallbackAddBookingToCart(event, booking, reservationCustomer);
          },
        });
      return;
    }

    this.fallbackAddBookingToCart(event, booking, reservationCustomer);
  }

  /**
   * Legacy flow used when the reservation response does NOT include
   * `booking.order` (admin-created bookings, fallback after a failed
   * adoption). Kept as a private helper so `onBookingCreated` stays
   * readable.
   */
  private fallbackAddBookingToCart(
    event: any,
    booking: any,
    reservationCustomer: any,
  ): void {
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

    // Sin borrador que reiniciar: el modal compartido se hidrata en blanco cada
    // vez que `open` pasa a `true` (ver su `effect` de apertura).
    this.customItemModalOpen.set(true);
  }

  closeCustomItemModal(): void {
    this.customItemModalOpen.set(false);
  }

  /**
   * La línea ya viene traducida al contrato del cobro por
   * `PosCustomItemModalComponent`; acá sólo se agrega al carrito y se devuelve
   * al cajero a la vista del carrito, que es de donde venía.
   */
  addCustomItemFromMobile(request: AddCustomItemRequest): void {
    this.cartService
      .addCustomItem(request)
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

  // ── Vexi: API pública del POS ───────────────────────────────────────────
  //
  // Same doctrine as `handleBarcodeScan`: every add goes through the
  // product-selection child's own `onAddToCart` / `onVariantSelected`, so
  // stock validation, variant mapping, the prepared-vs-KDS decision and the
  // toasts stay identical to a manual tap. Vexi never touches `PosCartService`
  // directly — carts built that way are the ones checkout later rejects.
  //
  // Decisions the product reserves for a human — variant, weight,
  // prepared-vs-stock, reservation, and payment — are NOT made here. They
  // return `needs_user_input` and Vexi asks.

  /**
   * Resolves a product by free text and adds it, or reports what a human has
   * to decide. Registered with `VexiPosBridgeService` while the POS is mounted.
   */
  async vexiAddProductByName(
    query: string,
    quantity: number,
  ): Promise<VexiPosActionResult> {
    const child = this.productSelectionList()[0];
    if (!child) {
      return {
        status: 'error',
        message: 'El selector de productos aún no está listo en pantalla.',
      };
    }

    const results = await firstValueFrom(
      this.productService.searchProducts({ query } as any, 1, 8),
    ).catch(() => null);

    const products: Product[] = (results as any)?.products ?? [];

    if (!products.length) {
      return {
        status: 'not_found',
        message: `No encontré ningún producto que coincida con "${query}".`,
      };
    }

    // More than one match is a decision, not a problem to solve by guessing:
    // adding the wrong item to a live sale is worse than one more question.
    const exact = products.filter(
      (p) => p.name?.trim().toLowerCase() === query.trim().toLowerCase(),
    );
    const candidates = exact.length === 1 ? exact : products;

    if (candidates.length > 1) {
      return {
        status: 'needs_user_input',
        message: `Hay ${candidates.length} productos que coinciden con "${query}".`,
        detail: candidates.slice(0, 5).map((p) => p.name),
      };
    }

    const product = candidates[0];

    if ((product.product_variants ?? []).length > 0) {
      // Opens the child's variant modal. The promise below does not wait for
      // the click — the command service caps the wait and reports it as
      // pending on the user.
      void child.onAddToCart(product);
      return {
        status: 'needs_user_input',
        message: `"${product.name}" tiene variantes. Le abrí el selector para que elija.`,
      };
    }

    // `onAddToCart` takes no quantity — it adds one unit and the cart merges
    // repeats into a single line. Looping reuses that exact path instead of
    // reaching past it to set a quantity directly, which would skip the stock
    // check it runs per unit.
    const units = Math.max(1, Math.min(Math.trunc(quantity) || 1, 99));
    const before = this.vexiCartUnits();

    // One shared deadline rather than one per unit: `withUserInputTimeout`
    // cuts the whole command off at 20s, so a per-unit budget would let a
    // large quantity sail past that cap and get reported as "pending on the
    // user" when it is really a stall.
    const deadline = Date.now() + 12000;

    for (let i = 0; i < units; i++) {
      await child.onAddToCart(product);
      // Verified unit by unit, and sequentially: the cart merges repeats into
      // a single line, so firing all N and checking once cannot tell "3 went
      // in" from "1 went in three times over the same line".
      const target = before + i + 1;
      if ((await this.vexiWaitForCartUnits(target, deadline)) < target) break;
    }

    // `onAddToCart` returns nothing and swallows its own refusals: out of
    // stock, not sellable, a modal it opened and is waiting on. Reporting `ok`
    // on the strength of having called it made Vexi tell the user "agregué el
    // café" over an empty cart. The cart itself is the only honest witness.
    const added = this.vexiCartUnits() - before;

    if (added <= 0) {
      return {
        status: 'error',
        message: `Pedí agregar "${product.name}" pero el carrito no lo aceptó. Puede estar sin stock, no ser vendible, o el punto de venta puede estar esperando un dato en pantalla.`,
      };
    }

    if (added < units) {
      return {
        status: 'needs_user_input',
        message: `De ${units} unidades de ${product.name} solo entraron ${added}. Revisa el stock disponible en pantalla.`,
      };
    }

    return {
      status: 'ok',
      message: `Agregué ${units > 1 ? `${units} × ` : ''}${product.name} al carrito.`,
    };
  }

  /**
   * Total units in the cart, used to tell a real add from a silent refusal.
   *
   * Units and not line count: adding a second unit of something already in the
   * cart merges into the existing line, so counting lines would read that as
   * nothing having happened.
   */
  private vexiCartUnits(): number {
    return this.cartItems().reduce(
      (total, item) => total + (Number(item.quantity) || 0),
      0,
    );
  }

  /**
   * Waits until the cart reports at least `target` units, or the deadline hits.
   *
   * The cart is the only honest witness to an add, but it has to be given time
   * to answer. `onAddToCart` resolves *before* the cart does: it subscribes to
   * `cartService.addToCart()` and returns without awaiting the round trip
   * (`pos-product-selection.component.ts:1511`). Reading the count the instant
   * that call returns therefore reads the value from before the add, which
   * reported every single successful add as a refusal.
   *
   * Resolves with whatever the count is when it stops waiting — never throws,
   * because the caller decides what a short count means.
   */
  private vexiWaitForCartUnits(
    target: number,
    deadline: number,
  ): Promise<number> {
    return new Promise<number>((resolve) => {
      const poll = () => {
        const units = this.vexiCartUnits();
        if (units >= target || Date.now() >= deadline) {
          resolve(units);
          return;
        }
        setTimeout(poll, 80);
      };
      poll();
    });
  }

  async vexiRemoveLineByName(query: string): Promise<VexiPosActionResult> {
    const needle = query.trim().toLowerCase();
    const matches = this.cartItems().filter((item) =>
      (item.product?.name ?? item.description ?? '').toLowerCase().includes(needle),
    );

    if (!matches.length) {
      return {
        status: 'not_found',
        message: `No hay ninguna línea que coincida con "${query}" en el carrito.`,
      };
    }
    if (matches.length > 1) {
      return {
        status: 'needs_user_input',
        message: `Hay ${matches.length} líneas que coinciden con "${query}". Dime cuál quitar.`,
        detail: matches.map((m) => m.product?.name ?? m.description),
      };
    }

    await firstValueFrom(this.cartService.removeFromCart(matches[0].id));
    return {
      status: 'ok',
      message: `Quité ${matches[0].product?.name ?? matches[0].description} del carrito.`,
    };
  }

  async vexiSetCustomerByQuery(query: string): Promise<VexiPosActionResult> {
    const response = await firstValueFrom(
      this.customerService.searchCustomers({ query, limit: 5 }),
    ).catch(() => null);

    const customers = (response as any)?.data ?? [];

    if (!customers.length) {
      return {
        status: 'not_found',
        message: `No encontré ningún cliente que coincida con "${query}".`,
      };
    }
    if (customers.length > 1) {
      return {
        status: 'needs_user_input',
        message: `Hay ${customers.length} clientes que coinciden con "${query}".`,
        detail: customers.map(
          (c: PosCustomer) => `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim(),
        ),
      };
    }

    this.customerService.selectCustomer(customers[0]);
    const name =
      `${customers[0].first_name ?? ''} ${customers[0].last_name ?? ''}`.trim();
    return { status: 'ok', message: `Asigné la venta a ${name}.` };
  }

  // ── Host genérico de Vexi ───────────────────────────────────────────────
  //
  // El POS ya expone sus comandos propios (`ui_pos_*`), que son mejores que
  // cualquier equivalente genérico: entienden variantes, peso y preparados. Se
  // registra también como host genérico por una sola razón — que `ui_read_screen`
  // funcione aquí. Sin eso, "cóbrame esto" en el POS no tiene referente y Vexi
  // tiene que preguntar qué es "esto" mientras lo tiene delante.

  /**
   * The POS as the generic registry sees it.
   *
   * A stable object built once, not a getter: `unregister` compares by identity, so a
   * fresh literal on every access would never match the registered one and the handle
   * would leak past the component's destruction.
   */
  private readonly vexiHostAdapter: VexiUiHost = {
    vexiModuleKey: 'pos',
    readScreen: () => this.vexiReadScreen(),
    listActions: () => this.vexiListActions(),
    runAction: (id) => this.vexiRunAction(id),
  };

  private vexiReadScreen(): VexiUiScreen {
    const cart = this.vexiReadCart();

    return {
      module_key: 'pos',
      title: 'Punto de Venta',
      visible_count: cart.lines.length,
      selection: cart.customer,
      notes: cart.lines.length
        ? `Carrito con ${cart.lines.length} línea(s), total ${cart.total}${
            cart.customer ? `, cliente ${cart.customer}` : ', sin cliente'
          }.`
        : 'El carrito está vacío.',
    };
  }

  private vexiListActions(): VexiUiAction[] {
    return [
      { id: 'cobrar', label: 'Cobrar la venta abierta', mutates: true },
      { id: 'leer_carrito', label: 'Mostrar el detalle del carrito' },
    ];
  }

  /**
   * Delegates to the typed POS commands instead of reimplementing them.
   *
   * The generic path exists so `ui_click_action` works here at all; the typed
   * `ui_pos_*` tools remain the right way in, because they understand variants,
   * weight and prepared items and the generic ones cannot.
   */
  private async vexiRunAction(id: string): Promise<VexiUiActionResult> {
    switch (id) {
      case 'cobrar':
        return this.vexiCheckout();
      case 'leer_carrito': {
        const cart = this.vexiReadCart();
        return {
          status: 'ok',
          message: `El carrito lleva ${cart.lines.length} línea(s) por ${cart.total}.`,
          detail: cart,
        };
      }
      default:
        return {
          status: 'not_found',
          message: `El Punto de Venta no tiene una acción "${id}".`,
        };
    }
  }

  vexiReadCart(): VexiPosCartSnapshot {
    const summary = this.cartSummary();
    const customer = this.selectedCustomer();

    return {
      lines: this.cartItems().map((item) => ({
        name: item.product?.name ?? item.description ?? 'Línea sin nombre',
        quantity: item.quantity ?? 0,
        unit_price: Number(item.unitPrice ?? 0),
        total: Number(item.totalPrice ?? 0),
      })),
      subtotal: Number(summary?.subtotal ?? 0),
      total: Number(summary?.total ?? 0),
      customer: customer
        ? `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim()
        : null,
    };
  }

  /**
   * Charges the open sale, and reports what actually happened.
   *
   * Deliberately drives `onCheckout()` — the very method the cashier's button
   * calls — instead of assembling a payment of its own. The checkout shell is
   * where fulfillment, table, payment method, cash received and change are
   * decided, and where the backend fires the KDS inside the payment
   * transaction. A second payment path written for Vexi would be a second set
   * of accounting and inventory consequences, subtly out of step with the
   * first.
   *
   * The outcome is read from the screen's own witnesses rather than from a
   * callback: the shell has three separate exits (payment completed, closed by
   * the user, closed programmatically), so a hook per exit would silently miss
   * the fourth one somebody adds later. Watching state covers all of them.
   */
  async vexiCheckout(): Promise<VexiPosActionResult> {
    if (this.isEmpty) {
      return {
        status: 'error',
        message: 'El carrito está vacío, así que no hay nada que cobrar.',
      };
    }

    if (this.isEditMode()) {
      return {
        status: 'error',
        message:
          'Esta venta está en modo edición de una orden existente, no en una venta nueva.',
      };
    }

    const cart = this.vexiReadCart();
    const orderBefore = this.currentOrderNumber();

    this.onCheckout();

    // Not opening at all means a guard inside `onCheckout` refused (no cart
    // state). Reporting "waiting on the user" there would be a lie.
    if (!this.showCheckoutModal()) {
      return {
        status: 'error',
        message: 'No pude abrir el cobro para esta venta.',
      };
    }

    const settled = await this.vexiWaitForCheckoutOutcome(orderBefore);

    if (settled === 'paid') {
      return {
        status: 'ok',
        message: `Venta cobrada por ${cart.total}. Orden ${
          this.currentOrderNumber() ?? 'creada'
        }.`,
        detail: { order_number: this.currentOrderNumber(), total: cart.total },
      };
    }

    if (settled === 'abandoned') {
      return {
        status: 'needs_user_input',
        message: 'Se cerró el cobro sin completar el pago.',
      };
    }

    return {
      status: 'needs_user_input',
      message:
        'Le abrí el cobro y está eligiendo el medio de pago. La venta todavía no está cobrada.',
    };
  }

  /**
   * Resolves once the checkout shell settles: `paid` when a new order number
   * appears, `abandoned` when the shell closes without one, `pending` on
   * timeout — which is not a failure, only the end of Vexi's turn.
   */
  private vexiWaitForCheckoutOutcome(
    orderBefore: string | null,
  ): Promise<'paid' | 'abandoned' | 'pending'> {
    // Longer than the 20s cap on other POS commands on purpose: choosing a
    // payment method and counting cash is slower than picking a variant.
    const deadline = Date.now() + 90000;

    return new Promise((resolve) => {
      const poll = () => {
        const orderNow = this.currentOrderNumber();
        if (orderNow && orderNow !== orderBefore) {
          resolve('paid');
          return;
        }
        // Checked after the order number, not before: the success path closes
        // the shell and sets the order in the same handler, and the opposite
        // order would report a completed sale as abandoned.
        if (!this.showCheckoutModal()) {
          resolve('abandoned');
          return;
        }
        if (Date.now() >= deadline) {
          resolve('pending');
          return;
        }
        setTimeout(poll, 150);
      };
      poll();
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
      this.toastService.warning(EMPTY_CART_MESSAGE);
      return;
    }
    // Fase 5·B3: el flujo DELIVERY vive en el shell con stepper (único checkout).
    this.checkoutIntent.set('delivery');
    // CP-POS-ENVIO-REGRESSION-001: el shell default a 'create-draft' y su steps()
    // short-circuita a [Cliente] cuando mode==='create-draft'. Sin esto, Envío y
    // Cobro desaparecen. mode='create-payment' desbloquea la rama delivery de
    // steps() que retorna [Cliente, Envío, Cobro]. Espejo del patrón pickup
    // (onCheckout línea ~1863).
    this.mode.set('create-payment');
    this.showCheckoutModal.set(true);
  }

  onShippingFromModal(): void {
    this.showCartModal.set(false);
    this.onShipping();
  }

  onShippingCompleted(shippingData: any): void {
    if (!this.cartState() || this.isEmpty) return;

    this.loading.set(false);
    // Fase 5·B3: el flujo delivery emite desde el shell; ciérralo.
    this.showCheckoutModal.set(false);

    if (shippingData.success) {
      this.currentOrderId.set(shippingData.order?.id);
      this.currentOrderNumber.set(shippingData.order?.order_number);

      if (shippingData.order?.id) {
        this.firePendingBookingsAfterDraft(Number(shippingData.order.id), { force: true });
      }

      // Plan KDS fire-flows (F2): the backend auto-fires `prepared`
      // items inside the payment $transaction for restaurant stores.
      // Surface the server's `kitchen_fire.fired_count` as a toast.
      const fireInfo: any = (shippingData as any)?.order?.kitchen_fire ??
        (shippingData as any)?.kitchen_fire;
      if (fireInfo && Number(fireInfo.fired_count) > 0) {
        this.toastService.success(
          `${fireInfo.fired_count} plato(s) enviados a cocina (ticket #${fireInfo.kitchen_ticket_id})`,
        );
      }

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
            // QUI-648 — la escala en la que el cajero capturó la línea, para
            // que el tiquete diga "3 m" y no "3000". `quantity` sigue siendo
            // la unidad mínima, que es lo que el backend persistió.
            sale_unit_code: item.sale_unit_code || undefined,
            sale_quantity: resolveSaleQuantity(item),
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

      // Finalización: limpia el estado residual del padre a su valor inicial.
      this.selectedCustomer.set(null);
      this.paymentFulfillment.set(null);
      this.paymentTableId.set(null);
    }

    // CP-DTLP Phase E.2 / QUI-764 — encadenar tiquete de despacho
    // (`'automatic'`) al crear la orden con envío en postventa. La bandera
    // de auto es `print_dispatch_ticket_auto_on_postventa` (origen =
    // postventa), NO la del POS — son dos flags distintos.
    void this.printDispatchTicketIfNeededForOrder(
      shippingData.order,
      'auto_on_postventa',
    );
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
    // QUI-audit-round-1: marcar el modo ANTES de pedir los productos. Si la
    // carga falla (producto embebido ausente, sin conexión, etc.), el handler
    // de error resetea todas las señales de edición y limpia el queryParam
    // `editOrder`. Antes, si la respuesta llegaba pero el load fallaba, el
    // shell quedaba colgado con `isEditMode` parcialmente verdadero.
    this.isEditMode.set(true);
    this.ordersService
      .getOrderById(orderId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const order: Order = response.data || response;

          if (order.state !== 'created' && order.state !== 'draft') {
            this.loading.set(false);
            // QUI-audit-round-2: el handler no reseteaba `editingOrder` ni
            // `readyToPayOrder` antes del toast, dejando residuos de un intento
            // previo en pantalla. Forzamos la limpieza aquí también.
            this.readyToPayOrder.set(null);
            this.editingOrder.set(null);
            this.resetEditState();
            this.toastService.error(
              'Solo se pueden editar ordenes en estado "Creada" o "Borrador"',
            );
            this.clearEditOrderQueryParam();
            this.router.navigate(['/admin/orders', orderId]);
            return;
          }

          this.cartService
            .loadFromOrder(order)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: () => {
                this.editingOrderId.set(orderId);
                this.editingOrderNumber.set(order.order_number);
                this.editingOrder.set(order);
                this.mode.set('edit');
                // CP-POS-MODAL-SCOPE-001 / Phase F.12 — Modificar must NOT
                // auto-open the checkout shell. The cashier expects to
                // see ONLY the cart with the order's items rehydrated
                // so they can edit quantities, add/remove products,
                // change customer, and click Guardar / Actualizar /
                // Cobrar at their own pace. The shell opens only when
                // they click Cobrar explicitly.
                // Clear stale charge state from a previous edit attempt.
                this.readyToPayOrder.set(null);
                this.chargeModalOpen.set(false);
                this.showCheckoutModal.set(false);
                this.loading.set(false);
                this.toastService.info(`Editando Orden #${order.order_number}`);
              },
              error: (err) => {
                this.loading.set(false);
                this.readyToPayOrder.set(null);
                this.editingOrder.set(null);
                this.resetEditState();
                const msg =
                  (err && (err.message || (err as any).userMessage)) ||
                  'Error al cargar los productos de la orden';
                this.toastService.error(msg);
                this.clearEditOrderQueryParam();
              },
            });
        },
        error: (err) => {
          this.loading.set(false);
          this.readyToPayOrder.set(null);
          this.editingOrder.set(null);
          this.resetEditState();
          this.toastService.error('Error al cargar la orden para edición');
          this.clearEditOrderQueryParam();
          this.router.navigate(['/admin/orders']);
        },
      });
  }

  /**
   * Helper invoked from every error path of `loadOrderForEditing`: keeps the
   * state machine clean and prevents the "back to POS keeps re-entering edit"
   * bug by clearing the `editOrder` query param whenever the entry to edit
   * mode aborted.
   */
  private resetEditState(): void {
    this.isEditMode.set(false);
    this.editingOrder.set(null);
    this.editingOrderId.set(null);
    this.editingOrderNumber.set(null);
    this.readyToPayOrder.set(null);
    this.chargeModalOpen.set(false);
    if (this.mode() === 'edit') {
      this.mode.set('create-draft');
    }
  }

  private clearEditOrderQueryParam(): void {
    this.router.navigate(
      ['/admin/pos'],
      { queryParams: { editOrder: null }, queryParamsHandling: 'merge' },
    );
  }

  /**
   * Phase D.2 — update an existing order via `PUT /store/orders/:id/editor`.
   *
   * On success:
   *  - DO NOT clear the cart (cashier keeps editing context).
   *  - DO NOT navigate to detail (the only logical next step is "Cobrar").
   *  - Set `readyToPayOrder` to the FRESH order returned by the backend so the
   *    `Cobrar` CTA renders. `flow/pay` will charge THAT order, never a stale
   *    snapshot.
   *
   * Empty-cart guard: a save with zero items would push `items: []` and the
   * editor endpoint would either no-op (silently losing the cashier's work)
   * or reject the request. We block here with the same `EMPTY_CART_MESSAGE`
   * used by the create flow so the operator sees a consistent reason.
   *
   * On error: surface the typed message via `parseApiError` (no raw Prisma /
   * container strings reach the cashier).
   */
  private updateExistingOrder(): void {
    const orderId = this.editingOrderId();
    const state = this.cartState();
    if (!state || !orderId) return;
    if (!state.items || state.items.length === 0) {
      this.toastService.warning(EMPTY_CART_MESSAGE);
      return;
    }

    this.loading.set(true);
    let dto: Record<string, any>;
    try {
      dto = this.buildEditorRequest(state);
    } catch (err: any) {
      // Local `POS_CUSTOMER_REQUIRED_001` thrown by the mapper (defensive).
      this.loading.set(false);
      const code = err?.errorCode as string | undefined;
      if (code) {
        this.toastService.error(
          err?.message || 'No se pudo preparar la orden para guardar.',
        );
        return;
      }
      throw err;
    }
    this.ordersService
      .updateOrderFromEditor(orderId, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updatedOrder: Order) => {
          this.loading.set(false);
          // Refresh editor metadata so shipping/address/payment state reflect
          // the server's authoritative snapshot.
          this.editingOrder.set(updatedOrder);
          this.readyToPayOrder.set(updatedOrder);
          // Stay in POS: DO NOT navigate. DO NOT clear the cart. DO NOT close
          // any modal — the cashier must see "Cobrar" now.
          this.toastService.success(
            `Orden #${updatedOrder.order_number} actualizada — lista para cobrar`,
          );
          this.fetchPaymentMethodsCatalog();
        },
        error: (err) => {
          this.loading.set(false);
          const parsed = this.ordersService.extractApiError(err);
          this.toastService.error(
            parsed.message || 'Error al actualizar la orden',
          );
        },
      });
  }

  /**
   * Mapper: CartState → UpdateOrderEditorRequest.
   *
   * The editor contract on `PUT /store/orders/:id/editor` is a small subset
   * of the cart: items (snake_case), customer_id, coupon_code, promotion_ids,
   * public + internal notes, and the shipping fields. The previous code
   * shipped the entire `CartState` shape — which leaked `payment_*`,
   * `credit_*`, KDS flags, `serial_*` and `inventory_committed_at_fire` and
   * made Prisma 7 reject the request. The backend never received a clean
   * payload and the cashier never saw Cobrar.
   *
   * Customer fallback: when the cart has no customer attached (the cashier
   * didn't pick one during edit) we fall back to the order's existing
   * `customer_id`. Sending `null` would let Prisma 7 drop the FK and break
   * the next `flow/pay`. If both are missing we surface
   * `POS_CUSTOMER_REQUIRED_001` locally — saves a round-trip and matches
   * the backend's authoritative rejection.
   *
   * Shipping fields: forwarded from `state.shippingContext` (populated by
   * `loadFromOrder`). Undefined keys are omitted, not nulled — the editor
   * endpoint treats absent keys as "no change" and any explicit `null`
   * could clear a value the cashier did not intend to clear.
   *
   * `saveDraft` keeps using the cart-shaped builder in `PosPaymentService` —
   * drafts are a different endpoint with a different contract.
   */
  private buildEditorRequest(state: CartState): Record<string, any> {
    const cartCustomerId = state.customer?.id
      ? Number(state.customer.id)
      : null;
    const orderCustomerId = this.editingOrder()?.customer_id
      ? Number(this.editingOrder()!.customer_id)
      : null;
    const customerId = cartCustomerId ?? orderCustomerId;
    if (customerId == null || !Number.isFinite(customerId) || customerId < 1) {
      // Defensive mirror of `POS_CUSTOMER_REQUIRED_001`. Backend would reject
      // with that code; we throw the same shape so the cashier sees a real
      // reason instead of a silent 422.
      const err = new Error(
        'Selecciona o crea un cliente antes de guardar la orden. (POS_CUSTOMER_REQUIRED_001)',
      ) as Error & { errorCode: string };
      err.errorCode = 'POS_CUSTOMER_REQUIRED_001';
      throw err;
    }
    const appliedCoupon = state.appliedCoupon;
    const promotionIds = (state.appliedDiscounts ?? [])
      .map((d: any) => Number(d.promotion_id))
      .filter((id: number) => Number.isFinite(id));

    const items = (state.items ?? []).map((item: any) => {
      const productId = item?.product?.id;
      const variantId = item?.variant_id ?? item?.product_variant_id ?? null;
      const isCustomItem =
        item?.itemType === 'custom' ||
        (typeof productId === 'string' && productId.startsWith('custom-'));
      const productIdNumeric = isCustomItem
        ? null
        : typeof productId === 'string'
          ? parseInt(productId, 10)
          : Number(productId ?? 0) || null;
      const variantIdNumeric =
        variantId == null ? null : Number(variantId) || null;
      const productName = item?.product?.name ?? '';

      // CP-POS-SVC-PERF-001 / D.2 — atomic booking block per item.
      // The cart scheduler emits `bookingsChanged`; we stash it in
      // `cartBookingsFromChild` and attach the matching booking here so
      // the backend editor creates/updates the `bookings` row in the
      // same $transaction that persists the order_items. Re-agendar
      // sends `booking_id` so the existing row is updated in place.
      const bookingBlock =
        this.cartBookingsFromChild?.()?.get?.(item?.id) ?? null;

      return {
        product_id: productIdNumeric,
        product_variant_id: variantIdNumeric,
        product_name: productName,
        product_sku: item?.product?.sku ?? null,
        variant_sku: item?.variant_sku ?? null,
        variant_attributes: item?.variant_attributes ?? null,
        description: item?.description ?? item?.notes ?? null,
        quantity: Number(item?.quantity ?? 0),
        unit_price: Number(item?.unitPrice ?? 0),
        total_price: Number(item?.totalPrice ?? item?.finalPrice ?? 0),
        final_unit_price: Number(item?.finalPrice ?? item?.unitPrice ?? 0),
        tax_amount_item: Number(item?.taxAmount ?? 0),
        tax_rate: item?.taxRate ?? null,
        tax_category_id: item?.taxCategoryId ?? null,
        applied_price_tier_id: item?.applied_price_tier_id ?? null,
        notes: item?.notes ?? null,
        // Strip the echo fields that are only used by the cart-to-modal
        // pipeline; the editor DTO only accepts the canonical booking
        // shape (booking_id?, provider_id?, date, start_time, end_time,
        // notes?, service_location_type?).
        ...(bookingBlock
          ? {
              booking: {
                booking_id: bookingBlock.booking_id,
                provider_id: bookingBlock.provider_id,
                date: bookingBlock.date,
                start_time: bookingBlock.start_time,
                end_time: bookingBlock.end_time,
                notes: bookingBlock.notes ?? '',
                service_location_type: bookingBlock.service_location_type ?? 'shop',
              },
            }
          : {}),
      };
    });

    const shipping = state.shippingContext;
    const shippingKeys: Record<string, unknown> = {};
    if (shipping) {
      if (shipping.deliveryType != null) {
        shippingKeys['delivery_type'] = shipping.deliveryType;
      }
      if (shipping.shippingAddressId != null) {
        shippingKeys['shipping_address_id'] = shipping.shippingAddressId;
      }
      if (shipping.billingAddressId != null) {
        shippingKeys['billing_address_id'] = shipping.billingAddressId;
      }
      if (shipping.shippingMethodId != null) {
        shippingKeys['shipping_method_id'] = shipping.shippingMethodId;
      }
      if (shipping.shippingRateId != null) {
        shippingKeys['shipping_rate_id'] = shipping.shippingRateId;
      }
      if (shipping.shippingCost != null) {
        shippingKeys['shipping_cost'] = shipping.shippingCost;
      }
    }

    return {
      customer_id: customerId,
      coupon_code: appliedCoupon?.code ?? null,
      promotion_ids: promotionIds,
      items,
      // Round 3 MAJOR #3 — never send empty strings for `notes` /
      // `internal_notes`. The backend's `?? ''` default kicks in when the key
      // is omitted (and `forbidNonWhitelisted` deletes the field on
      // unexpected keys). Empty string would survive a a round-trip and pin the
      // order's notes to "" — exactly the silent data loss Round 1 audited
      // for the cart path.
      ...(state.notes ? { notes: state.notes } : {}),
      ...(state.internalNotes ? { internal_notes: state.internalNotes } : {}),
      ...shippingKeys,
    };
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
        // CP-POS-SVC-PERF-001 / Annotation-4 — pick up the
        // reservations policy from the same store-settings payload so
        // a config change in /admin/settings/general/reservas takes
        // effect the next time the POS opens. Falls back to the
        // signal default (true) when the key is absent — older
        // settings payloads don't carry the field.
        const policy = (storeSettings as any)?.reservations
          ?.allow_bookings_without_payment;
        if (typeof policy === 'boolean') {
          this.allowBookingsWithoutPayment.set(policy);
        }
      });
    // CP-POS-SVC-PERF-001 / Annotation-4 — refresh the reservation
    // policy directly via /api/store/settings on every POS open. The
    // NgRx `selectStoreSettings` snapshot carries the value captured
    // at login time, which can drift out of sync if the operator
    // toggled the policy from another tab/session. This HTTP call
    // always sees the latest server-side value.
    this.http
      .get<any>(`${environment.apiUrl}/store/settings`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resp: any) => {
          const settings = resp?.data ?? resp;
          const policy = settings?.reservations?.allow_bookings_without_payment;
          if (typeof policy === 'boolean') {
            this.allowBookingsWithoutPayment.set(policy);
          }
        },
        error: () => {
          /* best-effort: signal keeps its prior value */
        },
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
  // ------------------------------------------------------------------ QUI-655
  /**
   * Envoltorio que interpone el modal de confirmacion de cocina ANTES de
   * consumir. Devuelve un Observable con la misma forma que
   * `restaurantIntegration.fireOrderItems`, asi que los dos call sites del POS
   * conservan intactos sus handlers de next/error.
   *
   * El POS es el SEGUNDO camino de envio a cocina. Sin esto, un envio hecho
   * desde el POS consumia la receta completa sin darle al cajero la chance de
   * excluir — y el ticket pide el modal en AMBOS caminos.
   */
  readonly kitchenConfirmOpen = signal(false);
  readonly kitchenPreview = signal<FirePreview | null>(null);
  readonly kitchenPreviewLoading = signal(false);
  /**
   * QUI-787 — el bridge ahora reenvía TANTO las exclusiones confirmadas
   * (QUI-655) COMO las notas por línea (`item_notes`) que el
   * `KitchenConfirmModalComponent` ya emite pero el POS descartaba. El fire
   * real se hace en el switchMap de abajo con ambos campos hacia el backend.
   */
  private kitchenConfirmBridge: Subject<{
    exclusions: FireItemExclusion[];
    item_notes?: PosFireItemNote[];
  }> | null = null;

  private fireWithKitchenConfirm(
    orderId: number,
    orderItemIds: number[],
  ): Observable<any> {
    this.kitchenPreview.set(null);
    this.kitchenPreviewLoading.set(true);
    this.kitchenConfirmOpen.set(true);

    const bridge = new Subject<{
      exclusions: FireItemExclusion[];
      item_notes?: PosFireItemNote[];
    }>();
    this.kitchenConfirmBridge = bridge;

    this.restaurantIntegration
      .previewFire(orderId, orderItemIds)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (preview) => {
          this.kitchenPreview.set(preview);
          this.kitchenPreviewLoading.set(false);
        },
        error: () => {
          // Si la previsualizacion falla se cierra el modal y se corta: NO se
          // dispara a ciegas, porque eso consumiria inventario sin que nadie
          // haya confirmado nada.
          this.kitchenPreviewLoading.set(false);
          this.kitchenConfirmOpen.set(false);
          bridge.error('No se pudieron leer las recetas del envio');
        },
      });

    // El fire real ocurre cuando el bridge emite las exclusiones + notas
    // confirmadas. Ambas viajan al backend como `exclusions` y `item_notes`.
    return bridge.pipe(
      take(1),
      switchMap((payload) =>
        this.restaurantIntegration.fireOrderItems(
          orderId,
          orderItemIds,
          undefined,
          payload.exclusions,
          payload.item_notes,
        ),
      ),
    );
  }

  onKitchenConfirmed(event: FireConfirmPayload | FireItemExclusion[]): void {
    this.kitchenConfirmOpen.set(false);
    const exclusions = Array.isArray(event) ? event : (event?.exclusions ?? []);
    // QUI-787 — `item_notes` solo aparece en el shape `FireConfirmPayload`;
    // el legacy `FireItemExclusion[]` (sin notas) sigue siendo válido.
    const item_notes = Array.isArray(event) ? undefined : event?.item_notes;
    this.kitchenConfirmBridge?.next({ exclusions, item_notes });
    this.kitchenConfirmBridge = null;
  }

  /** Cancelar no consume nada: el modal abre ANTES de cualquier escritura. */
  onKitchenCancelled(): void {
    this.kitchenConfirmOpen.set(false);
    this.kitchenPreview.set(null);
    // `complete` sin emitir: el switchMap nunca corre, asi que no hay fire.
    this.kitchenConfirmBridge?.complete();
    this.kitchenConfirmBridge = null;
    this.loading.set(false);
  }

  // ── CP-DTLP Phase E.2 — disparador POS del tiquete de despacho ────
  //
  // Cadena explícita (`trigger: 'explicit'`) al cierre de la venta con envío.
  // Defense-in-depth: `pos-order-confirmation` ya encadena su propio
  // `'automatic'` cuando `maybeAutoPrint` dispara, pero esta cadena aquí cubre
  // escenarios donde el modal aún no abre (`isOpen()` false) o la venta no es
  // `derivedIsPaid` (draft) — casos que `maybeAutoPrint` se salta por guard.

  /**
   * Helper único para los hooks `onPaymentCompleted` y `onShippingCompleted`.
   * Misma guard que E.2 manual: enabled + envío + NO `direct_delivery`.
   * El `'automatic'` (que además exige `print_dispatch_ticket_auto_with_pos`)
   * vive en `pos-order-confirmation.maybeAutoPrint`.
   */
  /**
   * Defense-in-depth para imprimir el tiquete de despacho desde el POS en
   * los hooks de cierre (`onPaymentCompleted` → venta POS, `onShippingCompleted`
   * → postventa).
   *
   * **QUI-764**: antes esta cadena rechazaba `direct_delivery` con un `return`
   * HARDCODED (lógica pre-QUI-727), ignorando `print_dispatch_ticket_on_counter`.
   * Adopta el predicado compartido `shouldAutoPrintDispatchTicket` que ya
   * entiende el flag del mostrador.
   *
   * El parámetro `autoFlagKey` selecciona la llave de auto-impresión del
   * ORIGEN. Hay dos, no una — los dos callsites tienen semántica distinta:
   *  - `'auto_with_pos'`     → cierre de venta POS (línea 2517)
   *  - `'auto_on_postventa'` → cierre de envío en postventa (línea 3456)
   *
   * El trigger es `'automatic'` (NO `'explicit'`): esta función corre desde
   * hooks automáticos. Pasar `'explicit'` saltaría la guarda `trigger ===
   * 'automatic' && !printDispatchTicketAuto` y el tiquete se imprimiría
   * aunque el admin haya apagado la auto-impresión — bug peor.
   *
   * La deduplicación de la impresión (entre esta cadena y la del modal de
   * confirmación `pos-order-confirmation.maybeAutoPrint`) vive en
   * `DispatchTicketPrintService.printDispatchTicket` (singleton) para que
   * ambos callsites la compartan.
   */
  private async printDispatchTicketIfNeededForOrder(
    order: any,
    autoFlagKey: 'auto_with_pos' | 'auto_on_postventa',
  ): Promise<void> {
    if (!order) return;
    const receipts = this.settingsFacade.receipts();
    const enabled = receipts?.print_dispatch_ticket_enabled ?? true;
    const autoFlag =
      autoFlagKey === 'auto_with_pos'
        ? receipts?.print_dispatch_ticket_auto_with_pos ?? false
        : receipts?.print_dispatch_ticket_auto_on_postventa ?? false;
    const counterEnabled =
      receipts?.print_dispatch_ticket_on_counter ?? false;

    const context: ShouldAutoPrintDispatchTicketContext = {
      printDispatchTicketEnabled: enabled,
      printDispatchTicketAuto: autoFlag,
      counterEnabled,
      deliveryType: order.delivery_type,
      isShippingSale: (order as any)?.isShippingSale,
    };

    if (!shouldAutoPrintDispatchTicket('automatic', context)) return;

    const items = (order.items || order.order_items || []).map(
      (item: any) => ({
        sku:
          item.sku ||
          item.product_sku ||
          item.variant_sku ||
          item.products?.sku ||
          item.product_variants?.sku ||
          '',
        productName: item.product_name || item.name || 'Producto',
        orderedQty: Number(item.quantity || 0),
        dispatchedQty: Number(item.quantity || 0),
      }),
    );
    const address =
      order.addresses_orders_shipping_address_idToaddresses ||
      order.shipping_address_snapshot ||
      null;
    const storeName =
      this.authFacade.getCurrentUser()?.store?.name || 'Vendix';
    const customerName =
      order.customer_name ||
      (order.customer
        ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() ||
          order.customer.name ||
          order.customer.business_name ||
          'Consumidor Final'
        : 'Consumidor Final');

    const data: DispatchTicketData = {
      orderId: order.id,
      orderNumber: order.order_number || order.number || 'N/A',
      dateFormatted: order.created_at
        ? new Date(order.created_at).toLocaleString('es-AR')
        : new Date().toLocaleString('es-AR'),
      storeName,
      customer: {
        name: customerName,
        addressLine1: address?.address_line1 || '',
        addressLine2: address?.address_line2,
        city: address?.city,
      },
      items,
    };

    try {
      await this.dispatchTicketPrint.printDispatchTicket(data, 'automatic');
    } catch (err) {
      console.error(
        `[QUI-764] Error al imprimir tiquete de despacho (${autoFlagKey}):`,
        err,
      );
    }
  }
}
