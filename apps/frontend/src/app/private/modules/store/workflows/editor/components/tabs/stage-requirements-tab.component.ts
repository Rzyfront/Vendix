import { Component, computed, inject, input } from '@angular/core';
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
import { WorkflowEditorStore } from '../../workflow-editor.store';
import { removeAt, replaceAt, uniqueKey } from '../../workflow-editor.utils';
import { FileLimits, FileLimitsComponent } from '../file-limits.component';

const LOCKED_HINT = 'Disponible cuando existan plantillas de documento publicadas';

const KIND_TEXT: Record<string, string> = {
  upload: 'Subir un archivo',
  file_field: 'Archivo de un campo',
  issued_document: 'Documento emitido',
  signature: 'Firma',
};

/** Requisitos tab: upload and file_field requirements; document/signature kinds locked. */
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
            @if (locked(req)) {
              <p class="text-xs text-text-secondary">
                {{ req.label }} · {{ lockedHint }}. Se conserva tal como está en el flujo.
              </p>
            } @else {
              <app-input label="Nombre del requisito" [ngModel]="req.label" (ngModelChange)="patch(i, { label: $event })" />
              @if (req.kind === 'upload') {
                <app-file-limits [accept]="req.accept" [maxSize]="req.max_size_mb" (changed)="limits(i, $event)" />
                <app-toggle
                  label="Debe cumplirse para avanzar"
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
          <app-button variant="outline" size="sm" [disabled]="true" ariaLabel="Documento emitido: disponible cuando existan plantillas de documento publicadas">
            <app-icon name="lock" [size]="14" slot="icon" />
            Documento emitido
          </app-button>
          <app-button variant="outline" size="sm" [disabled]="true" ariaLabel="Firma: disponible cuando existan plantillas de documento publicadas">
            <app-icon name="lock" [size]="14" slot="icon" />
            Firma
          </app-button>
        </div>
        <app-alert-banner variant="info" icon="lock">
          Documento emitido y Firma: {{ lockedHint }}.
        </app-alert-banner>
      </div>
    } @else {
      <p class="text-sm text-text-secondary">Esta etapa no tiene requisitos.</p>
    }
  `,
})
export class StageRequirementsTabComponent {
  protected readonly store = inject(WorkflowEditorStore);
  readonly stage = input.required<WorkflowStageDef>();

  readonly lockedHint = LOCKED_HINT;
  readonly isHuman = computed(() => HUMAN_STAGE_TYPES.includes(this.stage().type));
  readonly requirements = computed(() => this.stage().requirements ?? []);
  readonly atLimit = computed(
    () => this.requirements().length >= WORKFLOW_LIMITS.maxRequirementsPerStage,
  );
  readonly fileFieldOptions = computed(() =>
    (this.store.draft()?.fields ?? [])
      .filter((f) => f.type === 'file')
      .map((f) => ({ value: f.key, label: f.label })),
  );

  kindText(kind: string): string {
    return KIND_TEXT[kind] ?? kind;
  }

  locked(req: WorkflowRequirementDef): boolean {
    return req.kind === 'issued_document' || req.kind === 'signature';
  }

  private set(next: WorkflowRequirementDef[]): void {
    this.store.updateStage(this.stage().key, (s) => {
      const { requirements: _r, ...rest } = s;
      return next.length > 0 ? { ...rest, requirements: next } : rest;
    });
  }

  add(kind: 'upload' | 'file_field'): void {
    const taken = (this.store.draft()?.stages ?? []).flatMap((s) => (s.requirements ?? []).map((r) => r.key));
    const label = kind === 'upload' ? 'Soporte' : 'Archivo del formulario';
    const key = uniqueKey(label, taken, 'requisito');
    const req: WorkflowRequirementDef =
      kind === 'upload'
        ? { kind: 'upload', key, label, blocks_exit: true }
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
