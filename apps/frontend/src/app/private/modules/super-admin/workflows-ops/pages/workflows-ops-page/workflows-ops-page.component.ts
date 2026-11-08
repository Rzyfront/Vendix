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
import { forkJoin } from 'rxjs';
import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  ItemListCardConfig,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components/index';
import {
  WorkflowOpsAlert,
  WorkflowOpsMetrics,
} from '../../interfaces/workflows-ops.interface';
import { WorkflowsOpsApiService } from '../../services/workflows-ops-api.service';
import {
  RULE_LABELS,
  SEVERITY_LABELS,
  formatDateTime,
  formatDuration,
  formatLatency,
  formatPercent,
  outboxKindLabel,
} from '../../workflows-ops.format';

const ALERTS_PAGE_SIZE = 10;
/** Same threshold the alert rule uses: no cycle for this long means the dispatcher is stalled. */
const STALLED_CYCLE_SECONDS = 5 * 60;

@Component({
  selector: 'app-workflows-ops-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    CardComponent,
    IconComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
  ],
  template: `
    <h1 class="sr-only">Operación de Flujos</h1>
    <div class="flex flex-col gap-6">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-lg font-semibold text-text-primary">Operación de Flujos</h2>
          <p class="text-xs text-text-secondary mt-0.5">
            Cola, latencia, fallidos y webhooks de todas las tiendas
            @if (metrics(); as m) {
              · actualizado {{ formatDateTime(m.generated_at) }}
            }
          </p>
        </div>
        <app-button
          variant="outline"
          size="sm"
          title="Actualizar"
          [disabled]="loading()"
          (clicked)="refresh()"
        >
          <app-icon
            name="refresh-cw"
            [size]="16"
            slot="icon"
            [class.animate-spin]="loading()"
          ></app-icon>
          Actualizar
        </app-button>
      </div>

      @if (loadFailed()) {
        <app-card>
          <p class="text-sm text-text-secondary">
            No se pudieron cargar las métricas. Usa "Actualizar" para intentarlo de nuevo.
          </p>
        </app-card>
      }

      <div class="stats-container">
        @for (card of cards(); track card.title) {
          <app-stats
            [title]="card.title"
            [value]="card.value"
            [smallText]="card.small"
            [iconName]="card.icon"
            [iconBgColor]="card.iconBg"
            [iconColor]="card.iconColor"
            [loading]="loading() && !metrics()"
          ></app-stats>
        }
      </div>

      <app-card>
        <h3 class="text-base font-semibold text-text-primary">Último ciclo del despachador</h3>
        @if (cycleText(); as text) {
          <p class="text-sm mt-1" [class.text-red-600]="cycleStalled()">{{ text }}</p>
        }
      </app-card>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <app-card [padding]="false" overflow="hidden">
          <div class="p-3 md:px-6 md:py-4 border-b border-[var(--color-border)]">
            <h3 class="text-base font-semibold text-text-primary">Tiendas con más atraso</h3>
            <p class="text-xs text-text-secondary">Tareas vencidas sin procesar</p>
          </div>
          <div class="p-2 md:p-4">
            <app-responsive-data-view
              [data]="metrics()?.top_stores?.by_backlog ?? []"
              [columns]="storeColumns"
              [cardConfig]="storeCardConfig"
              [loading]="loading() && !metrics()"
              emptyMessage="Ninguna tienda tiene atraso"
              emptyIcon="check-circle"
            ></app-responsive-data-view>
          </div>
        </app-card>

        <app-card [padding]="false" overflow="hidden">
          <div class="p-3 md:px-6 md:py-4 border-b border-[var(--color-border)]">
            <h3 class="text-base font-semibold text-text-primary">Tiendas con más fallidos</h3>
            <p class="text-xs text-text-secondary">Tareas agotadas en las últimas 24 h</p>
          </div>
          <div class="p-2 md:p-4">
            <app-responsive-data-view
              [data]="metrics()?.top_stores?.by_dead_24h ?? []"
              [columns]="storeColumns"
              [cardConfig]="storeCardConfig"
              [loading]="loading() && !metrics()"
              emptyMessage="Ninguna tienda tiene fallidos"
              emptyIcon="check-circle"
            ></app-responsive-data-view>
          </div>
        </app-card>
      </div>

      <app-card [padding]="false" overflow="hidden">
        <div class="p-3 md:px-6 md:py-4 border-b border-[var(--color-border)]">
          <h3 class="text-base font-semibold text-text-primary">Últimos fallidos</h3>
          <p class="text-xs text-text-secondary">
            Las 20 tareas más recientes que agotaron sus reintentos (error truncado, sin datos del cliente)
          </p>
        </div>
        <div class="p-2 md:p-4">
          <app-responsive-data-view
            [data]="metrics()?.recent_dead ?? []"
            [columns]="deadColumns"
            [cardConfig]="deadCardConfig"
            [loading]="loading() && !metrics()"
            emptyMessage="No hay tareas fallidas"
            emptyIcon="check-circle"
          ></app-responsive-data-view>
        </div>
      </app-card>

      <app-card [padding]="false" overflow="hidden">
        <div class="p-3 md:px-6 md:py-4 border-b border-[var(--color-border)]">
          <h3 class="text-base font-semibold text-text-primary">Historial de alertas</h3>
          <p class="text-xs text-text-secondary">
            Cada alerta se envía por correo una sola vez por regla y hora
          </p>
        </div>
        <div class="p-2 md:p-4">
          <app-responsive-data-view
            [data]="alerts()"
            [columns]="alertColumns"
            [cardConfig]="alertCardConfig"
            [loading]="loading() && alerts().length === 0"
            emptyMessage="Todavía no hay alertas"
            emptyIcon="check-circle"
          ></app-responsive-data-view>
        </div>
        @if (alertsTotalPages() > 1) {
          <div class="px-6 py-4 border-t border-border bg-muted/30 flex justify-center">
            <app-pagination
              [currentPage]="alertsPage()"
              [totalPages]="alertsTotalPages()"
              [total]="alertsTotal()"
              [limit]="alertsPageSize"
              infoStyle="range"
              (pageChange)="goToAlertsPage($event)"
            />
          </div>
        }
      </app-card>
    </div>
  `,
})
export class WorkflowsOpsPageComponent implements OnInit {
  private readonly api = inject(WorkflowsOpsApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly formatDateTime = formatDateTime;
  readonly alertsPageSize = ALERTS_PAGE_SIZE;

  readonly metrics = signal<WorkflowOpsMetrics | null>(null);
  readonly alerts = signal<WorkflowOpsAlert[]>([]);
  readonly alertsPage = signal(1);
  readonly alertsTotal = signal(0);
  readonly alertsTotalPages = signal(1);
  readonly loading = signal(false);
  readonly loadFailed = signal(false);

  readonly cards = computed(() => {
    const m = this.metrics();
    const o = m?.outbox;
    const w = m?.webhooks;
    return [
      {
        title: 'Pendientes',
        value: o ? o.pending : '—',
        small: o ? `${o.backlog_due} vencidas ahora` : undefined,
        icon: 'inbox',
        iconBg: 'bg-blue-100',
        iconColor: 'text-blue-500',
      },
      {
        title: 'En proceso',
        value: o ? o.processing : '—',
        small: o ? `${o.stuck_processing} atascadas` : undefined,
        icon: 'loader',
        iconBg: 'bg-indigo-100',
        iconColor: 'text-indigo-500',
      },
      {
        title: 'Atraso del más viejo',
        value: !o ? '—' : o.oldest_due_age_seconds === null ? 'Sin atraso' : formatDuration(o.oldest_due_age_seconds),
        small: 'Tarea vencida más antigua',
        icon: 'hourglass',
        iconBg: 'bg-amber-100',
        iconColor: 'text-amber-500',
      },
      {
        title: 'Latencia p50 / p95',
        value: o ? `${formatLatency(o.latency_1h.p50_seconds)} / ${formatLatency(o.latency_1h.p95_seconds)}` : '—',
        small: o ? `${o.latency_1h.samples} tareas en la última hora` : undefined,
        icon: 'timer',
        iconBg: 'bg-purple-100',
        iconColor: 'text-purple-500',
      },
      {
        title: 'Fallidos 1 h / 24 h',
        value: o ? `${o.dead_1h} / ${o.dead_24h}` : '—',
        small: 'Tareas que agotaron reintentos',
        icon: 'alert-triangle',
        iconBg: 'bg-red-100',
        iconColor: 'text-red-500',
      },
      {
        title: 'Éxito de webhooks',
        value: w ? formatPercent(w.success_rate_24h) : '—',
        small: w ? `Últimas 24 h · ${w.dead_total} agotados` : undefined,
        icon: 'webhook',
        iconBg: 'bg-emerald-100',
        iconColor: 'text-emerald-500',
      },
      {
        title: 'Entradas aceptadas / rechazadas',
        value: m ? `${m.inbound.accepted_24h} / ${m.inbound.rejected_24h}` : '—',
        small: 'Formularios y webhooks de entrada, 24 h',
        icon: 'activity',
        iconBg: 'bg-gray-100',
        iconColor: 'text-gray-500',
      },
    ];
  });

  readonly cycleStalled = computed(() => {
    const d = this.metrics()?.dispatcher;
    return !!d && d.age_seconds > STALLED_CYCLE_SECONDS;
  });

  readonly cycleText = computed(() => {
    const m = this.metrics();
    if (!m) return null;
    const d = m.dispatcher;
    if (!d) return 'Sin registro de ciclos: el despachador no ha reportado actividad.';
    return (
      `Hace ${formatDuration(d.age_seconds)} (${formatDateTime(d.at)}): ` +
      `${d.processed} tareas en ${d.batches} tanda(s), ${formatLatency(d.duration_ms / 1000)} de duración.`
    );
  });

  readonly storeColumns: TableColumn[] = [
    { key: 'store_name', label: 'Tienda', priority: 1 },
    { key: 'count', label: 'Tareas', priority: 1, align: 'right' },
  ];
  readonly storeCardConfig: ItemListCardConfig = {
    titleKey: 'store_name',
    detailKeys: [{ key: 'count', label: 'Tareas' }],
  };

  readonly deadColumns: TableColumn[] = [
    { key: 'processed_at', label: 'Fecha', priority: 1, transform: (v: string | null) => formatDateTime(v) },
    { key: 'store_name', label: 'Tienda', priority: 1 },
    { key: 'kind', label: 'Tipo', priority: 2, transform: (v: string) => outboxKindLabel(v) },
    { key: 'attempts', label: 'Intentos', priority: 3, align: 'right' },
    { key: 'last_error', label: 'Último error', priority: 2, transform: (v: string | null) => v ?? '—' },
  ];
  readonly deadCardConfig: ItemListCardConfig = {
    titleKey: 'store_name',
    subtitleTransform: (item: { kind: string }) => outboxKindLabel(item.kind),
    detailKeys: [
      { key: 'processed_at', label: 'Fecha', transform: (v: string | null) => formatDateTime(v) },
      { key: 'attempts', label: 'Intentos' },
      { key: 'last_error', label: 'Último error', transform: (v: string | null) => v ?? '—' },
    ],
  };

  readonly alertColumns: TableColumn[] = [
    { key: 'created_at', label: 'Fecha', priority: 1, transform: (v: string) => formatDateTime(v) },
    { key: 'rule', label: 'Regla', priority: 1, transform: (v: string) => RULE_LABELS[v] ?? v },
    { key: 'severity', label: 'Gravedad', priority: 2, transform: (v: string) => SEVERITY_LABELS[v] ?? v },
    { key: 'title', label: 'Alerta', priority: 2 },
    { key: 'recipients', label: 'Correos enviados', priority: 3, align: 'right' },
  ];
  readonly alertCardConfig: ItemListCardConfig = {
    titleKey: 'title',
    subtitleKey: 'rule',
    subtitleTransform: (item: WorkflowOpsAlert) => RULE_LABELS[item.rule] ?? item.rule,
    badgeKey: 'severity',
    badgeTransform: (v: string) => SEVERITY_LABELS[v] ?? v,
    detailKeys: [
      { key: 'created_at', label: 'Fecha', transform: (v: string) => formatDateTime(v) },
      { key: 'recipients', label: 'Correos enviados' },
    ],
  };

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.load(1);
  }

  goToAlertsPage(page: number): void {
    this.load(page);
  }

  private load(alertsPage: number): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    forkJoin({
      metrics: this.api.getMetrics(),
      alerts: this.api.getAlerts(alertsPage, ALERTS_PAGE_SIZE),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ metrics, alerts }) => {
          this.metrics.set(metrics);
          this.alerts.set(alerts.alerts);
          this.alertsPage.set(alerts.page);
          this.alertsTotal.set(alerts.total);
          this.alertsTotalPages.set(alerts.totalPages);
          this.loading.set(false);
        },
        error: () => {
          this.loadFailed.set(true);
          this.loading.set(false);
          this.toast.error('No se pudo cargar la operación de Flujos');
        },
      });
  }
}
