import { Component, DestroyRef, OnInit, computed, inject, signal, viewChild, TemplateRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import {
  BadgeComponent,
  CardComponent,
  DialogService,
  EmptyStateComponent,
  InputsearchComponent,
  ItemListCardConfig,
  PaginationComponent,
  ResponsiveDataViewComponent,
  ScrollableTabsComponent,
  SelectorComponent,
  StatsComponent,
  StickyHeaderComponent,
  TableAction,
  TableColumn,
  ToastService,
  ToggleComponent,
} from '../../../../../../shared/components/index';
import { ScrollableTab } from '../../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';
import { WorkflowPublicLinkModalComponent } from '../../components/public-link-modal.component';
import { ImportDefinitionModalComponent } from '../../components/import-definition-modal.component';
import { PublishIssuesModalComponent } from '../../components/publish-issues-modal.component';
import { StartInstanceModalComponent } from '../../components/start-instance-modal.component';
import {
  WorkflowDefinitionRow,
  WorkflowInstanceRow,
} from '../../interfaces/workflow.interfaces';
import { WorkflowsApiService } from '../../services/workflows-api.service';
import { toWorkflowError } from '../../utils/workflow-errors.util';
import {
  DEFINITION_STATUS_LABEL,
  downloadTextFile,
  dueText,
  instanceStatusLabel,
} from '../../utils/workflow-labels.util';

type WorkflowsTab = 'flows' | 'requests';

interface DefinitionView extends WorkflowDefinitionRow {
  /** Badge class key: published reads as `active`, archived as `inactive`. */
  status_badge: string;
  version_text: string;
  /** P2.11: the on/off switch ("Encendido" / "Apagado"). */
  enabled: boolean;
  enabled_text: string;
}

interface InstanceView extends WorkflowInstanceRow {
  due_text: string;
}

interface WorkflowStats {
  published: number;
  drafts: number;
  active: number;
  overdue: number;
}

const BADGE_LABEL: Record<string, string> = {
  active: DEFINITION_STATUS_LABEL['active'],
  draft: DEFINITION_STATUS_LABEL['draft'],
  inactive: DEFINITION_STATUS_LABEL['archived'],
};

@Component({
  selector: 'app-workflows-page',
  standalone: true,
  imports: [
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    ScrollableTabsComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
    ImportDefinitionModalComponent,
    PublishIssuesModalComponent,
    StartInstanceModalComponent,
    WorkflowPublicLinkModalComponent,
    SelectorComponent,
    ToggleComponent,
    BadgeComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Flujos"
        subtitle="Diseña procesos con etapas, responsables, aprobaciones y expedientes"
        icon="git-branch"
        variant="glass"
        [actions]="headerActions"
        (actionClicked)="onHeaderAction($event)"
      />

      <div class="stats-container sticky top-[52px] z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Flujos activos"
          [value]="stats().published"
          smallText="Publicados y listos para usar"
          iconName="git-branch"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
          [loading]="statsLoading()"
        />
        <app-stats
          title="Borradores"
          [value]="stats().drafts"
          smallText="Pendientes de publicar"
          iconName="file-text"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
          [loading]="statsLoading()"
        />
        <app-stats
          title="En curso"
          [value]="stats().active"
          smallText="Solicitudes abiertas"
          iconName="clock"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
          [loading]="statsLoading()"
        />
        <app-stats
          title="Vencidas"
          [value]="stats().overdue"
          smallText="Pasaron su plazo"
          iconName="alert-triangle"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
          [loading]="statsLoading()"
        />
      </div>

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
            <app-scrollable-tabs
              [tabs]="tabs"
              [activeTab]="activeTab()"
              size="sm"
              ariaLabel="Secciones de flujos"
              (tabChange)="onTabChange($event)"
            />
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                [placeholder]="activeTab() === 'flows' ? 'Buscar flujo...' : 'Buscar solicitud...'"
                [debounceTime]="300"
                (searchChange)="onSearch($event)"
              />
            </div>
          </div>
          @if (activeTab() === 'requests') {
            <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3 sm:items-end">
              <app-selector
                label="Flujo"
                [options]="definitionOptions()"
                [value]="instDefinition()"
                (valueChange)="onInstanceFilter('definition', $event)"
              />
              <app-selector
                label="Estado"
                [options]="statusOptions"
                [value]="instStatus()"
                (valueChange)="onInstanceFilter('status', $event)"
              />
              <app-toggle
                label="Solo vencidas"
                [checked]="instOverdue()"
                (toggled)="onInstanceFilter('overdue', $event)"
              />
            </div>
          }
          <h2 class="mt-2 text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
            {{ activeTab() === 'flows' ? 'Flujos' : 'Solicitudes' }} ({{ totalItems() }})
          </h2>
        </div>

        @if (loading()) {
          <div class="p-4 md:p-6 text-center">
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p class="mt-2 text-text-secondary">Cargando...</p>
          </div>
        } @else if (totalItems() === 0) {
          @if (activeTab() === 'flows') {
            <app-empty-state
              icon="git-branch"
              [title]="searchTerm() ? 'Ningún flujo coincide con tu búsqueda' : 'Aún no tienes flujos'"
              [description]="searchTerm() ? 'Prueba con otro nombre o clave.' : 'Crea tu primer flujo cargando su definición en JSON.'"
              actionButtonText="Nuevo desde JSON"
              [showActionButton]="!searchTerm()"
              (actionClick)="importOpen.set(true)"
            />
          } @else {
            <app-empty-state
              icon="list-checks"
              [title]="searchTerm() ? 'Ninguna solicitud coincide con tu búsqueda' : 'Aún no hay solicitudes'"
              description="Inicia una solicitud desde un flujo publicado."
              [showActionButton]="false"
            />
          }
        } @else {
          <div class="px-2 pb-2 pt-3 md:p-4">
            @if (activeTab() === 'flows') {
              <app-responsive-data-view
                [data]="definitionRows()"
                [columns]="definitionColumns()"
                [actions]="definitionActions"
                [cardConfig]="definitionCard"
                [sortable]="false"
                emptyMessage="No hay flujos"
                emptyIcon="git-branch"
              />
            } @else {
              <app-responsive-data-view
                [data]="instanceRows()"
                [columns]="instanceColumns"
                [cardConfig]="instanceCard"
                [sortable]="false"
                emptyMessage="No hay solicitudes"
                emptyIcon="list-checks"
                (rowClick)="openInstance($event)"
              />
            }
            <div class="mt-4 flex justify-center">
              <app-pagination
                [currentPage]="page()"
                [totalPages]="totalPages()"
                [total]="totalItems()"
                [limit]="limit"
                (pageChange)="onPageChange($event)"
              />
            </div>
          </div>
        }
      </app-card>
    </div>

    <ng-template #enabledCell let-row>
      <div class="flex items-center gap-2" data-testid="enabled-cell">
        <app-toggle
          [checked]="row.enabled"
          [disabled]="row.status === 'archived'"
          [ariaLabel]="'Interruptor de ' + row.name"
          (toggled)="setEnabled(row, $event)"
        />
        @if (!row.enabled) {
          <app-badge variant="warning" size="sm">Apagado</app-badge>
        }
      </div>
    </ng-template>

    <app-import-definition-modal [(isOpen)]="importOpen" (created)="onCreated()" />
    <app-publish-issues-modal
      [(isOpen)]="issuesOpen"
      [flowName]="issuesFlow()"
      [issues]="issues()"
    />
    <app-workflow-public-link-modal [(isOpen)]="linkOpen" [definition]="linkTarget()" />
    <app-start-instance-modal
      [(isOpen)]="startOpen"
      [definition]="startTarget()"
      (started)="onStarted($event)"
    />
  `,
})
export class WorkflowsPageComponent implements OnInit {
  private readonly api = inject(WorkflowsApiService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly limit = 10;
  readonly tabs: ScrollableTab[] = [
    { id: 'flows', label: 'Flujos', icon: 'git-branch' },
    { id: 'requests', label: 'Solicitudes', icon: 'list-checks' },
  ];
  readonly headerActions = [
    { id: 'inbox', label: 'Mis tareas', icon: 'inbox', variant: 'outline' as const },
    { id: 'integrations', label: 'Integraciones', icon: 'plug', variant: 'outline' as const },
    { id: 'import', label: 'Nuevo desde JSON', icon: 'plus', variant: 'primary' as const },
  ];

  readonly activeTab = signal<WorkflowsTab>('flows');
  readonly searchTerm = signal('');
  readonly page = signal(1);
  readonly totalItems = signal(0);
  readonly loading = signal(false);
  readonly totalPages = computed(() => Math.ceil(this.totalItems() / this.limit) || 1);

  readonly definitions = signal<WorkflowDefinitionRow[]>([]);
  readonly instances = signal<WorkflowInstanceRow[]>([]);
  readonly stats = signal<WorkflowStats>({ published: 0, drafts: 0, active: 0, overdue: 0 });
  readonly statsLoading = signal(true);

  readonly importOpen = signal(false);
  readonly issuesOpen = signal(false);
  readonly issues = signal<string[]>([]);
  readonly issuesFlow = signal('');
  readonly startOpen = signal(false);
  readonly startTarget = signal<WorkflowDefinitionRow | null>(null);
  readonly linkOpen = signal(false);
  readonly linkTarget = signal<WorkflowDefinitionRow | null>(null);

  readonly statusOptions = [
    { value: 'all', label: 'Todos los estados' },
    { value: 'active', label: 'En curso' },
    { value: 'completed', label: 'Completadas' },
    { value: 'rejected', label: 'Rechazadas' },
    { value: 'cancelled', label: 'Canceladas' },
  ];
  readonly definitionOptions = signal<{ value: string; label: string }[]>([
    { value: 'all', label: 'Todos los flujos' },
  ]);
  readonly instDefinition = signal('all');
  readonly instStatus = signal('all');
  readonly instOverdue = signal(false);

  readonly definitionRows = computed<DefinitionView[]>(() =>
    this.definitions().map((row) => ({
      ...row,
      status_badge:
        row.status === 'active' ? 'active' : row.status === 'archived' ? 'inactive' : 'draft',
      version_text: this.versionText(row),
      enabled: row.is_enabled !== false,
      enabled_text: row.is_enabled !== false ? 'Encendido' : 'Apagado',
    })),
  );

  readonly instanceRows = computed<InstanceView[]>(() =>
    this.instances().map((row) => ({
      ...row,
      due_text: row.status === 'active' ? dueText(row.stage_due_at) : '—',
    })),
  );

  private readonly enabledCell = viewChild.required<TemplateRef<unknown>>('enabledCell');

  readonly definitionColumns = computed<TableColumn[]>(() => [
    { key: 'name', label: 'Flujo', priority: 1 },
    { key: 'key', label: 'Clave', priority: 3, width: '160px' },
    {
      key: 'status_badge',
      label: 'Estado',
      priority: 1,
      width: '130px',
      badge: true,
      badgeConfig: { type: 'status' },
      transform: (value: string) => BADGE_LABEL[value] ?? value,
    },
    { key: 'version_text', label: 'Versión', priority: 2, width: '220px' },
    { key: 'enabled', label: 'Activo', priority: 1, width: '170px', template: this.enabledCell() },
  ]);

  readonly definitionCard: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'key',
    avatarFallbackIcon: 'git-branch',
    avatarShape: 'square',
    badgeKey: 'status_badge',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (value: string) => BADGE_LABEL[value] ?? value,
    detailKeys: [
      { key: 'version_text', label: 'Versión', icon: 'layers' },
      { key: 'enabled_text', label: 'Interruptor', icon: 'power' },
    ],
  };

  readonly definitionActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'pencil',
      variant: 'info',
      show: (row: WorkflowDefinitionRow) => row.status !== 'archived',
      action: (row: WorkflowDefinitionRow) =>
        this.router.navigate(['/admin/workflows', row.id, 'edit']),
    },
    {
      label: 'Publicar',
      icon: 'send',
      variant: 'primary',
      show: (row: WorkflowDefinitionRow) => row.status !== 'archived',
      action: (row: WorkflowDefinitionRow) => this.publish(row),
    },
    {
      label: 'Iniciar solicitud',
      icon: 'play',
      variant: 'success',
      show: (row: WorkflowDefinitionRow) => row.status === 'active',
      action: (row: WorkflowDefinitionRow) => this.openStart(row),
    },
    {
      label: 'Tablero',
      icon: 'layout-dashboard',
      variant: 'info',
      show: (row: WorkflowDefinitionRow) => row.status === 'active',
      action: (row: WorkflowDefinitionRow) =>
        this.router.navigate(['/admin/workflows', row.id, 'board']),
    },
    {
      label: 'Analítica',
      icon: 'bar-chart-3',
      variant: 'info',
      show: (row: WorkflowDefinitionRow) => row.status === 'active',
      action: (row: WorkflowDefinitionRow) =>
        this.router.navigate(['/admin/workflows', row.id, 'analytics']),
    },
    {
      label: 'Enlace público',
      icon: 'link',
      variant: 'info',
      show: (row: WorkflowDefinitionRow) => row.status === 'active',
      action: (row: WorkflowDefinitionRow) => {
        this.linkTarget.set(row);
        this.linkOpen.set(true);
      },
    },
    {
      label: 'Exportar JSON',
      icon: 'download',
      variant: 'info',
      action: (row: WorkflowDefinitionRow) => this.exportJson(row),
    },
    {
      label: (row: WorkflowDefinitionRow) => (row.status === 'archived' ? 'Reactivar' : 'Archivar'),
      icon: (row: WorkflowDefinitionRow) => (row.status === 'archived' ? 'rotate-ccw' : 'archive'),
      variant: 'muted',
      action: (row: WorkflowDefinitionRow) => this.toggleArchive(row),
    },
  ];

  readonly instanceColumns: TableColumn[] = [
    { key: 'reference', label: 'Referencia', priority: 1, width: '130px' },
    { key: 'title', label: 'Título', priority: 1 },
    { key: 'definition_name', label: 'Flujo', priority: 2 },
    { key: 'current_stage_name', label: 'Etapa', priority: 2, defaultValue: '—' },
    {
      key: 'due_text',
      label: 'Vence',
      priority: 2,
      cellClass: (_value: string, item?: InstanceView) =>
        item?.overdue ? 'text-error font-medium' : '',
    },
    {
      key: 'status',
      label: 'Estado',
      priority: 1,
      width: '130px',
      badge: true,
      badgeConfig: { type: 'status' },
      transform: (value: string) => instanceStatusLabel(value),
    },
  ];

  readonly instanceCard: ItemListCardConfig = {
    titleKey: 'title',
    subtitleKey: 'reference',
    avatarFallbackIcon: 'list-checks',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (value: string) => instanceStatusLabel(value),
    detailKeys: [
      { key: 'definition_name', label: 'Flujo', icon: 'git-branch' },
      { key: 'current_stage_name', label: 'Etapa', icon: 'layers', defaultValue: '—' },
      { key: 'due_text', label: 'Vence', icon: 'clock' },
    ],
  };

  ngOnInit(): void {
    this.api
      .listDefinitions({ limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) =>
          this.definitionOptions.set([
            { value: 'all', label: 'Todos los flujos' },
            ...(res.data ?? []).map((d) => ({ value: String(d.id), label: d.name })),
          ]),
        // Only the filter options: the list below reports its own load error.
        error: () => undefined,
      });
    this.loadStats();
    this.load();
  }

  onHeaderAction(id: string): void {
    if (id === 'import') this.importOpen.set(true);
    if (id === 'inbox') this.router.navigate(['/admin/workflows/inbox']);
    if (id === 'integrations') this.router.navigate(['/admin/workflows/integrations']);
  }

  onTabChange(tab: string): void {
    if (tab !== 'flows' && tab !== 'requests') return;
    this.activeTab.set(tab);
    this.searchTerm.set('');
    this.page.set(1);
    this.load();
  }

  onInstanceFilter(kind: 'definition' | 'status' | 'overdue', value: unknown): void {
    if (kind === 'overdue') this.instOverdue.set(value === true);
    else if (kind === 'status') this.instStatus.set(String(value ?? 'all'));
    else this.instDefinition.set(String(value ?? 'all'));
    this.page.set(1);
    this.load();
  }

  onSearch(term: string): void {
    this.searchTerm.set(term ?? '');
    this.page.set(1);
    this.load();
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  onCreated(): void {
    this.activeTab.set('flows');
    this.page.set(1);
    this.load();
    this.loadStats();
  }

  openInstance(row: WorkflowInstanceRow): void {
    this.router.navigate(['/admin/workflows/instances', row.id]);
  }

  openStart(row: WorkflowDefinitionRow): void {
    this.startTarget.set(row);
    this.startOpen.set(true);
  }

  onStarted(instanceId: number): void {
    this.loadStats();
    this.router.navigate(['/admin/workflows/instances', instanceId]);
  }

  publish(row: WorkflowDefinitionRow): void {
    this.api.publishDefinition(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (result) => {
        this.toast.success(
          result.unchanged
            ? `Sin cambios: la versión ${result.version} sigue vigente`
            : `Versión ${result.version} publicada`,
        );
        this.load();
        this.loadStats();
      },
      error: (error) => {
        const parsed = toWorkflowError(error);
        if (parsed.code === 'WORKFLOW_INVALID') {
          const details = parsed.details as { errors?: { message?: string }[] } | null;
          const lines = (details?.errors ?? [])
            .map((issue) => issue.message)
            .filter((message): message is string => !!message);
          this.issuesFlow.set(row.name);
          this.issues.set(lines.length ? lines : [parsed.message]);
          this.issuesOpen.set(true);
          return;
        }
        this.toast.error(parsed.message);
      },
    });
  }

  exportJson(row: WorkflowDefinitionRow): void {
    this.api.exportDefinition(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (result) =>
        downloadTextFile(`${row.key}.json`, JSON.stringify(result.definition, null, 2)),
      error: (error) => this.toast.error(toWorkflowError(error).message),
    });
  }

  async toggleArchive(row: WorkflowDefinitionRow): Promise<void> {
    const archiving = row.status !== 'archived';
    if (archiving) {
      const confirmed = await this.dialog.confirm({
        title: 'Archivar flujo',
        message: `¿Archivar "${row.name}"? No se podrán iniciar solicitudes nuevas; las que están en curso siguen su camino.`,
        confirmText: 'Archivar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      });
      if (!confirmed) return;
    }
    const request = archiving
      ? this.api.archiveDefinition(row.id)
      : this.api.unarchiveDefinition(row.id);
    request
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: () => {
        this.toast.success(archiving ? 'Flujo archivado' : 'Flujo reactivado');
        this.load();
        this.loadStats();
      },
      error: (error) => this.toast.error(toWorkflowError(error).message),
    });
  }

  /** P2.11: optimistic switch; the row goes back if the server refuses. */
  setEnabled(row: DefinitionView | WorkflowDefinitionRow, enabled: boolean): void {
    this.patchEnabled(row.id, enabled);
    this.api
      .setDefinitionEnabled(row.id, enabled)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.patchEnabled(row.id, updated.is_enabled ?? enabled);
          this.toast.success(enabled ? 'Flujo encendido' : 'Flujo apagado: no se inician solicitudes nuevas');
        },
        error: (error) => {
          this.patchEnabled(row.id, !enabled);
          this.toast.error(toWorkflowError(error).message);
        },
      });
  }

  private patchEnabled(id: number, enabled: boolean): void {
    this.definitions.update((rows) =>
      rows.map((r) => (r.id === id ? { ...r, is_enabled: enabled } : r)),
    );
  }

  private versionText(row: WorkflowDefinitionRow): string {
    const parts: string[] = [];
    if (row.published_version) parts.push(`v${row.published_version.version}`);
    else parts.push('Sin publicar');
    if (row.has_unpublished_changes && row.published_version) {
      parts.push('cambios sin publicar');
    }
    return parts.join(' · ');
  }

  private load(): void {
    this.loading.set(true);
    const search = this.searchTerm() || undefined;
    if (this.activeTab() === 'flows') {
      this.api
        .listDefinitions({ page: this.page(), limit: this.limit, search })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.definitions.set(res.data ?? []);
            this.totalItems.set(res.meta?.total ?? res.data?.length ?? 0);
            this.loading.set(false);
          },
          error: (error) => this.failLoad(error),
        });
    } else {
      this.api
        .listInstances({
          page: this.page(),
          limit: this.limit,
          search,
          ...(this.instDefinition() !== 'all'
            ? { definition_id: Number(this.instDefinition()) }
            : {}),
          ...(this.instStatus() !== 'all' ? { status: this.instStatus() } : {}),
          ...(this.instOverdue() ? { overdue: true } : {}),
        })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.instances.set(res.data ?? []);
            this.totalItems.set(res.meta?.total ?? res.data?.length ?? 0);
            this.loading.set(false);
          },
          error: (error) => this.failLoad(error),
        });
    }
  }

  private loadStats(): void {
    this.statsLoading.set(true);
    forkJoin({
      published: this.api.listDefinitions({ limit: 1, status: 'active' }),
      drafts: this.api.listDefinitions({ limit: 1, status: 'draft' }),
      active: this.api.listInstances({ limit: 1, status: 'active' }),
      overdue: this.api.listInstances({ limit: 1, overdue: true }),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.stats.set({
            published: res.published.meta?.total ?? 0,
            drafts: res.drafts.meta?.total ?? 0,
            active: res.active.meta?.total ?? 0,
            overdue: res.overdue.meta?.total ?? 0,
          });
          this.statsLoading.set(false);
        },
        error: () => this.statsLoading.set(false),
      });
  }

  private failLoad(error: unknown): void {
    this.loading.set(false);
    this.toast.error(toWorkflowError(error).message);
  }
}
