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
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import {
  AI_SKILL_STATUS_LABELS,
  AISkill,
  AISkillVersion,
  AISkillWriteDto,
} from '../../interfaces';
import { AISkillsService } from '../../services/ai-skills.service';
import {
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  DialogService,
  IconComponent,
  InputComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { markdownToHtml } from '../../../../../../shared/utils/markdown.util';

const SKILL_KEY_PATTERN = /^[a-z][a-z0-9_-]*$/;

interface DiffRow {
  text: string;
  changed: boolean;
}

/** Marks lines of `source` that do not exist in `other` (multiset-free, line level). */
function markLines(source: string, other: string): DiffRow[] {
  const otherLines = new Set(other.split('\n'));
  return source.split('\n').map((text) => ({
    text,
    changed: text.trim() !== '' && !otherLines.has(text),
  }));
}

@Component({
  selector: 'app-ai-skill-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    DatePipe,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    InputComponent,
  ],
  styles: [
    `
      :host ::ng-deep .skill-preview h2 {
        font-size: 1.125rem;
        font-weight: 600;
        margin: 0.75rem 0 0.25rem;
      }
      :host ::ng-deep .skill-preview h3 {
        font-size: 1rem;
        font-weight: 600;
        margin: 0.5rem 0 0.25rem;
      }
      :host ::ng-deep .skill-preview ul {
        list-style: disc;
        padding-left: 1.25rem;
      }
      :host ::ng-deep .skill-preview p {
        margin: 0.25rem 0;
      }
    `,
  ],
  template: `
    <app-card [padding]="false" overflow="visible">
      <div
        class="p-3 md:px-6 md:py-4 border-b border-border flex flex-col sm:flex-row gap-3 sm:items-center justify-between"
      >
        <div class="min-w-0">
          <button
            type="button"
            class="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
            (click)="closed.emit()"
          >
            <app-icon name="chevron-left" [size]="16"></app-icon>
            Volver a Skills
          </button>
          <h3 class="text-lg font-semibold text-text-primary mt-1">
            {{ isNew() ? 'Nueva skill' : skill()!.title }}
          </h3>
          @if (!isNew()) {
            <div class="flex flex-wrap items-center gap-2 mt-1 text-xs text-text-secondary">
              <app-badge [variant]="statusVariant()" size="sm">{{ statusLabel() }}</app-badge>
              <span>Versión {{ skill()!.version }}</span>
              @if (skill()!.published_version) {
                <span>· Publicada: v{{ skill()!.published_version }}</span>
              }
            </div>
          }
        </div>
        <div class="flex flex-wrap gap-2">
          <app-button variant="outline" [loading]="isSaving()" [disabled]="busy()" (clicked)="save()">
            Guardar borrador
          </app-button>
          @if (!isNew()) {
            <app-button variant="primary" [disabled]="busy() || !canPublish()" (clicked)="publish()">
              Publicar
            </app-button>
            <app-button variant="outline" [disabled]="busy() || skill()!.status === 'archived'" (clicked)="archive()">
              Archivar
            </app-button>
          }
        </div>
      </div>

      <form [formGroup]="form" class="p-3 md:p-6 space-y-4" (ngSubmit)="save()">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <app-input
            formControlName="title"
            label="Título"
            [required]="true"
            [control]="form.controls.title"
            [maxlength]="200"
          ></app-input>
          <app-input
            formControlName="key"
            label="Clave"
            placeholder="crear-producto"
            [required]="true"
            [control]="form.controls.key"
            [readonly]="!isNew()"
            [helperText]="isNew() ? 'Minúsculas, números, guion y guion bajo. No se puede cambiar después.' : 'La clave no se puede cambiar.'"
          ></app-input>
          <app-input
            formControlName="module"
            label="Módulo"
            placeholder="inventario"
            [control]="form.controls.module"
            [maxlength]="50"
          ></app-input>
          <app-input
            formControlName="agent_keys"
            label="Agentes"
            placeholder="vex"
            [control]="form.controls.agent_keys"
            helperText="Claves de agente separadas por coma."
          ></app-input>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div class="space-y-1">
            <label for="skill-body" class="block text-sm font-medium text-text-primary">
              Cuerpo (markdown)
            </label>
            <textarea
              id="skill-body"
              [formControl]="form.controls.body"
              rows="18"
              class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono text-text-primary
                     placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/20
                     focus:border-primary resize-y"
              placeholder="## Cuándo usar esta guía&#10;- ..."
            ></textarea>
            @if (form.controls.body.touched && form.controls.body.invalid) {
              <p class="text-xs text-error" role="alert">El cuerpo es obligatorio.</p>
            }
          </div>
          <div class="space-y-1">
            <span class="block text-sm font-medium text-text-primary">Vista previa</span>
            <div
              class="skill-preview min-h-[16rem] lg:h-[27.5rem] overflow-auto rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-text-primary"
              aria-live="polite"
              [innerHTML]="previewHtml()"
            ></div>
          </div>
        </div>

        <div class="space-y-2">
          <label for="skill-tool-input" class="block text-sm font-medium text-text-primary">
            Tools candidatas
          </label>
          <div class="flex flex-wrap gap-2" role="list">
            @for (tool of tools(); track tool) {
              <span
                role="listitem"
                class="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs"
              >
                {{ tool }}
                <button
                  type="button"
                  class="hover:text-error"
                  [attr.aria-label]="'Quitar ' + tool"
                  (click)="removeTool(tool)"
                >
                  <app-icon name="x" [size]="12"></app-icon>
                </button>
              </span>
            }
          </div>
          <div class="flex gap-2">
            <input
              id="skill-tool-input"
              type="text"
              class="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary
                     placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              placeholder="nombre_de_la_tool"
              [value]="toolDraft()"
              (input)="toolDraft.set($any($event.target).value)"
              (keydown.enter)="addTool($event)"
            />
            <app-button variant="outline" (clicked)="addTool()">Agregar</app-button>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <app-input
            formControlName="help_article_id"
            label="Artículo relacionado (id)"
            type="number"
            [control]="form.controls.help_article_id"
          ></app-input>
          <app-input
            formControlName="video_id"
            label="Video relacionado (id)"
            type="number"
            [control]="form.controls.video_id"
          ></app-input>
        </div>

        <app-input
          formControlName="change_note"
          label="Nota del cambio"
          placeholder="Qué cambió y por qué"
          [control]="form.controls.change_note"
          [maxlength]="500"
        ></app-input>
      </form>

      @if (!isNew()) {
        <section class="border-t border-border p-3 md:p-6 space-y-3" aria-labelledby="skill-history-title">
          <div class="flex items-center justify-between gap-2">
            <h4 id="skill-history-title" class="text-base font-semibold text-text-primary">Historial</h4>
            <span class="text-xs text-text-secondary">Selecciona dos versiones para compararlas.</span>
          </div>
          @if (isLoadingVersions()) {
            <p class="text-sm text-text-secondary">Cargando historial…</p>
          } @else if (versions().length === 0) {
            <p class="text-sm text-text-secondary">Sin versiones registradas.</p>
          } @else {
            <ul class="divide-y divide-border rounded-lg border border-border">
              @for (v of versions(); track v.version) {
                <li class="flex flex-col sm:flex-row sm:items-center gap-2 p-3">
                  <label class="flex items-start gap-3 flex-1 min-w-0 cursor-pointer">
                    <input
                      type="checkbox"
                      class="mt-1 rounded border-border text-primary focus:ring-primary"
                      [checked]="isSelected(v.version)"
                      (change)="toggleCompare(v.version)"
                      [attr.aria-label]="'Seleccionar versión ' + v.version + ' para comparar'"
                    />
                    <span class="min-w-0">
                      <span class="block text-sm font-medium text-text-primary">
                        v{{ v.version }} · {{ v.title }}
                        @if (v.version === skill()!.published_version) {
                          <app-badge variant="success" size="xs">Publicada</app-badge>
                        }
                      </span>
                      <span class="block text-xs text-text-secondary">
                        {{ v.author?.name || 'Sin autor' }} · {{ v.created_at | date: 'dd/MM/yyyy HH:mm' }}
                      </span>
                      @if (v.change_note) {
                        <span class="block text-xs text-text-secondary break-words">{{ v.change_note }}</span>
                      }
                    </span>
                  </label>
                  <app-button
                    variant="outline"
                    size="sm"
                    [disabled]="busy() || v.version === skill()!.version"
                    (clicked)="restore(v)"
                  >
                    Restaurar esta versión
                  </app-button>
                </li>
              }
            </ul>
          }

          @if (compareRows(); as cmp) {
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3" aria-label="Comparación de versiones">
              @for (side of cmp; track side.version) {
                <div class="rounded-lg border border-border overflow-hidden">
                  <div class="bg-muted/40 px-3 py-1.5 text-xs font-semibold text-text-primary">
                    v{{ side.version }}
                  </div>
                  <div class="max-h-80 overflow-auto font-mono text-xs">
                    @for (row of side.rows; track $index) {
                      <div
                        class="px-3 py-0.5 whitespace-pre-wrap break-words text-text-primary"
                        [class]="row.changed ? 'bg-primary/10 font-semibold' : ''"
                      >{{ row.text || ' ' }}</div>
                    }
                  </div>
                </div>
              }
            </div>
            <p class="text-xs text-text-secondary">Las líneas resaltadas no existen en la otra versión.</p>
          }
        </section>
      }
    </app-card>
  `,
})
export class AISkillEditorComponent {
  private destroyRef = inject(DestroyRef);
  private skillsService = inject(AISkillsService);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);

  /** null = creating a new skill. */
  readonly skill = input<AISkill | null>(null);
  readonly saved = output<AISkill>();
  readonly closed = output<void>();

  readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(200)] }),
    key: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(SKILL_KEY_PATTERN), Validators.maxLength(120)] }),
    module: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(50)] }),
    agent_keys: new FormControl('vex', { nonNullable: true }),
    body: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    help_article_id: new FormControl<number | null>(null),
    video_id: new FormControl<number | null>(null),
    change_note: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
  });

  private readonly bodyValue = toSignal(this.form.controls.body.valueChanges, { initialValue: '' });
  readonly previewHtml = computed(() => markdownToHtml(this.bodyValue()));

  readonly tools = signal<string[]>([]);
  readonly toolDraft = signal('');
  readonly versions = signal<AISkillVersion[]>([]);
  readonly isLoadingVersions = signal(false);
  readonly isSaving = signal(false);
  readonly isActing = signal(false);
  readonly selectedVersions = signal<number[]>([]);

  readonly isNew = computed(() => this.skill() === null);
  readonly busy = computed(() => this.isSaving() || this.isActing());
  readonly statusLabel = computed(() => AI_SKILL_STATUS_LABELS[this.skill()?.status ?? 'draft']);
  readonly statusVariant = computed<'success' | 'neutral' | 'warning'>(() => {
    const status = this.skill()?.status;
    return status === 'published' ? 'success' : status === 'archived' ? 'neutral' : 'warning';
  });
  /** Publishing makes sense for a draft or when the latest saved version is not the live one. */
  readonly canPublish = computed(() => {
    const s = this.skill();
    return !!s && s.status !== 'archived' && s.published_version !== s.version;
  });

  readonly compareRows = computed<{ version: number; rows: DiffRow[] }[] | null>(() => {
    const picked = this.selectedVersions();
    if (picked.length !== 2) return null;
    const [a, b] = [...picked].sort((x, y) => x - y);
    const va = this.versions().find((v) => v.version === a);
    const vb = this.versions().find((v) => v.version === b);
    if (!va || !vb) return null;
    return [
      { version: a, rows: markLines(va.body, vb.body) },
      { version: b, rows: markLines(vb.body, va.body) },
    ];
  });

  constructor() {
    effect(() => {
      const s = this.skill();
      this.selectedVersions.set([]);
      if (s) {
        this.form.controls.key.disable({ emitEvent: false });
        this.patchFrom(s);
        this.loadVersions(s.id);
      } else {
        this.form.controls.key.enable({ emitEvent: false });
        this.form.reset({ agent_keys: 'vex' });
        this.tools.set([]);
        this.versions.set([]);
      }
    });
  }

  private patchFrom(s: AISkill): void {
    this.form.patchValue({
      title: s.title,
      key: s.key,
      module: s.module ?? '',
      agent_keys: (s.agent_keys ?? []).join(', '),
      body: s.body,
      help_article_id: s.help_article_id,
      video_id: s.video_id,
      change_note: '',
    });
    this.tools.set([...(s.candidate_tools ?? [])]);
  }

  private loadVersions(id: number): void {
    this.isLoadingVersions.set(true);
    this.skillsService
      .versions(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.versions.set([...list].sort((a, b) => b.version - a.version));
          this.isLoadingVersions.set(false);
        },
        error: (error) => {
          this.versions.set([]);
          this.isLoadingVersions.set(false);
          this.toastService.error(extractApiErrorMessage(error));
        },
      });
  }

  addTool(event?: Event): void {
    event?.preventDefault();
    const name = this.toolDraft().trim();
    if (!name) return;
    if (!this.tools().includes(name)) this.tools.update((t) => [...t, name]);
    this.toolDraft.set('');
  }

  removeTool(name: string): void {
    this.tools.update((t) => t.filter((x) => x !== name));
  }

  isSelected(version: number): boolean {
    return this.selectedVersions().includes(version);
  }

  toggleCompare(version: number): void {
    this.selectedVersions.update((cur) => {
      if (cur.includes(version)) return cur.filter((v) => v !== version);
      // Keep at most two: drop the oldest pick.
      return cur.length >= 2 ? [cur[1], version] : [...cur, version];
    });
  }

  private buildDto(): AISkillWriteDto | null {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.toastService.error('Revisa los campos marcados antes de guardar.');
      return null;
    }
    const v = this.form.getRawValue();
    const agents = v.agent_keys
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const toId = (n: number | string | null): number | null =>
      n === null || n === '' || Number.isNaN(Number(n)) ? null : Number(n);
    const dto: AISkillWriteDto = {
      title: v.title.trim(),
      module: v.module.trim() || null,
      body: v.body,
      candidate_tools: this.tools(),
      help_article_id: toId(v.help_article_id),
      video_id: toId(v.video_id),
      agent_keys: agents.length ? agents : ['vex'],
      change_note: v.change_note.trim() || null,
    };
    if (this.isNew()) dto.key = v.key.trim();
    return dto;
  }

  save(): void {
    if (this.busy()) return;
    const dto = this.buildDto();
    if (!dto) return;
    const current = this.skill();
    this.isSaving.set(true);
    const request$ = current
      ? this.skillsService.update(current.id, dto)
      : this.skillsService.create(dto);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        this.isSaving.set(false);
        this.toastService.success('Borrador guardado');
        this.saved.emit(saved);
      },
      error: (error) => {
        this.isSaving.set(false);
        this.toastService.error(extractApiErrorMessage(error));
      },
    });
  }

  publish(): void {
    const current = this.skill();
    if (!current || this.busy()) return;
    this.dialogService
      .confirm({
        title: 'Publicar skill',
        message: `Vex empezará a usar la versión ${current.version} de "${current.title}". ¿Publicar?`,
        confirmText: 'Publicar',
        cancelText: 'Cancelar',
      })
      .then((ok) => {
        if (ok) this.runAction(this.skillsService.publish(current.id), 'Skill publicada');
      });
  }

  archive(): void {
    const current = this.skill();
    if (!current || this.busy()) return;
    this.dialogService
      .confirm({
        title: 'Archivar skill',
        message: `Vex dejará de encontrar "${current.title}". ¿Archivar?`,
        confirmText: 'Archivar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((ok) => {
        if (ok) this.runAction(this.skillsService.archive(current.id), 'Skill archivada');
      });
  }

  restore(version: AISkillVersion): void {
    const current = this.skill();
    if (!current || this.busy()) return;
    this.dialogService
      .confirm({
        title: 'Restaurar versión',
        message: `Se creará una nueva versión con el contenido de la v${version.version}. El historial se conserva. ¿Restaurar?`,
        confirmText: 'Restaurar',
        cancelText: 'Cancelar',
      })
      .then((ok) => {
        if (ok) {
          this.runAction(
            this.skillsService.restore(current.id, version.version),
            `Versión ${version.version} restaurada`,
          );
        }
      });
  }

  private runAction(request$: Observable<AISkill>, successMessage: string): void {
    this.isActing.set(true);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (updated) => {
        this.isActing.set(false);
        this.toastService.success(successMessage);
        this.saved.emit(updated);
      },
      error: (error) => {
        this.isActing.set(false);
        this.toastService.error(extractApiErrorMessage(error));
      },
    });
  }
}
