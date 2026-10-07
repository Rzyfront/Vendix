import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { BadgeComponent, BadgeVariant } from '../../../../../../shared/components/badge/badge.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { TooltipComponent } from '../../../../../../shared/components/tooltip/tooltip.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import { RelatedNote } from '../../../invoicing/interfaces/invoice.interface';
import { invoiceStatusTone } from '../../../invoicing/components/invoice-detail/invoice-fiscal-status.util';

/** Modelo de presentación de una factura (de la orden o de una cuenta). */
export interface InvoiceCardData {
  /** Clave estable para `track` y para el estado en vuelo de la página. */
  key: string;
  /** `null` mientras no exista documento (cuenta cobrada sin facturar). */
  invoiceId: number | null;
  invoiceNumber: string | null;
  status: string | null;
  dianStatus: string | null;
  total: number;
  customerName: string | null;
  /** Fecha de emisión (date-only o ISO); `null` si no se conoce. */
  date: string | null;
  /** «Cuenta 1»… sólo en órdenes divididas. */
  accountLabel: string | null;
}

export type InvoiceCardEmitMode = 'none' | 'emit' | 'retry';

interface BadgeSpec {
  label: string;
  variant: BadgeVariant;
}

/**
 * Tarjeta compacta de UNA factura electrónica: número, estado DIAN (app-badge),
 * total, cliente (1 línea), fecha y sólo acciones con ícono + tooltip. Las
 * notas crédito/débito cuelgan debajo como chips de una línea. Presentacional:
 * no hace requests, la página escucha los outputs.
 */
