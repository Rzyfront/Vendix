import {
  Component,
  input,
  output,
  ViewChild,
  ElementRef,
  inject,
  effect,
  signal,
  computed,
  DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormGroup,
  FormControl,
  Validators,
  ReactiveFormsModule,
  FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { Store } from '@ngrx/store';
import * as fromAuth from '../../../../../../core/store/auth';
import { environment } from '../../../../../../../environments/environment';

import {
  ModalComponent,
  InputComponent,
  IconComponent,
  TooltipComponent,
  SelectorComponent,
  SelectorOption } from '../../../../../../shared/components';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService, CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { CountryService, Department, City } from '../../../../../../services/country.service';
import { PosPaymentService, PaymentMethod } from '../../services/pos-payment.service';
import { PosShippingService } from '../../services/pos-shipping.service';
import { PosCustomerService } from '../../services/pos-customer.service';
import { CartState } from '../../models/cart.model';
import { PosCustomer } from '../../models/customer.model';
import {
  PosShippingMethod,
  PosShippingAddress,
  PosShippingPaymentMode } from '../../models/shipping.model';
import { PaymentRequest } from '../../models/payment.model';
import { CurrencyInputDirective } from '../../../../../../shared/directives/currency-input.directive';
import { toLocalDateString } from '../../../../../../shared/utils/date.util';

@Component({
  selector: 'app-pos-shipping-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    ModalComponent,
    InputComponent,
    IconComponent,
    TooltipComponent,
    SelectorComponent,
    CurrencyPipe,
    CurrencyInputDirective,
  ],
  templateUrl: './pos-shipping-modal.component.html',
  styles: [
    `
      /* Content */
      .shipping-content {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      /* Section Styling (shared with payment interface) */
      .payment-section {
        background: var(--color-surface);
        border-radius: 16px;
        border: 1px solid var(--color-border);
        padding: 16px;
      }

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

      .section-icon { color: var(--color-primary); }

      .section-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
        margin: 0;
      }

      /* Product List */
      .product-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 12px;
      }

      .product-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 13px;
      }

      .product-name {
        color: var(--color-text-secondary);
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-right: 8px;
      }

      .product-qty {
        color: var(--color-text-muted);
        font-weight: 500;
        flex-shrink: 0;
      }

      .empty-cart {
        text-align: center;
        color: var(--color-text-muted);
        font-size: 13px;
        font-style: italic;
        padding: 16px 0;
      }

      /* Summary */
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
      }

      .summary-value.discount { color: var(--color-error); }
      .summary-value.shipping-cost-highlight { color: var(--color-primary); }

      .total-section { margin-top: 16px; padding-top: 16px; }

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

      /* Tabs */
      .tab-headers {
        display: flex;
        gap: 4px;
        margin-bottom: 16px;
        background: var(--color-background);
        border-radius: 10px;
        padding: 4px;
      }

      .tab-btn {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 10px 12px;
        border: none;
        border-radius: 8px;
        background: transparent;
        color: var(--color-text-muted);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }

      .tab-btn:hover { color: var(--color-text-primary); }

      .tab-btn.active {
        background: var(--color-surface);
        color: var(--color-primary);
        box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      }

      .tab-content { min-height: 200px; }

      /* Collapsible sub-sections */
      .collapsible-subsection {
        margin-top: 12px;
        border-top: 1px solid var(--color-border);
        padding-top: 12px;
      }

      .collapsible-subsection:first-of-type {
        margin-top: 0;
        border-top: none;
        padding-top: 0;
      }

      .subsection-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        padding: 4px 0;
        user-select: none;
        -webkit-tap-highlight-color: transparent;
      }

      .subsection-header:hover {
        opacity: 0.8;
      }

      .collapsed-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 8px;
        background: rgba(var(--color-primary-rgb), 0.08);
        color: var(--color-primary);
        font-size: 12px;
        font-weight: 600;
      }

      .subsection-body {
        margin-top: 12px;
      }

      /* Methods Grid */
      .payment-methods-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
      }

      .payment-method-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 16px 12px;
        border: 1px solid var(--color-border);
        border-radius: 12px;
        background: var(--color-surface);
        cursor: pointer;
        transition: all 0.2s ease;
        color: var(--color-text-muted);
      }

      .payment-method-btn:hover {
        border-color: var(--color-primary);
        color: var(--color-primary);
      }

      .payment-method-btn.selected {
        border: 2px solid var(--color-primary);
        background: rgba(var(--color-primary-rgb), 0.05);
        color: var(--color-primary);
      }

      .method-name {
        font-size: 12px;
        font-weight: 600;
        margin-top: 8px;
        color: var(--color-text-primary);
        text-align: center;
        line-height: 1.2;
      }

      .no-methods {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 24px;
        color: var(--color-text-muted);
      }

      .no-methods p { font-size: 13px; margin: 8px 0; }

      /* Address Form */
      .address-form {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid var(--color-border);
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      /* Shipping Cost Section */
      .shipping-cost-section {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid var(--color-border);
      }

      .calculating-indicator {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px;
        color: var(--color-text-muted);
        font-size: 13px;
      }

      .spinner-sm {
        width: 16px;
        height: 16px;
        border: 2px solid var(--color-border);
        border-top-color: var(--color-primary);
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      .cost-display { display: flex; flex-direction: column; gap: 12px; }

      .calculated-cost {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        background: rgba(var(--color-success-rgb), 0.1);
        border: 1px solid rgba(var(--color-success-rgb), 0.3);
        border-radius: 10px;
      }

      .cost-label {
        font-size: 13px;
        color: var(--color-text-secondary);
        font-weight: 500;
      }

      .cost-value {
        font-size: 16px;
        font-weight: 700;
        color: var(--color-success);
      }

      .manual-toggle {
        display: flex;
        align-items: center;
      }

      .toggle-label {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: var(--color-text-secondary);
        cursor: pointer;
      }

      .toggle-label input[type="checkbox"] {
        accent-color: var(--color-primary);
        width: 16px;
        height: 16px;
      }

      .manual-cost-input { margin-top: 4px; }

      /* Cash input (shared with payment interface) */
      .cash-input {
        display: flex;
        align-items: center;
        background: var(--color-background);
        border: 2px solid var(--color-border);
        border-radius: 10px;
        padding: 8px 12px;
        transition: border-color 0.2s;
      }

      .cash-input:focus-within { border-color: var(--color-primary); }
      .cash-input.error { border-color: var(--color-error); background: rgba(var(--color-error-rgb), 0.05); }

      .cash-input .currency {
        font-size: 16px;
        font-weight: 600;
        color: var(--color-text-secondary);
        margin-right: 4px;
      }

      .cash-input input {
        flex: 1;
        border: none;
        background: transparent;
        font-size: 18px;
        font-weight: 700;
        color: var(--color-text-primary);
        outline: none;
        width: 100%;
        min-width: 0;
      }

      .cash-input.error input { color: var(--color-error); }

      .error-text {
        display: block;
        font-size: 11px;
        color: var(--color-error);
        font-weight: 500;
        margin-top: 4px;
      }

      /* Cash section */
      .cash-section {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid var(--color-border);
      }

      .cash-inputs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin-bottom: 12px;
      }

      .cash-input-group label {
        display: block;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--color-text-muted);
        margin-bottom: 6px;
      }

      .change-display {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(var(--color-success-rgb), 0.1);
        border: 2px solid rgba(var(--color-success-rgb), 0.3);
        border-radius: 10px;
        padding: 8px 12px;
        height: 44px;
      }

      .change-display span { font-size: 16px; font-weight: 700; color: var(--color-success); }
      .change-display app-icon { color: var(--color-success); }

      .quick-amounts {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-bottom: 12px;
      }

      .quick-btn {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        border: 2px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-surface);
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
        cursor: pointer;
        transition: all 0.2s;
      }

      .quick-btn:hover { border-color: var(--color-primary); }

      .quick-btn.primary {
        border-color: var(--color-primary);
        background: rgba(var(--color-primary-rgb), 0.05);
      }

      .quick-btn .quick-value { color: var(--color-primary); }
      .quick-btn.primary app-icon { color: var(--color-primary); }

      .keypad {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }

      .keypad-btn {
        padding: 14px;
        font-size: 18px;
        font-weight: 600;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-surface);
        color: var(--color-text-primary);
        cursor: pointer;
        transition: all 0.15s;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .keypad-btn:hover { background: var(--color-muted); }
      .keypad-btn:active { transform: scale(0.95); }
      .keypad-btn.clear { color: var(--color-error); border-color: rgba(var(--color-error-rgb), 0.3); }
      .keypad-btn.clear:hover { background: rgba(var(--color-error-rgb), 0.1); }

      .reference-section { margin-top: 16px; text-align: center; }

      .reference-header { margin-bottom: 16px; }
      .reference-header app-icon { color: var(--color-primary); margin-bottom: 8px; }
      .reference-header p { font-size: 13px; color: var(--color-text-secondary); margin: 0; }

      /* Sale type / radio buttons */
      .sale-type-options { display: flex; flex-direction: column; gap: 12px; }

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

      .sale-type-btn:hover { border-color: var(--color-primary); }

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

      .sale-type-btn.selected .radio-indicator { border-color: var(--color-primary); }

      .radio-dot {
        width: 10px;
        height: 10px;
        background: var(--color-primary);
        border-radius: 50%;
      }

      .sale-type-btn app-icon { color: var(--color-text-muted); flex-shrink: 0; }
      .sale-type-btn.selected app-icon { color: var(--color-primary); }

      .sale-type-info { flex: 1; min-width: 0; }

      .sale-type-name { display: block; font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
      .sale-type-desc { display: block; font-size: 11px; color: var(--color-text-muted); margin-top: 2px; }

      /* Customer section */
      .selected-customer {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        background: rgba(var(--color-success-rgb), 0.1);
        border-radius: 10px;
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

      .customer-info { flex: 1; min-width: 0; }
      .customer-name { display: block; font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
      .customer-email { display: block; font-size: 11px; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

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

      .change-customer-btn:hover { color: var(--color-primary); }

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
      }

      .select-customer-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }

      .customer-selector { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--color-border); }

      .selector-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }

      .selector-header span { font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--color-text-muted); }
      .selector-header button { background: none; border: none; color: var(--color-text-muted); cursor: pointer; padding: 4px; }

      .search-results { display: flex; flex-direction: column; gap: 8px; max-height: 150px; overflow-y: auto; margin-top: 12px; }

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

      .customer-result:hover { border-color: var(--color-primary); }
      .result-name { font-size: 13px; font-weight: 500; color: var(--color-text-primary); }
      .result-email { font-size: 11px; color: var(--color-text-secondary); }

      .create-customer-action { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--color-border); }

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

      .create-customer-btn:hover { filter: brightness(1.1); }

      .create-customer-form { margin-top: 12px; display: flex; flex-direction: column; gap: 12px; }
      .create-customer-form h5 { font-size: 14px; font-weight: 600; color: var(--color-text-primary); margin: 0; }

      .form-actions { display: flex; gap: 8px; margin-top: 8px; }

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

      .btn-create:hover { filter: brightness(1.1); }

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

      /* Delivery Notes */
      .delivery-notes { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--color-border); }

      /* Footer */
      .payment-footer { display: flex; flex-direction: column; gap: 12px; width: 100%; }
      .footer-row { display: flex; gap: 12px; }

      .btn-cancel-payment {
        flex: 1;
        padding: 12px;
        border: 1px solid rgba(var(--color-error-rgb), 0.3);
        border-radius: 12px;
        background: transparent;
        color: var(--color-error);
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
      }

      .btn-cancel-payment:hover:not(:disabled) { background: rgba(var(--color-error-rgb), 0.05); }
      .btn-cancel-payment:disabled { opacity: 0.5; cursor: not-allowed; }

      .btn-confirm {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        padding: 16px;
        background: var(--color-primary);
        color: white;
        border: none;
        border-radius: 12px;
        font-size: 16px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s;
        box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.3);
      }

      .btn-confirm:hover:not(:disabled) { filter: brightness(1.05); transform: translateY(-1px); }
      .btn-confirm:active:not(:disabled) { transform: scale(0.98); }
      .btn-confirm:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }

      .spinner {
        width: 20px;
        height: 20px;
        border: 2px solid white;
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin { to { transform: rotate(360deg); } }

      /* Desktop: 3-column horizontal layout */
      @media (min-width: 1024px) {
        .shipping-content {
          display: grid;
          grid-template-columns: 3fr 5fr 4fr;
          gap: 16px;
          height: 100%;
          min-height: 0;
        }

        .payment-section {
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          height: 100%;
        }

        .product-list { max-height: none; }
        .search-results { max-height: 200px; }
      }

      @media (max-width: 480px) {
        .shipping-content { gap: 12px; }
        .payment-section { padding: 14px; }
        .total-amount { font-size: 22px; }
        .keypad-btn { padding: 12px; font-size: 16px; }
        .btn-confirm { padding: 14px; font-size: 15px; }
      }

      /* Validation flash warning animation */
      @keyframes configFlashWarning {
        0%   { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);   border-color: transparent; }
        15%  { box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.4); border-color: #f59e0b; }
        30%  { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);   border-color: transparent; }
        55%  { box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.4); border-color: #f59e0b; }
        70%  { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);   border-color: transparent; }
        100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);   border-color: transparent; }
      }

      .config-flash-warning {
        animation: configFlashWarning 1.2s ease-out;
        border: 2px solid transparent;
        border-radius: 12px;
      }
    `,
  ] })
