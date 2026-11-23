import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { timer } from 'rxjs';
import { filter } from 'rxjs/operators';
import {
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputsearchComponent,
  ItemListCardConfig,
  ModalComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  SelectorComponent,
  StatsComponent,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components/index';
import type { BadgeVariant } from '../../../../../../shared/components/index';
import {
  PlatformAlertResolution,
  PlatformAlertSeverity,
  PlatformAlertStatus,
  PlatformAlertStatusFilter,
  PlatformAlertView,
  PlatformAlertsFilters,
  PlatformAlertsStats,
  PlatformTestAlertSeverity,
} from '../../interfaces';
import { MonitoringAlertsService, MonitoringService } from '../../services';

const PAGE_SIZE = 20;
const AUTO_REFRESH_MS = 30_000;

export const SEVERITY_LABELS: Record<PlatformAlertSeverity, string> = {
  critical: 'Grave',
  warning: 'Leve',
  info: 'Informativa',
};

const SEVERITY_BADGE: Record<PlatformAlertSeverity, BadgeVariant> = {
  critical: 'error',
  warning: 'warning',
  info: 'neutral',
};

/** Keys understood by the table/card `status` badge type. */
const SEVERITY_TABLE_KEY: Record<PlatformAlertSeverity, string> = {
  critical: 'error',
  warning: 'warning',
  info: 'draft',
};
const SEVERITY_TABLE_LABEL: Record<string, string> = {
  error: 'Grave',
  warning: 'Leve',
  draft: 'Informativa',
};
const STATUS_TABLE_KEY: Record<PlatformAlertStatus, string> = {
  open: 'pending',
  resolved: 'completed',
};
const STATUS_TABLE_LABEL: Record<string, string> = {
  pending: 'Abierta',
  completed: 'Resuelta',
};

export const SOURCE_LABELS: Record<string, string> = {
  http: 'Petición fallida',
  latency: 'Respuesta lenta',
  job: 'Trabajo en segundo plano fallido',
  job_stalled: 'Trabajo en segundo plano colgado',
  queue_stalled: 'Cola sin procesar',
  worker: 'Proceso de fondo sin latido',
  incident: 'Incidente reportado',
  test: 'Alerta de prueba',
};

export const RESOLUTION_LABELS: Record<PlatformAlertResolution, string> = {
  auto_quiet: 'Dejó de repetirse',
  recovered: 'El proceso se recuperó',
  manual: 'Marcada a mano',
  ticket_closed: 'Ticket cerrado',
};

export function formatAlertDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

interface AlertRow extends PlatformAlertView {
  severity_key: string;
  status_key: string;
  ticket_label: string;
  kind_column: string;
}

interface DetailEntry {
  key: string;
  value: string;
}

@Component({
  selector: 'app-monitoring-alerts-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    InputsearchComponent,
    ModalComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    SelectorComponent,
    StatsComponent,
  ],
  template: `
    <div class="flex flex-col gap-4">
      <div class="stats-container">
        @for (card of cards(); track card.title) {
          <app-stats
            [title]="card.title"
            [value]="card.value"
            [smallText]="card.small"
            [iconName]="card.icon"
            [iconBgColor]="card.iconBg"
            [iconColor]="card.iconColor"
            [loading]="statsLoading()"
          ></app-stats>
        }
      </div>

      <app-card [padding]="false" overflow="hidden">
        <div class="p-3 md:px-6 md:py-4 border-b border-border flex flex-col gap-3">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <h2 class="text-base font-semibold text-text-primary">
                Alertas ({{ totalItems() }})
              </h2>
              <p class="text-xs text-text-secondary">
                Fallas de la API y de los trabajos en segundo plano, agrupadas por causa
              </p>
            </div>
            <app-button variant="outline" size="sm" (clicked)="openTestModal()">
              <app-icon name="send" [size]="16" slot="icon"></app-icon>
              Alerta de prueba
            </app-button>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
            <app-inputsearch
              class="md:col-span-2"
              placeholder="Buscar por título, proceso o tipo..."
              (searchChange)="onSearch($event)"
            ></app-inputsearch>
            <app-selector
              [options]="statusOptions"
              [value]="statusFilter()"
              (valueChange)="onStatusChange($event)"
            ></app-selector>
            <app-selector
              [options]="severityOptions"
              [value]="severityFilter()"
              (valueChange)="onSeverityChange($event)"
            ></app-selector>
          </div>
        </div>

        @if (loadFailed()) {
          <p class="px-6 py-3 text-sm text-text-secondary">
            No se pudieron cargar las alertas. Usa "Refrescar" para intentarlo de nuevo.
          </p>
        }

        <div class="p-2 md:p-4">
          <app-responsive-data-view
            [data]="rows()"
            [columns]="columns"
            [cardConfig]="cardConfig"
            [loading]="loading() && rows().length === 0"
            emptyMessage="No hay alertas con estos filtros"
            emptyIcon="bell-ring"
            (rowClick)="openDetail($event)"
          ></app-responsive-data-view>
        </div>

        <app-pagination
          [currentPage]="page()"
          [totalPages]="totalPages()"
          [total]="totalItems()"
          [limit]="pageSize"
          infoStyle="range"
          (pageChange)="onPageChange($event)"
        ></app-pagination>
      </app-card>
    </div>

    <app-modal
      [isOpen]="detailOpen()"
      (isOpenChange)="detailOpen.set($event)"
      size="lg"
      title="Detalle de la alerta"
      [subtitle]="selected()?.title ?? ''"
    >
      @if (selected(); as alert) {
        <div class="flex flex-col gap-4">
          <div class="flex flex-wrap items-center gap-2">
            <app-badge [variant]="severityVariant(alert.severity)">
              {{ severityLabel(alert.severity) }}
            </app-badge>
            <app-badge [variant]="alert.status === 'open' ? 'warning' : 'success'">
              {{ alert.status === 'open' ? 'Abierta' : 'Resuelta' }}
            </app-badge>
            @if (alert.category === 'plan_limit') {
              <app-badge variant="neutral">Límite de plan</app-badge>
            }
          </div>

          <div>
            <p class="text-xs font-medium text-text-secondary mb-1">Mensaje</p>
            <pre
              class="text-xs font-mono p-3 rounded-lg bg-background border border-border text-text-primary"
              style="white-space: pre-wrap; word-break: break-word;"
              >{{ alert.message }}</pre
            >
          </div>

          @if (alert.context.length > 0) {
            <dl class="rounded-lg border border-border divide-y divide-border">
              @for (line of alert.context; track line.label + line.value) {
                <div class="flex flex-col sm:flex-row sm:gap-3 px-3 py-2 text-sm">
                  <dt class="text-xs font-medium text-text-secondary sm:w-40 shrink-0">
                    {{ line.label }}
                  </dt>
                  <dd class="text-text-primary break-words">
                    @if (line.href) {
                      <a
                        [href]="line.href"
                        target="_blank"
                        rel="noopener"
                        class="text-primary underline"
                        >{{ line.value }}</a
                      >
                    } @else {
                      {{ line.value }}
                    }
                  </dd>
                </div>
              }
            </dl>
          }

          <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
            @for (field of detailFields(); track field.key) {
              <div>
                <dt class="text-xs font-medium text-text-secondary">{{ field.key }}</dt>
                <dd class="text-text-primary break-words">{{ field.value }}</dd>
              </div>
            }
          </dl>

          @if (detailEntries().length > 0) {
            <div>
              <p class="text-xs font-medium text-text-secondary mb-1">Detalles técnicos</p>
              <dl class="rounded-lg border border-border divide-y divide-border">
                @for (entry of detailEntries(); track entry.key) {
                  <div class="flex flex-col sm:flex-row sm:gap-3 px-3 py-2 text-xs">
                    <dt class="font-mono font-medium text-text-secondary sm:w-48 shrink-0">
                      {{ entry.key }}
                    </dt>
                    <dd class="font-mono text-text-primary break-words" style="white-space: pre-wrap;">
                      {{ entry.value }}
                    </dd>
                  </div>
                }
              </dl>
            </div>
          }
        </div>
      }

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="outline" (clicked)="detailOpen.set(false)">Cerrar</app-button>
        @if (selected()?.status === 'open') {
          <app-button [loading]="resolving()" (clicked)="resolveSelected()">
            Marcar resuelta
          </app-button>
        }
      </div>
    </app-modal>

    <app-modal
      [isOpen]="testOpen()"
      (isOpenChange)="testOpen.set($event)"
      size="sm"
      title="Alerta de prueba"
    >
      <div class="flex flex-col gap-3">
        <app-selector
          label="Gravedad"
          [options]="testOptions"
          [value]="testSeverity()"
          (valueChange)="onTestSeverityChange($event)"
        ></app-selector>
        <p class="text-xs text-text-secondary">
          Leve: solo Telegram. Grave: Telegram, correo a soporte y ticket en Superadmin.
        </p>
      </div>
      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="outline" (clicked)="testOpen.set(false)">Cancelar</app-button>
        <app-button [loading]="sendingTest()" (clicked)="sendTest()">Enviar</app-button>
      </div>
    </app-modal>
  `,
})
export class MonitoringAlertsPage implements OnInit {
  private readonly alertsService = inject(MonitoringAlertsService);
  private readonly monitoring = inject(MonitoringService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);

