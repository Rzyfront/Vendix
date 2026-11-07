import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  InputsearchComponent,
  ModalComponent,
  SelectorComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import {
  WorkflowTemplateActivation,
  WorkflowTemplateSummary,
} from '../../interfaces/workflow-templates.interfaces';
import { WorkflowTemplatesApiService } from '../../services/workflow-templates-api.service';
import { toWorkflowError } from '../../utils/workflow-errors.util';
import {
  ALL_CATEGORIES,
  filterTemplates,
  stageTypeLabel,
  stepsText,
  templateCategories,
} from './templates-gallery.util';

/** Gallery of ready-made Administration templates: preview the steps and activate in one click. */
@Component({
  selector: 'app-templates-gallery-page',
  standalone: true,
  imports: [
    StickyHeaderComponent,
    CardComponent,
    InputsearchComponent,
    SelectorComponent,
    EmptyStateComponent,
    ModalComponent,
    ButtonComponent,
    IconComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Galería de plantillas"
        subtitle="Activa un flujo listo y ajústalo a tu operación"
        icon="layout-template"
        variant="glass"
        [actions]="headerActions"
        (actionClicked)="onHeaderAction($event)"
      />

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <div
          class="sticky top-[52px] z-10 bg-background px-2 py-1.5 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:items-end">
            <app-inputsearch
              class="sm:col-span-2 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              size="sm"
              placeholder="Buscar plantilla..."
              [debounceTime]="200"
              (searchChange)="search.set($event)"
            />
            <app-selector
              label="Categoría"
              [options]="categoryOptions()"
              [value]="category()"
              (valueChange)="category.set('' + $event)"
            />
          </div>
          <h2 class="mt-2 text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
            Plantillas ({{ visible().length }})
          </h2>
        </div>

        @if (loading()) {
          <div class="p-4 md:p-6 text-center">
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p class="mt-2 text-text-secondary">Cargando plantillas...</p>
          </div>
        } @else if (loadFailed()) {
          <app-empty-state
            icon="alert-triangle"
            title="No pudimos cargar las plantillas"
            description="Revisa tu conexión e inténtalo de nuevo."
            actionButtonText="Reintentar"
            (actionClick)="load()"
          />
        } @else if (visible().length === 0) {
          <app-empty-state
            icon="search"
            title="Ninguna plantilla coincide"
            description="Prueba con otro nombre o categoría."
            [showActionButton]="false"
          />
        } @else {
          <div
            class="grid grid-cols-1 gap-3 px-2 pb-3 pt-3 sm:grid-cols-2 md:p-4 xl:grid-cols-3"
            data-testid="template-grid"
          >
            @for (t of visible(); track t.key) {
              <article
                class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm"
                [attr.data-testid]="'template-' + t.key"
              >
                <div class="flex items-start gap-3">
                  <span
                    class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                  >
                    <app-icon [name]="t.icon" [size]="20" />
                  </span>
                  <div class="min-w-0">
                    <h3 class="text-sm font-semibold text-text-primary">{{ t.name }}</h3>
                    <p class="text-xs text-text-secondary">{{ t.category }} · {{ steps(t) }}</p>
                  </div>
                </div>
                <p class="flex-1 text-sm text-text-secondary">{{ t.description }}</p>
                <div class="flex gap-2">
                  <app-button variant="outline" size="sm" class="flex-1" (clicked)="preview.set(t)">
                    Ver
                  </app-button>
                  <app-button
                    variant="primary"
                    size="sm"
                    class="flex-1"
                    [loading]="activating() === t.key"
                    [disabled]="activating() !== null"
                    (clicked)="activate(t)"
                  >
                    Activar
                  </app-button>
                </div>
              </article>
            }
          </div>
        }
      </app-card>
    </div>

    <app-modal
      [isOpen]="preview() !== null"
      (isOpenChange)="closePreview($event)"
      [title]="preview()?.name ?? ''"
      [subtitle]="preview()?.category ?? ''"
      size="md"
    >
      @if (preview(); as t) {
        <p class="mb-3 text-sm text-text-secondary">{{ t.description }}</p>
        <ol class="space-y-2" data-testid="template-stages">
          @for (s of t.stages; track s.key; let i = $index) {
            <li class="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
              <span
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
              >
                {{ i + 1 }}
              </span>
              <span class="flex-1 text-text-primary">{{ s.name }}</span>
              <span class="text-xs text-text-secondary">{{ typeLabel(s.type) }}</span>
            </li>
          }
        </ol>
      }
      <div slot="footer" class="flex w-full justify-end gap-2">
        <app-button variant="outline" (clicked)="preview.set(null)">Cerrar</app-button>
        <app-button
          variant="primary"
          [loading]="activating() !== null"
          (clicked)="activateFromPreview()"
        >
          Activar
        </app-button>
      </div>
    </app-modal>

    <app-modal
      [isOpen]="activated() !== null"
      (isOpenChange)="closeActivated($event)"
      title="Plantilla activada y publicada"
      size="sm"
    >
      @if (activated(); as a) {
        <p class="text-sm text-text-secondary" data-testid="activated-summary">
          «{{ a.name }}» quedó publicada como v{{ a.version }} y lista para usar.
        </p>
      }
      <div slot="footer" class="flex w-full justify-end gap-2">
        <app-button variant="outline" (clicked)="goToFlows()">Ver mis flujos</app-button>
        <app-button variant="primary" (clicked)="openInEditor()">Abrir en el editor</app-button>
      </div>
    </app-modal>
  `,
})
export class TemplatesGalleryPageComponent implements OnInit {
  private readonly api = inject(WorkflowTemplatesApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly headerActions = [
    { id: 'back', label: 'Volver a Flujos', icon: 'arrow-left', variant: 'outline' as const },
  ];

  readonly templates = signal<WorkflowTemplateSummary[]>([]);
  readonly loading = signal(true);
  readonly loadFailed = signal(false);
  readonly search = signal('');
  readonly category = signal(ALL_CATEGORIES);
  readonly preview = signal<WorkflowTemplateSummary | null>(null);
  readonly activating = signal<string | null>(null);
  readonly activated = signal<WorkflowTemplateActivation | null>(null);

  readonly categoryOptions = computed(() => [
    { value: ALL_CATEGORIES, label: 'Todas las categorías' },
    ...templateCategories(this.templates()).map((c) => ({ value: c, label: c })),
  ]);

  readonly visible = computed(() =>
    filterTemplates(this.templates(), this.search(), this.category()),
  );

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.api
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.templates.set(rows);
          this.loading.set(false);
        },
        error: (error) => {
          this.loading.set(false);
          this.loadFailed.set(true);
          this.toast.error(toWorkflowError(error).message);
        },
      });
  }

  steps(t: WorkflowTemplateSummary): string {
    return stepsText(t.stage_count);
  }

  typeLabel(type: string): string {
    return stageTypeLabel(type);
  }

  activate(t: WorkflowTemplateSummary): void {
    if (this.activating() !== null) return;
    this.activating.set(t.key);
    this.api
      .activate(t.key)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.activating.set(null);
          this.preview.set(null);
          this.activated.set(result);
          this.toast.success('Plantilla activada y publicada');
        },
        error: (error) => {
          this.activating.set(null);
          this.toast.error(toWorkflowError(error).message);
        },
      });
  }

  activateFromPreview(): void {
    const t = this.preview();
    if (t) this.activate(t);
  }

  closePreview(open: boolean): void {
    if (!open) this.preview.set(null);
  }

  closeActivated(open: boolean): void {
    if (!open) this.activated.set(null);
  }

  openInEditor(): void {
    const a = this.activated();
    if (a) void this.router.navigate(['/admin/workflows', a.id, 'edit']);
  }

  goToFlows(): void {
    void this.router.navigate(['/admin/workflows']);
  }

  onHeaderAction(id: string): void {
    if (id === 'back') this.goToFlows();
  }
}
