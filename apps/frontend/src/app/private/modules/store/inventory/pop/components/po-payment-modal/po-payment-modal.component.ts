import {Component, inject, input, output, signal, computed, effect, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { FileUploadDropzoneComponent } from '../../../../../../../shared/components/file-upload-dropzone/file-upload-dropzone.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { PurchaseOrdersService, PaymentScanResult } from '../../../services';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { toLocalDateString } from '../../../../../../../shared/utils/date.util';

/**
 * FASE TRACK B3 — Modal "Registrar Pago" rediseñado 50/50.
 *
 *   Izquierda (md+): formulario manual (monto/fecha/metodo/referencia/notas).
 *   Derecha   (md+): AI scan async de comprobante (dropzone + estado de progreso).
 *   Móvil      : columnas apiladas (dropzone arriba, formulario abajo).
 *
 * Calque del patrón AI button de `vendix-ai-engine`:
 *   signals `isScanning`, `scanConfidence`, iconos `sparkles` / `loader-2`.
 *
 * Estado de escaneo (segun `PaymentScanStatus`):
 *   waiting/active → `isScanning()` true + icono `loader-2`.
 *   completed      → prefill amount/payment_date/payment_method/reference.
 *   failed/timeout → toast de error suave; el modal sigue usable manualmente.
 *
 * Si el usuario seleccionó un archivo (con o sin OCR exitoso), se envía junto
 * con el pago y se adjunta vía `payment_id` (Track B2 backend: schema
 * `purchase_order_attachments.payment_id`).
 */
@Component({
  selector: 'app-po-payment-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    FileUploadDropzoneComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onModalClose($event)"
      title="Registrar Pago"
      size="xl"
    >
      <div class="po-payment-grid">
        <!-- ═══ COLUMNA IZQUIERDA: formulario manual ═══ -->
        <div class="space-y-4">
          <!-- Amount -->
          <div>
            <label for="payment-amount" class="text-sm font-medium text-text-primary block mb-1.5">Monto</label>
            <input
              id="payment-amount"
              type="number"
              class="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              [(ngModel)]="amount"
              [min]="0"
              step="0.01"
              placeholder="0.00"
            >
            <p class="text-xs text-text-muted mt-1">
              Total orden: {{ formatCurrency(totalAmount()) }} · Pagado: {{ formatCurrency(paidAmount()) }} · Pendiente: {{ formatCurrency(remaining()) }}
            </p>
            @if (amount > remaining()) {
              <p class="text-xs text-destructive mt-1">El monto no puede superar el saldo pendiente.</p>
            }
          </div>

          <!-- Date -->
          <div>
            <label for="payment-date" class="text-sm font-medium text-text-primary block mb-1.5">Fecha de pago</label>
            <input
              id="payment-date"
              type="date"
              class="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              [(ngModel)]="paymentDate"
            >
          </div>

          <!-- Payment Method -->
          <div>
            <label for="payment-method" class="text-sm font-medium text-text-primary block mb-1.5">Metodo de pago</label>
            <select
              id="payment-method"
              class="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              [(ngModel)]="paymentMethod"
            >
              <option value="cash">Efectivo</option>
              <option value="bank_transfer">Transferencia bancaria</option>
              <option value="check">Cheque</option>
              <option value="credit_card">Tarjeta de credito</option>
            </select>
          </div>

          <!-- Reference -->
          <div>
            <label for="payment-ref" class="text-sm font-medium text-text-primary block mb-1.5">Referencia</label>
            <input
              id="payment-ref"
              type="text"
              class="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              [(ngModel)]="reference"
              placeholder="No. de transferencia, cheque, etc."
            >
          </div>

          <!-- Notes -->
          <div>
            <label for="payment-notes" class="text-sm font-medium text-text-primary block mb-1.5">Notas</label>
            <textarea
              id="payment-notes"
              class="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              rows="2"
              [(ngModel)]="notes"
              placeholder="Notas opcionales..."
            ></textarea>
          </div>
        </div>

        <!-- ═══ COLUMNA DERECHA: AI scan async ═══ -->
        <div class="po-payment-scan-col">
          <div class="flex items-center gap-2 mb-2">
            <app-icon name="sparkles" [size]="18" class="text-primary"></app-icon>
            <h4 class="text-sm font-semibold text-text-primary">Escanear comprobante con IA</h4>
          </div>
          <p class="text-xs text-text-muted mb-3">
            Sube la foto del recibo/transferencia y pre-rellenaremos los campos. El documento se adjuntará al pago.
          </p>

          <app-file-upload-dropzone
            label="Comprobante de pago"
            helperText="Imagen JPG/PNG/WebP hasta 10MB"
            accept="image/*"
            icon="image"
            [disabled]="isScanning()"
            (fileSelected)="onScanFileSelected($event)"
            (fileRemoved)="onScanFileRemoved()"
          ></app-file-upload-dropzone>

          @if (isScanning()) {
            <div class="po-scan-progress mt-3 flex items-center gap-2 text-xs text-text-muted">
              <app-icon name="loader-2" [size]="14" class="animate-spin"></app-icon>
              <span>Extrayendo datos del comprobante...</span>
            </div>
          }

          @if (scanConfidence() !== null) {
            <div class="po-scan-result mt-3 p-3 rounded-md border border-success/30 bg-success/5">
              <div class="flex items-center gap-2 mb-1">
                <app-icon name="check-circle-2" [size]="14" class="text-success"></app-icon>
                <span class="text-xs font-medium text-success">Datos extraidos (confianza {{ scanConfidence() }}%)</span>
              </div>
              <p class="text-xs text-text-muted">
                Los campos del formulario se pre-rellenaron. Revisalos y ajusta antes de guardar.
              </p>
            </div>
          }
        </div>
      </div>

      <!-- Footer -->
      <div slot="footer" class="flex gap-2 justify-end">
        <app-button variant="outline" (clicked)="onModalClose(false)">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="submit()"
          [disabled]="saving() || isScanning() || !isValid()"
          [loading]="saving()"
        >
          Registrar Pago
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [`
    :host { display: block; }
    input::-webkit-outer-spin-button,
    input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    input[type=number] {
      -moz-appearance: textfield;
    }
    .po-payment-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 1.25rem;
    }
    @media (min-width: 768px) {
      .po-payment-grid {
        grid-template-columns: 1fr 1fr;
        gap: 1.5rem;
      }
    }
    .po-payment-scan-col {
      padding: 1rem;
      border-radius: 0.5rem;
      border: 1px dashed var(--color-border, #e5e7eb);
      background: var(--color-surface-2, rgba(0,0,0,0.02));
    }
    .animate-spin {
      animation: po-spin 1s linear infinite;
    }
    @keyframes po-spin {
      to { transform: rotate(360deg); }
    }
  `],
})
export class PoPaymentModalComponent {
  private destroyRef = inject(DestroyRef);
  private purchaseOrdersService = inject(PurchaseOrdersService);
  private toastService = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);

  readonly isOpen = input<boolean>(false);
  readonly orderId = input<number | null>(null);
  readonly totalAmount = input<number>(0);
  readonly paidAmount = input<number>(0);

  readonly close = output<void>();
  readonly paymentRegistered = output<void>();

  readonly saving = signal(false);
  readonly isScanning = signal(false);
  readonly scanConfidence = signal<number | null>(null);
  /** Archivo pendiente de subir (con o sin OCR exitoso). */
  private scannedFile = signal<File | null>(null);

  readonly remaining = computed(() => {
    return Math.max(0, Number(this.totalAmount()) - Number(this.paidAmount()));
  });

  amount = 0;
  paymentDate = toLocalDateString();
  paymentMethod = 'bank_transfer';
  reference = '';
  notes = '';

  constructor() {
    // Initialize form when modal opens
    effect(() => {
      if (this.isOpen()) {
        this.resetForm();
        this.scannedFile.set(null);
        this.scanConfidence.set(null);
        this.isScanning.set(false);
      }
    });
  }

  private resetForm(): void {
    this.amount = this.remaining() || Number(this.totalAmount()) || 0;
    this.paymentDate = toLocalDateString();
    this.paymentMethod = 'bank_transfer';
    this.reference = '';
    this.notes = '';
  }

  onModalClose(value: boolean): void {
    if (!value) {
      this.close.emit();
    }
  }

  isValid(): boolean {
    return this.amount > 0 && this.amount <= this.remaining() && !!this.paymentDate;
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(Number(value) || 0);
  }

  // ── AI scan (Track B3/B5) ─────────────────────────────────────

  onScanFileSelected(file: File): void {
    const id = this.orderId();
    if (!id) return;
    this.scannedFile.set(file);
    this.isScanning.set(true);
    this.scanConfidence.set(null);

    this.purchaseOrdersService
      .scanPaymentReceipt(id, file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result: PaymentScanResult) => {
          this.applyScanResult(result);
          this.isScanning.set(false);
          this.scanConfidence.set(result.confidence ?? null);
          this.toastService.success('Datos del comprobante extraidos');
        },
        error: (err: any) => {
          this.isScanning.set(false);
          this.scanConfidence.set(null);
          // scan_payment_timeout / scan_payment_not_found → error suave,
          // el modal sigue usable manualmente y el archivo sigue adjunto.
          const code = err?.message ?? '';
          if (code === 'scan_payment_timeout') {
            this.toastService.error('Tiempo agotado extrayendo datos. Puedes llenar el formulario manualmente.');
          } else if (code === 'scan_payment_not_found') {
            this.toastService.error('La extracción expiró del cache. Puedes llenar el formulario manualmente.');
          } else {
            this.toastService.error('No se pudo escanear el comprobante. Puedes llenar el formulario manualmente.');
          }
        },
      });
  }

  onScanFileRemoved(): void {
    this.scannedFile.set(null);
    this.scanConfidence.set(null);
    this.isScanning.set(false);
  }

  private applyScanResult(r: PaymentScanResult): void {
    if (r.amount > 0) this.amount = r.amount;
    if (r.payment_date) this.paymentDate = r.payment_date;
    if (r.payment_method) {
      const map: Record<string, string> = {
        cash: 'cash',
        transfer: 'bank_transfer',
        card: 'credit_card',
        check: 'check',
        other: 'bank_transfer',
      };
      this.paymentMethod = map[r.payment_method] ?? 'bank_transfer';
    }
    if (r.reference) this.reference = r.reference;
    if (r.notes) this.notes = r.notes;
  }

  // ── Submit ────────────────────────────────────────────────────

  submit(): void {
    if (!this.isValid()) return;

    const id = this.orderId();
    if (!id) return;

    this.saving.set(true);

    const payload: Record<string, unknown> = {
      amount: this.amount,
      payment_date: this.paymentDate,
      payment_method: this.paymentMethod,
    };
    if (this.reference.trim()) payload['reference'] = this.reference.trim();
    if (this.notes.trim()) payload['notes'] = this.notes.trim();

    this.purchaseOrdersService.registerPurchaseOrderPayment(id, payload).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        // Adjuntar el documento (si hay) al pago creado. payment_id viaja en
        // metadata; el backend lo persiste en purchase_order_attachments.payment_id.
        const file = this.scannedFile();
        const paymentId = res?.data?.id;
        if (file && paymentId) {
          this.purchaseOrdersService
            .uploadPurchaseOrderAttachment(id, file, { payment_id: paymentId })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: () => this.afterSaveOk(),
              error: (attErr: string) => {
                // El pago YA se registro, pero el adjunto fallo. Reportamos
                // como warning y dejamos el flujo terminar (no destructivo).
                this.afterSaveOk();
                this.toastService.error(`Pago guardado, pero el adjunto fallo: ${attErr}`);
              },
            });
        } else {
          this.afterSaveOk();
        }
      },
      error: (err: string) => {
        this.saving.set(false);
        this.toastService.error(err || 'Error al registrar pago');
      },
    });
  }

  private afterSaveOk(): void {
    this.saving.set(false);
    this.toastService.success('Pago registrado correctamente');
    this.paymentRegistered.emit();
    this.close.emit();
  }
}
