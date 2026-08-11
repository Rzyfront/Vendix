import { Component, computed, effect, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

import {
  PRINT_DEFAULTS,
  PRINT_DOCUMENTS,
  PRINT_FORMATS,
  PRINT_PAGE_GEOMETRY,
  PrintDocument,
  PrintDocumentConfig,
  PrintFormat,
  PrintingSettings,
  ReceiptsSettings,
} from '../../../../../../../core/models/store-settings.interface';
import { AlertBannerComponent } from '../../../../../../../shared/components/alert-banner/alert-banner.component';
import { ExpandableCardComponent } from '../../../../../../../shared/components/expandable-card/expandable-card.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { PrintFormatChipComponent } from './print-format-chip.component';
import {
  NARROW_RISK_DOCUMENTS,
  PRINT_FORMAT_SHORT_LABELS,
  buildPrintFamilies,
} from './print-formats.copy';

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

/** What the template needs to know about one row, all of it reactive. */
interface PrintRowState {
  format: PrintFormat;
  margin_mm: number;
  copies: number;
}

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
 * A4. Every one of the 12 `PRINT_DOCUMENTS` gets its own row here, grouped into
 * families by the moment its paper is used — see `print-formats.copy.ts`.
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
  imports: [
    ReactiveFormsModule,
    AlertBannerComponent,
    ExpandableCardComponent,
    IconComponent,
    InputComponent,
    PrintFormatChipComponent,
  ],
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

  /** The 12 documents, grouped. Resolved against `PRINT_DOCUMENTS`, never hardcoded. */
  readonly families = buildPrintFamilies();

  readonly formats: readonly PrintFormat[] = PRINT_FORMATS;

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
   * Mirror of every row's resolved values. A `FormControl` is a plain object, not
   * a signal: reading `form.value` inside a `computed()` samples it once and
   * never recomputes, so the margin field would keep showing on a roll format
   * after the user switched to it, and the "Por defecto" badge would freeze on
   * whatever the row was when the screen opened. This signal is the reactive
   * bridge.
   */
  private readonly rowByDocument = signal<Record<PrintDocument, PrintRowState>>(
    PRINT_DOCUMENTS.reduce(
      (acc, doc) => {
        const fallback = PRINT_DEFAULTS[doc];
        acc[doc] = {
          format: fallback.format,
          margin_mm: fallback.margin_mm ?? FALLBACK_MARGIN_MM,
          copies: fallback.copies ?? 1,
        };
        return acc;
      },
      {} as Record<PrintDocument, PrintRowState>,
    ),
  );

  /** Read by the template for the chips, the stepper and the margin note. */
  readonly rowState = this.rowByDocument.asReadonly();

  /**
   * Which rows are on a roll format. On a roll there is no page to lay the
   * content out on — the paper is continuous and only the width is fixed — so
   * the margin does not apply and its field is hidden and disabled.
   */
  readonly rollByDocument = computed<Record<PrintDocument, boolean>>(() => {
    const rows = this.rowByDocument();
    return PRINT_DOCUMENTS.reduce(
      (acc, doc) => {
        acc[doc] = PRINT_PAGE_GEOMETRY[rows[doc].format]?.is_roll ?? false;
        return acc;
      },
      {} as Record<PrintDocument, boolean>,
    );
  });

  /**
   * Rows that still hold exactly what the print engine would use with no stored
   * configuration at all. Surfaced as a badge so the merchant can tell what they
   * changed from what they never touched.
   *
   * The margin is only part of the comparison on a sheet: on a roll it is not
   * emitted and the engine forces it to 0, so it cannot make a row differ.
   */
  readonly isDefaultByDocument = computed<Record<PrintDocument, boolean>>(() => {
    const rows = this.rowByDocument();
    return PRINT_DOCUMENTS.reduce(
      (acc, doc) => {
        const fallback = PRINT_DEFAULTS[doc];
        const row = rows[doc];
        const isRoll = PRINT_PAGE_GEOMETRY[row.format]?.is_roll ?? false;
        acc[doc] =
          row.format === fallback.format &&
          row.copies === (fallback.copies ?? 1) &&
          (isRoll ||
            row.margin_mm === (fallback.margin_mm ?? FALLBACK_MARGIN_MM));
        return acc;
      },
      {} as Record<PrintDocument, boolean>,
    );
  });

  /**
   * Inline warning for a long, multi-column document sent to a roll. Advisory
   * only: a shop whose single printer is thermal has to be able to choose it.
   */
  readonly narrowWarningByDocument = computed<Record<PrintDocument, string>>(
    () => {
      const rows = this.rowByDocument();
      return PRINT_DOCUMENTS.reduce(
        (acc, doc) => {
          const geometry = PRINT_PAGE_GEOMETRY[rows[doc].format];
          acc[doc] =
            geometry?.is_roll && NARROW_RISK_DOCUMENTS.has(doc)
              ? `Este documento es largo y lleva tablas anchas: en un rollo de ${geometry.width_mm} mm queda muy angosto y las columnas pueden salir cortadas. Se imprime igual.`
              : '';
          return acc;
        },
        {} as Record<PrintDocument, string>,
      );
    },
  );

  /** One-line recap of the row, shown on the collapsed advanced header. */
  readonly summaryByDocument = computed<Record<PrintDocument, string>>(() => {
    const rows = this.rowByDocument();
    return PRINT_DOCUMENTS.reduce(
      (acc, doc) => {
        const row = rows[doc];
        const isRoll = PRINT_PAGE_GEOMETRY[row.format]?.is_roll ?? false;
        const parts = [PRINT_FORMAT_SHORT_LABELS[row.format]];
        if (!isRoll) parts.push(`margen ${row.margin_mm} mm`);
        parts.push(
          row.copies === 0
            ? 'solo impresión manual'
            : `${row.copies} ${row.copies === 1 ? 'copia' : 'copias'}`,
        );
        acc[doc] = parts.join(' · ');
        return acc;
      },
      {} as Record<PrintDocument, string>,
    );
  });

  /** Rows whose advanced block is open. Collapsed by default: 12 open rows do not fit. */
  private readonly expandedDocuments = signal<ReadonlySet<PrintDocument>>(
    new Set<PrintDocument>(),
  );

  readonly minMargin = MIN_MARGIN_MM;
  readonly maxMargin = MAX_MARGIN_MM;
  readonly minCopies = MIN_COPIES;
  readonly maxCopies = MAX_COPIES;

  constructor() {
    effect(() => {
      this.hydrate(this.receipts());
    });
  }

  isExpanded(doc: PrintDocument): boolean {
    return this.expandedDocuments().has(doc);
  }

  setExpanded(doc: PrintDocument, expanded: boolean): void {
    this.expandedDocuments.update((open) => {
      const next = new Set(open);
      if (expanded) {
        next.add(doc);
      } else {
        next.delete(doc);
      }
      return next;
    });
  }

  /** The control the margin box binds to. Bound directly, without a `formGroupName`
   * wrapper, so the box keeps working inside the projected body of the expandable
   * card. */
  marginControl(doc: PrintDocument): FormControl<number> {
    return this.groupOf(doc).controls.margin_mm;
  }

  /**
   * A format change can flip a row between roll and sheet, so the margin's
   * enabled state is re-synced before the value is emitted.
   */
  selectFormat(doc: PrintDocument, format: PrintFormat): void {
    const control = this.groupOf(doc).controls.format;
    if (control.value === format) return;

    control.setValue(format, { emitEvent: false });
    this.syncMarginDisabled(doc, format);
    this.refreshRow(doc);
    this.emit();
  }

  changeCopies(doc: PrintDocument, delta: number): void {
    const control = this.groupOf(doc).controls.copies;
    const next = this.clamp(Number(control.value) + delta, MIN_COPIES, MAX_COPIES);
    if (next === Number(control.value)) return;

    control.setValue(next, { emitEvent: false });
    this.refreshRow(doc);
    this.emit();
  }

  onMarginChange(doc: PrintDocument): void {
    this.refreshRow(doc);
    this.emit();
  }

  /** Returns the row to exactly what the engine would resolve with nothing stored. */
  resetToDefault(doc: PrintDocument): void {
    const fallback = PRINT_DEFAULTS[doc];
    const group = this.groupOf(doc);

    group.controls.format.setValue(fallback.format, { emitEvent: false });
    group.controls.margin_mm.setValue(
      fallback.margin_mm ?? FALLBACK_MARGIN_MM,
      { emitEvent: false },
    );
    group.controls.copies.setValue(fallback.copies ?? 1, { emitEvent: false });

    this.syncMarginDisabled(doc, fallback.format);
    this.refreshRow(doc);
    this.emit();
  }

  /** How many copies each print takes, said in words next to the stepper. */
  copiesHint(copies: number): string {
    // Verified against `DocumentPrintService`: `trigger: 'automatic'` honours a
    // configured 0 and prints nothing, while `'explicit'` clamps to
    // `Math.max(1, copies)` — refusing to print after a click reads as a broken
    // button, so a manual print always yields paper.
    if (copies === 0) {
      return 'Las impresiones automáticas quedan desactivadas. Si alguien pulsa Imprimir, siempre sale al menos una copia.';
    }
    return copies === 1
      ? 'Cada impresión saca 1 copia.'
      : `Cada impresión saca ${copies} copias.`;
  }

  private refreshRow(doc: PrintDocument): void {
    const raw = this.groupOf(doc).getRawValue();
    const next: PrintRowState = {
      format: raw.format,
      margin_mm: this.clamp(Number(raw.margin_mm), MIN_MARGIN_MM, MAX_MARGIN_MM),
      copies: this.clamp(Number(raw.copies), MIN_COPIES, MAX_COPIES),
    };
    this.rowByDocument.update((rows) => ({ ...rows, [doc]: next }));
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
    // Built from scratch, NEVER seeded from `rowByDocument()`. This method runs
    // inside an `effect` and writes that same signal at the end, so reading it
    // here would make the effect depend on its own output: `set` receives a
    // fresh object literal every time, reference equality always fails, the
    // signal always notifies, and the effect re-runs forever — an infinite loop
    // that freezes the settings screen with an out-of-memory error.
    //
    // The loop below assigns every entry of `PRINT_DOCUMENTS`, so no part of the
    // previous value was ever needed.
    const rows = {} as Record<PrintDocument, PrintRowState>;

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

      rows[doc] = resolved;
      this.syncMarginDisabled(doc, resolved.format);
    }

    this.rowByDocument.set(rows);
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
  ): PrintRowState {
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
