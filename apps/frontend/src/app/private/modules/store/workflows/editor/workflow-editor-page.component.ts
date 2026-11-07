import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  DialogService,
  IconComponent,
  ScrollableTabsComponent,
  ToastService,
} from '../../../../../shared/components/index';
import { ScrollableTab } from '../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';
import { PublishIssuesModalComponent } from '../components/publish-issues-modal.component';
import { WorkflowsApiService } from '../services/workflows-api.service';
import { toWorkflowError } from '../utils/workflow-errors.util';
import { downloadTextFile } from '../utils/workflow-labels.util';
import { EditorToolbarComponent } from './components/editor-toolbar.component';
import { HistoryModalComponent } from './components/history-modal.component';
import { JsonPanelComponent } from './components/json-panel.component';
import { RouteMapComponent } from './components/route-map.component';
import { SimulatorPanelComponent } from './components/simulator-panel.component';
import { StageListComponent } from './components/stage-list.component';
import { TriggersPanelComponent } from './components/triggers-panel.component';
import { StagePropertiesComponent } from './components/stage-properties.component';
import { TransitionMatrixComponent } from './components/transition-matrix.component';
import { ValidationPanelComponent } from './components/validation-panel.component';
import { WorkflowEditorLookups } from './workflow-editor-lookups.service';
import { WorkflowEditorStore } from './workflow-editor.store';

type CenterView = 'map' | 'matrix';