export class PosShippingModalComponent {
  private destroyRef = inject(DestroyRef);
  readonly isOpen = input<boolean>(false);
  readonly cartState = input<CartState | null>(null);
  readonly closed = output<void>();
  readonly shippingCompleted = output<any>();
  readonly customerSelected = output<PosCustomer>();

  // Section refs for scroll-to-validation
  @ViewChild('shippingMethodSection') shippingMethodSection!: ElementRef;
  @ViewChild('addressSection') addressSection!: ElementRef;
  @ViewChild('customerSection') customerSection!: ElementRef;
  @ViewChild('paymentSection') paymentSection!: ElementRef;

  // Validation warning flash state
  validationWarningSection: 'shipping-method' | 'address' | 'customer' | 'payment' | null = null;
  validationWarningMessage = '';
  private validationWarningTimeout: any;

  // Tab state
  activeTab: 'shipping' | 'payment' = 'shipping';

  // Collapsible sub-section state
  paymentFormCollapsed = false;
  paymentModeCollapsed = false;
  paymentMethodCollapsed = false;

  // Onscreen keypad visibility
  showOnscreenKeypad = true;

  // Shipping state
  readonly shippingMethods = signal<PosShippingMethod[]>([]);
  readonly selectedShippingMethod = signal<PosShippingMethod | null>(null);
  readonly shippingCost = signal<number>(0);
  readonly calculatedShippingCost = signal<number | null>(null);
  readonly manualCostOverride = signal<boolean>(false);
  readonly isCalculatingShipping = signal<boolean>(false);

