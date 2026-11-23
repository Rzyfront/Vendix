import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, timer } from 'rxjs';

import { BulkUploadLogService } from '../services/bulk-upload-log.service';
import {
  BULK_UPLOAD_STATUS_LABELS,
  BULK_UPLOAD_TYPE_LABELS,
  BulkUploadLog,
  BulkUploadLogQuery,
  BulkUploadStatus,
  BulkUploadType,
} from '../bulk-upload-log.interface';
import { CardComponent } from '../../../../../shared/components/card/card.component';
import {
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  TableColumn,
} from '../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { OptionsDropdownComponent } from '../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  FilterConfig,
  FilterValues,
} from '../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { PaginationComponent } from '../../../../../shared/components/pagination/pagination.component';
import { StickyHeaderComponent } from '../../../../../shared/components/sticky-header/sticky-header.component';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { formatStoreDateTime } from '../../../../../shared/utils/date.util';

const PAGE_LIMIT = 20;

/** Mientras haya cargas en cola o en curso, la lista se refresca sola. */
const ACTIVE_REFRESH_MS = 10_000;

const STATUS_COLORS: Record<BulkUploadStatus, string> = {
  queued: '#94a3b8',
  running: '#3b82f6',
  completed: '#22c55e',
  partial: '#eab308',
  failed: '#ef4444',
};

/**
 * QUI-1004 — read-only consolidated history of bulk uploads for the current
 * store (the backend scopes by store from the request context).
 */
@Component({
  selector: 'app-bulk-upload-history-page',
  standalone: true,
  imports: [
    StickyHeaderComponent,
    CardComponent,
    ResponsiveDataViewComponent,
    OptionsDropdownComponent,
    PaginationComponent,
  ],
  template: `
    <div class="w-full">
      <app-sticky-header
        title="Historial de cargas masivas"
        subtitle="Qué entró y qué no en tus cargas de archivos"
        icon="history"
      ></app-sticky-header>

      <app-card [responsive]="true" [padding]="false" class="mt-4">
        <div
          class="px-2 py-1.5 md:px-6 md:py-4 md:border-b md:border-border flex items-center justify-between gap-2"
        >
          <h2
            class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
          >
            Cargas ({{ totalItems() }})
          </h2>
          <app-options-dropdown
            class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
            [filters]="filterConfigs"
            [filterValues]="filterValues()"
            (filterChange)="onFilterChange($event)"
          ></app-options-dropdown>
        </div>

        @if (hasActiveUploads()) {
          <div class="mx-2 mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-700 md:mx-4">
            Hay cargas en curso en el servidor; esta lista se actualiza sola.
          </div>
        }

        @if (listError()) {
          <div class="mx-2 mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 md:mx-4">
            {{ listError() }}
          </div>
        }

        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="uploads()"
            [columns]="columns"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            emptyMessage="Aún no hay cargas masivas registradas"
            emptyIcon="history"
          ></app-responsive-data-view>
          <app-pagination
            [currentPage]="currentPage()"
            [totalPages]="totalPages()"
            [total]="totalItems()"
            [limit]="limit"
            (pageChange)="onPageChange($event)"
          ></app-pagination>
        </div>
      </app-card>
    </div>
  `,
  styles: [`:host { display: block; width: 100%; }`],
})
export class BulkUploadHistoryPageComponent {
  private readonly logService = inject(BulkUploadLogService);
  private readonly destroyRef = inject(DestroyRef);
  private refreshSub: Subscription | null = null;
  /** Hay filas en cola o en curso: la lista se actualiza sola. */
  readonly hasActiveUploads = signal(false);
  private readonly settingsFacade = inject(StoreSettingsFacade);

