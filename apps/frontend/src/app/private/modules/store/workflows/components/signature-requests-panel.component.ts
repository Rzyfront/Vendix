import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  BadgeComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  ToastService,
} from '../../../../../shared/components/index';
import { formatStoreDateTime } from '../../../../../shared/utils/date.util';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import {
  DocumentSignaturesApiService,
  IssuedDocumentStatus,
  SignableDocumentView,
  SignatureEventView,
  SignatureMethod,
  SignatureRequestStatus,
  SignatureRequestView,
  SignerInput,
  SignerStatus,
} from '../services/document-signatures-api.service';
import { apiErrorMessage } from '../utils/workflow-errors.util';
import { openUrlInNewTab, shortHash } from '../utils/workflow-labels.util';
import { WorkflowCommentOutcomeModalComponent } from './comment-outcome-modal.component';

type Tone = 'success' | 'neutral' | 'error' | 'primary' | 'warning' | 'info';

interface SignerForm {
  name: string;
  document_number: string;
  role_label: string;
  slot_key: string;
  method: SignatureMethod;
  email: string;
  phone: string;
}

const MAX_SIGNERS = 10;

const DOCUMENT_STATUS: Record<IssuedDocumentStatus, { label: string; tone: Tone }> = {
  rendering: { label: 'Generando', tone: 'info' },
  issued: { label: 'Emitido', tone: 'primary' },
  pending_signature: { label: 'Pendiente de firma', tone: 'warning' },
  signed: { label: 'Firmado', tone: 'success' },
  voided: { label: 'Anulado', tone: 'neutral' },
  superseded: { label: 'Reemplazado', tone: 'neutral' },
  failed: { label: 'Con error', tone: 'error' },
};

const REQUEST_STATUS: Record<SignatureRequestStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Esperando firmas', tone: 'warning' },
  partially_signed: { label: 'Firmas parciales', tone: 'warning' },
  completed: { label: 'Completada', tone: 'success' },
  declined: { label: 'Rechazada', tone: 'error' },
  expired: { label: 'Vencida', tone: 'neutral' },
  cancelled: { label: 'Cancelada', tone: 'neutral' },
};

const SIGNER_STATUS: Record<SignerStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Sin abrir', tone: 'neutral' },
  viewed: { label: 'Abrió el enlace', tone: 'info' },
  signed: { label: 'Firmó', tone: 'success' },
  declined: { label: 'Rechazó', tone: 'error' },
  expired: { label: 'Vencido', tone: 'neutral' },
  blocked: { label: 'Bloqueado', tone: 'error' },
};

const EVENT_LABEL: Record<string, string> = {
  created: 'Solicitud creada',
  sent: 'Enlace enviado',
  opened: 'Enlace abierto',
  otp_sent: 'Código enviado',
  otp_failed: 'Código incorrecto',
  otp_verified: 'Código verificado',
  consent_accepted: 'Consentimiento aceptado',
  signed: 'Firmó',
  declined: 'Rechazó la firma',
  sealed: 'PDF sellado',
  cancelled: 'Solicitud cancelada',
  expired: 'Solicitud vencida',
};

const emptySigner = (): SignerForm => ({
  name: '',
  document_number: '',
  role_label: '',
  slot_key: '',
  method: 'otp_email',
  email: '',
  phone: '',
});

/**
 * Electronic signature of the issued documents of a request: "Enviar a firmar"
 * (signers and delivery method), state of each signer, the evidence timeline
 * and the sealed PDF. Reads its own endpoint; the request id is the input.
 */
