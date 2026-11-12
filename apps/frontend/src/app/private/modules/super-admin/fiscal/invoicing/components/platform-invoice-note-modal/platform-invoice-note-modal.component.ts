import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import {
  AlertBannerComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../../shared/components';
import { CurrencyPipe as VendixCurrencyPipe } from '../../../../../../../shared/pipes/currency';
import {
  DIAN_CREDIT_NOTE_CONCEPTS,
  DIAN_DEBIT_NOTE_CONCEPTS,
} from '../../../../../store/invoicing/components/invoice-note-create/dian-note-concepts';
import { describeApiFailure } from '../../../../../store/invoicing/utils/invoicing-errors.util';
import type {
  PlatformInvoiceNotesInfo,
  PlatformNoteDocumentType,
  PlatformNoteResult,
} from '../../../../subscriptions/interfaces/fiscal-billing.interface';
import { FiscalBillingAdminService } from '../../../../subscriptions/services/fiscal-billing-admin.service';
import { transmissionStatusLabel } from '../../platform-invoicing.constants';
import {
  NOTE_REASON_MAX_LENGTH,
  buildPlatformNotePayload,
  estimateLineTotal,
  estimateLinesTotal,
  exceedsCreditBalance,
  toNumber,
  validatePlatformNote,
  type PlatformNoteFormLine,
} from './platform-invoice-note-payload.util';

/**
 * Reads the most specific, human-readable message of a failed note request.
 * The backend sends Spanish `message`s for balance/series failures (AC2/AC3);
 * validation failures fall back to the shared parser.
 */
function readNoteError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const raw = (err.error as { message?: unknown } | null)?.message;
    if (typeof raw === 'string' && raw.trim() && raw !== 'Validation failed') {
      return raw;
    }
  }
  return describeApiFailure(err).message;
}