/** `/admin/workflows/:id/edit`: stages · route map · stage properties. */
@Component({
  selector: 'app-workflow-editor-page',
  standalone: true,
  providers: [WorkflowEditorStore, WorkflowEditorLookups],
  imports: [
    RouterLink,
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    ScrollableTabsComponent,
    EditorToolbarComponent,
    HistoryModalComponent,
    JsonPanelComponent,
    PublishIssuesModalComponent,
    RouteMapComponent,
    SimulatorPanelComponent,
    StageListComponent,
    StagePropertiesComponent,
    TransitionMatrixComponent,
    TriggersPanelComponent,
    ValidationPanelComponent,
  ],
  template: `
    <div class="flex w-full flex-col gap-3 overflow-x-hidden p-2 md:p-4">
      <header class="flex items-center gap-3">
        <a routerLink="/admin/workflows" class="flex h-10 items-center gap-1 rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
          <app-icon name="arrow-up" [size]="14" class="-rotate-90" />
          Flujos
        </a>
        <div class="min-w-0">
          <h1 class="truncate text-lg font-bold text-text-primary">{{ store.draft()?.name ?? store.row()?.name ?? 'Editor de flujo' }}</h1>
          <p class="truncate text-xs text-text-secondary">Diseña etapas, responsables y reglas. Los cambios se guardan solos.</p>
        </div>
      </header>

      @if (store.loadError(); as message) {
        <app-alert-banner variant="danger" icon="alert-circle" [attr.data-testid]="'load-error'">{{ message }}</app-alert-banner>
      } @else if (store.loading()) {
        <p class="text-sm text-text-secondary" role="status">Cargando el flujo…</p>
      } @else if (store.draft()) {
        <app-editor-toolbar
          (validate)="validate()"
          (simulate)="simulateOpen.set(true)"
          (publish)="publish()"
          (exportJson)="exportJson()"
          (history)="historyOpen.set(true)"
          (json)="jsonOpen.set(true)"
        />

        @if (store.conflict()) {
          <app-alert-banner variant="warning" icon="alert-triangle" data-testid="conflict-banner">
            <span>Otro usuario modificó el borrador; recarga para ver sus cambios. Tus cambios sin guardar se descartarán.</span>
            <app-button variant="outline" size="sm" (clicked)="store.reload()">
              <app-icon name="refresh-cw" [size]="14" slot="icon" />Recargar
            </app-button>
          </app-alert-banner>
        } @else if (store.saveError(); as message) {
          <app-alert-banner variant="danger" icon="alert-circle">{{ message }}</app-alert-banner>
        }

        @if (validationOpen() && store.backendIssues() !== null) {
          <app-validation-panel
            [errors]="store.backendIssues() ?? []"
            [warnings]="store.backendWarnings()"
            (closed)="validationOpen.set(false)"
          />
        }

        <div class="flex flex-col gap-3 lg:flex-row lg:items-start">
          <app-card [responsive]="true" class="lg:w-72 lg:shrink-0"><app-stage-list /></app-card>
          <app-card [responsive]="true" class="min-w-0 flex-1">
            <div class="flex flex-col gap-3">
              <app-scrollable-tabs [tabs]="views" [activeTab]="view()" size="sm" ariaLabel="Vista de la ruta" (tabChange)="setView($event)" />
              @if (view() === 'map') {
                <app-route-map />
              } @else {
                <app-transition-matrix />
              }
            </div>
          </app-card>
          <app-card [responsive]="true" class="lg:w-96 lg:shrink-0"><app-stage-properties /></app-card>
        </div>
        <app-card [responsive]="true"><app-triggers-panel /></app-card>

        <app-simulator-panel [(isOpen)]="simulateOpen" [definitionId]="id()" />
        <app-json-panel [(isOpen)]="jsonOpen" />
        <app-history-modal [(isOpen)]="historyOpen" [definitionId]="id()" />
        <app-publish-issues-modal [(isOpen)]="issuesOpen" [flowName]="store.row()?.name ?? ''" [issues]="issues()" />
      }
    </div>
  `,
})
export class WorkflowEditorPageComponent implements OnInit {
  protected readonly store = inject(WorkflowEditorStore);
  private readonly lookups = inject(WorkflowEditorLookups);
  private readonly api = inject(WorkflowsApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly views: ScrollableTab[] = [
    { id: 'map', label: 'Mapa de la ruta', icon: 'git-branch' },
    { id: 'matrix', label: 'Matriz de transiciones', icon: 'table' },
  ];
  readonly view = signal<CenterView>('map');
  readonly id = computed(() => this.store.definitionId() ?? 0);
  readonly simulateOpen = signal(false);
  readonly jsonOpen = signal(false);
  readonly historyOpen = signal(false);
  readonly issuesOpen = signal(false);
  readonly issues = signal<string[]>([]);
  readonly validationOpen = signal(false);

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!Number.isInteger(id) || id <= 0) {
      this.store.loadError.set('El flujo que buscas no existe.');
      this.store.loading.set(false);
      return;
    }
    this.lookups.load();
    this.store.load(id);
  }

  setView(id: string): void {
    this.view.set(id === 'matrix' ? 'matrix' : 'map');
  }

  async validate(): Promise<void> {
    if (!(await this.store.saveNow())) {
      this.toast.error('No se pudo guardar el borrador; resuelve el aviso antes de validar.');
      return;
    }
    this.api
      .validateDraft(this.id())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (result) => {
        this.store.backendIssues.set(result.errors);
        this.store.backendWarnings.set(result.warnings);
        this.validationOpen.set(true);
      },
      error: (error) => this.toast.error(toWorkflowError(error).message),
    });
  }

  async publish(): Promise<void> {
    if (!(await this.store.saveNow())) {
      this.toast.error('No se pudo guardar el borrador; resuelve el aviso antes de publicar.');
      return;
    }
    const changelog = await this.dialog.prompt({
      title: 'Publicar flujo',
      message: 'Describe brevemente qué cambió (opcional).',
      placeholder: 'Ej.: Se agregó la aprobación de gerencia',
      confirmText: 'Publicar',
      cancelText: 'Cancelar',
    });
    if (changelog === undefined) return;
    this.api
      .publishDefinition(this.id(), changelog.trim() || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (result) => {
        this.toast.success(
          result.unchanged
            ? `Sin cambios: la versión ${result.version} sigue vigente`
            : `Versión ${result.version} publicada`,
        );
        this.api
          .getDefinition(this.id())
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((row) => this.store.setRow(row));
      },
      error: (error) => {
        const parsed = toWorkflowError(error);
        if (parsed.code === 'WORKFLOW_INVALID') {
          const details = parsed.details as { errors?: { message?: string }[] } | null;
          const lines = (details?.errors ?? [])
            .map((issue) => issue.message)
            .filter((message): message is string => !!message);
          this.issues.set(lines.length ? lines : [parsed.message]);
          this.issuesOpen.set(true);
          return;
        }
        this.toast.error(parsed.message);
      },
    });
  }

  exportJson(): void {
    this.api
      .exportDefinition(this.id())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (result) =>
        downloadTextFile(
          `${this.store.draft()?.key ?? 'flujo'}.json`,
          JSON.stringify(result.definition, null, 2),
        ),
      error: (error) => this.toast.error(toWorkflowError(error).message),
    });
  }
}
