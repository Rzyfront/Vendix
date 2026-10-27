import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule } from '@angular/forms';
import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  DialogService,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  InputComponent,
  InputsearchComponent,
  ItemListCardConfig,
  ModalComponent,
  OptionsDropdownComponent,
  ResponsiveDataViewComponent,
  ScrollableTab,
  ScrollableTabsComponent,
  SelectorComponent,
  SelectorOption,
  StatsComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../../shared/components/index';
import {
  IcalExportUnit,
  IcalImport,
  IcalImportStatus,
} from '../../interfaces/ical-export.interface';
import { LodgingIcalExportService } from '../../services/ical-export.service';

type ChannelTab = 'export' | 'import';

interface ExportRow extends IcalExportUnit {
  room: string;
  link_state: 'published' | 'none' | 'inactive';
  url_label: string;
}

interface ImportRow extends IcalImport {
  room: string;
  host_label: string;
  sync_state: IcalImportStatus | 'never';
  synced_label: string;
  message_label: string;
}

const LINK_BADGE = {
  type: 'custom' as const,
  size: 'sm' as const,
  colorMap: { published: '#10b981', none: '#9ca3af', inactive: '#6b7280' },
};

const LINK_LABELS: Record<ExportRow['link_state'], string> = {
  published: 'Publicado',
  none: 'Sin enlace',
  inactive: 'Inactiva',
};

const SYNC_BADGE = {
  type: 'custom' as const,
  size: 'sm' as const,
  colorMap: { ok: '#10b981', warning: '#f59e0b', error: '#ef4444', never: '#9ca3af' },
};

const SYNC_LABELS: Record<ImportRow['sync_state'], string> = {
  ok: 'Sincronizado',
  warning: 'Posible doble venta',
  error: 'Error',
  never: 'Sin sincronizar',
};

const linkLabel = (value: ExportRow['link_state']): string => LINK_LABELS[value] ?? value;
const syncLabel = (value: ImportRow['sync_state']): string => SYNC_LABELS[value] ?? value;

/** Case- and accent-insensitive "contains". */
function matches(term: string, ...values: (string | null | undefined)[]): boolean {
  const normalize = (v: string) =>
    v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const needle = normalize(term.trim());
  return !needle || values.some((v) => !!v && normalize(v).includes(needle));
}