@Component({
  selector: 'app-signature-requests-panel',
  standalone: true,
  imports: [
    FormsModule,
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    WorkflowCommentOutcomeModalComponent,
  ],
  template: `
    @if (loading()) {
      <p class="text-sm text-text-secondary" role="status">Cargando documentos...</p>
    } @else if (loadError()) {
      <p class="text-sm text-error" role="alert">{{ loadError() }}</p>
    } @else if (documents().length === 0) {
      <p class="text-sm text-text-secondary" data-testid="signatures-empty">
        Esta solicitud no tiene documentos emitidos para firmar.
      </p>
    } @else {
      <ul class="flex flex-col gap-3" data-testid="signable-documents">
        @for (doc of documents(); track doc.id) {
          <li class="rounded-xl border border-border p-3" [attr.data-document]="doc.reference">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold text-text-primary">{{ doc.reference }} · {{ doc.title }}</p>
                <app-badge [variant]="documentTone(doc.status)" size="xs">{{ documentLabel(doc.status) }}</app-badge>
              </div>
              @if (canManage() && doc.status === 'issued') {
                <app-button variant="primary" size="sm" (clicked)="openSend(doc)">
                  <app-icon name="pen-line" [size]="14" slot="icon" />
                  Enviar a firmar
                </app-button>
              }
            </div>

            @for (req of doc.requests; track req.id) {
              <div class="mt-3 rounded-lg bg-background p-3" [attr.data-request]="req.id">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <app-badge [variant]="requestTone(req.status)" size="xs">{{ requestLabel(req.status) }}</app-badge>
                    <span class="text-xs text-text-secondary">
                      Enviada {{ dateText(req.created_at) }} · vence {{ dateText(req.expires_at) }}
                    </span>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    @if (req.has_sealed_file) {
                      <app-button variant="outline" size="sm" [loading]="downloading() === req.id" (clicked)="downloadSealed(req)">
                        <app-icon name="download" [size]="14" slot="icon" />
                        PDF firmado
                      </app-button>
                    }
                    @if (canManage() && isOpen(req)) {
                      <app-button variant="outline" size="sm" (clicked)="openCancel(req)">Cancelar</app-button>
                    }
                  </div>
                </div>

                <ul class="mt-2 flex flex-col gap-1">
                  @for (signer of req.signers; track signer.id) {
                    <li class="flex flex-wrap items-center justify-between gap-2 text-sm" [attr.data-signer]="signer.id">
                      <span class="min-w-0 text-text-primary">
                        {{ signer.name }}
                        @if (signer.role_label) { <span class="text-text-secondary">· {{ signer.role_label }}</span> }
                        <span class="text-xs text-text-secondary">
                          · {{ signer.method === 'otp_email' ? 'correo' : 'WhatsApp' }} {{ signer.destination }}
                        </span>
                      </span>
                      <span class="flex items-center gap-2">
                        @if (signer.declined_reason) {
                          <span class="text-xs text-error">{{ signer.declined_reason }}</span>
                        }
                        <app-badge [variant]="signerTone(signer.status)" size="xs">{{ signerLabel(signer.status) }}</app-badge>
                      </span>
                    </li>
                  }
                </ul>

                <button
                  type="button"
                  class="mt-2 text-xs font-medium text-primary hover:underline"
                  (click)="toggleEvidence(req.id)"
                >
                  {{ expanded().has(req.id) ? 'Ocultar evidencia' : 'Ver evidencia' }}
                  ({{ req.chain.count }} {{ req.chain.count === 1 ? 'evento' : 'eventos' }})
                </button>
                @if (expanded().has(req.id)) {
                  <div class="mt-2" data-testid="evidence">
                    <p class="text-xs" [class.text-error]="!req.chain.valid" [class.text-text-secondary]="req.chain.valid">
                      {{ req.chain.valid ? 'Cadena de evidencia íntegra.' : 'La cadena de evidencia no coincide: revisa con soporte.' }}
                      Huella del documento:
                      <span class="font-mono" [title]="req.document_sha256">{{ hashText(req.document_sha256) }}</span>
                      @if (req.sealed_sha256) {
                        · PDF sellado: <span class="font-mono" [title]="req.sealed_sha256">{{ hashText(req.sealed_sha256) }}</span>
                      }
                    </p>
                    <ol class="mt-2 flex flex-col gap-2">
                      @for (event of req.events; track event.seq) {
                        <li class="border-l-2 border-border pl-3">
                          <p class="text-sm font-medium text-text-primary">{{ eventText(req, event) }}</p>
                          <p class="text-xs text-text-secondary">
                            {{ dateText(event.occurred_at) }}
                            @if (event.ip_address) { · IP {{ event.ip_address }} }
                          </p>
                        </li>
                      }
                    </ol>
                  </div>
                }
              </div>
            }
          </li>
        }
      </ul>
    }

    <app-modal
      [isOpen]="sendOpen()"
      (isOpenChange)="onSendOpenChange($event)"
      title="Enviar a firmar"
      [subtitle]="sendSubtitle()"
      size="md"
    >
      <div class="flex flex-col gap-4">
        @for (signer of signerForms(); track $index; let i = $index) {
          <fieldset class="rounded-xl border border-border p-3" [attr.data-signer-form]="i">
            <div class="mb-2 flex items-center justify-between">
              <legend class="text-sm font-semibold text-text-primary">Firmante {{ i + 1 }}</legend>
              @if (signerForms().length > 1) {
                <button type="button" class="text-xs text-error hover:underline" (click)="removeSigner(i)">Quitar</button>
              }
            </div>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <app-input label="Nombre *" [ngModel]="signer.name" (ngModelChange)="setField(i, 'name', $event)" />
              <app-input label="Documento de identidad" [ngModel]="signer.document_number" (ngModelChange)="setField(i, 'document_number', $event)" />
              <app-input label="Rol" placeholder="Ej. Empleado" [ngModel]="signer.role_label" (ngModelChange)="setField(i, 'role_label', $event)" />
              <app-input label="Casilla de firma" helperText="Opcional: clave de la casilla de la plantilla." [ngModel]="signer.slot_key" (ngModelChange)="setField(i, 'slot_key', $event)" />
            </div>
            <div class="mt-3 flex flex-wrap gap-4 text-sm text-text-primary" role="radiogroup" aria-label="Enviar código por">
              <label class="flex items-center gap-2">
                <input type="radio" [name]="'method-' + i" [checked]="signer.method === 'otp_email'" (change)="setMethod(i, 'otp_email')" />
                Código por correo
              </label>
              <label class="flex items-center gap-2">
                <input type="radio" [name]="'method-' + i" [checked]="signer.method === 'otp_whatsapp'" (change)="setMethod(i, 'otp_whatsapp')" />
                Código por WhatsApp
              </label>
            </div>
            <div class="mt-3">
              @if (signer.method === 'otp_email') {
                <app-input label="Correo *" type="email" [ngModel]="signer.email" (ngModelChange)="setField(i, 'email', $event)" />
              } @else {
                <app-input label="Celular con indicativo *" placeholder="+573001234567" [ngModel]="signer.phone" (ngModelChange)="setField(i, 'phone', $event)" />
              }
            </div>
          </fieldset>
        }
        @if (signerForms().length < maxSigners) {
          <app-button variant="outline" size="sm" (clicked)="addSigner()">
            <app-icon name="plus" [size]="14" slot="icon" />
            Agregar firmante
          </app-button>
        }
        @if (sendError()) {
          <p class="text-sm text-error" role="alert">{{ sendError() }}</p>
        }
      </div>
      <div slot="footer" class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="outline" (clicked)="onSendOpenChange(false)">Cancelar</app-button>
        <app-button variant="primary" [loading]="sending()" (clicked)="send()">Enviar a firmar</app-button>
      </div>
    </app-modal>

    <app-workflow-comment-outcome-modal
      [(isOpen)]="cancelOpen"
      title="Cancelar solicitud de firma"
      subtitle="Los enlaces dejarán de funcionar y el documento quedará emitido."
      confirmText="Cancelar solicitud"
      [busy]="cancelling()"
      [errorMessage]="cancelError()"
      (confirmed)="cancel($event)"
    />
  `,
})
export class SignatureRequestsPanelComponent implements OnInit {
  private readonly api = inject(DocumentSignaturesApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly settings = inject(StoreSettingsFacade);

  /** Id of the workflow request whose issued documents are listed. */
  readonly instanceId = input.required<number>();
  /** Send and cancel need `store:workflows:manage`; without it the panel is read-only. */
  readonly canManage = input(false);

  readonly maxSigners = MAX_SIGNERS;
  readonly documents = signal<SignableDocumentView[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly expanded = signal<ReadonlySet<number>>(new Set());
  readonly downloading = signal<number | null>(null);

  readonly sendOpen = signal(false);
  readonly sendDocument = signal<SignableDocumentView | null>(null);
  readonly signerForms = signal<SignerForm[]>([emptySigner()]);
  readonly sending = signal(false);
  readonly sendError = signal('');

  readonly cancelOpen = signal(false);
  readonly cancelTarget = signal<SignatureRequestView | null>(null);
  readonly cancelling = signal(false);
  readonly cancelError = signal('');

  readonly sendSubtitle = computed(() => {
    const doc = this.sendDocument();
    return doc ? `${doc.reference} · ${doc.title}` : '';
  });

  private readonly timezone = computed(() => this.settings.timezone());

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.api
      .listByInstance(this.instanceId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (documents) => {
          this.documents.set(documents);
          this.loadError.set('');
          this.loading.set(false);
        },
        error: (error) => {
          this.loadError.set(apiErrorMessage(error));
          this.loading.set(false);
        },
      });
  }

