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
import { ApprovalGatePanelComponent } from './components/approval-gate-panel.component';
import { TriggersPanelComponent } from './components/triggers-panel.component';
import { StagePropertiesComponent } from './components/stage-properties.component';
import { TransitionMatrixComponent } from './components/transition-matrix.component';
import { WorkflowCanvasComponent } from './components/canvas/workflow-canvas.component';
import { ValidationPanelComponent } from './components/validation-panel.component';
import { WorkflowAccessPanelComponent } from '../components/workflow-access-panel/workflow-access-panel.component';
import { WorkflowConnectionsComponent } from '../inbound/workflow-connections.component';
import { WorkflowEditorLookups } from './workflow-editor-lookups.service';
import { WorkflowEditorStore } from './workflow-editor.store';

type CenterView = 'canvas' | 'map' | 'matrix';
type EditorPanel = 'stages' | 'properties';

const PANEL_PREFS_KEY = 'vendix_workflow_editor_panels';

function isWideScreen(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1536px)').matches === true;
}

function readPanelPref(panel: EditorPanel, fallback: boolean): boolean {
  try {
    const prefs = JSON.parse(localStorage.getItem(PANEL_PREFS_KEY) ?? '{}') as Partial<Record<EditorPanel, boolean>>;
    return typeof prefs[panel] === 'boolean' ? prefs[panel] : fallback;
  } catch {
    return fallback;
  }
}

