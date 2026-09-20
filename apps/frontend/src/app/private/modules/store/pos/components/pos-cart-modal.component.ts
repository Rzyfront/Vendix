import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { distinctUntilChanged, map } from 'rxjs';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { QuantityControlComponent } from '../../../../../shared/components/quantity-control/quantity-control.component';
import type { QuantityClampEvent } from '../../../../../shared/components/quantity-control/quantity-control.component';
import { showStockCapToast } from '../cart/utils/stock-toast';
import { TooltipComponent } from '../../../../../shared/components/tooltip/tooltip.component';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { ButtonComponent, BadgeComponent } from '../../../../../shared/components';
import { CartState, CartItem } from '../models/cart.model';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../../shared/components/dialog/dialog.service';
import { PosScaleService } from '../services/pos-scale.service';
import { BookingSchedulerModalComponent } from '../../../../../shared/components/booking-scheduler-modal/booking-scheduler-modal.component';
import { PosCartService } from '../services/pos-cart.service';
import { PosPreCuentaPrintService } from '../services/pos-pre-cuenta-print.service';
import { PosApiService } from '../services/pos-api.service';
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

@Component({
  selector: 'app-pos-cart-modal',
  standalone: true,
  imports: [
    IconComponent,
    QuantityControlComponent,
    TooltipComponent,
    ModalComponent,
    ButtonComponent,
    BadgeComponent,
    PriceTierSelectorComponent,
    BookingSchedulerModalComponent,
  ],
  template: `
    <!-- Overlay -->
    <div
      class="modal-overlay"
      [class.open]="isOpen()"
      (click)="onOverlayClick($event)"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pos-cart-modal-title"
      >
      <!-- Modal Content -->
      <div
        class="modal-content"
        [class.open]="isOpen()"
        (click)="$event.stopPropagation()"
        >
        <!-- Header -->
        <div class="modal-header">
          <div class="modal-header-left">
            <button
              type="button"
              class="back-btn"
              (click)="closed.emit()"
              aria-label="Cerrar carrito"
            >
              <app-icon name="chevron-left" [size]="22"></app-icon>
            </button>
            <h2 id="pos-cart-modal-title" class="modal-title">
              Carrito
              <span class="item-count">({{ cartState()?.items?.length || 0 }})</span>
            </h2>
          </div>

          <div class="header-actions">
            <!-- Vaciar carrito -->
            <button
              type="button"
              class="header-action-btn clear-btn"
              (click)="onClearCart()"
              [disabled]="!cartState()?.items?.length"
              title="Vaciar carrito"
            >
              <app-icon name="trash-2" [size]="13"></app-icon>
              <span>Vaciar</span>
            </button>

            <!-- Nota general -->
            <button
              type="button"
              class="header-action-btn note-btn"
              [class.active]="hasStaffNote()"
              (click)="orderNoteModalOpen.set(true)"
              title="Nota general del pedido"
            >
              <app-icon name="notebook-pen" [size]="13"></app-icon>
              <span>Nota</span>
            </button>

            <!-- Pre-cuenta -->
            <button
              type="button"
              class="header-action-btn print-btn"
              (click)="printPreCuenta()"
              [disabled]="!cartState()?.items?.length || preCuentaPrinting()"
              [attr.aria-busy]="preCuentaPrinting() ? 'true' : null"
              title="Imprimir pre-cuenta"
              aria-label="Imprimir pre-cuenta"
            >
              <app-icon name="printer" [size]="13"></app-icon>
            </button>
          </div>
        </div>

        <!-- Customer Section -->
        <div class="customer-section-container">
          @if (cartState()?.customer; as customer) {
            <div class="customer-card">
              <div class="customer-info-main">
                <div class="customer-avatar" aria-hidden="true">
                  {{ customerInitials(customer) }}
                </div>
                <div class="customer-details">
                  <h4 class="customer-name">{{ customerDisplayName(customer) }}</h4>
                  <div class="customer-sub" [title]="customerContactTitle(customer)">
                    @if (customer.document_type || customer.document_number) {
                      <span>{{ customer.document_type }} {{ customer.document_number }}</span>
                    }
                    @if ((customer.document_type || customer.document_number) && customer.phone) {
                      <span class="sep">·</span>
                    }
                    @if (customer.phone) {
                      <span>{{ customer.phone }}</span>
                    }
                    @if (!customer.document_number && !customer.phone && customer.email) {
                      <span>{{ customer.email }}</span>
                    }
                    @if (!customer.document_number && !customer.phone && !customer.email) {
                      <span>Cliente registrado</span>
                    }
                  </div>
                </div>
              </div>
              <div class="customer-card-actions">
                <button
                  type="button"
                  (click)="openCustomerModal.emit()"
                  class="customer-action-icon-btn"
                  title="Cambiar cliente"
                  [attr.aria-label]="'Cambiar cliente ' + customerDisplayName(customer)"
                >
                  <app-icon name="pencil" [size]="13"></app-icon>
                </button>
                <button
                  type="button"
                  (click)="clearCustomer.emit()"
                  class="customer-action-icon-btn remove"
                  title="Quitar cliente"
                  [attr.aria-label]="'Quitar cliente ' + customerDisplayName(customer)"
                >
                  <app-icon name="x" [size]="13"></app-icon>
                </button>
              </div>
            </div>
          } @else {
            <button
              type="button"
              class="customer-assign-btn"
              (click)="openCustomerModal.emit()"
            >
              <app-icon name="user-plus" [size]="15"></app-icon>
              <span>+ Asignar cliente a la venta</span>
            </button>
          }
        </div>

        <!-- Items List -->
        <div class="items-container">
          <!-- Empty State -->
          @if (!cartState()?.items?.length) {
            <div class="empty-state">
              <div class="empty-icon">
                <app-icon name="shopping-cart" [size]="40"></app-icon>
              </div>
              <p class="empty-text">Tu carrito está vacío</p>
              <p class="empty-hint">Selecciona productos para comenzar</p>
              @if (canCreateCustomItems()) {
                <button
                  type="button"
                  class="empty-custom-item-btn"
                  (click)="customItemRequested.emit()"
                >
                  <app-icon name="file-plus" [size]="16"></app-icon>
                  <span>Agregar ítem personalizado</span>
                </button>
              }
            </div>
          }
    
          <!-- Cart Items -->
          @if (cartState()?.items?.length) {
            <div class="items-list">
              @for (item of cartState()?.items; track trackByItemId($index, item)) {
                <div
                  role="listitem"
                  data-purpose="cart-item"
                  class="group p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl flex flex-col gap-1.5 hover:border-primary/40 transition-colors"
                >
                  <div class="flex items-start gap-2.5">
                    <!-- Product Image (Compact 40x40) -->
                    <div
                      class="w-10 h-10 shrink-0 bg-white rounded-lg overflow-hidden relative border border-slate-200"
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
                          class="absolute inset-0 flex items-center justify-center text-neutral-600"
                        >
                          <app-icon name="image" [size]="12"></app-icon>
                        </div>
                      }
                    </div>
                    <!-- Item Info -->
                    <div class="flex-1 min-w-0">
                      <!-- Line 1: Title + Variant badge + Actions -->
                      <div class="flex items-center justify-between gap-1">
                        <div class="flex items-center gap-1.5 min-w-0 flex-wrap">
                          <h4
                            class="text-xs font-bold text-slate-900 truncate leading-tight"
                          >
                            {{ item.product.name }}
                          </h4>
                          @if (item.variant_display_name) {
                            <span
                              class="text-[10px] font-semibold text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.2 rounded shrink-0 leading-tight"
                            >
                              {{ item.variant_display_name }}
                            </span>
                          }
                          @if (item.itemType === 'custom') {
                            <span
                              class="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded shrink-0 leading-tight"
                            >
                              Personalizado
                            </span>
                          }
                          @if (
                            item.product.product_type === 'service' ||
                            item.product.product_type === 'prepared'
                          ) {
                            <button
                              type="button"
                              class="shrink-0 w-5 h-5 rounded flex items-center justify-center text-violet-600 hover:bg-violet-50 border border-violet-200 transition-colors cursor-pointer"
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
                              <app-icon name="calendar" [size]="11"></app-icon>
                            </button>
                          }

                          <!-- Botón discreto + Nota al lado del icono de calendario / título cuando NO tiene nota -->
                          @if (!item.notes) {
                            <button
                              type="button"
                              (click)="openItemNote(item)"
                              class="inline-flex items-center gap-0.5 text-[10px] font-medium text-slate-400 hover:text-slate-700 hover:bg-white px-1.5 py-0.5 rounded border border-transparent hover:border-slate-200 transition-colors cursor-pointer shrink-0 leading-none"
                              [attr.aria-label]="'Agregar nota a ' + item.product.name"
                              title="Agregar nota"
                            >
                              <app-icon name="plus" [size]="10"></app-icon>
                              <span>Nota</span>
                            </button>
                          }
                        </div>

                        <div class="flex items-center gap-1 shrink-0">
                          @if (item.itemType === 'custom' && canEditItemPrice(item)) {
                            <button
                              type="button"
                              (click)="editItemPrice(item)"
                              class="w-6 h-6 flex items-center justify-center rounded text-primary hover:bg-primary/15 border border-primary/30 bg-primary/5 transition-colors shadow-2xs"
                              title="Editar ítem personalizado"
                              [attr.aria-label]="'Editar ítem personalizado ' + item.product.name"
                            >
                              <app-icon name="pencil" [size]="12"></app-icon>
                            </button>
                          }
                          <button
                            type="button"
                            (click)="onRemoveItem(item.id)"
                            class="w-6 h-6 flex items-center justify-center rounded-md text-rose-500 hover:text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200/70 transition-colors shadow-2xs cursor-pointer"
                            title="Eliminar producto"
                            [attr.aria-label]="'Eliminar ' + item.product.name + ' del carrito'"
                          >
                            <app-icon name="trash-2" [size]="13"></app-icon>
                          </button>
                        </div>
                      </div>

                      @if (item.description && item.itemType !== 'custom') {
                        <p
                          class="text-[10px] text-neutral-500 truncate leading-tight mt-0.5"
                        >
                          {{ item.description }}
                        </p>
                      }

                      <!-- Line 2: Base price, discount & badges (left), Note chip (if has notes) -->
                      <div class="flex items-center justify-between gap-1 mt-1 text-xs">
                        <div class="flex items-center gap-1.5 flex-wrap min-w-0">
                          <span class="text-[11px] text-[#5C6672] leading-none">
                            Base: {{ formatCurrency(item.unitPrice)
                            }}{{ unitPriceSuffix(item) }}
                            @if (getItemDiscountAmount(item) > 0) {
                              <span class="text-primary font-semibold ml-0.5"
                                >(-{{
                                  formatCurrency(getItemDiscountAmount(item))
                                }})</span
                              >
                            }
                          </span>
                          @if (item.is_weight_product && item.weight) {
                            <span
                              class="inline-flex items-center px-1 py-0.2 rounded text-[9px] font-semibold bg-blue-100 text-blue-800 leading-none"
                            >
                              {{ item.weight }} {{ item.weight_unit || 'kg' }}
                            </span>
                          }
                          @if (getItemTaxAmount(item) > 0) {
                            <span
                              class="inline-flex items-center px-1 py-0.2 rounded text-[9px] font-medium bg-orange-100 text-orange-800 leading-none"
                              [attr.aria-label]="'IVA de la línea: ' + formatCurrency(getItemTaxAmount(item))"
                            >
                              +IVA {{ formatCurrency(getItemTaxAmount(item)) }}
                            </span>
                          }
                          @if (item.isPriceOverridden) {
                            <span
                              class="inline-flex items-center px-1 py-0.2 rounded text-[9px] font-medium bg-purple-100 text-purple-800 leading-none"
                            >
                              editado
                            </span>
                          }
                          @if (item.applied_price_tier_id && item.applied_price_tier_name) {
                            <span
                              class="inline-flex items-center px-1 py-0.2 rounded text-[9px] font-semibold bg-amber-100 text-amber-800 leading-none"
                              [title]="'Tarifa aplicada: ' + item.applied_price_tier_name"
                            >
                              {{ item.applied_price_tier_name }}
                            </span>
                          }
                          @if (isPackageLine(item)) {
                            <span
                              class="inline-flex items-center px-1 py-0.2 rounded text-[9px] font-medium bg-blue-50 text-blue-700 leading-none"
                              [title]="'Empaque de ' + item.units_per_package + ' unidades'"
                            >
                              ×{{ item.units_per_package }}
                            </span>
                          }
                        </div>

                        <!-- Si SÍ tiene nota: chip con texto al lado de base / derecha -->
                        @if (item.notes) {
                          <div class="shrink-0">
                            <button
                              type="button"
                              (click)="openItemNote(item)"
                              class="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-700 bg-white border border-slate-200/90 px-1.5 py-0.5 rounded-md hover:bg-slate-50 max-w-[130px] transition-colors shadow-2xs cursor-pointer"
                              [attr.aria-label]="'Editar nota de ' + item.product.name"
                              [title]="'Nota para cocina: ' + item.notes"
                            >
                              <app-icon name="pencil" [size]="10" class="text-slate-400 shrink-0"></app-icon>
                              <span class="truncate min-w-0">{{ item.notes }}</span>
                            </button>
                          </div>
                        }
                      </div>

                      @if (canShowTierSelector(item)) {
                        <div class="mt-1">
                          <app-price-tier-selector
                            [tiers]="visibleTiersForItem(item)"
                            [selectedTierId]="item.applied_price_tier_id ?? null"
                            [unitsPerPackage]="item.units_per_package ?? null"
                            (selectedTierIdChange)="onTierChange(item, $event)"
                          ></app-price-tier-selector>
                        </div>
                      } @else {
                        @if (saleConfigHints()[item.id]; as hint) {
                          <p
                            class="mt-0.5 text-[10px] text-neutral-600 leading-tight truncate"
                            [title]="hint.detail"
                          >
                            {{ hint.headline }}
                          </p>
                        }
                      }
                    </div>
                  </div>

                  <!-- CP-POS-SVC-BOOKING-001: Booking summary badge for service line items -->
                  @if (schedulerFor(item.id) || item.booking; as b) {
                    <div class="flex items-center justify-between gap-1.5 px-2 py-1 rounded-md bg-violet-50 border border-violet-200 text-[10px] text-violet-900 mt-0.5">
                      <div class="flex items-center gap-1.5 min-w-0">
                        <app-icon name="calendar-check" [size]="12" class="text-violet-600 shrink-0"></app-icon>
                        <div class="truncate">
                          <span class="font-bold">{{ b.date }}</span>
                          <span class="mx-1 opacity-70">|</span>
                          <span>{{ b.start_time }} – {{ b.end_time }}</span>
                          @if (b.provider_name) {
                            <span class="ml-1 text-violet-700 font-semibold truncate">({{ b.provider_name }})</span>
                          }
                        </div>
                      </div>
                      <button
                        type="button"
                        (click)="openScheduler(item)"
                        class="px-1.5 py-0.2 rounded text-[9px] font-bold text-violet-700 hover:bg-violet-200/50 border border-violet-300 transition-colors shrink-0"
                      >
                        Re-agendar
                      </button>
                    </div>
                  } @else if (item.product.product_type === 'service' || item.product.requires_booking) {
                    <div class="flex items-center justify-between gap-1.5 px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-[10px] text-amber-900 mt-0.5">
                      <div class="flex items-center gap-1.5 min-w-0">
                        <app-icon name="alert-circle" [size]="12" class="text-amber-600 shrink-0"></app-icon>
                        <span class="font-medium truncate">Servicio sin horario asignado</span>
                      </div>
                      <button
                        type="button"
                        (click)="openScheduler(item)"
                        class="px-1.5 py-0.2 rounded bg-amber-200 hover:bg-amber-300 text-amber-900 text-[9px] font-bold shrink-0 transition-colors"
                      >
                        Agendar
                      </button>
                    </div>
                  }

                  <!-- Line 3: Stepper + Total Price -->
                  <div
                    class="flex items-center justify-between pt-1 border-t border-slate-200/60 mt-0.5"
                  >
                    <div class="flex items-center gap-2 min-w-0">
                      <!-- Weight products: show clickable weight badge instead of quantity control -->
                      @if (item.is_weight_product) {
                        <button
                          type="button"
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
                        <button
                          type="button"
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
                          <div class="cart-stepper-sm">
                            <app-quantity-control
                              [value]="item.quantity"
                              [min]="1"
                              [max]="getQuantityMax(item)"
                              [unitsPerPackage]="getRequiredStockPerUnit(item)"
                              [editable]="true"
                              [size]="'sm'"
                              (valueChange)="updateQuantity(item.id, $event)"
                              (valueClamped)="onQuantityClamped(item, $event)"
                            ></app-quantity-control>
                          </div>
                          @if (isPackageLine(item)) {
                            <span class="text-[10px] font-medium text-blue-700 leading-none">
                              {{ item.quantity }} {{ item.quantity === 1 ? 'paquete' : 'paquetes' }}
                            </span>
                          }
                        </div>
                      }
                    </div>
                    <div class="flex shrink-0 items-center justify-end gap-2">
                      <span
                        class="text-base font-black text-slate-900"
                        [attr.aria-label]="'Total de línea: ' + formatCurrency(item.totalPrice)"
                      >
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
                            class="cart-line-btn inline-flex items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary transition-colors hover:border-primary/40 hover:bg-primary/15"
                            [attr.aria-label]="'Editar precio de venta de ' + item.product.name"
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
    
        <!-- Summary Section (< 80px ultra-compact) -->
        @if (cartState()?.items?.length) {
          <div class="summary-section">
            <div class="summary-row">
              <span>Subtotal</span>
              <span class="font-medium">{{ formatCurrency(cartState()?.summary?.subtotal || 0) }}</span>
            </div>
            @if ((cartState()?.summary?.discountAmount || 0) > 0) {
              <div class="summary-row discount">
                <span>Descuento aplicado</span>
                <span class="discount-amount">-{{ formatCurrency(cartState()?.summary?.discountAmount || 0) }}</span>
              </div>
            }
            <div class="summary-row">
              <span>IVA / impuestos</span>
              <span class="font-medium">{{ formatCurrency(cartState()?.summary?.taxAmount || 0) }}</span>
            </div>
            @if (withholdingAmount() > 0) {
              <div class="summary-row withholding">
                <span class="flex items-center gap-1">
                  <app-icon name="minus" [size]="11" class="text-amber-600"></app-icon>
                  Retención
                </span>
                <span class="withholding-amount">-{{ formatCurrency(withholdingAmount()) }}</span>
              </div>
            }

            <div class="summary-total-block">
              <div class="summary-total-left">
                <span class="summary-total-label">
                  {{ withholdingAmount() > 0 ? 'Total a cobrar' : 'Total a pagar' }}
                </span>
                @if (!isQuotationMode() && !isLayawayMode()) {
                  @if (getAppliedCoupon(); as coupon) {
                    <button
                      type="button"
                      (click)="openCouponModal()"
                      class="coupon-trigger-btn applied"
                      title="Ver o modificar cupón aplicado"
                    >
                      <app-icon name="ticket" [size]="11"></app-icon>
                      <span class="truncate">Cupón: {{ coupon.coupon_code }}</span>
                    </button>
                  } @else {
                    <button
                      type="button"
                      (click)="openCouponModal()"
                      class="coupon-trigger-btn"
                      title="Ingresar cupón o código de promoción"
                    >
                      <span>¿Tienes código promo? Ingrésalo aquí</span>
                    </button>
                  }
                } @else {
                  <span class="mode-label">
                    {{ isQuotationMode() ? 'Cotización' : 'Plan Separé' }}
                  </span>
                }
              </div>
              <span class="summary-total-amount">
                {{ formatCurrency(netTotal()) }}
              </span>
            </div>

            <!-- Aviso 5 UVT -->
            @if (invoiceRequiredByUvt()) {
              <div class="uvt-warning">
                <app-icon name="alert-triangle" [size]="12"></app-icon>
                <span>
                  Supera {{ formatCurrency(uvtLimitCop()) }} ({{ uvtThreshold()!.uvt_limit }} UVT). Requiere factura electrónica.
                </span>
              </div>
            }
          </div>
        }
    
        <!-- Action Buttons -->
        <div class="modal-actions">
          @if (isQuotationMode()) {
            <button
              type="button"
              class="action-btn checkout-btn"
              (click)="quote.emit()"
              [disabled]="!cartState()?.items?.length"
            >
              <app-icon name="file-text" [size]="18"></app-icon>
              <span>Crear Cotización</span>
            </button>
          } @else if (isLayawayMode()) {
            <button
              type="button"
              class="action-btn checkout-btn"
              (click)="layaway.emit()"
              [disabled]="!cartState()?.items?.length"
            >
              <app-icon name="calendar" [size]="18"></app-icon>
              <span>Crear Plan Separé</span>
            </button>
          } @else {
            <div class="modal-actions-row">
              <button
                type="button"
                class="action-btn save-btn"
                (click)="saveDraft.emit()"
                [disabled]="!cartState()?.items?.length"
              >
                <app-icon name="clipboard-list" [size]="16"></app-icon>
                <span>{{ isEditMode() ? 'Actualizar' : 'Guardar' }}</span>
              </button>
              <button
                type="button"
                class="action-btn client-btn"
                (click)="openCustomerModal.emit()"
                [attr.aria-label]="
                  cartState()?.customer
                    ? 'Cliente: ' + (cartState()?.customer?.name ?? '')
                    : 'Asignar cliente'
                "
              >
                <app-icon
                  [name]="cartState()?.customer ? 'user-check' : 'user-plus'"
                  [size]="16"
                ></app-icon>
                <span class="truncate">{{ customerButtonLabel(cartState()?.customer) }}</span>
              </button>
            </div>

            <button
              type="button"
              class="action-btn checkout-btn checkout-charge"
              (click)="checkout.emit()"
              [disabled]="!cartState()?.items?.length || isCharging()"
              [attr.aria-busy]="isCharging() ? 'true' : null"
              [attr.aria-label]="'Cobrar ' + formatCurrency(netTotal())"
            >
              <app-icon name="credit-card" [size]="18"></app-icon>
              <span>Cobrar {{ formatCurrency(netTotal()) }}</span>
            </button>

            @if (readyToPayOrder() !== null && !isEditMode()) {
              <button
                type="button"
                class="action-btn checkout-btn cobrar-btn"
                (click)="charge.emit()"
                [disabled]="!cartState()?.items?.length || isCharging()"
                [attr.aria-busy]="isCharging() ? 'true' : null"
                aria-label="Cobrar la orden editada"
              >
                <app-icon name="credit-card" [size]="18"></app-icon>
                <span>Cobrar</span>
              </button>
            }
          }
        </div>

        <!-- Kitchen Item Note Modal -->
        <app-modal
          [isOpen]="itemNoteModalOpen()"
          [title]="'Nota para cocina: ' + (itemNoteTarget()?.product?.name ?? '')"
          size="sm"
          (closed)="closeItemNote()"
        >
          <div class="space-y-2">
            <textarea
              [value]="itemNoteDraft()"
              (input)="onItemNoteDraftInput($event)"
              maxlength="200"
              rows="2"
              placeholder="Notas para cocina (ej. sin cebolla, término medio). Opcional."
              class="w-full px-3 py-2 text-sm border border-border bg-surface rounded-md text-text-primary placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary resize-none"
            ></textarea>
            <div class="flex items-center justify-between">
              <span class="text-[11px] text-neutral-600">
                Opcional — se envía a cocina y a la comanda del KDS.
              </span>
              <span class="text-[11px] text-neutral-600">
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

        <!-- Order Staff Note Modal -->
        <app-modal
          [isOpen]="orderNoteModalOpen()"
          title="Nota de la orden"
          size="sm"
          (closed)="orderNoteModalOpen.set(false)"
        >
          <div class="space-y-2">
            <textarea
              [value]="cartState()?.notes || ''"
              (input)="onStaffNoteInput($event)"
              maxlength="500"
              rows="4"
              placeholder="Instrucción interna para el equipo, no se envía al cliente"
              class="w-full px-3 py-2 text-sm border border-border bg-surface rounded-md text-text-primary placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary resize-none"
            ></textarea>
            <div class="flex items-center justify-between">
              <span class="text-[11px] text-neutral-600">
                Instrucción interna para el equipo, no se envía al cliente.
              </span>
              <span class="text-[11px] text-neutral-600">
                {{ (cartState()?.notes || '').length }}/500
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

        <!-- Coupon / Promotion Modal -->
        <app-modal
          [isOpen]="isCouponModalOpen()"
          title="Cupón o código promocional"
          subtitle="Aplica un descuento a la orden actual"
          size="sm"
          [centered]="true"
          (closed)="closeCouponModal()"
        >
          <div class="space-y-4">
            @if (getAppliedCoupon(); as coupon) {
              <!-- Cupón actualmente aplicado -->
              <div class="p-3.5 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-between gap-3">
                <div class="flex items-center gap-2.5 min-w-0">
                  <div class="w-9 h-9 rounded-lg bg-primary/20 text-primary flex items-center justify-center shrink-0">
                    <app-icon name="ticket" [size]="18"></app-icon>
                  </div>
                  <div class="min-w-0">
                    <span class="block text-xs font-bold text-primary truncate uppercase tracking-wider">
                      {{ coupon.coupon_code }}
                    </span>
                    <span class="block text-xs font-semibold text-primary/80">
                      Descuento: -{{ formatCurrency(getCouponDiscountAmount()) }}
                    </span>
                  </div>
                </div>
                <app-badge variant="success" size="sm" badgeStyle="solid">Aplicado</app-badge>
              </div>

              <div class="pt-2 border-t border-border">
                <span class="block text-xs font-medium text-neutral-600 mb-1.5">
                  O ingresa otro código para reemplazarlo:
                </span>
                <div class="flex gap-2">
                  <input
                    type="text"
                    [value]="couponCode()"
                    (input)="onCouponInput($event)"
                    placeholder="Nuevo código"
                    aria-label="Nuevo código de cupón"
                    class="flex-1 px-3 py-2 text-xs font-semibold uppercase tracking-wider rounded-lg border border-border bg-surface text-text-primary focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-neutral-400 placeholder:normal-case transition-colors"
                    (keydown.enter)="applyCoupon()"
                    [disabled]="couponLoading()"
                  />
                  <app-button
                    variant="primary"
                    size="sm"
                    [disabled]="!couponCode().trim() || couponLoading()"
                    [loading]="couponLoading()"
                    (clicked)="applyCoupon()"
                  >
                    Aplicar
                  </app-button>
                </div>
              </div>
            } @else {
              <!-- Sin cupón aplicado -->
              <p class="text-xs text-neutral-600">
                Ingresa el código del cupón o promoción para aplicar el descuento correspondiente sobre la orden actual.
              </p>
              <div>
                <label class="block text-xs font-medium text-neutral-700 mb-1.5">
                  Código del cupón
                </label>
                <input
                  type="text"
                  [value]="couponCode()"
                  (input)="onCouponInput($event)"
                  placeholder="Ej: PROMO10"
                  aria-label="Código de cupón o promoción"
                  class="w-full px-3 py-2.5 text-sm font-semibold uppercase tracking-wider rounded-xl border border-border bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder:text-neutral-400 placeholder:normal-case transition-all"
                  (keydown.enter)="applyCoupon()"
                  [disabled]="couponLoading()"
                />
              </div>
            }
          </div>

          <div
            slot="footer"
            class="flex items-center justify-between w-full"
          >
            @if (getAppliedCoupon()) {
              <app-button
                variant="outline-danger"
                size="md"
                [disabled]="couponLoading()"
                (clicked)="removeCoupon()"
              >
                <app-icon name="trash-2" [size]="14" class="mr-1.5"></app-icon>
                Eliminar Cupón
              </app-button>
            } @else {
              <div></div>
            }
            <div class="flex items-center gap-2">
              <app-button
                variant="outline"
                size="md"
                [disabled]="couponLoading()"
                (clicked)="closeCouponModal()"
              >
                {{ getAppliedCoupon() ? 'Cerrar' : 'Cancelar' }}
              </app-button>
              @if (!getAppliedCoupon()) {
                <app-button
                  variant="primary"
                  size="md"
                  [disabled]="!couponCode().trim() || couponLoading()"
                  [loading]="couponLoading()"
                  (clicked)="applyCoupon()"
                >
                  {{ couponLoading() ? 'Aplicando...' : 'Aplicar Cupón' }}
                </app-button>
              }
            </div>
          </div>
        </app-modal>
      </div>
    </div>

    @if (schedulerOpen()) {
      <app-booking-scheduler-modal
        [cartItem]="schedulerTarget()"
        [existingBooking]="schedulerExisting()"
        [posCustomer]="cartState()?.customer"
        (customerSelected)="onCustomerSelected($event)"
        (scheduled)="onScheduled($event)"
        (cancelled)="closeScheduler()"
      ></app-booking-scheduler-modal>
    }
    `,
  styles: [
    `
      :host {
        display: contents;
      }

      /* Stitch paso 3 — foco visible por teclado en todo control nativo
         del modal (mismo lenguaje del paso 2: 3px primary). */
      .back-btn:focus-visible,
      .clear-btn:focus-visible,
      .note-btn:focus-visible,
      .print-btn:focus-visible,
      .remove-btn:focus-visible,
      .edit-price-btn:focus-visible,
      .cart-line-btn:focus-visible,
      .action-btn:focus-visible,
      .empty-custom-item-btn:focus-visible,
      .dashed-custom-item-btn:focus-visible,
      .customer-assign-btn:focus-visible,
      .customer-action-icon-btn:focus-visible,
      .coupon-trigger-btn:focus-visible {
        outline: 3px solid var(--color-primary);
        outline-offset: 2px;
      }

      :host ::ng-deep .cart-stepper-sm app-quantity-control .qc-wrapper > div {
        background-color: #fff;
        border-color: var(--color-border);
      }

      .cart-line-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
      }

      .modal-overlay {
        position: fixed;
        inset: 0;
        z-index: 50;
        background: rgba(0, 0, 0, 0);
        pointer-events: none;
        transition: background 0.3s ease;
      }

      .modal-overlay.open {
        background: rgba(0, 0, 0, 0.5);
        pointer-events: auto;
      }

      .modal-content {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        max-height: 90vh;
        background: var(--color-surface);
        border-radius: 20px 20px 0 0;
        transform: translateY(100%);
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .modal-content.open {
        transform: translateY(0);
      }

      /* Header */
      .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
        gap: 8px;
      }

      .modal-header-left {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }

      .back-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border: none;
        background: transparent;
        color: var(--color-primary);
        cursor: pointer;
        border-radius: 8px;
        transition: background 0.2s ease;
      }

      .back-btn:hover {
        background: rgba(var(--color-primary-rgb), 0.08);
      }

      .modal-title {
        font-size: 16px;
        font-weight: 700;
        color: var(--color-text-primary);
        margin: 0;
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      }

      .item-count {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-primary);
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }

      .header-action-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 0 10px;
        height: 32px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        border: 1px solid transparent;
      }

      .header-action-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .clear-btn {
        background: rgba(239, 68, 68, 0.08);
        border-color: rgba(239, 68, 68, 0.2);
        color: rgb(220, 38, 38);
      }

      .clear-btn:hover:not(:disabled) {
        background: rgba(239, 68, 68, 0.16);
      }

      .note-btn {
        background: var(--color-muted);
        border-color: var(--color-border);
        color: var(--color-text-secondary);
      }

      .note-btn.active {
        background: rgba(var(--color-primary-rgb), 0.1);
        border-color: rgba(var(--color-primary-rgb), 0.25);
        color: var(--color-primary);
      }

      .note-btn:hover:not(:disabled) {
        filter: brightness(0.96);
      }

      .print-btn {
        background: rgba(var(--color-primary-rgb), 0.08);
        border-color: rgba(var(--color-primary-rgb), 0.2);
        color: var(--color-primary);
        padding: 0 8px;
      }

      .print-btn:hover:not(:disabled) {
        background: rgba(var(--color-primary-rgb), 0.16);
      }

      /* Customer Section */
      .customer-section-container {
        padding: 10px 16px;
        background: var(--color-surface);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
      }

      .customer-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 12px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
      }

      .customer-info-main {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        flex: 1;
      }

      .customer-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: rgba(var(--color-primary-rgb), 0.12);
        border: 1px solid rgba(var(--color-primary-rgb), 0.25);
        color: var(--color-primary);
        font-size: 11px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .customer-details {
        min-width: 0;
        line-height: 1.25;
      }

      .customer-name {
        font-size: 12px;
        font-weight: 700;
        color: #1e293b;
        margin: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .customer-sub {
        font-size: 11px;
        font-weight: 500;
        color: #64748b;
        display: flex;
        align-items: center;
        gap: 4px;
        margin-top: 1px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .customer-sub .sep {
        color: #cbd5e1;
      }

      .customer-card-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }

      .customer-action-icon-btn {
        width: 28px;
        height: 28px;
        border: none;
        background: transparent;
        color: #64748b;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .customer-action-icon-btn:hover {
        background: #ffffff;
        color: var(--color-primary);
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      }

      .customer-action-icon-btn.remove:hover {
        background: rgba(239, 68, 68, 0.1);
        color: rgb(220, 38, 38);
      }

      .customer-assign-btn {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 9px 12px;
        border: 1.5px dashed rgba(var(--color-primary-rgb), 0.35);
        border-radius: 12px;
        background: rgba(var(--color-primary-rgb), 0.04);
        color: var(--color-primary);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .customer-assign-btn:hover {
        background: rgba(var(--color-primary-rgb), 0.08);
        border-color: var(--color-primary);
      }

      /* Items Container */
      .items-container {
        flex: 1;
        overflow-y: auto;
        padding: 16px 20px;
        -webkit-overflow-scrolling: touch;
      }

      /* Empty State */
      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px 20px;
        text-align: center;
      }

      .empty-icon {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        background: var(--color-muted);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-neutral-600);
        margin-bottom: 16px;
      }

      .empty-text {
        font-size: 16px;
        font-weight: 600;
        color: var(--color-text-primary);
        margin: 0 0 4px 0;
      }

      .empty-hint {
        font-size: 14px;
        color: var(--color-neutral-600);
        margin: 0;
      }

      .empty-custom-item-btn {
        margin-top: 18px;
        min-height: 44px;
        padding: 0 16px;
        border: 1px solid rgba(var(--color-primary-rgb), 0.28);
        border-radius: 12px;
        background: rgba(var(--color-primary-rgb), 0.08);
        color: var(--color-primary);
        font-size: 14px;
        font-weight: 700;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }

      /* Items List */
      .items-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .cart-item {
        display: grid;
        grid-template-columns: 56px 1fr auto;
        grid-template-rows: auto auto;
        gap: 6px 10px;
        padding: 12px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: 14px;
        transition: border-color 0.2s ease, background-color 0.2s ease;
      }

      .cart-item:hover {
        background-color: var(--color-surface-hover, #f1f5f9);
        border-color: var(--color-primary);
      }

      .item-image {
        grid-row: 1;
        grid-column: 1;
        width: 56px;
        height: 56px;
        border-radius: 10px;
        overflow: hidden;
        background: var(--color-muted);
      }

      .item-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .image-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-neutral-600);
      }

      .item-info {
        grid-row: 1;
        grid-column: 2;
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }

      .item-name {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
        margin: 0;
        line-height: 1.3;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      /* QUI-787 · fila del nombre con el botón "Notas" a la derecha. */
      .item-name-row {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }

      .item-name-row .item-name {
        flex: 1 1 auto;
        min-width: 0;
      }

      /* QUI-787 · chip amarillo de nota activa (paridad con mesa). */
      .item-note-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        margin: 2px 0 0;
        padding: 0.1rem 0.35rem;
        border-radius: 4px;
        background-color: var(--color-warning-100, #fef3c7);
        color: var(--color-warning-700, #b45309);
        font-size: 11px;
        font-weight: 500;
        width: fit-content;
        max-width: 100%;
      }

      .item-meta {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 2px;
      }

      .item-description {
        margin: 2px 0 0;
        color: var(--color-neutral-600);
        font-size: 11px;
        line-height: 1.25;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .item-sku {
        font-size: 11px;
        color: var(--color-neutral-600);
        font-family: monospace;
      }

      /* QUI-648: por qué la línea no ofrece presentaciones. */
      .item-sale-config {
        margin: 4px 0 0;
        font-size: 10px;
        line-height: 1.25;
        color: var(--color-neutral-600);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .item-unit-price {
        font-size: 12px;
        color: var(--color-neutral-600);
      }

      .item-tax-badge,
      .item-price-badge,
      .item-tier-badge,
      .item-package-badge {
        display: inline-flex;
        align-items: center;
        padding: 1px 6px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 700;
        white-space: nowrap;
      }

      .item-tax-badge {
        background: rgba(249, 115, 22, 0.12);
        color: rgb(194, 65, 12);
      }

      .item-price-badge {
        background: rgba(147, 51, 234, 0.12);
        color: rgb(126, 34, 206);
      }

      .item-tier-badge {
        background: rgba(var(--color-primary-rgb), 0.12);
        color: var(--color-primary);
      }

      .item-package-badge {
        background: rgba(var(--color-primary-rgb), 0.1);
        color: var(--color-primary);
        font-weight: 600;
      }

      .item-tier-selector {
        margin-top: 6px;
      }

      .item-weight-badge {
        display: inline-flex;
        align-items: center;
        padding: 1px 6px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        background: rgba(var(--color-primary-rgb), 0.1);
        color: var(--color-primary);
      }

      .weight-badge-mobile {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        border-radius: 8px;
        background: rgba(var(--color-primary-rgb), 0.08);
        border: 1px solid rgba(var(--color-primary-rgb), 0.2);
      }

      .qty-with-packages {
        display: inline-flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .package-count-label {
        font-size: 10px;
        font-weight: 500;
        line-height: 1;
        color: var(--color-primary);
      }

      .weight-value {
        font-size: 13px;
        font-weight: 700;
        color: var(--color-primary);
      }

      .remove-btn {
        grid-row: 1;
        grid-column: 3;
        min-width: 44px;
        min-height: 44px;
        border: none;
        background: transparent;
        color: var(--color-neutral-600);
        cursor: pointer;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
      }

      .remove-btn:hover {
        background: rgba(239, 68, 68, 0.1);
        color: var(--color-destructive);
      }

      .item-actions {
        grid-row: 2;
        grid-column: 1 / -1;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-top: 8px;
        border-top: 1px solid var(--color-border);
        margin-top: 4px;
      }

      .item-total {
        font-size: 15px;
        font-weight: 700;
        color: var(--color-primary);
        line-height: 1;
      }

      .item-price-action {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        min-width: 0;
      }

      .edit-price-btn {
        min-width: 44px;
        min-height: 44px;
        border: 1px solid rgba(var(--color-primary-rgb), 0.24);
        border-radius: 10px;
        background: rgba(var(--color-primary-rgb), 0.08);
        color: var(--color-primary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition:
          background 0.2s ease,
          border-color 0.2s ease,
          transform 0.2s ease;
      }

      .edit-price-btn:hover {
        background: rgba(var(--color-primary-rgb), 0.14);
        border-color: rgba(var(--color-primary-rgb), 0.36);
      }

      .edit-price-btn:active {
        transform: scale(0.96);
      }

      .dashed-custom-item-btn {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 10px 14px;
        border: 1.5px dashed rgba(var(--color-primary-rgb), 0.35);
        border-radius: 12px;
        background: rgba(var(--color-primary-rgb), 0.04);
        color: var(--color-primary);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        margin-top: 8px;
        transition: all 0.2s ease;
      }

      .dashed-custom-item-btn:hover {
        border-color: var(--color-primary);
        color: var(--color-primary);
        background: rgba(var(--color-primary-rgb), 0.08);
      }

      /* Summary Section (< 80px ultra-compact) */
      .summary-section {
        padding: 10px 16px;
        border-top: 1px solid var(--color-border);
        background: #f8fafc;
        flex-shrink: 0;
      }

      .summary-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
        color: #64748b;
        padding: 2px 0;
      }

      .summary-row.discount {
        color: #e11d48;
      }

      .discount-amount {
        font-weight: 700;
        color: #e11d48;
      }

      .summary-row.withholding {
        color: #b45309;
      }

      .withholding-amount {
        font-weight: 600;
        color: #b45309;
      }

      .summary-total-block {
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px solid #e2e8f0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .summary-total-left {
        min-width: 0;
        display: flex;
        flex-direction: column;
      }

      .summary-total-label {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #475569;
        line-height: 1.2;
      }

      .coupon-trigger-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 600;
        color: var(--color-primary);
        background: transparent;
        border: none;
        padding: 0;
        margin-top: 2px;
        cursor: pointer;
        text-decoration: underline;
        text-align: left;
      }

      .coupon-trigger-btn:hover {
        filter: brightness(0.9);
      }

      .summary-total-amount {
        font-size: 22px;
        font-weight: 900;
        color: var(--color-primary);
        letter-spacing: -0.02em;
        line-height: 1;
        flex-shrink: 0;
      }

      .mode-label {
        font-size: 11px;
        font-weight: 500;
        color: #64748b;
        margin-top: 2px;
      }

      .uvt-warning {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin-top: 6px;
        padding: 5px 8px;
        border: 1px solid var(--color-warning);
        border-radius: 6px;
        background: var(--color-warning-light);
        font-size: 11px;
        line-height: 1.35;
        color: var(--color-text-primary);
      }

      .uvt-warning app-icon {
        color: var(--color-warning);
        flex-shrink: 0;
        margin-top: 2px;
      }

      /* Action Buttons */
      .modal-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px 16px;
        padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
        border-top: 1px solid var(--color-border);
        background: var(--color-surface);
        flex-shrink: 0;
      }

      .modal-actions-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .action-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 44px;
        border: none;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        width: 100%;
      }

      .action-btn:active:not(:disabled) {
        transform: scale(0.98);
      }

      .action-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .client-btn {
        background: rgba(var(--color-primary-rgb), 0.08);
        border: 1px solid rgba(var(--color-primary-rgb), 0.25);
        color: var(--color-primary);
        font-size: 13px;
        font-weight: 600;
        padding: 0 10px;
      }

      .client-btn:hover:not(:disabled) {
        background: rgba(var(--color-primary-rgb), 0.15);
        border-color: var(--color-primary);
      }

      .save-btn {
        background: #f8fafc;
        border: 1px solid #cbd5e1;
        color: #334155;
        font-size: 13px;
        font-weight: 600;
        padding: 0 10px;
      }

      .save-btn:hover:not(:disabled) {
        background: rgba(var(--color-primary-rgb), 0.06);
        border-color: var(--color-primary);
        color: var(--color-primary);
      }

      .checkout-btn {
        background: var(--color-primary);
        color: var(--color-text-on-primary, #ffffff);
        font-weight: 700;
        box-shadow: 0 4px 14px rgba(var(--color-primary-rgb), 0.35);
      }

      .checkout-charge {
        font-size: 15px;
        font-weight: 800;
      }

      .checkout-btn:hover:not(:disabled) {
        filter: brightness(1.08);
      }

      .cobrar-btn {
        background: var(--color-primary);
        box-shadow: 0 4px 14px rgba(var(--color-primary-rgb), 0.35);
      }

      .cobrar-btn:focus-visible {
        outline: 3px solid var(--color-primary);
        outline-offset: 2px;
      }

      /* Hide on desktop */
      @media (min-width: 1024px) {
        .modal-overlay {
          display: none;
        }
      }
    `,
  ],
})
export class PosCartModalComponent {
  private currencyService = inject(CurrencyFormatService);
  private readonly authFacade = inject(AuthFacade);
  private readonly priceTierCache = inject(PriceTierCacheService);
  private readonly cartService = inject(PosCartService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly saleUnitService = inject(PosSaleUnitService);
  private readonly preCuentaPrint = inject(PosPreCuentaPrintService);
  private readonly posApiService = inject(PosApiService);
  private readonly dialogService = inject(DialogService);
  private readonly scaleService = inject(PosScaleService);

  readonly isOpen = input<boolean>(false);
  readonly cartState = input<CartState | null>(null);
  readonly canCreateCustomItems = input<boolean>(false);
  readonly canOverridePrices = input<boolean>(false);
  readonly isEditMode = input<boolean>(false);
  readonly isQuotationMode = input<boolean>(false);
  readonly isLayawayMode = input<boolean>(false);
  readonly readyToPayOrder = input<unknown>(null);
  readonly isCharging = input<boolean>(false);

  /**
   * Techo de 5 UVT (Art. 616-1 ET / Res. 000165 de 2023) — se REUSAN los
   * signals de `PosCartService`, que ya son la fuente de verdad del carrito de
   * escritorio (`pos-cart.component.ts`). Nada se recalcula acá: un segundo
   * cálculo del mismo umbral discrepa a la primera corrección, y discrepar en
   * esto significa que una de las dos pantallas deja pasar una venta que el
   * backend va a rechazar.
   */
  readonly uvtThreshold = this.cartService.uvtThreshold;
  readonly invoiceRequiredByUvt = this.cartService.invoiceRequiredByUvt;
  readonly uvtLimitCop = computed(
    () => this.cartService.uvtThreshold()?.limit_cop ?? 0,
  );

  /**
   * Retención (preview) y total neto a cobrar.
   */
  readonly withholdingAmount = computed(
    () => Number(this.cartState()?.summary?.withholdingAmount ?? 0) || 0,
  );
  readonly netTotal = computed(() => {
    const total = Number(this.cartState()?.summary?.total ?? 0) || 0;
    return Math.max(0, total - this.withholdingAmount());
  });

  readonly closed = output<void>();
  readonly customItemRequested = output<void>();
  readonly itemPriceEditRequested = output<CartItem>();
  readonly itemQuantityChanged = output<{ itemId: string; quantity: number }>();
  readonly itemRemoved = output<string>();
  readonly clearCart = output<void>();
  readonly openCustomerModal = output<void>();
  readonly clearCustomer = output<void>();
  readonly quote = output<void>();
  readonly layaway = output<void>();
  readonly customerSelected = output<any>();
  readonly bookingsChanged = output<Map<string, any>>();

  // CP-POS-SVC-BOOKING-001 — Service scheduler state.
  readonly schedulerOpen = signal(false);
  readonly schedulerTarget = signal<any>(null);
  readonly schedulerExisting = signal<any>(null);
  readonly cartBookingsByItemId = signal<Map<string, any>>(new Map());

  // ─── QUI-787 · editor de nota por línea (paridad con desktop) ─────────
  readonly itemNoteModalOpen = signal(false);
  readonly itemNoteTarget = signal<CartItem | null>(null);
  readonly itemNoteDraft = signal<string>('');

  // ─── Nota general de la orden (staff note) ───────────────────────────
  readonly orderNoteModalOpen = signal(false);

  // ─── Modal de cupón / código promocional ──────────────────────────────
  readonly isCouponModalOpen = signal(false);
  readonly couponCode = signal('');
  readonly couponLoading = signal(false);

  // ─── Pre-cuenta impresión ─────────────────────────────────────────────
  readonly preCuentaPrinting = signal(false);

  readonly create = output<void>();
  /**
   * CP-POS-CREAR-EDITAR-COBRAR-001 — direct save-draft (skip the
   * checkout shell stepper). The Guardar button persists the order with
   * is_draft=true, requires_payment=false and NEVER opens the payment
   * step. The Cobrar button uses the full shell wizard.
   */
  readonly saveDraft = output<void>();
  readonly checkout = output<void>();
  readonly charge = output<void>();

  readonly availableTiers = signal<PriceTier[]>([]);
  readonly productOverrides = signal<Record<number, ProductPriceTierOverride[]>>({});
  readonly canApplyPricingTier = computed(() =>
    this.authFacade.userPermissions().includes('store:products:apply_pricing_tier'),
  );

  constructor() {
    void this.currencyService.loadCurrency();

    effect(() => {
      if (this.isOpen()) {
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = '';
      }
    });

    // Load active tiers once (cache shareReplay'd with desktop cart).
    if (this.canApplyPricingTier()) {
      this.priceTierCache
        .getActiveTiers()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (tiers) => this.availableTiers.set(tiers || []),
          error: () => this.availableTiers.set([]),
        });
    }