  // ---- labels ------------------------------------------------------------

  documentLabel = (s: IssuedDocumentStatus) => DOCUMENT_STATUS[s]?.label ?? s;
  documentTone = (s: IssuedDocumentStatus): Tone => DOCUMENT_STATUS[s]?.tone ?? 'neutral';
  requestLabel = (s: SignatureRequestStatus) => REQUEST_STATUS[s]?.label ?? s;
  requestTone = (s: SignatureRequestStatus): Tone => REQUEST_STATUS[s]?.tone ?? 'neutral';
  signerLabel = (s: SignerStatus) => SIGNER_STATUS[s]?.label ?? s;
  signerTone = (s: SignerStatus): Tone => SIGNER_STATUS[s]?.tone ?? 'neutral';
  hashText = (hash: string) => shortHash(hash);

  isOpen(req: SignatureRequestView): boolean {
    return req.status === 'pending' || req.status === 'partially_signed';
  }

  dateText(value: string): string {
    return formatStoreDateTime(value, this.timezone());
  }

  eventText(req: SignatureRequestView, event: SignatureEventView): string {
    const label = EVENT_LABEL[event.type] ?? event.type;
    const signer = req.signers.find((s) => s.id === event.signer_id);
    const reason = typeof event.payload?.['reason'] === 'string' ? `: ${event.payload['reason']}` : '';
    return `${label}${signer ? ' · ' + signer.name : ''}${reason}`;
  }