@Component({
  selector: 'app-invoice-status-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BadgeComponent, IconComponent, TooltipComponent, CurrencyPipe],
  template: `
    <div class="rounded-lg border border-border bg-surface px-3 py-2">
      <!-- Fila 1: número · estado · total -->
      <div class="flex items-center gap-2 min-w-0">
        <app-icon name="receipt" [size]="14" class="text-text-secondary shrink-0" />
        <span class="text-sm font-bold text-text-primary truncate min-w-0">{{ title() }}</span>
        <app-badge [variant]="badge().variant" size="xs" class="shrink-0">{{ badge().label }}</app-badge>
        <span class="ml-auto shrink-0 text-sm font-semibold tabular-nums text-text-primary">
          {{ data().total | currency }}
        </span>
      </div>

      <!-- Fila 2: cuenta · cliente · fecha -->
      <div class="mt-0.5 flex items-center gap-1.5 min-w-0 text-xs text-text-secondary">
        @if (data().accountLabel) {
          <span class="shrink-0 font-medium">{{ data().accountLabel }}</span>
          <span class="shrink-0" aria-hidden="true">·</span>
        }
        <span class="truncate min-w-0" [title]="customerLabel()">{{ customerLabel() }}</span>
        @if (dateLabel(); as d) {
          <span class="ml-auto shrink-0 tabular-nums">{{ d }}</span>
        }
      </div>

      @if (errorMessage(); as err) {
        <p class="mt-1 text-xs text-error truncate" [title]="err">{{ err }}</p>
      }

      <!-- Acciones: sólo íconos con tooltip -->
      @if (hasActions()) {
        <div class="mt-1.5 flex items-center justify-end gap-1">
          @if (emitMode() !== 'none') {
            <app-tooltip
              [content]="emitMode() === 'retry' ? 'Reintentar emisión' : 'Facturar en un clic'"
              size="sm"
            >
              <button
                type="button"
                class="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-xs font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed"
                [disabled]="emitting()"
                [attr.aria-label]="emitMode() === 'retry' ? 'Reintentar emisión' : 'Facturar'"
                (click)="emitRequested.emit()"
              >
                <app-icon
                  [name]="emitMode() === 'retry' ? 'refresh-cw' : 'receipt'"
                  [size]="14"
                  [spin]="emitting()"
                />
                {{ emitMode() === 'retry' ? 'Reintentar' : 'Facturar' }}
              </button>
            </app-tooltip>
          }
          @if (data().invoiceId) {
            <app-tooltip content="Ver detalle" size="sm">
              <button type="button" [class]="iconBtn" aria-label="Ver detalle" (click)="viewDetail.emit()">
                <app-icon name="eye" [size]="14" />
              </button>
            </app-tooltip>
            <app-tooltip content="Descargar PDF" size="sm">
              <button
                type="button"
                [class]="iconBtn"
                aria-label="Descargar PDF"
                [disabled]="pdfLoading()"
                (click)="downloadPdf.emit()"
              >
                <app-icon name="download" [size]="14" [spin]="pdfLoading()" />
              </button>
            </app-tooltip>
            <app-tooltip content="Imprimir" size="sm">
              <button
                type="button"
                [class]="iconBtn"
                aria-label="Imprimir"
                [disabled]="printing()"
                (click)="print.emit()"
              >
                <app-icon name="printer" [size]="14" [spin]="printing()" />
              </button>
            </app-tooltip>
            @if (canCreditNote()) {
              <app-tooltip content="Nota crédito (abre el detalle)" size="sm">
                <button type="button" [class]="iconBtn" aria-label="Nota crédito" (click)="creditNote.emit()">
                  <app-icon name="file-minus" [size]="14" />
                </button>
              </app-tooltip>
            }
          }
        </div>
      }

      <!-- Notas crédito / débito -->
      @if (notes().length) {
        <div class="mt-1.5 space-y-1 border-l-2 border-border pl-2">
          @for (note of notes(); track note.id) {
            <div class="flex items-center gap-1.5 min-w-0 text-[11px] leading-tight">
              <app-badge variant="neutral" size="xs" class="shrink-0">{{ noteKind(note) }}</app-badge>
              <span class="shrink-0 font-semibold text-text-primary">{{ note.invoice_number || 'Sin número' }}</span>
              <app-badge [variant]="noteVariant(note)" size="xs" class="shrink-0">{{ noteStatus(note) }}</app-badge>
              <span class="shrink-0 tabular-nums text-text-primary">{{ note.total_amount | currency }}</span>
              <span class="shrink-0 tabular-nums text-text-secondary">{{ noteDate(note) }}</span>
              @if (note.note_concept_code) {
                <span class="truncate min-w-0 text-text-secondary" [title]="note.note_concept_code">
                  {{ note.note_concept_code }}
                </span>
              }
              <app-tooltip content="Ver detalle" size="sm" class="ml-auto shrink-0">
                <button
                  type="button"
                  class="inline-flex h-5 w-5 items-center justify-center rounded text-text-secondary hover:bg-surface-secondary"
                  aria-label="Ver detalle de la nota"
                  (click)="viewNote.emit(note)"
                >
                  <app-icon name="eye" [size]="12" />
                </button>
              </app-tooltip>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class InvoiceStatusCardComponent {
  readonly data = input.required<InvoiceCardData>();
  readonly notes = input<RelatedNote[]>([]);
  /** `emit` = Facturar (sin factura vigente); `retry` = la emisión falló. */
  readonly emitMode = input<InvoiceCardEmitMode>('none');
  readonly emitting = input(false);
  readonly pdfLoading = input(false);
  readonly printing = input(false);
  readonly canCreditNote = input(false);
  readonly errorMessage = input<string | null>(null);

  readonly viewDetail = output<void>();
  readonly downloadPdf = output<void>();
  readonly print = output<void>();
  readonly emitRequested = output<void>();
  readonly creditNote = output<void>();
  readonly viewNote = output<RelatedNote>();

  protected readonly iconBtn =
    'inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-secondary hover:bg-surface-secondary disabled:opacity-60 disabled:cursor-not-allowed';

  readonly hasActions = computed(
    () => this.emitMode() !== 'none' || !!this.data().invoiceId,
  );

  readonly title = computed(() => {
    const d = this.data();
    if (!d.invoiceId && !d.invoiceNumber) return 'Sin factura';
    return d.invoiceNumber || 'Sin número';
  });

  readonly customerLabel = computed(
    () => this.data().customerName?.trim() || 'Consumidor final',
  );

  readonly dateLabel = computed(() => {
    const raw = this.data().date;
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : formatDateOnlyUTC(raw);
  });

  /** Estado → app-badge: aceptada verde, rechazada/error rojo, pendiente
   *  ámbar, borrador/sin facturar neutro. */
  readonly badge = computed<BadgeSpec>(() => {
    const d = this.data();
    if (!d.invoiceId && !d.invoiceNumber) {
      return { label: 'Sin facturar', variant: 'neutral' };
    }
    if (d.status === 'cancelled') return { label: 'Cancelada', variant: 'neutral' };
    if (d.status === 'voided') return { label: 'Anulada', variant: 'neutral' };
    if (d.dianStatus === 'accepted') return { label: 'Aceptada DIAN', variant: 'success' };
    if (d.dianStatus === 'rejected') return { label: 'Rechazada DIAN', variant: 'error' };
    if (d.dianStatus === 'error') return { label: 'Error DIAN', variant: 'error' };
    switch (d.status) {
      case 'accepted':
        return { label: 'Aceptada', variant: 'success' };
      case 'rejected':
        return { label: 'Rechazada', variant: 'error' };
      case 'draft':
        return { label: 'Borrador', variant: 'neutral' };
      case 'validated':
        return { label: 'Validada', variant: 'warning' };
      case 'sent':
        return { label: 'Enviada', variant: 'warning' };
      default:
        return d.dianStatus === 'pending'
          ? { label: 'Pendiente DIAN', variant: 'warning' }
          : { label: 'En proceso', variant: 'warning' };
    }
  });

  noteKind(note: RelatedNote): string {
    return note.invoice_type === 'credit_note' ? 'NC' : 'ND';
  }

  noteStatus(note: RelatedNote): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      validated: 'Validada',
      sent: 'Enviada',
      accepted: 'Aceptada',
      rejected: 'Rechazada',
      cancelled: 'Cancelada',
      voided: 'Anulada',
    };
    return labels[note.status] ?? note.status;
  }

  noteVariant(note: RelatedNote): BadgeVariant {
    switch (invoiceStatusTone(note.status)) {
      case 'success':
        return 'success';
      case 'error':
        return 'error';
      case 'warning':
        return 'warning';
      case 'info':
        return 'warning';
      default:
        return 'neutral';
    }
  }

  noteDate(note: RelatedNote): string {
    const parsed = new Date(note.issue_date);
    return Number.isNaN(parsed.getTime())
      ? ''
      : parsed.toLocaleDateString('es-CO', {
          timeZone: 'UTC',
          day: 'numeric',
          month: 'short',
        });
  }
}
