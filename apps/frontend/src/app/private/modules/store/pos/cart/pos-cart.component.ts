import { Component, input, output, inject, DestroyRef, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { map, distinctUntilChanged, skip } from 'rxjs/operators';
import { toSignal, toObservable, takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {
  PosCartService,
  CartState,
  CartItem,
  PromotionTierProgress } from '../services/pos-cart.service';
import { AddCustomItemRequest, CartDiscount } from '../models/cart.model';
import { PosCustomItemModalComponent } from '../components/pos-custom-item-modal/pos-custom-item-modal.component';
import { BookingSchedulerModalComponent } from '../../../../../shared/components/booking-scheduler-modal/booking-scheduler-modal.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { DialogService } from '../../../../../shared/components/dialog/dialog.service';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import {
  BadgeComponent,
  ButtonComponent,
  TooltipComponent,
} from '../../../../../shared/components';
import type { BadgeVariant } from '../../../../../shared/components';
import { QuantityControlComponent } from '../../../../../shared/components/quantity-control/quantity-control.component';
import type { QuantityClampEvent } from '../../../../../shared/components/quantity-control/quantity-control.component';
import { showStockCapToast } from './utils/stock-toast';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { PosScaleService } from '../services/pos-scale.service';
import { PosApiService } from '../services/pos-api.service';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { TaxesService } from '../../products/services/taxes.service';
import { TaxCategory } from '../../products/interfaces';
import {
  PriceTier,
  ProductPriceTierOverride,
  PriceTierCacheService,
  PriceTierSelectorComponent,
} from '../../price-tiers';
import { PosSaleUnitService } from '../services/pos-sale-unit.service';
import {
  formatSaleQuantity,
  isSaleUnitLine as isLineCapturedInSaleUnit,
} from '../utils/line-units.util';
import {
  EMPTY_CART_MESSAGE,
  EMPTY_CART_INLINE_TITLE,
  EMPTY_CART_INLINE_HINT,
} from '../../../../../core/utils/error-messages';

@Component({
  selector: 'app-pos-cart',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    ModalComponent,
    BadgeComponent,
    ButtonComponent,
    TooltipComponent,
    QuantityControlComponent,
    PriceTierSelectorComponent,
    PosCustomItemModalComponent,
    BookingSchedulerModalComponent,
  ],
  template: `
    <div
      class="h-full flex flex-col bg-surface rounded-card shadow-card border border-border overflow-hidden"
    >
      <!-- Cart Header & Summary Section (Fixed at top) -->
      <div class="flex-none bg-surface border-b border-border shadow-sm">
        <!-- Header Row -->
        <div
          class="px-5 py-3 border-b border-border/50 flex items-center justify-between gap-2"
        >
          <h2
            class="text-base font-bold text-text-primary flex items-center gap-2"
          >
            <app-icon
              name="shopping-cart"
              [size]="18"
              class="text-primary"
            ></app-icon>
            Carrito ({{ cartState().items.length }})
          </h2>

          <div class="flex items-center gap-1.5">
            <!-- Vaciar carrito (desktop): el modal móvil ya lo tiene; el
                 sidebar no lo exponía. Reusa clearCart() con confirmación. -->
            @if (!isEmpty()) {
              <button
                type="button"
                (click)="clearCart()"
                class="px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-colors border text-xs font-semibold shadow-2xs text-red-600 border-red-200 bg-red-50/80 hover:bg-red-100"
                aria-label="Vaciar carrito"
                title="Vaciar carrito"
              >
                <app-icon name="trash-2" [size]="14"></app-icon>
                <span>Vaciar</span>
              </button>
            }
            <!--
              Staff-only order note. Small state icon-button: gray when empty,
              green when a note exists. Opens a modal to edit it. The note is
              internal (set at creation), never shown to the customer.
            -->
            <button
              type="button"
              (click)="orderNoteModalOpen.set(true)"
              class="staff-note-btn relative px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-colors border text-xs font-semibold shadow-2xs"
              [class]="
                hasStaffNote()
                  ? 'text-green-700 bg-green-50 border-green-200 hover:bg-green-100'
                  : 'text-text-secondary border-border/80 hover:text-text-primary hover:bg-muted/40'
              "
              aria-label="Nota de la orden"
            >
              <app-icon name="notebook-pen" [size]="14"></app-icon>
              <span>Nota</span>
            </button>
          </div>
        </div>

        <!-- Totals Row (High Contrast) -->
        <div class="px-3 py-3 bg-muted/20">
          <div class="space-y-1.5 mb-4">
            <div class="flex justify-between text-xs text-text-secondary">
              <span>Subtotal</span>
              <span class="font-medium">{{
                formatCurrency(summary()?.subtotal || 0)
              }}</span>
            </div>
            <div class="flex justify-between text-xs text-text-secondary">
              <span>Impuestos</span>
              <span class="font-medium">{{
                formatCurrency(summary()?.taxAmount || 0)
              }}</span>
            </div>

            <!--
              Retención (preview). role='suffered': el cliente agente retenedor
              nos retiene; reduce el total a cobrar. Fuente única de verdad:
              endpoint backend /store/withholding-tax/preview. Solo se muestra
              cuando hay retención resuelta (> 0).
            -->
            @if (withholdingAmount() > 0) {
              <div class="flex justify-between text-xs text-text-secondary">
                <span class="flex items-center gap-1">
                  <app-icon name="minus" [size]="12" class="text-amber-600"></app-icon>
                  Retención
                </span>
                <span class="font-medium text-amber-700"
                  >-{{ formatCurrency(withholdingAmount()) }}</span
                >
              </div>
            }

            <!-- Promotions & Coupons (hidden in quotation mode) -->
            @if (!isQuotationMode() && !isLayawayMode()) {
              <!-- Promotions Applied -->
              @if (getPromotionDiscounts().length > 0) {
                <div class="pt-1.5 border-t border-border/30">
                  <div class="flex items-center gap-1.5 mb-1">
                    <app-icon
                      name="tag"
                      [size]="12"
                      class="text-green-600"
                    ></app-icon>
                    <span class="text-[11px] font-semibold text-green-700"
                      >Promociones aplicadas</span
                    >
                    <span
                      class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-100 text-green-700 text-[9px] font-bold"
                    >
                      {{ getPromotionDiscounts().length }}
                    </span>
                  </div>
                  @for (disc of getPromotionDiscounts(); track disc.id) {
                    <div class="flex items-start justify-between gap-2 py-0.5">
                      <div class="min-w-0 flex-1">
                        <div class="flex items-baseline gap-1 min-w-0 flex-wrap">
                          <span class="text-[11px] text-green-700 truncate">{{
                            disc.description
                          }}</span>
                          @if (formatAffectedProducts(disc.affected_products); as
                            affectedLabel) {
                            @if (affectedLabel) {
                              <span
                                class="text-[10px] text-green-600/80"
                                [title]="'Aplicada a: ' + affectedLabel"
                                >[{{ affectedLabel }}]</span
                              >
                            }
                          }
                          @if (disc.is_auto_applied) {
                            <span
                              class="inline-flex items-center px-1 rounded text-[8px] font-medium bg-green-100 text-green-600 shrink-0"
                              >auto</span
                            >
                          }
                        </div>
                        <div class="mt-0.5 flex flex-wrap items-center gap-1">
                          <app-badge
                            [variant]="promotionTypeBadge(disc).variant"
                            size="xsm"
                            badgeStyle="outline"
                          >
                            {{ promotionTypeBadge(disc).label }}
                          </app-badge>
                          @if (disc.badge_label) {
                            <app-badge
                              variant="warning"
                              size="xsm"
                              badgeStyle="outline"
                            >
                              {{ disc.badge_label }}
                            </app-badge>
                          }
                          <app-badge
                            variant="success"
                            size="xsm"
                            badgeStyle="solid"
                            title="Promoción activa aplicada."
                          >
                            Aplicada
                          </app-badge>
                        </div>
                      </div>
                      <div class="flex items-center gap-1 shrink-0">
                        <span class="text-[11px] font-medium text-green-700"
                          >-{{ formatCurrency(disc.amount) }}</span
                        >
                        @if (!disc.is_auto_applied) {
                          <button
                            (click)="removePromoDiscount(disc.id)"
                            class="p-0.5 rounded text-text-secondary hover:text-destructive hover:bg-destructive/10 transition-colors"
                            title="Eliminar promoción"
                          >
                            <app-icon name="x" [size]="10"></app-icon>
                          </button>
                        }
                      </div>
                    </div>
                  }
                </div>
              }

              <!--
                Tier progress nudge (best-effort). Shown when a scaled promo
                (quantity_tiered) already has in-scope items and a higher tier
                is reachable. Data comes from the active-promotions payload
                (promotion_quantity_tiers) — no extra backend call.
              -->
              @if (promotionTierProgress().length > 0) {
                <div class="pt-1.5 border-t border-border/30 space-y-1">
                  @for (
                    progress of promotionTierProgress();
                    track progress.promotion_id
                  ) {
                    <div
                      class="flex items-start gap-1.5 text-[10px] leading-tight text-primary"
                    >
                      <app-icon
                        name="trending-up"
                        [size]="11"
                        class="mt-0.5 shrink-0 text-primary"
                      ></app-icon>
                      <span>
                        Agrega
                        <span class="font-semibold"
                          >{{ progress.remaining_quantity }} und</span
                        >
                        más y obtén
                        <span class="font-semibold">{{
                          progress.next_benefit_label
                        }}</span>
                        en “{{ progress.name }}”.
                      </span>
                    </div>
                  }
                </div>
              }

              <!-- Coupon Code Input / Applied Coupon -->
              <div class="pt-1.5 border-t border-border/30">
                @if (getAppliedCoupon(); as coupon) {
                  <div class="flex items-center justify-between py-0.5">
                    <div class="flex items-center gap-1.5">
                      <app-icon
                        name="ticket"
                        [size]="12"
                        class="text-primary"
                      ></app-icon>
                      <span class="text-[11px] font-semibold text-primary">{{
                        coupon.coupon_code
                      }}</span>
                    </div>
                    <div class="flex items-center gap-1">
                      <span class="text-[11px] font-medium text-green-700"
                        >-{{ formatCurrency(getCouponDiscountAmount()) }}</span
                      >
                      <button
                        (click)="removeCoupon()"
                        class="p-0.5 rounded text-text-secondary hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Eliminar cupón"
                      >
                        <app-icon name="x" [size]="10"></app-icon>
                      </button>
                    </div>
                  </div>
                } @else {
                  <div class="flex items-center gap-1.5">
                    <input
                      type="text"
                      [(ngModel)]="couponCode"
                      placeholder="Código de cupón"
                      class="flex-1 px-2 py-1.5 text-xs rounded-md border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 uppercase"
                      (keydown.enter)="applyCoupon()"
                    />
                    <button
                      (click)="applyCoupon()"
                      [disabled]="!couponCode.trim() || couponLoading"
                      class="px-3 py-1.5 text-xs font-semibold rounded-md bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {{ couponLoading ? '...' : 'Aplicar' }}
                    </button>
                  </div>
                }
              </div>
            }

            <div
              class="pt-2 border-t border-border/50 flex justify-between items-center"
            >
              <span class="font-bold text-text-primary text-base">{{
                withholdingAmount() > 0 ? 'Total a cobrar' : 'Total'
              }}</span>
              <span class="font-extrabold text-2xl text-primary tracking-tight">
                {{ formatCurrency(netTotal()) }}
              </span>
            </div>

            <!--
              Local estimate disclaimer.
              Backend (PromotionEngineService + CouponsService) is the source
              of truth for the final discount and grand total. The values
              shown above are computed locally for UX feedback only and are
              recalculated server-side when the sale is processed.
            -->
            @if (getPromotionDiscounts().length > 0 || getAppliedCoupon()) {
              <div
                class="flex items-center gap-1 text-[10px] text-text-secondary/80 italic mt-1"
                title="Los totales finales se confirman al procesar el pago"
              >
                <app-icon name="info" [size]="10"></app-icon>
                <span>Estimación. El total final se confirma al cobrar.</span>
              </div>
            }

            <!--
              Aviso 5 UVT (Art. 616-1 ET / Res. 000165 de 2023). Aparece ANTES de
              cobrar para que el cajero pida el documento con el cliente delante:
              el backend rechaza la venta anónima por encima del tope, y descubrirlo
              al pulsar «Cobrar» obliga a rehacer el cierre.
            -->
            @if (invoiceRequiredByUvt()) {
              <div
                class="mt-2 flex items-start gap-2 rounded-md border border-warning bg-warning-light px-2 py-1.5 text-[11px] text-text-primary"
              >
                <app-icon name="alert-triangle" [size]="12" class="text-warning mt-0.5 shrink-0"></app-icon>
                <span>
                  Esta venta supera
                  {{ formatCurrency(uvtLimitCop()) }}
                  ({{ uvtThreshold()!.uvt_limit }} UVT) y requiere factura
                  electrónica: identifica al cliente antes de cobrar.
                </span>
              </div>
            }
          </div>

          <!-- Checkout Actions -->
          <div class="cart-actions">
            @if (isQuotationMode()) {
              <!-- Quotation mode: only quote button, styled as primary -->
              <button
                type="button"
                class="cart-btn checkout-btn"
                (click)="quote.emit()"
                [disabled]="isEmpty()"
              >
                <app-icon name="file-text" [size]="18"></app-icon>
                <span>Crear Cotización</span>
              </button>
            } @else if (isLayawayMode()) {
              <!-- Layaway mode: only layaway button -->
              <button
                type="button"
                class="cart-btn checkout-btn"
                (click)="layaway.emit()"
                [disabled]="isEmpty()"
              >
                <app-icon name="calendar" [size]="18"></app-icon>
                <span>Crear Plan Separé</span>
              </button>
            } @else {
              <!-- Normal POS buttons -->
              <div class="cart-actions-row">
                <button
                  type="button"
                  class="cart-btn custom-item-btn"
                  (click)="openCustomItemModal()"
                  [disabled]="!canCreateCustomItems()"
                  title="Agregar ítem personalizado"
                >
                  <app-icon name="file-plus" [size]="16"></app-icon>
                  <span>Ítem</span>
                </button>
                <button
                  type="button"
                  class="cart-btn save-btn"
                  (click)="saveDraft.emit()"
                  [disabled]="isEmpty()"
                >
                  <app-icon name="clipboard-list" [size]="16"></app-icon>
                  <span>Guardar</span>
                </button>
                <button
                  type="button"
                  class="cart-btn shipping-btn"
                  (click)="shipping.emit()"
                  [disabled]="isEmpty()"
                >
                  <app-icon name="truck" [size]="16"></app-icon>
                  <span>Envío</span>
                </button>
              </div>
              <!--
                CP-POS-CREAR-EDITAR-COBRAR-001 — main checkout CTA.
                proceedToPayment() delegates to checkout.emit() which the
                parent wires to onCheckout():
                  - create mode → opens the checkout shell stepper (customer
                    + shipping + payment) — the full payment flow.
                  - edit mode   → calls updateExistingOrder() first, then
                    surfaces readyToPayOrder so the secondary Cobrar
                    button below opens the payment modal.
                The label was previously mistyped as "Guardar Orden (no cobra)"
                in this slot — fixed back to Cobrar per D.2: only the
                secondary save button above renames to "Guardar Orden (no
                cobra)" because it saves a draft without payment.
              -->
              <button
                type="button"
                class="cart-btn checkout-btn"
                (click)="proceedToPayment()"
                [disabled]="isEmpty() || isCharging()"
                [attr.aria-busy]="isCharging() ? 'true' : null"
              >
                <app-icon name="credit-card" [size]="18"></app-icon>
                <span>Cobrar</span>
              </button>
              <!--
                Phase D.3 — Cobrar only when an updated order is sitting in
                readyToPayOrder. Visible in BOTH create-draft and edit modes,
                but realistically only ever non-null after an edit update.
                Separate button so the label matches the action: the primary
                CTA never silently opens payment.
              -->
              @if (readyToPayOrder() !== null && !isEditMode()) {
                <button
                  type="button"
                  class="cart-btn cobrar-btn"
                  (click)="charge.emit()"
                  [disabled]="isEmpty() || isCharging()"
                  [attr.aria-busy]="isCharging() ? 'true' : null"
                  [attr.aria-label]="cobrarAriaLabel()"
                >
                  <app-icon name="credit-card" [size]="18"></app-icon>
                  <span>Cobrar</span>
                </button>
              }
            }
          </div>
        </div>

        <!-- Customer Information (Compact) -->
        @if (cartState().customer) {
          <div
            class="px-5 py-2.5 bg-primary/5 border-t border-primary/10 flex items-center gap-3"
          >
            <div
              class="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary"
            >
              <app-icon name="user" [size]="14"></app-icon>
            </div>
            <div class="flex-1 min-w-0">
              <p
                class="text-[11px] text-text-secondary font-medium leading-none mb-0.5"
              >
                Cliente
              </p>
              <p class="text-xs font-bold text-text-primary truncate">
                {{ cartState().customer?.name }}
              </p>
            </div>
          </div>
        }
      </div>

      <!-- Cart Content (Scrollable Items) -->
      <div class="flex-1 overflow-y-auto p-4 bg-bg/30">
        <!-- Empty State -->
        @if (isEmpty()) {
          <div
            class="flex flex-col items-center pt-10 min-h-[200px] text-center opacity-60"
          >
            <div
              class="w-12 h-12 bg-muted/20 rounded-full flex items-center justify-center mb-3"
            >
              <app-icon
                name="shopping-cart"
                [size]="24"
                class="text-muted"
              ></app-icon>
            </div>
            <h3 class="text-sm font-semibold text-text-primary mb-1">
              {{ emptyCartTitle }}
            </h3>
            <p class="text-[11px] text-text-secondary">
              {{ emptyCartHint }}
            </p>
          </div>
        }

        <!-- Cart Items List -->
        @if (!isEmpty()) {
          <div class="space-y-2">
            @for (
              item of cartState().items;
              track trackByItemId($index, item)
            ) {
              <div
                class="group grid grid-cols-[40px_1fr_auto] gap-x-2.5 gap-y-1.5 p-2.5 rounded-md border border-border bg-surface hover:bg-muted/30 hover:border-primary/30 transition-all duration-200"
              >
                <!-- Product Image -->
                <div
                  class="row-span-1 w-10 h-10 shrink-0 bg-muted rounded-md overflow-hidden relative border border-border/50"
                >
                  @if (item.variant_image_url || item.product.image_url || item.product.image) {
                    <img
                      [src]="item.variant_image_url || item.product.image_url || item.product.image"
                      [alt]="item.product.name"
                      class="absolute inset-0 w-full h-full object-cover"
                      (error)="handleImageError($event)"
                    />
                  }
                  @if (!item.variant_image_url && !item.product.image_url && !item.product.image) {
                    <div
                      class="absolute inset-0 flex items-center justify-center text-text-secondary"
                    >
                      <app-icon name="image" [size]="14"></app-icon>
                    </div>
                  }
                </div>
                <!-- Item Info -->
                <div class="min-w-0 flex flex-col justify-center">
                  <div class="flex items-center gap-1.5">
                    <h4
                      class="text-sm font-semibold text-text-primary truncate leading-tight"
                    >
                      {{ item.product.name }}
                    </h4>
                    <!-- CP-POS-SVC-PERF-001 / C.3 — calendar icon on
                         service/prepared items opens the scheduler modal
                         so the cashier can pick staff + day + time before
                         Actualizar / Cobrar. Replaces the absent
                         scheduling UI of the prior release. -->
                    @if (
                      item.product.product_type === 'service' ||
                      item.product.product_type === 'prepared'
                    ) {
                      <button
                        type="button"
                        class="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-violet-600 hover:bg-violet-50 border border-violet-200 transition-colors"
                        [attr.aria-label]="
                          (schedulerFor(item.id) ? 'Re-agendar ' : 'Agendar ') +
                          item.product.name
                        "
                        [title]="
                          (schedulerFor(item.id) ? 'Re-agendar ' : 'Agendar ') +
                          item.product.name
                        "
                        (click)="openScheduler(item)"
                      >
                        <app-icon name="calendar" [size]="12"></app-icon>
                      </button>
                      <!--
                        QUI-787 · botón "Notas" por línea. Paridad visual con el
                        botón global "Nota" del header del carrito (mismo icono
                        notebook-pen, mismo texto "Nota", mismos estados de
                        color verde-lleno / gris-vacío). Compacto (px-1.5
                        py-0.5, texto 10 px, icono 12 px) para caber al lado de
                        la indita calendar sin romper la grilla del carrito.
                      -->
                      <button
                        type="button"
                        class="shrink-0 px-1.5 py-0.5 rounded flex items-center gap-1 border transition-colors text-[10px] font-semibold"
                        [class]="
                          item.notes
                            ? 'text-green-700 bg-green-50 border-green-200 hover:bg-green-100'
                            : 'text-text-secondary border-border/80 hover:text-text-primary hover:bg-muted/40'
                        "
                        [attr.aria-label]="
                          (item.notes ? 'Editar nota de ' : 'Agregar nota a ') +
                          item.product.name
                        "
                        [title]="
                          (item.notes ? 'Editar nota' : 'Agregar nota para cocina') +
                          ': ' +
                          item.product.name
                        "
                        (click)="openItemNote(item)"
                      >
                        <app-icon name="notebook-pen" [size]="12"></app-icon>
                        <span>Nota</span>
                      </button>
                    }
                  </div>
                  @if (item.notes) {
                    <!--
                      QUI-787 · chip amarillo de nota activa en su propia
                      línea para no competir con el botón "Nota". Paridad
                      visual con .item-comanda-note de mesa
                      (table-session-page.component.scss:688-700): fondo
                      warning-100, texto warning-700. Truncado a 180 px.
                    -->
                    <p
                      class="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium w-fit"
                      style="background-color: var(--color-warning-100, #fef3c7); color: var(--color-warning-700, #b45309);"
                      [attr.title]="'Nota para cocina: ' + item.notes"
                    >
                      <app-icon name="message-square" [size]="10"></app-icon>
                      <span class="truncate" style="max-width: 180px;">{{ item.notes }}</span>
                    </p>
                  }
                  @if (item.variant_display_name) {
                    <p
                      class="text-[10px] text-primary font-medium truncate leading-tight"
                    >
                      {{ item.variant_display_name }}
                    </p>
                  }
                  @if (item.itemType === 'custom' || item.description) {
                    <p
                      class="text-[10px] text-text-secondary truncate leading-tight"
                    >
                      {{ item.itemType === 'custom' ? 'Ítem personalizado' : item.description }}
                    </p>
                  }
                  <div class="flex items-center gap-2 mt-0.5">
                    <span class="text-[10px] text-text-muted">
                      Base: {{ formatCurrency(item.unitPrice)
                      }}{{ unitPriceSuffix(item) }}
                    </span>
                    @if (item.is_weight_product && item.weight) {
                      <span
                        class="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold bg-blue-100 text-blue-800"
                      >
                        {{ item.weight }} {{ item.weight_unit || 'kg' }}
                      </span>
                    }
                    @if (getItemTaxAmount(item) > 0) {
                      <span
                        class="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-medium bg-orange-100 text-orange-800"
                      >
                        +{{ formatCurrency(getItemTaxAmount(item)) }}
                      </span>
                    }
                    @if (item.isPriceOverridden) {
                      <span
                        class="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-medium bg-purple-100 text-purple-800"
                      >
                        precio editado
                      </span>
                    }
                    @if (item.applied_price_tier_id && item.applied_price_tier_name) {
                      <span
                        class="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold bg-amber-100 text-amber-800"
                        [title]="'Tarifa aplicada: ' + item.applied_price_tier_name"
                      >
                        {{ item.applied_price_tier_name }}
                      </span>
                    }
                    @if (isPackageLine(item)) {
                      <span
                        class="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-medium bg-blue-50 text-blue-700"
                        [title]="'Empaque de ' + item.units_per_package + ' unidades'"
                      >
                        Caja ×{{ item.units_per_package }}
                      </span>
                    }
                  </div>
                  @if (canShowTierSelector(item)) {
                    <div class="mt-1.5">
                      <app-price-tier-selector
                        [tiers]="visibleTiersForItem(item)"
                        [selectedTierId]="item.applied_price_tier_id ?? null"
                        [unitsPerPackage]="item.units_per_package ?? null"
                        (selectedTierIdChange)="onTierChange(item, $event)"
                      ></app-price-tier-selector>
                    </div>
                  } @else {
                    <!-- QUI-648: sin selector de presentación, la línea dice
                         POR QUÉ (la misma frase del editor de producto). -->
                    @if (saleConfigHints()[item.id]; as hint) {
                      <p
                        class="mt-1 text-[10px] text-text-muted leading-tight truncate"
                        [title]="hint.detail"
                      >
                        {{ hint.headline }}
                      </p>
                    }
                  }
                </div>
                <!-- Item actions -->
                <div class="flex items-start gap-1 self-start">
                  @if (item.itemType === 'custom' && canEditItemPrice(item)) {
                    <button
                      type="button"
                      (click)="editItemPrice(item)"
                      class="p-1 rounded text-primary hover:bg-primary/15 border border-primary/30 bg-primary/5 transition-colors shadow-2xs"
                      title="Editar ítem personalizado"
                    >
                      <app-icon name="pencil" [size]="13"></app-icon>
                    </button>
                  }
                  <button
                    type="button"
                    (click)="removeFromCart(item.id)"
                    class="p-1 rounded text-red-600 hover:bg-red-100 border border-red-200 bg-red-50/80 transition-colors shadow-2xs"
                    title="Eliminar"
                  >
                    <app-icon name="trash-2" [size]="13"></app-icon>
                  </button>
                </div>

                <!-- CP-POS-SVC-BOOKING-001: Booking summary badge for service line items -->
                @if (schedulerFor(item.id) || item.booking; as b) {
                  <div class="col-span-3 mt-1.5 flex items-center justify-between gap-1.5 p-2 rounded-md bg-violet-50 border border-violet-200 text-[11px] text-violet-900">
                    <div class="flex items-center gap-1.5 min-w-0">
                      <app-icon name="calendar-check" [size]="14" class="text-violet-600 shrink-0"></app-icon>
                      <div class="truncate">
                        <span class="font-bold">{{ b.date }}</span>
                        <span class="mx-1 opacity-70">|</span>
                        <span>{{ b.start_time }} – {{ b.end_time }}</span>
                        @if (b.provider_name) {
                          <span class="ml-1 text-violet-700 font-semibold truncate">({{ b.provider_name }})</span>
                        }
                        <span
                          class="ml-1.5 px-1 py-0.5 rounded text-[9px] font-bold inline-block"
                          [class]="b.service_location_type === 'home' ? 'bg-amber-100 text-amber-800' : 'bg-violet-200/70 text-violet-800'"
                        >
                          {{ b.service_location_type === 'home' ? 'A domicilio' : 'En tienda' }}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      (click)="openScheduler(item)"
                      class="px-2 py-0.5 rounded text-[10px] font-bold text-violet-700 hover:bg-violet-200/50 border border-violet-300 transition-colors shrink-0"
                    >
                      Re-agendar
                    </button>
                  </div>
                } @else if (item.product.product_type === 'service' || item.product.requires_booking) {
                  <div class="col-span-3 mt-1.5 flex items-center justify-between gap-1.5 p-2 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                    <div class="flex items-center gap-1.5 min-w-0">
                      <app-icon name="alert-circle" [size]="14" class="text-amber-600 shrink-0"></app-icon>
                      <span class="font-medium truncate">Servicio sin horario asignado</span>
                    </div>
                    <button
                      type="button"
                      (click)="openScheduler(item)"
                      class="px-2 py-0.5 rounded bg-amber-200 hover:bg-amber-300 text-amber-900 text-[10px] font-bold shrink-0 transition-colors"
                    >
                      Agendar
                    </button>
                  </div>
                }

                <!-- Actions Row: Quantity + Total -->
                <div
                  class="col-span-3 flex items-center justify-between pt-2 mt-1 border-t border-border/50"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <!-- Weight products: show clickable weight badge instead of quantity control -->
                    @if (item.is_weight_product) {
                      <button
                        (click)="editWeight(item)"
                        class="flex items-center gap-1.5 px-2 py-1 bg-blue-50 rounded-lg border border-blue-200 hover:bg-blue-100 hover:border-blue-300 transition-colors cursor-pointer"
                        title="Editar peso"
                      >
                        <app-icon
                          name="scale"
                          [size]="14"
                          class="text-blue-600"
                        ></app-icon>
                        <span class="text-xs font-bold text-blue-700"
                          >{{ item.weight }} {{ item.weight_unit || 'kg' }}</span
                        >
                        <app-icon
                          name="edit"
                          [size]="10"
                          class="text-blue-400"
                        ></app-icon>
                      </button>
                    } @else if (isSaleUnitLine(item)) {
                      <!-- QUI-648: la línea se muestra en la unidad que el
                           cajero capturó ("3 m"), nunca en milímetros. -->
                      <button
                        (click)="editSaleQuantity(item)"
                        class="flex items-center gap-1.5 px-2 py-1 bg-blue-50 rounded-lg border border-blue-200 hover:bg-blue-100 hover:border-blue-300 transition-colors cursor-pointer"
                        [title]="
                          item.captured_by_scale
                            ? 'Volver a pesar'
                            : 'Editar cantidad'
                        "
                      >
                        <app-icon
                          [name]="item.captured_by_scale ? 'scale' : 'edit'"
                          [size]="14"
                          class="text-blue-600"
                        ></app-icon>
                        <span class="text-xs font-bold text-blue-700">{{
                          saleQuantityLabel(item)
                        }}</span>
                      </button>
                    } @else {
                      <div class="flex flex-col gap-0.5">
                        <app-quantity-control
                          [value]="item.quantity"
                          [min]="1"
                          [max]="
                            getQuantityMax(item)
                          "
                          [unitsPerPackage]="getRequiredStockPerUnit(item)"
                          [editable]="true"
                          [size]="'sm'"
                          (valueChange)="updateQuantity(item.id, $event)"
                          (valueClamped)="onQuantityClamped(item, $event)"
                        ></app-quantity-control>
                        @if (isPackageLine(item)) {
                          <span class="text-[10px] font-medium text-blue-700 leading-none">
                            {{ item.quantity }} {{ item.quantity === 1 ? 'paquete' : 'paquetes' }}
                          </span>
                        }
                      </div>
                    }
                  </div>
                  <div class="flex shrink-0 items-center justify-end gap-2">
                    <span class="text-sm font-extrabold leading-none text-primary">
                      {{ formatCurrency(item.totalPrice) }}
                    </span>
                    @if (item.itemType !== 'custom' && canEditItemPrice(item)) {
                      <app-tooltip
                        content="Edita el precio de venta de este producto."
                        position="top"
                        size="sm"
                        color="default"
                      >
                        <button
                          type="button"
                          (click)="editItemPrice(item)"
                          class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary transition-colors hover:border-primary/40 hover:bg-primary/15"
                          aria-label="Editar precio de venta"
                          title="Edita el precio de venta de este producto."
                        >
                          <app-icon name="pencil" [size]="14"></app-icon>
                        </button>
                      </app-tooltip>
                    }
                  </div>
                </div>
              </div>
            }
          </div>
        }
      </div>
    </div>

    <!--
      Ítem personalizado. El modal es el MISMO del carril fiscal
      (vendix-invoice-custom-item-modal, tamaño xxl con configuración
      avanzada); acá sólo se le pasa el catálogo de impuestos que el POS ya
      cargó y se recibe la línea traducida al contrato del cobro. Ver
      pos-custom-item-modal.component.ts para la traducción campo por campo.
    -->
    <app-pos-custom-item-modal
      [open]="customItemModalOpen()"
      [taxCategories]="taxCategories()"
      (added)="addCustomItem($event)"
      (closed)="customItemModalOpen.set(false)"
    ></app-pos-custom-item-modal>

    <!--
      Staff-only order note modal. Internal instruction for the team, set at
      creation and never shown to the customer. Bound directly to
      cartState().notes via onStaffNoteChange -> PosCartService.updateNotes.
    -->
    <app-modal
      [isOpen]="orderNoteModalOpen()"
      title="Nota de la orden"
      size="sm"
      (closed)="orderNoteModalOpen.set(false)"
    >
      <div class="space-y-2">
        <textarea
          [ngModel]="cartState().notes"
          (ngModelChange)="onStaffNoteChange($event)"
          maxlength="500"
          rows="4"
          placeholder="Instrucción interna para el equipo, no se envía al cliente"
          class="w-full px-3 py-2 text-sm border border-border bg-surface rounded-md text-text-primary placeholder:text-text-secondary/60 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary resize-none"
        ></textarea>
        <div class="flex items-center justify-between">
          <span class="text-[11px] text-text-secondary">
            Instrucción interna para el equipo, no se envía al cliente.
          </span>
          <span class="text-[11px] text-text-secondary">
            {{ (cartState().notes || '').length }}/500
          </span>
        </div>
      </div>

      <div
        slot="footer"
        class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"
      >
        <app-button
          class="w-full sm:w-auto"
          variant="primary"
          size="md"
          customClasses="min-w-[120px]"
          (clicked)="orderNoteModalOpen.set(false)"
        >
          Aceptar
        </app-button>
      </div>
    </app-modal>

    <!--
      QUI-787 · editor de nota POR LÍNEA. Mismo patrón que el staff-note
      modal del header, pero: scoped a un CartItem, maxlength 200 (paridad
      con add-items-modal y FireOrderItemsDto.item_notes), y persiste via
      PosCartService.updateCartItem para que el campo viaje por el mismo
      camino que cantidad/precio (signal store → mapCartItemForPos).
    -->
    <app-modal
      [isOpen]="itemNoteModalOpen()"
      [title]="'Nota para cocina: ' + (itemNoteTarget()?.product?.name ?? '')"
      size="sm"
      (closed)="closeItemNote()"
    >
      <div class="space-y-2">
        <textarea
          [ngModel]="itemNoteDraft()"
          (ngModelChange)="itemNoteDraft.set($event)"
          maxlength="200"
          rows="2"
          placeholder="Notas para cocina (ej. sin cebolla, término medio). Opcional."
          class="w-full px-3 py-2 text-sm border border-border bg-surface rounded-md text-text-primary placeholder:text-text-secondary/60 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary resize-none"
        ></textarea>
        <div class="flex items-center justify-between">
          <span class="text-[11px] text-text-secondary">
            Opcional — se envía a cocina y a la comanda del KDS.
          </span>
          <span class="text-[11px] text-text-secondary">
            {{ (itemNoteDraft() || '').length }}/200
          </span>
        </div>
      </div>

      <div
        slot="footer"
        class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"
      >
        @if (itemNoteTarget()?.notes) {
          <app-button
            class="w-full sm:w-auto"
            variant="outline"
            size="md"
            customClasses="min-w-[120px]"
            (clicked)="clearItemNote()"
          >
            Quitar nota
          </app-button>
        }
        <app-button
          class="w-full sm:w-auto"
          variant="primary"
          size="md"
          customClasses="min-w-[120px]"
          (clicked)="closeItemNote()"
        >
          Aceptar
        </app-button>
      </div>
    </app-modal>

    <!--
      CP-POS-SVC-PERF-001 / C.2 + C.3 — service scheduler modal. Mounted
      at the cart root so the calendar icon on a service/prepared item
      can toggle the schedulerOpen signal with the target cartItem and
      optional existing booking for re-agendamiento.
    -->
    @if (schedulerOpen()) {
      <app-booking-scheduler-modal
        [cartItem]="schedulerTarget()"
        [existingBooking]="schedulerExisting()"
        [posCustomer]="cartState().customer"
        (customerSelected)="onCustomerSelected($event)"
        (scheduled)="onScheduled($event)"
        (cancelled)="closeScheduler()"
      ></app-booking-scheduler-modal>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      .cart-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .cart-actions-row {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }

      .cart-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px 8px;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        border: none;
      }

      .cart-btn:active:not(:disabled) {
        transform: scale(0.97);
      }

      .cart-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .checkout-btn {
        width: 100%;
        padding: 14px;
        background: var(--color-primary);
        color: white;
        font-size: 15px;
        font-weight: 700;
        box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.3);
      }

      .checkout-btn:hover:not(:disabled) {
        filter: brightness(1.05);
        transform: translateY(-1px);
      }

      .cobrar-btn {
        width: 100%;
        padding: 14px;
        background: linear-gradient(
          135deg,
          var(--color-success, #16a34a) 0%,
          var(--color-primary) 100%
        );
        color: white;
        font-size: 15px;
        font-weight: 700;
        box-shadow: 0 4px 14px rgba(34, 197, 94, 0.32);
      }

      .cobrar-btn:hover:not(:disabled) {
        filter: brightness(1.05);
        transform: translateY(-1px);
      }

      .cobrar-btn:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 2px;
      }

      .save-btn {
        background: var(--color-muted);
        border: 1px solid var(--color-border);
        color: var(--color-text-secondary);
      }

      .save-btn:hover:not(:disabled) {
        background: var(--color-surface);
        color: var(--color-text-primary);
        border-color: var(--color-text-secondary);
      }






      .shipping-btn {
        background: var(--color-primary);
        color: white;
        opacity: 0.85;
      }

      .custom-item-btn {
        background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface));
        border: 1px solid color-mix(in srgb, var(--color-primary) 25%, var(--color-border));
        color: var(--color-primary);
      }

      .custom-item-btn:hover:not(:disabled) {
        background: color-mix(in srgb, var(--color-primary) 16%, var(--color-surface));
      }

      .shipping-btn:hover:not(:disabled) {
        opacity: 1;
      }

      /* ── System AI tooltip (same pattern as ai-generate-btn) ── */
      .ai-tooltip {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        padding: 6px 12px;
        border-radius: 8px;
        background: linear-gradient(
          135deg,
          rgba(var(--color-primary-rgb), 0.85) 0%,
          rgba(var(--color-primary-rgb), 0.95) 50%,
          rgba(var(--color-primary-rgb), 0.85) 100%
        );
        background-size: 200% 200%;
        animation: ai-shimmer 3s ease-in-out infinite;
        color: white;
        font-size: 11px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition:
          opacity 0.2s ease,
          transform 0.2s ease;
        transform: translateY(-4px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        box-shadow:
          0 4px 12px rgba(0, 0, 0, 0.25),
          inset 0 1px 1px rgba(255, 255, 255, 0.15);
        z-index: 20;
      }

      .staff-note-btn:hover .ai-tooltip {
        opacity: 1;
        transform: translateY(0);
      }

      @keyframes ai-shimmer {
        0% {
          background-position: 0% 50%;
        }
        50% {
          background-position: 100% 50%;
        }
        100% {
          background-position: 0% 50%;
        }
      }
    `,
  ] })
