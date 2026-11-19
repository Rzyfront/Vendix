import { Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import {
  ButtonComponent,
  ConfirmationModalComponent,
  IconComponent,
  ModalComponent,
  SpinnerComponent,
  ToastService,
} from '../../../../../../shared/components';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { CrmService } from '../shared/crm.service';
import {
  CrmStageKind,
  CrmStageTemplate,
  CrmStageTemplateStage,
} from '../shared/crm.interface';

type Mode = 'list' | 'edit' | 'new-pipeline';

interface DraftStage {
  key: number;
  name: string;
  kind: CrmStageKind;
  color: string | null;
  probability: number | null;
}

const MAX_STAGES = 20;

/** The confirmation modal renders its message as HTML: escape user text. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
const KIND_LABELS: Record<CrmStageKind, string> = {
  open: 'Abierta',
  won: 'Ganada',
  lost: 'Perdida',
};
const KIND_COLORS: Record<CrmStageKind, string> = {
  open: '#3b82f6',
  won: '#16a34a',
  lost: '#dc2626',
};

/**
 * Stage templates of the CRM pipeline: create/edit/delete templates, apply one
 * to the current pipeline and create a new pipeline from a template.
 */
@Component({
  selector: 'app-crm-stage-templates-modal',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    ConfirmationModalComponent,
    IconComponent,
    ModalComponent,
    SpinnerComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      [title]="title()"
      subtitle="Define las etapas de tus embudos de venta y reutilízalas en tus pipelines."
      size="lg"
      [fullScreenOnMobile]="true"
    >
      @if (mode() === 'list') {
        @if (loading()) {
          <div class="flex justify-center py-10"><app-spinner></app-spinner></div>
        } @else if (loadError(); as message) {
          <p class="py-6 text-center text-sm text-[var(--color-error)]">{{ message }}</p>
        } @else {
          <ul class="flex flex-col gap-3" role="list">
            @for (template of templates(); track template.id) {
              <li class="rounded-xl border border-[var(--color-border)] bg-surface p-3">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="text-sm font-semibold text-[var(--color-text-primary)]">{{ template.name }}</p>
                    <div class="mt-2 flex flex-wrap gap-1.5">
                      @for (stage of template.stages; track $index) {
                        <span class="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs">
                          <span class="h-2 w-2 rounded-full" [style.background]="stageColor(stage)"></span>
                          {{ stage.name }}
                        </span>
                      }
                    </div>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    @if (pipelineId()) {
                      <app-button variant="outline" size="sm" (clicked)="askApply(template)">
                        <app-icon slot="icon" name="check" [size]="14"></app-icon> Aplicar a «{{ pipelineName() }}»
                      </app-button>
                    }
                    <app-button variant="outline" size="sm" (clicked)="startNewPipeline(template)">
                      <app-icon slot="icon" name="plus" [size]="14"></app-icon> Nuevo pipeline
                    </app-button>
                    <button
                      type="button"
                      class="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--color-background)]"
                      aria-label="Editar plantilla"
                      title="Editar plantilla"
                      (click)="startEdit(template)"
                    >
                      <app-icon name="pencil" [size]="15"></app-icon>
                    </button>
                    <button
                      type="button"
                      class="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-error)] hover:bg-[var(--color-background)]"
                      aria-label="Eliminar plantilla"
                      title="Eliminar plantilla"
                      (click)="toDelete.set(template)"
                    >
                      <app-icon name="trash-2" [size]="15"></app-icon>
                    </button>
                  </div>
                </div>
              </li>
            } @empty {
              <li class="py-6 text-center text-sm text-[var(--color-text-muted)]">Aún no hay plantillas de etapas.</li>
            }
          </ul>
        }
      } @else if (mode() === 'edit') {
        <div class="flex flex-col gap-4">
          <label class="flex flex-col gap-1 text-sm font-medium">
            Nombre de la plantilla
            <input
              class="h-10 rounded-lg border border-[var(--color-border)] bg-surface px-3 text-sm font-normal"
              placeholder="Ej.: Venta de proyectos"
              maxlength="80"
              [ngModel]="draftName()"
              (ngModelChange)="draftName.set($event)"
            />
          </label>

          <div class="flex flex-col gap-2">
            <p class="text-sm font-medium">Etapas (en orden)</p>
            @for (stage of draftStages(); track stage.key; let i = $index; let first = $first; let last = $last) {
              <div class="grid grid-cols-1 gap-2 rounded-xl border border-[var(--color-border)] p-2 sm:grid-cols-[2.5rem_1fr_7rem_5rem_auto] sm:items-center">
                <input
                  type="color"
                  class="h-9 w-10 cursor-pointer rounded-md border border-[var(--color-border)] bg-surface p-0.5"
                  aria-label="Color de la etapa"
                  [ngModel]="stage.color ?? kindColor(stage.kind)"
                  (ngModelChange)="patchStage(stage.key, { color: $event })"
                />
                <input
                  class="h-9 min-w-0 rounded-lg border border-[var(--color-border)] bg-surface px-3 text-sm"
                  placeholder="Nombre de la etapa"
                  maxlength="80"
                  aria-label="Nombre de la etapa"
                  [ngModel]="stage.name"
                  (ngModelChange)="patchStage(stage.key, { name: $event })"
                />
                <select
                  class="h-9 rounded-lg border border-[var(--color-border)] bg-surface px-2 text-sm"
                  aria-label="Tipo de etapa"
                  [ngModel]="stage.kind"
                  (ngModelChange)="patchStage(stage.key, { kind: $event })"
                >
                  @for (kind of kinds; track kind) {
                    <option [value]="kind">{{ kindLabel(kind) }}</option>
                  }
                </select>
                <input
                  type="number"
                  min="0"
                  max="100"
                  class="h-9 rounded-lg border border-[var(--color-border)] bg-surface px-2 text-sm"
                  placeholder="% prob."
                  aria-label="Probabilidad (0 a 100)"
                  [ngModel]="stage.probability"
                  (ngModelChange)="patchStage(stage.key, { probability: toProbability($event) })"
                />
                <div class="flex items-center justify-end gap-1">
                  <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--color-background)] disabled:opacity-40" aria-label="Subir etapa" title="Subir" [disabled]="first" (click)="moveStage(i, -1)">
                    <app-icon name="arrow-up" [size]="14"></app-icon>
                  </button>
                  <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--color-background)] disabled:opacity-40" aria-label="Bajar etapa" title="Bajar" [disabled]="last" (click)="moveStage(i, 1)">
                    <app-icon name="arrow-down" [size]="14"></app-icon>
                  </button>
                  <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-error)] hover:bg-[var(--color-background)] disabled:opacity-40" aria-label="Quitar etapa" title="Quitar" [disabled]="draftStages().length <= 1" (click)="removeStage(stage.key)">
                    <app-icon name="x" [size]="14"></app-icon>
                  </button>
                </div>
              </div>
            }
            <div>
              <app-button variant="outline" size="sm" [disabled]="draftStages().length >= maxStages" (clicked)="addStage()">
                <app-icon slot="icon" name="plus" [size]="14"></app-icon> Agregar etapa
              </app-button>
            </div>
          </div>

          @if (validationError(); as message) {
            <p class="text-sm text-[var(--color-error)]" role="alert">{{ message }}</p>
          }
          @if (saveError(); as message) {
            <p class="text-sm text-[var(--color-error)]" role="alert">{{ message }}</p>
          }
        </div>
      } @else {
        <div class="flex flex-col gap-4">
          <p class="text-sm text-[var(--color-text-secondary)]">
            Se creará un pipeline con las etapas de la plantilla «{{ pipelineTemplate()?.name }}».
          </p>
          <label class="flex flex-col gap-1 text-sm font-medium">
            Nombre del pipeline
            <input
              class="h-10 rounded-lg border border-[var(--color-border)] bg-surface px-3 text-sm font-normal"
              placeholder="Ej.: Proyectos corporativos"
              maxlength="80"
              [ngModel]="newPipelineName()"
              (ngModelChange)="newPipelineName.set($event)"
              (keydown.enter)="createPipeline()"
            />
          </label>
          <label class="flex flex-col gap-1 text-sm font-medium">
            Plantilla de etapas
            <select
              class="h-10 rounded-lg border border-[var(--color-border)] bg-surface px-3 text-sm font-normal"
              [ngModel]="newPipelineTemplateId()"
              (ngModelChange)="newPipelineTemplateId.set(+$event)"
            >
              @for (template of templates(); track template.id) {
                <option [value]="template.id">{{ template.name }}</option>
              }
            </select>
          </label>
          @if (saveError(); as message) {
            <p class="text-sm text-[var(--color-error)]" role="alert">{{ message }}</p>
          }
        </div>
      }

      <div slot="footer" class="flex flex-wrap justify-end gap-3">
        @if (mode() === 'list') {
          <app-button variant="outline" size="md" (clicked)="isOpen.set(false)">Cerrar</app-button>
          <app-button variant="outline" size="md" [disabled]="!templates().length" (clicked)="startNewPipeline(null)">
            <app-icon slot="icon" name="columns" [size]="16"></app-icon> Nuevo pipeline
          </app-button>
          <app-button variant="primary" size="md" (clicked)="startEdit(null)">
            <app-icon slot="icon" name="plus" [size]="16"></app-icon> Nueva plantilla
          </app-button>
        } @else if (mode() === 'edit') {
          <app-button variant="outline" size="md" (clicked)="backToList()">Volver</app-button>
          <app-button variant="primary" size="md" [loading]="saving()" [disabled]="!!validationError()" (clicked)="saveTemplate()">
            Guardar plantilla
          </app-button>
        } @else {
          <app-button variant="outline" size="md" (clicked)="backToList()">Volver</app-button>
          <app-button variant="primary" size="md" [loading]="saving()" [disabled]="!newPipelineName().trim() || !newPipelineTemplateId()" (clicked)="createPipeline()">
            Crear pipeline
          </app-button>
        }
      </div>
    </app-modal>

    <app-confirmation-modal
      [isOpen]="!!toDelete()"
      (isOpenChange)="!$event && toDelete.set(null)"
      title="Eliminar plantilla"
      [message]="deleteMessage()"
      confirmText="Eliminar"
      cancelText="Cancelar"
      confirmVariant="danger"
      (confirm)="confirmDelete()"
      (cancel)="toDelete.set(null)"
    ></app-confirmation-modal>

    <app-confirmation-modal
      [isOpen]="!!toApply()"
      (isOpenChange)="!$event && toApply.set(null)"
      title="Aplicar plantilla de etapas"
      [message]="applyMessage()"
      confirmText="Aplicar plantilla"
      cancelText="Cancelar"
      confirmVariant="primary"
      size="md"
      (confirm)="confirmApply()"
      (cancel)="toApply.set(null)"
    ></app-confirmation-modal>
  `,
})
export class StageTemplatesModalComponent {
  private readonly crm = inject(CrmService);
  private readonly toast = inject(ToastService);

  readonly isOpen = model(false);
  /** Pipeline currently shown on the board (target of "Aplicar"). */
  readonly pipelineId = input<number | null>(null);
  readonly pipelineName = input('');
  /** The board must reload after a template was applied. */
  readonly applied = output<void>();
  /** A new pipeline was created: the board selects it. */
  readonly pipelineCreated = output<number>();

  protected readonly kinds: CrmStageKind[] = ['open', 'won', 'lost'];
  protected readonly maxStages = MAX_STAGES;
  protected readonly templates = signal<CrmStageTemplate[]>([]);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly mode = signal<Mode>('list');
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected readonly editingId = signal<number | null>(null);
  protected readonly draftName = signal('');
  protected readonly draftStages = signal<DraftStage[]>([]);
  private nextKey = 1;

  protected readonly newPipelineName = signal('');
  protected readonly newPipelineTemplateId = signal<number | null>(null);
  protected readonly toDelete = signal<CrmStageTemplate | null>(null);
  protected readonly toApply = signal<CrmStageTemplate | null>(null);

  protected readonly pipelineTemplate = computed(
    () => this.templates().find((t) => t.id === this.newPipelineTemplateId()) ?? null,
  );
  protected readonly title = computed(() => {
    if (this.mode() === 'edit') return this.editingId() ? 'Editar plantilla' : 'Nueva plantilla';
    if (this.mode() === 'new-pipeline') return 'Nuevo pipeline';
    return 'Plantillas de etapas';
  });
  protected readonly deleteMessage = computed(
    () =>
      `¿Eliminar la plantilla «${escapeHtml(this.toDelete()?.name ?? '')}»? Los pipelines que ya la usan conservan sus etapas.`,
  );
  protected readonly applyMessage = computed(
    () =>
      `Se aplicará «${escapeHtml(this.toApply()?.name ?? '')}» a «${escapeHtml(this.pipelineName())}». Las etapas con el mismo nombre se actualizan, las nuevas se crean y las que sobran se desactivan. ` +
      'Si una etapa que sobra tiene oportunidades abiertas, o una etapa cambia de tipo teniendo oportunidades, no se aplica y verás el motivo.',
  );
  protected readonly validationError = computed(() => this.validate());

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        untracked(() => {
          this.mode.set('list');
          this.saveError.set(null);
          void this.load();
        });
      }
    });
  }

  kindLabel(kind: CrmStageKind): string {
    return KIND_LABELS[kind];
  }

  kindColor(kind: CrmStageKind): string {
    return KIND_COLORS[kind];
  }

  stageColor(stage: CrmStageTemplateStage): string {
    return stage.color ?? KIND_COLORS[stage.kind];
  }

  toProbability(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.templates.set(await firstValueFrom(this.crm.listStageTemplates()));
    } catch (error) {
      this.loadError.set(parseApiError(error).userMessage);
    } finally {
      this.loading.set(false);
    }
  }

  backToList(): void {
    this.mode.set('list');
    this.saveError.set(null);
  }

  startEdit(template: CrmStageTemplate | null): void {
    this.saveError.set(null);
    this.editingId.set(template?.id ?? null);
    this.draftName.set(template?.name ?? '');
    this.draftStages.set(
      template
        ? template.stages.map((s) => this.toDraft(s))
        : [
            this.toDraft({ name: 'Nuevo', kind: 'open', color: null, probability: null }),
            this.toDraft({ name: 'Ganado', kind: 'won', color: null, probability: 100 }),
            this.toDraft({ name: 'Perdido', kind: 'lost', color: null, probability: 0 }),
          ],
    );
    this.mode.set('edit');
  }

  addStage(): void {
    if (this.draftStages().length >= MAX_STAGES) return;
    this.draftStages.update((rows) => [
      ...rows,
      this.toDraft({ name: '', kind: 'open', color: null, probability: null }),
    ]);
  }

  removeStage(key: number): void {
    this.draftStages.update((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : rows));
  }

  moveStage(index: number, delta: -1 | 1): void {
    this.draftStages.update((rows) => {
      const target = index + delta;
      if (target < 0 || target >= rows.length) return rows;
      const next = [...rows];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  patchStage(key: number, patch: Partial<Omit<DraftStage, 'key'>>): void {
    this.draftStages.update((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async saveTemplate(): Promise<void> {
    if (this.saving() || this.validationError()) return;
    const body = {
      name: this.draftName().trim(),
      stages: this.draftStages().map<CrmStageTemplateStage>((s) => ({
        name: s.name.trim(),
        kind: s.kind,
        color: s.color,
        probability: s.probability,
      })),
    };
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const id = this.editingId();
      if (id) await firstValueFrom(this.crm.updateStageTemplate(id, body));
      else await firstValueFrom(this.crm.createStageTemplate(body));
      this.toast.success('Plantilla guardada');
      this.mode.set('list');
      await this.load();
    } catch (error) {
      this.saveError.set(parseApiError(error).userMessage);
    } finally {
      this.saving.set(false);
    }
  }

  async confirmDelete(): Promise<void> {
    const template = this.toDelete();
    this.toDelete.set(null);
    if (!template) return;
    try {
      await firstValueFrom(this.crm.deleteStageTemplate(template.id));
      this.toast.success('Plantilla eliminada');
      await this.load();
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    }
  }

  askApply(template: CrmStageTemplate): void {
    this.toApply.set(template);
  }

  async confirmApply(): Promise<void> {
    const template = this.toApply();
    const pipelineId = this.pipelineId();
    this.toApply.set(null);
    if (!template || !pipelineId) return;
    try {
      await firstValueFrom(this.crm.applyStageTemplate(pipelineId, template.id));
      this.toast.success('Plantilla aplicada al pipeline');
      this.applied.emit();
      this.isOpen.set(false);
    } catch (error) {
      // 409 carries the reason (open opportunities / type change).
      this.toast.error(parseApiError(error).userMessage);
    }
  }

  startNewPipeline(template: CrmStageTemplate | null): void {
    this.saveError.set(null);
    this.newPipelineName.set('');
    this.newPipelineTemplateId.set(template?.id ?? this.templates()[0]?.id ?? null);
    this.mode.set('new-pipeline');
  }

  async createPipeline(): Promise<void> {
    const name = this.newPipelineName().trim();
    const templateId = this.newPipelineTemplateId();
    if (!name || !templateId || this.saving()) return;
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const pipeline = await firstValueFrom(this.crm.createPipeline({ name, template_id: templateId }));
      this.toast.success('Pipeline creado');
      this.pipelineCreated.emit(pipeline.id);
      this.isOpen.set(false);
    } catch (error) {
      this.saveError.set(parseApiError(error).userMessage);
    } finally {
      this.saving.set(false);
    }
  }

  private toDraft(stage: CrmStageTemplateStage): DraftStage {
    return { key: this.nextKey++, ...stage };
  }

  /** Mirrors the backend rules: 1-20 stages, unique names, one open, one won and one lost. */
  private validate(): string | null {
    if (this.mode() !== 'edit') return null;
    if (!this.draftName().trim()) return 'Escribe el nombre de la plantilla.';
    const rows = this.draftStages();
    if (rows.length < 1 || rows.length > MAX_STAGES) return `La plantilla debe tener entre 1 y ${MAX_STAGES} etapas.`;
    const seen = new Set<string>();
    for (const row of rows) {
      const name = row.name.trim();
      if (!name) return 'Todas las etapas necesitan un nombre.';
      const key = name.toLowerCase();
      if (seen.has(key)) return `El nombre de etapa «${name}» está repetido (no se distingue entre mayúsculas y minúsculas).`;
      seen.add(key);
      if (row.probability !== null && (row.probability < 0 || row.probability > 100)) {
        return `La probabilidad de «${name}» debe estar entre 0 y 100.`;
      }
    }
    if (!rows.some((r) => r.kind === 'open')) return 'Incluye al menos una etapa de tipo Abierta.';
    // Win and lose need an active closing stage in the pipeline.
    if (!rows.some((r) => r.kind === 'won')) return 'Incluye al menos una etapa de tipo Ganada.';
    if (!rows.some((r) => r.kind === 'lost')) return 'Incluye al menos una etapa de tipo Perdida.';
    return null;
  }
}
