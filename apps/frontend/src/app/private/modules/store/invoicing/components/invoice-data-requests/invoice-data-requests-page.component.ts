import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import {
  CardComponent,
  IconComponent,
  InputsearchComponent,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  type ItemListCardConfig,
  type TableAction,
  type TableColumn,
  type DropdownAction,
  type FilterConfig,
  type FilterValues,
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
 * Colores de estado desde tokens del tema: `colorMap` acepta valores CSS.
 */
const STATUS_COLORS: Record<InvoiceDataRequestStatus, string> = {
  pending: 'var(--color-text-secondary)',
  submitted: 'var(--color-warning)',
  processing: 'var(--color-primary)',
  completed: 'var(--color-success)',
  expired: 'var(--color-text-secondary)',
  failed: 'var(--color-error)',
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
 * ## Resumen y filtros
 *
 * Las cuatro tarjetas son un resumen global, no controles interactivos. El
 * filtro por estado vive en el dropdown de opciones y admite los seis estados.
 * Su conteo NO sigue el filtro activo (`summaryByStore` lo ignora a propósito).
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
    FormsModule,
    IconComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
  ],
  template: `
    <div class="w-full">
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Solicitudes"
          [value]="summaryError() ? '—' : summary().total"
          smallText="Facturas pedidas por clientes"
          iconName="file-text"
          iconBgColor="bg-primary/10"
          iconColor="text-primary"
          [loading]="summaryLoading()"
        />
        <app-stats
          title="Sin procesar"
          [value]="summaryError() ? '—' : summary().submitted"
          smallText="Datos recibidos, pendientes de procesar"
          iconName="clock"
          iconBgColor="bg-warning/10"
          iconColor="text-warning"
          [loading]="summaryLoading()"
        />
        <app-stats
          title="Fallidas"
          [value]="summaryError() ? '—' : summary().failed"
          smallText="Requieren revisión de la conversión"
          iconName="alert-circle"
          iconBgColor="bg-error/10"
          iconColor="text-error"
          [loading]="summaryLoading()"
        />
        <app-stats
          title="Facturadas"
          [value]="summaryError() ? '—' : summary().completed"
          smallText="Nominativa ya emitida"
          iconName="check-circle"
          iconBgColor="bg-success/10"
          iconColor="text-success"
          [loading]="summaryLoading()"
        />
      </div>
      @if (summaryError()) {
        <p role="status" class="px-2 pb-2 text-sm text-text-secondary">
          No se pudo cargar el resumen. Selecciona Actualizar en el menú de opciones para reintentar.
        </p>
      }

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                 md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-text-secondary tracking-wide
                     md:text-lg md:font-semibold md:text-text-primary"
            >
              Solicitudes de factura ({{ totalItems() }})
            </h2>

            <div class="flex flex-wrap items-center gap-2 w-full min-w-0 md:w-auto">
              <app-inputsearch
                class="min-w-0 flex-1 basis-40 md:w-72 shadow-none rounded-[10px]"
                placeholder="Orden, nombre, documento o correo"
                ariaLabel="Buscar solicitudes de factura"
                [ngModel]="searchValue()"
                (ngModelChange)="searchValue.set($event)"
                (search)="onSearch($event)"
                (clear)="onSearch('')"
              ></app-inputsearch>
              <app-options-dropdown
                class="shrink-0"
                [filters]="filterConfigs"
                [filterValues]="filterValues()"
                [actions]="dropdownActions"
                [isLoading]="loading()"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="clearFilters()"
                (actionClick)="onActionClick($event)"
              ></app-options-dropdown>
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4 space-y-3">
          @if (error(); as message) {
            <div
              role="alert"
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
            [showEmptyClearFilters]="!error() && hasActiveFilters()"
            [showEmptyRefresh]="!!error() || !hasActiveFilters()"
            (emptyClearFiltersClick)="clearFilters()"
            (emptyRefreshClick)="reload()"
            rowLabelKey="order_id"
            [sortable]="false"
          ></app-responsive-data-view>

          <app-pagination
            [currentPage]="filters().page"
            [totalPages]="totalPages()"
            [total]="totalItems()"
            [limit]="filters().limit"
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
  private listSubscription?: Subscription;
  private summarySubscription?: Subscription;

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      placeholder: 'Todos los estados',
      options: [
        { label: 'Todos', value: '' },
        ...STATUS_FILTER_ORDER.map((status) => ({
          label: STATUS_LABELS[status],
          value: status,
        })),
      ],
    },
  ];
  readonly dropdownActions: DropdownAction[] = [
    { label: 'Actualizar', icon: 'refresh-cw', action: 'reload' },
  ];

  // ── Estado ─────────────────────────────────────────────
  readonly rows = signal<InvoiceDataRequestRow[]>([]);
  readonly loading = signal(false);
  readonly summaryLoading = signal(false);
  readonly summaryError = signal(false);
  readonly error = signal<string | null>(null);
  readonly summary = signal<InvoiceDataRequestSummary>(EMPTY_SUMMARY);

  readonly statusFilter = signal<InvoiceDataRequestStatus | ''>('');
  readonly search = signal('');
  readonly searchValue = signal('');
  readonly filters = signal({ page: 1, limit: 10 });
  readonly totalItems = signal(0);
  readonly filterValues = computed<FilterValues>(() => ({
    status: this.statusFilter() || null,
  }));
  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalItems() / this.filters().limit)),
  );

  readonly hasActiveFilters = computed(
    () => this.statusFilter() !== '' || this.search().trim() !== '',
  );

  /**
   * Id en curso, NO un booleano: permite señalar la fila actualmente atendida
   * y bloquear el resto para evitar POST simultáneos.
   */
  readonly processingId = signal<number | null>(null);

  constructor() {
    this.load();
    this.loadSummary();
  }

  // ── Carga ──────────────────────────────────────────────
  load(): void {
    this.listSubscription?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.listSubscription = this.service
      .list({
        status: this.statusFilter(),
        search: this.search(),
        page: this.filters().page,
        limit: this.filters().limit,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.rows.set(response?.data ?? []);
          this.totalItems.set(response?.meta?.total ?? 0);
          if (this.filters().page > this.totalPages()) {
            this.filters.update((current) => ({ ...current, page: this.totalPages() }));
            this.load();
            return;
          }
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
          this.totalItems.set(0);
          this.loading.set(false);
        },
      });
  }

  /** Carga el resumen; un error se representa como no disponible, no como cero. */
  private loadSummary(): void {
    this.summarySubscription?.unsubscribe();
    this.summaryLoading.set(true);
    this.summaryError.set(false);
    this.summarySubscription = this.service
      .summary(this.search())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.summary.set(response?.data ?? EMPTY_SUMMARY);
          this.summaryLoading.set(false);
        },
        error: () => {
          this.summary.set(EMPTY_SUMMARY);
          this.summaryError.set(true);
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
  onFilterChange(values: FilterValues): void {
    const selected = values['status'];
    const status = !selected
      ? ''
      : STATUS_FILTER_ORDER.find((candidate) => candidate === selected) ?? '';
    if (this.statusFilter() === status) return;
    this.statusFilter.set(status);
    this.filters.update((current) => ({ ...current, page: 1 }));
    this.load();
  }

  onActionClick(action: string): void {
    if (action === 'reload') this.reload();
  }

  /**
   * El término de búsqueda SÍ recarga el resumen: acota el universo, no elige
   * una rebanada de él, así que los contadores deben hablar del mismo universo
   * que la tabla.
   */
  onSearch(term: string): void {
    if (term !== this.searchValue()) return;
    if (this.search() === term) {
      return;
    }
    this.search.set(term);
    this.filters.update((filters) => ({ ...filters, page: 1 }));
    this.load();
    this.loadSummary();
  }

  clearFilters(): void {
    this.statusFilter.set('');
    this.search.set('');
    this.searchValue.set('');
    this.filters.update((filters) => ({ ...filters, page: 1 }));
    this.reload();
  }

  onPageChange(page: number): void {
    if (!Number.isInteger(page) || page < 1 || page > this.totalPages()) return;
    this.filters.update((filters) => ({ ...filters, page }));
    this.load();
  }

  // ── Acción ─────────────────────────────────────────────
  /**
   * `data: null` con 200 NO es éxito: significa que otro trabajador —el listener
   * automático, u otra pestaña abierta— ya reclamó la solicitud. Cantar «factura
   * emitida» ahí sería afirmar un documento que este clic no creó.
   */
  process(row: InvoiceDataRequestRow): void {
    if (row.status !== 'submitted' || this.processingId() !== null) {
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

  emptyTitle(): string {
    if (this.error()) return 'No se pudo cargar el listado';
    return this.hasActiveFilters()
      ? 'Ninguna solicitud coincide'
      : 'Todavía no hay solicitudes';
  }

  emptyDescription(): string {
    if (this.error()) return 'Actualiza para reintentar. No se pudo comprobar si hay registros.';
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
      transform: (value) =>
        STATUS_LABELS[value as InvoiceDataRequestStatus] ?? String(value ?? '—'),
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
        key: 'created_at',
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
      label: (item) =>
        this.processingId() === item?.id ? 'Procesando…' : 'Procesar ahora',
      icon: 'play',
      variant: 'primary',
      tooltip:
        'Emite la factura a nombre del cliente con los datos que ya envió.',
      show: (item) => item?.status === 'submitted',
      disabled: () => this.processingId() !== null,
      action: (item) => this.process(item),
    },
  ];
}
