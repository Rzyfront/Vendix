import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AlertBannerComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  ToggleComponent,
} from '../../../../../../../shared/components/index';
import {
  HUMAN_STAGE_TYPES,
  WORKFLOW_LIMITS,
  WorkflowRequirementDef,
  WorkflowStageDef,
} from '../../../../../../../shared/workflows/contract/workflow-contract';
import { DocumentTemplatesApiService } from '../../../../documents/services/document-templates-api.service';
import { WorkflowEditorStore } from '../../workflow-editor.store';
import { removeAt, replaceAt, uniqueKey } from '../../workflow-editor.utils';
import { FileLimits, FileLimitsComponent } from '../file-limits.component';

const SIGNATURE_HINT = 'agrega primero un requisito de documento emitido en esta etapa';
const NO_TEMPLATES_HINT = 'Publica una plantilla en Documentos → Plantillas para usar este requisito';

const KIND_TEXT: Record<string, string> = {
  upload: 'Subir un archivo',
  file_field: 'Archivo de un campo',
  issued_document: 'Documento emitido',
  signature: 'Firma',
};

/** Requisitos tab: upload, file_field, issued_document (P4.1) and signature (P4.2) requirements. */
@Component({
  selector: 'app-stage-requirements-tab',
  standalone: true,
  imports: [
    FormsModule,
    AlertBannerComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    ToggleComponent,
    FileLimitsComponent,
  ],
  template: `
    @if (isHuman()) {
      <div class="flex flex-col gap-3">
        <p class="text-xs text-text-secondary">
          Lo que debe estar listo antes de avanzar la etapa (por ejemplo, un soporte en PDF).
        </p>
        @for (req of requirements(); track $index; let i = $index) {
          <div class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3" data-testid="requirement">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold text-text-primary">{{ kindText(req.kind) }}</span>
              <app-button variant="outline-danger" size="xsm" ariaLabel="Quitar requisito" (clicked)="remove(i)">
                <app-icon name="trash-2" [size]="12" slot="icon" />
              </app-button>
            </div>
            <app-input label="Nombre del requisito" [ngModel]="req.label" (ngModelChange)="patch(i, { label: $event })" />
              @if (req.kind === 'upload') {
                <app-file-limits [accept]="req.accept" [maxSize]="req.max_size_mb" (changed)="limits(i, $event)" />
                <app-toggle
                  label="Debe cumplirse para avanzar"
                  [checked]="req.blocks_exit !== false"
                  (toggled)="patch(i, { blocks_exit: $event })"
                />
                <app-toggle
                  label="El solicitante externo lo sube desde su enlace de seguimiento"
                  [checked]="req.external === true"
                  (toggled)="patch(i, { external: $event ? true : undefined })"
                />
              } @else if (req.kind === 'issued_document') {
                <app-selector
                  label="Plantilla publicada"
                  placeholder="Elige una plantilla"
                  [options]="templateOptions()"
                  [value]="req.template_key"
                  (valueChange)="patch(i, { template_key: $event })"
                />
                <app-toggle
                  label="Emitir el documento al entrar a la etapa"
                  [checked]="req.auto_issue_on_enter === true"
                  (toggled)="patch(i, { auto_issue_on_enter: $event ? true : undefined })"
                />
              } @else if (req.kind === 'signature') {
                <app-selector
                  label="Documento que se firma"
                  placeholder="Elige un documento emitido de esta etapa"
                  [options]="issuedOptions()"
                  [value]="req.of"
                  (valueChange)="patch(i, { of: $event })"
                />
                <app-toggle
                  label="Debe estar firmado para avanzar"
                  [checked]="req.blocks_exit !== false"
                  (toggled)="patch(i, { blocks_exit: $event })"
                />
              } @else if (req.kind === 'file_field') {
                <app-selector
                  label="Campo de tipo archivo"
                  placeholder="Elige un campo"
                  [options]="fileFieldOptions()"
                  [value]="req.field"
                  (valueChange)="patch(i, { field: $event })"
                />
              }
          </div>
        } @empty {
          <p class="text-sm text-text-secondary">Esta etapa no exige requisitos.</p>
        }
        <div class="flex flex-wrap gap-2">
          <app-button variant="outline" size="sm" [disabled]="atLimit()" (clicked)="add('upload')">
            <app-icon name="upload" [size]="14" slot="icon" />
            Pedir un archivo
          </app-button>
          <app-button variant="outline" size="sm" [disabled]="atLimit() || fileFieldOptions().length === 0" (clicked)="add('file_field')">
            <app-icon name="paperclip" [size]="14" slot="icon" />
            Exigir un campo de archivo
          </app-button>
          <app-button
            variant="outline"
            size="sm"
            [disabled]="atLimit() || templateOptions().length === 0"
            [ariaLabel]="templateOptions().length === 0 ? 'Documento emitido: ' + noTemplatesHint : 'Documento emitido'"
            (clicked)="add('issued_document')"
          >
            <app-icon name="file-text" [size]="14" slot="icon" />
            Documento emitido
          </app-button>
          <app-button
            variant="outline"
            size="sm"
            [disabled]="atLimit() || issuedOptions().length === 0"
            [ariaLabel]="issuedOptions().length === 0 ? 'Firma: ' + signatureHint : 'Firma'"
            (clicked)="add('signature')"
          >
            <app-icon name="pen-line" [size]="14" slot="icon" />
            Firma
          </app-button>
        </div>
        @if (templateOptions().length === 0) {
          <app-alert-banner variant="info" icon="lock">
            Documento emitido: {{ noTemplatesHint }}.
          </app-alert-banner>
        }
        @if (templateOptions().length > 0 && issuedOptions().length === 0) {
          <app-alert-banner variant="info" icon="pen-line">
            Firma: {{ signatureHint }}.
          </app-alert-banner>
        }
      </div>
    } @else {
      <p class="text-sm text-text-secondary">Esta etapa no tiene requisitos.</p>
    }
  `,
})
export class StageRequirementsTabComponent {
  protected readonly store = inject(WorkflowEditorStore);
  private readonly templatesApi = inject(DocumentTemplatesApiService);
  readonly stage = input.required<WorkflowStageDef>();

