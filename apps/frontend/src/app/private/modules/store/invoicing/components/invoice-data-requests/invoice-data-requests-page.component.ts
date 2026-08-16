import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  CardComponent,
  IconComponent,
  InputsearchComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  type ItemListCardConfig,
  type TableAction,
  type TableColumn,
} from '../../../../../../shared/components/index';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';

import { InvoiceDataRequestService } from '../../services/invoice-data-request.service';
import type {
  InvoiceDataRequestRow,
  InvoiceDataRequestStatus,
  InvoiceDataRequestSummary,
} from '../../interfaces/invoice-data-request.interface';
import { describeApiFailure } from '../../utils/invoicing-errors.util';

/**
 * Un identificador en MAYÚSCULAS_CON_GUIONES no es un mensaje.
 *
 * El backend ya devuelve `INVOICING_DATA_REQUEST_00x` tipados con su copy en
 * español, así que la fuga original está cerrada en su origen. Esta guarda se
 * conserva porque cuesta una expresión regular y cubre cualquier ruta futura
 * que vuelva a lanzar una excepción de Nest con el nombre de una constante
 * dentro: al comerciante nunca debe aparecerle el identificador crudo.
 */
function humanize(message: string, fallback: string): string {
  const looksLikeCode = /^[A-Z0-9_]{6,}$/.test(message.trim());
  return !message.trim() || looksLikeCode ? fallback : message;
}

/**
 * Fecha Y HORA, en la zona del navegador.
 *
 * `submitted_at` / `processed_at` son instantes reales (`timestamptz`), no
 * fechas de calendario: `formatDateOnlyUTC` —que es lo que usan los listados de
 * documentos— los mostraría en UTC y correría un día las solicitudes de la
 * noche. La hora importa acá porque el comerciante compara contra el momento de
 * la venta.
 *
 * `hourCycle: 'h23'` NO es decorativo: con el `hour12: false` a secas, ICU
 * imprime la medianoche como «24:05» en varios locales.
 */
function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/** Copy en español de `invoice_data_request_status_enum`. */
const STATUS_LABELS: Record<InvoiceDataRequestStatus, string> = {
  pending: 'Enlace enviado, sin datos',
  submitted: 'Datos recibidos, sin procesar',
  processing: 'Procesando',
  completed: 'Factura emitida',
  expired: 'Enlace vencido',
  failed: 'Falló la conversión',
};

/**
 * Colores del badge de estado.
 *
 * Hex de 7 caracteres, no tokens ni utilidades de Tailwind: el `colorMap` de
 * `TableColumn.badgeConfig` los inyecta como color literal y una clase suelta
 * ahí no se resuelve. Es la misma tabla que usan los demás listados del panel.
 */
const STATUS_COLORS: Record<InvoiceDataRequestStatus, string> = {
  pending: '#6b7280',
  submitted: '#d97706',
  processing: '#2563eb',
  completed: '#059669',
  expired: '#9ca3af',
  failed: '#dc2626',
};

/** Estados que el comerciante puede elegir, en el orden en que le importan. */
const STATUS_FILTER_ORDER: InvoiceDataRequestStatus[] = [
  'submitted',
  'failed',
  'pending',
  'processing',
  'completed',
  'expired',
];

const EMPTY_SUMMARY: InvoiceDataRequestSummary = {
  pending: 0,
  submitted: 0,
  processing: 0,
  completed: 0,
  expired: 0,
  failed: 0,
  total: 0,
};

