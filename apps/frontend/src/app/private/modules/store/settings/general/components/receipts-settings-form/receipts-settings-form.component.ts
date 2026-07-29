import { Component, computed, effect, input, output } from '@angular/core';

import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { SettingToggleComponent } from '../../../../../../../shared/components/setting-toggle/setting-toggle.component';
import { TextareaComponent } from '../../../../../../../shared/components';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../../shared/components/selector/selector.component';

export interface ReceiptsSettings {
  print_receipt: boolean;
  email_receipt: boolean;
  receipt_header?: string;
  receipt_footer: string;
  /** Electronic-invoicing block — see `core/models/store-settings.interface`. */
  auto_issue_invoice?: boolean;
  invoice_copies?: number;
  send_invoice_email?: boolean;
  print_pos_ticket?: boolean;
}

@Component({
  selector: 'app-receipts-settings-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    SettingToggleComponent,
    TextareaComponent,
    IconComponent,
    SelectorComponent,
  ],
  templateUrl: './receipts-settings-form.component.html',
  styleUrls: ['./receipts-settings-form.component.scss'],
})
export class ReceiptsSettingsForm {
  readonly settings = input.required<ReceiptsSettings>();
  /**
   * True when the store's `invoicing` fiscal area is ACTIVE/LOCKED, i.e. DIAN
   * habilitación is in place. Such a store does NOT issue internal sale
   * receipts — every sale becomes an electronic invoice — so the receipt
   * delivery toggles are misleading there and get replaced by invoice settings.
   */
  readonly electronicInvoicingActive = input<boolean>(false);
  readonly settingsChange = output<ReceiptsSettings>();

  form: FormGroup = new FormGroup({
    print_receipt: new FormControl(true),
    email_receipt: new FormControl(false),
    receipt_header: new FormControl(''),
    receipt_footer: new FormControl('¡Gracias por su compra!'),
    auto_issue_invoice: new FormControl(true),
    invoice_copies: new FormControl(1),
    send_invoice_email: new FormControl(true),
    print_pos_ticket: new FormControl(false),
  });

  /** 0 is a real choice: some merchants only send the invoice by email. */
  readonly copiesOptions: SelectorOption[] = [
    { value: 0, label: 'No imprimir' },
    { value: 1, label: '1 copia' },
    { value: 2, label: '2 copias' },
    { value: 3, label: '3 copias' },
  ];

  readonly contentSectionTitle = computed(() =>
    this.electronicInvoicingActive()
      ? 'Contenido de la factura impresa'
      : 'Contenido Personalizado',
  );

  get printReceiptControl() {
    return this.form.get('print_receipt') as FormControl;
  }
  get emailReceiptControl() {
    return this.form.get('email_receipt') as FormControl;
  }
  get receiptHeaderControl() {
    return this.form.get('receipt_header') as FormControl;
  }
  get receiptFooterControl() {
    return this.form.get('receipt_footer') as FormControl;
  }
  get autoIssueInvoiceControl() {
    return this.form.get('auto_issue_invoice') as FormControl;
  }
  get invoiceCopiesControl() {
    return this.form.get('invoice_copies') as FormControl;
  }
  get sendInvoiceEmailControl() {
    return this.form.get('send_invoice_email') as FormControl;
  }
  get printPosTicketControl() {
    return this.form.get('print_pos_ticket') as FormControl;
  }

  constructor() {
    effect(() => {
      const current = this.settings();
      if (current) {
        this.form.patchValue(current, { emitEvent: false });
      }
    });
  }

  onFieldChange() {
    if (this.form.valid) {
      this.settingsChange.emit(this.form.value);
    }
  }
}
