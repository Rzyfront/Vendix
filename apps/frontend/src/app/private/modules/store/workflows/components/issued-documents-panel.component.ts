import {
  Component,
  DestroyRef,
  OnInit,
  TemplateRef,
  computed,
  contentChild,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  BadgeComponent,
  ButtonComponent,
  IconComponent,
  ModalComponent,
  SelectorComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../shared/components/index';
import { formatStoreDateTime } from '../../../../../shared/utils/date.util';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import {
  IssuedDocument,
  IssuedDocumentStatus,
  TemplateRow,
} from '../../documents/interfaces/document-template.interfaces';
import { DocumentTemplatesApiService } from '../../documents/services/document-templates-api.service';
import { WorkflowsApiService } from '../services/workflows-api.service';
import { apiErrorMessage } from '../utils/workflow-errors.util';
import { openUrlInNewTab } from '../utils/workflow-labels.util';

type Tone = 'success' | 'neutral' | 'error' | 'primary' | 'warning' | 'info';

const STATUS: Record<IssuedDocumentStatus, { label: string; tone: Tone }> = {
  rendering: { label: 'Generando', tone: 'info' },
  issued: { label: 'Emitido', tone: 'primary' },
  pending_signature: { label: 'Pendiente de firma', tone: 'warning' },
  signed: { label: 'Firmado', tone: 'success' },
  voided: { label: 'Anulado', tone: 'neutral' },
  superseded: { label: 'Reemplazado', tone: 'neutral' },
  failed: { label: 'Con error', tone: 'error' },
};

const POLL_MS = 3000;

/** Requirement of the stage the panel can issue ("Documento emitido"). */
export interface IssuableRequirement {
  key: string;
  label: string;
}

/**
 * Documents issued from templates for a request: reference, state, download,
 * "Emitir" (a requirement of the stage, or any published template), "Reemitir"
 * and "Anular".
 *
 * Extension point for other panels (e.g. "Enviar a firmar"): project an
 * `<ng-template #docActions let-doc>` inside `<app-issued-documents-panel>`;
 * it is rendered next to the actions of every document with the
 * `IssuedDocument` as `let-doc`. The `(changed)` output fires after every
 * emit / reissue / void and when a rendering document finishes, so the host can
 * reload the request.
 */
@Component({
  selector: 'app-issued-documents-panel',
  standalone: true,
  imports: [
    FormsModule,
    NgTemplateOutlet,
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    ModalComponent,
    SelectorComponent,
    TextareaComponent,
  ],
  template: `
    <div class="flex flex-col gap-3" data-testid="issued-documents">
      @if (loadError()) {
        <p class="text-sm text-error" role="alert">{{ loadError() }}</p>
      } @else if (loading()) {
        <p class="text-sm text-text-secondary" role="status">Cargando documentos...</p>
      } @else {
        @if (documents().length === 0) {
          <p class="text-sm text-text-secondary" data-testid="issued-empty">
            Esta solicitud aún no tiene documentos emitidos.
          </p>
        }
        <ul class="flex flex-col gap-2">
          @for (doc of documents(); track doc.id) {
            <li
              class="flex flex-col gap-2 rounded-xl border border-border p-3"
              [class.opacity-70]="doc.status === 'superseded' || doc.status === 'voided'"
              [attr.data-document]="doc.reference"
            >
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold text-text-primary">{{ doc.reference }} · {{ doc.title }}</p>
                  <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                    <app-badge [variant]="tone(doc.status)" size="xs">{{ label(doc.status) }}</app-badge>
                    <span>Plantilla {{ doc.template.name }} v{{ doc.template_version }}</span>
                    <span>{{ dateText(doc.issued_at ?? doc.created_at) }}</span>
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  @if (doc.file_id && doc.status !== 'voided') {
                    <app-button variant="outline" size="sm" [loading]="downloading() === doc.id" (clicked)="download(doc)">
                      <app-icon name="download" [size]="14" slot="icon" />
                      Descargar
                    </app-button>
                  }
                  @if (canReissue(doc)) {
                    <app-button variant="outline" size="sm" [loading]="busy() === doc.id" (clicked)="reissue(doc)">
                      <app-icon name="refresh-cw" [size]="14" slot="icon" />
                      Reemitir
                    </app-button>
                  }
                  @if (canVoid(doc)) {
                    <app-button variant="outline-danger" size="sm" (clicked)="openVoid(doc)">
                      <app-icon name="ban" [size]="14" slot="icon" />
                      Anular
                    </app-button>
                  }
                  @if (actionsTemplate(); as tpl) {
                    <ng-container [ngTemplateOutlet]="tpl" [ngTemplateOutletContext]="{ $implicit: doc }" />
                  }
                </div>
              </div>
              @if (doc.status === 'failed' && doc.error) {
                <p class="text-xs text-error" role="alert">{{ doc.error }}</p>
              }
              @if (doc.status === 'voided' && doc.void_reason) {
                <p class="text-xs italic text-text-secondary">Anulado: {{ doc.void_reason }}</p>
              }
            </li>
          }
        </ul>

        <div class="flex flex-wrap gap-2">
          @for (req of issuable(); track req.key) {
            <app-button variant="primary" size="sm" [loading]="busy() === req.key" (clicked)="emitRequirement(req)">
              <app-icon name="file-plus" [size]="14" slot="icon" />
              Emitir {{ req.label }}
            </app-button>
          }
          <app-button variant="outline" size="sm" (clicked)="openEmit()">
            <app-icon name="file-text" [size]="14" slot="icon" />
            Emitir desde una plantilla
          </app-button>
        </div>
      }
    </div>

    <app-modal
      [isOpen]="emitOpen()"
      (isOpenChange)="emitOpen.set($event)"
      title="Emitir documento"
      subtitle="Se genera con los datos actuales de la solicitud"
      size="md"
    >
      <div class="flex flex-col gap-3">
        <app-selector
          label="Plantilla publicada"
          placeholder="Elige una plantilla"
          [options]="templateOptions()"
          [value]="templateKey()"
          (valueChange)="onTemplate($event)"
        />
        @if (templateOptions().length === 0) {
          <p class="text-xs text-text-secondary">
            La tienda aún no tiene plantillas publicadas. Créalas en Documentos → Plantillas.
          </p>
        }
      </div>
      <div slot="footer" class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="outline" (clicked)="emitOpen.set(false)">Cancelar</app-button>
        <app-button variant="primary" [disabled]="!templateKey()" [loading]="busy() === 'template'" (clicked)="emitTemplate()">
          Emitir
        </app-button>
      </div>
    </app-modal>

    <app-modal
      [isOpen]="voidTarget() !== null"
      (isOpenChange)="closeVoid($event)"
      title="Anular documento"
      [subtitle]="voidTarget()?.reference ?? ''"
      size="md"
    >
      <app-textarea
        label="Motivo"
        placeholder="Por qué se anula (queda en la línea de tiempo)"
        [rows]="3"
        [ngModel]="voidReason()"
        (ngModelChange)="voidReason.set($event ?? '')"
      />
      <div slot="footer" class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="outline" (clicked)="closeVoid(false)">Cancelar</app-button>
        <app-button
          variant="danger"
          [disabled]="voidReason().trim().length < 3"
          [loading]="busy() === 'void'"
          (clicked)="confirmVoid()"
        >
          Anular documento
        </app-button>
      </div>
    </app-modal>
  `,
})
export class IssuedDocumentsPanelComponent implements OnInit {
  private readonly api = inject(DocumentTemplatesApiService);
  private readonly workflowsApi = inject(WorkflowsApiService);
  private readonly toast = inject(ToastService);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly instanceId = input.required<number>();
  /** `issued_document` requirements of the current stage, to offer "Emitir <requisito>". */
  readonly requirements = input<IssuableRequirement[]>([]);
  /** Keys of the requirements still pending: only those get an "Emitir" button. */
  readonly pendingKeys = input<ReadonlySet<string>>(new Set());
  readonly changed = output<void>();

  /** Optional `<ng-template #docActions let-doc>` projected by the host. */
  protected readonly actionsTemplate = contentChild<TemplateRef<{ $implicit: IssuedDocument }>>('docActions');

  readonly documents = signal<IssuedDocument[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly busy = signal<number | string | null>(null);
  readonly downloading = signal<number | null>(null);

  readonly emitOpen = signal(false);
  readonly templates = signal<TemplateRow[]>([]);
  readonly templateKey = signal<string | null>(null);
  readonly voidTarget = signal<IssuedDocument | null>(null);
  readonly voidReason = signal('');

  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  readonly templateOptions = computed(() =>
    this.templates()
      .filter((t) => t.status === 'published')
      .map((t) => ({ value: t.key, label: t.name })),
  );

  /** Requirements with no current document (nothing issued, or it failed/was voided). */
  readonly issuable = computed(() => {
    const pending = this.pendingKeys();
    const live = new Set(
      this.documents()
        .filter((d) => d.requirement_key && ['rendering', 'issued', 'pending_signature', 'signed'].includes(d.status))
        .map((d) => d.requirement_key as string),
    );
    return this.requirements().filter((r) => pending.has(r.key) && !live.has(r.key));
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  ngOnInit(): void {
    this.load();
  }

  label(status: IssuedDocumentStatus): string {
    return STATUS[status].label;
  }

  tone(status: IssuedDocumentStatus): Tone {
    return STATUS[status].tone;
  }

  dateText(value: string): string {
    return formatStoreDateTime(value, this.settings.timezone());
  }

  canReissue(doc: IssuedDocument): boolean {
    return doc.workflow_instance_id !== null && ['issued', 'signed', 'failed'].includes(doc.status);
  }

  canVoid(doc: IssuedDocument): boolean {
    return ['issued', 'signed', 'failed'].includes(doc.status);
  }

  private load(silent = false): void {
    this.api
      .listIssued({ instance_id: this.instanceId() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (docs) => {
          const wasRendering = this.documents().some((d) => d.status === 'rendering');
          this.documents.set(docs);
          this.loading.set(false);
          this.loadError.set(null);
          if (docs.some((d) => d.status === 'rendering')) this.schedulePoll();
          else if (wasRendering) this.changed.emit();
        },
        error: (error) => {
          this.loading.set(false);
          if (!silent) this.loadError.set(apiErrorMessage(error));
        },
      });
  }

  private schedulePoll(): void {
    if (this.pollTimer !== null) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.load(true);
    }, POLL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private done(message: string): void {
    this.toast.success(message);
    this.busy.set(null);
    this.load();
    this.changed.emit();
  }

  private failed(error: unknown): void {
    this.busy.set(null);
    this.toast.error(apiErrorMessage(error));
  }

  download(doc: IssuedDocument): void {
    if (!doc.file_id || this.downloading() !== null) return;
    this.downloading.set(doc.id);
    this.workflowsApi
      .getFileDownload(doc.file_id)
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

  emitRequirement(req: IssuableRequirement): void {
    if (this.busy() !== null) return;
    this.busy.set(req.key);
    this.api
      .emit({ instance_id: this.instanceId(), requirement_key: req.key })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: () => this.done('Documento en preparación'), error: (e) => this.failed(e) });
  }

  openEmit(): void {
    this.templateKey.set(null);
    this.emitOpen.set(true);
    this.api
      .list({ status: 'published' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.templates.set(rows),
        error: (e) => this.toast.error(apiErrorMessage(e)),
      });
  }

  emitTemplate(): void {
    const key = this.templateKey();
    if (!key || this.busy() !== null) return;
    this.busy.set('template');
    this.api
      .emit({ instance_id: this.instanceId(), template_key: key })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.emitOpen.set(false);
          this.done('Documento en preparación');
        },
        error: (e) => this.failed(e),
      });
  }

  onTemplate(value: string | number | null): void {
    this.templateKey.set(value === null || value === '' ? null : String(value));
  }

  reissue(doc: IssuedDocument): void {
    if (this.busy() !== null) return;
    this.busy.set(doc.id);
    this.api
      .reissue(doc.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: () => this.done('Documento en preparación'), error: (e) => this.failed(e) });
  }

  openVoid(doc: IssuedDocument): void {
    this.voidReason.set('');
    this.voidTarget.set(doc);
  }

  closeVoid(open: boolean): void {
    if (!open) this.voidTarget.set(null);
  }

  confirmVoid(): void {
    const target = this.voidTarget();
    if (!target || this.busy() !== null) return;
    this.busy.set('void');
    this.api
      .voidIssued(target.id, this.voidReason().trim())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.voidTarget.set(null);
          this.done('Documento anulado');
        },
        error: (e) => this.failed(e),
      });
  }
}
