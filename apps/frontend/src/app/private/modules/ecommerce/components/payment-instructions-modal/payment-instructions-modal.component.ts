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
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { FileUploadDropzoneComponent } from '../../../../../shared/components/file-upload-dropzone/file-upload-dropzone.component';
import { PaymentMethod } from '../../services/checkout.service';

type InstructionField = {
  key: string;
  label: string;
  value: string;
  copyable?: boolean;
};

@Component({
  selector: 'app-payment-instructions-modal',
  standalone: true,
  imports: [
    CommonModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    FileUploadDropzoneComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      [size]="'md'"
      [showCloseButton]="false"
    >
      <div class="pi-shell" [class.is-voucher]="isVoucher()">
        <!-- Hero -->
        <div class="pi-hero">
          <div class="pi-hero-bg"></div>
          <div class="pi-hero-pattern" aria-hidden="true"></div>
          <div class="pi-hero-icon">
            <span class="pi-hero-halo" aria-hidden="true"></span>
            <app-icon
              [name]="heroIcon()"
              [size]="44"
              class="relative z-10 text-white drop-shadow-sm"
            />
          </div>
          <h3 class="pi-hero-title">{{ heroTitle() }}</h3>
          <p class="pi-hero-subtitle">{{ heroSubtitle() }}</p>
        </div>

        <!-- Body -->
        <div class="pi-body">
          <!-- Instructions card -->
          @if (visibleFields().length > 0) {
            <section class="pi-card pi-instructions">
              <header class="pi-card-header">
                <app-icon [name]="cardIcon()" size="16" class="text-primary-500" />
                <span>{{ cardTitle() }}</span>
              </header>
              <ul class="pi-fields">
                @for (f of visibleFields(); track f.key) {
                  <li class="pi-field" [attr.data-key]="f.key">
                    <span class="pi-field-label">{{ f.label }}</span>
                    <div class="pi-field-value-wrap">
                      <span class="pi-field-value">{{ f.value }}</span>
                      @if (f.copyable) {
                        <button
                          type="button"
                          class="pi-copy-btn"
                          [class.copied]="copiedKey() === f.key"
                          (click)="copyField(f)"
                          [attr.aria-label]="'Copiar ' + f.label"
                        >
                          @if (copiedKey() === f.key) {
                            <app-icon name="check" size="14" />
                            <span>Copiado</span>
                          } @else {
                            <app-icon name="copy" size="14" />
                            <span>Copiar</span>
                          }
                        </button>
                      }
                    </div>
                  </li>
                }
              </ul>
            </section>
          } @else {
            <div class="pi-fallback">
              <app-icon name="info" size="18" class="text-amber-500" />
              <p>
                Esta tienda aún no tiene los datos de pago configurados.
                Contacta al vendedor para recibir las instrucciones.
              </p>
            </div>
          }

          <!-- Receipt upload -->
          <section class="pi-card pi-upload">
            <header class="pi-card-header">
              <app-icon name="upload-cloud" size="16" class="text-primary-500" />
              <span>Soporte de pago (opcional)</span>
            </header>
            <p class="pi-upload-hint">
              Sube una foto, comprobante o PDF para acelerar la validación de
              tu pago.
            </p>

            @if (currentFile()) {
              <div class="pi-success">
                <span class="pi-success-check" aria-hidden="true">
                  <svg viewBox="0 0 52 52" class="pi-check-svg">
                    <circle
                      class="pi-check-circle"
                      cx="26"
                      cy="26"
                      r="25"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    />
                    <path
                      class="pi-check-path"
                      d="M14 27 l8 8 l16 -16"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="3"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </span>
                <div class="pi-success-info">
                  <span class="pi-success-title">Comprobante adjunto</span>
                  <span class="pi-success-file">{{ currentFile()!.name }}</span>
                  <span class="pi-success-size">{{ formatSize(currentFile()!.size) }}</span>
                </div>
                <button
                  type="button"
                  class="pi-remove-btn"
                  (click)="onRemoveFile()"
                  aria-label="Quitar archivo"
                >
                  <app-icon name="x" size="16" />
                </button>
              </div>
            } @else {
              <div class="pi-dropzone-wrap">
                <app-file-upload-dropzone
                  label="Toca aquí o arrastra tu comprobante"
                  helperText="JPG, PNG, WebP o PDF · máx. 5 MB"
                  icon="upload-cloud"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  (fileSelected)="onFile($event)"
                />
              </div>
            }

            @if (errorMsg()) {
              <div class="pi-error" role="alert">
                <app-icon name="alert-circle" size="14" />
                <span>{{ errorMsg() }}</span>
              </div>
            }
          </section>
        </div>
      </div>

      <div slot="footer" class="pi-footer">
        <app-button
          variant="ghost"
          size="md"
          (clicked)="onCancel()"
        >
          Volver
        </app-button>
        <app-button
          variant="primary"
          size="md"
          (clicked)="onConfirm()"
        >
          <app-icon
            slot="icon"
            [name]="currentFile() ? 'check-circle' : 'arrow-right'"
            size="16"
          />
          {{ currentFile() ? 'Continuar con comprobante' : 'Entendido, continuar' }}
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      .pi-shell {
        display: flex;
        flex-direction: column;
        gap: 0;
        margin: -1.25rem -1.25rem 0;
      }

      /* ---------- HERO ---------- */
      .pi-hero {
        position: relative;
        padding: 2rem 1.5rem 1.5rem;
        text-align: center;
        color: #fff;
        overflow: hidden;
        border-radius: 0;
      }

      .pi-hero-bg {
        position: absolute;
        inset: 0;
        background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 55%, #06b6d4 100%);
        z-index: 0;
      }

      .pi-shell.is-voucher .pi-hero-bg {
        background: linear-gradient(135deg, #b45309 0%, #f59e0b 55%, #fbbf24 100%);
      }

      .pi-hero-pattern {
        position: absolute;
        inset: 0;
        background-image:
          radial-gradient(circle at 20% 20%, rgba(255, 255, 255, 0.18) 0, transparent 40%),
          radial-gradient(circle at 80% 0%, rgba(255, 255, 255, 0.12) 0, transparent 35%),
          radial-gradient(circle at 50% 110%, rgba(255, 255, 255, 0.1) 0, transparent 45%);
        z-index: 1;
        pointer-events: none;
      }

      .pi-hero-icon {
        position: relative;
        width: 76px;
        height: 76px;
        margin: 0 auto 0.875rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.18);
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.35);
        backdrop-filter: blur(4px);
        z-index: 2;
        animation: pi-icon-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both;
      }

      .pi-hero-halo {
        position: absolute;
        inset: -8px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.18);
        animation: pi-halo 2.4s ease-in-out infinite;
      }

      .pi-hero-title {
        position: relative;
        z-index: 2;
        font-size: 1.25rem;
        font-weight: 700;
        margin: 0 0 0.25rem;
        letter-spacing: -0.01em;
        animation: pi-text-in 0.5s ease both 0.1s;
      }

      .pi-hero-subtitle {
        position: relative;
        z-index: 2;
        font-size: 0.875rem;
        margin: 0;
        opacity: 0.92;
        animation: pi-text-in 0.5s ease both 0.18s;
      }

      /* ---------- BODY ---------- */
      .pi-body {
        display: flex;
        flex-direction: column;
        gap: 0.875rem;
        padding: 1.125rem 1.25rem 0.5rem;
        background: #fff;
      }

      .pi-card {
        border: 1px solid #e5e7eb;
        border-radius: 14px;
        padding: 0.875rem 1rem;
        background: linear-gradient(180deg, #ffffff 0%, #fafbfc 100%);
        animation: pi-card-in 0.4s ease both 0.15s;
      }

      .pi-card + .pi-card {
        animation-delay: 0.25s;
      }

      .pi-card-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #6b7280;
        margin-bottom: 0.625rem;
      }

      /* ---------- FIELDS ---------- */
      .pi-fields {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.625rem;
      }

      .pi-field {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
      }

      .pi-field-label {
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #9ca3af;
      }

      .pi-field-value-wrap {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .pi-field-value {
        font-size: 0.9375rem;
        font-weight: 600;
        color: #111827;
        word-break: break-word;
        font-variant-numeric: tabular-nums;
      }

      .pi-field[data-key='account_number'] .pi-field-value {
        font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
        font-size: 1rem;
        letter-spacing: 0.02em;
        padding: 0.25rem 0.5rem;
        background: #f1f5f9;
        border-radius: 6px;
      }

      .pi-copy-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.25rem 0.625rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: #2563eb;
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.18s ease;
      }

      .pi-copy-btn:hover {
        background: #dbeafe;
        transform: translateY(-1px);
      }

      .pi-copy-btn:active {
        transform: translateY(0);
      }

      .pi-copy-btn.copied {
        background: #d1fae5;
        color: #047857;
        border-color: #6ee7b7;
        animation: pi-copy-pulse 0.4s ease;
      }

      /* ---------- UPLOAD ---------- */
      .pi-upload-hint {
        font-size: 0.8125rem;
        color: #6b7280;
        margin: 0 0 0.625rem;
      }

      .pi-dropzone-wrap {
        position: relative;
        border-radius: 12px;
        overflow: hidden;
      }

      .pi-dropzone-wrap::before {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(
          135deg,
          rgba(59, 130, 246, 0.04) 0%,
          rgba(6, 182, 212, 0.04) 100%
        );
        pointer-events: none;
        border-radius: 12px;
      }

      .pi-shell.is-voucher .pi-dropzone-wrap::before {
        background: linear-gradient(
          135deg,
          rgba(245, 158, 11, 0.05) 0%,
          rgba(251, 191, 36, 0.05) 100%
        );
      }

      /* ---------- SUCCESS ---------- */
      .pi-success {
        display: flex;
        align-items: center;
        gap: 0.875rem;
        padding: 0.875rem 1rem;
        background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
        border: 1px solid #6ee7b7;
        border-radius: 12px;
        animation: pi-success-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
      }

      .pi-success-check {
        flex-shrink: 0;
        color: #047857;
        width: 32px;
        height: 32px;
      }

      .pi-check-svg {
        width: 100%;
        height: 100%;
      }

      .pi-check-circle {
        stroke-dasharray: 166;
        stroke-dashoffset: 166;
        animation: pi-circle 0.6s cubic-bezier(0.65, 0, 0.45, 1) forwards;
      }

      .pi-check-path {
        stroke-dasharray: 48;
        stroke-dashoffset: 48;
        animation: pi-check 0.4s cubic-bezier(0.65, 0, 0.45, 1) 0.4s forwards;
      }

      .pi-success-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.0625rem;
      }

      .pi-success-title {
        font-size: 0.8125rem;
        font-weight: 700;
        color: #065f46;
      }

      .pi-success-file {
        font-size: 0.75rem;
        color: #047857;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .pi-success-size {
        font-size: 0.6875rem;
        color: #059669;
        opacity: 0.85;
      }

      .pi-remove-btn {
        flex-shrink: 0;
        padding: 0.375rem;
        background: rgba(255, 255, 255, 0.7);
        border: 1px solid #6ee7b7;
        color: #047857;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.18s ease;
      }

      .pi-remove-btn:hover {
        background: #fee2e2;
        border-color: #fca5a5;
        color: #dc2626;
        transform: rotate(90deg);
      }

      /* ---------- FALLBACK / ERROR ---------- */
      .pi-fallback {
        display: flex;
        align-items: flex-start;
        gap: 0.625rem;
        padding: 0.875rem 1rem;
        background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
        border: 1px solid #fcd34d;
        border-radius: 12px;
        font-size: 0.8125rem;
        color: #92400e;
      }

      .pi-fallback p {
        margin: 0;
        line-height: 1.4;
      }

      .pi-error {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        margin-top: 0.5rem;
        padding: 0.5rem 0.75rem;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 8px;
        color: #b91c1c;
        font-size: 0.75rem;
        font-weight: 500;
        animation: pi-shake 0.4s ease;
      }

      /* ---------- FOOTER ---------- */
      .pi-footer {
        display: flex;
        gap: 0.5rem;
        justify-content: flex-end;
        width: 100%;
        flex-wrap: wrap;
      }

      .pi-footer app-button {
        flex: 1;
        min-width: 130px;
      }

      /* ---------- ANIMATIONS ---------- */
      @keyframes pi-icon-in {
        0% { transform: scale(0.5) rotate(-12deg); opacity: 0; }
        100% { transform: scale(1) rotate(0); opacity: 1; }
      }

      @keyframes pi-halo {
        0%, 100% { transform: scale(1); opacity: 0.5; }
        50% { transform: scale(1.15); opacity: 0; }
      }

      @keyframes pi-text-in {
        0% { transform: translateY(8px); opacity: 0; }
        100% { transform: translateY(0); opacity: 1; }
      }

      @keyframes pi-card-in {
        0% { transform: translateY(12px); opacity: 0; }
        100% { transform: translateY(0); opacity: 1; }
      }

      @keyframes pi-copy-pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.08); }
        100% { transform: scale(1); }
      }

      @keyframes pi-success-in {
        0% { transform: translateY(8px) scale(0.96); opacity: 0; }
        100% { transform: translateY(0) scale(1); opacity: 1; }
      }

      @keyframes pi-circle {
        100% { stroke-dashoffset: 0; }
      }

      @keyframes pi-check {
        100% { stroke-dashoffset: 0; }
      }

      @keyframes pi-shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-3px); }
        75% { transform: translateX(3px); }
      }

      /* ---------- RESPONSIVE ---------- */
      @media (max-width: 480px) {
        .pi-hero {
          padding: 1.5rem 1.25rem 1.25rem;
        }
        .pi-hero-icon {
          width: 64px;
          height: 64px;
        }
        .pi-hero-title {
          font-size: 1.125rem;
        }
        .pi-body {
          padding: 1rem 1rem 0.5rem;
        }
        .pi-footer app-button {
          flex: 1 1 100%;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .pi-hero-icon,
        .pi-hero-title,
        .pi-hero-subtitle,
        .pi-card,
        .pi-success,
        .pi-hero-halo,
        .pi-check-circle,
        .pi-check-path {
          animation: none !important;
        }
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
  readonly copiedKey = signal<string | null>(null);

  private readonly ALLOWED_MIME = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];
  private readonly MAX_SIZE = 5 * 1024 * 1024;

  readonly isVoucher = computed(() => this.method()?.type === 'voucher');

  readonly heroIcon = computed(() =>
    this.isVoucher() ? 'ticket' : 'landmark',
  );

  readonly heroTitle = computed(() =>
    this.isVoucher()
      ? 'Instrucciones del voucher'
      : 'Transferencia bancaria',
  );

  readonly heroSubtitle = computed(() =>
    this.isVoucher()
      ? 'Sigue las instrucciones para redimir tu voucher.'
      : 'Realiza la transferencia con los datos de la cuenta.',
  );

  readonly cardIcon = computed(() =>
    this.isVoucher() ? 'ticket' : 'building-2',
  );

  readonly cardTitle = computed(() =>
    this.isVoucher() ? 'Datos del voucher' : 'Datos de la cuenta',
  );

  readonly visibleFields = computed<InstructionField[]>(() => {
    const i = this.method()?.payment_instructions;
    if (!i) return [];
    const all: InstructionField[] = [
      { key: 'bank_name', label: 'Banco', value: i.bank_name ?? '' },
      { key: 'account_holder', label: 'Titular', value: i.account_holder ?? '' },
      {
        key: 'account_number',
        label: 'Número de cuenta',
        value: i.account_number ?? '',
        copyable: true,
      },
      { key: 'account_type', label: 'Tipo de cuenta', value: i.account_type ?? '' },
      { key: 'instructions', label: 'Instrucciones', value: i.instructions ?? '' },
      {
        key: 'voucher_instructions',
        label: 'Instrucciones del voucher',
        value: i.voucher_instructions ?? '',
      },
      {
        key: 'redemption_phone',
        label: 'Teléfono',
        value: i.redemption_phone ?? '',
        copyable: true,
      },
      { key: 'notes', label: 'Notas', value: i.notes ?? '' },
    ];
    return all.filter((f) => f.value && f.value.toString().trim().length > 0);
  });

  onFile(file: File): void {
    if (file.size > this.MAX_SIZE) {
      this.errorMsg.set('El archivo supera los 5 MB permitidos.');
      this.fileChange.emit(null);
      return;
    }
    if (!this.ALLOWED_MIME.includes(file.type)) {
      this.errorMsg.set('Formato no admitido. Usa JPG, PNG, WebP o PDF.');
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

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  async copyField(field: InstructionField): Promise<void> {
    if (!field.value) return;
    try {
      await navigator.clipboard.writeText(field.value);
      this.copiedKey.set(field.key);
      setTimeout(() => {
        if (this.copiedKey() === field.key) this.copiedKey.set(null);
      }, 1500);
    } catch {
      // ignore
    }
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
}
