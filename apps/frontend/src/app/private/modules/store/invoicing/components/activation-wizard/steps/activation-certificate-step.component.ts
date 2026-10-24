import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';

import { environment } from '../../../../../../../../environments/environment';
import { parseApiError } from '../../../../../../../core/utils/parse-api-error';
import { AlertBannerComponent } from '../../../../../../../shared/components/alert-banner/alert-banner.component';
import { BadgeComponent, type BadgeVariant } from '../../../../../../../shared/components/badge/badge.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { CardComponent } from '../../../../../../../shared/components/card/card.component';
import { DianCertificatePanelComponent } from '../../../../../../../shared/components/dian';
import { FileUploadDropzoneComponent } from '../../../../../../../shared/components/file-upload-dropzone/file-upload-dropzone.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { DIAN_API_CONTEXT } from '../../../../../../../shared/services/dian';
import type { ActivationContext } from '../activation-wizard.model';

type CertificateBranch = 'with_cert' | 'without_cert';
type IdentityDocumentType = 'rut' | 'id' | 'certificate_of_existence';

/** Respuesta de `GET dian-config/:id/identity-documents` (sin URLs firmadas). */
interface IdentityDocumentsStatus {
  dian_configuration_id: number;
  certificate_provisioning_status: string;
  person_type: 'natural' | 'juridica';
  required_documents: IdentityDocumentType[];
  missing_documents: IdentityDocumentType[];
  can_submit: boolean;
  documents: {
    id: number;
    document_type: IdentityDocumentType;
    label: string;
    original_filename: string | null;
    uploaded_at: string;
  }[];
}

const DOCUMENT_LABELS: Record<IdentityDocumentType, string> = {
  rut: 'RUT',
  id: 'Documento de identidad',
  certificate_of_existence: 'Certificado de existencia y representación legal',
};

/** Pasos visibles del trámite asistido, en orden. */
const PROVISIONING_STAGES: readonly { key: string; label: string }[] = [
  { key: 'documents_pending', label: 'Pendiente de documentos' },
  { key: 'documents_submitted', label: 'Enviado' },
  { key: 'issuing', label: 'En revisión' },
  { key: 'issued', label: 'Emitido' },
];

/**
 * Paso 3 del asistente de activación: certificado digital de firma.
 *
 * Dos ramas: subir el .p12 propio (`app-dian-certificate-panel`) o, solo en
 * tienda, que la plataforma lo tramite con los documentos de identidad
 * (`dian-config/:id/identity-documents`). Mientras el trámite está en curso el
 * paso NO queda completo: es una espera, no un error.
 */