/**
 * SOLICITUDES DE FACTURA A NOMBRE DEL CLIENTE.
 *
 * `GET /store/invoice-data-requests` y `POST :id/process` estaban completos en el
 * backend y NO TENÍAN UN SOLO CLIENTE. El listener automático convierte la venta
 * CF en factura nominativa apenas el cliente manda sus datos, y cuando esa
 * conversión falla deja la fila en `failed` con un log que dice «use the admin
 * process endpoint to retry». Ese reintento era imposible desde el producto: no
 * había pantalla que listara las solicitudes ni botón que las reprocesara. Un
 * cliente que pidió su factura y cuya conversión reventó quedaba esperando en
 * silencio, sin que nadie en la tienda pudiera enterarse.
 *
 * ## Por qué las tarjetas son el filtro
 *
 * La pestaña se abre para atender DOS estados —`submitted` (esperando el
 * empujón) y `failed` (reventó)—; los otros cuatro son historia. Las tarjetas
 * dicen cuántas hay de cada uno y filtran al tocarlas, así que el trabajo del
 * día se ve y se acota sin abrir el selector. Su conteo NO sigue el filtro
 * activo (`summaryByStore` lo ignora a propósito): si lo siguiera, al entrar a
 * «Falló la conversión» las demás caerían a cero y dejarían de servir para
 * navegar.
 *
 * ## Por qué la acción sólo aparece en `submitted`
 *
 * `processRequest` reclama la fila con un compare-and-swap sobre
 * `status: 'submitted'`. Sobre cualquier otro estado el POST responde 200 con
 * `data: null` y no hace nada. Ofrecer el botón ahí sería ofrecer un no-op que
 * parece un reintento. En `failed` se explica en su lugar de dónde se sale, que
 * es lo que el comerciante necesita saber.
 */
