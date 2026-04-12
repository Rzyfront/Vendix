import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  ChangeDetectorRef,
  inject,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  FormControl,
  Validators,
  ReactiveFormsModule,
  FormsModule,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Subject, Subscription, takeUntil, debounceTime } from 'rxjs';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';

import {
  ModalComponent,
  InputComponent,
  IconComponent,
  SelectorComponent,
  SpinnerComponent,
  ButtonComponent,
} from '../../../../../shared/components';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import {
  CurrencyFormatService,
  CurrencyPipe,
} from '../../../../../shared/pipes/currency';
import { CurrencyInputDirective } from '../../../../../shared/directives/currency-input.directive';
import { toLocalDateString } from '../../../../../shared/utils/date.util';
import {
  PosPaymentService,
  PaymentMethod,
} from '../services/pos-payment.service';
import { PosCustomerService } from '../services/pos-customer.service';
import { PosWalletService, WalletInfo } from '../services/pos-wallet.service';
import {
  WompiService,
  WompiSubMethod,
  WompiSubMethodConfig,
  WompiPaymentStatusUpdate,
  PseFinancialInstitution,
} from '../../../../../shared/services/wompi.service';
import { CartState } from '../models/cart.model';
import { PosCustomer } from '../models/customer.model';
import * as fromAuth from '../../../../../core/store/auth';

interface PaymentState {
  selectedMethod: PaymentMethod | null;
  cashReceived: number;
  reference: string;
  isProcessing: boolean;
  change: number;
  isAnonymousSale: boolean;
  paymentForm: 'contado' | 'credito';
}