export class PosCartComponent {
  private destroyRef = inject(DestroyRef);
private cartService = inject(PosCartService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private currencyService = inject(CurrencyFormatService);
  private scaleService = inject(PosScaleService);
  private posApiService = inject(PosApiService);
  private authFacade = inject(AuthFacade);
  private taxesService = inject(TaxesService);
  private priceTierCache = inject(PriceTierCacheService);
  private saleUnitService = inject(PosSaleUnitService);

  readonly cartState = this.cartService.cartState;
  // QUI-audit-round-1: copy centralizada para los tres sitios que muestran
  // «El carrito está vacío» (estado inline, toast de `proceedToPayment` y
  // mensaje de error genérico). Cualquier ajuste futuro vive en un único
  // archivo en lugar de tres.
  readonly emptyCartMessage = EMPTY_CART_MESSAGE;
  readonly emptyCartTitle = EMPTY_CART_INLINE_TITLE;
  readonly emptyCartHint = EMPTY_CART_INLINE_HINT;
  readonly availableTiers = signal<PriceTier[]>([]);
  /** Per-product (number key) override cache so the selector resolves instantly. */
  readonly productOverrides = signal<Record<number, ProductPriceTierOverride[]>>({});
  readonly isEmpty = toSignal(this.cartService.isEmpty, { initialValue: false });
  readonly summary = toSignal(this.cartService.summary, { initialValue: null! });
  /**
   * Net withholding the customer practices on this sale (role='suffered'),
   * resolved server-side via the preview endpoint. Reduces the amount to
   * collect. 0 when there is no customer or no applicable withholding.
   */
  readonly withholdingAmount = computed(
    () => Number(this.summary()?.withholdingAmount ?? 0) || 0,
  );
  /** Total a cobrar neto = total bruto - retención sufrida (preview). */
  readonly netTotal = computed(() => {
    const total = Number(this.summary()?.total ?? 0) || 0;
    return Math.max(0, total - this.withholdingAmount());
  });

  /**
   * Aviso 5 UVT resuelto por `PosCartService` (único dueño del umbral, para que
   * el carrito y el cierre de venta no puedan discrepar).
   */
  readonly uvtThreshold = this.cartService.uvtThreshold;
  readonly invoiceRequiredByUvt = this.cartService.invoiceRequiredByUvt;
  readonly uvtLimitCop = computed(
    () => this.cartService.uvtThreshold()?.limit_cop ?? 0,
  );
  readonly taxCategories = signal<TaxCategory[]>([]);
  readonly customItemModalOpen = signal(false);
  readonly canCreateCustomItems = computed(() =>
    this.hasPermission('store:pos:custom_items:create'),
  );
  readonly canOverridePrices = computed(() =>
    this.hasPermission('store:pos:price_override'),
  );
  readonly canApplyPricingTier = computed(() =>
    this.hasPermission('store:products:apply_pricing_tier'),
  );

  /**
   * QUI-648 — por qué una línea no ofrece presentaciones, en lenguaje del
   * comerciante y con la MISMA frase que ve en el editor de producto
   * (`buildSaleConfigExplanation`, vía `PosSaleUnitService.explain`). Se calcula
   * en un computed y no en el template para no rearmar la frase en cada ciclo
   * de detección de cambios. Vacío para el catálogo por pieza: ahí no hay nada
   * que explicar.
   */
  readonly saleConfigHints = computed<
    Record<string, { headline: string; detail: string }>
  >(() => {
    const hints: Record<string, { headline: string; detail: string }> = {};
    for (const item of this.cartState().items) {
      if (item.itemType === 'custom') continue;
      const explanation = this.saleUnitService.explain(
        item.product,
        this.visibleTiersForItem(item),
      );
      if (!explanation) continue;
      hints[item.id] = {
        headline: explanation.headline,
        detail: [explanation.headline, ...explanation.lines].join(' '),
      };
    }
    return hints;
  });

  /**
   * Active promotions fetched once from the backend. Signal-backed so the
   * tier-progress computed re-derives when they load. Kept as `any[]` to match
   * the existing loosely-typed promotions payload.
   */
  readonly activePromotions = signal<any[]>([]);
  couponCode = '';
  couponLoading = false;

  /**
   * Best-effort "faltan N und para el siguiente tramo" hints for auto-apply
   * quantity_tiered promotions. Zoneless-safe computed: recomputes when the
   * cart state (service signal) or the active promotions change. Empty when
   * there is nothing to nudge toward.
   */
  readonly promotionTierProgress = computed<PromotionTierProgress[]>(() =>
    this.cartService.getPromotionTierProgress(this.activePromotions()),
  );

  readonly isEditMode = input<boolean>(false);
  readonly isQuotationMode = input<boolean>(false);
  readonly isLayawayMode = input<boolean>(false);
  /**
   * Phase D.3 — when non-null, the parent has a fresh order ready to be
   * charged. We render a separate `Cobrar` button under the primary CTA so
   * the cashier has a single, unambiguous next step.
   */
  readonly readyToPayOrder = input<unknown>(null);
  readonly isCharging = input<boolean>(false);
  readonly create = output<void>();
  /**
   * CP-POS-CREAR-EDITAR-COBRAR-001 — direct save-draft (skip the checkout
   * shell stepper). Bound by the parent to `posPaymentService.saveDraft()`
   * so the "Guardar" button persists the order with `is_draft=true,
   * requires_payment=false` and NEVER opens the payment step. The
   * separate `Cobrar` button below uses the full shell wizard.
   */
  readonly saveDraft = output<void>();
  readonly shipping = output<void>();
  readonly checkout = output<void>();
  /**
   * Phase D.3 — emitted when the cashier clicks the `Cobrar` CTA. The parent
   * mounts the reused `OrderPaymentModalComponent` over the fresh order.
   */
  readonly charge = output<void>();
  readonly quote = output<void>();
  readonly layaway = output<void>();
  readonly customerSelected = output<any>();
  /**
   * CP-POS-SVC-PERF-001 / D.2 — emits the latest `cartBookingsByItemId`
   * map so the parent POS shell can attach the matching booking block
   * to each cart line in the editor DTO on Actualizar / Cobrar. The
   * map is keyed by `item.id` (cart-local id) and contains the booking
   * payload (booking_id?, provider_id, date, start_time, end_time,
   * notes, service_location_type, cart_item_id).
   */
  readonly bookingsChanged = output<Map<string, any>>();

  /**
   * QUI-audit-round-1 — accessible label for the `Cobrar` CTA. The CTA only
   * renders when `readyToPayOrder !== null`, so the order_number is
   * available via a generic cast. Fallback to `Cobrar orden` when the
   * caller forgets to include the order_number in the payload.
   */
  readonly cobrarAriaLabel = computed<string>(() => {
    const order = this.readyToPayOrder() as
      | { order_number?: string | number }
      | null;
    const orderNumber = order?.order_number;
    return orderNumber != null && orderNumber !== ''
      ? `Cobrar orden #${orderNumber}`
      : 'Cobrar orden';
  });

  constructor() {
    this.taxesService
      .getTaxCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (taxCategories) => this.taxCategories.set(taxCategories || []),
        error: () => this.taxCategories.set([]),
      });

