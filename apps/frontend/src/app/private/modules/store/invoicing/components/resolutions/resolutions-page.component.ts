import { Component, DestroyRef, inject, computed, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { ToggleComponent } from '../../../../../../shared/components/toggle/toggle.component';
import { Actions, ofType } from '@ngrx/effects';

import { InvoiceResolution } from '../../interfaces/invoice.interface';
import {
  selectResolutions,
  selectResolutionsLoading,
  selectResolutionsIncludeArchived,
} from '../../state/selectors/invoicing.selectors';
import * as InvoicingActions from '../../state/actions/invoicing.actions';
import { ResolutionCreateComponent } from './resolution-create/resolution-create.component';
import { DianConfigApiService } from '../../../../../../shared/services/dian';

import {
  CardComponent,
  ConfirmationModalComponent,
  StatsComponent,
  ResponsiveDataViewComponent,
  OptionsDropdownComponent,
  InputsearchComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  DropdownAction,
} from '../../../../../../shared/components/index';
import {
  isFiscalDocumentType,
  requirementsFor,
  findNoteSeriesConflicts,
  isNoteSeriesType,
  isResolutionInUse,
  noteSeriesActivationMessage,
  formatArchivedAt,
  ResolutionArchiveModalComponent,
  ResolutionsInUseCardComponent,
  type FiscalDocumentType,
  type ResolutionsInUseResponse,
} from '../../../../../../shared/components/dian';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';

interface ResolutionStats {
  total: number;
  active: number;
  expiringSoon: number;
  avgUsage: number;
}

type ResolutionStatus =
  | 'expired'
  | 'exhausted'
  | 'expiring'
  | 'active'
  | 'inactive'
  | 'archived';

/**
 * Numeración autorizada, de TODOS los documentos.
 *
 * La tabla muestra el tipo de documento porque una resolución sin él es
 * indistinguible de otra: el generador de consecutivos busca la fila POR
 * `document_type`, así que dos rangos con el mismo prefijo y distinto documento
 * son cosas completamente distintas y antes se veían iguales.
 *
 * Las resoluciones NUNCA se borran: es evidencia fiscal de documentos ya
 * reportados a la DIAN. Se desactivan (pausa reversible) o se ARCHIVAN («ya no la
 * voy a usar más»): una archivada queda inactiva, solo lectura, oculta por
 * defecto («Ver archivadas») y su prefijo sigue ocupado.
 */
@Component({
  selector: 'vendix-resolutions-page',
  standalone: true,
  imports: [
    CardComponent,
    ConfirmationModalComponent,
    ResolutionArchiveModalComponent,
    ToggleComponent,
    StatsComponent,
    ResponsiveDataViewComponent,
    OptionsDropdownComponent,
    InputsearchComponent,
    ResolutionCreateComponent,
    ResolutionsInUseCardComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        @if (stats(); as s) {
          <app-stats
            title="Total Resoluciones"
            [value]="s.total"
            smallText="Resoluciones registradas"
            iconName="file-text"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
            [clickable]="false"
          ></app-stats>
          <app-stats
            title="Activas"
            [value]="s.active"
            smallText="En uso actualmente"
            iconName="check-circle"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-600"
            [clickable]="false"
          ></app-stats>
          <app-stats
            title="Por Vencer"
            [value]="s.expiringSoon"
            smallText="En los próximos 30 días"
            iconName="clock"
            iconBgColor="bg-amber-100"
            iconColor="text-amber-600"
            [clickable]="false"
          ></app-stats>
          <app-stats
            title="Consumo Promedio"
            [value]="s.avgUsage + '%'"
            smallText="Uso sobre el rango total"
            iconName="activity"
            iconBgColor="bg-purple-100"
            iconColor="text-purple-600"
            [clickable]="false"
          ></app-stats>
        }
      </div>

      <!-- Numeración vigente: qué serie toma hoy el generador por documento -->
      <div class="mb-3">
        <app-resolutions-in-use-card
          [data]="in_use()"
          [loading]="in_use_loading()"
        ></app-resolutions-in-use-card>
      </div>

      <!-- Unified Container: Header + Data -->
      <app-card [responsive]="true" [padding]="false">
        <!-- Header sticky -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                 md:mt-0 md:static md:bg-transparent md:px-4 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide
                     md:text-lg md:font-semibold md:text-text-primary"
            >
              Resoluciones ({{ filteredResolutions().length }})
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-toggle
                label="Ver archivadas"
                ariaLabel="Ver resoluciones archivadas"
                [checked]="show_archived()"
                (toggled)="onToggleArchived($event)"
              ></app-toggle>
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                placeholder="Buscar por prefijo, número o documento..."
                [debounceTime]="300"
                (searchChange)="onSearch($event)"
              ></app-inputsearch>
              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [actions]="dropdown_actions"
                (actionClick)="onActionClick($event)"
              ></app-options-dropdown>
            </div>
          </div>
        </div>

        <!-- Data Content -->
        <div class="relative p-2 md:p-4">
          <app-responsive-data-view
            [data]="filteredResolutions()"
            [columns]="columns"
            [cardConfig]="card_config"
            [actions]="table_actions"
            [loading]="loading()"
            emptyMessage="No hay resoluciones configuradas"
            emptyIcon="file-text"
          ></app-responsive-data-view>
        </div>
      </app-card>

      <!-- Create/Edit Resolution Modal.
           El escáner de resoluciones por IA vive DENTRO del formulario
           compartido: es el único sitio donde sabe qué tipo de documento está
           rellenando. Antes se lanzaba desde aquí y precargaba un formulario que
           siempre guardaba como factura de venta. -->
      <vendix-resolution-create
        [(isOpen)]="is_create_modal_open"
        [resolution]="selected_resolution()"
      ></vendix-resolution-create>

      <!-- Archivar (las resoluciones no se borran) -->
      @if (pending_archive(); as row) {
        <vendix-resolution-archive-modal
          [resolution]="row"
          [busy]="archive_busy()"
          [requirePrefix]="archive_require_prefix()"
          [errorMessage]="archive_error()"
          (confirmed)="confirmArchive(row, $event)"
          (cancelled)="cancelArchive()"
        ></vendix-resolution-archive-modal>
      }

      <!-- Activar / desactivar -->
      @if (pending_toggle(); as row) {
        <app-confirmation-modal
          [isOpen]="true"
          [title]="row.is_active ? 'Desactivar resolución' : 'Activar resolución'"
          [message]="toggleMessage(row)"
          [confirmText]="row.is_active ? 'Desactivar' : 'Activar'"
          cancelText="Cancelar"
          [confirmVariant]="row.is_active ? 'danger' : 'primary'"
          (confirm)="confirmToggle(row)"
          (cancel)="cancelToggle()"
        ></app-confirmation-modal>
      }
    </div>
  `,
})
export class ResolutionsPageComponent {
  private store = inject(Store);
  private actions$ = inject(Actions);
  private destroyRef = inject(DestroyRef);
  private dianApi = inject(DianConfigApiService);

  // State via toSignal (con initialValue obligatorio)
  readonly resolutions = toSignal(this.store.select(selectResolutions), {
    initialValue: [] as InvoiceResolution[],
  });
  readonly loading = toSignal(this.store.select(selectResolutionsLoading), {
    initialValue: false,
  });
  /** «Ver archivadas»: vive en el store porque define qué pide el listado. */
  readonly show_archived = toSignal(
    this.store.select(selectResolutionsIncludeArchived),
    { initialValue: false },
  );

  // Local UI state
  readonly search_term = signal('');
  readonly is_create_modal_open = signal(false);
  readonly selected_resolution = signal<InvoiceResolution | null>(null);
  readonly pending_archive = signal<InvoiceResolution | null>(null);
  readonly archive_busy = signal(false);
  readonly archive_error = signal<string | null>(null);
  readonly archive_require_prefix = signal(false);
  readonly pending_toggle = signal<InvoiceResolution | null>(null);
  readonly in_use = signal<ResolutionsInUseResponse | null>(null);
  readonly in_use_loading = signal(false);

  // Derivados
  readonly filteredResolutions = computed(() => {
    const term = this.search_term().trim().toLowerCase();
    const inUse = this.in_use();
    // Se decora con `in_use` para que la tabla y las cards pinten el badge.
    const list = this.resolutions().map((r) => ({
      ...r,
      in_use: !r.archived_at && isResolutionInUse(r, inUse),
    }));
    if (!term) return list;
    return list.filter(
      (r) =>
        (r.prefix || '').toLowerCase().includes(term) ||
        (r.resolution_number || '').toLowerCase().includes(term) ||
        this.documentLabel(r).toLowerCase().includes(term),
    );
  });

  readonly stats = computed<ResolutionStats>(() => {
    // Las archivadas no cuentan en los stats: ya no son parte de la numeración.
    const list = this.resolutions().filter((r) => !r.archived_at);
    const total = list.length;
    const now = Date.now();
    const in30d = now + 30 * 24 * 60 * 60 * 1000;

    let active = 0;
    let expiringSoon = 0;
    let usageSum = 0;
    let usageCount = 0;

    for (const r of list) {
      if (r.is_active) active++;

      const validTo = r.valid_to ? new Date(r.valid_to).getTime() : NaN;
      if (!isNaN(validTo) && validTo >= now && validTo <= in30d) {
        expiringSoon++;
      }

      const max = (r.range_to ?? 0) - (r.range_from ?? 0) + 1;
      const used = (r.current_number ?? r.range_from ?? 0) - (r.range_from ?? 0);
      if (max > 0) {
        const pct = Math.max(0, Math.min(100, Math.round((used / max) * 100)));
        usageSum += pct;
        usageCount++;
      }
    }

    const avgUsage = usageCount > 0 ? Math.round(usageSum / usageCount) : 0;

    return { total, active, expiringSoon, avgUsage };
  });

  constructor() {
    // Despachar solo si no hay datos cargados (evita refetch innecesario)
    if (this.resolutions().length === 0 && !this.loading()) {
      this.store.dispatch(InvoicingActions.loadResolutions());
    }

    this.loadInUse();

    // Tras crear, actualizar (incluye activar/desactivar) o archivar, la lista la
    // refresca el store; aquí se refresca `in-use`, que depende de lo mismo.
    this.actions$
      .pipe(
        ofType(
          InvoicingActions.createResolutionSuccess,
          InvoicingActions.updateResolutionSuccess,
          InvoicingActions.archiveResolutionSuccess,
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.loadInUse());

    this.actions$
      .pipe(
        ofType(InvoicingActions.archiveResolutionSuccess),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.closeArchive());

    this.actions$
      .pipe(
        ofType(InvoicingActions.archiveResolutionFailure),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ error, errorCode }) => {
        this.archive_busy.set(false);
        this.archive_error.set(error);
        // 015: es la serie de notas en uso; hay que indicar la serie nueva.
        if (errorCode === 'INVOICING_RESOLUTION_015') {
          this.archive_require_prefix.set(true);
        }
      });

    // «Ver archivadas» no debe filtrarse a otras pantallas que leen el mismo
    // store (crear factura): al salir se vuelve al listado por defecto.
    this.destroyRef.onDestroy(() => {
      if (this.show_archived()) {
        this.store.dispatch(
          InvoicingActions.setResolutionsIncludeArchived({ include_archived: false }),
        );
      }
    });
  }

  private loadInUse(): void {
    this.in_use_loading.set(true);
    this.dianApi
      .getResolutionsInUse()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.in_use.set(res.data ?? null);
          this.in_use_loading.set(false);
        },
        error: () => this.in_use_loading.set(false),
      });
  }

  dropdown_actions: DropdownAction[] = [
    {
      label: 'Nueva resolución',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ];

  columns: TableColumn[] = [
    {
      key: 'prefix',
      label: 'Prefijo',
      sortable: true,
      priority: 1,
      transform: (_val: any, item?: InvoiceResolution) =>
        item ? `${item.prefix} · ${item.resolution_number}` : '',
    },
    {
      // Qué documento numera. Sin esta columna, la resolución del documento
      // soporte y la de la factura de venta se ven idénticas.
      key: 'document_type',
      label: 'Documento',
      priority: 1,
      transform: (_val: any, item?: InvoiceResolution) =>
        item ? this.documentLabel(item) : '',
    },
    {
      key: 'range_from',
      label: 'Rango',
      priority: 2,
      transform: (_val: any, item?: InvoiceResolution) =>
        item ? `${item.range_from} - ${item.range_to}` : '',
    },
    {
      key: 'valid_to',
      label: 'Vigencia',
      priority: 2,
      transform: (_val: any, item?: InvoiceResolution) => {
        if (!item) return '';
        const from = item.valid_from ? formatDateOnlyUTC(item.valid_from) : '-';
        const to = item.valid_to ? formatDateOnlyUTC(item.valid_to) : '-';
        return `${from} → ${to}`;
      },
    },
    {
      key: 'current_number',
      label: 'Consumo',
      align: 'center',
      priority: 2,
      transform: (_val: any, item?: InvoiceResolution) =>
        this.getUsageLabel(item),
    },
    {
      // La que toma el generador de consecutivos para su tipo de documento.
      key: 'in_use',
      label: 'Numeración',
      align: 'center',
      priority: 1,
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: { 'En uso': '#2563eb', '—': '#cbd5e1' },
      },
      transform: (value: unknown) => (value ? 'En uso' : '—'),
    },
    {
      key: 'is_active',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: {
          expired: 'danger',
          exhausted: 'danger',
          expiring: 'warn',
          active: 'success',
          inactive: 'neutral',
          archived: 'neutral',
        },
      },
      transform: (_val: any, item?: InvoiceResolution) =>
        this.getStatusLabel(this.getResolutionStatus(item)),
      cellClass: (_val: any, item?: InvoiceResolution) => {
        const s = this.getResolutionStatus(item);
        return s || '';
      },
    },
  ];

  table_actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'primary',
      show: (row: InvoiceResolution) => !row.archived_at,
      action: (row: InvoiceResolution) => this.editResolution(row),
    },
    {
      // Retirar del uso sin borrar. Es lo ÚNICO que se puede hacer con la
      // resolución de habilitación (SETP) una vez gastó numeración.
      label: (row: InvoiceResolution) =>
        row.is_active ? 'Desactivar' : 'Activar',
      icon: (row: InvoiceResolution) =>
        row.is_active ? 'toggle-left' : 'toggle-right',
      variant: (row: InvoiceResolution) => (row.is_active ? 'warning' : 'success'),
      show: (row: InvoiceResolution) => !row.archived_at,
      action: (row: InvoiceResolution) => this.askToggle(row),
    },
    {
      // «Ya no la voy a usar más». Reemplaza al borrado: nunca se borra.
      label: 'Archivar',
      icon: 'archive',
      variant: 'danger',
      show: (row: InvoiceResolution) => !row.archived_at,
      action: (row: InvoiceResolution) => this.askArchive(row),
    },
  ];

  card_config: ItemListCardConfig = {
    titleKey: 'prefix',
    titleTransform: (item: InvoiceResolution) =>
      `${item.prefix} · ${item.resolution_number}`,
    subtitleKey: 'document_type',
    subtitleTransform: (item: InvoiceResolution) =>
      `${this.documentLabel(item)} · rango ${item.range_from} - ${item.range_to}`,
    badgeKey: 'is_active',
    badgeConfig: {
      type: 'status',
      colorMap: {
        expired: 'danger',
        exhausted: 'danger',
        expiring: 'warn',
        active: 'success',
        inactive: 'neutral',
        archived: 'neutral',
      },
    },
    badgeTransform: (_val: any) => '',
    detailKeys: [
      {
        key: 'in_use',
        label: 'Numeración',
        icon: 'hash',
        transform: (val: unknown) => (val ? 'En uso' : '-'),
      },
      {
        key: 'archived_at',
        label: 'Archivada',
        icon: 'archive',
        transform: (val: any) => (val ? formatArchivedAt(val) : '-'),
      },
      {
        key: 'valid_from',
        label: 'Desde',
        icon: 'calendar',
        transform: (val: any) => (val ? formatDateOnlyUTC(val) : '-'),
      },
      {
        key: 'valid_to',
        label: 'Hasta',
        icon: 'calendar',
        transform: (val: any) => (val ? formatDateOnlyUTC(val) : '-'),
      },
      {
        key: 'current_number',
        label: 'Consumo',
        icon: 'activity',
        transform: (_val: any, item?: InvoiceResolution) =>
          this.getUsageLabel(item),
      },
    ],
  };

  onSearch(term: string): void {
    this.search_term.set(term ?? '');
  }

  onActionClick(action: string): void {
    if (action === 'create') {
      this.selected_resolution.set(null);
      this.is_create_modal_open.set(true);
    }
  }

  editResolution(resolution: InvoiceResolution): void {
    this.selected_resolution.set(resolution);
    this.is_create_modal_open.set(true);
  }

  onToggleArchived(value: boolean): void {
    this.store.dispatch(
      InvoicingActions.setResolutionsIncludeArchived({ include_archived: value }),
    );
  }

  /**
   * Las resoluciones DIAN nunca se borran: «Archivar» las retira para siempre
   * del uso (solo lectura, prefijo ocupado). Se confirma en un modal que, para
   * una serie de notas activa, ofrece el prefijo de la serie que la reemplaza.
   */
  askArchive(row: InvoiceResolution): void {
    this.archive_error.set(null);
    this.archive_require_prefix.set(false);
    this.archive_busy.set(false);
    this.pending_archive.set(row);
  }

  cancelArchive(): void {
    if (this.archive_busy()) return;
    this.closeArchive();
  }

  confirmArchive(row: InvoiceResolution, replacementPrefix: string | undefined): void {
    this.archive_busy.set(true);
    this.archive_error.set(null);
    this.store.dispatch(
      InvoicingActions.archiveResolution({
        id: row.id,
        ...(replacementPrefix ? { replacement_prefix: replacementPrefix } : {}),
      }),
    );
  }

  private closeArchive(): void {
    this.pending_archive.set(null);
    this.archive_busy.set(false);
    this.archive_error.set(null);
    this.archive_require_prefix.set(false);
  }

  askToggle(row: InvoiceResolution): void {
    this.pending_toggle.set(row);
  }

  cancelToggle(): void {
    this.pending_toggle.set(null);
  }

  /**
   * Sólo viaja `is_active`. Mandar el resto de la fila haría que el backend
   * comparase campos inmutables (prefijo, tipo de documento, rango, número) de
   * una resolución que ya consumió numeración y rechazara el PATCH entero.
   */
  confirmToggle(row: InvoiceResolution): void {
    this.pending_toggle.set(null);
    this.store.dispatch(
      InvoicingActions.updateResolution({
        id: row.id,
        resolution: { is_active: !row.is_active },
      }),
    );
  }

  toggleMessage(row: InvoiceResolution): string {
    const identity = `${row.prefix} · ${row.resolution_number} (${this.documentLabel(row)})`;
    if (!row.is_active) {
      const conflicts = findNoteSeriesConflicts(this.resolutions(), {
        id: row.id,
        document_type: row.document_type,
        accounting_entity_id: row.accounting_entity_id,
      });
      if (conflicts.length > 0) {
        return noteSeriesActivationMessage(row.prefix, conflicts);
      }
      const base = `${identity} volverá a numerar documentos desde el consecutivo ${row.current_number + 1}.`;
      return isNoteSeriesType(row.document_type)
        ? base
        : `${base} Si hay varias activas del mismo tipo, el sistema usa la más reciente (ver «Numeración vigente»).`;
    }
    const consumed = (row.current_number ?? 0) >= (row.range_from ?? 0);
    const base = `${identity} dejará de numerar documentos nuevos. Los ya emitidos con ella no cambian.`;
    return consumed
      ? `${base} Ya consumió numeración ante la DIAN: si no la vas a usar más, archívala.`
      : base;
  }

  /** Rótulo del documento que numera la fila, tomado del contrato compartido. */
  private documentLabel(item: InvoiceResolution): string {
    return requirementsFor(this.documentTypeOf(item)).label;
  }

  private documentTypeOf(item: InvoiceResolution): FiscalDocumentType {
    const raw = item.document_type;
    return isFiscalDocumentType(raw) ? raw : 'sales_invoice';
  }

  private getResolutionStatus(
    item: InvoiceResolution | undefined,
  ): ResolutionStatus {
    if (!item) return 'inactive';
    if (item.archived_at) return 'archived';

    const now = Date.now();
    const validTo = item.valid_to ? new Date(item.valid_to).getTime() : NaN;
    const max = item.range_to ?? 0;
    const used = item.current_number ?? item.range_from ?? 0;

    if (!item.is_active) return 'inactive';
    if (!isNaN(validTo) && validTo < now) return 'expired';
    if (max > 0 && used >= max) return 'exhausted';
    if (
      !isNaN(validTo) &&
      validTo >= now &&
      validTo <= now + 30 * 24 * 60 * 60 * 1000
    ) {
      return 'expiring';
    }
    return 'active';
  }

  private getStatusLabel(status: ResolutionStatus): string {
    const labels: Record<ResolutionStatus, string> = {
      expired: 'Vencida',
      exhausted: 'Agotada',
      expiring: 'Por vencer',
      active: 'Activa',
      inactive: 'Inactiva',
      archived: 'Archivada',
    };
    return labels[status] || String(status);
  }

  private getUsageLabel(item: InvoiceResolution | undefined): string {
    if (!item) return '-';
    const from = item.range_from ?? 0;
    const to = item.range_to ?? 0;
    const max = to - from + 1;
    if (!max || max <= 0) return '-';
    const used = Math.max(0, (item.current_number ?? from) - from);
    const pct = Math.min(100, Math.round((used / max) * 100));
    return `${used}/${max} (${pct}%)`;
  }
}
