import { Component, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';

import { InvoiceDataRequestService } from '../../services/invoice-data-request.service';
import type {
  InvoiceDataRequestRow,
  InvoiceDataRequestStatus,
} from '../../interfaces/invoice-data-request.interface';
import { describeApiFailure } from '../../utils/invoicing-errors.util';
import {
  FiscalTone,
  toneClasses,
} from '../invoice-detail/invoice-fiscal-status.util';

/**
 * Un identificador en MAYÚSCULAS_CON_GUIONES no es un mensaje.
 *
 * Este controlador es el único de la familia que todavía lanza
 * `NotFoundException('INVOICE_DATA_REQUEST_NOT_FOUND_OR_NOT_SUBMITTED')` en vez
 * de un `VendixHttpException` con su `ErrorCodes`. Sin `error_code`,
 * `describeApiFailure` no tiene catálogo al que ir y devuelve ese literal tal
 * cual — al comerciante le aparecería el nombre de una constante. Se detecta por
 * su forma y se cambia por el texto de respaldo. El arreglo de verdad es del
 * backend y está reportado; esto sólo evita que la fuga llegue a la pantalla.
 */
function humanize(message: string, fallback: string): string {
  const looksLikeCode = /^[A-Z0-9_]{6,}$/.test(message.trim());
  return !message.trim() || looksLikeCode ? fallback : message;
}

/** Copy en español de `invoice_data_request_status_enum`. */
const STATUS_LABELS: Record<InvoiceDataRequestStatus, string> = {
  pending: 'Enlace enviado, sin datos',
  submitted: 'Datos recibidos, sin procesar',
  processing: 'Procesando',
  completed: 'Factura emitida',
  expired: 'Enlace vencido',
  failed: 'Falló la conversión',
};

/**
 * Se reutiliza `FiscalTone` en vez de escribir clases sueltas: el módulo ya
 * tiene un vocabulario de tonos mapeado a tokens del tema, y una tabla paralela
 * con hex o utilidades propias se despinta en modo oscuro sin que nadie lo note.
 */
const STATUS_TONES: Record<InvoiceDataRequestStatus, FiscalTone> = {
  pending: 'neutral',
  submitted: 'warning',
  processing: 'info',
  completed: 'success',
  expired: 'neutral',
  failed: 'error',
};

/**
 * SOLICITUDES DE FACTURA A NOMBRE DEL CLIENTE.
 *
 * `GET /store/invoice-data-requests` y `POST :id/process` estaban completos en el
 * backend y NO TENÍAN UN SOLO CLIENTE. El listener automático convierte la venta
 * CF en factura nominativa apenas el cliente manda sus datos, y cuando esa
 * conversión falla deja la fila en `failed` con un log que dice «use the admin
 * process endpoint to retry». Ese reintento era imposible desde el producto: no
 * había pantalla que listara las solicitudes ni botón que las reprocesara. Un
 * cliente que pidió su factura y cuya conversión reventó quedaba esperando en
 * silencio, sin que nadie en la tienda pudiera enterarse.
 *
 * ## Por qué el botón sólo aparece en `submitted`
 *
 * `processRequest` reclama la fila con un compare-and-swap sobre
 * `status: 'submitted'`. Sobre cualquier otro estado el POST responde 200 con
 * `data: null` y no hace nada. Ofrecer el botón ahí sería ofrecer un no-op que
 * parece un reintento. En `failed` se explica en su lugar de dónde se sale, que
 * es lo que el comerciante necesita saber.
 */
@Component({
  selector: 'app-invoice-data-requests-page',
  standalone: true,
  imports: [
    DatePipe,
    NgClass,
    FormsModule,
    ButtonComponent,
    IconComponent,
    SelectorComponent,
  ],
  template: `
    <div class="w-full space-y-4">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div class="min-w-[220px]">
          <app-selector
            label="Estado"
            [options]="statusOptions"
            [ngModel]="statusFilter()"
            (ngModelChange)="onStatusChange($event)"
            placeholder="Todos los estados"
          ></app-selector>
        </div>
        <app-button variant="ghost" [loading]="loading()" (clicked)="load()">
          <app-icon slot="icon" name="refresh-cw" [size]="14"></app-icon>
          Actualizar
        </app-button>
      </div>

      @if (error(); as message) {
        <div
          class="flex gap-2 p-3 rounded-lg border border-error bg-[var(--color-surface-secondary)]"
        >
          <app-icon name="alert-circle" [size]="16" class="text-error shrink-0 mt-0.5" />
          <p class="text-sm text-text-secondary">{{ message }}</p>
        </div>
      }

      @if (loading()) {
        <p class="text-sm text-text-secondary">Cargando solicitudes…</p>
      } @else {
        <div class="space-y-2">
          @for (row of rows(); track row.id) {
            <div class="p-3 rounded-lg border border-border space-y-2">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-sm font-semibold text-text-primary">
                    {{ row.order?.order_number || 'Orden #' + row.order_id }}
                  </span>
                  <span
                    class="px-2 py-0.5 text-[11px] font-medium rounded-full"
                    [ngClass]="statusClass(row.status)"
                    >{{ statusLabel(row.status) }}</span
                  >
                </div>
                @if (row.order?.grand_total != null) {
                  <span class="text-sm text-text-primary">
                    {{ money(row.order!.grand_total) }}
                  </span>
                }
              </div>

              <div class="text-xs text-text-secondary space-y-0.5">
                <p>{{ customerLine(row) }}</p>
                <p>
                  Solicitada:
                  {{ (row.submitted_at || row.created_at) | date: 'dd/MM/yyyy HH:mm' }}
                  @if (row.processed_at) {
                    <span> · Procesada: {{ row.processed_at | date: 'dd/MM/yyyy HH:mm' }}</span>
                  }
                </p>
                @if (row.new_invoice_id) {
                  <p>Factura nominativa emitida: #{{ row.new_invoice_id }}</p>
                }
              </div>

              @if (row.status === 'submitted') {
                <div class="flex justify-end">
                  <app-button
                    variant="primary"
                    size="sm"
                    [loading]="processingId() === row.id"
                    [disabled]="processingId() !== null"
                    (clicked)="process(row)"
                    >Procesar ahora</app-button
                  >
                </div>
              } @else if (row.status === 'failed') {
                <p class="text-xs text-error">
                  La conversión automática falló. El reintento sólo corre sobre
                  solicitudes con los datos recibidos y sin procesar; revisa el
                  registro de la orden antes de volver a pedirle los datos al
                  cliente.
                </p>
              }
            </div>
          } @empty {
            <div class="p-6 text-center border border-border rounded-lg">
              <p class="text-sm text-text-secondary">
                No hay solicitudes de factura con este filtro.
              </p>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class InvoiceDataRequestsPageComponent {
  private readonly service = inject(InvoiceDataRequestService);
  private readonly toast = inject(ToastService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly rows = signal<InvoiceDataRequestRow[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly statusFilter = signal<InvoiceDataRequestStatus | ''>('');

  /**
   * Id en curso, NO un booleano: con un booleano compartido los dos botones de
   * la lista se apagan igual y el comerciante no sabe cuál solicitud está
   * corriendo.
   */
  readonly processingId = signal<number | null>(null);

  readonly statusOptions: SelectorOption[] = [
    { value: '', label: 'Todos los estados' },
    { value: 'submitted', label: STATUS_LABELS.submitted },
    { value: 'failed', label: STATUS_LABELS.failed },
    { value: 'pending', label: STATUS_LABELS.pending },
    { value: 'processing', label: STATUS_LABELS.processing },
    { value: 'completed', label: STATUS_LABELS.completed },
    { value: 'expired', label: STATUS_LABELS.expired },
  ];

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .list(this.statusFilter())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.rows.set(response?.data ?? []);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(
            humanize(
              describeApiFailure(err).message,
              'No se pudieron cargar las solicitudes de factura.',
            ),
          );
          this.rows.set([]);
          this.loading.set(false);
        },
      });
  }

  onStatusChange(value: string | number | null): void {
    this.statusFilter.set((value ?? '') as InvoiceDataRequestStatus | '');
    this.load();
  }

  /**
   * `data: null` con 200 NO es éxito: significa que otro trabajador —el listener
   * automático, u otra pestaña abierta— ya reclamó la solicitud. Cantar «factura
   * emitida» ahí sería afirmar un documento que este clic no creó.
   */
  process(row: InvoiceDataRequestRow): void {
    if (this.processingId() !== null) {
      return;
    }
    this.processingId.set(row.id);
    this.service
      .process(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.processingId.set(null);
          if (response?.data) {
            this.toast.success(
              'Solicitud procesada: se emitió la factura a nombre del cliente.',
            );
          } else {
            this.toast.warning(
              'Otro proceso ya estaba atendiendo esta solicitud. Se actualizó la lista.',
            );
          }
          this.load();
        },
        error: (err: unknown) => {
          this.processingId.set(null);
          this.toast.error(
            humanize(
              describeApiFailure(err).message,
              'No se pudo procesar la solicitud.',
            ),
          );
        },
      });
  }

  statusLabel(status: InvoiceDataRequestStatus): string {
    return STATUS_LABELS[status] ?? status;
  }

  statusClass(status: InvoiceDataRequestStatus): string {
    return toneClasses(STATUS_TONES[status] ?? 'neutral');
  }

  money(value: string | number | null | undefined): string {
    return this.currency.format(Number(value ?? 0));
  }

  /**
   * Identidad del solicitante. `pending` significa que el enlace se envió y el
   * cliente todavía no escribió nada, así que los campos llegan vacíos: decirlo
   * es más honesto que pintar una línea en blanco.
   */
  customerLine(row: InvoiceDataRequestRow): string {
    const name = [row.first_name, row.last_name]
      .filter((part) => part && part.trim())
      .join(' ')
      .trim();
    const document =
      row.document_number
        ? `${row.document_type ? row.document_type + ' ' : ''}${row.document_number}`
        : '';
    const parts = [name, document, row.email ?? ''].filter(
      (part) => part && part.trim(),
    );
    return parts.length
      ? parts.join(' · ')
      : 'El cliente todavía no ha enviado sus datos.';
  }
}