@Component({
  selector: 'app-invoice-data-requests-page',
  standalone: true,
  imports: [
    CardComponent,
    IconComponent,
    InputsearchComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
  ],
  template: `
    <div class="w-full">
      <!--
        Cuatro tarjetas, no seis: el bloque estándar es de cuatro columnas y los
        dos estados de baja consulta (procesando y vencido) viven sólo en las
        píldoras. Las cuatro elegidas son las accionables más el total.
        NINGÚN acento grave dentro de este literal de plantilla: uno solo cierra
        la cadena e invierte la paridad del archivo entero.
      -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Solicitudes"
          [value]="summary().total"
          smallText="Facturas pedidas por clientes"
          iconName="file-text"
          iconBgColor="bg-primary/10"
          iconColor="text-primary"
          [loading]="summaryLoading()"
          [clickable]="true"
          role="button"
          tabindex="0"
          [attr.aria-pressed]="statusFilter() === ''"
          (click)="filterByStatus('')"
          (keydown.enter)="filterByStatus('')"
        />
        <app-stats
          title="Sin procesar"
          [value]="summary().submitted"
          smallText="Esperan el reintento manual"
          iconName="clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
          [loading]="summaryLoading()"
          [clickable]="true"
          role="button"
          tabindex="0"
          [attr.aria-pressed]="statusFilter() === 'submitted'"
          (click)="filterByStatus('submitted')"
          (keydown.enter)="filterByStatus('submitted')"
        />
        <app-stats
          title="Fallidas"
          [value]="summary().failed"
          smallText="La conversión automática reventó"
          iconName="alert-circle"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
          [loading]="summaryLoading()"
          [clickable]="true"
          role="button"
          tabindex="0"
          [attr.aria-pressed]="statusFilter() === 'failed'"
          (click)="filterByStatus('failed')"
          (keydown.enter)="filterByStatus('failed')"
        />
        <app-stats
          title="Facturadas"
          [value]="summary().completed"
          smallText="Nominativa ya emitida"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-600"
          [loading]="summaryLoading()"
          [clickable]="true"
          role="button"
          tabindex="0"
          [attr.aria-pressed]="statusFilter() === 'completed'"
          (click)="filterByStatus('completed')"
          (keydown.enter)="filterByStatus('completed')"
        />
      </div>

      <app-card [responsive]="true" [padding]="false">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                 md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide
                     md:text-lg md:font-semibold md:text-text-primary"
            >
              Solicitudes de factura ({{ total() }})
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-72 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                placeholder="Orden, nombre, documento o correo"
                (search)="onSearch($event)"
              ></app-inputsearch>

              <button
                type="button"
                class="shrink-0 h-10 w-10 flex items-center justify-center rounded-[10px]
                       border border-border bg-[var(--color-surface)] text-text-secondary
                       transition-colors hover:text-text-primary hover:border-primary/40
                       disabled:opacity-50 disabled:cursor-not-allowed"
                [disabled]="loading()"
                aria-label="Actualizar solicitudes"
                (click)="reload()"
              >
                <app-icon
                  name="refresh-cw"
                  [size]="16"
                  [class]="loading() ? 'animate-spin' : ''"
                ></app-icon>
              </button>
            </div>
          </div>

          <!--
            Píldoras de estado en vez de un desplegable: son seis valores fijos
            y conocidos, y verlos todos a la vez con su conteo y el activo
            resaltado ahorra el clic de abrir un selector para descubrir qué
            hay. El filtro por tarjeta y el de píldora escriben la misma señal.
          -->
          <div class="flex flex-wrap gap-1.5 mt-2 md:mt-3">
            <button
              type="button"
              class="px-2.5 py-1 text-xs font-medium rounded-full border transition-colors"
              [class]="pillClass('')"
              (click)="filterByStatus('')"
            >
              Todos
            </button>
            @for (status of statusOrder; track status) {
              <button
                type="button"
                class="px-2.5 py-1 text-xs font-medium rounded-full border transition-colors"
                [class]="pillClass(status)"
                (click)="filterByStatus(status)"
              >
                {{ statusLabel(status) }}
                <span class="opacity-60">· {{ summary()[status] }}</span>
              </button>
            }
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4 space-y-3">
          @if (error(); as message) {
            <div
              class="flex items-start gap-2 p-3 rounded-lg border border-error/30 bg-error-light"
            >
              <app-icon
                name="alert-circle"
                [size]="16"
                class="text-error shrink-0 mt-0.5"
              ></app-icon>
              <p class="text-sm text-error">{{ message }}</p>
            </div>
          }

          <app-responsive-data-view
            [data]="rows()"
            [columns]="columns"
            [cardConfig]="cardConfig"
            [actions]="tableActions"
            [loading]="loading()"
            emptyIcon="file-text"
            [emptyTitle]="emptyTitle()"
            [emptyDescription]="emptyDescription()"
            [showEmptyClearFilters]="hasActiveFilters()"
            [showEmptyRefresh]="!hasActiveFilters()"
            (emptyClearFiltersClick)="clearFilters()"
            (emptyRefreshClick)="reload()"
          ></app-responsive-data-view>

          <app-pagination
            [currentPage]="page()"
            [totalPages]="totalPages()"
            [total]="total()"
            [limit]="limit()"
            (pageChange)="onPageChange($event)"
          ></app-pagination>
        </div>
      </app-card>
    </div>
  `,
})
export class InvoiceDataRequestsPageComponent {
  private readonly service = inject(InvoiceDataRequestService);
  private readonly toast = inject(ToastService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly statusOrder = STATUS_FILTER_ORDER;

  // ── Estado ─────────────────────────────────────────────
  readonly rows = signal<InvoiceDataRequestRow[]>([]);
  readonly loading = signal(false);
  readonly summaryLoading = signal(false);
  readonly error = signal<string | null>(null);
  readonly summary = signal<InvoiceDataRequestSummary>(EMPTY_SUMMARY);

  readonly statusFilter = signal<InvoiceDataRequestStatus | ''>('');
  readonly search = signal('');
  readonly page = signal(1);
  readonly limit = signal(10);
  readonly total = signal(0);
  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.limit())),
  );

  readonly hasActiveFilters = computed(
    () => this.statusFilter() !== '' || this.search().trim() !== '',
  );

  /**
   * Id en curso, NO un booleano: con un booleano compartido las acciones de
   * todas las filas se apagan igual y el comerciante no sabe cuál solicitud
   * está corriendo.
   */
  readonly processingId = signal<number | null>(null);

  constructor() {
    this.load();
    this.loadSummary();
  }

  // ── Carga ──────────────────────────────────────────────
  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .list({
        status: this.statusFilter(),
        search: this.search(),
        page: this.page(),
        limit: this.limit(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.rows.set(response?.data ?? []);
          this.total.set(response?.meta?.total ?? 0);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(
            humanize(
              describeApiFailure(err).message,
              'No se pudieron cargar las solicitudes de factura.',
            ),
          );
          this.rows.set([]);
          this.total.set(0);
          this.loading.set(false);
        },
      });
  }

  /**
   * El resumen falla en SILENCIO a propósito.
   *
   * Son cuatro contadores decorativos sobre un listado que ya cargó: pintar un
   * segundo banner de error por ellos taparía el del listado, que es el que
   * importa. Quedan en cero, que es visiblemente distinto de un número.
   */
  private loadSummary(): void {
    this.summaryLoading.set(true);
    this.service
      .summary(this.search())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.summary.set(response?.data ?? EMPTY_SUMMARY);
          this.summaryLoading.set(false);
        },
        error: () => {
          this.summary.set(EMPTY_SUMMARY);
          this.summaryLoading.set(false);
        },
      });
  }

  /** Refresco explícito: listado y contadores vuelven a pedirse juntos. */
  reload(): void {
    this.load();
    this.loadSummary();
  }

  // ── Filtros ────────────────────────────────────────────
  filterByStatus(status: InvoiceDataRequestStatus | ''): void {
    if (this.statusFilter() === status) {
      return;
    }
    this.statusFilter.set(status);
    this.page.set(1);
    this.load();
  }

  /**
   * El término de búsqueda SÍ recarga el resumen: acota el universo, no elige
   * una rebanada de él, así que los contadores deben hablar del mismo universo
   * que la tabla.
   */
  onSearch(term: string): void {
    if (this.search() === term) {
      return;
    }
    this.search.set(term);
    this.page.set(1);
    this.load();
    this.loadSummary();
  }

  clearFilters(): void {
    this.statusFilter.set('');
    this.search.set('');
    this.page.set(1);
    this.reload();
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  // ── Acción ─────────────────────────────────────────────
  /**
   * `data: null` con 200 NO es éxito: significa que otro trabajador —el listener
   * automático, u otra pestaña abierta— ya reclamó la solicitud. Cantar «factura
   * emitida» ahí sería afirmar un documento que este clic no creó.
   */
  process(row: InvoiceDataRequestRow): void {
    if (this.processingId() !== null) {
      return;
    }
    this.processingId.set(row.id);
    this.service
      .process(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.processingId.set(null);
          if (response?.data) {
            this.toast.success(
              'Solicitud procesada: se emitió la factura a nombre del cliente.',
            );
          } else {
            this.toast.warning(
              'Otro proceso ya estaba atendiendo esta solicitud. Se actualizó la lista.',
            );
          }
          this.reload();
        },
        error: (err: unknown) => {
          this.processingId.set(null);
          this.toast.error(
            humanize(
              describeApiFailure(err).message,
              'No se pudo procesar la solicitud.',
            ),
          );
        },
      });
  }

  // ── Presentación ───────────────────────────────────────
  statusLabel(status: InvoiceDataRequestStatus): string {
    return STATUS_LABELS[status] ?? status;
  }

  pillClass(status: InvoiceDataRequestStatus | ''): string {
    return this.statusFilter() === status
      ? 'bg-primary text-[var(--color-text-on-primary)] border-primary'
      : 'bg-[var(--color-surface)] text-text-secondary border-border hover:border-primary/40 hover:text-text-primary';
  }

  emptyTitle(): string {
    return this.hasActiveFilters()
      ? 'Ninguna solicitud coincide'
      : 'Todavía no hay solicitudes';
  }

  emptyDescription(): string {
    return this.hasActiveFilters()
      ? 'Prueba con otro estado o limpia la búsqueda.'
      : 'Cuando un cliente pida su factura a nombre propio después de una venta a consumidor final, la solicitud aparece acá.';
  }

  private money(value: string | number | null | undefined): string {
    return this.currency.format(Number(value ?? 0));
  }

  /**
   * Identidad del solicitante. `pending` significa que el enlace se envió y el
   * cliente todavía no escribió nada, así que los campos llegan vacíos: decirlo
   * es más honesto que pintar una línea en blanco.
   */
  customerLine(row: InvoiceDataRequestRow): string {
    const name = [row.first_name, row.last_name]
      .filter((part) => part && part.trim())
      .join(' ')
      .trim();
    const document = row.document_number
      ? `${row.document_type ? row.document_type + ' ' : ''}${row.document_number}`
      : '';
    const parts = [name, document].filter((part) => part && part.trim());
    return parts.length ? parts.join(' · ') : 'Sin datos del cliente todavía';
  }

  /**
   * Columnas del listado.
   *
   * ⚠️ `key` NO ES DECORATIVO CUANDO HAY `transform`. `app-table` sólo llama a
   * `transform` si `getNestedValue(item, key)` no es `null`, `undefined` ni `''`
   * — si el valor está vacío pinta `defaultValue` y la función nunca corre. Por
   * eso las columnas sintéticas (Orden, Cliente, Solicitada) apuntan a un campo
   * que SIEMPRE viene con valor (`order_id`, `id`, `created_at`) y componen el
   * texto desde `item`, en vez de apuntar al campo que muestran: `order_number`
   * es nulo en las órdenes sin numerar y `submitted_at` lo es en toda solicitud
   * que el cliente aún no ha contestado, que son justo las filas que interesan.
   */
  readonly columns: TableColumn[] = [
    {
      key: 'order_id',
      label: 'Orden',
      priority: 0,
      transform: (_value, item) =>
        item?.order?.order_number || `Orden #${item?.order_id}`,
    },
    {
      key: 'id',
      label: 'Cliente',
      priority: 1,
      transform: (_value, item) => this.customerLine(item),
    },
    {
      key: 'email',
      label: 'Correo',
      priority: 3,
      defaultValue: '—',
    },
    {
      key: 'order.grand_total',
      label: 'Total',
      align: 'right',
      priority: 2,
      defaultValue: '—',
      transform: (value) => this.money(value),
    },
    {
      key: 'created_at',
      label: 'Solicitada',
      priority: 2,
      transform: (_value, item) =>
        formatDateTime(item?.submitted_at || item?.created_at),
    },
    {
      key: 'status',
      label: 'Estado',
      priority: 0,
      badge: true,
      badgeConfig: { type: 'custom', colorMap: STATUS_COLORS },
      badgeTransform: (value) =>
        STATUS_LABELS[value as InvoiceDataRequestStatus] ?? String(value ?? '—'),
    },
    {
      key: 'new_invoice_id',
      label: 'Factura emitida',
      priority: 4,
      transform: (value) => (value ? `#${value}` : '—'),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'order_number',
    titleTransform: (item) =>
      item?.order?.order_number || `Orden #${item?.order_id}`,
    subtitleKey: 'customer',
    subtitleTransform: (item) => this.customerLine(item),
    avatarFallbackIcon: 'file-text',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: { type: 'custom', colorMap: STATUS_COLORS },
    badgeTransform: (value) =>
      STATUS_LABELS[value as InvoiceDataRequestStatus] ?? String(value ?? '—'),
    detailKeys: [
      {
        key: 'submitted_at',
        label: 'Solicitada',
        icon: 'calendar',
        transform: (_value, item) =>
          formatDateTime(item?.submitted_at || item?.created_at),
      },
      {
        key: 'processed_at',
        label: 'Procesada',
        icon: 'check-circle',
        transform: (value) => (value ? formatDateTime(value) : '—'),
      },
      {
        key: 'email',
        label: 'Correo',
        icon: 'mail',
        transform: (value) => value || '—',
      },
      {
        key: 'new_invoice_id',
        label: 'Factura emitida',
        icon: 'file-text',
        transform: (value) => (value ? `#${value}` : '—'),
      },
    ],
    footerKey: 'order.grand_total',
    footerLabel: 'Total de la venta',
    footerStyle: 'prominent',
    footerTransform: (_value, item) =>
      item?.order?.grand_total != null ? this.money(item.order.grand_total) : '—',
  };

  /**
   * Una sola acción, y sólo donde hace algo.
   *
   * `show` la esconde fuera de `submitted` porque el backend responde 200 sin
   * hacer nada sobre cualquier otro estado, y `disabled` la apaga mientras otra
   * fila corre para que dos POST no salgan a competir por el mismo
   * compare-and-swap.
   */
  readonly tableActions: TableAction[] = [
    {
      label: 'Procesar ahora',
      icon: 'play',
      variant: 'primary',
      tooltip:
        'Emite la factura a nombre del cliente con los datos que ya envió.',
      show: (item) => item?.status === 'submitted',
      disabled: (item) =>
        this.processingId() !== null && this.processingId() !== item?.id,
      action: (item) => this.process(item),
    },
  ];
}
