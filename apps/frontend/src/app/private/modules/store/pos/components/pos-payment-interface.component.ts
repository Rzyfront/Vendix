import {
  Component,
  input,
  output,
  inject,
  effect,
  DestroyRef,
  signal,
  computed,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';

import {
  ModalComponent,
  IconComponent,
  SpinnerComponent,
  ButtonComponent,
  PaymentCollectorComponent,
} from '../../../../../shared/components';
import type {
  PaymentSubmit,
  CreditTerms,
  PaymentMode,
} from '../../../../../shared/components';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import {
  CurrencyFormatService,
  CurrencyPipe,
} from '../../../../../shared/pipes/currency';
import {
  PosPaymentService,
  PaymentMethod,
} from '../services/pos-payment.service';
import { PosRestaurantIntegrationService } from '../services/pos-restaurant-integration.service';
import { PosFulfillmentSelectorComponent, FulfillmentType } from './pos-fulfillment-selector.component';
import { PosCustomerSelectorComponent } from './pos-customer-selector/pos-customer-selector.component';
import { PosOpenTableModalComponent, } from './pos-open-table-modal.component';
import { OpenTableSessionResult } from '../services/pos-restaurant-integration.service';
import { PosWalletService, WalletInfo } from '../services/pos-wallet.service';
import {
  WompiService,
  WompiSubMethod,
  WompiPaymentStatusUpdate,
} from '../../../../../shared/services/wompi.service';
import { CartState } from '../models/cart.model';
import { PosCustomer } from '../models/customer.model';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import type { BusinessHours } from '../../../../../core/models/store-settings.interface';

interface PaymentState {
  isProcessing: boolean;
  isAnonymousSale: boolean;
}

@Component({
  selector: 'app-pos-payment-interface',
  standalone: true,
  imports: [
    ModalComponent,
    IconComponent,
    SpinnerComponent,
    ButtonComponent,
    CurrencyPipe,
    PosFulfillmentSelectorComponent,
    PosCustomerSelectorComponent,
    PosOpenTableModalComponent,
    PaymentCollectorComponent,
  ],
  templateUrl: './pos-payment-interface.component.html',
  styles: [
    `
      /* Content */
      .payment-content {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      /* Fulfillment selector (Restaurant stores with prepared items) */
      .fulfillment-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 12px;
        padding: 12px;
        border-radius: 12px;
        /* Acorde al modal: fondo sutil theme-aware (muted a 0.1) + borde
           sólido, en vez del slate saturado al 0.5 que se veía oscuro. */
        background: var(--color-muted);
        border: 1px solid var(--color-border);
      }

      .fulfillment-section-title {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 700;
        color: var(--color-text-primary);
      }

      .fulfillment-hint {
        display: flex;
        gap: 6px;
        align-items: center;
        font-size: 12px;
        color: rgb(194, 65, 12);
      }

      /* Bug 1 (Fase K): inline table picker CTA + selected table pill. */
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

      /* Section Styling */
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

      .section-icon {
        color: var(--color-primary);
      }

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

      .product-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      .tier-badge,
      .item-package-badge {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 1px 6px;
        font-size: 10px;
        font-weight: 700;
        line-height: 1.4;
      }

      .tier-badge {
        background: #fef3c7;
        color: #92400e;
      }

      .item-package-badge {
        background: #dbeafe;
        color: #1d4ed8;
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

      /* Summary Details */
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

      .summary-value.discount {
        color: var(--color-error);
      }

      /* Total */
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

      /* Payment Methods Grid */
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
        text-align: center;
        padding: 24px;
        color: var(--color-text-muted);
      }

      .no-methods p {
        font-size: 13px;
        margin: 8px 0;
      }

      .configure-link {
        background: none;
        border: none;
        color: var(--color-primary);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        text-decoration: underline;
      }

      /* Wallet Section */
      .wallet-section {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid var(--color-border);
      }

      /* Cash Section */
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

      .cash-input {
        display: flex;
        align-items: center;
        background: var(--color-background);
        border: 2px solid var(--color-border);
        border-radius: 10px;
        padding: 8px 12px;
        transition: border-color 0.2s;
      }

      .cash-input:focus-within {
        border-color: var(--color-primary);
      }

      .cash-input.error {
        border-color: var(--color-error);
        background: rgba(var(--color-error-rgb), 0.05);
      }

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

      .cash-input.error input {
        color: var(--color-error);
      }

      .error-text {
        display: block;
        font-size: 11px;
        color: var(--color-error);
        font-weight: 500;
        margin-top: 4px;
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

      .change-display span {
        font-size: 16px;
        font-weight: 700;
        color: var(--color-success);
      }

      .change-display app-icon {
        color: var(--color-success);
      }

      /* Quick Amounts */
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

      .quick-btn:hover {
        border-color: var(--color-primary);
      }

      .quick-btn.primary {
        border-color: var(--color-primary);
        background: rgba(var(--color-primary-rgb), 0.05);
      }

      .quick-btn .quick-value {
        color: var(--color-primary);
      }

      .quick-btn.primary app-icon {
        color: var(--color-primary);
      }

      /* Keypad */
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

      .keypad-btn:hover {
        background: var(--color-muted);
      }

      .keypad-btn:active {
        transform: scale(0.95);
      }

      .keypad-btn.clear {
        color: var(--color-error);
        border-color: rgba(var(--color-error-rgb), 0.3);
      }

      .keypad-btn.clear:hover {
        background: rgba(var(--color-error-rgb), 0.1);
      }

      /* Reference Section */
      .reference-section {
        margin-top: 16px;
        text-align: center;
      }

      .reference-header {
        margin-bottom: 16px;
      }

      .reference-header app-icon {
        color: var(--color-primary);
        margin-bottom: 8px;
      }

      .reference-header p {
        font-size: 13px;
        color: var(--color-text-secondary);
        margin: 0;
      }

      /* Sale Type Options */
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

      /* Customer-selector styles (search/create/summary) ahora viven en
         pos-customer-selector.component.scss. Aquí solo conservamos las
         clases compartidas por otras secciones del modal. */

      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      /* Footer */
      .payment-footer {
        display: flex;
        flex-direction: column;
        gap: 12px;
        width: 100%;
      }

      .footer-row {
        display: flex;
        gap: 12px;
      }

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

      .btn-cancel-payment:hover:not(:disabled) {
        background: rgba(var(--color-error-rgb), 0.05);
      }

      .btn-cancel-payment:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-draft {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px;
        border: 1px solid var(--color-primary);
        border-radius: 12px;
        background: transparent;
        color: var(--color-primary);
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
      }

      .btn-draft:hover:not(:disabled) {
        background: rgba(var(--color-primary-rgb), 0.05);
      }

      .btn-draft:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

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

      .btn-confirm:hover:not(:disabled) {
        filter: brightness(1.05);
        transform: translateY(-1px);
      }

      .btn-confirm:active:not(:disabled) {
        transform: scale(0.98);
      }

      .btn-confirm:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        box-shadow: none;
      }

      .spinner {
        width: 20px;
        height: 20px;
        border: 2px solid white;
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      /* Credit Configuration */
      .credit-config {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .credit-warning {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px;
        background: rgba(var(--color-warning-rgb), 0.1);
        border: 1px solid rgba(var(--color-warning-rgb), 0.3);
        border-radius: 10px;
        font-size: 13px;
        color: var(--color-warning);
        font-weight: 500;
      }

      .credit-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .credit-field label {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--color-text-muted);
      }

      .credit-field input,
      .credit-field select {
        padding: 10px 12px;
        border: 2px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-background);
        font-size: 14px;
        color: var(--color-text-primary);
        outline: none;
        transition: border-color 0.2s;
      }

      .credit-field input:focus,
      .credit-field select:focus {
        border-color: var(--color-primary);
      }

      .credit-field .hint {
        font-size: 11px;
        color: var(--color-text-muted);
      }

      .frequency-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }

      .frequency-btn {
        padding: 10px 8px;
        border: 2px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-surface);
        font-size: 12px;
        font-weight: 600;
        color: var(--color-text-primary);
        cursor: pointer;
        transition: all 0.2s;
        text-align: center;
      }

      .frequency-btn:hover {
        border-color: var(--color-primary);
      }

      .frequency-btn.selected {
        border-color: var(--color-primary);
        background: rgba(var(--color-primary-rgb), 0.05);
        color: var(--color-primary);
      }

      .credit-balance {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(var(--color-muted-rgb, 128, 128, 128), 0.15);
        border-radius: 12px;
        padding: 12px 16px;
      }

      .credit-balance span:first-child {
        font-size: 13px;
        color: var(--color-text-secondary);
        font-weight: 500;
      }

      .credit-balance span:last-child {
        font-size: 16px;
        font-weight: 700;
        color: var(--color-text-primary);
      }

      .installments-preview {
        max-height: 192px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .installment-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-radius: 8px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
      }

      .installment-left {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .installment-number {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: rgba(var(--color-primary-rgb), 0.1);
        color: var(--color-primary);
        font-size: 11px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .installment-date {
        font-size: 12px;
        color: var(--color-text-secondary);
      }

      .installment-amount {
        font-size: 13px;
        font-weight: 700;
        color: var(--color-text-primary);
      }

      .payment-methods-grid.mini {
        grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
        gap: 8px;
      }

      .payment-method-btn.mini {
        padding: 10px 8px;
      }

      .payment-method-btn.mini .method-name {
        font-size: 10px;
        margin-top: 4px;
      }

      /* Tab Headers */
      .tab-headers {
        display: flex;
        gap: 4px;
        background: var(--color-background);
        border-radius: 10px;
        padding: 4px;
        margin-bottom: 16px;
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
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: all 0.2s;
      }

      .tab-btn:hover {
        color: var(--color-text-primary);
      }

      .tab-btn.active {
        background: var(--color-surface);
        color: var(--color-primary);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      }

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

      .tab-content {
        margin-top: 8px;
      }

      /* Desktop: 3-column horizontal layout */
      @media (min-width: 1024px) {
        .payment-content {
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

        .product-list {
          max-height: none;
        }

        .search-results {
          max-height: 200px;
        }
      }

      /* Responsive */
      @media (max-width: 480px) {
        .payment-content {
          gap: 12px;
        }

        .payment-section {
          padding: 14px;
        }

        .total-amount {
          font-size: 22px;
        }

        .keypad-btn {
          padding: 12px;
          font-size: 16px;
        }

        .btn-confirm {
          padding: 14px;
          font-size: 15px;
        }
      }

      /* ─── Wompi ──────────────────────────────────── */
      .wompi-section {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid var(--color-border);
      }

      .section-label {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--color-text-muted);
        margin: 0 0 8px 0;
      }

      .wompi-submethods-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
        margin-top: 8px;
      }

      .wompi-submethod-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 16px 8px;
        border: 2px solid var(--color-border);
        border-radius: 12px;
        background: var(--color-surface);
        cursor: pointer;
        transition: all 0.2s;
        min-height: 80px;
        color: var(--color-text-primary);
      }

      .wompi-submethod-btn:hover {
        border-color: var(--wompi-color, var(--color-primary));
        background: color-mix(
          in srgb,
          var(--wompi-color, var(--color-primary)) 8%,
          transparent
        );
      }

      .wompi-submethod-btn .submethod-label {
        font-weight: 600;
        font-size: 14px;
      }

      .wompi-submethod-btn .submethod-desc {
        font-size: 12px;
        color: var(--color-text-muted);
        text-align: center;
      }

      .wompi-form {
        margin-top: 12px;
      }

      .wompi-form-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px;
        border-left: 3px solid;
        background: var(--color-muted);
        border-radius: 8px;
        margin-bottom: 12px;
        font-weight: 600;
        font-size: 14px;
        color: var(--color-text-primary);
      }

      .wompi-back-btn {
        margin-left: auto;
        background: none;
        border: none;
        cursor: pointer;
        opacity: 0.6;
        color: var(--color-text-muted);
        padding: 4px;
      }

      .wompi-back-btn:hover {
        opacity: 1;
      }

      .wompi-form-fields {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .wompi-form-fields .form-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .wompi-form-fields .form-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--color-text-muted);
        text-transform: uppercase;
      }

      .wompi-info-text {
        font-size: 14px;
        color: var(--color-text-secondary);
        padding: 8px 0;
        margin: 0;
      }

      .toggle-buttons {
        display: flex;
        gap: 8px;
      }

      .toggle-buttons button {
        flex: 1;
        padding: 8px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-surface);
        cursor: pointer;
        font-size: 14px;
        color: var(--color-text-primary);
        transition: all 0.2s;
      }

      .toggle-buttons button.active {
        background: var(--color-primary);
        color: white;
        border-color: var(--color-primary);
      }

      .field-error {
        font-size: 12px;
        color: var(--color-error);
        margin-top: 4px;
        display: block;
      }

      .wompi-awaiting {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;
        padding: 32px;
        text-align: center;
        min-height: 192px;
        margin-top: 16px;
        border-top: 1px solid var(--color-border);
      }

      .awaiting-message {
        font-size: 15px;
        color: var(--color-text-primary);
        max-width: 320px;
        margin: 0;
      }

      .awaiting-attempts {
        font-size: 12px;
        color: var(--color-text-secondary);
        max-width: 320px;
        margin: 0;
      }

      .awaiting-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 12px;
        margin-top: 8px;
      }
    `,
  ],
})
export class PosPaymentInterfaceComponent {
  private destroyRef = inject(DestroyRef);
  readonly isOpen = input<boolean>(false);
  readonly cartState = input<CartState | null>(null);
  /** Restaurant stores that have at least one `prepared` line in the cart. */
  readonly isRestaurantWithPrepared = input<boolean>(false);
  readonly closed = output<void>();
  readonly paymentCompleted = output<any>();
  readonly requestCustomer = output<void>();
  readonly requestRegisterConfig = output<void>();
  readonly draftSaved = output<any>();
  readonly customerSelected = output<PosCustomer>();
  /** Bug 1 (Fase K): emitted when the inline picker opens a session. */
  readonly tableSessionOpened = output<OpenTableSessionResult>();

  /** Panel inline de selección de cliente (buscar/crear). Se resetea al cerrar el modal. */
  private readonly customerSelector = viewChild(PosCustomerSelectorComponent);

  paymentMethods = signal<PaymentMethod[]>([]);
  /** Fulfillment type selected for this payment. Defaults to 'entrega' so
   *  retail stores (and restaurants without prepared items) keep the legacy
   *  UX untouched. Restaurant stores must explicitly choose 'consumo' when
   *  the table is open; the parent (POS) is responsible for picking up the
   *  value via `paymentCompleted.emit({ ..., fulfillment, tableId })`.
   */
  fulfillment = signal<FulfillmentType>('entrega');
  readonly tableId = input<number | null>(null);
  /** Bug 1 (Fase K): local mirror of the picked table id so the modal
   *  can unblock canProcessPayment even when the parent POS hasn't yet
   *  persisted a currentTableSession. Emitted up via sessionOpened. */
  readonly pickedTableId = signal<number | null>(null);
  /** Bug 1 (Fase K): mirror of the opened table_session id so the POS
   *  payment payload can include `table_session_id` and the backend
   *  closes out the table's existing draft order instead of creating
   *  a brand-new one. */
  readonly pickedSessionId = signal<number | null>(null);
  /** Bug 1 (Fase K): toggles the inline PosOpenTableModalComponent. */
  readonly openTablePicker = signal(false);

  /**
   * Fase 4: the headless payment collector owns the collection UI/state
   * (method grid, cash/keypad, reference, Wompi sub-methods, credit terms).
   * We read its public signals for the footer button and drive it via
   * `triggerSubmit()`. `protected` so the template can access it.
   */
  protected readonly collector = viewChild(PaymentCollectorComponent);

  paymentState = signal<PaymentState>({
    isProcessing: false,
    isAnonymousSale: false,
  });

  // Wallet — the full WalletInfo is kept locally so we can forward `wallet_id`
  // to the payment request; the collector only needs the available balance.
  walletInfo = signal<WalletInfo | null>(null);

  // Wompi POST-submit polling state. The collector only RECOLECTA the
  // sub-method + payload PRE-submit; the async confirmation loop lives here.
  wompiService = inject(WompiService);
  /** Sub-method captured at submit time so the awaiting message can vary. */
  private readonly submittedWompiSubMethod = signal<WompiSubMethod | null>(null);
  wompiAwaitingPayment = signal(false);
  wompiAwaitingMessage = signal('');
  wompiPollingSubscription: Subscription | null = null;
  wompiPaymentId: string | null = null;
  // DB primary key of the local `payments` row (NOT the Wompi transaction id).
  // Captured from the POS payment-creation response and used by the
  // confirm-wompi-payment polling endpoint.
  wompiPaymentDbId: number | null = null;
  wompiPollingState = signal<{
    active: boolean;
    attempts: number;
    maxAttempts: number;
  }>({ active: false, attempts: 0, maxAttempts: 60 });
  // setInterval handle for the active confirm-wompi-payment poll loop
  private wompiConfirmIntervalId: ReturnType<typeof setInterval> | null = null;

  // Store settings (reactive via StoreSettingsFacade)
  private settingsFacade = inject(StoreSettingsFacade);

  readonly allowAnonymousSales = computed(
    () => this.settingsFacade.pos()?.allow_anonymous_sales ?? false,
  );
  readonly anonymousSalesAsDefault = computed(
    () => this.settingsFacade.pos()?.anonymous_sales_as_default ?? false,
  );
  readonly cashRegisterEnabled = computed(
    () => this.settingsFacade.pos()?.cash_register?.enabled ?? false,
  );
  readonly autoCreateDefaultRegister = computed(
    () => this.settingsFacade.pos()?.cash_register?.auto_create_default_register ?? false,
  );
  readonly enableScheduleValidation = computed(
    () => this.settingsFacade.pos()?.enable_schedule_validation ?? false,
  );
  readonly showOnscreenKeypad = computed(
    () => this.settingsFacade.pos()?.show_onscreen_keypad !== false,
  );
  /**
   * Legacy `settings.pos.default_payment_form` ('contado' | 'credito', default
   * 'contado'). Seeds the collector's `initialMode` so a store configured to
   * start in credit opens the payment modal already on the Crédito tab.
   * `PosSettings` doesn't type this key, so we read it defensively.
   */
  readonly defaultPaymentForm = computed<PaymentMode>(() => {
    const form = (this.settingsFacade.pos() as { default_payment_form?: string } | null)
      ?.default_payment_form;
    return form === 'credito' ? 'credito' : 'contado';
  });
  readonly businessHours = computed<Record<string, BusinessHours>>(
    () => (this.settingsFacade.pos()?.business_hours as any) ?? {},
  );

  // User-session preserved selection (overrides anonymousSalesAsDefault when user toggles)
  readonly userOverrideAnonymous = signal<boolean | null>(null);

  // ── Collector input adapters ──────────────────────────────────────────────
  /** Customer shape the collector expects (id only). */
  readonly collectorCustomer = computed<{ id: number | string } | null>(() => {
    const c = this.cartState()?.customer;
    return c ? { id: c.id } : null;
  });
  /** Wallet balance forwarded to the collector (available balance). */
  readonly collectorWalletInfo = computed<{ balance: number } | null>(() => {
    const w = this.walletInfo();
    return w ? { balance: w.available } : null;
  });

  get customerDisplayName(): string {
    if (!this.cartState()?.customer) {
      return 'Seleccionar cliente';
    }
    const firstName = this.cartState()!.customer?.first_name || '';
    const lastName = this.cartState()!.customer?.last_name || '';
    return `${firstName} ${lastName}`.trim() || 'Cliente sin nombre';
  }

  /**
   * Bug 1 (Fase K): when the cashier switches back to 'entrega', clear
   * any picked table id so the next click on 'consumo' reopens the
   * picker from scratch.
   */
  onFulfillmentChange(next: FulfillmentType): void {
    this.fulfillment.set(next);
    if (next !== 'consumo') {
      this.pickedTableId.set(null);
    }
  }

  /**
   * Bug 1 (Fase K): a session was opened from the inline picker —
   * mirror the table id locally so canProcessPayment unblocks, and
   * bubble the result up so the parent POS can sync its own state.
   */
  onTableSessionPicked(result: OpenTableSessionResult): void {
    this.openTablePicker.set(false);
    const session = result?.session ?? result;
    const tableId = session?.table_id ?? null;
    const sessionId = (session as any)?.id ?? null;
    this.pickedTableId.set(tableId);
    this.pickedSessionId.set(sessionId);
    this.tableSessionOpened.emit(result);
  }

  private paymentService = inject(PosPaymentService);
private restaurantIntegration = inject(PosRestaurantIntegrationService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  private currencyService = inject(CurrencyFormatService);
  private walletService = inject(PosWalletService);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.wompiPollingSubscription?.unsubscribe();
      this.stopWompiConfirmPolling();
    });

    this.loadPaymentMethods();
    // Asegurar que la moneda esté cargada para la interfaz de pago (pipe | currency)
    this.currencyService.loadCurrency();

    // Reactive sync: when settings change in NgRx, propagate to paymentState.
    // Anonymous flag derives from facade unless user explicitly overrode it.
    effect(() => {
      const allow = this.allowAnonymousSales();
      const asDefault = this.anonymousSalesAsDefault();
      const override = this.userOverrideAnonymous();
      const effective = !allow ? false : (override ?? asDefault);
      this.paymentState.update((s) =>
        s.isAnonymousSale === effective ? s : { ...s, isAnonymousSale: effective },
      );
    });

    effect(() => {
      // When modal opens, sync anonymous sale state with current settings
      if (this.isOpen() === true) {
        this.syncAnonymousSaleState();
      }
    });

    // Credit sales cannot be anonymous: when the collector enters credito mode,
    // clear the anonymous flag so the customer selector is shown (mirrors the
    // legacy setPaymentForm('credito') behaviour).
    effect(() => {
      if (
        this.collector()?.mode() === 'credito' &&
        this.paymentState().isAnonymousSale
      ) {
        this.paymentState.update((s) => ({ ...s, isAnonymousSale: false }));
      }
    });
  }

  private syncAnonymousSaleState(): void {
    if (!this.allowAnonymousSales()) {
      this.paymentState.update((s) => ({ ...s, isAnonymousSale: false }));
      return;
    }
    const override = this.userOverrideAnonymous();
    const next = override ?? this.anonymousSalesAsDefault();
    this.paymentState.update((s) => ({ ...s, isAnonymousSale: next }));
  }

  private loadPaymentMethods(): void {
    this.paymentService
      .getPaymentMethods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((methods) => {
        this.paymentMethods.set(methods);
      });
  }

  private isWithinBusinessHours(): boolean {
    // If schedule validation is disabled, always allow
    if (!this.enableScheduleValidation()) {
      return true;
    }

    const now = new Date();
    const dayNames = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];
    const currentDayName = dayNames[now.getDay()];

    const todayHours = this.businessHours()?.[currentDayName];

    if (!todayHours) {
      return true;
    }

    const currentTime = now.getHours() * 60 + now.getMinutes();

    // Custom mode: multiple blocks
    if (todayHours.blocks && todayHours.blocks.length > 0) {
      for (const block of todayHours.blocks) {
        if (block.open === 'closed' || block.close === 'closed') continue;
        const [oH, oM] = block.open.split(':').map(Number);
        const [cH, cM] = block.close.split(':').map(Number);
        if (currentTime >= oH * 60 + oM && currentTime <= cH * 60 + cM) return true;
      }
      return false;
    }

    // Continuous mode
    if (todayHours.open === 'closed' || todayHours.close === 'closed') {
      return false;
    }

    const [openHour, openMinute] = todayHours.open.split(':').map(Number);
    const [closeHour, closeMinute] = todayHours.close.split(':').map(Number);

    const openTime = openHour * 60 + openMinute;
    const closeTime = closeHour * 60 + closeMinute;

    return currentTime >= openTime && currentTime <= closeTime;
  }

  /**
   * Wallet lookup driven by the collector's `(walletLookup)` output. Resolves
   * the customer's wallet via {@link PosWalletService} and feeds the balance
   * back to the collector through `[walletInfo]`. The full `WalletInfo` is kept
   * locally so the payment request can carry `wallet_id`.
   */
  onWalletLookup(e: { id: number | string }): void {
    this.walletInfo.set(null);
    this.walletService
      .getCustomerWallet(Number(e.id))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (wallet) => {
          this.walletInfo.set(wallet);
          if (!wallet || wallet.available <= 0) {
            this.toastService.warning(
              'El cliente no tiene saldo disponible en su wallet',
            );
          }
        },
        error: () => {
          this.walletInfo.set(null);
          this.toastService.error('Error al consultar wallet del cliente');
        },
      });
  }

  /** Restaurant + prepared 'consumo' still requires an open table. The
   *  collector is table-unaware, so this gate stays in the host (footer). */
  readonly restaurantConsumoNeedsTable = computed<boolean>(
    () =>
      this.isRestaurantWithPrepared() &&
      this.fulfillment() === 'consumo' &&
      (this.tableId() ?? this.pickedTableId()) == null,
  );

  /**
   * Handles the collector's `(submit)` output. The collector only RECOLECTA
   * the normalized {@link PaymentSubmit}; all POS orchestration (customer /
   * register / business-hours gates, request building, service call, Wompi
   * async handling) lives here.
   */
  onCollectorSubmit(submit: PaymentSubmit): void {
    if (!this.cartState()) return;

    // Restaurant + prepared: 'consumo' requires an open table (mirrors the
    // legacy canProcessPayment gate; the collector is unaware of tables).
    if (this.restaurantConsumoNeedsTable()) return;

    // Credito plan creation (POS creates the plan; installmentId is unused here).
    if (submit.mode === 'credito') {
      this.runCreditSale(submit.credit ?? null);
      return;
    }

    // ── Contado (cash / card / transfer / wompi / wallet) ──
    const method = submit.method;

    // Non-anonymous sales require a customer (defensive — the collector already
    // gates this via requireCustomer).
    if (!this.paymentState().isAnonymousSale && !this.cartState()!.customer) {
      this.toastService.info('Seleccione un cliente para continuar');
      this.requestCustomer.emit();
      this.onModalClosed();
      return;
    }

    let register_id = localStorage.getItem('pos_register_id');
    if (!register_id && (!this.cashRegisterEnabled() || this.autoCreateDefaultRegister())) {
      register_id = 'DEFAULT-POS';
      localStorage.setItem('pos_register_id', register_id);
    }
    if (!register_id) {
      this.toastService.info('Configure la caja para continuar');
      this.requestRegisterConfig.emit();
      this.onModalClosed();
      return;
    }

    if (!this.isWithinBusinessHours()) {
      const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const today = dayNames[new Date().getDay()];
      this.toastService.show({
        variant: 'error',
        title: 'Fuera del horario de atención',
        description: `El POS está cerrado. Hoy ${today} no se permite realizar ventas fuera del horario configurado.`,
      });
      return;
    }

    this.paymentState.update((s) => ({ ...s, isProcessing: true }));

    const isWompi = method.type === 'wompi';
    // Capture the sub-method so the POST-submit awaiting UI can vary its message.
    this.submittedWompiSubMethod.set(submit.wompi?.subMethod ?? null);

    const payment_request: any = {
      orderId: 'ORDER_' + Date.now(),
      amount: this.cartState()!.summary.total,
      paymentMethod: method,
      cashReceived: submit.amountReceived,
      reference: submit.reference,
      isAnonymousSale: this.paymentState().isAnonymousSale,
    };

    // Wallet metadata (wallet_id kept locally from the walletLookup response).
    if (method.type === 'wallet' && this.walletInfo()) {
      payment_request.metadata = { walletId: this.walletInfo()?.wallet_id };
    }
    // Wompi sub-method payload collected pre-submit by the collector.
    if (isWompi && submit.wompi) {
      payment_request.metadata = {
        ...payment_request.metadata,
        wompiPaymentMethod: submit.wompi.payload,
      };
    }

    this.paymentService
      .processSaleWithPayment(
        this.cartState()!,
        payment_request,
        'current_user',
        // Bug 1 / Obj 4 (Fase K): forward the inline-picked table session id so
        // the backend closes out its existing draft order.
        this.pickedSessionId() ?? null,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success) {
            // Wompi async flows (redirect, await, 3ds): keep the modal open and
            // hand off to the POST-submit polling loop that lives here.
            if (isWompi && response.nextAction && response.nextAction.type !== 'none') {
              this.handleWompiNextAction(response);
              return;
            }

            this.paymentState.update((s) => ({ ...s, isProcessing: false }));
            this.paymentCompleted.emit({
              success: true,
              order: response.order,
              payment: response.payment,
              change: response.change,
              message: response.message,
              isAnonymousSale: this.paymentState().isAnonymousSale,
              fulfillment: this.fulfillment(),
              tableId: this.tableId() ?? this.pickedTableId(),
            });
            this.onModalClosed();
          } else {
            this.paymentState.update((s) => ({ ...s, isProcessing: false }));
            console.error('Payment failed:', response.message);
            this.toastService.show({
              variant: 'error',
              title: 'Error',
              description: response.message || 'Error al procesar el pago',
            });
          }
        },
        error: (error) => {
          this.paymentState.update((s) => ({ ...s, isProcessing: false }));
          console.error('Payment error:', error);
          this.toastService.show({
            variant: 'error',
            title: 'Error',
            description: error.message || 'Error de conexión al procesar el pago',
          });
        },
      });
  }

  /**
   * Creates a credit sale from the collector's {@link CreditTerms}. Routes by
   * `terms.type`:
   *  - `'free'` → fiado libre (open debt, no schedule) via
   *    {@link PosPaymentService.processCreditSale} (no credit config).
   *  - `'installments'` (default) → financed plan via
   *    {@link PosPaymentService.processCreditSaleWithTerms}.
   * All gates (customer, cash register, business hours) and the
   * `paymentCompleted` emission are preserved for both paths.
   */
  private runCreditSale(terms: CreditTerms | null): void {
    if (!this.cartState() || !this.cartState()!.customer) {
      this.toastService.info('Seleccione un cliente para continuar');
      return;
    }
    if (!terms) return; // collector gates this; defensive.

    let register_id = localStorage.getItem('pos_register_id');
    if (!register_id && (!this.cashRegisterEnabled() || this.autoCreateDefaultRegister())) {
      register_id = 'DEFAULT-POS';
      localStorage.setItem('pos_register_id', register_id);
    }

    if (!register_id) {
      this.toastService.info('Configure la caja para continuar');
      this.requestRegisterConfig.emit();
      this.onModalClosed();
      return;
    }

    if (!this.isWithinBusinessHours()) {
      const dayNames = [
        'Domingo',
        'Lunes',
        'Martes',
        'Miércoles',
        'Jueves',
        'Viernes',
        'Sábado',
      ];
      const today = dayNames[new Date().getDay()];
      this.toastService.show({
        variant: 'error',
        title: 'Fuera del horario de atención',
        description: `El POS está cerrado. Hoy ${today} no se permite realizar ventas fuera del horario configurado.`,
      });
      return;
    }

    this.paymentState.update(s => ({ ...s, isProcessing: true }));

    // Route by credit shape (restored legacy behaviour):
    //  - 'free'  → fiado libre: open debt, no cuota schedule → processCreditSale
    //             (SIN config).
    //  - 'installments' (default) → financed plan → processCreditSaleWithTerms.
    const request$ =
      terms.type === 'free'
        ? this.paymentService.processCreditSale(this.cartState()!, 'current_user')
        : this.paymentService.processCreditSaleWithTerms(
            this.cartState()!,
            {
              num_installments: terms.numInstallments,
              frequency: terms.frequency,
              first_installment_date: terms.firstInstallmentDate,
              interest_rate: terms.interestRate,
              interest_type: terms.interestType,
              initial_payment: terms.initialPayment,
              initial_payment_method_id: terms.initialPaymentMethodId,
            },
            'current_user',
            'installments',
          );

    request$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.paymentState.update(s => ({ ...s, isProcessing: false }));
          if (response.success) {
            this.paymentCompleted.emit({
              success: true,
              order: response.order,
              message: response.message,
              isCreditSale: true,
            
              fulfillment: this.fulfillment(),
              tableId: this.tableId() ?? this.pickedTableId(),
            });
            this.onModalClosed();
          } else {
            this.toastService.show({
              variant: 'error',
              title: 'Error',
              description:
                response.message || 'Error al procesar la venta a crédito',
            });
          }
        },
        error: (error) => {
          this.paymentState.update(s => ({ ...s, isProcessing: false }));
          this.toastService.show({
            variant: 'error',
            title: 'Error',
            description:
              error.message || 'Error al procesar la venta a crédito',
          });
        },
      });
  }

  saveAsDraft(): void {
    if (!this.cartState()) return;

    if (!this.cartState()!.customer) {
      this.toastService.show({
        variant: 'error',
        title: 'Cliente Requerido',
        description: 'Debe seleccionar un cliente para guardar el borrador',
      });
      return;
    }

    this.paymentState.update(s => ({ ...s, isProcessing: true }));

    this.paymentService
      .saveDraft(this.cartState()!, 'current_user')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.paymentState.update(s => ({ ...s, isProcessing: false }));
          if (response.success) {
            this.draftSaved.emit({
              success: true,
              order: response.order,
              message: response.message,
            });
            this.onModalClosed();
          }
        },
        error: (error) => {
          this.paymentState.update(s => ({ ...s, isProcessing: false }));
          console.error('Save draft error:', error);
          this.toastService.show({
            variant: 'error',
            title: 'Error',
            description: error.message || 'Error al guardar el borrador',
          });
        },
      });
  }

  onModalClosed(): void {
    // The collector owns all collection state (method / cash / reference /
    // Wompi sub-method / credit terms) and is destroyed+recreated by the
    // modal's internal `@if(isOpen())`, so it self-resets on close/reopen.
    // Here we only reset the host-owned orchestration state.
    this.paymentState.set({
      isProcessing: false,
      isAnonymousSale: false,
    });
    this.customerSelector()?.reset();
    // Reset the Wompi POST-submit polling state.
    this.resetWompiState();
    this.closed.emit();
  }

  // Anonymous Sale Toggle
  toggleAnonymousSale(enabled: boolean): void {
    // Capture the user's deliberate choice so reactive sync from settings
    // does not overwrite it during the same session.
    this.userOverrideAnonymous.set(enabled);
    this.paymentState.update(s => ({ ...s, isAnonymousSale: enabled }));
    // El panel <app-pos-customer-selector> gestiona su propia vista
    // (overview/search/create); no hace falta forzarla desde aquí.
  }

  // Credit-plan math + method selection now live entirely inside the shared
  // collector's `app-payment-credit-fields`; the host only forwards the
  // resulting `CreditTerms` to `runCreditSale()`.

  // Customer Management Methods
  //
  // Buscar/crear cliente vive ahora en <app-pos-customer-selector> (panel
  // inline). El selector emite (customerSelected) cuando el usuario elige o
  // crea un cliente; aquí solo sincronizamos el estado del anfitrión y
  // re-emitimos al padre (pos.component → cartService.setCustomer), que es la
  // fuente de verdad del cliente en el carrito.

  /** Cliente elegido/creado en el selector inline. */
  selectCustomer(customer: PosCustomer): void {
    // Asegurar que la venta deje de ser anónima al asignar un cliente.
    this.userOverrideAnonymous.set(false);
    this.paymentState.update((s) => ({ ...s, isAnonymousSale: false }));
    // Re-emitir al padre para que actualice el carrito (fuente de verdad).
    this.customerSelected.emit(customer);
  }

  /** "Quitar cliente / venta anónima" desde el selector inline. */
  onCustomerCleared(): void {
    // Mismo contrato que el toggle "Venta Anónima": marca override de usuario
    // y pone el estado en anónimo.
    this.toggleAnonymousSale(true);
  }

  // ─── Wompi POST-submit polling ─────────────────────────────────────────
  // The pre-submit COLLECTION (method + sub-method + NEQUI/PSE payload) is now
  // owned by the collector's `app-payment-wompi-fields`; the host only drives
  // the async confirmation loop after the payment row is created.

  /**
   * Resets the Wompi POST-submit awaiting/polling state. Pre-submit collection
   * state (sub-method, NEQUI phone, PSE form) lives inside the collector and is
   * disposed with it, so nothing to reset here beyond the captured sub-method.
   */
  resetWompiState(): void {
    this.submittedWompiSubMethod.set(null);
    this.wompiAwaitingPayment.set(false);
    this.wompiAwaitingMessage.set('');
    this.wompiPollingSubscription?.unsubscribe();
    this.wompiPollingSubscription = null;
    this.wompiPaymentId = null;
    this.stopWompiConfirmPolling();
    this.wompiPaymentDbId = null;
    this.wompiPollingState.set({ active: false, attempts: 0, maxAttempts: 60 });
  }

  handleWompiNextAction(response: any): void {
    const nextAction = response?.nextAction || response?.data?.nextAction;
    if (!nextAction) return;

    this.wompiPaymentId =
      response?.payment?.transaction_id ||
      response?.transactionId ||
      response?.data?.payment?.transaction_id ||
      response?.data?.transactionId;

    // Capture the local DB payment id for the confirm-wompi-payment poll loop.
    // POS payment-creation always returns response.payment.id (numeric DB pk).
    const dbId =
      response?.payment?.id ??
      response?.data?.payment?.id ??
      null;
    this.wompiPaymentDbId = typeof dbId === 'number' ? dbId : null;

    switch (nextAction.type) {
      case 'redirect':
        if (nextAction.url) {
          const popup = window.open(nextAction.url, '_blank');
          if (!popup) {
            this.wompiAwaitingMessage.set('No se pudo abrir la ventana del banco. Por favor habilita las ventanas emergentes e intenta de nuevo.');
            this.wompiAwaitingPayment.set(true);
            return;
          }
        }
        this.wompiAwaitingPayment.set(true);
        this.wompiAwaitingMessage.set('Se abrió la página del banco. Completa el pago y regresa aquí.');
        this.startWompiPolling();
        break;
      case 'await':
        this.wompiAwaitingPayment.set(true);
        this.wompiAwaitingMessage.set(this.submittedWompiSubMethod() === WompiSubMethod.NEQUI
            ? 'Esperando confirmación en la app de Nequi...'
            : 'Esperando confirmación del pago...');
        this.startWompiPolling();
        break;
      case '3ds':
        if (nextAction.url) {
          const popup3ds = window.open(nextAction.url, '_blank');
          if (!popup3ds) {
            this.wompiAwaitingMessage.set('No se pudo abrir la ventana del banco. Por favor habilita las ventanas emergentes e intenta de nuevo.');
            this.wompiAwaitingPayment.set(true);
            return;
          }
        }
        this.wompiAwaitingPayment.set(true);
        this.wompiAwaitingMessage.set('Completa la verificación 3D Secure en la ventana abierta.');
        this.startWompiPolling();
        break;
      case 'none':
        // Payment completed or failed synchronously, handled by existing flow
        break;
    }
  }

  /**
   * Start polling the backend confirm-wompi-payment endpoint to drive the
   * POS UI to a terminal state. Interval = 5s, max 60 attempts (~5 min).
   *
   * The endpoint does the actual Wompi roundtrip on the backend and applies
   * the canonical state through the shared webhook handler — frontend just
   * needs to ask "what's the state now?" until it leaves `pending`.
   *
   * Idempotent: safe to call again from `manualVerifyPayment` while the
   * interval is running. Stops automatically on terminal state, error,
   * or after maxAttempts.
   */
  startWompiPolling(): void {
    if (!this.wompiPaymentDbId) {
      // Fallback: legacy gateway-id polling for old code paths that didn't
      // capture response.payment.id (defensive — should not happen for POS).
      if (this.wompiPaymentId) {
        this.legacyStartWompiPolling();
      }
      return;
    }

    // Reset counter and start interval
    this.stopWompiConfirmPolling();
    this.wompiPollingState.set({ active: true, attempts: 0, maxAttempts: 60 });

    // First poll immediately so we don't wait 5s on an already-final txn
    void this.runWompiConfirmPoll();

    this.wompiConfirmIntervalId = setInterval(() => {
      const current = this.wompiPollingState();
      if (!current.active) {
        this.stopWompiConfirmPolling();
        return;
      }
      if (current.attempts >= current.maxAttempts) {
        // Out of attempts — stop the loop but leave the awaiting UI up so
        // the cashier can still hit "Verificar pago ahora" or cancel.
        this.stopWompiConfirmPolling();
        this.toastService.show({
          variant: 'warning',
          title: 'Pago aún pendiente',
          description:
            'No recibimos confirmación del pago. Verifica manualmente o cancela la espera.',
        });
        return;
      }
      void this.runWompiConfirmPoll();
    }, 5000);
  }

  /**
   * Single poll iteration: calls the backend confirm endpoint and updates
   * UI state accordingly. Bumps the attempts counter on every call (success
   * or transient error) so the loop can self-terminate.
   */
  private async runWompiConfirmPoll(): Promise<void> {
    if (!this.wompiPaymentDbId) return;
    try {
      const result = await firstValueFrom(
        this.paymentService.confirmWompiPayment(this.wompiPaymentDbId),
      );

      this.wompiPollingState.update((s) => ({
        ...s,
        attempts: s.attempts + 1,
      }));

      const state = result?.state;
      if (state === 'succeeded' || state === 'captured') {
        this.stopWompiConfirmPolling();
        this.onWompiPaymentConfirmed(result);
      } else if (
        state === 'failed' ||
        state === 'cancelled' ||
        state === 'refunded'
      ) {
        this.stopWompiConfirmPolling();
        this.onWompiPaymentFailed(result);
      }
      // else: still pending — keep polling
    } catch (err) {
      // Network or backend error — count toward maxAttempts but don't bail
      // immediately. The user can still cancel manually.
      this.wompiPollingState.update((s) => ({
        ...s,
        attempts: s.attempts + 1,
      }));
      console.warn('Wompi confirm poll error', err);
    }
  }

  /**
   * Cashier-triggered immediate verification. Forces a single confirm call
   * outside the interval so the user doesn't have to wait up to 5s.
   */
  async manualVerifyPayment(): Promise<void> {
    if (!this.wompiPaymentDbId) {
      this.toastService.show({
        variant: 'warning',
        title: 'Sin información de pago',
        description: 'No hay un pago Wompi en curso para verificar.',
      });
      return;
    }
    try {
      const result = await firstValueFrom(
        this.paymentService.confirmWompiPayment(this.wompiPaymentDbId),
      );
      const state = result?.state;
      if (state === 'succeeded' || state === 'captured') {
        this.stopWompiConfirmPolling();
        this.onWompiPaymentConfirmed(result);
      } else if (
        state === 'failed' ||
        state === 'cancelled' ||
        state === 'refunded'
      ) {
        this.stopWompiConfirmPolling();
        this.onWompiPaymentFailed(result);
      } else {
        this.toastService.show({
          variant: 'info',
          title: 'Pago aún pendiente',
          description:
            result?.message ??
            'Wompi todavía no reporta confirmación. Intenta de nuevo en unos segundos.',
        });
      }
    } catch (err: any) {
      console.warn('Manual Wompi verify failed', err);
      this.toastService.show({
        variant: 'error',
        title: 'Error de verificación',
        description: 'No se pudo verificar el estado del pago.',
      });
    }
  }

  private onWompiPaymentConfirmed(result: { transactionId?: string | null }): void {
    this.wompiAwaitingPayment.set(false);
    this.wompiAwaitingMessage.set('');
    this.paymentState.update((s) => ({ ...s, isProcessing: false }));
    this.paymentCompleted.emit({
      success: true,
      message: 'Pago con Wompi procesado correctamente',
      transactionId: result?.transactionId,
      isAnonymousSale: this.paymentState().isAnonymousSale,
    
              fulfillment: this.fulfillment(),
              tableId: this.tableId() ?? this.pickedTableId(),
            });
    this.onModalClosed();
  }

  private onWompiPaymentFailed(result: { state: string; message?: string }): void {
    this.wompiAwaitingPayment.set(false);
    this.wompiAwaitingMessage.set(result?.message || 'El pago fue rechazado.');
    this.paymentState.update((s) => ({ ...s, isProcessing: false }));
    this.toastService.show({
      variant: 'error',
      title: 'Pago rechazado',
      description: result?.message || `El pago fue ${result?.state}.`,
    });
  }

  private stopWompiConfirmPolling(): void {
    if (this.wompiConfirmIntervalId !== null) {
      clearInterval(this.wompiConfirmIntervalId);
      this.wompiConfirmIntervalId = null;
    }
    this.wompiPollingState.update((s) => ({ ...s, active: false }));
  }

  /**
   * Legacy poll path — kept as a fallback for the unlikely case where the
   * POS payment-create response doesn't carry `payment.id`. Polls Wompi via
   * gateway transaction id (does NOT hit the confirm endpoint, so will not
   * apply state on the backend).
   */
  private legacyStartWompiPolling(): void {
    if (!this.wompiPaymentId) return;
    this.wompiPollingSubscription?.unsubscribe();
    this.wompiPollingSubscription = this.wompiService
      .pollPaymentStatus(this.wompiPaymentId)
      .subscribe({
        next: (update: WompiPaymentStatusUpdate) => {
          if (update.status === 'succeeded') {
            this.onWompiPaymentConfirmed({
              transactionId: update.transactionId,
            });
          } else if (
            update.status === 'failed' ||
            update.status === 'cancelled'
          ) {
            this.onWompiPaymentFailed({
              state: update.status,
              message: update.message,
            });
          }
        },
        error: () => {
          this.wompiAwaitingPayment.set(false);
          this.wompiAwaitingMessage.set('');
          this.paymentState.update((s) => ({ ...s, isProcessing: false }));
          this.toastService.show({
            variant: 'error',
            title: 'Error de verificación',
            description:
              'No se pudo verificar el estado del pago. Intenta de nuevo.',
          });
        },
      });
  }

  cancelWompiAwait(): void {
    this.wompiPollingSubscription?.unsubscribe();
    this.wompiPollingSubscription = null;
    this.stopWompiConfirmPolling();
    this.wompiAwaitingPayment.set(false);
    this.wompiAwaitingMessage.set('');
    this.paymentState.update(s => ({ ...s, isProcessing: false }));
  }

  navigateToSettings(): void {
    this.onModalClosed();
    this.router.navigate(['/admin/settings/payments']);
  }
}