  // Payment state
  paymentMode: PosShippingPaymentMode = 'on_delivery';
  paymentMethods: PaymentMethod[] = [];
  selectedPaymentMethod: PaymentMethod | null = null;
  cashReceived = 0;
  cashChange = 0;

  // Credit (Forma de Pago)
  shippingPaymentForm: 'contado' | 'credito' = 'contado';
  creditNumInstallments = 3;
  creditFrequency: 'weekly' | 'biweekly' | 'monthly' = 'monthly';
  creditFirstDate = '';
  creditInterestRate = 0;
  creditInitialPayment = 0;
  creditInitialPaymentMethod: PaymentMethod | null = null;
  creditRemainingBalance = 0;
  creditInstallmentsPreview: { amount: number; due_date: string }[] = [];
  frequencyOptions = [
    { value: 'weekly' as const, label: 'Semanal' },
    { value: 'biweekly' as const, label: 'Quincenal' },
    { value: 'monthly' as const, label: 'Mensual' },
  ];
  defaultPaymentForm: 'contado' | 'credito' = 'contado';

  // Customer state
  showCustomerSelector = false;
  customerSearchResults: PosCustomer[] = [];
  showCreateCustomerForm = false;
  isSearchingCustomer = false;

  // Processing
  isProcessing = false;