@Component({
  selector: 'vendix-activation-certificate-step',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AlertBannerComponent,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    DianCertificatePanelComponent,
    FileUploadDropzoneComponent,
  ],
  template: `
    @if (!config()) {
      <app-card>
        <p class="text-sm text-[var(--color-text-secondary)]">Completa el paso 2 para continuar.</p>
      </app-card>
    } @else {
      <div class="flex flex-col gap-4">
        <app-card>
          <div class="flex flex-col gap-3">
            <div class="min-w-0">
              <h2 class="text-base font-semibold text-[var(--color-text-primary)]">Certificado digital</h2>
              <p class="text-xs text-[var(--color-text-secondary)] mt-0.5">
                Con este certificado se firman todos los documentos que envías a la DIAN.
              </p>
            </div>

            @if (context().readOnly && context().readOnlyReason) {
              <app-alert-banner variant="info" icon="info">{{ context().readOnlyReason }}</app-alert-banner>
            }

            <fieldset class="grid grid-cols-1 sm:grid-cols-2 gap-2 border-0 p-0 m-0" [disabled]="context().readOnly">
              <legend class="sr-only">¿Tienes certificado digital?</legend>
              @for (option of branchOptions(); track option.value) {
                <label
                  class="flex items-start gap-3 rounded-lg border p-3 min-h-11 cursor-pointer transition-colors"
                  [class]="
                    branch() === option.value
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]'
                      : 'border-[var(--color-border)] hover:border-[var(--color-primary)]'
                  "
                >
                  <input
                    type="radio"
                    name="activation_certificate_branch"
                    class="mt-1"
                    [value]="option.value"
                    [checked]="branch() === option.value"
                    (change)="branch.set(option.value)"
                  />
                  <span class="min-w-0">
                    <span class="block text-sm font-medium text-[var(--color-text-primary)]">{{ option.title }}</span>
                    <span class="block text-xs text-[var(--color-text-secondary)]">{{ option.hint }}</span>
                  </span>
                </label>
              }
            </fieldset>
          </div>
        </app-card>

        @if (branch() === 'with_cert') {
          <app-dian-certificate-panel
            [certificate]="config()"
            [configId]="config()!.id"
            [expectedNit]="config()!.nit"
            (uploaded)="changed.emit()"
          ></app-dian-certificate-panel>
        } @else {
          @if (isOrganization()) {
            <app-alert-banner variant="warning" icon="alert-triangle">
              El trámite asistido no está disponible para organizaciones. Debes subir el certificado .p12
              de la organización.
            </app-alert-banner>
          } @else {
            <app-card>
              <div class="flex flex-col gap-4">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Trámite del certificado</h3>
                    <p class="text-xs text-[var(--color-text-secondary)] mt-0.5">
                      Adjunta los documentos y la plataforma tramita el certificado a nombre de la empresa.
                    </p>
                  </div>
                  @if (stageLabel(); as label) {
                    <app-badge [variant]="stageBadge()" size="xs">{{ label }}</app-badge>
                  }
                </div>

                @if (loading()) {
                  <div class="h-24 rounded-lg bg-[var(--color-surface-secondary)] animate-pulse" aria-hidden="true"></div>
                } @else if (loadError(); as message) {
                  <app-alert-banner variant="danger" icon="alert-triangle">{{ message }}</app-alert-banner>
                  <div><app-button variant="outline" size="sm" (clicked)="loadStatus()">Reintentar</app-button></div>
                } @else if (status(); as s) {
                  <ol class="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Estado del trámite">
                    @for (stage of stages(); track stage.key) {
                      <li
                        class="inline-flex items-center gap-1.5"
                        [class]="stage.reached ? 'text-[var(--color-text-primary)] font-medium' : 'text-[var(--color-text-secondary)]'"
                      >
                        <app-icon [name]="stage.reached ? 'check-circle' : 'circle'" [size]="14"></app-icon>
                        {{ stage.label }}
                      </li>
                    }
                  </ol>

                  @if (waiting()) {
                    <app-alert-banner variant="info" icon="clock">
                      Esperando el certificado.
                      @if (s.certificate_provisioning_status === 'documents_submitted') {
                        Recibimos tus documentos y están en cola de revisión.
                      } @else {
                        Estamos tramitando el certificado con la entidad emisora.
                      }
                      Te avisaremos cuando esté listo; puedes cerrar esta pantalla y volver después.
                    </app-alert-banner>
                  } @else if (s.certificate_provisioning_status === 'rejected') {
                    <app-alert-banner variant="danger" icon="alert-triangle">
                      El trámite fue rechazado. Revisa los documentos o sube tu propio certificado .p12.
                    </app-alert-banner>
                  }

                  @if (!waiting()) {
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                      @for (type of s.required_documents; track type) {
                        @if (uploadedDocument(type); as doc) {
                          <div class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] p-3 min-w-0">
                            <app-icon name="file-check" [size]="18" class="text-[var(--color-success)] shrink-0"></app-icon>
                            <div class="min-w-0 text-xs">
                              <p class="font-medium text-[var(--color-text-primary)]">{{ label(type) }}</p>
                              <p class="text-[var(--color-text-secondary)] truncate">{{ doc.original_filename || 'Archivo cargado' }}</p>
                            </div>
                          </div>
                        } @else {
                          <app-file-upload-dropzone
                            accept="application/pdf,image/jpeg,image/png,image/webp"
                            icon="upload-cloud"
                            [label]="label(type)"
                            helperText="Obligatorio · PDF, JPG, PNG o WEBP"
                            [disabled]="uploading() !== null || context().readOnly"
                            (fileSelected)="upload(type, $event)"
                          ></app-file-upload-dropzone>
                        }
                      }
                    </div>
                  }

                  @if (actionError(); as message) {
                    <app-alert-banner variant="danger" icon="alert-triangle">{{ message }}</app-alert-banner>
                  }

                  <div class="flex flex-wrap justify-end gap-2">
                    <app-button variant="outline" size="sm" [disabled]="refreshing()" [loading]="refreshing()" (clicked)="refresh()">
                      Actualizar estado
                    </app-button>
                    @if (canSubmit() && !context().readOnly) {
                      <app-button variant="primary" size="sm" [loading]="submitting()" [disabled]="submitting()" (clicked)="submit()">
                        Enviar documentos
                      </app-button>
                    }
                  </div>
                }
              </div>
            </app-card>
          }
        }
      </div>
    }
  `,
})
export class ActivationCertificateStepComponent {
  private readonly http = inject(HttpClient);
  private readonly dianContext = inject(DIAN_API_CONTEXT);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly context = input.required<ActivationContext>();
  readonly changed = output<void>();

  readonly config = computed(() => this.context().config);
  readonly isOrganization = computed(() => this.context().scope === 'organization');

  readonly branch = signal<CertificateBranch>('with_cert');
  readonly status = signal<IdentityDocumentsStatus | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly uploading = signal<IdentityDocumentType | null>(null);
  readonly submitting = signal(false);
  readonly refreshing = signal(false);

  readonly branchOptions = computed(() => [
    {
      value: 'with_cert' as CertificateBranch,
      title: 'Tengo mi certificado (.p12)',
      hint: 'Lo subo ahora con su contraseña.',
    },
    {
      value: 'without_cert' as CertificateBranch,
      title: 'No tengo certificado',
      hint: this.isOrganization()
        ? 'No disponible para organizaciones.'
        : 'La plataforma lo tramita con mis documentos de identidad.',
    },
  ]);