  constructor() {
    this.templatesApi
      .list({ status: 'published' })
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe({
        next: (rows) => this.templates.set(rows.map((t) => ({ value: t.key, label: t.name }))),
        // Without the list the picker stays empty and the validator explains why on publish.
        error: () => this.templates.set([]),
      });
  }

  readonly signatureHint = SIGNATURE_HINT;
  readonly noTemplatesHint = NO_TEMPLATES_HINT;
  readonly isHuman = computed(() => HUMAN_STAGE_TYPES.includes(this.stage().type));
  readonly requirements = computed(() => this.stage().requirements ?? []);
  readonly atLimit = computed(
    () => this.requirements().length >= WORKFLOW_LIMITS.maxRequirementsPerStage,
  );
  /** Published templates of the store (P4.1): the only ones a requirement can use. */
  private readonly templates = signal<Array<{ value: string; label: string }>>([]);
  readonly templateOptions = this.templates.asReadonly();
  readonly fileFieldOptions = computed(() =>
    (this.store.draft()?.fields ?? [])
      .filter((f) => f.type === 'file')
      .map((f) => ({ value: f.key, label: f.label })),
  );

  kindText(kind: string): string {
    return KIND_TEXT[kind] ?? kind;
  }

  /** P4.2: issued-document requirements of this stage (what a signature can point to). */
  readonly issuedOptions = computed(() =>
    this.requirements()
      .filter((r) => r.kind === 'issued_document')
      .map((r) => ({ value: r.key, label: r.label })),
  );

  private set(next: WorkflowRequirementDef[]): void {
    this.store.updateStage(this.stage().key, (s) => {
      const { requirements: _r, ...rest } = s;
      return next.length > 0 ? { ...rest, requirements: next } : rest;
    });
  }

  add(kind: 'upload' | 'file_field' | 'issued_document' | 'signature'): void {
    const taken = (this.store.draft()?.stages ?? []).flatMap((s) => (s.requirements ?? []).map((r) => r.key));
    const label =
      kind === 'upload'
        ? 'Soporte'
        : kind === 'issued_document'
          ? 'Documento'
          : kind === 'signature'
            ? 'Firma'
            : 'Archivo del formulario';
    const key = uniqueKey(label, taken, 'requisito');
    const req: WorkflowRequirementDef =
      kind === 'upload'
        ? { kind: 'upload', key, label, blocks_exit: true }
        : kind === 'issued_document'
          ? { kind: 'issued_document', key, label, template_key: this.templateOptions()[0]?.value ?? '' }
          : kind === 'signature'
            ? { kind: 'signature', key, label, of: this.issuedOptions()[0]?.value ?? '', blocks_exit: true }
          : { kind: 'file_field', key, label, field: this.fileFieldOptions()[0]?.value ?? '' };
    this.set([...this.requirements(), req]);
  }

  patch(index: number, change: Record<string, unknown>): void {
    const current = this.requirements()[index];
    this.set(replaceAt(this.requirements(), index, { ...current, ...change } as WorkflowRequirementDef));
  }

  limits(index: number, limits: FileLimits): void {
    const current = this.requirements()[index];
    if (current.kind !== 'upload') return;
    const { accept: _a, max_size_mb: _m, ...rest } = current;
    this.set(replaceAt(this.requirements(), index, { ...rest, ...limits }));
  }

  remove(index: number): void {
    this.set(removeAt(this.requirements(), index));
  }
}