  toggleEvidence(id: number): void {
    this.expanded.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ---- send --------------------------------------------------------------

  openSend(doc: SignableDocumentView): void {
    this.sendDocument.set(doc);
    this.signerForms.set([emptySigner()]);
    this.sendError.set('');
    this.sendOpen.set(true);
  }

  onSendOpenChange(open: boolean): void {
    this.sendOpen.set(open);
    if (!open) this.sendError.set('');
  }

  addSigner(): void {
    this.signerForms.update((list) => (list.length < MAX_SIGNERS ? [...list, emptySigner()] : list));
  }

  removeSigner(index: number): void {
    this.signerForms.update((list) => list.filter((_, i) => i !== index));
  }

  setField(index: number, field: keyof SignerForm, value: string | null): void {
    this.signerForms.update((list) =>
      list.map((s, i) => (i === index ? { ...s, [field]: value ?? '' } : s)),
    );
  }

  setMethod(index: number, method: SignatureMethod): void {
    this.signerForms.update((list) => list.map((s, i) => (i === index ? { ...s, method } : s)));
  }

  send(): void {
    const doc = this.sendDocument();
    if (!doc || this.sending()) return;
    const signers: SignerInput[] = [];
    for (const [i, form] of this.signerForms().entries()) {
      const name = form.name.trim();
      const email = form.email.trim();
      const phone = form.phone.trim();
      if (name.length < 2) return this.sendError.set(`Firmante ${i + 1}: escribe el nombre.`);
      if (form.method === 'otp_email' && !email) return this.sendError.set(`Firmante ${i + 1}: escribe el correo.`);
      if (form.method === 'otp_whatsapp' && !phone) return this.sendError.set(`Firmante ${i + 1}: escribe el celular con indicativo.`);
      signers.push({
        name,
        method: form.method,
        ...(form.document_number.trim() ? { document_number: form.document_number.trim() } : {}),
        ...(form.role_label.trim() ? { role_label: form.role_label.trim() } : {}),
        ...(form.slot_key.trim() ? { slot_key: form.slot_key.trim() } : {}),
        ...(form.method === 'otp_email' ? { email } : { phone }),
      });
    }
    this.sending.set(true);
    this.sendError.set('');
    this.api
      .create(doc.id, signers)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.sending.set(false);
          this.toast.success('Documento enviado a firmar');
          this.sendOpen.set(false);
          this.reload();
        },
        error: (error) => {
          this.sending.set(false);
          this.sendError.set(apiErrorMessage(error));
        },
      });
  }

  // ---- cancel / download -------------------------------------------------

  openCancel(req: SignatureRequestView): void {
    this.cancelTarget.set(req);
    this.cancelError.set('');
    this.cancelOpen.set(true);
  }

  cancel(reason: string): void {
    const target = this.cancelTarget();
    if (!target || this.cancelling()) return;
    this.cancelling.set(true);
    this.cancelError.set('');
    this.api
      .cancel(target.id, reason)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.cancelling.set(false);
          this.cancelOpen.set(false);
          this.toast.success('Solicitud de firma cancelada');
          this.reload();
        },
        error: (error) => {
          this.cancelling.set(false);
          this.cancelError.set(apiErrorMessage(error));
        },
      });
  }

  downloadSealed(req: SignatureRequestView): void {
    if (this.downloading() !== null) return;
    this.downloading.set(req.id);
    this.api
      .sealedDownload(req.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.downloading.set(null);
          openUrlInNewTab(result.url);
        },
        error: (error) => {
          this.downloading.set(null);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }
}