  readonly pageSize = PAGE_SIZE;

  readonly statusOptions = [
    { value: 'open', label: 'Abiertas' },
    { value: 'resolved', label: 'Resueltas' },
    { value: 'all', label: 'Todas' },
  ];
  readonly severityOptions = [
    { value: 'all', label: 'Todas las gravedades' },
    { value: 'critical', label: 'Grave' },
    { value: 'warning', label: 'Leve' },
    { value: 'info', label: 'Informativa' },
  ];
  readonly testOptions = [
    { value: 'warning', label: 'Leve' },
    { value: 'critical', label: 'Grave' },
  ];

  readonly alerts = signal<PlatformAlertView[]>([]);
  readonly stats = signal<PlatformAlertsStats | null>(null);
  readonly statusFilter = signal<PlatformAlertStatusFilter>('open');
  readonly severityFilter = signal<PlatformAlertSeverity | 'all'>('all');
  readonly search = signal('');
  readonly page = signal(1);
  readonly totalItems = signal(0);
  readonly totalPages = signal(0);
  readonly loading = signal(false);
  readonly statsLoading = signal(true);
  readonly loadFailed = signal(false);

  readonly selected = signal<PlatformAlertView | null>(null);
  readonly detailOpen = signal(false);
  readonly resolving = signal(false);

