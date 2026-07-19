import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';

import { ModalComponent, type ModalSize } from '../modal/modal.component';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';
import { CurrencyPipe } from '../../pipes/currency';
import type { PaymentMethod } from '../../models/payment-method.model';
import { PaymentCollectorComponent } from './payment-collector.component';
import type {
  ManualPaymentMethod,
  PaymentContext,
  PaymentSubmit,
} from './payment-collector.model';

/**
 * Thin, optional modal wrapper around {@link PaymentCollectorComponent}.
 *
 * Owns only the modal chrome (open state, title, footer submit/cancel) and
 * forwards every collector input/output. The submit button is driven by the
 * collector's own `canSubmit()` gate and shows the live total. Consumers that
 * need custom chrome can embed `app-payment-collector` directly instead.
 */
@Component({
  selector: 'app-payment-modal',
  standalone: true,
  imports: [
    ModalComponent,
    ButtonComponent,
    IconComponent,
    CurrencyPipe,
    PaymentCollectorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [(isOpen)]="open"
      [title]="title()"
      [subtitle]="subtitle()"
      [size]="size()"
      (closed)="onModalClosed()"
    >
      <app-payment-collector
        #collector
        [amount]="amount()"
        [remainingBalance]="remainingBalance()"
        [paymentMethods]="paymentMethods()"
        [autoLoad]="autoLoad()"
        [isProcessing]="isProcessing()"
        [installments]="installments()"
        [preSelectedInstallment]="preSelectedInstallment()"
        [customer]="customer()"
        [manualMethods]="manualMethods()"
        [context]="context()"
        [currencyDecimals]="currencyDecimals()"
        [walletInfo]="walletInfo()"
        [allowCash]="allowCash()"
        [allowReference]="allowReference()"
        [allowTip]="allowTip()"
        [allowCredit]="allowCredit()"
        [allowWompi]="allowWompi()"
        [allowWallet]="allowWallet()"
        [requireCustomer]="requireCustomer()"
        [allowAmountOverride]="allowAmountOverride()"
        [showKeypad]="showKeypad()"
        (submit)="submit.emit($event)"
        (methodSelected)="methodSelected.emit($event)"
        (requestCustomer)="requestCustomer.emit()"
        (walletLookup)="walletLookup.emit($event)"
        (closed)="close()"
      />

      <div slot="footer" class="pm-footer">
        <app-button
          variant="primary"
          [fullWidth]="true"
          [loading]="isProcessing()"
          [disabled]="isProcessing() || !collector.canSubmit()"
          (clicked)="collector.triggerSubmit()"
        >
          <app-icon slot="icon" name="check-circle" [size]="18" />
          {{ submitLabel() || ('Cobrar ' + (collector.effectiveTotal() | currency)) }}
        </app-button>
        <app-button
          variant="ghost"
          [fullWidth]="true"
          [disabled]="isProcessing()"
          (clicked)="close()"
        >
          Cancelar
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      .pm-footer {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
      }
    `,
  ],
})
export class PaymentModalComponent {
  // Modal chrome
  readonly open = model<boolean>(false);
  readonly title = input<string>('Cobrar');
  readonly subtitle = input<string>();
  readonly size = input<ModalSize>('md');
  readonly submitLabel = input<string>();

  // Forwarded collector data inputs
  readonly amount = input.required<number>();
  readonly remainingBalance = input<number>();
  readonly paymentMethods = input<PaymentMethod[] | null>(null);
  readonly autoLoad = input<boolean>(true);
  readonly isProcessing = input<boolean>(false);
  readonly installments = input<any[]>([]);
  readonly preSelectedInstallment = input<any>(null);
  readonly customer = input<{ id: number | string } | null>(null);
  readonly manualMethods = input<ManualPaymentMethod[]>([]);
  readonly context = input<PaymentContext>('generic');
  readonly currencyDecimals = input<number>();
  readonly walletInfo = input<{ balance: number } | null>(null);

  // Forwarded capability flags (undefined → context default in the collector)
  readonly allowCash = input<boolean | undefined>(undefined);
  readonly allowReference = input<boolean | undefined>(undefined);
  readonly allowTip = input<boolean | undefined>(undefined);
  readonly allowCredit = input<boolean | undefined>(undefined);
  readonly allowWompi = input<boolean | undefined>(undefined);
  readonly allowWallet = input<boolean | undefined>(undefined);
  readonly requireCustomer = input<boolean | undefined>(undefined);
  readonly allowAmountOverride = input<boolean | undefined>(undefined);
  readonly showKeypad = input<boolean | undefined>(undefined);

  // Outputs (mirrors of the collector)
  readonly submit = output<PaymentSubmit>();
  readonly methodSelected = output<PaymentMethod>();
  readonly requestCustomer = output<void>();
  readonly walletLookup = output<{ id: number | string }>();
  readonly closed = output<void>();

  close(): void {
    this.open.set(false);
  }

  onModalClosed(): void {
    this.closed.emit();
  }
}