/** Only the host: the rest of the URL is the channel's secret. */
function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Hospitality Suite — Canales → iCal (H6.1). One export link per room: the
 * manager generates it, copies it into Airbnb or Booking and the nights sold
 * or blocked in Vendix show up blocked there. The link carries a secret
 * token; regenerating or revoking it stops the URL already pasted.
 *
 * H6.2 — "Importar": the manager pastes the iCal URL of an Airbnb/Booking
 * listing into a room; its reservations block the room in Vendix (rack),
 * synced every 15 minutes and with "Sincronizar ahora".
 *
 * Standard admin list module: four stats, the export/import tabs, one card
 * with the sticky search and the options dropdown (state filter, "Importar
 * calendario" and refresh) and the responsive data view. The import form
 * opens in a modal.
 */
@Component({
  selector: 'app-hospitality-ical-export-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    NgTemplateOutlet,
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    InputComponent,
    InputsearchComponent,
    ModalComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    ScrollableTabsComponent,
    SelectorComponent,
    StatsComponent,
  ],
  providers: [DatePipe],
  template: `
    <div class="w-full md:space-y-4">
      <!-- Stats: sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Habitaciones"
          [value]="activeUnits()"
          smallText="activas para publicar"
          iconName="bed-double"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="units() === null"
        />
        <app-stats
          title="Enlaces publicados"
          [value]="publishedCount()"
          smallText="calendarios que exporta Vendix"
          iconName="share-2"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="units() === null"
        />
        <app-stats
          title="Calendarios importados"
          [value]="imports()?.length ?? 0"
          smallText="de Airbnb, Booking u otros"
          iconName="calendar-check"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="imports() === null"
        />
        <app-stats
          title="Con alerta"
          [value]="alertCount()"
          smallText="error o posible doble venta"
          iconName="alert-triangle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="imports() === null"
        />
      </div>

      <app-scrollable-tabs
        ariaLabel="Canales iCal"
        [tabs]="tabs()"
        [activeTab]="tab()"
        (tabChange)="onTab($event)"
      />

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <!-- Sticky search header -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                 md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide
                     md:text-lg md:font-semibold md:text-text-primary"
            >
              {{ tab() === 'export' ? 'Exportar calendario' : 'Calendarios importados' }}
              <span class="text-text-secondary font-normal">
                ({{ tab() === 'export' ? exportRows().length : importRows().length }})
              </span>
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                [placeholder]="tab() === 'export' ? 'Buscar habitación...' : 'Buscar canal...'"
                [debounceTime]="300"
                [ngModel]="search()"
                (ngModelChange)="onSearch($event)"
              />
              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [filters]="filterConfigs()"
                [filterValues]="filterValues()"
                [actions]="dropdownActions()"
                [isLoading]="units() === null || imports() === null"
                (filterChange)="filterValues.set($event)"
                (clearAllFilters)="filterValues.set({})"
                (actionClick)="onActionClick($event)"
              />
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          <p class="mb-3 text-xs text-text-secondary md:text-sm">
            @if (tab() === 'export') {
              Copia el enlace de cada habitación y pégalo en Airbnb o Booking (importar
              calendario). Allá se bloquean las noches vendidas o bloqueadas en Vendix; el
              calendario solo lleva fechas, sin precios ni datos del huésped.
            } @else {
              Las reservas de cada canal bloquean la habitación en Vendix y se ven en el rack.
              Se sincroniza cada 15 minutos (ajustable en Configuración → Hotelería) y con
              «Sincronizar ahora».
            }
          </p>

          @if (tab() === 'export') {
            @if (units() === null) {
              <div class="p-4 md:p-6 text-center">
                <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                <p class="mt-2 text-text-secondary">Cargando habitaciones...</p>
              </div>
            } @else if (units()!.length === 0) {
              <app-empty-state
                icon="bed-double"
                title="Sin habitaciones"
                description="Crea las habitaciones en Hotelería → Habitaciones para publicar su calendario."
                [showActionButton]="false"
              />
            } @else if (exportRows().length === 0) {
              <ng-container [ngTemplateOutlet]="noResults" />
            } @else {
              <app-responsive-data-view
                [data]="exportRows()"
                [columns]="exportColumns"
                [cardConfig]="exportCardConfig"
                [actions]="exportActions"
                [mobileActions]="exportActions"
                [striped]="true"
                [hoverable]="true"
                emptyMessage="No hay habitaciones con ese criterio"
                emptyIcon="search"
                data-testid="ical-units"
              />
            }
          } @else {
            @if (imports() === null) {
              <div class="p-4 md:p-6 text-center">
                <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                <p class="mt-2 text-text-secondary">Cargando calendarios...</p>
              </div>
            } @else if (imports()!.length === 0) {
              <app-empty-state
                icon="calendar-plus"
                title="Aún no importas calendarios"
                description="Pega el enlace iCal de un anuncio de Airbnb o Booking para bloquear sus fechas en Vendix."
                actionButtonText="Importar calendario"
                actionButtonIcon="plus"
                [showActionButton]="unitOptions().length > 0"
                (actionClick)="openImport()"
              />
            } @else if (importRows().length === 0) {
              <ng-container [ngTemplateOutlet]="noResults" />
            } @else {
              <app-responsive-data-view
                [data]="importRows()"
                [columns]="importColumns"
                [cardConfig]="importCardConfig"
                [actions]="importActions"
                [mobileActions]="importActions"
                [striped]="true"
                [hoverable]="true"
                emptyMessage="No hay calendarios con ese criterio"
                emptyIcon="search"
                data-testid="ical-imports"
              />
            }
          }

          <ng-template #noResults>
            <app-empty-state
              icon="search"
              title="Sin resultados"
              description="Nada coincide con la búsqueda o los filtros."
              actionButtonText="Limpiar filtros"
              [showActionButton]="true"
              (actionClick)="clearFilters()"
            />
          </ng-template>
        </div>
      </app-card>

      <!-- H6.2 — import a channel calendar -->
      <app-modal
        [isOpen]="importOpen()"
        (isOpenChange)="!$event && importOpen.set(false)"
        (cancel)="importOpen.set(false)"
        size="md"
        title="Importar calendario"
        subtitle="Enlace iCal de Airbnb, Booking u otro canal"
      >
        <form
          [formGroup]="importForm"
          class="flex flex-col gap-3"
          data-testid="ical-import-form"
          (ngSubmit)="addImport()"
        >
          <app-selector
            formControlName="unit_id"
            label="Habitación"
            placeholder="Selecciona"
            [options]="unitOptions()"
          />
          <app-input formControlName="name" label="Canal" placeholder="Airbnb" customWrapperClass="mt-0" />
          <app-input
            formControlName="url"
            label="URL iCal del canal"
            placeholder="https://www.airbnb.com/calendar/ical/….ics"
            customWrapperClass="mt-0"
          />
          <app-alert-banner variant="warning" icon="alert-triangle" data-testid="ical-import-warning">
            iCal no trae el precio ni los datos del huésped: solo bloquea las fechas. El canal
            publica su calendario con horas de retraso, así que una misma noche puede venderse en
            los dos lados antes de sincronizar. Si ves el aviso de doble venta, mueve la reserva de
            Vendix a otra habitación.
          </app-alert-banner>
        </form>
        <div slot="footer" class="flex justify-end gap-2">
          <app-button variant="ghost" (clicked)="importOpen.set(false)">Cancelar</app-button>
          <app-button
            variant="primary"
            [loading]="adding()"
            [disabled]="!canAdd() || adding()"
            (clicked)="addImport()"
          >
            Importar
          </app-button>
        </div>
      </app-modal>
    </div>
  `,
})
export class HospitalityIcalExportPageComponent implements OnInit {
  private readonly icalService = inject(LodgingIcalExportService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);
  private readonly datePipe = inject(DatePipe);