function writePanelPref(panel: EditorPanel, collapsed: boolean): void {
  try {
    const prefs = JSON.parse(localStorage.getItem(PANEL_PREFS_KEY) ?? '{}') as Record<string, boolean>;
    localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify({ ...prefs, [panel]: collapsed }));
  } catch {
    // Storage blocked (private mode): the toggle still works for this visit.
  }
}

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
    WorkflowAccessPanelComponent,
    JsonPanelComponent,
    PublishIssuesModalComponent,
    RouteMapComponent,
    SimulatorPanelComponent,
    StageListComponent,
    StagePropertiesComponent,
    TransitionMatrixComponent,
    WorkflowCanvasComponent,
    TriggersPanelComponent,
    ApprovalGatePanelComponent,
    ValidationPanelComponent,
    WorkflowConnectionsComponent,
  ],
  styles: `
    .panel-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.75rem;
      height: 1.75rem;
      border-radius: var(--radius-md);
      color: var(--color-text-secondary);
      transition: background-color 150ms, color 150ms;
    }
    .panel-toggle:hover {
      color: var(--color-primary);
      background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    }
    .panel-rail {
      display: none;
    }
    @media (min-width: 1024px) {
      .panel-rail {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        width: 2.75rem;
        flex-shrink: 0;
        align-self: stretch;
        padding: 0.75rem 0;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-card);
        background: var(--color-surface);
        color: var(--color-text-secondary);
        transition: border-color 150ms, color 150ms;
      }
      .panel-rail:hover {
        color: var(--color-primary);
        border-color: color-mix(in srgb, var(--color-primary) 25%, transparent);
      }
    }
    .panel-rail-label {
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      font-size: 0.75rem;
      font-weight: 600;
    }
    .panel-toggle:focus-visible,
    .panel-rail:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 2px;
    }
  `,
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
          (permissions)="permissionsOpen.set(true)"
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
          <!-- P5.1: the canvas already shows and edits the stages; on wide screens it takes this column too.
               On wide screens both side panels collapse to a rail so the route gets the room. -->
          <app-card [responsive]="true" [class]="stagesPanelClass()">
            <div class="hidden lg:flex justify-end -mt-1 mb-1">
              <button type="button" class="panel-toggle" aria-label="Contraer etapas" title="Contraer etapas" (click)="toggleStages()">
                <app-icon name="panel-left-close" [size]="16" />
              </button>
            </div>
            <app-stage-list />
          </app-card>
          @if (view() !== 'canvas' && stagesCollapsed()) {
            <button type="button" class="panel-rail" aria-label="Mostrar etapas" title="Mostrar etapas" (click)="toggleStages()">
              <app-icon name="panel-left-open" [size]="16" />
              <span class="panel-rail-label">Etapas</span>
            </button>
          }
          <app-card [responsive]="true" class="min-w-0 flex-1">
            <div class="flex flex-col gap-3">
              <app-scrollable-tabs [tabs]="views" [activeTab]="view()" size="sm" ariaLabel="Vista de la ruta" (tabChange)="setView($event)" />
              @if (view() === 'canvas') {
                <app-workflow-canvas />
              } @else if (view() === 'map') {
                <app-route-map />
              } @else {
                <app-transition-matrix />
              }
            </div>
          </app-card>
          @if (propertiesCollapsed()) {
            <button type="button" class="panel-rail" aria-label="Mostrar propiedades de la etapa" title="Mostrar propiedades de la etapa" (click)="toggleProperties()">
              <app-icon name="panel-right-open" [size]="16" />
              <span class="panel-rail-label">Propiedades</span>
            </button>
          }
          <app-card [responsive]="true" [class]="propertiesPanelClass()">
            <div class="hidden lg:flex justify-start -mt-1 mb-1">
              <button type="button" class="panel-toggle" aria-label="Contraer propiedades" title="Contraer propiedades" (click)="toggleProperties()">
                <app-icon name="panel-right-close" [size]="16" />
              </button>
            </div>
            <app-stage-properties />
          </app-card>
        </div>
        <app-card [responsive]="true"><app-triggers-panel /></app-card>
        @if (hasWebhook() || hasEmail() || store.isPublished()) {
          <!-- Renders its own card, also for a connection still active after its trigger was switched off. -->
          <app-workflow-connections
            [definitionId]="id()"
            [hasWebhook]="hasWebhook()"
            [hasEmail]="hasEmail()"
            [published]="store.isPublished()"
            [hasUnpublishedChanges]="store.hasUnpublished()"
            [fieldKeys]="fieldKeys()"
          />
        }
        <app-card [responsive]="true"><app-approval-gate-panel /></app-card>

        <app-simulator-panel [(isOpen)]="simulateOpen" [definitionId]="id()" />
        <app-json-panel [(isOpen)]="jsonOpen" />
        <app-history-modal [(isOpen)]="historyOpen" [definitionId]="id()" />
        <app-workflow-access-panel [(isOpen)]="permissionsOpen" [definitionId]="id()" [flowName]="store.row()?.name ?? ''" />
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
    { id: 'canvas', label: 'Lienzo', icon: 'layout-grid' },
    { id: 'map', label: 'Mapa de la ruta', icon: 'git-branch' },
    { id: 'matrix', label: 'Matriz de transiciones', icon: 'table' },
  ];
  readonly view = signal<CenterView>('canvas');

  /**
   * Side panels can collapse to a rail on wide screens (lg+) to give the route
   * view the room. Below 2xl the stages column starts collapsed: there the
   * three columns leave the route view too narrow to read. The choice is a
   * per-viewer convenience kept in localStorage; on mobile the panels stack
   * and the state is ignored.
   */
  readonly stagesCollapsed = signal(readPanelPref('stages', !isWideScreen()));
  readonly propertiesCollapsed = signal(readPanelPref('properties', false));
  readonly stagesPanelClass = computed(() =>
    this.view() === 'canvas' || this.stagesCollapsed() ? 'lg:hidden' : 'lg:w-72 lg:shrink-0',
  );
  readonly propertiesPanelClass = computed(() =>
    this.propertiesCollapsed() ? 'lg:hidden' : 'lg:w-96 lg:shrink-0',
  );

  toggleStages(): void {
    this.stagesCollapsed.update((v) => !v);
    writePanelPref('stages', this.stagesCollapsed());
  }

  toggleProperties(): void {
    this.propertiesCollapsed.update((v) => !v);
    writePanelPref('properties', this.propertiesCollapsed());
  }
  readonly id = computed(() => this.store.definitionId() ?? 0);
  /** Draft triggers that need a connection card (webhook URL, mailbox). */
  readonly hasWebhook = computed(() => (this.store.draft()?.triggers ?? []).some((t) => t.kind === 'webhook'));
  readonly hasEmail = computed(() => (this.store.draft()?.triggers ?? []).some((t) => t.kind === 'email'));
  readonly fieldKeys = computed(() =>
    (this.store.draft()?.fields ?? []).filter((f) => f.type !== 'file').map((f) => f.key),
  );
  readonly simulateOpen = signal(false);
  readonly jsonOpen = signal(false);
  readonly historyOpen = signal(false);
  readonly permissionsOpen = signal(false);
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
    this.view.set(id === 'matrix' ? 'matrix' : id === 'map' ? 'map' : 'canvas');
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