  readonly testOpen = signal(false);
  readonly testSeverity = signal<PlatformTestAlertSeverity>('warning');
  readonly sendingTest = signal(false);

  private listSeq = 0;
  private paused = false;
  private readonly visibilityHandler = () => {
    this.paused = document.hidden;
  };

  readonly rows = computed<AlertRow[]>(() =>
    this.alerts().map((a) => ({
      ...a,
      severity_key: SEVERITY_TABLE_KEY[a.severity] ?? 'draft',
      status_key: STATUS_TABLE_KEY[a.status] ?? 'pending',
      ticket_label: a.ticket_number ?? '—',
      kind_column: a.kind_label || (SOURCE_LABELS[a.source] ?? a.source),
    })),
  );

  readonly cards = computed(() => {
    const s = this.stats();
    return [
      {
        title: 'Graves abiertas',
        value: s ? s.open_critical : '—',
        small: 'Afectan ventas, pagos o servicio',
        icon: 'triangle-alert',
        iconBg: 'bg-error/10',
        iconColor: 'text-error',
      },
      {
        title: 'Leves abiertas',
        value: s ? s.open_warning + s.open_info : '—',
        small: s ? `${s.open_warning} leves y ${s.open_info} informativas` : undefined,
        icon: 'bell-ring',
        iconBg: 'bg-warning/10',
        iconColor: 'text-warning',
      },
      {
        title: 'Últimas 24 h',
        value: s ? s.last_24h : '—',
        small: 'Alertas con actividad en el día',
        icon: 'clock',
        iconBg: 'bg-primary/10',
        iconColor: 'text-primary',
      },
      {
        title: 'Telegram',
        value: s ? (s.telegram_enabled ? 'Activo' : 'Sin configurar') : '—',
        small: s ? `${s.email_recipients} correos de soporte` : undefined,
        icon: 'send',
        iconBg: s?.telegram_enabled ? 'bg-success/10' : 'bg-text-secondary/10',
        iconColor: s?.telegram_enabled ? 'text-success' : 'text-text-secondary',
      },
    ];
  });

