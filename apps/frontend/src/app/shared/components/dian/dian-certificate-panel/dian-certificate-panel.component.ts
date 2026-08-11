import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { BadgeComponent, type BadgeVariant } from '../../badge/badge.component';
import { ButtonComponent } from '../../button/button.component';
import { CardComponent } from '../../card/card.component';
import { FileUploadDropzoneComponent } from '../../file-upload-dropzone/file-upload-dropzone.component';
import { IconComponent } from '../../icon/icon.component';
import { InputComponent } from '../../input/input.component';
import { DIAN_API_CONTEXT, DianConfigApiService } from '../../../services/dian';
import { formatDateOnlyUTC } from '../../../utils/date.util';
import {
  CERTIFICATE_EXPIRY_ALERT_DAYS,
  type DianCertificateState,
} from '../fiscal-readiness.interface';

/** Cómo de cerca está el vencimiento. Los tramos son los de `CERTIFICATE_EXPIRY_ALERT_DAYS`. */
type ExpiryTier = 'none' | 'expired' | 'critical' | 'warning' | 'notice' | 'ok';

const MS_PER_DAY = 86_400_000;

/**
 * Estado y custodia del certificado digital de UNA configuración DIAN, más su
 * carga.
 *
 * ## Por qué muestra antes de ofrecer
 *
 * La versión anterior de esta pantalla sólo ofrecía «subir certificado». Con esa
 * UI, un comerciante que YA tiene un `.p12` vigente no tiene forma de saberlo, y
 * la respuesta natural a cualquier problema de firma es volver a subirlo. Este
 * panel invierte el orden: primero dice si hay certificado, cuándo vence, a qué
 * NIT pertenece y quién custodia la llave privada; la carga es lo último y es
 * explícitamente un REEMPLAZO cuando ya existe uno.
 *
 * ## El vencimiento se cuenta, no se adjetiva
 *
 * «Vence pronto» no mueve a nadie. Reexpedir un `.p12` ante una entidad de
 * certificación digital toma días, así que el aviso escala en 30/15/7 días —los
 * mismos tramos que evalúa el backend— y siempre dice cuántos quedan.
 *
 * ## Un aviso no bloquea
 *
 * Ni el vencimiento próximo ni la falta de coincidencia de NIT deshabilitan
 * nada aquí: informan. Bloquear la pantalla el día que salta el aviso sería
 * provocar la caída que el aviso venía a prevenir.
 */