  /** El trámite ya salió de nuestras manos: se espera, no se actúa. */
  readonly waiting = computed(() => {
    const s = this.status()?.certificate_provisioning_status;
    return s === 'documents_submitted' || s === 'issuing';
  });

  readonly canSubmit = computed(() => {
    const s = this.status();
    if (!s) return false;
    const st = s.certificate_provisioning_status;
    return s.can_submit && (st === 'documents_pending' || st === 'not_required');
  });

  readonly stages = computed(() => {
    const current = this.status()?.certificate_provisioning_status ?? 'documents_pending';
    const rank = Math.max(
      0,
      PROVISIONING_STAGES.findIndex((s) => s.key === (current === 'not_required' ? 'documents_pending' : current)),
    );
    return PROVISIONING_STAGES.map((stage, index) => ({
      ...stage,
      reached: index < rank || (index === rank && index > 0),
    }));
  });

  readonly stageLabel = computed(() => {
    const st = this.status()?.certificate_provisioning_status;
    if (!st) return null;
    if (st === 'rejected') return 'Rechazado';
    if (st === 'not_required') return 'Pendiente de documentos';
    return PROVISIONING_STAGES.find((s) => s.key === st)?.label ?? st;
  });

  readonly stageBadge = computed<BadgeVariant>(() => {
    switch (this.status()?.certificate_provisioning_status) {
      case 'issued':
        return 'success';
      case 'rejected':
        return 'error';
      case 'documents_submitted':
      case 'issuing':
        return 'info';
      default:
        return 'warning';
    }
  });

  private loadedConfigId: number | null = null;

  constructor() {
    // Una vez por configuración: si ya hay un trámite en curso, se abre en esa rama.
    effect(() => {
      const config = this.config();
      if (!config || this.isOrganization() || config.id === this.loadedConfigId) return;
      this.loadedConfigId = config.id;
      untracked(() => this.loadStatus(true));
    });
  }

  label(type: IdentityDocumentType): string {
    return DOCUMENT_LABELS[type] ?? type;
  }

  uploadedDocument(type: IdentityDocumentType) {
    return this.status()?.documents.find((d) => d.document_type === type) ?? null;
  }

  loadStatus(adoptBranch = false): void {
    const id = this.config()?.id;
    if (!id) return;
    this.loading.set(this.status() === null);
    this.loadError.set(null);
    this.http
      .get<{ data?: IdentityDocumentsStatus }>(this.url(id))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const data = res?.data ?? (res as unknown as IdentityDocumentsStatus);
          this.status.set(data);
          this.loading.set(false);
          // La respuesta saneada ya no trae `certificate_s3_key`: manda `certificate_present`.
          const cfg = this.config();
          const hasCert = cfg?.certificate_present ?? Boolean(cfg?.certificate_s3_key);
          if (adoptBranch && data.certificate_provisioning_status !== 'not_required' && !hasCert) {
            this.branch.set('without_cert');
          }
        },
        error: (error) => {
          this.loading.set(false);
          // Un 404/permiso en la lectura inicial no debe romper la rama .p12.
          if (!adoptBranch) this.loadError.set(parseApiError(error).userMessage);
        },
      });
  }

  upload(type: IdentityDocumentType, file: File): void {
    const id = this.config()?.id;
    if (!id || this.uploading()) return;
    const form = new FormData();
    form.append('document', file);
    form.append('document_type', type);
    this.uploading.set(type);
    this.actionError.set(null);
    this.http
      .post(`${this.url(id)}`, form)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.uploading.set(null);
          this.loadStatus();
        },
        error: (error) => {
          this.uploading.set(null);
          this.actionError.set(parseApiError(error).userMessage);
        },
      });
  }

  submit(): void {
    const id = this.config()?.id;
    if (!id || this.submitting()) return;
    this.submitting.set(true);
    this.actionError.set(null);
    this.http
      .post(`${this.url(id)}/submit`, {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.toast.success('Documentos enviados. Te avisaremos cuando el certificado esté listo.');
          this.loadStatus();
          this.changed.emit();
        },
        error: (error) => {
          this.submitting.set(false);
          this.actionError.set(parseApiError(error).userMessage);
        },
      });
  }

  /** Re-lee el estado; si el certificado ya fue emitido, el shell recarga el snapshot. */
  refresh(): void {
    const id = this.config()?.id;
    if (!id) return;
    this.refreshing.set(true);
    this.http
      .get<{ data?: IdentityDocumentsStatus }>(this.url(id))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const data = res?.data ?? (res as unknown as IdentityDocumentsStatus);
          this.status.set(data);
          this.refreshing.set(false);
          this.changed.emit();
        },
        error: (error) => {
          this.refreshing.set(false);
          this.actionError.set(parseApiError(error).userMessage);
        },
      });
  }

  private url(configId: number): string {
    return `${environment.apiUrl}/${this.dianContext.basePath()}/dian-config/${configId}/identity-documents`;
  }
}