  readonly units = signal<IcalExportUnit[] | null>(null);
  /** Room whose link change is in flight (blocks a double click). */
  readonly saving = signal<number | null>(null);

  /** H6.2 — imported calendars; null while loading. */
  readonly imports = signal<IcalImport[] | null>(null);
  /** Import whose sync or removal is in flight. */
  readonly syncing = signal<number | null>(null);
  readonly adding = signal(false);

  readonly importForm = this.fb.group({
    unit_id: this.fb.control<number | null>(null),
    name: this.fb.nonNullable.control('Airbnb'),
    url: this.fb.nonNullable.control(''),
  });
  private readonly importValue = toSignal(this.importForm.valueChanges, {
    initialValue: this.importForm.getRawValue(),
  });
  readonly canAdd = computed(() => {
    const { unit_id, url } = this.importValue();
    return unit_id !== null && unit_id !== undefined && !!url?.trim();
  });
  readonly unitOptions = computed<SelectorOption[]>(() =>
    (this.units() ?? [])
      .filter((u) => u.is_active)
      .map((u) => ({ value: u.id, label: `${u.code} · ${u.unit_type.name}` })),
  );

  readonly tab = signal<ChannelTab>('export');
  readonly search = signal('');
  readonly filterValues = signal<FilterValues>({});
  readonly importOpen = signal(false);

  readonly activeUnits = computed(() => (this.units() ?? []).filter((u) => u.is_active).length);
  readonly publishedCount = computed(
    () => (this.units() ?? []).filter((u) => u.ical_export_token).length,
  );
  readonly alertCount = computed(
    () =>
      (this.imports() ?? []).filter(
        (i) => i.last_sync_status === 'error' || i.last_sync_status === 'warning',
      ).length,
  );

