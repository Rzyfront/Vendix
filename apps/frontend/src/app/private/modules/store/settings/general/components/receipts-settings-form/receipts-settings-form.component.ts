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
  PRINT_FORMAT_LABELS,
  PrintFormat,
} from '../../../../../../../core/models/store-settings.interface';
import { InvoicingService } from '../../../../invoicing/services/invoicing.service';
import { PosTicketService } from '../../../../pos/services/pos-ticket.service';
import { SettingToggleComponent } from '../../../../../../../shared/components/setting-toggle/setting-toggle.component';
import { TextareaComponent } from '../../../../../../../shared/components';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import type { IconName } from '../../../../../../../shared/components/icon/icons.registry';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { BadgeComponent } from '../../../../../../../shared/components/badge/badge.component';
import { TooltipComponent } from '../../../../../../../shared/components/tooltip/tooltip.component';
import { ExpandableCardComponent } from '../../../../../../../shared/components/expandable-card/expandable-card.component';

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
  /** ADR-7 / CP-DTLP-20260827 — Tiquete de despacho encadenado. */
  print_dispatch_ticket_enabled?: boolean;
  print_dispatch_ticket_auto_with_pos?: boolean;
  print_dispatch_ticket_auto_on_postventa?: boolean;
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
    ModalComponent,
    BadgeComponent,
    TooltipComponent,
    ExpandableCardComponent,
  ],
  templateUrl: './receipts-settings-form.component.html',
  styleUrls: ['./receipts-settings-form.component.scss'],
})
export class ReceiptsSettingsForm {
  private readonly invoicingService = inject(InvoicingService);
  private readonly posTicketService = inject(PosTicketService);
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
  /**
   * Formats to preview, resolved by the parent from `receipts.printing`.
   *
   * They are inputs rather than controls because the format is no longer edited
   * here: it belongs to the "Formatos de Impresión" section, which configures
   * all 12 printable documents. Keeping an editor in both places made
   * `receipts.pos_ticket_format` and `receipts.printing.pos_ticket.format` two
   * competing sources of truth, decided by whichever form emitted last.
   */
  readonly posTicketPrintFormat = input<PrintFormat>('thermal_80');
  readonly invoicePrintFormat = input<PrintFormat>('letter');
  readonly settingsChange = output<ReceiptsSettings>();
  readonly posAutoPrintChange = output<boolean>();

  readonly isLive = computed(() => this.emissionStage() === 'live');
  readonly isPending = computed(() => this.emissionStage() === 'pending');

  /**
   * La etapa es el dato que gobierna toda la sección: decide qué documento
   * emite la tienda y, por lo tanto, qué controles tienen sentido. Se pinta como
   * un recorrido de tres pasos para que el operador vea dónde está parado y qué
   * le queda por delante, en vez de deducirlo del color de un banner.
   */
  private static readonly STAGE_ORDER: EmissionStage[] = [
    'receipts',
    'pending',
    'live',
  ];

  private static readonly STAGE_LABELS: Record<EmissionStage, string> = {
    receipts: 'Recibos de venta',
    pending: 'Habilitación en trámite',
    live: 'Factura electrónica',
  };

  readonly stageSteps = computed(() => {
    const currentIndex = ReceiptsSettingsForm.STAGE_ORDER.indexOf(
      this.emissionStage(),
    );

    return ReceiptsSettingsForm.STAGE_ORDER.map((key, index) => ({
      key,
      label: ReceiptsSettingsForm.STAGE_LABELS[key],
      state:
        index < currentIndex
          ? ('done' as const)
          : index === currentIndex
            ? ('current' as const)
            : ('upcoming' as const),
    }));
  });

  // Tipado explícito: `app-icon` recibe `IconName`, y una computed que devuelve
  // literales de string se infiere como `string` — con strictTemplates el
  // binding no compila.
  readonly stageIcon = computed<IconName>(() => {
    if (this.isLive()) return 'shield-check';
    return this.isPending() ? 'clock' : 'receipt';
  });

  readonly stageHeadline = computed(() =>
    this.isLive()
      ? 'Facturación electrónica activa'
      : this.isPending()
        ? 'Facturación electrónica en trámite'
        : 'La tienda emite recibos de venta',
  );

  readonly stageText = computed(() => {
    if (this.isLive()) {
      return (
        'Esta tienda está habilitada ante la DIAN en producción y solo emite ' +
        'facturas electrónicas. Cada venta genera una factura con CUFE, firmada y ' +
        'transmitida a la DIAN; no se emiten recibos internos de compra.'
      );
    }

    if (this.isPending()) {
      return (
        (this.pendingReason() ||
          'La habilitación ante la DIAN todavía no está en producción.') +
        ' Mientras termina el trámite, la tienda sigue emitiendo recibos de venta.'
      );
    }

    return (
      'Cada venta entrega un recibo interno de compra, sin valor fiscal ante la ' +
      'DIAN. Al completar la habilitación electrónica, la tienda pasa a emitir ' +
      'factura con CUFE y estos controles se reemplazan por los de emisión.'
    );
  });