    // Load active tiers once. Cache is shareReplay'd so other modules reuse.
    if (this.canApplyPricingTier()) {
      this.priceTierCache
        .getActiveTiers()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (tiers) => this.availableTiers.set(tiers || []),
          error: () => this.availableTiers.set([]),
        });
    }

    // Pre-fetch overrides whenever a new tier-enabled product appears in the
    // cart. Uses item count + product ids in the dependency string to avoid
    // re-running on quantity changes.
    toObservable(this.cartService.cartState)
      .pipe(
        map((state) =>
          state.items
            .filter(
              (i) =>
                i.itemType !== 'custom' &&
                i.product.has_multiple_price_tiers === true,
            )
            .map((i) => Number(i.product.id))
            .filter((id) => Number.isFinite(id) && id > 0),
        ),
        map((ids) => Array.from(new Set(ids)).sort()),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((productIds) => {
        for (const productId of productIds) {
          if (this.productOverrides()[productId]) continue;
          this.priceTierCache
            .getProductOverrides(productId)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (overrides) => {
                this.productOverrides.update((current) => ({
                  ...current,
                  [productId]: overrides || [],
                }));
              },
              error: () => {
                this.productOverrides.update((current) => ({
                  ...current,
                  [productId]: [],
                }));
              },
            });
        }
      });