  // Address auto-fill state
  readonly selectedCustomerAddressId = signal<number | null>(null);

  // Location dropdowns (API Colombia)
  readonly departments = signal<Department[]>([]);
  readonly cities = signal<City[]>([]);
  readonly selectedDepartmentId = signal<number | null>(null);
  readonly selectedCityId = signal<number | null>(null);

  // Forms
  addressForm: FormGroup;
  customerForm: FormGroup;
  paymentForm: FormGroup;

  currencySymbol: any;
private customerSearchSubject = new Subject<string>(); // LEGÍTIMO — debounceTime customer search stream

  get addressLine1Control(): FormControl {
    return this.addressForm.get('address_line1') as FormControl;
  }

  get cityControl(): FormControl {
    return this.addressForm.get('city') as FormControl;
  }

  get stateProvinceControl(): FormControl {
    return this.addressForm.get('state_province') as FormControl;
  }

  get deliveryNotesControl(): FormControl {
    return this.addressForm.get('delivery_notes') as FormControl;
  }

  get cashReceivedControl(): FormControl {
    return this.paymentForm.get('cashReceived') as FormControl;
  }

  get referenceControl(): FormControl {
    return this.paymentForm.get('reference') as FormControl;
  }

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

  get customerDisplayName(): string {
    if (!this.cartState()?.customer) return 'Seleccionar cliente';
    const firstName = this.cartState()!.customer?.first_name || '';
    const lastName = this.cartState()!.customer?.last_name || '';
    return `${firstName} ${lastName}`.trim() || 'Cliente sin nombre';
  }

  get totalWithShipping(): number {
    return (this.cartState()?.summary?.total || 0) + this.shippingCost();
  }

  get isCashInsufficient(): boolean {
    if (this.selectedPaymentMethod?.type !== 'cash') return false;
    return this.cashReceived < this.totalWithShipping;
  }

  readonly departmentOptions = computed<SelectorOption[]>(() =>
    this.departments().map(d => ({ value: d.id, label: d.name })),
  );

  readonly cityOptions = computed<SelectorOption[]>(() =>
    this.cities().map(c => ({ value: c.id, label: c.name })),
  );