  readonly detailFields = computed<DetailEntry[]>(() => {
    const a = this.selected();
    if (!a) return [];
    return [
      { key: 'Proceso', value: a.process },
      { key: 'Tipo de error', value: a.error_type },
      { key: 'Clase', value: a.kind_label || (SOURCE_LABELS[a.source] ?? a.source) },
      { key: 'Veces', value: String(a.occurrences) },
      { key: 'Primera vez', value: formatAlertDateTime(a.first_seen_at) },
      { key: 'Última vez', value: formatAlertDateTime(a.last_seen_at) },
      { key: 'Escalada', value: formatAlertDateTime(a.escalated_at) },
      { key: 'Resuelta', value: formatAlertDateTime(a.resolved_at) },
      { key: 'Resolución', value: a.resolution ? RESOLUTION_LABELS[a.resolution] : '—' },
      { key: 'Ticket', value: a.ticket_number ?? '—' },
      { key: 'Estado del ticket', value: a.ticket_status ?? '—' },
      { key: 'Telegram', value: a.telegram_sent ? 'Enviado' : 'No enviado' },
    ];
  });

  readonly detailEntries = computed<DetailEntry[]>(() => {
    const details = this.selected()?.details;
    if (!details) return [];
    return Object.entries(details).map(([key, value]) => ({
      key,
      value:
        typeof value === 'string'
          ? value
          : value === null || value === undefined
            ? '—'
            : JSON.stringify(value),
    }));
  });

  readonly columns: TableColumn[] = [
    {
      key: 'last_seen_at',
      label: 'Última vez',
      priority: 1,
      transform: (v: string) => formatAlertDateTime(v),
    },
    {
      key: 'severity_key',
      label: 'Gravedad',
      priority: 1,
      badge: true,
      badgeConfig: { type: 'status', size: 'sm' },
      badgeTransform: (v: string) => SEVERITY_TABLE_LABEL[v] ?? v,
    },
    { key: 'title', label: 'Título', priority: 1 },
    { key: 'process', label: 'Proceso', priority: 2 },
    { key: 'kind_column', label: 'Clase', priority: 3 },
    { key: 'error_type', label: 'Tipo', priority: 3 },
    { key: 'scope_label', label: 'Tienda', priority: 3 },
    { key: 'occurrences', label: 'Veces', priority: 2, align: 'right' },
    {
      key: 'status_key',
      label: 'Estado',
      priority: 2,
      badge: true,
      badgeConfig: { type: 'status', size: 'sm' },
      badgeTransform: (v: string) => STATUS_TABLE_LABEL[v] ?? v,
    },
    { key: 'ticket_label', label: 'Ticket', priority: 3 },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'title',
    subtitleKey: 'process',
    badgeKey: 'severity_key',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (v: unknown) => SEVERITY_TABLE_LABEL[String(v)] ?? String(v),
    detailKeys: [
      {
        key: 'last_seen_at',
        label: 'Última vez',
        transform: (v: string) => formatAlertDateTime(v),
      },
      { key: 'kind_column', label: 'Clase' },
      { key: 'error_type', label: 'Tipo' },
      { key: 'scope_label', label: 'Tienda' },
      { key: 'occurrences', label: 'Veces' },
      {
        key: 'status_key',
        label: 'Estado',
        transform: (v: string) => STATUS_TABLE_LABEL[v] ?? v,
      },
      { key: 'ticket_label', label: 'Ticket' },
    ],
  };

  constructor() {
    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.destroyRef.onDestroy(() =>
      document.removeEventListener('visibilitychange', this.visibilityHandler),
    );

    this.monitoring.manualRefresh$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refresh());