// Load active promotions
    this.posApiService
      .getActivePromotions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.activePromotions.set(response?.data || response || []);
        },
        error: () => {
          // Silently fail - promotions are not critical
          this.activePromotions.set([]);
        } });

    // Re-apply promotions when cart items change (use item count to avoid infinite loops)
    toObservable(this.cartService.cartState)
      .pipe(
        map((state) =>
          JSON.stringify(
            state.items.map((i) => ({
              id: i.product.id,
              qty: i.quantity,
              vid: i.variant_id })),
          ),
        ),
        distinctUntilChanged(),
        skip(1), // Skip initial emission
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        const promotions = this.activePromotions();
        if (promotions.length > 0) {
          this.cartService
            .applyPromotions(promotions)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe();
        }
      });
  }

  trackByItemId(_index: number, item: CartItem): string {
    return item.id;
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

  openCustomItemModal(): void {
    if (!this.canCreateCustomItems()) {
      this.toastService.warning('No tienes permiso para agregar ítems personalizados');
      return;
    }
    // Sin borrador que reiniciar: el modal compartido se hidrata en blanco cada
    // vez que `open` pasa a `true` (ver su `effect` de apertura).
    this.customItemModalOpen.set(true);
  }

  /**
   * La línea ya viene traducida al contrato del cobro por
   * `PosCustomItemModalComponent`; acá sólo se agrega al carrito.
   */
  addCustomItem(request: AddCustomItemRequest): void {
    this.cartService
      .addCustomItem(request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.customItemModalOpen.set(false);
          this.toastService.success('Ítem personalizado agregado');
        },
        error: (error) => {
          this.toastService.error(error.message || 'Error al agregar el ítem');
        },
      });
  }

  canEditItemPrice(item: CartItem): boolean {
    if (item.itemType === 'custom') {
      return this.canCreateCustomItems();
    }

    return (
      item.product.allow_pos_price_override === true &&
      this.canOverridePrices()
    );
  }

  async editItemPrice(item: CartItem): Promise<void> {
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
        error: (error) =>
          this.toastService.error(error.message || 'Error al actualizar precio'),
      });
  }

  /**
   * Returns the override rows for the item's product, filtered to the
   * currently-selected tier. Empty array if the cache hasn't loaded yet.
   */
  getOverridesForItem(item: CartItem, tierId: number | null): ProductPriceTierOverride[] {
    if (item.itemType === 'custom') return [];
    const productId = Number(item.product.id);
    if (!Number.isFinite(productId) || productId <= 0) return [];
    const all = this.productOverrides()[productId] ?? [];
    if (tierId == null) return all;
    return all.filter((o) => o.price_tier_id === tierId);
  }

  /** True when the line should expose the multi-tarifa selector. */
  visibleTiersForItem(item: CartItem): PriceTier[] {
    if (item.itemType === 'custom') return [];
    const enabledIds = item.product.enabled_price_tier_ids ?? [];
    if (!Array.isArray(enabledIds) || enabledIds.length === 0) return [];
    const enabled = new Set(enabledIds.map(Number));
    return this.availableTiers().filter((tier) => enabled.has(tier.id));
  }

  canShowTierSelector(item: CartItem): boolean {
    return (
      item.itemType !== 'custom' &&
      // QUI-648: una línea pesada NO ofrece presentación. Lo que la balanza
      // capturó ya define la cantidad vendida; encima ofrecerle un "rollo" o un
      // "bulto" al cajero es pedirle que contradiga lo que acaba de pesar.
      item.captured_by_scale !== true &&
      !item.is_weight_product &&
      item.product.has_multiple_price_tiers === true &&
      this.canApplyPricingTier() &&
      this.visibleTiersForItem(item).length > 0
    );
  }

  /**
   * QUI-648 — sufijo de la escala de precio: "/m", "/kg", "/paquete". Sin él,
   * un cable a $5.000 el metro se leería como $5.000 el milímetro.
   */
  unitPriceSuffix(item: CartItem): string {
    if (item.is_weight_product) return '/' + (item.weight_unit || 'kg');
    if (this.isPackageLine(item)) return '/paquete';
    return item.sale_unit_code ? '/' + item.sale_unit_code : '';
  }

  /** `true` cuando la línea se capturó en una unidad de venta ≠ unidad mínima. */
  isSaleUnitLine(item: CartItem): boolean {
    return isLineCapturedInSaleUnit(item);
  }

  /** "3 m" / "2,35 kg": la cantidad tal como la capturó el cajero. */
  saleQuantityLabel(item: CartItem): string {
    return formatSaleQuantity(item);
  }

  /**
   * Reedita una línea medida EN SU UNIDAD DE VENTA. Si se capturó con la
   * balanza se vuelve a pesar; si se digitó, se vuelve a digitar. La conversión
   * a la unidad mínima es interna, igual que en la captura original.
   */
  async editSaleQuantity(item: CartItem): Promise<void> {
    const factor = Number(item.stock_units_per_sale_unit ?? 1) || 1;
    const unit = item.sale_unit_code || '';
    const current = Number(item.quantity) / factor;
    let amount: number | undefined;

    if (item.captured_by_scale && this.scaleService.isConnected()) {
      amount = await this.scaleService.showWeightModal({
        title: 'Volver a pesar',
        message: `${item.product.name}\nPrecio: ${this.formatCurrency(item.unitPrice)}/${unit}`,
        weightUnit: unit,
        allowManualFallback: true,
      });
    } else {
      const raw = await this.dialogService.prompt(
        {
          title: `Cantidad en ${unit}`,
          message: `${item.product.name}\nPrecio: ${this.formatCurrency(item.unitPrice)}/${unit}`,
          placeholder: `Cantidad en ${unit}`,
          defaultValue: String(current),
          confirmText: 'Actualizar',
          cancelText: 'Cancelar',
          inputType: 'number',
        },
        { size: 'sm' },
      );
      if (!raw) return;
      const parsed = parseFloat(String(raw).replace(',', '.'));
      amount = Number.isNaN(parsed) ? undefined : parsed;
    }

    if (amount === undefined) return;
    if (!(amount > 0)) {
      this.toastService.warning('La cantidad debe ser mayor a 0');
      return;
    }

    const quantity = Math.round(amount * factor);
    if (quantity <= 0) {
      this.toastService.warning(
        `La cantidad mínima es ${1 / factor} ${unit}.`,
      );
      return;
    }
    this.updateQuantity(item.id, quantity);
  }

  onTierChange(item: CartItem, tierId: number | null): void {
    if (!this.canApplyPricingTier()) {
      // UI gate already prevents this — defensive guard against keyboard injection.
      this.toastService.warning(
        'No tienes permiso para aplicar tarifas de precio',
      );
      return;
    }
    const tier =
      tierId == null
        ? null
        : this.visibleTiersForItem(item).find((t) => t.id === tierId) || null;
    if (tierId != null && !tier) {
      this.toastService.warning('Esta tarifa no está habilitada para el producto');
      return;
    }
    const overrides = this.getOverridesForItem(item, tier?.id ?? null);

    this.cartService
      .applyTierToCartItem(item.id, tier, overrides)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (tier) {
            this.toastService.success(`Tarifa "${tier.name}" aplicada`);
          } else {
            this.toastService.info('Tarifa default restaurada');
          }
        },
        error: (error) =>
          this.toastService.error(error.message || 'Error al aplicar la tarifa'),
      });
  }

  updateQuantity(itemId: string, quantity: number): void {
    if (quantity <= 0) {
      this.removeFromCart(itemId);
      return;
    }

    this.cartService
      .updateCartItem({ itemId, quantity })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {},
        error: (error) => {
          this.toastService.error(
            error.message || 'Error al actualizar cantidad',
          );
        } });
  }

  /**
   * Manejador del evento `valueClamped` del `quantity-control`.
   * Se dispara cuando el usuario teclea una cantidad fuera del rango
   * permitido (mayor al stock o menor al mínimo). Solo el cap superior
   * (max) nos interesa aquí — el cap inferior ya está manejado por
   * `updateQuantity` cuando la cantidad es <= 0.
   */
  onQuantityClamped(item: CartItem, event: QuantityClampEvent): void {
    if (event.reason !== 'max') return;
    showStockCapToast(this.toastService, item, event.limit);
  }

  /**
   * Stock units consumed per cart unit. Packaging is tier-owned: when the
   * applied tier resolves a pack size > 1, the cart `quantity` counts PACKAGES
   * and each package consumes `units_per_package` stock units.
   */
  getRequiredStockPerUnit(item: CartItem): number {
    if (item.is_package_unit && item.units_per_package) {
      const units = Number(item.units_per_package);
      return Number.isFinite(units) && units > 1 ? units : 1;
    }
    return 1;
  }

  /** True when this line is sold by package (tier pack size > 1). */
  isPackageLine(item: CartItem): boolean {
    return !!item.is_package_unit && Number(item.units_per_package ?? 0) > 1;
  }

  /** Total stock units for a package line (= quantity * pack size). */
  getTotalUnits(item: CartItem): number {
    return item.quantity * Number(item.units_per_package ?? 1);
  }

  getQuantityMax(item: CartItem): number {
    if (item.itemType === 'custom' || item.product.track_inventory === false) {
      return 999;
    }
    const availableStock = this.getAvailableStockForItem(item);
    const requiredPerUnit = this.getRequiredStockPerUnit(item);
    return Math.max(0, Math.floor(availableStock / requiredPerUnit));
  }

  private getAvailableStockForItem(item: CartItem): number {
    if (item.variant_id) {
      const variant = item.product.product_variants?.find(
        (candidate) => Number(candidate.id) === Number(item.variant_id),
      );
      if (variant?.track_inventory_override === false) return 999;
      return Number(variant?.stock ?? 0);
    }
    return Number(item.product.stock ?? 0);
  }

  removeFromCart(itemId: string): void {
    if (this.cartBookingsByItemId().has(itemId)) {
      const next = new Map(this.cartBookingsByItemId());
      next.delete(itemId);
      this.cartBookingsByItemId.set(next);
      this.bookingsChanged.emit(next);
    }
    this.cartService
      .removeFromCart(itemId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Producto eliminado del carrito');
        },
        error: (error) => {
          this.toastService.error(
            error.message || 'Error al eliminar producto',
          );
        },
      });
  }

  async clearCart(): Promise<void> {
    const confirm = await this.dialogService.confirm({
      title: 'Vaciar Carrito',
      message:
        '¿Estás seguro de que quieres vaciar todos los productos del carrito?',
      confirmText: 'Vaciar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });

    if (confirm) {
      const next = new Map<string, any>();
      this.cartBookingsByItemId.set(next);
      this.bookingsChanged.emit(next);
      this.cartService
        .clearCart()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.toastService.success('Carrito vaciado');
          },
          error: (error) => {
            this.toastService.error(error.message || 'Error al vaciar carrito');
          },
        });
    }
  }

  /**
   * Whether the staff-note modal is open. Opened from the small state
   * icon-button in the cart header (gray when empty, green when a note
   * exists); independent of cart state so typing never closes it.
   */
  readonly orderNoteModalOpen = signal(false);

  // ─── QUI-787 · nota por línea (preparados / servicios → KDS) ─────────
  // El editor se monta UNA VEZ por línea; las signals locales guardan qué
  // item se está editando y el borrador (sin trim) mientras el cajero
  // teclea. El trim y la persistencia pasan al servicio solo al cerrar.
  readonly itemNoteModalOpen = signal(false);
  readonly itemNoteTarget = signal<CartItem | null>(null);
  readonly itemNoteDraft = signal<string>('');

  /**
   * CP-POS-SVC-BOOKING-001 — Service scheduler state.
   */
  readonly schedulerOpen = signal(false);
  readonly schedulerTarget = signal<any>(null);
  readonly schedulerExisting = signal<any>(null);
  readonly cartBookingsByItemId = signal<Map<string, any>>(new Map());

  openScheduler(item: any): void {
    this.schedulerTarget.set(item);
    const existing = this.cartBookingsByItemId().get(item.id) || item.booking;
    this.schedulerExisting.set(existing ?? null);
    this.schedulerOpen.set(true);
  }

  closeScheduler(): void {
    this.schedulerOpen.set(false);
    this.schedulerTarget.set(null);
    this.schedulerExisting.set(null);
  }

  onCustomerSelected(c: any): void {
    if (c) {
      this.cartService.setCustomer(c).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
      this.customerSelected.emit(c);
    }
  }

  onScheduled(booking: any): void {
    const target = this.schedulerTarget();
    if (!target || !booking) {
      this.closeScheduler();
      return;
    }
    if (booking.customer) {
      this.cartService.setCustomer(booking.customer).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
      this.customerSelected.emit(booking.customer);
    }
    const resolvedProductId =
      typeof target.productId === 'number'
        ? target.productId
        : Number(target.productId) || Number(target.product?.id) || Number(booking.product_id) || 0;
    const enrichedBooking = {
      ...booking,
      product_id: resolvedProductId,
      product_variant_id: target.variant_id ?? booking.product_variant_id ?? null,
      cart_item_id: target.id,
    };
    const next = new Map(this.cartBookingsByItemId());
    next.set(target.id, enrichedBooking);
    this.cartBookingsByItemId.set(next);
    target.booking = enrichedBooking;
    // CP-POS-SVC-BOOKING-001 — bubble up so parent POS shell attaches booking block to cart line
    this.bookingsChanged.emit(next);
    this.cartService
      .addPendingBooking({
        id: booking.booking_id ?? 0,
        booking_number: '',
        product_id: resolvedProductId,
        product_name: target.product?.name ?? '',
        product_variant_id: target.variant_id ?? booking.product_variant_id ?? null,
        variant_name: target.variant_display_name ?? undefined,
        customer_id: booking.customer_id ?? 0,
        date: booking.date,
        start_time: booking.start_time,
        end_time: booking.end_time,
        provider_name: booking.provider_name ?? undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
    this.closeScheduler();
  }

  /**
   * Read accessor for the template — returns booking attached to this cart line.
   */
  schedulerFor(itemId: string): any {
    const fromMap = this.cartBookingsByItemId().get(itemId);
    if (fromMap) return fromMap;
    const item = this.cartState().items.find((i) => i.id === itemId);
    return item?.booking ?? null;
  }

  /** True when the current cart already carries a staff note (drives the header icon color). */
  readonly hasStaffNote = computed(() => (this.cartState().notes ?? '').length > 0);

  /**
   * Update the staff-only note for the current cart.
   * Delegates to PosCartService.updateNotes so the value flows through
   * the same signal store used by PosOrderService.
   */
  onStaffNoteChange(notes: string): void {
    this.cartService.updateNotes(notes ?? '').subscribe();
  }

  // ─── QUI-787 · handlers del editor de nota por línea ──────────────

  /**
   * Abre el editor de nota para una línea. Pre-rellena con la nota actual
   * (puede estar vacía). El editor es independiente del modal de staff-note
   * del header: ese es GLOBAL a la orden, este es POR PLATO.
   */
  openItemNote(item: CartItem): void {
    this.itemNoteTarget.set(item);
    this.itemNoteDraft.set(item.notes ?? '');
    this.itemNoteModalOpen.set(true);
  }

  /**
   * Cierra el editor y, si el borrador trimado difiere del actual, lo persiste
   * via `PosCartService.updateCartItem` (que ya propaga `notes` a través del
   * signal store — ver `pos-cart.service.ts:2224, 2265, 2383`). Si el cajero
   * borró todo, el campo se omite para que el backend lo deje en null.
   */
  closeItemNote(): void {
    const target = this.itemNoteTarget();
    const draft = this.itemNoteDraft().trim();
    if (!target) {
      this.itemNoteModalOpen.set(false);
      return;
    }
    const next = draft.length > 0 ? draft : undefined;
    // no-op si no cambió
    if ((target.notes ?? '') === (next ?? '')) {
      this.itemNoteModalOpen.set(false);
      return;
    }
    this.cartService
      .updateCartItem({
        itemId: target.id,
        quantity: target.quantity,
        notes: next,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success(next ? 'Nota guardada' : 'Nota eliminada');
          this.itemNoteModalOpen.set(false);
          this.itemNoteTarget.set(null);
          this.itemNoteDraft.set('');
        },
        error: (err) =>
          this.toastService.error(err?.message || 'Error al guardar la nota'),
      });
  }

  /**
   * Vuelca el draft a vacío. El guardado real ocurre en `closeItemNote` cuando
   * el cajero toca "Aceptar" — el botón "Quitar nota" del modal usa esto para
   * limpiar el textarea y luego Aceptar persiste el cambio a null.
   */
  clearItemNote(): void {
    this.itemNoteDraft.set('');
  }

  proceedToPayment(): void {
    const currentState = this.cartService.getCurrentState();
    if (currentState.items.length === 0) {
      this.toastService.warning(this.emptyCartMessage);
      return;
    }

    this.checkout.emit();
  }

  async editWeight(item: CartItem): Promise<void> {
    const unit = item.weight_unit || 'kg';
    let newWeight: number;

    if (this.scaleService.isConnected()) {
      const scaleWeight = await this.scaleService.showWeightModal({
        title: 'Editar Peso',
        message: `${item.product.name}\nPrecio: ${this.formatCurrency(item.unitPrice)}/${unit}`,
        weightUnit: unit,
        allowManualFallback: true });
      if (scaleWeight === undefined) return;
      newWeight = scaleWeight;
    } else {
      const weightStr = await this.dialogService.prompt(
        {
          title: 'Editar Peso',
          message: `${item.product.name}\nPrecio: ${this.formatCurrency(item.unitPrice)}/${unit}`,
          placeholder: `Peso en ${unit}`,
          defaultValue: item.weight?.toString() || '1.0',
          confirmText: 'Actualizar',
          cancelText: 'Cancelar',
          inputType: 'number' },
        { size: 'sm' },
      );

      if (!weightStr) return;
      newWeight = parseFloat(weightStr.replace(',', '.'));
    }

    if (isNaN(newWeight) || newWeight <= 0) {
      this.toastService.warning('El peso debe ser mayor a 0');
      return;
    }
    if (newWeight > 999) {
      this.toastService.warning('El peso máximo permitido es 999 ' + unit);
      return;
    }

    this.cartService
      .updateCartItemWeight(item.id, newWeight)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success(`Peso actualizado: ${newWeight} ${unit}`);
        },
        error: (error) => {
          this.toastService.error(error.message || 'Error al actualizar peso');
        } });
  }

  getPromotionDiscounts(): CartDiscount[] {
    return this.cartService
      .getCurrentState()
      .appliedDiscounts.filter((d) => d.promotion_id);
  }

  /**
   * Type badge descriptor for an applied promotion. Percentage promotions read
   * as a success (green) badge, fixed-amount ones as a primary (blue) badge —
   * purely presentational, driven by the already-resolved discount `type`.
   */
  promotionTypeBadge(disc: CartDiscount): { label: string; variant: BadgeVariant } {
    return disc.type === 'percentage'
      ? { label: 'Porcentaje', variant: 'success' }
      : { label: 'Monto fijo', variant: 'primary' };
  }

  /**
   * Compress the list of products the discount was applied to into a compact
   * parenthetical label for the cart sidebar. Mirrors the ecommerce
   * `formatAffectedLabel` but uses square brackets to fit the tighter POS
   * density:
   *   [] / undefined → '' (whole-order scope, no suffix)
   *   ['Guanabana'] → 'Guanabana'
   *   ['A', 'B']    → 'A, B'
   *   ['A', 'B', 'C'] → 'A, B +1'
   *
   * The template uses `@if (...; as affectedLabel)` to bind the formatted
   * string once, so the conditional + interpolation read cleanly.
   */
  formatAffectedProducts(products: string[] | undefined): string {
    if (!products || products.length === 0) return '';
    const names = products
      .map((n) => n.trim())
      .filter((n) => n.length > 0);
    if (names.length === 0) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]}, ${names[1]}`;
    return `${names[0]}, ${names[1]} +${names.length - 2}`;
  }

  removePromoDiscount(discountId: string): void {
    this.cartService
      .removeDiscount(discountId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Promoción eliminada');
        },
        error: (error) => {
          this.toastService.error(
            error.message || 'Error al eliminar promoción',
          );
        } });
  }

  applyCoupon(): void {
    const code = this.couponCode?.trim().toUpperCase();
    if (!code) return;

    const currentState = this.cartService.getCurrentState();
    const subtotal =
      currentState.summary.subtotal + currentState.summary.taxAmount;
    const customerId = currentState.customer?.id;
    const productIds = currentState.items
      .filter((item) => item.itemType !== 'custom')
      .map((item) => parseInt(item.product.id))
      .filter((id) => Number.isFinite(id));
    const categoryIds = Array.from(
      new Set(
        currentState.items.flatMap((item) => {
          const product = item.product as any;
          const ids = Array.isArray(product.category_ids)
            ? product.category_ids
            : product.category_id
              ? [product.category_id]
              : [];
          return ids
            .map((id: string | number) => Number(id))
            .filter((id: number) => Number.isFinite(id));
        }),
      ),
    );
    const couponItems = currentState.items
      .filter((item) => item.itemType !== 'custom')
      .map((item) => {
        const product = item.product as any;
        const itemCategoryIds = Array.isArray(product.category_ids)
          ? product.category_ids
          : product.category_id
            ? [product.category_id]
            : [];

        return {
          product_id: Number(item.product.id),
          category_ids: itemCategoryIds
            .map((id: string | number) => Number(id))
            .filter((id: number) => Number.isFinite(id)),
          line_total: Number(item.totalPrice || 0),
        };
      })
      .filter((item) => Number.isFinite(item.product_id));

    this.couponLoading = true;
    this.posApiService
      .validateCoupon(code, subtotal, customerId, productIds, categoryIds, couponItems)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const validation = response?.data || response;
          if (validation?.valid) {
            this.cartService
              .applyCouponDiscount(validation)
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe({
                next: () => {
                  this.toastService.success(`Cupón "${code}" aplicado`);
                  this.couponCode = '';
                  this.couponLoading = false;
                },
                error: (error) => {
                  this.toastService.error(
                    error.message || 'Error al aplicar cupón',
                  );
                  this.couponLoading = false;
                } });
          } else {
            this.toastService.error(validation?.message || 'Cupón no válido');
            this.couponLoading = false;
          }
        },
        error: (error) => {
          this.toastService.error(
            error?.error?.message || 'Cupón no válido o expirado',
          );
          this.couponLoading = false;
        } });
  }

  removeCoupon(): void {
    this.cartService
      .removeCoupon()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Cupón eliminado');
        },
        error: (error) => {
          this.toastService.error(error.message || 'Error al eliminar cupón');
        } });
  }

  getAppliedCoupon(): { coupon_id: number; coupon_code: string } | null {
    return this.cartService.getAppliedCoupon();
  }

  getCouponDiscountAmount(): number {
    const state = this.cartService.getCurrentState();
    const couponDiscount = state.appliedDiscounts.find((d) => d.coupon_id);
    return couponDiscount?.amount || 0;
  }

  formatCurrency(amount: number): string {
    return this.currencyService.format(amount);
  }

  getItemTaxRate(item: CartItem): number {
    const rate =
      item.product.tax_assignments?.reduce((rateSum, assignment) => {
        const assignmentRate =
          assignment.tax_categories?.tax_rates?.reduce(
            (sum, tr) => sum + parseFloat(tr.rate || '0'),
            0,
          ) || 0;
        return rateSum + assignmentRate;
      }, 0) || 0;
    return rate;
  }

  getItemTaxAmount(item: CartItem): number {
    return item.taxAmount;
  }

  handleImageError(event: any): void {
    // Handle broken product images
    event.target.style.display = 'none';
  }
}