  private fb = inject(FormBuilder);
  private http = inject(HttpClient);
  private paymentService = inject(PosPaymentService);
  private shippingService = inject(PosShippingService);
  private customerService = inject(PosCustomerService);
  private toastService = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);
  private countryService = inject(CountryService);
  private store = inject(Store);
  private router = inject(Router);

  constructor() {
    this.addressForm = this.fb.group({
      address_line1: ['', Validators.required],
      city: ['', Validators.required],
      state_province: [''],
      delivery_notes: [''] });
    this.customerForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      firstName: ['', [Validators.required, Validators.minLength(2)]],
      lastName: ['', [Validators.required, Validators.minLength(2)]],
      phone: [''] });
    this.paymentForm = this.fb.group({
      cashReceived: [0, [Validators.required, Validators.min(0)]],
      reference: [''] });
    this.currencySymbol = this.currencyService.currencySymbol;

    inject(DestroyRef).onDestroy(() => {
      if (this.validationWarningTimeout) {
        clearTimeout(this.validationWarningTimeout);
      }
    });

    this.loadShippingMethods();
    this.loadPaymentMethods();
    this.setupFormListeners();
    this.currencyService.loadCurrency();
    this.loadDepartments();
    this.loadStoreSettings();
    this.setDefaultCreditFirstDate();

    effect(() => {
      if (this.isOpen() === true) {
        this.resetState();
        void this.loadAddressesForCartCustomer();
      }
    });
  }

  private resetState(): void {
    this.activeTab = 'shipping';
    this.paymentFormCollapsed = false;
    this.paymentModeCollapsed = false;
    this.paymentMethodCollapsed = false;
    this.selectedShippingMethod.set(null);
    this.shippingCost.set(0);
    this.calculatedShippingCost.set(null);
    this.manualCostOverride.set(false);
    this.paymentMode = 'on_delivery';
    this.selectedPaymentMethod = null;
    this.cashReceived = 0;
    this.cashChange = 0;
    this.isProcessing = false;
    this.showCustomerSelector = false;
    this.customerSearchResults = [];
    this.showCreateCustomerForm = false;
    this.selectedCustomerAddressId.set(null);
    this.cities.set([]);
    this.selectedDepartmentId.set(null);
    this.selectedCityId.set(null);
    this.validationWarningSection = null;
    this.validationWarningMessage = '';
    this.shippingPaymentForm = this.defaultPaymentForm;
    this.creditNumInstallments = 3;
    this.creditFrequency = 'monthly';
    this.creditInterestRate = 0;
    this.creditInitialPayment = 0;
    this.creditInitialPaymentMethod = null;
    this.creditRemainingBalance = 0;
    this.creditInstallmentsPreview = [];
    this.setDefaultCreditFirstDate();
    if (this.validationWarningTimeout) {
      clearTimeout(this.validationWarningTimeout);
    }
    this.addressForm.reset();
    this.paymentForm.reset();
    this.customerForm.reset();
  }

  private loadShippingMethods(): void {
    this.shippingService
      .getShippingMethods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((methods) => {
        this.shippingMethods.set(methods);
      });
  }

  private loadPaymentMethods(): void {
    this.paymentService
      .getPaymentMethods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((methods) => {
        this.paymentMethods = methods;
      });
  }

  private setupFormListeners(): void {
    this.cashReceivedControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef), debounceTime(100))
      .subscribe((value: string | number | null) => {
        if (value !== null && value !== undefined && value !== '') {
          this.cashReceived = parseFloat(value.toString()) || 0;
          this.cashChange = Math.max(0, this.cashReceived - this.totalWithShipping);
        }
      });

    // Trigger shipping calculation when address changes
    this.addressForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef), debounceTime(500))
      .subscribe(() => {
        if (this.selectedShippingMethod() && !this.manualCostOverride()) {
          this.calculateShippingCost();
        }
      });

    // Debounced customer search (300ms)
    this.customerSearchSubject
      .pipe(takeUntilDestroyed(this.destroyRef), debounceTime(300))
      .subscribe((query) => this.executeCustomerSearch(query));
  }

  // --- Shipping Methods ---

  selectShippingMethod(method: PosShippingMethod): void {
    this.selectedShippingMethod.set(method);
    if (method.type === 'pickup') {
      this.shippingCost.set(0);
      this.calculatedShippingCost.set(0);
    } else {
      this.calculateShippingCost();
    }
  }

  getShippingIcon(type: string): string {
    const iconMap: Record<string, string> = {
      own_fleet: 'truck',
      carrier: 'package',
      pickup: 'store',
      custom: 'settings',
      third_party_provider: 'globe' };
    return iconMap[type] || 'truck';
  }

  private calculateShippingCost(): void {
    const method = this.selectedShippingMethod();
    if (!method || !this.cartState()?.items?.length) return;

    const address = this.addressForm.value;
    if (method.type !== 'pickup' && !address.city) return;

    this.isCalculatingShipping.set(true);

    const items = this.cartState()!.items.map((item) => ({
      product_id: parseInt(item.product.id),
      quantity: item.quantity,
      price: item.totalPrice }));

    this.shippingService
      .calculateShipping(items, {
        country_code: 'CO',
        city: address.city || undefined,
        state_province: address.state_province || undefined,
        address_line1: address.address_line1 || undefined })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (options) => {
          this.isCalculatingShipping.set(false);
          const matchingOption = options.find(
            (o) => o.method_id === method.id,
          );
          if (matchingOption) {
            this.calculatedShippingCost.set(matchingOption.cost);
            if (!this.manualCostOverride()) {
              this.shippingCost.set(matchingOption.cost);
            }
          } else if (options.length > 0) {
            this.calculatedShippingCost.set(options[0].cost);
            if (!this.manualCostOverride()) {
              this.shippingCost.set(options[0].cost);
            }
          } else {
            this.calculatedShippingCost.set(null);
            this.manualCostOverride.set(true);
            this.shippingCost.set(0);
          }
        },
        error: () => {
          this.isCalculatingShipping.set(false);
          this.calculatedShippingCost.set(null);
          this.manualCostOverride.set(true);
          this.shippingCost.set(0);
        } });
  }

  toggleManualCost(): void {
    const next = !this.manualCostOverride();
    this.manualCostOverride.set(next);
    const calc = this.calculatedShippingCost();
    if (!next && calc !== null) {
      this.shippingCost.set(calc);
    }
  }

  onShippingCostChange(): void {
    // shippingCost already updated by ngModel
  }

  // --- Location Dropdowns (API Colombia) ---

  private async loadDepartments(): Promise<void> {
    this.departments.set(await this.countryService.getDepartments());
  }

  async onDepartmentChange(departmentId: number): Promise<void> {
    this.selectedDepartmentId.set(departmentId || null);
    const dept = this.departments().find(d => d.id === departmentId);
    this.addressForm.patchValue({ state_province: dept?.name || '' });

    this.cities.set([]);
    this.selectedCityId.set(null);
    this.addressForm.patchValue({ city: '' });

    if (departmentId) {
      this.cities.set(await this.countryService.getCitiesByDepartment(departmentId));
    }
  }

  onCityChange(cityId: number): void {
    this.selectedCityId.set(cityId || null);
    const city = this.cities().find(c => c.id === cityId);
    this.addressForm.patchValue({ city: city?.name || '' });
  }

  // --- Payment ---

  setPaymentMode(mode: PosShippingPaymentMode): void {
    this.paymentMode = mode;
    this.paymentModeCollapsed = true;
    this.paymentMethodCollapsed = false;
    if (mode === 'on_delivery') {
      this.selectedPaymentMethod = null;
    }
  }

  selectPaymentMethod(method: PaymentMethod): void {
    this.selectedPaymentMethod = method;
    this.paymentMethodCollapsed = true;
    this.paymentForm.reset();
    this.cashChange = 0;
    if (method.type === 'cash') {
      this.cashReceivedControl.setValue(this.totalWithShipping);
    }
  }

  togglePaymentMethodCollapsed(): void {
    this.paymentMethodCollapsed = !this.paymentMethodCollapsed;
  }

  setCashAmount(amount: number): void {
    this.cashReceivedControl.setValue(amount);
  }

  appendNumber(num: number): void {
    const current = this.cashReceivedControl.value || 0;
    const newValue = parseFloat(current.toString() + num.toString());
    this.cashReceivedControl.setValue(newValue);
  }

  backspace(): void {
    const current = this.cashReceivedControl.value;
    if (!current) return;
    const str = current.toString();
    this.cashReceivedControl.setValue(str.length <= 1 ? 0 : parseFloat(str.slice(0, -1)));
  }

  clearCashAmount(): void {
    this.cashReceivedControl.setValue(0);
  }

  setShippingPaymentForm(form: 'contado' | 'credito'): void {
    this.shippingPaymentForm = form;
    this.paymentFormCollapsed = true;
    this.paymentModeCollapsed = false;
    if (form === 'credito') {
      this.updateCreditCalculations();
    }
  }

  togglePaymentFormCollapsed(): void {
    this.paymentFormCollapsed = !this.paymentFormCollapsed;
  }

  togglePaymentModeCollapsed(): void {
    this.paymentModeCollapsed = !this.paymentModeCollapsed;
  }

  selectCreditInitialPaymentMethod(method: PaymentMethod): void {
    this.creditInitialPaymentMethod = method;
  }

  updateCreditCalculations(): void {
    const total = this.totalWithShipping;
    this.creditRemainingBalance = Math.max(0, total - (this.creditInitialPayment || 0));

    const n = this.creditNumInstallments;
    if (n <= 0 || this.creditRemainingBalance <= 0) {
      this.creditInstallmentsPreview = [];
      return;
    }

    const baseAmount = Math.round((this.creditRemainingBalance / n) * 100) / 100;
    const freqDays: Record<string, number> = { weekly: 7, biweekly: 14, monthly: 30 };
    const startDate = this.creditFirstDate ? new Date(this.creditFirstDate + 'T12:00:00') : new Date();

    this.creditInstallmentsPreview = Array.from({ length: n }, (_, i) => {
      const due = new Date(startDate);
      due.setDate(due.getDate() + freqDays[this.creditFrequency] * i);
      return {
        amount: i === n - 1 ? Math.round((this.creditRemainingBalance - baseAmount * (n - 1)) * 100) / 100 : baseAmount,
        due_date: toLocalDateString(due) };
    });
  }

  private setDefaultCreditFirstDate(): void {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    this.creditFirstDate = toLocalDateString(date);
  }

  private loadStoreSettings(): void {
    this.store
      .select(fromAuth.selectStoreSettings)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings: any) => {
        if (settings?.pos?.default_payment_form) {
          this.defaultPaymentForm = settings.pos.default_payment_form;
          this.shippingPaymentForm = this.defaultPaymentForm;
        }
        this.showOnscreenKeypad = settings?.pos?.show_onscreen_keypad !== false;
      });
  }

  // --- Customer ---

  openCustomerSelector(): void {
    this.showCustomerSelector = true;
    this.showCreateCustomerForm = false;
  }

  closeCustomerSelector(): void {
    this.showCustomerSelector = false;
    this.showCreateCustomerForm = false;
    this.customerSearchResults = [];
  }

  navigateToShippingSettings(): void {
    this.onModalClosed();
    this.router.navigate(['/admin/settings/shipping']);
  }

  onCustomerSearch(query: string): void {
    this.customerSearchSubject.next(query);
  }

  private executeCustomerSearch(query: string): void {
    if (query && query.trim().length >= 2) {
      this.isSearchingCustomer = true;
      this.customerService
        .searchCustomers({ query: query.trim(), limit: 10 })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (response) => {
            this.customerSearchResults = response.data || [];
            this.isSearchingCustomer = false;
          },
          error: () => {
            this.customerSearchResults = [];
            this.isSearchingCustomer = false;
            this.toastService.show({
              variant: 'error',
              title: 'Error',
              description: 'Error al buscar clientes' });
          } });
    } else {
      this.customerSearchResults = [];
    }
  }

  async selectCustomer(customer: PosCustomer): Promise<void> {
    this.customerSelected.emit(customer);
    this.closeCustomerSelector();
    await this.applyCustomerAddress(customer);
  }

  private async applyCustomerAddress(customer: PosCustomer): Promise<void> {
    const shippingAddress = customer.addresses?.find(a => a.is_primary) || customer.addresses?.[0];
    if (shippingAddress) {
      this.addressForm.patchValue({
        address_line1: shippingAddress.address_line1 });
      this.selectedCustomerAddressId.set(shippingAddress.id);

      if (shippingAddress.state_province) {
        const dept = this.departments().find(d =>
          d.name.toLowerCase() === shippingAddress.state_province!.toLowerCase(),
        );
        if (dept) {
          this.selectedDepartmentId.set(dept.id);
          this.addressForm.patchValue({ state_province: dept.name });
          this.cities.set(await this.countryService.getCitiesByDepartment(dept.id));

          if (shippingAddress.city) {
            const city = this.cities().find(c =>
              c.name.toLowerCase() === shippingAddress.city!.toLowerCase(),
            );
            if (city) {
              this.selectedCityId.set(city.id);
              this.addressForm.patchValue({ city: city.name });
            }
          }
        } else {
          this.addressForm.patchValue({
            state_province: shippingAddress.state_province || '',
            city: shippingAddress.city || '' });
        }
      }

      if (this.selectedShippingMethod() && !this.manualCostOverride()) {
        this.calculateShippingCost();
      }
    } else {
      this.addressForm.reset();
      this.selectedCustomerAddressId.set(null);
      this.selectedDepartmentId.set(null);
      this.selectedCityId.set(null);
      this.cities.set([]);
    }
  }

  private async loadAddressesForCartCustomer(): Promise<void> {
    const customer = this.cartState()?.customer;
    if (!customer) return;
    if (this.departments().length === 0) {
      await this.loadDepartments();
    }
    if (customer.addresses && customer.addresses.length > 0) {
      await this.applyCustomerAddress(customer);
      return;
    }
    this.customerService
      .fetchCustomerById(customer.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((refreshed) => {
        if (refreshed) void this.applyCustomerAddress(refreshed);
      });
  }

  onCreateCustomer(): void {
    if (this.customerForm.valid) {
      const formValue = this.customerForm.value;
      this.isSearchingCustomer = true;

      this.customerService
        .createQuickCustomer({
          email: formValue.email,
          first_name: formValue.firstName,
          last_name: formValue.lastName,
          phone: formValue.phone || undefined })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (customer) => {
            this.isSearchingCustomer = false;
            this.customerSelected.emit(customer);
            this.closeCustomerSelector();
            this.toastService.success('Cliente creado correctamente');
          },
          error: (error) => {
            this.isSearchingCustomer = false;
            this.toastService.show({
              variant: 'error',
              title: 'Error',
              description: error.error?.message || error.message || 'Error al crear cliente' });
          } });
    } else {
      Object.keys(this.customerForm.controls).forEach((key) => {
        this.customerForm.get(key)?.markAsTouched();
      });
      this.toastService.info('Por favor completa los campos requeridos');
    }
  }

  // --- Validation & Confirm ---

  canConfirm(): boolean {
    const method = this.selectedShippingMethod();
    if (!method) return false;
    if (!this.cartState()?.customer) return false;
    if (!this.cartState()?.items?.length) return false;

    if (method.type !== 'pickup') {
      const addr = this.addressForm.value;
      if (!addr.address_line1 || !addr.city) return false;
    }

    // If pay_now, need a valid payment method
    if (this.paymentMode === 'pay_now') {
      if (!this.selectedPaymentMethod) return false;
      if (this.selectedPaymentMethod.type === 'cash' && this.isCashInsufficient) return false;
      if (this.selectedPaymentMethod.requiresReference) {
        const ref = this.referenceControl.value;
        if (!ref || ref.trim().length < 4) return false;
      }
    }

    return true;
  }

  private getFirstValidationError(): { section: 'shipping-method' | 'address' | 'customer' | 'payment'; message: string } | null {
    const method = this.selectedShippingMethod();
    if (!method) {
      return { section: 'shipping-method', message: 'Selecciona un método de envío' };
    }

    if (method.type !== 'pickup') {
      const addr = this.addressForm.value;
      if (!addr.address_line1 || !addr.city) {
        return { section: 'address', message: 'Completa la dirección de envío' };
      }
    }

    if (!this.cartState()?.customer) {
      return { section: 'customer', message: 'Selecciona un cliente' };
    }

    if (this.paymentMode === 'pay_now') {
      if (!this.selectedPaymentMethod) {
        return { section: 'payment', message: 'Selecciona un método de pago' };
      }
      if (this.selectedPaymentMethod.type === 'cash' && this.isCashInsufficient) {
        return { section: 'payment', message: 'El monto recibido es insuficiente' };
      }
      if (this.selectedPaymentMethod.requiresReference) {
        const ref = this.referenceControl.value;
        if (!ref || ref.trim().length < 4) {
          return { section: 'payment', message: 'Ingresa la referencia de pago' };
        }
      }
    }

    return null;
  }

  private flashValidationWarning(section: 'shipping-method' | 'address' | 'customer' | 'payment', message: string): void {
    // Turn off first to allow animation re-trigger (POP pattern)
    this.validationWarningSection = null;
    if (this.validationWarningTimeout) {
      clearTimeout(this.validationWarningTimeout);
    }

    setTimeout(() => {
      this.validationWarningSection = section;
      this.validationWarningMessage = message;

      // Expand collapsed payment sections when validation warns about payment
      if (section === 'payment') {
        this.paymentModeCollapsed = false;
        this.paymentMethodCollapsed = false;
      }

      // Scroll to the relevant section
      const sectionRef = this.getSectionRef(section);
      if (sectionRef) {
        sectionRef.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      this.validationWarningTimeout = setTimeout(() => {
        this.validationWarningSection = null;
        this.validationWarningMessage = '';
      }, 3000);
    }, 0);
  }

  private getSectionRef(section: string): ElementRef | undefined {
    const map: Record<string, ElementRef> = {
      'shipping-method': this.shippingMethodSection,
      'address': this.addressSection,
      'customer': this.customerSection,
      'payment': this.paymentSection };
    return map[section];
  }

  confirmShipping(): void {
    if (this.isProcessing) return;

    if (!this.canConfirm()) {
      const error = this.getFirstValidationError();
      if (error) {
        this.flashValidationWarning(error.section, error.message);
      }
      return;
    }

    const method = this.selectedShippingMethod();
    if (!this.cartState() || !method) return;

    this.isProcessing = true;

    const deliveryType =
      method.type === 'pickup' ? 'pickup' : 'home_delivery';

    const address = this.addressForm.value;
    const shippingAddress: PosShippingAddress = {
      address_line1: address.address_line1 || '',
      city: address.city || '',
      state_province: address.state_province || '',
      country_code: 'CO',
      recipient_name: this.customerDisplayName,
      recipient_phone: this.cartState()!.customer?.phone || '' };

    let paymentRequest: PaymentRequest | null = null;
    if (this.shippingPaymentForm === 'contado' && this.paymentMode === 'pay_now' && this.selectedPaymentMethod) {
      paymentRequest = {
        orderId: 'ORDER_' + Date.now(),
        amount: this.totalWithShipping,
        paymentMethod: this.selectedPaymentMethod,
        cashReceived: this.cashReceived,
        reference: this.referenceControl.value || '' };
    }

    // Build credit config if credit mode is selected
    const creditConfig = this.shippingPaymentForm === 'credito' ? {
      num_installments: this.creditNumInstallments,
      frequency: this.creditFrequency,
      first_installment_date: this.creditFirstDate,
      interest_rate: this.creditInterestRate,
      initial_payment: this.creditInitialPayment,
      initial_payment_method_id: this.creditInitialPaymentMethod
        ? parseInt(this.creditInitialPaymentMethod.id)
        : undefined } : undefined;

    const customerAddressId = this.selectedCustomerAddressId();
    if (!customerAddressId && address.address_line1 && address.city && this.cartState()!.customer) {
      this.createAddressThenProcessOrder(address, shippingAddress, deliveryType, paymentRequest, creditConfig);
    } else {
      this.processOrder(shippingAddress, deliveryType, paymentRequest, customerAddressId, creditConfig);
    }
  }

  private createAddressThenProcessOrder(
    address: any,
    shippingAddress: PosShippingAddress,
    deliveryType: string,
    paymentRequest: PaymentRequest | null,
    creditConfig?: any,
  ): void {
    const customer = this.cartState()!.customer!;
    const defaultCountryCode = this.countryService.getDefaultCountry();

    this.http.post<any>(`${environment.apiUrl}/store/addresses`, {
      customer_id: customer.id,
      address_line_1: address.address_line1,
      city: address.city,
      state: address.state_province || '',
      country: defaultCountryCode,
      type: 'shipping',
      is_primary: !customer.addresses?.length }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        const newAddressId = response?.data?.id || response?.id || null;
        this.processOrder(shippingAddress, deliveryType, paymentRequest, newAddressId, creditConfig);
      },
      error: () => {
        // Fallback: process order without address ID
        this.processOrder(shippingAddress, deliveryType, paymentRequest, null, creditConfig);
      } });
  }

  private processOrder(
    shippingAddress: PosShippingAddress,
    deliveryType: string,
    paymentRequest: PaymentRequest | null,
    addressId: number | null,
    creditConfig?: any,
  ): void {
    const address = this.addressForm.value;

    this.paymentService
      .processShippingSale(
        this.cartState()!,
        {
          shippingMethodId: this.selectedShippingMethod()!.id,
          shippingCost: this.shippingCost(),
          deliveryType,
          shippingAddress,
          deliveryNotes: address.delivery_notes || undefined,
          shippingAddressId: addressId },
        paymentRequest,
        'current_user',
        creditConfig,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.isProcessing = false;
          if (response.success) {
            this.shippingCompleted.emit({
              success: true,
              order: response.order,
              payment: response.payment,
              change: response.change,
              message: response.message,
              isShippingOrder: true });
            this.onModalClosed();
          } else {
            this.toastService.show({
              variant: 'error',
              title: 'Error',
              description: response.message || 'Error al procesar el envío' });
          }
        },
        error: (error) => {
          this.isProcessing = false;
          this.toastService.show({
            variant: 'error',
            title: 'Error',
            description: error.message || 'Error al procesar el envío' });
        } });
  }

  onModalClosed(): void {
    this.resetState();
    this.closed.emit();
  }
}