    // Deep link: ?alert=<id> opens that alert's detail (used by "Ver en Superadmin").
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const id = Number(params.get('alert'));
        if (Number.isInteger(id) && id > 0) this.openById(id);
      });

    timer(AUTO_REFRESH_MS, AUTO_REFRESH_MS)
      .pipe(
        filter(() => this.monitoring.autoRefresh() && !this.paused),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.refresh());
  }

  ngOnInit(): void {
    this.refresh();
  }

  severityLabel(severity: PlatformAlertSeverity): string {
    return SEVERITY_LABELS[severity] ?? severity;
  }

  severityVariant(severity: PlatformAlertSeverity): BadgeVariant {
    return SEVERITY_BADGE[severity] ?? 'neutral';
  }

  refresh(): void {
    this.loadList();
    this.loadStats();
  }

  onSearch(term: string): void {
    this.search.set(term);
    this.page.set(1);
    this.loadList();
  }

  onStatusChange(value: string | number | null): void {
    this.statusFilter.set((value ?? 'open') as PlatformAlertStatusFilter);
    this.page.set(1);
    this.loadList();
  }

  onSeverityChange(value: string | number | null): void {
    this.severityFilter.set((value ?? 'all') as PlatformAlertSeverity | 'all');
    this.page.set(1);
    this.loadList();
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.loadList();
  }

  openDetail(row: PlatformAlertView): void {
    this.selected.set(row);
    this.detailOpen.set(true);
    this.alertsService
      .getById(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (full) => {
          if (this.selected()?.id === full.id) this.selected.set(full);
        },
        error: () => this.toast.error('No se pudo cargar el detalle de la alerta'),
      });
  }

  openById(id: number): void {
    this.alertsService
      .getById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (full) => {
          this.selected.set(full);
          this.detailOpen.set(true);
        },
        error: () => this.toast.error('No se pudo cargar la alerta indicada'),
      });
  }

  resolveSelected(): void {
    const alert = this.selected();
    if (!alert || alert.status !== 'open') return;
    this.resolving.set(true);
    this.alertsService
      .resolve(alert.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.resolving.set(false);
          this.detailOpen.set(false);
          this.toast.success('Alerta marcada como resuelta');
          this.refresh();
        },
        error: () => {
          this.resolving.set(false);
          this.toast.error('No se pudo marcar la alerta como resuelta');
        },
      });
  }

  openTestModal(): void {
    this.testSeverity.set('warning');
    this.testOpen.set(true);
  }

  onTestSeverityChange(value: string | number | null): void {
    this.testSeverity.set(value === 'critical' ? 'critical' : 'warning');
  }

  sendTest(): void {
    this.sendingTest.set(true);
    this.alertsService
      .sendTest(this.testSeverity())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.sendingTest.set(false);
          this.testOpen.set(false);
          const parts = [
            result.telegram_sent ? 'Telegram enviado' : 'Telegram no enviado',
            result.ticket_number ? `ticket ${result.ticket_number}` : 'sin ticket',
            `${result.occurrences} ${result.occurrences === 1 ? 'vez' : 'veces'}`,
          ];
          this.toast.success(`Alerta de prueba creada: ${parts.join(', ')}`);
          this.refresh();
        },
        error: () => {
          this.sendingTest.set(false);
          this.toast.error('No se pudo enviar la alerta de prueba');
        },
      });
  }

  private buildFilters(): PlatformAlertsFilters {
    const severity = this.severityFilter();
    return {
      status: this.statusFilter(),
      severity: severity === 'all' ? undefined : severity,
      search: this.search(),
      page: this.page(),
      limit: PAGE_SIZE,
    };
  }

  private loadList(): void {
    const seq = ++this.listSeq;
    this.loading.set(true);
    this.alertsService
      .list(this.buildFilters())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (seq !== this.listSeq) return;
          this.alerts.set(res.data);
          this.totalItems.set(res.meta?.total ?? res.data.length);
          this.totalPages.set(res.meta?.totalPages ?? 1);
          this.loadFailed.set(false);
          this.loading.set(false);
        },
        error: () => {
          if (seq !== this.listSeq) return;
          this.loadFailed.set(true);
          this.loading.set(false);
        },
      });
  }

  private loadStats(): void {
    this.alertsService
      .getStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stats) => {
          this.stats.set(stats);
          this.statsLoading.set(false);
        },
        error: () => this.statsLoading.set(false),
      });
  }
}