@Component({
  selector: 'app-platform-invoice-note-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    VendixCurrencyPipe,
    AlertBannerComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    SelectorComponent,
    TextareaComponent,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      [title]="title()"
      [subtitle]="subtitle()"
      size="lg"
    >
      @if (loading()) {
        <div class="p-8 text-center text-sm text-text-secondary">
          Cargando datos de la factura…
        </div>
      } @else if (loadError(); as err) {
        <div class="p-4">
          <app-alert-banner variant="danger">{{ err }}</app-alert-banner>
        </div>
      } @else if (info(); as data) {
        <div class="p-4 space-y-4">
          @if (!data.can_create_notes) {
            <app-alert-banner variant="warning">
              {{ data.blocked_reason || 'Esta factura no admite notas crédito o débito.' }}
            </app-alert-banner>
          }

          <div class="rounded-card border border-border bg-surface-secondary p-3 text-xs grid grid-cols-2 gap-2">
            <div>
              <p class="text-text-secondary">Factura</p>
              <p class="font-medium text-text-primary">{{ data.invoice.document_number ?? '—' }}</p>
            </div>
            <div>
              <p class="text-text-secondary">Cliente</p>
              <p class="font-medium text-text-primary truncate">{{ data.invoice.customer_name ?? '—' }}</p>
            </div>
            <div>
              <p class="text-text-secondary">Total de la factura</p>
              <p class="font-medium text-text-primary">{{ invoiceTotal() | currency }}</p>
            </div>
            <div>
              <p class="text-text-secondary">Saldo acreditable</p>
              <p class="font-medium text-text-primary">{{ creditBalance() | currency }}</p>
            </div>
          </div>

          <app-selector
            label="Concepto DIAN"
            placeholder="Selecciona el concepto"
            [required]="true"
            [options]="conceptOptions()"
            [ngModel]="conceptCode()"
            (ngModelChange)="conceptCode.set($event)"
            [helpText]="conceptHint()"
          />

          <app-textarea
            label="Motivo"
            placeholder="Explica qué ocurrió y por qué se emite la nota"
            [required]="true"
            [rows]="3"
            [helperText]="reason().length + ' / ' + reasonMax"
            [ngModel]="reason()"
            (ngModelChange)="reason.set($event ?? '')"
          />

          @if (isCredit()) {
            <div class="flex gap-2" role="group" aria-label="Alcance de la nota crédito">
              <app-button
                size="sm"
                [variant]="mode() === 'total' ? 'primary' : 'outline'"
                (clicked)="mode.set('total')"
              >
                Total
              </app-button>
              <app-button
                size="sm"
                [variant]="mode() === 'lines' ? 'primary' : 'outline'"
                (clicked)="mode.set('lines')"
              >
                Por líneas
              </app-button>
            </div>
          }

          @if (showLines()) {
            <div class="space-y-3">
              @for (line of lines(); track $index; let i = $index) {
                <div class="rounded-card border border-border p-3 space-y-2">
                  <div class="flex items-start gap-2">
                    <div class="flex-1 min-w-0">
                      <app-input
                        label="Descripción"
                        [ngModel]="line.description"
                        (ngModelChange)="patchLine(i, { description: $event ?? '' })"
                      />
                    </div>
                    <app-button
                      variant="ghost"
                      size="sm"
                      ariaLabel="Quitar línea"
                      (clicked)="removeLine(i)"
                    >
                      <app-icon slot="icon" name="trash-2" [size]="14"></app-icon>
                    </app-button>
                  </div>
                  <div class="grid grid-cols-2 gap-2">
                    <app-input
                      label="Cantidad"
                      type="number"
                      [min]="0"
                      [step]="1"
                      [ngModel]="line.quantity"
                      (ngModelChange)="patchLine(i, { quantity: toNum($event) })"
                    />
                    <app-input
                      label="Precio unitario"
                      [currency]="true"
                      [ngModel]="line.unit_price"
                      (ngModelChange)="patchLine(i, { unit_price: toNum($event) })"
                    />
                  </div>
                  <p class="text-xs text-text-secondary text-right">
                    Línea (con impuestos): {{ lineTotal(line) | currency }}
                  </p>
                </div>
              }
              <app-button variant="outline" size="sm" (clicked)="addLine()">
                <app-icon slot="icon" name="plus" [size]="14"></app-icon>
                Agregar línea
              </app-button>
            </div>
          } @else {
            <p class="text-xs text-text-secondary">
              La nota total copia todas las líneas de la factura {{ data.invoice.document_number }}.
            </p>
          }

          <div class="rounded-card border border-border bg-surface p-3 text-sm space-y-1">
            <div class="flex justify-between font-semibold text-text-primary">
              <span>Total de la nota (estimado)</span>
              <span>{{ noteTotal() | currency }}</span>
            </div>
            @if (isCredit()) {
              <div class="flex justify-between text-xs text-text-secondary">
                <span>Saldo acreditable restante</span>
                <span>{{ remainingBalance() | currency }}</span>
              </div>
            }
            <p class="text-[11px] text-text-secondary">
              El servidor calcula el valor final con los impuestos de la factura.
            </p>
          </div>

          @if (overBalance()) {
            <app-alert-banner variant="danger">
              El valor de la nota crédito supera el saldo acreditable de la factura
              ({{ creditBalance() | currency }}). Reduce los valores o cambia a una nota por líneas.
            </app-alert-banner>
          }

          @if (submitError(); as msg) {
            <app-alert-banner variant="danger">
              {{ msg }}
              @if (isSeriesError()) {
                <a
                  routerLink="/super-admin/fiscal/invoicing/resolutions"
                  class="block mt-1 font-medium underline"
                  (click)="isOpen.set(false)"
                >
                  Ir a Resoluciones
                </a>
              }
            </app-alert-banner>
          }
        </div>
      }

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="outline" (clicked)="isOpen.set(false)">Cancelar</app-button>
        <app-button
          variant="primary"
          [loading]="submitting()"
          [disabled]="!canSubmit()"
          (clicked)="onSubmit()"
        >
          Emitir
        </app-button>
      </div>
    </app-modal>
  `,
})
export class PlatformInvoiceNoteModalComponent {
  readonly isOpen = model<boolean>(false);
  /** `fiscal_transmissions.id` of the original invoice. */
  readonly invoiceId = input<number | null>(null);
  readonly noteType = input<PlatformNoteDocumentType>('credit_note');
  readonly created = output<PlatformNoteResult>();

  private readonly fiscal = inject(FiscalBillingAdminService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly reasonMax = NOTE_REASON_MAX_LENGTH;
  readonly toNum = toNumber;
  readonly lineTotal = estimateLineTotal;

  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly info = signal<PlatformInvoiceNotesInfo | null>(null);
  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);

  readonly conceptCode = signal('');
  readonly reason = signal('');
  readonly mode = signal<'total' | 'lines'>('total');
  readonly lines = signal<PlatformNoteFormLine[]>([]);

  readonly isCredit = computed(() => this.noteType() === 'credit_note');
  readonly title = computed(() =>
    this.isCredit() ? 'Nueva nota crédito' : 'Nueva nota débito',
  );
  readonly subtitle = computed(() => {
    const number = this.info()?.invoice.document_number;
    return number ? `Sobre la factura ${number}` : undefined;
  });

  readonly conceptOptions = computed(() =>
    (this.isCredit() ? DIAN_CREDIT_NOTE_CONCEPTS : DIAN_DEBIT_NOTE_CONCEPTS).map(
      (c) => ({ value: c.code, label: c.label }),
    ),
  );
  readonly conceptHint = computed(() => {
    const list = this.isCredit() ? DIAN_CREDIT_NOTE_CONCEPTS : DIAN_DEBIT_NOTE_CONCEPTS;
    return list.find((c) => c.code === this.conceptCode())?.hint ?? '';
  });

  /** Debit notes always go by lines; credit notes choose. */
  readonly showLines = computed(() => !this.isCredit() || this.mode() === 'lines');

  readonly invoiceTotal = computed(() => toNumber(this.info()?.invoice.total));
  readonly creditBalance = computed(() => toNumber(this.info()?.credit_balance));

  readonly noteTotal = computed(() =>
    this.showLines() ? estimateLinesTotal(this.lines()) : this.invoiceTotal(),
  );
  readonly remainingBalance = computed(
    () => Math.round((this.creditBalance() - this.noteTotal()) * 100) / 100,
  );
  readonly overBalance = computed(
    () => this.isCredit() && exceedsCreditBalance(this.noteTotal(), this.creditBalance()),
  );

  readonly isSeriesError = computed(() => /serie activa/i.test(this.submitError() ?? ''));

  readonly canSubmit = computed(
    () =>
      !!this.info()?.can_create_notes &&
      !this.submitting() &&
      !this.overBalance() &&
      this.validationErrors().length === 0,
  );

  private readonly validationErrors = computed(() => {
    const id = this.invoiceId();
    if (!id) return ['invoice'];
    return validatePlatformNote({
      relatedInvoiceId: id,
      noteType: this.noteType(),
      conceptCode: this.conceptCode(),
      reason: this.reason(),
      mode: this.mode(),
      lines: this.lines(),
    });
  });

  constructor() {
    effect(() => {
      const open = this.isOpen();
      const id = this.invoiceId();
      if (open && id) {
        untracked(() => this.load(id));
      }
    });
  }

  private load(id: number): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.submitError.set(null);
    this.conceptCode.set('');
    this.reason.set('');
    this.mode.set('total');
    this.fiscal
      .getPlatformInvoiceNotes(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.info.set(data);
          this.lines.set(this.prefillLines(data));
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.info.set(null);
          this.loadError.set(readNoteError(err));
          this.loading.set(false);
        },
      });
  }

  /** Credit: every original line. Debit: one blank line to fill in. */
  private prefillLines(data: PlatformInvoiceNotesInfo): PlatformNoteFormLine[] {
    if (!this.isCredit()) {
      return [this.blankLine(data)];
    }
    return data.lines.map((l) => ({
      description: l.description,
      quantity: toNumber(l.quantity),
      unit_price: toNumber(l.unit_price),
      unit_code: l.unit_code,
      tax_rate: toNumber(l.tax_rate),
    }));
  }

  private blankLine(data: PlatformInvoiceNotesInfo | null): PlatformNoteFormLine {
    return {
      description: '',
      quantity: 1,
      unit_price: 0,
      unit_code: null,
      tax_rate: toNumber(data?.lines[0]?.tax_rate),
    };
  }

  patchLine(index: number, patch: Partial<PlatformNoteFormLine>): void {
    this.lines.update((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  removeLine(index: number): void {
    this.lines.update((rows) => rows.filter((_, i) => i !== index));
  }

  addLine(): void {
    this.lines.update((rows) => [...rows, this.blankLine(this.info())]);
  }

  onSubmit(): void {
    const id = this.invoiceId();
    if (!id || !this.canSubmit()) return;
    const type = this.noteType();
    const dto = buildPlatformNotePayload({
      relatedInvoiceId: id,
      noteType: type,
      conceptCode: this.conceptCode(),
      reason: this.reason(),
      mode: this.mode(),
      lines: this.lines(),
    });
    this.submitting.set(true);
    this.submitError.set(null);
    const request$ =
      type === 'credit_note'
        ? this.fiscal.createPlatformCreditNote(dto)
        : this.fiscal.createPlatformDebitNote(dto);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.submitting.set(false);
        this.announce(result);
        this.created.emit(result);
        this.isOpen.set(false);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.submitError.set(readNoteError(err));
      },
    });
  }

  private announce(result: PlatformNoteResult): void {
    const label = result.document_type === 'credit_note' ? 'Nota crédito' : 'Nota débito';
    const status = transmissionStatusLabel(result.dian_status);
    const text = `${label} ${result.document_number ?? ''} · DIAN: ${status}`.trim();
    if (result.error_message || result.dian_status === 'rejected') {
      this.toast.warning(
        `${text}. ${result.error_message ?? 'La DIAN rechazó la nota; puedes reintentar desde el listado.'}`,
        'Nota emitida con observaciones',
        6000,
      );
    } else {
      this.toast.success(text, 'Nota emitida', 4000);
    }
  }
}
