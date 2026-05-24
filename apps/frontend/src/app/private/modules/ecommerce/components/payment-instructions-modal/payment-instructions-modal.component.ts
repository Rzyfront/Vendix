import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { FileUploadDropzoneComponent } from '../../../../../shared/components/file-upload-dropzone/file-upload-dropzone.component';
import { PaymentMethod } from '../../services/checkout.service';

@Component({
  selector: 'app-payment-instructions-modal',
  standalone: true,
  imports: [
    CommonModule,
    ModalComponent,
    ButtonComponent,
    FileUploadDropzoneComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      [title]="modalTitle()"
      size="md"
    >
      <div class="instructions-body">
        @if (hasInstructions()) {
          <div class="instructions-block">
            @if (instructions()?.bank_name) {
              <div class="instruction-row">
                <span class="label">Banco</span>
                <span class="value">{{ instructions()?.bank_name }}</span>
              </div>
            }
            @if (instructions()?.account_holder) {
              <div class="instruction-row">
                <span class="label">Titular</span>
                <span class="value">{{ instructions()?.account_holder }}</span>
              </div>
            }
            @if (instructions()?.account_number) {
              <div class="instruction-row">
                <span class="label">Número de cuenta</span>
                <span class="value value-with-action">
                  <span>{{ instructions()?.account_number }}</span>
                  <button
                    type="button"
                    class="copy-btn"
                    (click)="copyAccountNumber()"
                  >
                    {{ copyLabel() }}
                  </button>
                </span>
              </div>
            }
            @if (instructions()?.account_type) {
              <div class="instruction-row">
                <span class="label">Tipo de cuenta</span>
                <span class="value">{{ instructions()?.account_type }}</span>
              </div>
            }
            @if (instructions()?.instructions) {
              <div class="instruction-row">
                <span class="label">Instrucciones</span>
                <span class="value">{{ instructions()?.instructions }}</span>
              </div>
            }
            @if (instructions()?.voucher_instructions) {
              <div class="instruction-row">
                <span class="label">Instrucciones del voucher</span>
                <span class="value">{{
                  instructions()?.voucher_instructions
                }}</span>
              </div>
            }
            @if (instructions()?.redemption_phone) {
              <div class="instruction-row">
                <span class="label">Teléfono</span>
                <span class="value">{{
                  instructions()?.redemption_phone
                }}</span>
              </div>
            }
            @if (instructions()?.notes) {
              <div class="instruction-row">
                <span class="label">Notas</span>
                <span class="value">{{ instructions()?.notes }}</span>
              </div>
            }
          </div>
        } @else {
          <p class="fallback">
            Contacta al vendedor para obtener los datos de pago.
          </p>
        }

        <p class="hint">
          Sube el soporte de pago para mejorar los tiempos de validación
          (opcional).
        </p>

        @if (currentFile()) {
          <div class="current-file">
            <span class="file-name">{{ currentFile()!.name }}</span>
            <button
              type="button"
              class="remove-btn"
              (click)="onRemoveFile()"
            >
              Quitar
            </button>
          </div>
        } @else {
          <app-file-upload-dropzone
            label="Subir comprobante"
            helperText="Imagen o PDF, máx. 5MB"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            (fileSelected)="onFile($event)"
          />
        }

        @if (errorMsg()) {
          <p class="error">{{ errorMsg() }}</p>
        }
      </div>

      <div slot="footer" class="footer-actions">
        <app-button variant="primary" (clicked)="onConfirm()">
          Continuar
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      .instructions-body {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .instructions-block {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 0.75rem 1rem;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
      }

      .instruction-row {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        font-size: var(--fs-sm);
      }

      .instruction-row .label {
        font-size: var(--fs-xs);
        color: var(--color-text-secondary);
        font-weight: var(--fw-medium);
      }

      .instruction-row .value {
        color: var(--color-text-primary);
        word-break: break-word;
      }

      .value-with-action {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .copy-btn {
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-primary);
        cursor: pointer;
        font-size: var(--fs-xs);
        padding: 0.125rem 0.5rem;
      }

      .copy-btn:hover {
        background: var(--color-primary-light);
      }

      .fallback {
        margin: 0;
        font-size: var(--fs-sm);
        color: var(--color-text-secondary);
      }

      .hint {
        font-size: var(--fs-xs);
        color: var(--color-text-secondary);
        margin: 0;
      }

      .current-file {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        font-size: var(--fs-sm);
      }

      .current-file .file-name {
        color: var(--color-text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .remove-btn {
        background: transparent;
        border: 0;
        color: var(--color-danger, #dc2626);
        cursor: pointer;
        font-size: var(--fs-xs);
        padding: 0;
      }

      .error {
        margin: 0;
        font-size: var(--fs-xs);
        color: var(--color-danger, #dc2626);
      }

      .footer-actions {
        display: flex;
        justify-content: flex-end;
        width: 100%;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaymentInstructionsModalComponent {
  readonly isOpen = input.required<boolean>();
  readonly method = input<PaymentMethod | null>(null);
  readonly currentFile = input<File | null>(null);

  readonly isOpenChange = output<boolean>();
  readonly fileChange = output<File | null>();
  readonly confirmed = output<void>();

  readonly errorMsg = signal<string | null>(null);
  readonly copyLabel = signal<string>('Copiar');

  private readonly ALLOWED_MIME = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];
  private readonly MAX_SIZE = 5 * 1024 * 1024; // 5MB

  readonly isVoucher = computed(() => this.method()?.type === 'voucher');

  readonly instructions = computed(
    () => this.method()?.payment_instructions ?? null,
  );

  readonly hasInstructions = computed(() => {
    const i = this.method()?.payment_instructions;
    if (!i) return false;
    return Object.values(i).some(
      (v) => v !== undefined && v !== null && String(v).trim().length > 0,
    );
  });

  readonly modalTitle = computed(() =>
    this.isVoucher()
      ? 'Instrucciones del voucher'
      : 'Datos para transferencia bancaria',
  );

  onFile(file: File): void {
    if (file.size > this.MAX_SIZE || !this.ALLOWED_MIME.includes(file.type)) {
      this.errorMsg.set(
        'Archivo inválido: usa imagen o PDF de máximo 5MB.',
      );
      this.fileChange.emit(null);
      return;
    }
    this.errorMsg.set(null);
    this.fileChange.emit(file);
  }

  onRemoveFile(): void {
    this.errorMsg.set(null);
    this.fileChange.emit(null);
  }

  onConfirm(): void {
    this.confirmed.emit();
    this.isOpenChange.emit(false);
  }

  async copyAccountNumber(): Promise<void> {
    const account = this.instructions()?.account_number;
    if (!account) return;
    try {
      await navigator.clipboard.writeText(account);
      this.copyLabel.set('Copiado');
      setTimeout(() => this.copyLabel.set('Copiar'), 1500);
    } catch {
      this.copyLabel.set('Copiar');
    }
  }
}