@Component({
  selector: 'app-dian-certificate-panel',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    CardComponent,
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    FileUploadDropzoneComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card>
      <div class="flex flex-col gap-4">
        <!-- Cabecera -->
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-2 min-w-0">
            <app-icon
              name="shield-check"
              [size]="18"
              class="text-[var(--color-text-secondary)] shrink-0"
            ></app-icon>
            <h3
              class="text-sm font-semibold text-[var(--color-text-primary)] truncate"
            >
              Certificado digital
            </h3>
          </div>
          <app-badge [variant]="stateBadgeVariant()" size="xs">
            {{ stateBadgeLabel() }}
          </app-badge>
        </div>

        @if (hasCertificate()) {
          <!-- Vigencia: lo primero, y contada en días -->
          <div
            class="rounded-lg border p-3 flex items-start gap-2"
            [class]="expiryBoxClasses()"
          >
            <app-icon
              [name]="expiryIcon()"
              [size]="16"
              class="shrink-0 mt-0.5"
            ></app-icon>
            <div class="min-w-0 text-xs">
              <p class="font-medium text-[var(--color-text-primary)]">
                {{ expiryHeadline() }}
              </p>
              @if (expiryDetail(); as detail) {
                <p class="text-[var(--color-text-secondary)] mt-0.5">
                  {{ detail }}
                </p>
              }
            </div>
          </div>

          <!-- Identidad y custodia -->
          <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
            @for (row of identityRows(); track row.label) {
              <div class="min-w-0">
                <dt class="text-[var(--color-text-secondary)]">
                  {{ row.label }}
                </dt>
                <dd
                  class="font-mono text-[var(--color-text-primary)] break-all"
                >
                  {{ row.value }}
                </dd>
              </div>
            }
          </dl>

          <!-- NIT: si no coincide, la DIAN rechaza cada firma -->
          @if (nitMismatch(); as mismatch) {
            <div
              class="rounded-lg border border-[var(--color-error)] bg-[var(--color-error-light)] p-3 flex items-start gap-2 text-xs"
            >
              <app-icon
                name="alert-triangle"
                [size]="16"
                class="text-[var(--color-error)] shrink-0 mt-0.5"
              ></app-icon>
              <span class="text-[var(--color-text-primary)]">
                El certificado pertenece al NIT {{ mismatch.certificate }} y la
                configuración declara el {{ mismatch.declared }}. La DIAN
                rechaza cada documento firmado con un certificado que no es del
                emisor: hay que subir el del NIT declarado, o corregir el NIT de
                la configuración.
              </span>
            </div>
          }

          <!-- Custodia de la llave privada -->
          <p
            class="text-[11px] text-[var(--color-text-secondary)] flex items-start gap-1.5"
          >
            <app-icon name="key-round" [size]="12" class="shrink-0 mt-0.5"></app-icon>
            <span>{{ custodyNote() }}</span>
          </p>
        } @else {
          <p class="text-xs text-[var(--color-text-secondary)]">
            Esta configuración no tiene certificado digital. Sin él no se puede
            firmar ningún documento electrónico: la DIAN no recibe nada, ni
            siquiera para el set de pruebas.
          </p>
        }

        <!-- Carga / reemplazo -->
        @if (canUpload()) {
          <div class="pt-2 border-t border-[var(--color-border)] flex flex-col gap-3">
            <p class="text-xs font-medium text-[var(--color-text-primary)]">
              {{ hasCertificate() ? 'Reemplazar certificado' : 'Subir certificado' }}
            </p>

            <app-file-upload-dropzone
              label="Archivo .p12 o .pfx"
              accept=".p12,.pfx"
              icon="shield-check"
              helperText="El archivo se cifra y se guarda; nunca se muestra de vuelta."
              [disabled]="submitting()"
              (fileSelected)="onFileSelected($event)"
              (fileRemoved)="onFileRemoved()"
            ></app-file-upload-dropzone>

            <!-- Sin [disabled]: FormControlDirective también declara una entrada
                 "disabled", así que el binding llegaría a las DOS directivas del
                 elemento y Angular acabaría deshabilitando el control de forma
                 imperativa a espaldas del formulario. -->
            <app-input
              type="password"
              label="Contraseña del certificado"
              placeholder="La contraseña con la que se exportó el .p12"
              [formControl]="passwordControl"
            ></app-input>

            @if (errorText(); as message) {
              <p class="text-xs text-[var(--color-error)]">{{ message }}</p>
            }
            @if (successText(); as message) {
              <p class="text-xs text-[var(--color-success)]">{{ message }}</p>
            }

            <div class="flex items-center gap-2">
              <app-button
                size="sm"
                variant="primary"
                [disabled]="!canSubmit()"
                [loading]="submitting()"
                (clicked)="submit()"
              >
                <app-icon slot="icon" name="upload" [size]="14"></app-icon>
                {{ hasCertificate() ? 'Reemplazar' : 'Subir' }}
              </app-button>
              @if (!configId()) {
                <span class="text-[11px] text-[var(--color-text-secondary)]">
                  Primero hay que crear la configuración DIAN de este eje.
                </span>
              }
            </div>
          </div>
        } @else {
          <p
            class="text-[11px] text-[var(--color-text-secondary)] flex items-start gap-1.5 pt-2 border-t border-[var(--color-border)]"
          >
            <app-icon name="lock" [size]="12" class="shrink-0 mt-0.5"></app-icon>
            <span>
              No tienes permiso para cambiar el certificado de esta
              configuración.
            </span>
          </p>
        }
      </div>
    </app-card>
  `,
})
export class DianCertificatePanelComponent {
  /** Estado del certificado. `null` cuando el eje aún no tiene configuración. */
  readonly certificate = input.required<DianCertificateState | null>();

  /** Configuración sobre la que se sube. `null` inhabilita el envío, no la lectura. */
  readonly configId = input.required<number | null>();

  /**
   * NIT declarado en la configuración, para contrastarlo con el del `.p12`.
   * Cuando no se pasa, se toma el del propio objeto (`certificate().nit`).
   */
  readonly expectedNit = input<string | null>(null);

  /**
   * Carga completada. El host RECARGA su agregado al recibirlo: este panel no
   * inventa el nuevo estado del certificado —huella, vigencia y NIT los deriva
   * el backend del `.p12`— y pintarlo desde el cliente sería adivinar.
   */
  readonly uploaded = output<void>();

  private readonly api = inject(DianConfigApiService);
  private readonly dianContext = inject(DIAN_API_CONTEXT);
  private readonly destroyRef = inject(DestroyRef);

  readonly capabilities = computed(() => this.dianContext.capabilities());
  readonly canUpload = computed(() => this.capabilities().uploadCertificate);

  readonly passwordControl = new FormControl<string>('', { nonNullable: true });

  readonly pendingFile = signal<File | null>(null);
  readonly submitting = signal(false);
  readonly errorText = signal<string | null>(null);
  readonly successText = signal<string | null>(null);

  readonly hasCertificate = computed(() => {
    const certificate = this.certificate();
    if (!certificate) return false;
    return Boolean(
      certificate.certificate_fingerprint ||
        certificate.certificate_s3_key ||
        certificate.certificate_uploaded_at ||
        certificate.certificate_expiry,
    );
  });

  /**
   * Días hasta el vencimiento. `null` cuando no hay fecha — que NO es lo mismo
   * que «no vence»: es que no lo sabemos, y por eso no se pinta ningún tramo.
   */
  readonly daysToExpiry = computed<number | null>(() => {
    const raw = this.certificate()?.certificate_expiry;
    if (!raw) return null;
    const expiry = new Date(raw).getTime();
    if (Number.isNaN(expiry)) return null;
    return Math.floor((expiry - Date.now()) / MS_PER_DAY);
  });

  readonly expiryTier = computed<ExpiryTier>(() => {
    if (!this.hasCertificate()) return 'none';
    const days = this.daysToExpiry();
    if (days === null) return 'none';
    if (days < 0) return 'expired';
    const [notice, warning, critical] = CERTIFICATE_EXPIRY_ALERT_DAYS;
    if (days <= critical) return 'critical';
    if (days <= warning) return 'warning';
    if (days <= notice) return 'notice';
    return 'ok';
  });

  readonly expiryHeadline = computed(() => {
    const days = this.daysToExpiry();
    if (days === null) return 'Certificado cargado, sin fecha de vencimiento leída';
    if (days < 0) return 'El certificado está vencido';
    if (days === 0) return 'El certificado vence hoy';
    if (days === 1) return 'El certificado vence mañana';
    return `El certificado vence en ${days} días`;
  });

  readonly expiryDetail = computed<string | null>(() => {
    const raw = this.certificate()?.certificate_expiry;
    if (!raw) return null;
    const date = formatDateOnlyUTC(raw);
    const tier = this.expiryTier();
    if (tier === 'expired') {
      return `Venció el ${date}. La DIAN rechaza todo documento firmado con él.`;
    }
    if (tier === 'critical' || tier === 'warning') {
      return `Vence el ${date}. Reexpedirlo ante la entidad de certificación toma días: conviene iniciarlo ya.`;
    }
    return `Vence el ${date}.`;
  });

  readonly expiryIcon = computed(() => {
    const tier = this.expiryTier();
    if (tier === 'expired' || tier === 'critical') return 'alert-triangle';
    if (tier === 'warning' || tier === 'notice') return 'clock';
    return 'check-circle';
  });

  readonly expiryBoxClasses = computed(() => {
    const tier = this.expiryTier();
    if (tier === 'expired' || tier === 'critical') {
      return 'border-[var(--color-error)] bg-[var(--color-error-light)] text-[var(--color-error)]';
    }
    if (tier === 'warning' || tier === 'notice') {
      return 'border-[var(--color-warning)] bg-[var(--color-warning-light)] text-[var(--color-warning)]';
    }
    return 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-success)]';
  });

  readonly stateBadgeVariant = computed<BadgeVariant>(() => {
    if (!this.hasCertificate()) return 'neutral';
    const tier = this.expiryTier();
    if (tier === 'expired' || tier === 'critical') return 'error';
    if (tier === 'warning' || tier === 'notice') return 'warning';
    if (this.nitMismatch()) return 'error';
    return 'success';
  });

  readonly stateBadgeLabel = computed(() => {
    if (!this.hasCertificate()) return 'Sin certificado';
    if (this.expiryTier() === 'expired') return 'Vencido';
    if (this.nitMismatch()) return 'NIT no coincide';
    return 'Cargado';
  });

  /**
   * NIT del certificado contra el declarado, comparados por dígitos.
   *
   * El `.p12` trae el NIT con o sin guion del DV según la entidad emisora, así
   * que compararlos como cadenas produce falsos positivos que asustan sin
   * motivo. Sólo se reporta cuando los dos valores existen: ausencia de dato no
   * es discrepancia.
   */
  readonly nitMismatch = computed<{
    declared: string;
    certificate: string;
  } | null>(() => {
    const certificate = this.certificate();
    if (!certificate) return null;
    const declaredRaw = this.expectedNit() ?? certificate.nit ?? null;
    const certificateRaw = certificate.certificate_nit ?? null;
    if (!declaredRaw || !certificateRaw) return null;

    const digits = (value: string) => value.replace(/\D/g, '');
    const declared = digits(declaredRaw);
    const fromCertificate = digits(certificateRaw);
    if (!declared || !fromCertificate) return null;
    // Un NIT colombiano puede venir con el dígito de verificación pegado. Se
    // acepta la coincidencia por prefijo en cualquiera de los dos sentidos.
    if (
      declared === fromCertificate ||
      declared.startsWith(fromCertificate) ||
      fromCertificate.startsWith(declared)
    ) {
      return null;
    }
    return { declared: declaredRaw, certificate: certificateRaw };
  });

  readonly identityRows = computed(() => {
    const certificate = this.certificate();
    if (!certificate) return [];
    const rows: Array<{ label: string; value: string }> = [];
    const push = (label: string, value: unknown) => {
      if (value === null || value === undefined || value === '') return;
      rows.push({ label, value: String(value) });
    };

    push('NIT del certificado', certificate.certificate_nit);
    push('Huella (fingerprint)', certificate.certificate_fingerprint);
    push('Serie', certificate.certificate_serial_number);
    push('Titular', certificate.certificate_subject);
    push('Emisor', certificate.certificate_issuer);
    if (certificate.certificate_uploaded_at) {
      push('Cargado el', formatDateOnlyUTC(certificate.certificate_uploaded_at));
    }
    return rows;
  });

  readonly custodyNote = computed(() => {
    const certificate = this.certificate();
    if (certificate?.certificate_kms_key_id) {
      return (
        'La llave privada la custodia AWS KMS: la firma se produce dentro del ' +
        'servicio y el archivo .p12 nunca se abre en memoria del proceso.'
      );
    }
    return (
      'La llave privada se lee del archivo .p12 en memoria del proceso al ' +
      'firmar. Es la custodia histórica y sigue siendo válida.'
    );
  });

  readonly canSubmit = computed(
    () =>
      this.canUpload() &&
      this.configId() !== null &&
      this.pendingFile() !== null &&
      !this.submitting(),
  );

  onFileSelected(file: File): void {
    this.pendingFile.set(file);
    this.errorText.set(null);
    this.successText.set(null);
  }

  onFileRemoved(): void {
    this.pendingFile.set(null);
  }

  submit(): void {
    const configId = this.configId();
    const file = this.pendingFile();
    if (!configId || !file || this.submitting()) return;

    this.submitting.set(true);
    this.errorText.set(null);
    this.successText.set(null);

    this.api
      .uploadDianCertificate(configId, file, this.passwordControl.value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.pendingFile.set(null);
          this.passwordControl.setValue('');
          this.successText.set(
            'Certificado guardado. Su vigencia, huella y NIT se leen del propio archivo.',
          );
          this.uploaded.emit();
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          this.errorText.set(this.messageOf(error));
        },
      });
  }

  /**
   * El error se muestra CRUDO cuando el backend lo redactó. Las causas reales de
   * fallo aquí —contraseña incorrecta, `.p12` sin llave privada, NIT que no es
   * el de la configuración— sólo las distingue el servidor, y sustituirlas por
   * un «no se pudo subir» genérico deja al usuario probando contraseñas.
   */
  private messageOf(error: unknown): string {
    const candidate = error as {
      error?: { message?: string; error?: { message?: string } };
      message?: string;
    };
    return (
      candidate?.error?.message ??
      candidate?.error?.error?.message ??
      candidate?.message ??
      'No se pudo guardar el certificado.'
    );
  }
}