@Component({
  selector: 'app-pos-payment-interface',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    ModalComponent,
    InputComponent,
    IconComponent,
    SelectorComponent,
    SpinnerComponent,
    ButtonComponent,
    CurrencyPipe,
    CurrencyInputDirective,
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

      /* Selected Customer */
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

      /* Select Customer Button */
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

      /* Customer Selector */
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

      .no-results {
        text-align: center;
        padding: 16px;
      }

      .no-results p {
        font-size: 13px;
        color: var(--color-text-secondary);
        margin: 0 0 8px 0;
      }

      .no-results button {
        background: none;
        border: none;
        color: var(--color-primary);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
      }

      /* Create Customer Action - Always visible */
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

      /* Create Customer Form */
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
        box-shadow: 0 1px 3px rgba(0,0,0,0.08);
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
        background: color-mix(in srgb, var(--wompi-color, var(--color-primary)) 8%, transparent);
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

      .awaiting-actions {
        display: flex;
        gap: 12px;
        margin-top: 8px;
      }
    `,
  ],
})
export class PosPaymentInterfaceComponent
  implements OnInit, OnDestroy, OnChanges
{
  @Input() isOpen = false;
  @Input() cartState: CartState | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() paymentCompleted = new EventEmitter<any>();
  @Output() requestCustomer = new EventEmitter<void>();
  @Output() requestRegisterConfig = new EventEmitter<void>();
  @Output() draftSaved = new EventEmitter<any>();
  @Output() customerSelected = new EventEmitter<PosCustomer>();

  paymentMethods: PaymentMethod[] = [];
  paymentForm: FormGroup;
  paymentState: PaymentState = {
    selectedMethod: null,
    cashReceived: 0,
    reference: '',
    isProcessing: false,
    change: 0,
    isAnonymousSale: false,
    paymentForm: 'contado',
  };

  // Wallet
  walletInfo: WalletInfo | null = null;
  walletLoading: boolean = false;

  // Wompi state
  wompiService = inject(WompiService);
  selectedWompiSubMethod: WompiSubMethod | null = null;
  wompiSubMethods: WompiSubMethodConfig[] = WompiService.SUB_METHODS.filter(
    (m) => m.key !== WompiSubMethod.CARD,
  );
  wompiAwaitingPayment = false;
  wompiAwaitingMessage = '';
  wompiPollingSubscription: Subscription | null = null;
  wompiPaymentId: string | null = null;

  // Nequi form
  nequiPhoneControl = new FormControl('', [
    Validators.required,
    Validators.pattern(/^3\d{9}$/),
  ]);

  // PSE form
  pseForm = new FormGroup({
    userType: new FormControl<number>(0, [Validators.required]),
    userLegalIdType: new FormControl('CC', [Validators.required]),
    userLegalId: new FormControl('', [Validators.required]),
    financialInstitutionCode: new FormControl('', [Validators.required]),
    paymentDescription: new FormControl(''),
  });
  pseFinancialInstitutions: PseFinancialInstitution[] = [];
  pseBankOptions: { value: string; label: string }[] = [];

  // Store settings
  storeSettingsSubscription: any;
  allowAnonymousSales = false;
  anonymousSalesAsDefault = false;
  requireCashDrawerOpen = false;
  enableScheduleValidation = false;
  showOnscreenKeypad = true;
  paymentFormCollapsed = false;
  paymentMethodCollapsed = false;
  businessHours: Record<string, { open: string; close: string }> = {};
  defaultPaymentForm: 'contado' | 'credito' = 'contado';

  // Currency symbol (computed signal from CurrencyFormatService)
  currencySymbol: any;

  // Document type options for customer creation
  documentTypeOptions = [
    { value: 'dni', label: 'DNI' },
    { value: 'passport', label: 'Pasaporte' },
    { value: 'cedula', label: 'Cédula' },
    { value: 'other', label: 'Otro' },
  ];

  // Customer management within modal
  showCustomerSelector = false;
  customerSearchResults: PosCustomer[] = [];
  customerSearchQuery = '';
  isSearchingCustomer = false;
  showCreateCustomerForm = false;

  // Credit configuration state
  creditNumInstallments = 3;
  creditFrequency: 'weekly' | 'biweekly' | 'monthly' = 'monthly';
  creditFirstDate = '';
  creditInterestRate = 0;
  creditInitialPayment = 0;
  creditInitialPaymentMethod: PaymentMethod | null = null;
  creditType: 'installments' | 'free' = 'installments';
  creditInterestType: 'simple' | 'compound' = 'simple';

  creditTypeOptions = [
    { value: 'installments' as const, label: 'Con Cuotas' },
    { value: 'free' as const, label: 'Libre' },
  ];

  interestTypeOptions = [
    { value: 'simple' as const, label: 'Simple' },
    { value: 'compound' as const, label: 'Compuesto' },
  ];

  creditRemainingBalance = 0;
  creditInstallmentsPreview: { amount: number; due_date: string }[] = [];

  frequencyOptions = [
    { value: 'weekly' as const, label: 'Semanal' },
    { value: 'biweekly' as const, label: 'Quincenal' },
    { value: 'monthly' as const, label: 'Mensual' },
  ];

  customerForm: FormGroup;

  // quickCashAmounts = [10, 20, 50, 100]; // Removed as per new requirement

  private destroy$ = new Subject<void>();

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

  get customerDocumentTypeControl(): FormControl {
    return this.customerForm.get('documentType') as FormControl;
  }

  get customerDocumentNumberControl(): FormControl {
    return this.customerForm.get('documentNumber') as FormControl;
  }

  get customerDisplayName(): string {
    if (!this.cartState?.customer) {
      return 'Seleccionar cliente';
    }
    const firstName = this.cartState.customer.first_name || '';
    const lastName = this.cartState.customer.last_name || '';
    return `${firstName} ${lastName}`.trim() || 'Cliente sin nombre';
  }

  get customerEmail(): string {
    return this.cartState?.customer?.email || '';
  }

  constructor(
    private fb: FormBuilder,
    private paymentService: PosPaymentService,
    private customerService: PosCustomerService,
    private toastService: ToastService,
    private router: Router,
    private store: Store,
    private cdr: ChangeDetectorRef,
    private currencyService: CurrencyFormatService,
    private walletService: PosWalletService,
  ) {
    this.paymentForm = this.createPaymentForm();
    this.customerForm = this.createCustomerForm();
    // Exponer el símbolo de moneda para usar en el template
    this.currencySymbol = this.currencyService.currencySymbol;
  }

  ngOnInit(): void {
    this.loadPaymentMethods();
    this.setupFormListeners();
    this.loadStoreSettings();
    // Asegurar que la moneda esté cargada para la interfaz de pago
    this.currencyService.loadCurrency();
    this.setDefaultCreditFirstDate();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.wompiPollingSubscription?.unsubscribe();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // When modal opens, sync anonymous sale state with current settings
    if (changes['isOpen'] && changes['isOpen'].currentValue === true) {
      this.syncAnonymousSaleState();
    }
  }

  private syncAnonymousSaleState(): void {
    // If anonymous sales are not allowed, always disable
    if (!this.allowAnonymousSales) {
      this.paymentState.isAnonymousSale = false;
    } else {
      // Use the default setting from store settings
      this.paymentState.isAnonymousSale = this.anonymousSalesAsDefault;
    }
    this.cdr.markForCheck();
  }

  // Track if settings have been loaded at least once
  private settingsLoaded = false;

  private createPaymentForm(): FormGroup {
    return this.fb.group({
      cashReceived: [0, [Validators.required, Validators.min(0)]],
      reference: [''],
    });
  }

  private createCustomerForm(): FormGroup {
    return this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      firstName: ['', [Validators.required, Validators.minLength(2)]],
      lastName: ['', [Validators.required, Validators.minLength(2)]],
      phone: [''],
      documentType: [''],
      documentNumber: ['', [Validators.required]],
    });
  }

  private setupFormListeners(): void {
    this.cashReceivedControl.valueChanges
      .pipe(takeUntil(this.destroy$), debounceTime(100))
      .subscribe((value: string | number | null) => {
        if (value !== null && value !== undefined && value !== '') {
          this.paymentState.cashReceived = parseFloat(value.toString()) || 0;
          this.calculateChange();
        }
      });

    this.referenceControl.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe((value: string | null) => {
        this.paymentState.reference = value || '';
      });
  }

  private loadPaymentMethods(): void {
    this.paymentService
      .getPaymentMethods()
      .pipe(takeUntil(this.destroy$))
      .subscribe((methods) => {
        this.paymentMethods = methods;
      });
  }

  private isWithinBusinessHours(): boolean {
    // If schedule validation is disabled, always allow
    if (!this.enableScheduleValidation) {
      return true;
    }

    // Get current day and time in store timezone
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

    // Get business hours for current day
    const todayHours = this.businessHours?.[currentDayName];

    // If no hours configured for today, allow by default
    if (!todayHours) {
      return true;
    }

    // If day is marked as closed, don't allow sales
    if (todayHours.open === 'closed' || todayHours.close === 'closed') {
      return false;
    }

    // Parse current time to minutes for comparison
    const currentTime = now.getHours() * 60 + now.getMinutes();

    // Parse opening and closing times
    const [openHour, openMinute] = todayHours.open.split(':').map(Number);
    const [closeHour, closeMinute] = todayHours.close.split(':').map(Number);

    const openTime = openHour * 60 + openMinute;
    const closeTime = closeHour * 60 + closeMinute;

    // Check if current time is within business hours
    return currentTime >= openTime && currentTime <= closeTime;
  }

  private loadStoreSettings(): void {
    this.storeSettingsSubscription = this.store
      .select(fromAuth.selectStoreSettings)
      .pipe(takeUntil(this.destroy$))
      .subscribe((storeSettings: any) => {
        // store_settings has structure: { settings: { pos: { ... }, general: { ... }, ... } }
        const settings = storeSettings;
        if (settings?.pos) {
          const prevAllowAnonymous = this.allowAnonymousSales;

          this.allowAnonymousSales =
            settings.pos.allow_anonymous_sales || false;
          this.anonymousSalesAsDefault =
            settings.pos.anonymous_sales_as_default || false;
          this.requireCashDrawerOpen =
            settings.pos.require_cash_drawer_open || false;
          this.enableScheduleValidation =
            settings.pos.enable_schedule_validation || false;
          this.businessHours = settings.pos.business_hours || {};
          if (settings.pos.default_payment_form) {
            this.defaultPaymentForm = settings.pos.default_payment_form;
            if (!this.settingsLoaded) {
              this.paymentState.paymentForm = this.defaultPaymentForm;
            }
          }
          this.settingsLoaded = true;
          this.showOnscreenKeypad = settings.pos.show_onscreen_keypad !== false;

          // If anonymous sales are not allowed, always disable the toggle
          if (!this.allowAnonymousSales) {
            this.paymentState.isAnonymousSale = false;
          } else {
            // Only update if this is first load (prevAllowAnonymous is falsy)
            // or if we want to respect the default setting
            if (!prevAllowAnonymous || this.anonymousSalesAsDefault) {
              this.paymentState.isAnonymousSale = this.anonymousSalesAsDefault;
            }
            // Otherwise, preserve current user selection
          }

          // Trigger change detection to update UI
          this.cdr.markForCheck();
        }
      });
  }

  private setDefaultCreditFirstDate(): void {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    this.creditFirstDate = toLocalDateString(date);
  }

  selectPaymentMethod(method: PaymentMethod): void {
    // Reset Wompi state when changing payment method
    this.resetWompiState();

    // Wallet requires customer selection
    if (method.type === 'wallet') {
      if (!this.cartState?.customer) {
        this.toastService.info('Seleccione un cliente para pagar con Wallet');
        this.requestCustomer.emit();
        return;
      }
      // Load wallet balance
      this.walletLoading = true;
      this.walletInfo = null;
      this.walletService.getCustomerWallet(this.cartState.customer.id).subscribe({
        next: (wallet) => {
          this.walletInfo = wallet;
          this.walletLoading = false;
          if (!wallet || wallet.available <= 0) {
            this.toastService.warning('El cliente no tiene saldo disponible en su wallet');
          }
        },
        error: () => {
          this.walletInfo = null;
          this.walletLoading = false;
          this.toastService.error('Error al consultar wallet del cliente');
        },
      });
    } else {
      // Reset wallet info when switching to other method
      this.walletInfo = null;
      this.walletLoading = false;
    }

    this.paymentState.selectedMethod = method;
    this.paymentMethodCollapsed = true;
    this.paymentForm.reset();
    this.paymentState.change = 0;

    if (method.type === 'cash') {
      this.cashReceivedControl.setValue(this.cartState?.summary?.total || 0);
    }
  }

  togglePaymentFormCollapsed(): void {
    this.paymentFormCollapsed = !this.paymentFormCollapsed;
  }

  togglePaymentMethodCollapsed(): void {
    this.paymentMethodCollapsed = !this.paymentMethodCollapsed;
  }

  getPaymentMethodClasses(method: PaymentMethod): string {
    const base_classes = ['payment-method-card'];
    if (this.paymentState.selectedMethod?.id === method.id) {
      base_classes.push('selected');
    }
    return base_classes.join(' ');
  }

  setCashAmount(amount: number): void {
    this.cashReceivedControl.setValue(amount);
  }

  setFullAmount(): void {
    const total = this.cartState?.summary?.total || 0;
    this.setCashAmount(total);
  }

  setHalfAmount(): void {
    const total = this.cartState?.summary?.total || 0;
    this.setCashAmount(total / 2);
  }

  appendNumber(num: number): void {
    const current_value = this.cashReceivedControl.value || 0;
    // If current value is 0, replace it, otherwise append (handling string vs number)
    const new_value = parseFloat(current_value.toString() + num.toString());
    this.cashReceivedControl.setValue(new_value);
  }

  backspace(): void {
    const current_value = this.cashReceivedControl.value;
    if (!current_value) return;

    const str_val = current_value.toString();
    if (str_val.length <= 1) {
      this.cashReceivedControl.setValue(0);
    } else {
      this.cashReceivedControl.setValue(parseFloat(str_val.slice(0, -1)));
    }
  }

  clearCashAmount(): void {
    this.cashReceivedControl.setValue(0);
  }

  calculateChange(): void {
    if (this.paymentState.selectedMethod?.type === 'cash') {
      const total = this.cartState?.summary?.total || 0;
      const received = this.paymentState.cashReceived || 0;
      this.paymentState.change = Math.max(0, received - total);
    }
  }

  getReferenceError(): string | undefined {
    const control = this.referenceControl;
    if (control && control.errors && control.touched) {
      if (control.errors['required']) {
        return 'Este campo es requerido';
      }
      if (control.errors['minlength']) {
        return 'Mínimo 4 caracteres';
      }
    }
    return undefined;
  }

  canProcessPayment(): boolean {
    if (this.paymentState.isProcessing) return false;

    // Modo crédito: requiere cliente y saldo válido (cuotas solo para tipo 'installments')
    if (this.paymentState.paymentForm === 'credito') {
      const baseValid = !!this.cartState?.customer && this.creditRemainingBalance > 0;
      if (this.creditType === 'installments') {
        return baseValid && this.creditNumInstallments > 0;
      }
      return baseValid;
    }

    // Modo contado: lógica actual
    if (!this.paymentState.selectedMethod) return false;

    // Wallet validation
    if (this.paymentState.selectedMethod.type === 'wallet') {
      if (!this.cartState?.customer) return false;
      if (!this.walletInfo) return false;
      const total = this.cartState?.summary?.total || 0;
      return this.walletInfo.available >= total;
    }

    if (!this.paymentState.isAnonymousSale && !this.cartState?.customer) {
      return false;
    }

    if (this.paymentState.selectedMethod.type === 'cash') {
      const total = this.cartState?.summary?.total || 0;
      return this.paymentState.cashReceived >= total;
    }

    // Wompi: requires sub-method selection and valid form
    if (this.isWompiSelected()) {
      return this.isWompiFormValid();
    }

    if (this.paymentState.selectedMethod.requiresReference) {
      const reference = this.referenceControl.value;
      return reference && reference.trim().length >= 4;
    }

    return true;
  }

  processPayment(): void {
    if (!this.canProcessPayment() || !this.cartState) return;

    // Flujo crédito
    if (this.paymentState.paymentForm === 'credito') {
      this.processCreditSaleWithTerms();
      return;
    }

    // Flujo contado (lógica existente)
    if (!this.paymentState.selectedMethod) return;

    if (!this.paymentState.isAnonymousSale && !this.cartState.customer) {
      this.toastService.info('Seleccione un cliente para continuar');
      this.requestCustomer.emit();
      this.onModalClosed();
      return;
    }

    let register_id = localStorage.getItem('pos_register_id');

    if (!register_id && !this.requireCashDrawerOpen) {
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
        'Domingo', 'Lunes', 'Martes', 'Miércoles',
        'Jueves', 'Viernes', 'Sábado',
      ];
      const today = dayNames[new Date().getDay()];
      this.toastService.show({
        variant: 'error',
        title: 'Fuera del horario de atención',
        description: `El POS está cerrado. Hoy ${today} no se permite realizar ventas fuera del horario configurado.`,
      });
      return;
    }

    this.paymentState.isProcessing = true;

    const payment_request: any = {
      orderId: 'ORDER_' + Date.now(),
      amount: this.cartState.summary.total,
      paymentMethod: this.paymentState.selectedMethod,
      cashReceived: this.paymentState.cashReceived,
      reference: this.paymentState.reference,
      isAnonymousSale: this.paymentState.isAnonymousSale,
    };

    // Pass wallet metadata
    if (this.paymentState.selectedMethod?.type === 'wallet' && this.walletInfo) {
      payment_request.metadata = { walletId: this.walletInfo.wallet_id };
    }

    // Pass Wompi payment method data
    if (this.isWompiSelected()) {
      payment_request.metadata = {
        ...payment_request.metadata,
        wompiPaymentMethod: this.buildWompiPaymentMethodData(),
      };
    }

    this.paymentService
      .processSaleWithPayment(this.cartState, payment_request, 'current_user')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          if (response.success) {
            // Handle Wompi async payment flows (redirect, await, 3ds)
            if (
              this.isWompiSelected() &&
              response.nextAction &&
              response.nextAction.type !== 'none'
            ) {
              this.handleWompiNextAction(response);
              return; // Don't close modal, wait for async confirmation
            }

            this.paymentState.isProcessing = false;
            this.paymentCompleted.emit({
              success: true,
              order: response.order,
              payment: response.payment,
              change: response.change,
              message: response.message,
              isAnonymousSale: this.paymentState.isAnonymousSale,
            });
            this.onModalClosed();
          } else {
            this.paymentState.isProcessing = false;
            console.error('Payment failed:', response.message);
            this.toastService.show({
              variant: 'error',
              title: 'Error',
              description: response.message || 'Error al procesar el pago',
            });
          }
        },
        error: (error) => {
          this.paymentState.isProcessing = false;
          console.error('Payment error:', error);
          this.toastService.show({
            variant: 'error',
            title: 'Error',
            description:
              error.message || 'Error de conexión al procesar el pago',
          });
        },
      });
  }

  private processCreditSaleWithTerms(): void {
    if (!this.cartState || !this.cartState.customer) {
      this.toastService.info('Seleccione un cliente para continuar');
      return;
    }

    let register_id = localStorage.getItem('pos_register_id');
    if (!register_id && !this.requireCashDrawerOpen) {
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
        'Domingo', 'Lunes', 'Martes', 'Miércoles',
        'Jueves', 'Viernes', 'Sábado',
      ];
      const today = dayNames[new Date().getDay()];
      this.toastService.show({
        variant: 'error',
        title: 'Fuera del horario de atención',
        description: `El POS está cerrado. Hoy ${today} no se permite realizar ventas fuera del horario configurado.`,
      });
      return;
    }

    this.paymentState.isProcessing = true;

    const creditConfig = {
      num_installments: this.creditNumInstallments,
      frequency: this.creditFrequency,
      first_installment_date: this.creditFirstDate,
      interest_rate: this.creditInterestRate,
      interest_type: this.creditInterestType,
      initial_payment: this.creditInitialPayment,
      initial_payment_method_id: this.creditInitialPaymentMethod
        ? parseInt(this.creditInitialPaymentMethod.id)
        : undefined,
    };

    this.paymentService
      .processCreditSaleWithTerms(this.cartState, creditConfig, 'current_user', this.creditType)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.paymentState.isProcessing = false;
          if (response.success) {
            this.paymentCompleted.emit({
              success: true,
              order: response.order,
              message: response.message,
              isCreditSale: true,
            });
            this.onModalClosed();
          } else {
            this.toastService.show({
              variant: 'error',
              title: 'Error',
              description: response.message || 'Error al procesar la venta a crédito',
            });
          }
        },
        error: (error) => {
          this.paymentState.isProcessing = false;
          this.toastService.show({
            variant: 'error',
            title: 'Error',
            description: error.message || 'Error al procesar la venta a crédito',
          });
        },
      });
  }

  processCreditSale(): void {
    if (!this.cartState || this.paymentState.isProcessing) return;

    // Credit sales always require a customer (cannot be anonymous)
    if (!this.cartState.customer) {
      this.toastService.info('Seleccione un cliente para continuar');
      this.requestCustomer.emit();
      this.onModalClosed();
      return;
    }

    let register_id = localStorage.getItem('pos_register_id');

    // Auto-configure default register if not required
    if (!register_id && !this.requireCashDrawerOpen) {
      register_id = 'DEFAULT-POS';
      localStorage.setItem('pos_register_id', register_id);
    }

    if (!register_id) {
      this.toastService.info('Configure la caja para continuar');
      this.requestRegisterConfig.emit();
      this.onModalClosed();
      return;
    }

    // Check business hours if validation is enabled
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

    this.paymentState.isProcessing = true;

    this.paymentService
      .processCreditSale(this.cartState, 'current_user')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.paymentState.isProcessing = false;
          if (response.success) {
            this.paymentCompleted.emit({
              success: true,
              order: response.order,
              message: response.message,
              isCreditSale: true,
            });
            this.onModalClosed();
          } else {
            console.error('Credit sale failed:', response.message);
            this.toastService.show({
              variant: 'error',
              title: 'Error',
              description:
                response.message || 'Error al procesar la venta a crédito',
            });
          }
        },
        error: (error) => {
          this.paymentState.isProcessing = false;
          console.error('Credit sale error:', error);
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
    if (!this.cartState) return;

    if (!this.cartState.customer) {
      this.toastService.show({
        variant: 'error',
        title: 'Cliente Requerido',
        description: 'Debe seleccionar un cliente para guardar el borrador',
      });
      return;
    }

    this.paymentState.isProcessing = true;

    this.paymentService
      .saveDraft(this.cartState, 'current_user')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.paymentState.isProcessing = false;
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
          this.paymentState.isProcessing = false;
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
    this.paymentState = {
      selectedMethod: null,
      cashReceived: 0,
      reference: '',
      isProcessing: false,
      change: 0,
      isAnonymousSale: false,
      paymentForm: this.defaultPaymentForm,
    };
    this.paymentForm.reset();
    this.customerForm.reset();
    this.showCustomerSelector = false;
    this.customerSearchResults = [];
    this.customerSearchQuery = '';
    this.showCreateCustomerForm = false;
    this.paymentFormCollapsed = false;
    this.paymentMethodCollapsed = false;
    // Reset Wompi state
    this.resetWompiState();
    // Reset credit state
    this.creditNumInstallments = 3;
    this.creditFrequency = 'monthly';
    this.creditInterestRate = 0;
    this.creditInitialPayment = 0;
    this.creditInitialPaymentMethod = null;
    this.creditType = 'installments';
    this.creditInterestType = 'simple';
    this.setDefaultCreditFirstDate();
    this.updateCreditCalculations();
    this.closed.emit();
  }

  // Anonymous Sale Toggle
  toggleAnonymousSale(enabled: boolean): void {
    this.paymentState.isAnonymousSale = enabled;
    if (enabled) {
      // When switching to anonymous, clear customer selector
      this.showCustomerSelector = false;
      this.showCreateCustomerForm = false;
    } else {
      // When switching to customer sale, show customer selector if no customer selected
      if (!this.cartState?.customer) {
        this.showCustomerSelector = true;
      }
    }
  }

  setPaymentForm(form: 'contado' | 'credito'): void {
    this.paymentState.paymentForm = form;
    this.paymentFormCollapsed = true;
    this.paymentMethodCollapsed = false;
    if (form === 'credito') {
      // Crédito requiere cliente — deshabilitar venta anónima
      this.paymentState.isAnonymousSale = false;
      if (!this.cartState?.customer) {
        this.showCustomerSelector = true;
      }
      this.updateCreditCalculations();
    }
  }

  private getCreditRemainingBalance(): number {
    const total = this.cartState?.summary?.total || 0;
    return Math.max(0, total - (this.creditInitialPayment || 0));
  }

  private getCreditInstallmentsPreview(): { amount: number; due_date: string }[] {
    const total = this.getCreditRemainingBalance();
    const n = this.creditNumInstallments;
    if (n <= 0 || total <= 0) return [];

    const baseAmount = Math.round((total / n) * 100) / 100;
    const freqDays: Record<string, number> = { weekly: 7, biweekly: 14, monthly: 30 };
    const startDate = this.creditFirstDate ? new Date(this.creditFirstDate + 'T12:00:00') : new Date();

    return Array.from({ length: n }, (_, i) => {
      const due = new Date(startDate);
      due.setDate(due.getDate() + freqDays[this.creditFrequency] * i);
      return {
        amount: i === n - 1 ? Math.round((total - baseAmount * (n - 1)) * 100) / 100 : baseAmount,
        due_date: toLocalDateString(due),
      };
    });
  }

  getTotalInstallments(): number {
    return this.creditInstallmentsPreview.reduce((sum, inst) => sum + inst.amount, 0);
  }

  getAnnualRate(): number {
    const raw = this.creditInterestRate || 0;
    return raw > 1 ? raw : raw * 100;
  }

  getPeriodicRate(): number {
    const annual = this.getAnnualRate();
    const divisors: Record<string, number> = { weekly: 52, biweekly: 26, monthly: 12 };
    return Math.round((annual / (divisors[this.creditFrequency] || 12)) * 100) / 100;
  }

  getPeriodicLabel(): string {
    const labels: Record<string, string> = { weekly: 'semanal', biweekly: 'quincenal', monthly: 'mensual' };
    return labels[this.creditFrequency] || 'mensual';
  }

  getInterestAmount(): number {
    if (this.creditInstallmentsPreview.length === 0) return 0;
    return Math.round((this.getTotalInstallments() - this.creditRemainingBalance) * 100) / 100;
  }

  getEffectivePercent(): number {
    if (this.creditRemainingBalance <= 0) return 0;
    return Math.round((this.getInterestAmount() / this.creditRemainingBalance) * 10000) / 100;
  }

  selectCreditInitialPaymentMethod(method: PaymentMethod): void {
    this.creditInitialPaymentMethod = method;
  }

  updateCreditCalculations(): void {
    const total = this.cartState?.summary?.total || 0;
    const initialPayment = this.creditInitialPayment || 0;
    const amountToFinance = Math.max(0, total - initialPayment);
    this.creditRemainingBalance = amountToFinance;

    const n = this.creditNumInstallments;
    if (n <= 0 || amountToFinance <= 0) {
      this.creditInstallmentsPreview = [];
      return;
    }

    const rawRate = this.creditInterestRate || 0;
    const annualRate = rawRate > 1 ? rawRate / 100 : rawRate;
    const interestType = this.creditInterestType || 'simple';
    const freqDays: Record<string, number> = { weekly: 7, biweekly: 14, monthly: 30 };
    const periodsPerYear: Record<string, number> = { weekly: 52, biweekly: 26, monthly: 12 };
    const startDate = this.creditFirstDate ? new Date(this.creditFirstDate + 'T12:00:00') : new Date();

    if (annualRate <= 0) {
      // No interest: simple division
      const baseAmount = Math.round((amountToFinance / n) * 100) / 100;
      this.creditInstallmentsPreview = Array.from({ length: n }, (_, i) => {
        const due = new Date(startDate);
        due.setDate(due.getDate() + freqDays[this.creditFrequency] * i);
        return {
          amount: i === n - 1 ? Math.round((amountToFinance - baseAmount * (n - 1)) * 100) / 100 : baseAmount,
          due_date: toLocalDateString(due),
        };
      });
    } else if (interestType === 'compound') {
      // Compound interest (capitalization): FV = P × (1+r)^n
      // Interest capitalizes each period, then total divided into equal installments
      const r = annualRate / (periodsPerYear[this.creditFrequency] || 12);
      const totalWithInterest = Math.round(amountToFinance * Math.pow(1 + r, n) * 100) / 100;
      const baseAmount = Math.round((totalWithInterest / n) * 100) / 100;
      this.creditInstallmentsPreview = Array.from({ length: n }, (_, i) => {
        const due = new Date(startDate);
        due.setDate(due.getDate() + freqDays[this.creditFrequency] * i);
        return {
          amount: i === n - 1 ? Math.round((totalWithInterest - baseAmount * (n - 1)) * 100) / 100 : baseAmount,
          due_date: toLocalDateString(due),
        };
      });
    } else {
      // Simple interest: I = P × r × n, distributed equally
      const r = annualRate / (periodsPerYear[this.creditFrequency] || 12);
      const totalInterest = Math.round(amountToFinance * r * n * 100) / 100;
      const totalWithInterest = amountToFinance + totalInterest;
      const baseAmount = Math.round((totalWithInterest / n) * 100) / 100;
      this.creditInstallmentsPreview = Array.from({ length: n }, (_, i) => {
        const due = new Date(startDate);
        due.setDate(due.getDate() + freqDays[this.creditFrequency] * i);
        return {
          amount: i === n - 1 ? Math.round((totalWithInterest - baseAmount * (n - 1)) * 100) / 100 : baseAmount,
          due_date: toLocalDateString(due),
        };
      });
    }
  }

  // Customer Management Methods
  openCustomerSelector(): void {
    this.showCustomerSelector = true;
    this.showCreateCustomerForm = false;
    this.paymentState.isAnonymousSale = false;
  }

  closeCustomerSelector(): void {
    this.showCustomerSelector = false;
    this.showCreateCustomerForm = false;
    this.customerSearchResults = [];
    this.customerSearchQuery = '';
  }

  onCustomerSearch(query: string): void {
    this.customerSearchQuery = query;
    if (query && query.trim().length >= 2) {
      this.isSearchingCustomer = true;

      this.customerService
        .searchCustomers({ query: query.trim(), limit: 10 })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (response) => {
            this.customerSearchResults = response.data || [];
            this.isSearchingCustomer = false;
          },
          error: (error) => {
            console.error('Error searching customers:', error);
            this.customerSearchResults = [];
            this.isSearchingCustomer = false;
            this.toastService.show({
              variant: 'error',
              title: 'Error',
              description: 'Error al buscar clientes',
            });
          },
        });
    } else {
      this.customerSearchResults = [];
      this.isSearchingCustomer = false;
    }
  }

  selectCustomer(customer: PosCustomer): void {
    // Emit event to parent to update cart customer
    this.customerSelected.emit(customer);
    this.closeCustomerSelector();
  }

  switchToCreateCustomer(): void {
    this.showCreateCustomerForm = true;
    this.customerSearchResults = [];
  }

  switchToCustomerSearch(): void {
    this.showCreateCustomerForm = false;
  }

  onCreateCustomer(): void {
    if (this.customerForm.valid) {
      const formValue = this.customerForm.value;

      const customerRequest = {
        email: formValue.email,
        first_name: formValue.firstName,
        last_name: formValue.lastName,
        phone: formValue.phone || undefined,
        document_type: formValue.documentType || undefined,
        document_number: formValue.documentNumber || undefined,
      };

      this.isSearchingCustomer = true;

      this.customerService
        .createQuickCustomer(customerRequest)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (customer) => {
            this.isSearchingCustomer = false;
            this.customerSelected.emit(customer);
            this.closeCustomerSelector();
            this.toastService.success('Cliente creado correctamente');
          },
          error: (error) => {
            this.isSearchingCustomer = false;
            console.error('Error creating customer:', error);
            this.toastService.show({
              variant: 'error',
              title: 'Error',
              description:
                error.error?.message ||
                error.message ||
                'Error al crear cliente',
            });
          },
        });
    } else {
      // Mark all fields as touched to show validation errors
      Object.keys(this.customerForm.controls).forEach((key) => {
        const control = this.customerForm.get(key);
        control?.markAsTouched();
      });
      this.toastService.info('Por favor completa los campos requeridos');
    }
  }

  // Getter for insufficient amount
  get isCashAmountInsufficient(): boolean {
    if (this.paymentState.selectedMethod?.type === 'cash') {
      const total = this.cartState?.summary?.total || 0;
      const received = this.paymentState.cashReceived || 0;
      return received < total;
    }
    return false;
  }

  get missingAmount(): number {
    if (this.isCashAmountInsufficient) {
      const total = this.cartState?.summary?.total || 0;
      const received = this.paymentState.cashReceived || 0;
      return total - received;
    }
    return 0;
  }

  // ─── Wompi Methods ───────────────────────────────────────────────────

  isWompiSelected(): boolean {
    return this.wompiService.isWompiMethod(this.paymentState?.selectedMethod);
  }

  selectWompiSubMethod(sub: WompiSubMethod): void {
    this.selectedWompiSubMethod = sub;

    // Load PSE banks if needed
    if (sub === WompiSubMethod.PSE && this.pseFinancialInstitutions.length === 0) {
      this.wompiService.getPseFinancialInstitutions().subscribe({
        next: (institutions) => {
          this.pseFinancialInstitutions = institutions;
          this.pseBankOptions = institutions.map((i) => ({
            value: i.financial_institution_code,
            label: i.financial_institution_name,
          }));
        },
        error: () => {}, // Silently fail, user can retry
      });
    }
  }

  buildWompiPaymentMethodData(): any {
    switch (this.selectedWompiSubMethod) {
      case WompiSubMethod.NEQUI:
        return { type: 'NEQUI', phone_number: this.nequiPhoneControl.value };
      case WompiSubMethod.PSE:
        return {
          type: 'PSE',
          user_type: this.pseForm.value.userType,
          user_legal_id_type: this.pseForm.value.userLegalIdType,
          user_legal_id: this.pseForm.value.userLegalId,
          financial_institution_code: this.pseForm.value.financialInstitutionCode,
          payment_description: this.pseForm.value.paymentDescription || 'Pago Vendix',
        };
      case WompiSubMethod.BANCOLOMBIA_TRANSFER:
        return { type: 'BANCOLOMBIA_TRANSFER' };
      default:
        return { type: this.selectedWompiSubMethod };
    }
  }

  isWompiFormValid(): boolean {
    if (!this.selectedWompiSubMethod) return false;
    switch (this.selectedWompiSubMethod) {
      case WompiSubMethod.NEQUI:
        return this.nequiPhoneControl.valid;
      case WompiSubMethod.PSE:
        return this.pseForm.valid;
      default:
        return true; // Card and Bancolombia don't need extra input
    }
  }

  resetWompiState(): void {
    this.selectedWompiSubMethod = null;
    this.wompiAwaitingPayment = false;
    this.wompiAwaitingMessage = '';
    this.nequiPhoneControl.reset();
    this.pseForm.reset({ userType: 0, userLegalIdType: 'CC', userLegalId: '', financialInstitutionCode: '', paymentDescription: '' });
    this.wompiPollingSubscription?.unsubscribe();
    this.wompiPollingSubscription = null;
    this.wompiPaymentId = null;
  }

  handleWompiNextAction(response: any): void {
    const nextAction = response?.nextAction || response?.data?.nextAction;
    if (!nextAction) return;

    this.wompiPaymentId =
      response?.payment?.transaction_id ||
      response?.transactionId ||
      response?.data?.payment?.transaction_id ||
      response?.data?.transactionId;

    switch (nextAction.type) {
      case 'redirect':
        if (nextAction.url) {
          const popup = window.open(nextAction.url, '_blank');
          if (!popup) {
            this.wompiAwaitingMessage =
              'No se pudo abrir la ventana del banco. Por favor habilita las ventanas emergentes e intenta de nuevo.';
            this.wompiAwaitingPayment = true;
            return;
          }
        }
        this.wompiAwaitingPayment = true;
        this.wompiAwaitingMessage =
          'Se abrió la página del banco. Completa el pago y regresa aquí.';
        this.startWompiPolling();
        break;
      case 'await':
        this.wompiAwaitingPayment = true;
        this.wompiAwaitingMessage =
          this.selectedWompiSubMethod === WompiSubMethod.NEQUI
            ? 'Esperando confirmación en la app de Nequi...'
            : 'Esperando confirmación del pago...';
        this.startWompiPolling();
        break;
      case '3ds':
        if (nextAction.url) {
          const popup3ds = window.open(nextAction.url, '_blank');
          if (!popup3ds) {
            this.wompiAwaitingMessage =
              'No se pudo abrir la ventana del banco. Por favor habilita las ventanas emergentes e intenta de nuevo.';
            this.wompiAwaitingPayment = true;
            return;
          }
        }
        this.wompiAwaitingPayment = true;
        this.wompiAwaitingMessage =
          'Completa la verificación 3D Secure en la ventana abierta.';
        this.startWompiPolling();
        break;
      case 'none':
        // Payment completed or failed synchronously, handled by existing flow
        break;
    }
  }

  startWompiPolling(): void {
    if (!this.wompiPaymentId) return;

    this.wompiPollingSubscription?.unsubscribe();
    this.wompiPollingSubscription = this.wompiService
      .pollPaymentStatus(this.wompiPaymentId)
      .subscribe({
        next: (update: WompiPaymentStatusUpdate) => {
          if (update.status === 'succeeded') {
            this.wompiAwaitingPayment = false;
            this.wompiAwaitingMessage = '';
            this.paymentState.isProcessing = false;
            this.paymentCompleted.emit({
              success: true,
              message: 'Pago con Wompi procesado correctamente',
              isAnonymousSale: this.paymentState.isAnonymousSale,
            });
            this.onModalClosed();
          } else if (
            update.status === 'failed' ||
            update.status === 'cancelled'
          ) {
            this.wompiAwaitingPayment = false;
            this.wompiAwaitingMessage =
              update.message || 'El pago fue rechazado.';
            this.paymentState.isProcessing = false;
            this.toastService.show({
              variant: 'error',
              title: 'Pago rechazado',
              description: update.message || 'El pago fue rechazado.',
            });
          }
        },
        error: () => {
          this.wompiAwaitingPayment = false;
          this.wompiAwaitingMessage = '';
          this.paymentState.isProcessing = false;
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
    this.wompiAwaitingPayment = false;
    this.wompiAwaitingMessage = '';
    this.paymentState.isProcessing = false;
  }

  navigateToSettings(): void {
    this.onModalClosed();
    this.router.navigate(['/admin/settings/payments']);
  }
}