  readonly limit = PAGE_LIMIT;
  readonly uploads = signal<BulkUploadLog[]>([]);
  readonly loading = signal(false);
  readonly listError = signal<string | null>(null);
  readonly totalItems = signal(0);
  readonly currentPage = signal(1);
  readonly totalPages = computed(() =>
    Math.ceil(this.totalItems() / PAGE_LIMIT),
  );
  readonly filterValues = signal<FilterValues>({});
  private readonly query = signal<BulkUploadLogQuery>({
    page: 1,
    limit: PAGE_LIMIT,
  });

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'upload_type',
      label: 'Tipo',
      type: 'select',
      placeholder: 'Todos',
      options: (Object.keys(BULK_UPLOAD_TYPE_LABELS) as BulkUploadType[]).map(
        (k) => ({ label: BULK_UPLOAD_TYPE_LABELS[k], value: k }),
      ),
    },
    {
      key: 'date',
      label: 'Fecha',
      type: 'date-range',
      startKey: 'date_from',
      endKey: 'date_to',
    },
  ];

  private formatDate(value: string): string {
    return value
      ? formatStoreDateTime(value, this.settingsFacade.timezone())
      : '—';
  }

  private readonly typeLabel = (v: BulkUploadType): string =>
    BULK_UPLOAD_TYPE_LABELS[v] ?? v;
  private readonly statusLabel = (v: BulkUploadStatus): string =>
    BULK_UPLOAD_STATUS_LABELS[v] ?? v;
  private readonly orDash = (v: string | null): string => v || '—';
  /** `created_rows` null = ese tipo de carga no distingue lo creado. */
  private readonly countOrDash = (v: number | null): string =>
    v == null ? '—' : String(v);

  readonly columns: TableColumn[] = [
    { key: 'upload_type', label: 'Tipo', transform: this.typeLabel },
    { key: 'user_name', label: 'Usuario', transform: this.orDash },
    {
      key: 'created_at',
      label: 'Fecha',
      transform: (v: string) => this.formatDate(v),
    },
    { key: 'file_name', label: 'Archivo' },
    { key: 'total_rows', label: 'Total', align: 'right' },
    { key: 'successful_rows', label: 'Cargadas', align: 'right' },
    {
      key: 'created_rows',
      label: 'Creadas',
      align: 'right',
      transform: this.countOrDash,
    },
    { key: 'failed_rows', label: 'Con error', align: 'right' },
    { key: 'skipped_rows', label: 'Omitidas', align: 'right' },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      badgeConfig: { type: 'custom', colorMap: { ...STATUS_COLORS } },
      transform: this.statusLabel,
    },
    { key: 'result_reference', label: 'Referencia', transform: this.orDash },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'upload_type',
    titleTransform: (item: BulkUploadLog) => this.typeLabel(item.upload_type),
    subtitleKey: 'file_name',
    badgeKey: 'status',
    badgeConfig: { type: 'custom', size: 'sm', colorMap: { ...STATUS_COLORS } },
    badgeTransform: this.statusLabel,
    detailKeys: [
      {
        key: 'created_at',
        label: 'Fecha',
        icon: 'calendar',
        transform: (v: string) => this.formatDate(v),
      },
      { key: 'user_name', label: 'Usuario', icon: 'user', transform: this.orDash },
      { key: 'total_rows', label: 'Total', icon: 'list' },
      { key: 'successful_rows', label: 'Cargadas', icon: 'check' },
      {
        key: 'created_rows',
        label: 'Creadas',
        icon: 'package-plus',
        transform: this.countOrDash,
      },
      { key: 'failed_rows', label: 'Con error', icon: 'alert-circle' },
      { key: 'skipped_rows', label: 'Omitidas', icon: 'info' },
      {
        key: 'result_reference',
        label: 'Referencia',
        icon: 'file-text',
        transform: this.orDash,
      },
    ],
  };

  constructor() {
    this.load();
  }

  /** `silent`: el refresco automático no muestra el cargando. */
  load(silent = false): void {
    this.refreshSub?.unsubscribe();
    if (!silent) this.loading.set(true);
    this.listError.set(null);
    this.logService
      .list(this.query())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.uploads.set(res.data);
          this.totalItems.set(res.total);
          this.currentPage.set(res.page);
          this.loading.set(false);
          this.scheduleActiveRefresh(res.data);
        },
        error: () => {
          this.loading.set(false);
          if (silent) {
            // Un fallo pasajero del refresco automático no vacía la lista:
            // se conserva lo último visto y se vuelve a intentar.
            this.scheduleActiveRefresh(this.uploads());
            return;
          }
          this.uploads.set([]);
          this.totalItems.set(0);
          this.listError.set('No se pudo cargar el historial de cargas.');
        },
      });
  }

  /**
   * QUI-1009 — una carga del servidor aparece «En cola»/«En curso» y sus
   * conteos avanzan mientras procesa; la lista se vuelve a pedir sola hasta
   * que ninguna fila visible siga activa.
   */
  private scheduleActiveRefresh(rows: BulkUploadLog[]): void {
    const hasActive = rows.some(
      (row) => row.status === 'queued' || row.status === 'running',
    );
    this.hasActiveUploads.set(hasActive);
    if (!hasActive) return;
    this.refreshSub = timer(ACTIVE_REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.load(true));
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set(values);
    this.query.update((q) => ({
      ...q,
      upload_type: (values['upload_type'] as BulkUploadType) || '',
      date_from: (values['date_from'] as string) || undefined,
      date_to: (values['date_to'] as string) || undefined,
      page: 1,
    }));
    this.load();
  }

  onPageChange(page: number): void {
    this.query.update((q) => ({ ...q, page }));
    this.load();
  }
}