    // Pre-fetch overrides per multi-tier product in cart.
    toObservable(this.cartState)
      .pipe(
        map((state) =>
          (state?.items ?? [])
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
              next: (overrides) =>
                this.productOverrides.update((curr) => ({
                  ...curr,
                  [productId]: overrides ?? [],
                })),
              error: () => {},
            });
        }
      });
  }

  canShowTierSelector(item: CartItem): boolean {
    return (
      item.itemType !== 'custom' &&
      // QUI-648: una línea pesada no ofrece presentación — ver la nota gemela
      // en `pos-cart.component.ts`.
      item.captured_by_scale !== true &&
      !item.is_weight_product &&
      item.product.has_multiple_price_tiers === true &&
      this.canApplyPricingTier() &&
      this.visibleTiersForItem(item).length > 0
    );
  }

  /** QUI-648 — sufijo de la escala de precio: "/m", "/kg", "/paquete". */
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
   * QUI-648 — por qué esta línea no ofrece presentaciones, con la misma frase
   * del editor de producto. Computed para no rearmarla en cada ciclo de CD.
   */
  readonly saleConfigHints = computed<
    Record<string, { headline: string; detail: string }>
  >(() => {
    const hints: Record<string, { headline: string; detail: string }> = {};
    for (const item of this.cartState()?.items ?? []) {
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

  visibleTiersForItem(item: CartItem): PriceTier[] {
    if (item.itemType === 'custom') return [];
    const enabledIds = item.product.enabled_price_tier_ids ?? [];
    if (!Array.isArray(enabledIds) || enabledIds.length === 0) return [];
    const enabled = new Set(enabledIds.map(Number));
    return this.availableTiers().filter((tier) => enabled.has(tier.id));
  }

  private getOverridesForItem(
    item: CartItem,
    tierId: number | null,
  ): ProductPriceTierOverride[] {
    if (item.itemType === 'custom') return [];
    const productId = Number(item.product.id);
    if (!Number.isFinite(productId) || productId <= 0) return [];
    const all = this.productOverrides()[productId] ?? [];
    if (tierId == null) return all;
    return all.filter((o) => o.price_tier_id === tierId);
  }

  onTierChange(item: CartItem, tierId: number | null): void {
    if (!this.canApplyPricingTier()) {
      this.toastService.warning('No tienes permiso para aplicar tarifas de precio');
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
          this.toastService.error(
            typeof error === 'string' ? error : 'Error al aplicar tarifa',
          ),
      });
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

  onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closed.emit();
    }
  }

  onQuantityChange(itemId: string, quantity: number): void {
    this.itemQuantityChanged.emit({ itemId, quantity });
  }

  /**
   * Manejador del evento `valueClamped` del `quantity-control`.
   * Se dispara cuando el usuario teclea una cantidad fuera del rango
   * permitido. Solo el cap superior (max) nos interesa aquí — el cap
   * inferior ya está manejado por el handler de `valueChange` en el
   * parent que llama a `updateQuantity`.
   */
  onQuantityClamped(item: CartItem, event: QuantityClampEvent): void {
    if (event.reason !== 'max') return;
    showStockCapToast(this.toastService, item, event.limit);
  }

  onRemoveItem(itemId: string): void {
    this.itemRemoved.emit(itemId);
  }

  onClearCart(): void {
    this.clearCart.emit();
  }

  trackByItemId(_index: number, item: CartItem): string {
    return item.id;
  }

  canEditItemPrice(item: CartItem): boolean {
    return item.itemType === 'custom'
      ? this.canCreateCustomItems()
      : item.product.allow_pos_price_override === true && this.canOverridePrices();
  }

  handleImageError(event: Event): void {
    const target = event.target as HTMLImageElement;
    target.style.display = 'none';
  }

  formatCurrency(amount: number): string {
    return this.currencyService.format(amount);
  }

  getItemDiscountAmount(item: CartItem): number {
    const original = Number(item.originalFinalPrice ?? item.finalPrice) || 0;
    const current = Number(item.finalPrice) || 0;
    const perUnit = original - current;
    if (perUnit <= 0) return 0;
    const multiplier =
      current > 0 && Number.isFinite(item.totalPrice / current)
        ? item.totalPrice / current
        : item.quantity;
    return Math.max(0, Math.round(perUnit * multiplier * 100) / 100);
  }

  getItemTaxAmount(item: CartItem): number {
    return item.taxAmount;
  }

  updateQuantity(itemId: string, quantity: number): void {
    if (quantity <= 0) {
      this.onRemoveItem(itemId);
      return;
    }
    this.onQuantityChange(itemId, quantity);
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
        next: () => {
          this.toastService.success('Precio actualizado');
          this.itemPriceEditRequested.emit(item);
        },
        error: (error) =>
          this.toastService.error(error.message || 'Error al actualizar precio'),
      });
  }

  async editWeight(item: CartItem): Promise<void> {
    const unit = item.weight_unit || 'kg';
    let newWeight: number;

    if (this.scaleService.isConnected()) {
      const scaleWeight = await this.scaleService.showWeightModal({
        title: 'Editar Peso',
        message: `${item.product.name}\nPrecio: ${this.formatCurrency(item.unitPrice)}/${unit}`,
        weightUnit: unit,
        allowManualFallback: true,
      });
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
          inputType: 'number',
        },
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
        },
      });
  }

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

  schedulerFor(itemId: string): any {
    const fromMap = this.cartBookingsByItemId().get(itemId);
    if (fromMap) return fromMap;
    const item = this.cartState()?.items?.find((i) => i.id === itemId);
    return item?.booking ?? null;
  }

  // ─── QUI-787 · handlers del editor de nota por línea ──────────────

  openItemNote(item: CartItem): void {
    this.itemNoteTarget.set(item);
    this.itemNoteDraft.set(item.notes ?? '');
    this.itemNoteModalOpen.set(true);
  }

  closeItemNote(): void {
    const target = this.itemNoteTarget();
    const draft = this.itemNoteDraft().trim();
    if (!target) {
      this.itemNoteModalOpen.set(false);
      return;
    }
    const next = draft.length > 0 ? draft : undefined;
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
          this.toastService.error(
            typeof err === 'string' ? err : err?.message || 'Error al guardar la nota',
          ),
      });
  }

  clearItemNote(): void {
    this.itemNoteDraft.set('');
  }

  /**
   * Handler nativo del `<textarea>` del editor. Lee `.value` del DOM (no
   * usamos `[ngModel]` para no importar FormsModule — ver nota en el modal).
   */
  onItemNoteDraftInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.itemNoteDraft.set(target.value);
  }

  // ─── Staff Note ───────────────────────────────────────────────────────

  hasStaffNote(): boolean {
    const notes = this.cartState()?.notes;
    return !!(notes && notes.trim().length > 0);
  }

  onStaffNoteInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.cartService.updateNotes(target.value);
  }

  // ─── Pre-cuenta ───────────────────────────────────────────────────────

  async printPreCuenta(): Promise<void> {
    const currentState = this.cartService.getCurrentState();
    if (currentState.items.length === 0) {
      this.toastService.warning('Tu carrito está vacío');
      return;
    }
    if (this.preCuentaPrinting()) return;
    this.preCuentaPrinting.set(true);
    try {
      await this.preCuentaPrint.printPreCuenta(currentState);
    } catch (error) {
      console.error('Error al imprimir pre-cuenta:', error);
      this.toastService.error('No se pudo imprimir la pre-cuenta');
    } finally {
      this.preCuentaPrinting.set(false);
    }
  }

  // ─── Customer Helpers ─────────────────────────────────────────────────

  customerDisplayName(customer: any): string {
    if (!customer) return '';
    const full = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim();
    return (
      customer.name?.trim() ||
      full ||
      customer.legal_name?.trim() ||
      customer.business_name?.trim() ||
      customer.email?.trim() ||
      'Cliente'
    );
  }

  customerInitials(customer: any): string {
    if (!customer) return 'CL';
    const source = this.customerDisplayName(customer);
    const initials = source
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((word: string) => word[0])
      .join('')
      .toUpperCase();
    return initials || 'CL';
  }

  customerContactTitle(customer: any): string {
    if (!customer) return '';
    const doc = [customer?.document_type, customer?.document_number]
      .filter(Boolean)
      .join(' ');
    const parts = [doc, customer?.phone, customer?.email].filter(Boolean);
    return parts.join(' · ') || this.customerDisplayName(customer);
  }

  customerButtonLabel(customer: any): string {
    if (!customer) return '+ Cliente';
    const name = this.customerDisplayName(customer);
    const first = customer.first_name || name.split(' ')[0];
    return first || '+ Cliente';
  }

  // ─── Coupon / Promo Code Modal ────────────────────────────────────────

  openCouponModal(): void {
    this.couponCode.set('');
    this.isCouponModalOpen.set(true);
  }

  closeCouponModal(): void {
    this.isCouponModalOpen.set(false);
  }

  onCouponInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.couponCode.set(target.value);
  }

  applyCoupon(): void {
    const code = this.couponCode().trim().toUpperCase();
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

    this.couponLoading.set(true);
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
                  this.couponCode.set('');
                  this.couponLoading.set(false);
                  this.closeCouponModal();
                },
                error: (error) => {
                  this.toastService.error(
                    error.message || 'Error al aplicar cupón',
                  );
                  this.couponLoading.set(false);
                },
              });
          } else {
            this.toastService.error(validation?.message || 'Cupón no válido');
            this.couponLoading.set(false);
          }
        },
        error: (error) => {
          this.toastService.error(
            error?.error?.message || 'Cupón no válido o expirado',
          );
          this.couponLoading.set(false);
        },
      });
  }

  removeCoupon(): void {
    this.cartService
      .removeCoupon()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Cupón eliminado');
          this.closeCouponModal();
        },
        error: (error) => {
          this.toastService.error(error.message || 'Error al eliminar cupón');
        },
      });
  }

  getAppliedCoupon(): { coupon_id: number; coupon_code: string } | null {
    return this.cartService.getAppliedCoupon();
  }

  getCouponDiscountAmount(): number {
    const state = this.cartService.getCurrentState();
    const couponDiscount = state.appliedDiscounts?.find((d) => d.coupon_id);
    return couponDiscount?.amount || 0;
  }
}
