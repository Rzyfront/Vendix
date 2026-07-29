import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import {
  PRINT_FORMATS,
  PRINT_FORMAT_LABELS,
  PrintFormat,
} from '../../../../../../../core/models/store-settings.interface';
import { InvoicingService } from '../../../../invoicing/services/invoicing.service';
import { SettingToggleComponent } from '../../../../../../../shared/components/setting-toggle/setting-toggle.component';
import { TextareaComponent } from '../../../../../../../shared/components';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
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
  deliver_printed?: boolean;
  invoice_format?: PrintFormat;
  pos_ticket_format?: PrintFormat;
  pos_ticket_copies?: number;
}

/**
 * Emission stage this form renders for. Three states, because a store in the
 * middle of the DIAN test set is neither live nor unconfigured: it must keep
 * emitting sale receipts while the trámite finishes.
 */
export type EmissionStage = 'receipts' | 'pending' | 'live';

@Component({
  selector: 'app-receipts-settings-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    SettingToggleComponent,
    TextareaComponent,
    IconComponent,
    SelectorComponent,
    ModalComponent,
  ],
  templateUrl: './receipts-settings-form.component.html',
  styleUrls: ['./receipts-settings-form.component.scss'],
})
export class ReceiptsSettingsForm {
  private readonly invoicingService = inject(InvoicingService);
  private readonly destroyRef = inject(DestroyRef);

  readonly settings = input.required<ReceiptsSettings>();
  /**
   * Real emission stage, resolved from `GET dian-config/emission-status`.
   *
   * NOT derived from `fiscal_status.invoicing.state`: that flag turns ACTIVE as
   * soon as the fiscal wizard is completed, so a store whose test set is still
   * pending was being told electronic invoicing was active and lost the sale
   * receipt controls it must keep using until production.
   */
  readonly emissionStage = input<EmissionStage>('receipts');
  /** Why the trámite is not finished yet — shown in the `pending` banner. */
  readonly pendingReason = input<string | null>(null);
  /** Unmet production prerequisites, listed under the `pending` banner. */
  readonly pendingBlockers = input<Array<{ label: string; action: string }>>([]);
  /** `pos.auto_print_receipt`, which lives in the POS block, not in receipts. */
  readonly posAutoPrint = input<boolean>(false);
  readonly settingsChange = output<ReceiptsSettings>();
  readonly posAutoPrintChange = output<boolean>();

  readonly isLive = computed(() => this.emissionStage() === 'live');
  readonly isPending = computed(() => this.emissionStage() === 'pending');

  form: FormGroup = new FormGroup({
    print_receipt: new FormControl(true),
    email_receipt: new FormControl(false),
    receipt_header: new FormControl(''),
    receipt_footer: new FormControl('¡Gracias por su compra!'),
    auto_issue_invoice: new FormControl(true),
    invoice_copies: new FormControl(1),
    send_invoice_email: new FormControl(true),
    print_pos_ticket: new FormControl(false),
    deliver_printed: new FormControl(false),
    invoice_format: new FormControl<PrintFormat>('letter'),
    pos_ticket_format: new FormControl<PrintFormat>('thermal_80'),
    pos_ticket_copies: new FormControl(1),
  });

  /** 0 is a real choice: some merchants only send the invoice by email. */
  readonly copiesOptions: SelectorOption[] = [
    { value: 0, label: 'No imprimir' },
    { value: 1, label: '1 copia' },
    { value: 2, label: '2 copias' },
    { value: 3, label: '3 copias' },
  ];

  readonly formatOptions: SelectorOption[] = PRINT_FORMATS.map((format) => ({
    value: format,
    label: PRINT_FORMAT_LABELS[format],
  }));

  readonly contentSectionTitle = computed(() =>
    this.isLive() ? 'Contenido de la factura impresa' : 'Contenido Personalizado',
  );

  /**
   * Warning shown when the merchant just turned the email off. The invoice must
   * be DELIVERED to the buyer in physical or electronic form, so leaving both
   * channels off is not a valid configuration — `onFieldChange` turns the
   * printed hand-off on rather than silently saving an unlawful setup.
   */
  readonly deliveryFallbackApplied = signal(false);