  /** Qué puede hacer la tienda HOY, en la etapa en la que está. */
  readonly stageCapabilities = computed<string[]>(() => {
    if (this.isLive()) {
      return [
        'Cada venta emite factura electrónica con CUFE y la transmite a la DIAN.',
        'El tiquete POS queda como copia informativa: no reemplaza la factura.',
        'La factura debe entregarse al cliente por correo o impresa (al menos un canal).',
      ];
    }

    if (this.isPending()) {
      return [
        'Se sigue cobrando y entregando recibo de venta con normalidad.',
        'Todavía no se emiten facturas con CUFE: nada se transmite a la DIAN.',
        'Al pasar a producción, esta sección cambia sola a los controles de factura.',
      ];
    }

    return [
      'Se cobra y se entrega recibo impreso o por correo.',
      'El recibo no lleva CUFE ni resolución: no es una factura electrónica.',
      'La habilitación ante la DIAN se hace desde el módulo de Facturación.',
    ];
  });

  /**
   * Format and copies are deliberately absent: they are owned by the "Formatos
   * de Impresión" section. Anything this form does not declare is left
   * untouched, because the parent MERGES this payload into `receipts` instead of
   * replacing the block.
   */
  form: FormGroup = new FormGroup({
    print_receipt: new FormControl(true),
    email_receipt: new FormControl(false),
    receipt_header: new FormControl(''),
    receipt_footer: new FormControl('¡Gracias por su compra!'),
    auto_issue_invoice: new FormControl(true),
    send_invoice_email: new FormControl(true),
    print_pos_ticket: new FormControl(false),
    deliver_printed: new FormControl(false),
    print_dispatch_ticket_enabled: new FormControl(true),
    print_dispatch_ticket_auto_with_pos: new FormControl(false),
    print_dispatch_ticket_auto_on_postventa: new FormControl(false),
  });

  /** Label of the format each preview will render, for the section hint. */
  readonly posTicketFormatLabel = computed(
    () => PRINT_FORMAT_LABELS[this.posTicketPrintFormat()],
  );
  readonly invoiceFormatLabel = computed(
    () => PRINT_FORMAT_LABELS[this.invoicePrintFormat()],
  );

  readonly contentSectionTitle = computed(() =>
    this.isLive() ? 'Contenido de la factura impresa' : 'Contenido Personalizado',
  );

  readonly contentSectionSubtitle = computed(() =>
    this.isLive()
      ? 'Texto propio que se suma al documento. Los datos legales del emisor los pone el sistema.'
      : 'Texto propio que encabeza y cierra el recibo, en papel y en el correo.',
  );

  /** El explicativo legal arranca colapsado: es de consulta, no de trabajo. */
  readonly legalNoticeOpen = signal(false);

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
  /** Which preview is loading, so only its own button shows the spinner. */
  readonly previewLoading = signal<'invoice' | 'pos' | null>(null);
  readonly previewError = signal<string | null>(null);
  readonly previewKind = signal<'invoice' | 'pos'>('invoice');
  readonly previewTitle = computed(() =>
    this.previewKind() === 'pos'
      ? 'Vista previa del tiquete POS'
      : 'Vista previa de la factura',
  );
  readonly previewSubtitle = computed(() =>
    this.previewKind() === 'pos'
      ? 'Tiquete de muestra con el formato y el contenido configurados'
      : 'Documento de muestra con los datos legales de esta tienda',
  );
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
  get sendInvoiceEmailControl() {
    return this.form.get('send_invoice_email') as FormControl;
  }
  get printPosTicketControl() {
    return this.form.get('print_pos_ticket') as FormControl;
  }
  get deliverPrintedControl() {
    return this.form.get('deliver_printed') as FormControl;
  }
  get printDispatchTicketEnabledControl() {
    return this.form.get('print_dispatch_ticket_enabled') as FormControl;
  }
  get printDispatchTicketAutoWithPosControl() {
    return this.form.get('print_dispatch_ticket_auto_with_pos') as FormControl;
  }
  get printDispatchTicketAutoOnPostventaControl() {
    return this.form.get('print_dispatch_ticket_auto_on_postventa') as FormControl;
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
    this.previewKind.set('invoice');
    this.previewLoading.set('invoice');
    this.previewError.set(null);

    this.invoicingService
      .previewInvoicePdf(this.invoicePrintFormat())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => this.showPreview(blob),
        error: () => {
          this.previewLoading.set(null);
          this.previewError.set(
            'No se pudo generar la muestra. Revisa que la facturación electrónica esté habilitada para esta tienda.',
          );
        },
      });
  }

  /**
   * The POS ticket is rendered in the browser, not by the backend, so the sample
   * comes from the very service the POS prints with — including the `@page size`
   * rule, which is what makes the difference between a roll and a sheet visible.
   */
  async openPosTicketPreview(): Promise<void> {
    this.previewKind.set('pos');
    this.previewLoading.set('pos');
    this.previewError.set(null);

    try {
      const html = await this.posTicketService.buildSampleTicketHTML(
        this.posTicketPrintFormat(),
        // A live store prints the ticket as the informative copy of the invoice,
        // so that is what its preview must show.
        { asInvoiceCopy: this.isLive() },
      );
      this.showPreview(new Blob([html], { type: 'text/html' }));
    } catch {
      this.previewLoading.set(null);
      this.previewError.set('No se pudo generar el tiquete de muestra.');
    }
  }

  private showPreview(blob: Blob): void {
    this.releasePreviewUrl();
    this.previewUrl.set(URL.createObjectURL(blob));
    this.previewLoading.set(null);
    this.isPreviewOpen.set(true);
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