  readonly tabs = computed<ScrollableTab[]>(() => [
    { id: 'export', label: `Exportar (${this.units()?.length ?? 0})`, icon: 'upload' },
    { id: 'import', label: `Importar (${this.imports()?.length ?? 0})`, icon: 'download' },
  ]);

  readonly filterConfigs = computed<FilterConfig[]>(() =>
    this.tab() === 'export'
      ? [
          {
            key: 'link_state',
            label: 'Enlace',
            type: 'select',
            options: [
              { value: '', label: 'Todos' },
              { value: 'published', label: 'Publicado' },
              { value: 'none', label: 'Sin enlace' },
              { value: 'inactive', label: 'Habitación inactiva' },
            ],
          },
        ]
      : [
          {
            key: 'sync_state',
            label: 'Sincronización',
            type: 'select',
            options: [
              { value: '', label: 'Todas' },
              ...(Object.keys(SYNC_LABELS) as ImportRow['sync_state'][]).map((value) => ({
                value,
                label: SYNC_LABELS[value],
              })),
            ],
          },
        ],
  );

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    ...(this.tab() === 'import'
      ? [
          {
            label: 'Importar calendario',
            icon: 'plus',
            action: 'import',
            variant: 'primary' as const,
            disabled: this.unitOptions().length === 0,
          },
        ]
      : []),
    { label: 'Actualizar', icon: 'refresh-cw', action: 'refresh', variant: 'outline' },
  ]);

  private readonly stateFilter = computed(() => {
    const value = this.filterValues()[this.tab() === 'export' ? 'link_state' : 'sync_state'];
    return typeof value === 'string' ? value : '';
  });

  readonly exportRows = computed<ExportRow[]>(() =>
    (this.units() ?? [])
      .map((unit) => ({
        ...unit,
        room: `Habitación ${unit.code}`,
        link_state: !unit.is_active
          ? ('inactive' as const)
          : unit.ical_export_token
            ? ('published' as const)
            : ('none' as const),
        url_label: unit.ical_export_token ? this.url(unit.ical_export_token) : '—',
      }))
      .filter(
        (row) =>
          matches(this.search(), row.code, row.unit_type.name, row.floor) &&
          (!this.stateFilter() || row.link_state === this.stateFilter()),
      ),
  );

  readonly importRows = computed<ImportRow[]>(() =>
    (this.imports() ?? [])
      .map((item) => ({
        ...item,
        room: `Habitación ${item.unit.code}`,
        host_label: host(item.url),
        sync_state: item.last_sync_status ?? ('never' as const),
        synced_label: item.last_synced_at
          ? (this.datePipe.transform(item.last_synced_at, 'dd/MM/yyyy HH:mm') ?? '')
          : 'Sin sincronizar',
        message_label: item.last_sync_message ?? '',
      }))
      .filter(
        (row) =>
          matches(this.search(), row.unit.code, row.name, row.host_label) &&
          (!this.stateFilter() || row.sync_state === this.stateFilter()),
      ),
  );

  readonly exportColumns: TableColumn[] = [
    { key: 'room', label: 'Habitación' },
    { key: 'unit_type.name', label: 'Tipo' },
    { key: 'url_label', label: 'Enlace iCal', cellClass: () => 'max-w-xs truncate font-mono text-xs' },
    {
      key: 'link_state',
      label: 'Estado',
      badge: true,
      badgeConfig: LINK_BADGE,
      transform: linkLabel,
    },
  ];

  readonly exportCardConfig: ItemListCardConfig = {
    titleKey: 'room',
    subtitleKey: 'unit_type.name',
    badgeKey: 'link_state',
    badgeConfig: LINK_BADGE,
    badgeTransform: linkLabel,
  };

  readonly exportActions: TableAction[] = [
    {
      label: 'Copiar URL',
      icon: 'copy',
      variant: 'primary',
      show: (row: ExportRow) => !!row.ical_export_token,
      action: (row: ExportRow) => this.copy(row.ical_export_token!),
    },
    {
      label: 'Generar enlace',
      icon: 'link',
      variant: 'primary',
      show: (row: ExportRow) => !row.ical_export_token,
      disabled: () => this.saving() !== null,
      action: (row: ExportRow) => this.generate(row),
    },
    {
      label: 'Regenerar',
      icon: 'refresh-cw',
      variant: 'secondary',
      show: (row: ExportRow) => !!row.ical_export_token,
      disabled: () => this.saving() !== null,
      action: (row: ExportRow) => this.regenerate(row),
    },
    {
      label: 'Revocar',
      icon: 'x-circle',
      variant: 'danger',
      show: (row: ExportRow) => !!row.ical_export_token,
      disabled: () => this.saving() !== null,
      action: (row: ExportRow) => this.revoke(row),
    },
  ];

  readonly importColumns: TableColumn[] = [
    { key: 'room', label: 'Habitación' },
    { key: 'name', label: 'Canal' },
    { key: 'host_label', label: 'Origen' },
    { key: 'synced_label', label: 'Última sincronización' },
    {
      key: 'message_label',
      label: 'Mensaje',
      cellClass: (_value: string, row?: ImportRow) =>
        row?.sync_state === 'error' ? 'text-error' : row?.sync_state === 'warning' ? 'text-warning' : '',
    },
    {
      key: 'sync_state',
      label: 'Estado',
      badge: true,
      badgeConfig: SYNC_BADGE,
      transform: syncLabel,
    },
  ];

  readonly importCardConfig: ItemListCardConfig = {
    titleKey: 'room',
    subtitleKey: 'name',
    badgeKey: 'sync_state',
    badgeConfig: SYNC_BADGE,
    badgeTransform: syncLabel,
    detailKeys: [
      { key: 'host_label', label: 'Origen' },
      { key: 'synced_label', label: 'Sincronizado' },
    ],
    noteTransform: (row: ImportRow) => row.message_label || null,
  };

  readonly importActions: TableAction[] = [
    {
      label: 'Sincronizar ahora',
      icon: 'refresh-cw',
      variant: 'primary',
      disabled: () => this.syncing() !== null,
      action: (row: ImportRow) => this.syncNow(row),
    },
    {
      label: 'Quitar',
      icon: 'trash-2',
      variant: 'danger',
      disabled: () => this.syncing() !== null,
      action: (row: ImportRow) => this.removeImport(row),
    },
  ];

  onTab(id: string): void {
    this.tab.set(id as ChannelTab);
    this.clearFilters();
  }

  onSearch(term: string | null): void {
    this.search.set((term ?? '').trim());
  }

  clearFilters(): void {
    this.search.set('');
    this.filterValues.set({});
  }

  onActionClick(action: string): void {
    if (action === 'import') {
      this.openImport();
    } else if (action === 'refresh') {
      this.load();
      this.loadImports();
    }
  }

  openImport(): void {
    this.importForm.reset({ unit_id: null, name: 'Airbnb', url: '' });
    this.importOpen.set(true);
  }

  ngOnInit(): void {
    this.load();
    this.loadImports();
  }

  loadImports(): void {
    this.icalService
      .imports()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (imports) => this.imports.set(imports),
        error: (message: unknown) => {
          this.imports.set([]);
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudieron cargar los calendarios',
          );
        },
      });
  }

  addImport(): void {
    if (!this.canAdd() || this.adding()) return;
    const { unit_id, name, url } = this.importForm.getRawValue();
    this.adding.set(true);
    this.icalService
      .createImport({ unit_id: Number(unit_id), name: name.trim() || 'Airbnb', url: url.trim() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (item) => {
          this.adding.set(false);
          this.imports.update((list) => [...(list ?? []), item]);
          this.importOpen.set(false);
          this.importForm.reset({ unit_id: null, name: 'Airbnb', url: '' });
          this.toastSync(item, 'Calendario importado');
        },
        error: (message: unknown) => {
          this.adding.set(false);
          this.toastService.error(typeof message === 'string' ? message : 'No se pudo importar');
        },
      });
  }

  syncNow(item: IcalImport): void {
    if (this.syncing() !== null) return;
    this.syncing.set(item.id);
    this.icalService
      .syncImport(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.syncing.set(null);
          this.replaceImport(updated);
          this.toastSync(updated, 'Calendario sincronizado');
        },
        error: (message: unknown) => {
          this.syncing.set(null);
          this.toastService.error(typeof message === 'string' ? message : 'No se pudo sincronizar');
        },
      });
  }

  async removeImport(item: IcalImport): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Quitar calendario',
      message: `Las reservas de ${item.name} dejarán de bloquear la habitación ${item.unit.code} y sus fechas próximas vuelven a la venta en Vendix.`,
      confirmText: 'Quitar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed || this.syncing() !== null) return;
    this.syncing.set(item.id);
    this.icalService
      .removeImport(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.syncing.set(null);
          this.imports.update((list) => list && list.filter((i) => i.id !== item.id));
          this.toastService.success('Calendario quitado');
        },
        error: (message: unknown) => {
          this.syncing.set(null);
          this.toastService.error(typeof message === 'string' ? message : 'No se pudo quitar');
        },
      });
  }

  private replaceImport(updated: IcalImport): void {
    this.imports.update((list) => list && list.map((i) => (i.id === updated.id ? updated : i)));
  }

  private toastSync(item: IcalImport, done: string): void {
    if (item.last_sync_status === 'error') {
      this.toastService.error(item.last_sync_message || 'No se pudo leer el calendario', undefined, 6000);
    } else if (item.last_sync_status === 'warning') {
      this.toastService.warning(item.last_sync_message || 'Posible doble venta', undefined, 8000);
    } else {
      this.toastService.success(done);
    }
  }

  load(): void {
    this.icalService
      .units()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (units) => this.units.set(units),
        error: (message: unknown) => {
          this.units.set([]);
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudieron cargar las habitaciones',
          );
        },
      });
  }

  url(token: string): string {
    return this.icalService.feedUrl(token);
  }

  async copy(token: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.url(token));
      this.toastService.success('URL copiada');
    } catch {
      this.toastService.error('No se pudo copiar; selecciona la URL y cópiala a mano');
    }
  }

  generate(unit: IcalExportUnit): void {
    this.applyToken(unit, 'Enlace generado');
  }

  async regenerate(unit: IcalExportUnit): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Regenerar enlace',
      message: `El enlace actual de la habitación ${unit.code} dejará de funcionar. Tendrás que pegar el nuevo en Airbnb o Booking.`,
      confirmText: 'Regenerar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (confirmed) this.applyToken(unit, 'Enlace regenerado');
  }

  async revoke(unit: IcalExportUnit): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Revocar enlace',
      message: `El enlace de la habitación ${unit.code} dejará de funcionar y el canal no recibirá más fechas.`,
      confirmText: 'Revocar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed || this.saving() !== null) return;
    this.saving.set(unit.id);
    this.icalService
      .revoke(unit.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(null);
          this.setToken(unit.id, null);
          this.toastService.success('Enlace revocado');
        },
        error: (message: unknown) => this.fail(message),
      });
  }

  private applyToken(unit: IcalExportUnit, done: string): void {
    if (this.saving() !== null) return;
    this.saving.set(unit.id);
    this.icalService
      .rotate(unit.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.saving.set(null);
          this.setToken(unit.id, result.ical_export_token);
          this.toastService.success(done);
        },
        error: (message: unknown) => this.fail(message),
      });
  }

  private setToken(unitId: number, token: string | null): void {
    this.units.update(
      (units) =>
        units && units.map((u) => (u.id === unitId ? { ...u, ical_export_token: token } : u)),
    );
  }

  private fail(message: unknown): void {
    this.saving.set(null);
    this.toastService.error(typeof message === 'string' ? message : 'No se pudo guardar');
  }
}