  /**
   * `pos.auto_print_receipt` lives in the POS block, so it is edited through its
   * own control and emitted separately instead of being smuggled into the
   * receipts payload. A plain `FormControl` rather than `[ngModel]`: mixing
   * ngModel into a reactive form throws NG01350 and aborts change detection.
   */
  readonly posAutoPrintControl = new FormControl(false);

  // ── Format preview ──────────────────────────────────────────
  readonly isPreviewOpen = signal(false);
  readonly previewLoading = signal(false);
  readonly previewError = signal<string | null>(null);
  /** Blob URL of the sample document, revoked when the modal closes. */
  readonly previewUrl = signal<string | null>(null);
  /**
   * The `src` is assigned on the element instead of bound in the template.
   * Binding a blob URL to `[src]` goes through Angular's resource-URL sanitizer,
   * which rejects anything that is not a `SafeValue` (NG0904) and would force a
   * `bypassSecurityTrustResourceUrl` on every render; assigning the property
   * directly keeps the URL out of the sanitizer without weakening anything —
   * the value is one we just created ourselves from our own response body.
   */
  private readonly previewFrame =
    viewChild<ElementRef<HTMLIFrameElement>>('previewFrame');

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
  get deliverPrintedControl() {
    return this.form.get('deliver_printed') as FormControl;
  }
  get invoiceFormatControl() {
    return this.form.get('invoice_format') as FormControl;
  }
  get posTicketFormatControl() {
    return this.form.get('pos_ticket_format') as FormControl;
  }
  get posTicketCopiesControl() {
    return this.form.get('pos_ticket_copies') as FormControl;
  }

  constructor() {
    effect(() => {
      const current = this.settings();
      if (current) {
        this.form.patchValue(current, { emitEvent: false });
      }
    });

    effect(() => {
      this.posAutoPrintControl.setValue(this.posAutoPrint(), {
        emitEvent: false,
      });
    });

    // The iframe only exists while the modal is open, so the assignment waits
    // for both the element and the URL to be available.
    effect(() => {
      const frame = this.previewFrame();
      const url = this.previewUrl();
      if (frame && url) {
        frame.nativeElement.src = url;
      }
    });

    this.destroyRef.onDestroy(() => this.releasePreviewUrl());
  }

  onFieldChange() {
    if (!this.form.valid) return;

    this.enforceDeliveryChannel();
    this.settingsChange.emit(this.form.value);
  }

  onPosAutoPrintChange(value: boolean) {
    this.posAutoPrintChange.emit(value);
  }

  /**
   * Renders a sample invoice in the currently selected format. The document comes
   * from the backend preview endpoint, which fabricates the document data, so
   * previewing never consumes resolution numbering.
   */
  openFormatPreview(): void {
    this.previewLoading.set(true);
    this.previewError.set(null);

    this.invoicingService
      .previewInvoicePdf(this.invoiceFormatControl.value ?? 'letter')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          this.releasePreviewUrl();
          this.previewUrl.set(URL.createObjectURL(blob));
          this.previewLoading.set(false);
          this.isPreviewOpen.set(true);
        },
        error: () => {
          this.previewLoading.set(false);
          this.previewError.set(
            'No se pudo generar la muestra. Revisa que la facturación electrónica esté habilitada para esta tienda.',
          );
        },
      });
  }

  closeFormatPreview(): void {
    this.isPreviewOpen.set(false);
    this.releasePreviewUrl();
  }

  /** Object URLs hold the whole blob in memory until revoked. */
  private releasePreviewUrl(): void {
    const url = this.previewUrl();
    if (url) {
      URL.revokeObjectURL(url);
      this.previewUrl.set(null);
    }
  }

  /**
   * Keeps at least one delivery channel on once the store is live. Emailing the
   * invoice is not legally mandatory in itself — DELIVERING it is, in physical
   * or electronic form — so turning the email off is fine as long as the printed
   * copy takes over.
   */
  private enforceDeliveryChannel(): void {
    if (!this.isLive()) {
      this.deliveryFallbackApplied.set(false);
      return;
    }

    const emailOn = !!this.sendInvoiceEmailControl.value;
    const printedOn = !!this.deliverPrintedControl.value;

    if (!emailOn && !printedOn) {
      this.deliverPrintedControl.setValue(true, { emitEvent: false });
      this.deliveryFallbackApplied.set(true);
      return;
    }

    this.deliveryFallbackApplied.set(false);
  }
}
