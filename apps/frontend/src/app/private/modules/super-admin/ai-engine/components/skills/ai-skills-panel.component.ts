import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AI_SKILL_STATUS_LABELS,
  AISkill,
  AISkillSearchResult,
  AISkillStatus,
} from '../../interfaces';
import { AISkillsService } from '../../services/ai-skills.service';
import { AISkillEditorComponent } from './ai-skill-editor.component';
import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  SelectorComponent,
  SelectorOption,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components/index';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';

@Component({
  selector: 'app-ai-skills-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    SelectorComponent,
    AISkillEditorComponent,
  ],
  template: `
    @if (editing()) {
      <app-ai-skill-editor
        [skill]="editingSkill()"
        (saved)="onSaved($event)"
        (closed)="closeEditor()"
      ></app-ai-skill-editor>
    } @else {
      <div class="flex flex-col gap-4">
        <app-card [padding]="false" overflow="visible">
          <div
            class="p-2 md:px-6 md:py-4 border-b border-border flex flex-col lg:flex-row gap-4 lg:items-end justify-between"
          >
            <div class="min-w-0">
              <h3 class="text-lg font-semibold text-text-primary">Skills de Vex</h3>
              <p class="hidden sm:block text-xs text-text-secondary mt-0.5">
                Guías por módulo que Vex consulta; editarlas no exige deploy.
              </p>
            </div>
            <div class="flex flex-col sm:flex-row sm:items-end gap-3 w-full lg:w-auto">
              <div class="w-full sm:w-48">
                <app-selector
                  label="Módulo"
                  placeholder="Todos"
                  [options]="moduleOptions()"
                  [value]="moduleFilter()"
                  (valueChange)="onModuleChange($event)"
                ></app-selector>
              </div>
              <div class="w-full sm:w-48">
                <app-selector
                  label="Estado"
                  placeholder="Todos"
                  [options]="statusOptions"
                  [value]="statusFilter()"
                  (valueChange)="onStatusChange($event)"
                ></app-selector>
              </div>
              <app-button variant="primary" (clicked)="openCreate()">
                <app-icon slot="icon" name="plus" [size]="16"></app-icon>
                Nueva skill
              </app-button>
            </div>
          </div>
          <div class="relative min-h-[240px] p-2 md:p-4">
            <app-responsive-data-view
              [columns]="columns"
              [data]="skills()"
              [actions]="actions"
              [cardConfig]="cardConfig"
              [loading]="isLoading()"
              (rowClick)="openEdit($event)"
            >
              @if (!isLoading() && skills().length === 0) {
                <div class="p-8 flex justify-center w-full">
                  <app-empty-state
                    icon="book-open"
                    title="No hay skills"
                    description="Crea la primera guía para Vex o cambia los filtros"
                    actionButtonText="Nueva skill"
                    [showActionButton]="true"
                    (actionClick)="openCreate()"
                  ></app-empty-state>
                </div>
              }
            </app-responsive-data-view>
          </div>
        </app-card>

        <app-card [padding]="false" overflow="visible">
          <section class="p-3 md:p-6 space-y-3" aria-labelledby="skill-search-title">
            <div>
              <h4 id="skill-search-title" class="text-base font-semibold text-text-primary">
                Probar búsqueda
              </h4>
              <p class="text-xs text-text-secondary">
                Escribe una pregunta y mira qué skills publicadas le devolvería a Vex.
              </p>
            </div>
            <form class="flex flex-col sm:flex-row gap-2" (ngSubmit)="runSearch()">
              <label for="skill-search-query" class="sr-only">Pregunta de prueba</label>
              <input
                id="skill-search-query"
                name="query"
                type="text"
                class="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary
                       placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                placeholder="¿Cómo creo un producto con variantes?"
                [ngModel]="query()"
                (ngModelChange)="query.set($event)"
              />
              <app-button
                variant="outline"
                type="submit"
                [loading]="isSearching()"
                [disabled]="!query().trim()"
              >
                Probar
              </app-button>
            </form>
            @if (searched()) {
              @if (results().length === 0) {
                <p class="text-sm text-text-secondary" role="status">Ninguna skill coincide con esa pregunta.</p>
              } @else {
                <ul class="divide-y divide-border rounded-lg border border-border" role="status">
                  @for (r of results(); track r.key) {
                    <li class="flex items-center justify-between gap-3 p-3">
                      <span class="min-w-0">
                        <span class="block text-sm font-medium text-text-primary">{{ r.title }}</span>
                        <span class="block text-xs text-text-secondary">{{ r.key }} · {{ r.module || 'Sin módulo' }}</span>
                      </span>
                      <span class="text-sm font-semibold text-text-primary tabular-nums">
                        {{ r.score.toFixed(3) }}
                      </span>
                    </li>
                  }
                </ul>
              }
            }
          </section>
        </app-card>
      </div>
    }
  `,
})
export class AISkillsPanelComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private skillsService = inject(AISkillsService);
  private toastService = inject(ToastService);
  private datePipe = new DatePipe('es-CO');

  readonly skills = signal<AISkill[]>([]);
  readonly isLoading = signal(false);
  readonly moduleFilter = signal<string>('');
  readonly statusFilter = signal<string>('');
  /** Union of modules seen so far, so the filter keeps its options when narrowed. */
  private readonly knownModules = signal<string[]>([]);
  readonly moduleOptions = computed<SelectorOption[]>(() => [
    { value: '', label: 'Todos' },
    ...this.knownModules().map((m) => ({ value: m, label: m })),
  ]);

  readonly editing = signal(false);
  readonly editingSkill = signal<AISkill | null>(null);

  readonly query = signal('');
  readonly results = signal<AISkillSearchResult[]>([]);
  readonly isSearching = signal(false);
  readonly searched = signal(false);

  readonly statusOptions: SelectorOption[] = [
    { value: '', label: 'Todos' },
    ...(Object.keys(AI_SKILL_STATUS_LABELS) as AISkillStatus[]).map((s) => ({
      value: s,
      label: AI_SKILL_STATUS_LABELS[s],
    })),
  ];

  private formatDate = (value: string | null | undefined): string =>
    value ? (this.datePipe.transform(value, 'dd/MM/yyyy HH:mm') ?? '—') : '—';
  private formatStatus = (value: AISkillStatus): string =>
    AI_SKILL_STATUS_LABELS[value] ?? value;

  readonly columns: TableColumn[] = [
    { key: 'title', label: 'Título', sortable: true, priority: 1 },
    { key: 'key', label: 'Clave', priority: 2 },
    {
      key: 'module',
      label: 'Módulo',
      priority: 2,
      transform: (v: string | null) => v || '—',
    },
    {
      key: 'status',
      label: 'Estado',
      priority: 1,
      badge: true,
      badgeConfig: { type: 'status', size: 'sm' },
      transform: (v: AISkillStatus) => this.formatStatus(v),
    },
    {
      key: 'version',
      label: 'Versión',
      priority: 3,
      transform: (v: number) => `v${v}`,
    },
    {
      key: 'updated_at',
      label: 'Actualizada',
      priority: 3,
      transform: (v: string | null) => this.formatDate(v),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'title',
    subtitleKey: 'key',
    badgeKey: 'status',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (v: AISkillStatus) => this.formatStatus(v),
    detailKeys: [
      { key: 'module', label: 'Módulo', transform: (v: string | null) => v || '—' },
      { key: 'version', label: 'Versión', transform: (v: number) => `v${v}` },
      {
        key: 'updated_at',
        label: 'Actualizada',
        transform: (v: string | null) => this.formatDate(v),
      },
    ],
  };

  readonly actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (skill: AISkill) => this.openEdit(skill),
      variant: 'info',
    },
  ];

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.isLoading.set(true);
    this.skillsService
      .list({
        module: this.moduleFilter() || undefined,
        status: (this.statusFilter() as AISkillStatus | '') || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.skills.set(list);
          const seen = new Set(this.knownModules());
          list.forEach((s) => s.module && seen.add(s.module));
          this.knownModules.set([...seen].sort());
          this.isLoading.set(false);
        },
        error: (error) => {
          this.skills.set([]);
          this.isLoading.set(false);
          this.toastService.error(extractApiErrorMessage(error));
        },
      });
  }

  onModuleChange(value: string | number | null): void {
    this.moduleFilter.set(value ? String(value) : '');
    this.load();
  }

  onStatusChange(value: string | number | null): void {
    this.statusFilter.set(value ? String(value) : '');
    this.load();
  }

  openCreate(): void {
    this.editingSkill.set(null);
    this.editing.set(true);
  }

  /** Loads the full skill (body + versions summary) before editing. */
  openEdit(row: AISkill): void {
    this.skillsService
      .get(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (skill) => {
          this.editingSkill.set(skill);
          this.editing.set(true);
        },
        error: (error) => this.toastService.error(extractApiErrorMessage(error)),
      });
  }

  onSaved(skill: AISkill): void {
    // Re-fetch so the editor reflects the server state (version, status, history).
    this.skillsService
      .get(skill.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (fresh) => {
          this.editingSkill.set(fresh);
          this.editing.set(true);
          this.load();
        },
        error: () => {
          this.editingSkill.set(skill);
          this.load();
        },
      });
  }

  closeEditor(): void {
    this.editing.set(false);
    this.editingSkill.set(null);
    this.load();
  }

  runSearch(): void {
    const q = this.query().trim();
    if (!q || this.isSearching()) return;
    this.isSearching.set(true);
    this.skillsService
      .searchTest(q)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.results.set(list);
          this.searched.set(true);
          this.isSearching.set(false);
        },
        error: (error) => {
          this.isSearching.set(false);
          this.toastService.error(extractApiErrorMessage(error));
        },
      });
  }
}
