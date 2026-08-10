import { Component, computed, effect, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

import {
  PRINT_DEFAULTS,
  PRINT_DOCUMENTS,
  PRINT_DOCUMENT_LABELS,
  PRINT_FORMATS,
  PRINT_FORMAT_LABELS,
  PRINT_PAGE_GEOMETRY,
  PrintDocument,
  PrintDocumentConfig,
  PrintFormat,
  PrintingSettings,
  ReceiptsSettings,
} from '../../../../../../../core/models/store-settings.interface';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../../shared/components/selector/selector.component';

/** Controls of a single document row. */
interface PrintDocumentControls {
  format: FormControl<PrintFormat>;
  margin_mm: FormControl<number>;
  copies: FormControl<number>;
}

type PrintFormatsFormControls = Record<
  PrintDocument,
  FormGroup<PrintDocumentControls>
>;

/**
 * Margin used when a document has no configured margin and its default carries
 * none — the roll defaults in `PRINT_DEFAULTS` omit `margin_mm` on purpose. It
 * only becomes visible if the merchant switches that document to a sheet
 * format, and then an empty box would read as "0 mm bleed to the paper edge".
 */
const FALLBACK_MARGIN_MM = 20;

/** Physical guard rails: below 0 is meaningless, above 50 mm leaves no body. */
const MIN_MARGIN_MM = 0;
const MAX_MARGIN_MM = 50;

const MIN_COPIES = 0;
const MAX_COPIES = 5;

/**
 * Per-document print configuration screen (QUI-641).
 *
 * The configurable unit is the store × the document type, not the store alone:
 * the same shop prints its POS ticket on an 80 mm roll and its route sheet on
 * A4. Every one of the 12 `PRINT_DOCUMENTS` gets its own row here.
 *
 * Scope is the STORE. Nothing is inherited from the organization.
 *
 * The value is persisted under `receipts.printing` rather than as a new
 * top-level settings section because `KNOWN_SECTIONS` on the backend drops
 * unknown sections while still answering HTTP 200 — a new section would look
 * saved and never persist.
 */
@Component({
  selector: 'app-print-formats-settings-form',
  standalone: true,
  imports: [ReactiveFormsModule, SelectorComponent, InputComponent],
  templateUrl: './print-formats-settings-form.component.html',
  styleUrls: ['./print-formats-settings-form.component.scss'],
})
export class PrintFormatsSettingsForm {
  /**
   * The whole `receipts` block, not just `receipts.printing`: the backward
   * compatibility migration needs the deprecated sibling keys
   * (`pos_ticket_format`, `pos_ticket_copies`, `invoice_format`,
   * `invoice_copies`) to seed the rows of stores that never opened this screen.
   */
  readonly receipts = input<ReceiptsSettings | undefined>(undefined);

  /** Emits the COMPLETE `printing` block; the parent merges it into `receipts`. */
  readonly printingChange = output<PrintingSettings>();

  readonly rows: ReadonlyArray<{ doc: PrintDocument; label: string }> =
    PRINT_DOCUMENTS.map((doc) => ({ doc, label: PRINT_DOCUMENT_LABELS[doc] }));

  readonly formatOptions: SelectorOption[] = PRINT_FORMATS.map((format) => ({
    value: format,
    label: PRINT_FORMAT_LABELS[format],
  }));

  /** 0 is a real choice: a document can be configured to never print. */
  readonly copiesOptions: SelectorOption[] = [
    { value: 0, label: 'No imprimir' },
    { value: 1, label: '1 copia' },
    { value: 2, label: '2 copias' },
    { value: 3, label: '3 copias' },
    { value: 4, label: '4 copias' },
    { value: 5, label: '5 copias' },
  ];

  readonly form = new FormGroup<PrintFormatsFormControls>(
    PRINT_DOCUMENTS.reduce((controls, doc) => {
      const fallback = PRINT_DEFAULTS[doc];
      controls[doc] = new FormGroup<PrintDocumentControls>({
        format: new FormControl<PrintFormat>(fallback.format, {
          nonNullable: true,
        }),
        margin_mm: new FormControl<number>(
          fallback.margin_mm ?? FALLBACK_MARGIN_MM,
          { nonNullable: true },
        ),
        copies: new FormControl<number>(fallback.copies ?? 1, {
          nonNullable: true,
        }),
      });
      return controls;
    }, {} as PrintFormatsFormControls),
  );

  /**
   * Mirror of every row's format. A `FormControl` is a plain object, not a
   * signal: reading `form.value` inside a `computed()` samples it once and never
   * recomputes, so the margin field would keep showing on a roll format after
   * the user switched to it. This signal is the reactive bridge.
   */
  private readonly formatByDocument = signal<Record<PrintDocument, PrintFormat>>(
    PRINT_DOCUMENTS.reduce(
      (acc, doc) => {
        acc[doc] = PRINT_DEFAULTS[doc].format;
        return acc;
      },
      {} as Record<PrintDocument, PrintFormat>,
    ),
  );

  /**
   * Which rows are on a roll format. On a roll there is no page to lay the
   * content out on — the paper is continuous and only the width is fixed — so
   * the margin does not apply and its field is hidden and disabled.
   */
  readonly rollByDocument = computed<Record<PrintDocument, boolean>>(() => {
    const formats = this.formatByDocument();
    return PRINT_DOCUMENTS.reduce(
      (acc, doc) => {
        acc[doc] = PRINT_PAGE_GEOMETRY[formats[doc]]?.is_roll ?? false;
        return acc;
      },
      {} as Record<PrintDocument, boolean>,
    );
  });

  /** Width hint shown next to each row so the choice is not just a label. */
  readonly widthByDocument = computed<Record<PrintDocument, number>>(() => {
    const formats = this.formatByDocument();
    return PRINT_DOCUMENTS.reduce(
      (acc, doc) => {
        acc[doc] = PRINT_PAGE_GEOMETRY[formats[doc]]?.width_mm ?? 0;
        return acc;
      },
      {} as Record<PrintDocument, number>,
    );
  });

  readonly minMargin = MIN_MARGIN_MM;
  readonly maxMargin = MAX_MARGIN_MM;

  constructor() {
    effect(() => {
      this.hydrate(this.receipts());
    });
  }

  /**
   * A format change can flip a row between roll and sheet, so the margin's
   * enabled state is re-synced before the value is emitted.
   */
  onFormatChange(doc: PrintDocument): void {
    this.formatByDocument.update((formats) => ({
      ...formats,
      [doc]: this.groupOf(doc).controls.format.value,
    }));
    this.syncMarginDisabled(doc);
    this.emit();
  }

  onFieldChange(): void {
    this.emit();
  }

  private groupOf(doc: PrintDocument): FormGroup<PrintDocumentControls> {
    return this.form.controls[doc];
  }

  /**
   * Seeds every row from `receipts.printing` and, where that is absent, from the
   * deprecated flat keys so a store that never opened this screen keeps printing
   * exactly as it did.
   *
   * Only the controls whose resolved value actually differs are patched: the
   * parent replaces the whole `receipts` object on every save, which re-runs
   * this effect, and a blanket `patchValue` would wipe what the user is typing
   * in the margin box at that moment.
   */
  private hydrate(receipts: ReceiptsSettings | undefined): void {
    const formats = { ...this.formatByDocument() };

    for (const doc of PRINT_DOCUMENTS) {
      const resolved = this.resolveConfig(receipts, doc);
      const group = this.groupOf(doc);

      if (group.controls.format.value !== resolved.format) {
        group.controls.format.setValue(resolved.format, { emitEvent: false });
      }
      if (Number(group.controls.margin_mm.value) !== resolved.margin_mm) {
        group.controls.margin_mm.setValue(resolved.margin_mm, {
          emitEvent: false,
        });
      }
      if (Number(group.controls.copies.value) !== resolved.copies) {
        group.controls.copies.setValue(resolved.copies, { emitEvent: false });
      }

      formats[doc] = resolved.format;
      this.syncMarginDisabled(doc, resolved.format);
    }

    this.formatByDocument.set(formats);
  }

  /**
   * Backward-compatibility cascade, per document:
   * `receipts.printing[doc]` → deprecated flat key → `PRINT_DEFAULTS[doc]`.
   *
   * The deprecated keys only apply when the document has NO entry in `printing`
   * at all; once this screen has been saved, `printing` is the sole authority.
   */
  private resolveConfig(
    receipts: ReceiptsSettings | undefined,
    doc: PrintDocument,
  ): { format: PrintFormat; margin_mm: number; copies: number } {
    const fallback = PRINT_DEFAULTS[doc];
    const stored = receipts?.printing?.[doc];
    const legacy = stored ? undefined : this.legacyConfig(receipts, doc);

    const format = stored?.format ?? legacy?.format ?? fallback.format;
    const copies =
      stored?.copies ?? legacy?.copies ?? fallback.copies ?? 1;
    const margin =
      stored?.margin_mm ?? fallback.margin_mm ?? FALLBACK_MARGIN_MM;

    return {
      format,
      margin_mm: this.clamp(margin, MIN_MARGIN_MM, MAX_MARGIN_MM),
      copies: this.clamp(copies, MIN_COPIES, MAX_COPIES),
    };
  }

  /**
   * The deprecated flat keys of `receipts`, mapped to the document they used to
   * govern. `invoice_format` was never read by any printer, but it is honoured
   * anyway when present: a merchant who set it did express an intent.
   */
  private legacyConfig(
    receipts: ReceiptsSettings | undefined,
    doc: PrintDocument,
  ): Partial<PrintDocumentConfig> | undefined {
    if (!receipts) return undefined;

    if (doc === 'pos_ticket') {
      return {
        format: receipts.pos_ticket_format,
        copies: receipts.pos_ticket_copies,
      };
    }
    if (doc === 'invoice') {
      return {
        format: receipts.invoice_format,
        copies: receipts.invoice_copies,
      };
    }
    return undefined;
  }

  /**
   * A disabled control is excluded from `form.value`, which is why the payload
   * is built from `getRawValue()`. Disabling is what stops a stale margin from
   * being submitted for a roll document.
   */
  private syncMarginDisabled(doc: PrintDocument, format?: PrintFormat): void {
    const group = this.groupOf(doc);
    const effectiveFormat = format ?? group.controls.format.value;
    const isRoll = PRINT_PAGE_GEOMETRY[effectiveFormat]?.is_roll ?? false;
    const control = group.controls.margin_mm;

    if (isRoll && control.enabled) {
      control.disable({ emitEvent: false });
    } else if (!isRoll && control.disabled) {
      control.enable({ emitEvent: false });
    }
  }

  /**
   * Always emits all 12 documents, never a partial patch: the parent writes the
   * result straight into `receipts.printing`, and a partial object would delete
   * the rows it omitted.
   */
  private emit(): void {
    const raw = this.form.getRawValue();
    const printing: PrintingSettings = {};

    for (const doc of PRINT_DOCUMENTS) {
      const value = raw[doc];
      const format = value.format;
      const config: PrintDocumentConfig = {
        format,
        copies: this.clamp(Number(value.copies), MIN_COPIES, MAX_COPIES),
      };

      // Roll documents carry no margin at all, matching `PRINT_DEFAULTS`.
      if (!PRINT_PAGE_GEOMETRY[format]?.is_roll) {
        config.margin_mm = this.clamp(
          Number(value.margin_mm),
          MIN_MARGIN_MM,
          MAX_MARGIN_MM,
        );
      }

      printing[doc] = config;
    }

    this.printingChange.emit(printing);
  }

  /** `app-input` writes its raw string into the control, hence the NaN guard. */
  private clamp(value: number, min: number, max: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    return Math.min(max, Math.max(min, Math.round(numeric)));
  }
}
