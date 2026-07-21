import {Component, computed, effect, inject, input, OnInit, output, signal, DestroyRef, model} from '@angular/core';
import { DatePipe } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { PurchaseOrdersService } from '../../../services';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { toLocalDateString } from '../../../../../../../shared/utils/date.util';

/**
 * FASE TRACK B4 — Modal de detalle de pago con preview del documento
 * relacionado (purchase_order_attachments.payment_id).
 *
 * Preview:
 *   PDF  → <iframe> via blob URL + DomSanitizer.bypassSecurityTrustResourceUrl
 *           (calque del patrón `dispatch-note-pdf-viewer`).
 *   IMG  → <img> con blob URL.
 *   NONE → estado vacío "Sin documento adjunto".
 *
 * NO modifica el pago; es solo lectura.
 */
@Component({
  selector: 'app-po-payment-detail-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, IconComponent, DatePipe],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onModalClose($event)"
      title="Detalle del pago"
      size="lg"
    >
      @if (payment(); as p) {
        <div class="space-y-4">
          <!-- Resumen del pago -->
          <div class="grid grid-cols-2 gap-3 p-3 rounded-md bg-surface-2">
            <div>
              <p class="text-xs text-text-muted">Monto</p>
              <p class="text-base font-semibold text-text-primary">{{ formatCurrency(p.amount) }}</p>
            </div>
            <div>
              <p class="text-xs text-text-muted">Fecha</p>
              <p class="text-sm text-text-primary">{{ p.payment_date | date: 'mediumDate' }}</p>
            </div>
            <div>
              <p class="text-xs text-text-muted">Método</p>
              <p class="text-sm text-text-primary">{{ methodLabel(p.payment_method) }}</p>
            </div>
            <div>
              <p class="text-xs text-text-muted">Referencia</p>
              <p class="text-sm text-text-primary">{{ p.reference || '—' }}</p>
            </div>
            @if (p.notes) {
              <div class="col-span-2">
                <p class="text-xs text-text-muted">Notas</p>
                <p class="text-sm text-text-primary">{{ p.notes }}</p>
              </div>
            }
          </div>

          <!-- Preview del documento -->
          <div>
            <h4 class="text-sm font-semibold text-text-primary mb-2">Comprobante</h4>
            @if (attachmentMime(); as mime) {
              @if (attachmentUrl(); as url) {
                @if (mime.startsWith('image/')) {
                  <div class="po-attachment-preview">
                    <img [src]="url" alt="Comprobante de pago" class="max-h-96 mx-auto rounded-md">
                  </div>
                } @else if (mime === 'application/pdf') {
                  <iframe
                    [src]="url"
                    class="po-attachment-iframe w-full"
                    title="Comprobante de pago"
                  ></iframe>
                } @else {
                  <div class="flex items-center gap-2 text-sm text-text-muted p-3 rounded-md border border-border">
                    <app-icon name="file-text" [size]="16"></app-icon>
                    <span>Tipo de archivo no previsualizable ({{ mime }}).</span>
                  </div>
                }
              } @else {
                <p class="text-sm text-text-muted">Cargando documento…</p>
              }
            } @else {
              <div class="flex flex-col items-center justify-center py-8 text-text-muted">
                <app-icon name="file-x" [size]="32" class="mb-2"></app-icon>
                <p class="text-sm">Este pago no tiene un comprobante adjunto.</p>
              </div>
            }
          </div>
        </div>
      }

      <div slot="footer" class="flex justify-end">
        <app-button variant="outline" (clicked)="onModalClose(false)">Cerrar</app-button>
      </div>
    </app-modal>
  `,
  styles: [`
    :host { display: block; }
    .po-attachment-preview {
      max-height: 24rem;
      overflow: auto;
      border-radius: 0.5rem;
      border: 1px solid var(--color-border, #e5e7eb);
      padding: 0.5rem;
    }
    .po-attachment-iframe {
      height: 32rem;
      border-radius: 0.5rem;
      border: 1px solid var(--color-border, #e5e7eb);
    }
  `],
})
export class PoPaymentDetailModalComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private purchaseOrdersService = inject(PurchaseOrdersService);
  private currencyService = inject(CurrencyFormatService);
  private sanitizer = inject(DomSanitizer);

  readonly isOpen = model<boolean>(false);
  readonly close = output<void>();
  /** id del pago (purchase_order_payments.id). */
  readonly paymentId = input<number | null>(null);
  readonly orderId = input<number | null>(null);

  /** Objeto del pago (lo pasa el padre al abrir; no se reconsulta). */
  readonly payment = input<{
    id: number;
    amount: number;
    payment_date: string;
    payment_method: string;
    reference?: string | null;
    notes?: string | null;
  } | null>(null);

  readonly attachmentUrl = signal<SafeResourceUrl | null>(null);
  readonly attachmentMime = signal<string | null>(null);

  ngOnInit(): void {
    // No-op; todo se carga por effect.
  }

  constructor() {
    effect(() => {
      if (!this.isOpen()) {
        this.attachmentUrl.set(null);
        this.attachmentMime.set(null);
        return;
      }
      const orderId = this.orderId();
      const paymentId = this.paymentId();
      if (!orderId || !paymentId) return;

      // Traer el adjunto ligado a este pago. Asumimos que el backend expone
      // un endpoint que filtra attachments por payment_id; mientras tanto
      // usamos getAttachments y filtramos client-side.
      this.purchaseOrdersService
        .getPurchaseOrderAttachments(orderId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res: any) => {
            const all: any[] = res?.data ?? [];
            const att = all.find((a: any) => a?.payment_id === paymentId);
            if (!att?.file_url) {
              this.attachmentMime.set(null);
              this.attachmentUrl.set(null);
              return;
            }
            // download_url viene firmado por el backend (patrón getAttachments).
            const rawUrl: string = att.download_url ?? att.file_url;
            const mime: string = att.mime_type ?? guessMime(rawUrl);
            this.attachmentMime.set(mime);
            // Cargar via fetch → blob URL → sanitizer (calque dispatch-note-pdf-viewer).
            this.fetchAsBlobUrl(rawUrl).then(blobUrl => {
              this.attachmentUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(blobUrl));
            }).catch(() => {
              // Fallback: usar el signed URL directo (el sandbox del iframe
              // puede no ser necesario para imágenes, y para PDFs algunos
              // browsers aceptan signed URLs nativamente).
              this.attachmentUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(rawUrl));
            });
          },
          error: () => {
            this.attachmentMime.set(null);
            this.attachmentUrl.set(null);
          },
        });
    });
  }

  private async fetchAsBlobUrl(rawUrl: string): Promise<string> {
    const res = await fetch(rawUrl, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }

  onModalClose(value: boolean): void {
    if (!value) {
      this.close.emit();
    }
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(Number(value) || 0);
  }

  methodLabel(method: string): string {
    const map: Record<string, string> = {
      cash: 'Efectivo',
      bank_transfer: 'Transferencia bancaria',
      check: 'Cheque',
      credit_card: 'Tarjeta de crédito',
    };
    return map[method] ?? method;
  }
}

function guessMime(url: string): string {
  const lower = url.toLowerCase().split('?')[0];
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}
