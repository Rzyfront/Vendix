import {
  Component,
  ChangeDetectionStrategy,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
  inject,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import {
  ButtonComponent,
  ModalComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  ToastService,
} from '../../../../../shared/components';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { PosRestaurantIntegrationService } from '../services/pos-restaurant-integration.service';
import { PosCartService, CartState, CartItem } from '../services/pos-cart.service';
import { PosPaymentService } from '../services/pos-payment.service';
import { PosCustomer, PosCustomerService } from '../services/pos-customer.service';
import {
  PosFulfillmentSelectorComponent,
  FulfillmentType,
} from './pos-fulfillment-selector.component';
import { PosOpenTableModalComponent } from './pos-open-table-modal.component';

export interface PosOrderCreateResult {
  order: any;
  fulfillment: FulfillmentType | null;
  tableId: number | null;
  firedToKitchen: boolean;
}

/**
 * Modal-resumen "Crear" (formerly "Guardar").
 *
 * Replaces the noisy `saveDraft` action on the cart / mobile footer with a
 * confirmation modal that:
 *  - Mirrors the order summary (subtotal, taxes, total, item count).
 *  - For restaurant stores with at least one `prepared` line item, shows
 *    the `PosFulfillmentSelector` so the operator picks Consumo / Entrega.
 *  - For `consumo` without an open table, blocks the action and surfaces
 *    a CTA to open a table via the existing `PosOpenTableModalComponent`.
 *  - On confirm, creates a draft order and, when relevant, fires the KDS
 *    through `PosRestaurantIntegrationService.maybeFireKitchen` (idempotent
 *    via the backend `inventory_consumed_at_fire` flag).
 *
 * Retail stores (no `restaurant` industry, or no `prepared` items) skip
 * the selector entirely and just persist a draft order.
 */
@Component({
  selector: 'app-pos-order-create-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    ModalComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    PosFulfillmentSelectorComponent,
    PosOpenTableModalComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onModalChange($event)"
      (cancel)="onCancel()"
      [size]="'xl'"
      [showCloseButton]="true"
      title="Crear orden"
      subtitle="Confirma los datos antes de generar el borrador"
    >
      <div
        slot="header"
        class="w-10 h-10 rounded-[var(--radius-lg)] bg-primary/10 flex items-center justify-center flex-shrink-0"
      >
        <app-icon
          name="clipboard-list"
          [size]="20"
          class="text-primary"
        ></app-icon>
      </div>

      <div
        class="create-content"
        [class.create-content--two-col]="!showFulfillmentSelector()"
      >
        <!-- Columna 1 — Resumen -->
        <section class="create-section">
          <div class="section-header">
            <div class="section-indicator"></div>
            <h2 class="section-title">Resumen</h2>
          </div>

          <div class="product-list">
            @for (item of cartState().items; track item) {
              <div class="product-item">
                <div class="product-info">
                  <span class="product-name">{{ item.product.name }}@if (item.variant_display_name) {
                    <span style="font-size: 0.85em; opacity: 0.7;"> - {{ item.variant_display_name }}</span>
                  }</span>
                  @if (item.is_weight_product) {
                    <span class="product-qty">
                      {{ item.weight }} {{ item.weight_unit || 'kg' }}
                    </span>
                  } @else {
                    <span class="product-qty">x{{ item.quantity }}</span>
                  }
                </div>
                <span class="product-line-total">{{ formatCurrency(item.totalPrice) }}</span>
              </div>
            }
            @if (!cartState().items.length) {
              <div class="empty-cart">Sin productos</div>
            }
          </div>

          <div class="summary-details">
            <div class="summary-row">
              <span>Ítems</span>
              <span class="summary-value">{{ itemCount() }}</span>
            </div>
            <div class="summary-row">
              <span>Subtotal</span>
              <span class="summary-value">{{ formatCurrency(subtotal()) }}</span>
            </div>
            <div class="summary-row">
              <span>Impuestos</span>
              <span class="summary-value">{{ formatCurrency(taxAmount()) }}</span>
            </div>
          </div>

          <div class="total-section">
            <p class="total-label">Total</p>
            <p class="total-amount">{{ formatCurrency(total()) }}</p>
          </div>
        </section>

        <!-- Columna 2 — Servicio + Mesa.
             Se oculta por completo cuando la orden no tiene platos/servicios
             consumibles (showFulfillmentSelector()=false); en ese caso el
             grid colapsa a 2 columnas (Resumen | Cliente). -->
        @if (showFulfillmentSelector()) {
          <section class="create-section">
            <div class="section-header">
              <div class="section-indicator"></div>
              <h2 class="section-title">Servicio</h2>
            </div>

            <app-pos-fulfillment-selector
              [value]="fulfillment()"
              [consumoBlocked]="isConsumoBlocked()"
              (selectionChange)="fulfillment.set($event)"
            ></app-pos-fulfillment-selector>

            @if (isConsumoBlocked() && fulfillment() === 'consumo') {
              <div class="consumo-blocked-hint">
                <app-icon name="info" [size]="14"></app-icon>
                <span>
                  Debes abrir una mesa antes de marcar la orden como consumo.
                </span>
              </div>
            }

            @if (showTablePicker()) {
              @if (tableSession()) {
                <div class="table-pill">
                  <app-icon name="layout-grid" [size]="14"></app-icon>
                  <span>{{ tableLabel() }}</span>
                </div>
              } @else {
                <button
                  type="button"
                  class="open-table-cta"
                  (click)="openTablePicker.set(true)"
                >
                  <app-icon name="layout-grid" [size]="16"></app-icon>
                  <span>Abrir mesa</span>
                </button>
              }
            }
          </section>
        }

        <!-- Columna 3 — Cliente.
             Obj 2 (Fase K): selección de cliente inline (sin abrir otro
             modal), espejando la sección Cliente del modal de cobro:
             toggle Venta Anónima / Con Cliente + búsqueda y creación
             rápida embebidas. Sin cliente, la orden queda como
             Consumidor Final. -->
        <section class="create-section">
          <div class="section-header">
            <div class="section-indicator"></div>
            <h2 class="section-title">Cliente</h2>
          </div>

          <!-- Tipo de venta: anónima vs con cliente -->
          <div class="sale-type-options">
            <button
              type="button"
              class="sale-type-btn"
              [class.selected]="isAnonymousSale()"
              (click)="toggleAnonymousSale(true)"
            >
              <div class="radio-indicator">
                @if (isAnonymousSale()) {
                  <div class="radio-dot"></div>
                }
              </div>
              <app-icon name="user-x" [size]="20"></app-icon>
              <div class="sale-type-info">
                <span class="sale-type-name">Venta Anónima</span>
                <span class="sale-type-desc">Consumidor Final</span>
              </div>
            </button>

            <button
              type="button"
              class="sale-type-btn"
              [class.selected]="!isAnonymousSale()"
              (click)="toggleAnonymousSale(false)"
            >
              <div class="radio-indicator">
                @if (!isAnonymousSale()) {
                  <div class="radio-dot"></div>
                }
              </div>
              <app-icon name="user" [size]="20"></app-icon>
              <div class="sale-type-info">
                <span class="sale-type-name">Con Cliente</span>
                <span class="sale-type-desc">{{ selectedCustomer() ? customerLabel() : 'Seleccionar cliente' }}</span>
              </div>
            </button>
          </div>

          <!-- Cliente seleccionado -->
          @if (!isAnonymousSale() && selectedCustomer(); as customer) {
            <div class="selected-customer">
              <div class="customer-avatar">
                <app-icon name="user-check" [size]="16"></app-icon>
              </div>
              <div class="customer-info">
                <span class="customer-name">{{ customerLabel() }}</span>
                @if (customer.email) {
                  <span class="customer-email">{{ customer.email }}</span>
                }
              </div>
              <button
                type="button"
                class="change-customer-btn"
                (click)="openCustomerSelector()"
                aria-label="Cambiar cliente"
              >
                <app-icon name="edit-2" [size]="14"></app-icon>
              </button>
            </div>
          }

          <!-- CTA para abrir el selector inline -->
          @if (!isAnonymousSale() && !selectedCustomer() && !showCustomerSelector()) {
            <button
              type="button"
              class="select-customer-btn"
              (click)="openCustomerSelector()"
            >
              <app-icon name="user-plus" [size]="18"></app-icon>
              <span>Seleccionar Cliente</span>
            </button>
          }

          <!-- Panel selector inline: búsqueda + crear cliente -->
          @if (showCustomerSelector()) {
            <div class="customer-selector">
              <div class="selector-header">
                <span>Buscar Cliente</span>
                <button type="button" (click)="closeCustomerSelector()">
                  <app-icon name="x" [size]="16"></app-icon>
                </button>
              </div>

              <app-input
                [placeholder]="'Buscar por nombre, email o documento...'"
                [size]="'sm'"
                (inputChange)="onCustomerSearch($event)"
              ></app-input>

              @if (!showCreateCustomerForm() && customerSearchResults().length > 0) {
                <div class="search-results">
                  @for (customer of customerSearchResults(); track customer) {
                    <button
                      type="button"
                      class="customer-result"
                      (click)="selectCustomer(customer)"
                    >
                      <span class="result-name">{{ customer.first_name }} {{ customer.last_name }}</span>
                      <span class="result-email">{{ customer.email }}</span>
                    </button>
                  }
                </div>
              }

              @if (!showCreateCustomerForm()) {
                <div class="create-customer-action">
                  <button type="button" class="create-customer-btn" (click)="switchToCreateCustomer()">
                    <app-icon name="user-plus" [size]="16"></app-icon>
                    <span>Crear nuevo cliente</span>
                  </button>
                </div>
              }

              @if (showCreateCustomerForm()) {
                <div class="create-customer-form">
                  <h5>Nuevo Cliente</h5>
                  <app-input [formControl]="customerEmailControl" [label]="'Email'" [placeholder]="'correo@ejemplo.com'" [size]="'sm'"></app-input>
                  <div class="form-row">
                    <app-input [formControl]="customerFirstNameControl" [label]="'Nombre'" [placeholder]="'Juan'" [size]="'sm'"></app-input>
                    <app-input [formControl]="customerLastNameControl" [label]="'Apellido'" [placeholder]="'Pérez'" [size]="'sm'"></app-input>
                  </div>
                  <app-input [formControl]="customerPhoneControl" [label]="'Teléfono'" [placeholder]="'+1 234 5678'" [size]="'sm'"></app-input>
                  <div class="form-row">
                    <app-selector [formControl]="customerDocumentTypeControl" [label]="'Tipo Doc.'" [placeholder]="'Seleccionar'" [size]="'sm'" [options]="documentTypeOptions"></app-selector>
                    <app-input [formControl]="customerDocumentNumberControl" [label]="'Número Doc.'" [placeholder]="'12345678'" [size]="'sm'"></app-input>
                  </div>
                  <div class="form-actions">
                    <button type="button" class="btn-create" (click)="onCreateCustomer()">Crear</button>
                    <button type="button" class="btn-cancel" (click)="switchToCustomerSearch()">Cancelar</button>
                  </div>
                </div>
              }
            </div>
          }
        </section>
      </div>

      <div slot="footer" class="flex justify-end gap-2 w-full">
        <app-button variant="ghost" (click)="onCancel()" [disabled]="submitting()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (click)="onConfirm()"
          [disabled]="!canConfirm()"
          [loading]="submitting()"
          loadingText="Creando…"
        >
          <app-icon name="check" [size]="16"></app-icon>
          <span>Crear orden</span>
        </app-button>
      </div>
    </app-modal>

    @if (openTablePicker()) {
      <app-pos-open-table-modal
        [isOpen]="openTablePicker()"
        (isOpenChange)="openTablePicker.set($event)"
        [customer]="selectedCustomer()"
        (sessionOpened)="onTableSessionPicked($event)"
      ></app-pos-open-table-modal>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      /* 3-column layout mirroring the payment interface.
         Mobile-first: sections stack; grid only kicks in at >=1024px. */
      .create-content {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .create-section {
        background: var(--color-surface);
        border-radius: 16px;
        border: 1px solid var(--color-border);
        padding: 16px;
      }

      @media (min-width: 1024px) {
        .create-content {
          display: grid;
          grid-template-columns: 3fr 4fr 3fr;
          gap: 16px;
          align-items: start;
        }

        /* Sin columna de servicio: solo Resumen | Cliente. */
        .create-content--two-col {
          grid-template-columns: 2fr 1fr;
        }
      }

      /* Section header (indicator + title), mirrors payment interface. */
      .section-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 16px;
      }

      .section-indicator {
        width: 4px;
        height: 20px;
        background: var(--color-primary);
        border-radius: 2px;
      }

      .section-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
        margin: 0;
      }

      /* Product list (Resumen column). */
      .product-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 12px;
      }

      .product-item {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 8px;
        font-size: 13px;
      }

      .product-info {
        display: flex;
        min-width: 0;
        flex: 1;
        flex-direction: column;
        gap: 4px;
      }

      .product-name {
        color: var(--color-text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .product-qty {
        color: var(--color-text-muted);
        font-weight: 500;
      }

      .product-line-total {
        color: var(--color-text-primary);
        font-weight: 600;
        flex-shrink: 0;
        font-variant-numeric: tabular-nums;
      }

      .empty-cart {
        text-align: center;
        color: var(--color-text-muted);
        font-size: 13px;
        font-style: italic;
        padding: 16px 0;
      }

      /* Summary totals. */
      .summary-details {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding-top: 12px;
        margin-top: 12px;
        border-top: 1px solid var(--color-border);
      }

      .summary-row {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
        color: var(--color-text-muted);
      }

      .summary-value {
        font-weight: 600;
        color: var(--color-text-secondary);
        font-variant-numeric: tabular-nums;
      }

      .total-section {
        margin-top: 16px;
        padding-top: 16px;
      }

      .total-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--color-text-muted);
        font-weight: 600;
        margin: 0;
      }

      .total-amount {
        font-size: 24px;
        font-weight: 700;
        color: var(--color-primary);
        margin: 4px 0 0 0;
      }

      .consumo-blocked-hint {
        margin-top: 8px;
        display: flex;
        gap: 6px;
        align-items: center;
        font-size: 12px;
        color: rgb(194, 65, 12);
      }

      .table-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(var(--color-primary-rgb), 0.08);
        border: 1px solid rgba(var(--color-primary-rgb), 0.3);
        color: var(--color-primary);
        font-size: 13px;
        font-weight: 600;
      }

      .open-table-cta {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        border-radius: 10px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        color: var(--color-text-primary);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.18s ease;
      }

      .open-table-cta:hover {
        border-color: var(--color-primary);
        color: var(--color-primary);
      }

      /* Sección Cliente — espejo del modal de cobro (toggle + selector inline). */
      .sale-type-options {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .sale-type-btn {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px;
        border: 2px solid var(--color-border);
        border-radius: 12px;
        background: var(--color-surface);
        cursor: pointer;
        transition: all 0.2s;
        width: 100%;
        text-align: left;
      }

      .sale-type-btn:hover {
        border-color: var(--color-primary);
      }

      .sale-type-btn.selected {
        border-color: var(--color-primary);
        background: rgba(var(--color-primary-rgb), 0.05);
      }

      .radio-indicator {
        width: 20px;
        height: 20px;
        border: 2px solid var(--color-border);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .sale-type-btn.selected .radio-indicator {
        border-color: var(--color-primary);
      }

      .radio-dot {
        width: 10px;
        height: 10px;
        background: var(--color-primary);
        border-radius: 50%;
      }

      .sale-type-btn app-icon {
        color: var(--color-text-muted);
        flex-shrink: 0;
      }

      .sale-type-btn.selected app-icon {
        color: var(--color-primary);
      }

      .sale-type-info {
        flex: 1;
        min-width: 0;
      }

      .sale-type-name {
        display: block;
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
      }

      .sale-type-desc {
        display: block;
        font-size: 11px;
        color: var(--color-text-muted);
        margin-top: 2px;
      }

      .selected-customer {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        background: rgba(var(--color-success-rgb), 0.1);
        border-radius: 10px;
        margin-top: 12px;
      }

      .customer-avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: var(--color-success);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .customer-info {
        flex: 1;
        min-width: 0;
      }

      .customer-name {
        display: block;
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
      }

      .customer-email {
        display: block;
        font-size: 11px;
        color: var(--color-text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .change-customer-btn {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        border: none;
        background: var(--color-surface);
        color: var(--color-text-muted);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        flex-shrink: 0;
      }

      .change-customer-btn:hover {
        color: var(--color-primary);
      }

      .select-customer-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        padding: 14px;
        border: 2px dashed var(--color-border);
        border-radius: 12px;
        background: transparent;
        color: var(--color-text-muted);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
        margin-top: 12px;
      }

      .select-customer-btn:hover {
        border-color: var(--color-primary);
        color: var(--color-primary);
      }

      /* Panel selector inline: búsqueda + crear cliente. */
      .customer-selector {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid var(--color-border);
      }

      .selector-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }

      .selector-header span {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--color-text-muted);
      }

      .selector-header button {
        background: none;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        padding: 4px;
      }

      .search-results {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 150px;
        overflow-y: auto;
        margin-top: 12px;
      }

      .customer-result {
        display: flex;
        flex-direction: column;
        padding: 12px;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-surface);
        cursor: pointer;
        transition: all 0.2s;
        text-align: left;
        width: 100%;
      }

      .customer-result:hover {
        border-color: var(--color-primary);
      }

      .result-name {
        font-size: 13px;
        font-weight: 500;
        color: var(--color-text-primary);
      }

      .result-email {
        font-size: 11px;
        color: var(--color-text-secondary);
      }

      .create-customer-action {
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--color-border);
      }

      .create-customer-btn {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px;
        background: var(--color-primary);
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: filter 0.2s;
      }

      .create-customer-btn:hover {
        filter: brightness(1.1);
      }

      .create-customer-form {
        margin-top: 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .create-customer-form h5 {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
        margin: 0;
      }

      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .form-actions {
        display: flex;
        gap: 8px;
        margin-top: 8px;
      }

      .btn-create {
        flex: 1;
        padding: 10px;
        background: var(--color-primary);
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: filter 0.2s;
      }

      .btn-create:hover {
        filter: brightness(1.1);
      }

      .btn-cancel {
        flex: 1;
        padding: 10px;
        background: var(--color-surface);
        color: var(--color-text-primary);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
      }
    `,
  ],
})
export class PosOrderCreateModalComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);
  private readonly cartService = inject(PosCartService);
  private readonly paymentService = inject(PosPaymentService);
  private readonly posCustomerService = inject(PosCustomerService);
  private readonly integration = inject(PosRestaurantIntegrationService);
  private readonly toastService = inject(ToastService);
  private readonly store = inject(Store);
  private readonly router = inject(Router);

  // ─── Inputs / Outputs (Zoneless, model-based) ─────────────────────
  readonly isOpen = input<boolean>(false);
  readonly isOpenChange = output<boolean>();

  /**
   * When `true` the modal is the "Crear" summary and at the end of the
   * flow it must clear the cart. When `false` (used as a "review before
   * Cobrar" mirror in Fase 6) the cart is preserved so the parent can
   * continue to the payment step.
   */
  readonly clearCartOnSuccess = input<boolean>(true);

  /** Emitted when a draft order has been persisted (and KDS fired if applicable). */
  readonly created = output<PosOrderCreateResult>();

  /** Emitted when the operator aborts the modal. */
  readonly cancelled = output<void>();

  // ─── Local state (signals) ─────────────────────────────────────────
  readonly fulfillment = signal<FulfillmentType>('entrega');
  readonly submitting = signal(false);
  readonly openTablePicker = signal(false);

  // Selección de cliente inline (espejo del modal de cobro). El picker
  // separado (pos-customer-modal) fue reemplazado por este panel embebido.
  /** UI-only: cuando es `true` la orden queda como Consumidor Final
   *  (sin cliente en el carrito). No tiene flag de backend. */
  readonly isAnonymousSale = signal(true);
  readonly showCustomerSelector = signal(false);
  readonly showCreateCustomerForm = signal(false);
  readonly customerSearchResults = signal<PosCustomer[]>([]);
  readonly customerSearchQuery = signal('');
  readonly isSearchingCustomer = signal(false);

  readonly documentTypeOptions = [
    { value: 'dni', label: 'DNI' },
    { value: 'passport', label: 'Pasaporte' },
    { value: 'cedula', label: 'Cédula' },
    { value: 'other', label: 'Otro' },
  ];

  readonly customerForm: FormGroup = this.fb.group({
    email: ['', [Validators.email]],
    firstName: ['', [Validators.required, Validators.minLength(2)]],
    lastName: ['', [Validators.required, Validators.minLength(2)]],
    phone: [''],
    documentType: [''],
    documentNumber: ['', [Validators.required]],
  });

  get customerEmailControl(): FormControl {
    return this.customerForm.get('email') as FormControl;
  }
  get customerFirstNameControl(): FormControl {
    return this.customerForm.get('firstName') as FormControl;
  }
  get customerLastNameControl(): FormControl {
    return this.customerForm.get('lastName') as FormControl;
  }
  get customerPhoneControl(): FormControl {
    return this.customerForm.get('phone') as FormControl;
  }
  get customerDocumentTypeControl(): FormControl {
    return this.customerForm.get('documentType') as FormControl;
  }
  get customerDocumentNumberControl(): FormControl {
    return this.customerForm.get('documentNumber') as FormControl;
  }

  constructor() {
    // Reset the local state every time the modal is reopened.
    effect(() => {
      if (this.isOpen()) {
        untracked(() => {
          this.submitting.set(false);
          this.openTablePicker.set(false);
          this.fulfillment.set(this.hasOpenTableSession() ? 'consumo' : 'entrega');
          this.integration.resetPreparedFired();
          // Reset del selector de cliente inline.
          this.showCustomerSelector.set(false);
          this.showCreateCustomerForm.set(false);
          this.customerSearchResults.set([]);
          this.customerSearchQuery.set('');
          this.isSearchingCustomer.set(false);
          this.customerForm.reset();
          // Si el carrito ya trae cliente, abrir en modo "Con Cliente";
          // de lo contrario, por defecto Consumidor Final (anónima).
          this.isAnonymousSale.set(!this.selectedCustomer());
        });
      }
    });
  }

  // ─── Derived state ────────────────────────────────────────────────
  readonly cartState = this.cartService.cartState;
  readonly hasUnfiredPreparedItems = computed(() => {
    if (!this.integration.isRestaurantMode()) return false;
    // Bug 1 (Fase K): skipKds=true ("usar stock") means the cashier
    // chose to consume the product's own stock at payment, not send it
    // to the kitchen. Such lines must not be counted as "prepared to
    // fire" or the gate to the counter-fire / table-append paths opens
    // for the wrong reason.
    return (this.cartState()?.items ?? []).some(
      (it: CartItem) =>
        it.itemType !== 'custom' &&
        (it.product as any)?.product_type === 'prepared' &&
        it.skipKds !== true,
    );
  });
  readonly showFulfillmentSelector = computed(
    () => this.integration.isRestaurantMode() && this.hasUnfiredPreparedItems(),
  );
  readonly tableSession = this.integration.currentTableSession;
  readonly hasOpenTableSession = this.integration.hasOpenTableSession;
  readonly showTablePicker = computed(
    () =>
      this.showFulfillmentSelector() && this.fulfillment() === 'consumo',
  );
  readonly isConsumoBlocked = computed(
    () => this.fulfillment() === 'consumo' && !this.tableSession(),
  );
  readonly canConfirm = computed(() => {
    if (this.submitting()) return false;
    if (this.showFulfillmentSelector() && this.isConsumoBlocked()) return false;
    return (this.cartState()?.items?.length ?? 0) > 0;
  });

  readonly itemCount = computed(
    () => this.cartState()?.summary?.itemCount ?? 0,
  );
  readonly subtotal = computed(
    () => Number(this.cartState()?.summary?.subtotal ?? 0),
  );
  readonly taxAmount = computed(
    () => Number(this.cartState()?.summary?.taxAmount ?? 0),
  );
  readonly total = computed(
    () => Number(this.cartState()?.summary?.total ?? 0),
  );

  readonly tableLabel = computed(() => {
    const t = this.tableSession()?.table;
    if (!t) return '';
    return t.zone ? `${t.name} · ${t.zone}` : t.name;
  });

  /**
   * Obj 2 (Fase K): the customer picked inside the create-order
   * modal. Mirrors `cartState().customer` so the create flow always
   * sends the same id (or none) to the backend.
   */
  readonly selectedCustomer = computed<PosCustomer | null>(
    () => this.cartState()?.customer ?? null,
  );
  readonly customerLabel = computed(() => {
    const c = this.selectedCustomer();
    if (!c) return '';
    const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
    return name || c.email || 'Cliente';
  });

  // ─── Selección de cliente inline (espejo del modal de cobro) ───────
  /**
   * Alterna entre venta anónima (Consumidor Final) y venta con cliente.
   * Al pasar a anónima limpia el cliente del carrito; al pasar a "Con
   * Cliente" sin cliente seleccionado abre el panel de búsqueda.
   */
  toggleAnonymousSale(enabled: boolean): void {
    this.isAnonymousSale.set(enabled);
    if (enabled) {
      this.showCustomerSelector.set(false);
      this.showCreateCustomerForm.set(false);
      if (this.selectedCustomer()) {
        this.cartService
          .setCustomer(null)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({ next: () => undefined, error: () => undefined });
      }
    } else if (!this.selectedCustomer()) {
      this.showCustomerSelector.set(true);
    }
  }

  openCustomerSelector(): void {
    this.isAnonymousSale.set(false);
    this.showCustomerSelector.set(true);
    this.showCreateCustomerForm.set(false);
  }

  closeCustomerSelector(): void {
    this.showCustomerSelector.set(false);
    this.showCreateCustomerForm.set(false);
    this.customerSearchResults.set([]);
    this.customerSearchQuery.set('');
  }

  onCustomerSearch(query: string): void {
    this.customerSearchQuery.set(query);
    if (query && query.trim().length >= 2) {
      this.isSearchingCustomer.set(true);
      this.posCustomerService
        .searchCustomers({ query: query.trim(), limit: 10 })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (response) => {
            this.customerSearchResults.set(response.data || []);
            this.isSearchingCustomer.set(false);
          },
          error: () => {
            this.customerSearchResults.set([]);
            this.isSearchingCustomer.set(false);
            this.toastService.error('Error al buscar clientes');
          },
        });
    } else {
      this.customerSearchResults.set([]);
      this.isSearchingCustomer.set(false);
    }
  }

  selectCustomer(customer: PosCustomer): void {
    this.assignCustomerToCart(customer, 'Cliente asignado');
    this.closeCustomerSelector();
  }

  switchToCreateCustomer(): void {
    this.showCreateCustomerForm.set(true);
    this.customerSearchResults.set([]);
  }

  switchToCustomerSearch(): void {
    this.showCreateCustomerForm.set(false);
  }

  onCreateCustomer(): void {
    if (!this.customerForm.valid) {
      Object.keys(this.customerForm.controls).forEach((key) =>
        this.customerForm.get(key)?.markAsTouched(),
      );
      this.toastService.info('Por favor completa los campos requeridos');
      return;
    }

    const formValue = this.customerForm.value;
    const customerRequest = {
      email: formValue.email,
      first_name: formValue.firstName,
      last_name: formValue.lastName,
      phone: formValue.phone || undefined,
      document_type: formValue.documentType || undefined,
      document_number: formValue.documentNumber || undefined,
    };

    this.isSearchingCustomer.set(true);
    this.posCustomerService
      .createQuickCustomer(customerRequest)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (customer) => {
          this.isSearchingCustomer.set(false);
          this.assignCustomerToCart(customer, 'Cliente creado correctamente');
          this.closeCustomerSelector();
        },
        error: (error) => {
          this.isSearchingCustomer.set(false);
          this.toastService.error(this.toastError(error, 'Error al crear cliente'));
        },
      });
  }

  /** Persiste el cliente elegido/creado en el carrito (el modal de
   *  creación es dueño del carrito, no emite a un padre). */
  private assignCustomerToCart(customer: PosCustomer, successMsg: string): void {
    this.isAnonymousSale.set(false);
    this.cartService
      .setCustomer(customer)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.toastService.success(successMsg),
        error: () => undefined,
      });
  }

  // ─── Public handlers ─────────────────────────────────────────────
  onModalChange(open: boolean): void {
    if (!open) this.isOpenChange.emit(false);
  }

  onCancel(): void {
    this.cancelled.emit();
    this.isOpenChange.emit(false);
  }

  onTableSessionPicked(_result: any): void {
    this.openTablePicker.set(false);
    // fulfillment remains 'consumo' (it was the trigger). The session is
    // cached in `currentTableSession`; the derived `isConsumoBlocked`
    // now resolves to false so the operator can submit.
  }

  onConfirm(): void {
    if (!this.canConfirm()) return;

    const state = this.cartState();
    if (!state) return;

    this.submitting.set(true);

    // Dispatch the right create flow (Bug 3 / Fase K):
    //  - Restaurant table-session (already open)         → appendToTableAndFire (ALWAYS, even without prepared items)
    //  - Restaurant counter / takeaway (no open table)  → createCounterAndFire (only when there are prepared items to fire)
    //  - Retail (or restaurant with no prepared items, no session) → createRetailDraft
    //
    // The table-session branch used to require `hasUnfiredPreparedItems`,
    // which made retail lines fall through to `createRetailDraft` and
    // silently detach the items from the open table. The session branch
    // must take precedence whenever a table is open.
    const isRestaurant = this.integration.isRestaurantMode();
    const hasPrepared = this.hasUnfiredPreparedItems();
    const session = this.tableSession();

    if (isRestaurant && session?.order_id) {
      this.appendToTableAndFire(state, session);
      return;
    }

    if (isRestaurant && hasPrepared && !session) {
      this.createCounterAndFire(state);
      return;
    }

    this.createRetailDraft(state);
  }

  private createCounterAndFire(state: CartState): void {
    const lines = this.toCounterLines(state.items);
    if (lines.length === 0) {
      this.submitting.set(false);
      this.toastService.warning('Agrega productos al carrito antes de crear la orden');
      return;
    }
    const customerId = this.resolveCustomerId(state.customer);
    this.integration
      .createCounterDraftOrder(customerId, lines)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (order) => {
          const orderId = order?.id;
          const preparedIds = this.preparedItemIdsFromOrder(order);
          this.maybeFireAndFinish(orderId, preparedIds, state);
        },
        error: (err) => {
          this.submitting.set(false);
          this.toastService.error(this.toastError(err, 'No se pudo crear la orden'));
        },
      });
  }

  private appendToTableAndFire(state: CartState, session: any): void {
    // The table's DTO doesn't know about skipKds (it's a cart-local
    // flag), so we don't send it. ALL cart lines — including those
    // flagged skipKds — are appended to the table's running order so
    // they get billed at payment time. The skipKds lines are then
    // filtered OUT of the fire list by `preparedItemIdsFromOrder`
    // (their stock is consumed at payment, not at fire).
    const items = state.items
      .filter((it) => it.itemType !== 'custom')
      .map((it) => ({
        product_id: Number((it.product as any).id),
        quantity: it.quantity,
        product_variant_id: it.variant_id ?? undefined,
      }));
    if (items.length === 0) {
      this.submitting.set(false);
      this.toastService.warning('Agrega productos al carrito antes de crear la orden');
      return;
    }
    this.integration
      .addItemsToTableSession(session.id, items)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          const orderId = updated?.order?.id ?? session.order_id;
          const orderItemIds = (updated?.order?.order_items ?? [])
            .filter((it: any) =>
              items.some(
                (i) =>
                  i.product_id === it.product_id && i.quantity === it.quantity,
              ),
            )
            .map((it: any) => it.id);
          this.maybeFireAndFinish(orderId, orderItemIds, state);
        },
        error: (err) => {
          this.submitting.set(false);
          this.toastService.error(this.toastError(err, 'No se pudo agregar ítems a la mesa'));
        },
      });
  }

  private createRetailDraft(state: CartState): void {
    this.paymentService
      .saveDraft(state, 'current_user')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          this.submitting.set(false);
          if (!res?.success) {
            this.toastService.error(res?.message || 'Error al crear la orden');
            return;
          }
          this.toastService.success(res.message || 'Orden creada correctamente');
          this.finishCreate(res.order ?? null, [], false);
        },
        error: (err: any) => {
          this.submitting.set(false);
          this.toastService.error(
            this.toastError(err, 'Error al crear la orden'),
          );
        },
      });
  }

  private maybeFireAndFinish(
    orderId: number | undefined,
    orderItemIds: number[],
    state: CartState,
  ): void {
    if (!orderId) {
      this.finishCreate(null, orderItemIds, false);
      return;
    }
    this.integration
      .maybeFireKitchen(orderId, orderItemIds)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (fireRes) => {
          const fired = !!fireRes && fireRes.fired_item_ids.length > 0;
          if (fired) {
            this.toastService.success('Orden creada y enviada a cocina');
          } else if (orderItemIds.length > 0) {
            this.toastService.success('Orden creada');
          } else {
            this.toastService.success('Orden creada');
          }
          this.finishCreate({ id: orderId } as any, orderItemIds, fired);
          void state; // keep for future extensions (notes / customer)
        },
        error: (err) => {
          // Order already persisted — surface the error but do not roll back.
          this.toastService.warning(
            'La orden se creó pero no se pudo enviar a cocina. Reintenta desde el panel.',
          );
          console.error('maybeFireKitchen failed', err);
          this.finishCreate({ id: orderId } as any, orderItemIds, false);
        },
      });
  }

  private finishCreate(
    order: any,
    orderItemIds: number[],
    firedToKitchen: boolean,
  ): void {
    const fulfillment: FulfillmentType | null = this.showFulfillmentSelector()
      ? this.fulfillment()
      : null;
    const tableId = this.tableSession()?.table_id ?? null;

    this.created.emit({
      order,
      fulfillment,
      tableId,
      firedToKitchen,
    });

    if (this.clearCartOnSuccess()) {
      this.cartService
        .clearCart()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => this.isOpenChange.emit(false),
          error: () => this.isOpenChange.emit(false),
        });
    } else {
      this.isOpenChange.emit(false);
    }
    // Suppress unused-warning while keeping the variable available for callers
    void orderItemIds;
  }

  // ─── Helpers ──────────────────────────────────────────────────────
  private toCounterLines(items: CartItem[]): Array<{
    product_id: number;
    product_variant_id?: number;
    product_name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    tax_rate?: number;
  }> {
    return items
      .filter((it) => it.itemType !== 'custom')
      .map((it) => ({
        product_id: Number((it.product as any).id),
        product_variant_id: it.variant_id ?? undefined,
        product_name: it.product.name,
        quantity: it.quantity,
        unit_price: Number(it.unitPrice || 0),
        total_price: Number(it.totalPrice || 0),
        tax_rate: (it.product as any)?.tax_rate ?? undefined,
      }));
  }

  private preparedItemIdsFromOrder(order: any): number[] {
    const items: any[] = order?.order_items ?? [];
    // Build a quick lookup of cart lines by product_id(+variant_id)
    // flagged skipKds, so we can exclude them from the fire list.
    const cart = this.cartState()?.items ?? [];
    const skipKdsKeys = new Set<string>();
    for (const ci of cart) {
      if (ci?.skipKds !== true) continue;
      const pid = Number((ci.product as any)?.id);
      if (!Number.isFinite(pid)) continue;
      const vid = ci.variant_id ?? null;
      skipKdsKeys.add(`${pid}::${vid}`);
    }
    return items
      .filter(
        (it) =>
          it?.product?.product_type === 'prepared' ||
          it?.product_type === 'prepared',
      )
      .map((it) => {
        const pid = Number(it?.product_id);
        const vid = it?.product_variant_id ?? null;
        return {
          id: Number(it.id),
          skip: skipKdsKeys.has(`${pid}::${vid}`),
        };
      })
      .filter((x) => Number.isFinite(x.id) && !x.skip)
      .map((x) => x.id);
  }

  private resolveCustomerId(customer: PosCustomer | null | undefined): number {
    if (!customer) return 0;
    const id = Number((customer as any).id);
    return Number.isFinite(id) && id > 0 ? id : 0;
  }


  private toastError(err: any, fallback: string): string {
    const msg = extractApiErrorMessage(err);
    return msg && msg.length ? msg : fallback;
  }
  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(Number(amount) || 0);
  }
}
