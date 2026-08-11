import { Component, inject, computed, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';

import { InvoiceResolution } from '../../interfaces/invoice.interface';
import {
  selectResolutions,
  selectResolutionsLoading,
} from '../../state/selectors/invoicing.selectors';
import * as InvoicingActions from '../../state/actions/invoicing.actions';
import { ResolutionCreateComponent } from './resolution-create/resolution-create.component';

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
  type FiscalDocumentType,
} from '../../../../../../shared/components/dian';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';

interface ResolutionStats {
  total: number;
  active: number;
  expiringSoon: number;
  avgUsage: number;
}

type ResolutionStatus = 'expired' | 'exhausted' | 'expiring' | 'active' | 'inactive';

/**
 * Numeración autorizada, de TODOS los documentos.
 *
 * La tabla muestra el tipo de documento porque una resolución sin él es
 * indistinguible de otra: el generador de consecutivos busca la fila POR
 * `document_type`, así que dos rangos con el mismo prefijo y distinto documento
 * son cosas completamente distintas y antes se veían iguales.
 *
 * La acción de activar/desactivar existe porque **desactivar es la única vía
 * para retirar del uso una resolución que ya consumió numeración** —la de
 * habilitación con prefijo SETP, señaladamente—. El backend rechaza su borrado:
 * es evidencia fiscal de documentos ya reportados a la DIAN.
 */
@Component({
  selector: 'vendix-resolutions-page',
  standalone: true,
  imports: [
    CardComponent,
    ConfirmationModalComponent,
    StatsComponent,
    ResponsiveDataViewComponent,
    OptionsDropdownComponent,
    InputsearchComponent,
    ResolutionCreateComponent,
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

      <!-- Delete confirmation -->
      @if (pending_delete(); as row) {
        <app-confirmation-modal
          [isOpen]="true"
          title="Eliminar resolución"
          [message]="deleteMessage(row)"
          confirmText="Eliminar"
          cancelText="Cancelar"
          confirmVariant="danger"
          (confirm)="confirmDelete(row)"
          (cancel)="cancelDelete()"
        ></app-confirmation-modal>
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

  // State via toSignal (con initialValue obligatorio)
  readonly resolutions = toSignal(this.store.select(selectResolutions), {
    initialValue: [] as InvoiceResolution[],
  });
  readonly loading = toSignal(this.store.select(selectResolutionsLoading), {
    initialValue: false,
  });

  // Local UI state
  readonly search_term = signal('');
  readonly is_create_modal_open = signal(false);
  readonly selected_resolution = signal<InvoiceResolution | null>(null);
  readonly pending_delete = signal<InvoiceResolution | null>(null);
  readonly pending_toggle = signal<InvoiceResolution | null>(null);

  // Derivados
  readonly filteredResolutions = computed(() => {
    const term = this.search_term().trim().toLowerCase();
    const list = this.resolutions();
    if (!term) return list;
    return list.filter(
      (r) =>
        (r.prefix || '').toLowerCase().includes(term) ||
        (r.resolution_number || '').toLowerCase().includes(term) ||
        this.documentLabel(r).toLowerCase().includes(term),
    );
  });

  readonly stats = computed<ResolutionStats>(() => {
    const list = this.resolutions();
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
      action: (row: InvoiceResolution) => this.askToggle(row),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (row: InvoiceResolution) => this.askDelete(row),
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
      },
    },
    badgeTransform: (_val: any) => '',
    detailKeys: [
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

  /**
   * Borrar una resolución es irreversible y el backend lo rechaza cuando ya
   * numeró documentos. Se confirma primero para que el rechazo (o el borrado)
   * sea una decisión, no un clic accidental en la fila equivocada.
   */
  askDelete(row: InvoiceResolution): void {
    this.pending_delete.set(row);
  }

  cancelDelete(): void {
    this.pending_delete.set(null);
  }

  confirmDelete(row: InvoiceResolution): void {
    this.pending_delete.set(null);
    this.store.dispatch(InvoicingActions.deleteResolution({ id: row.id }));
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
      return `${identity} volverá a numerar documentos desde el consecutivo ${row.current_number + 1}. Solo debe haber una resolución activa por tipo de documento: si hay otra, desactívala antes.`;
    }
    const consumed = (row.current_number ?? 0) >= (row.range_from ?? 0);
    const base = `${identity} dejará de numerar documentos nuevos. Los ya emitidos con ella no cambian.`;
    return consumed
      ? `${base} Es la única forma de retirarla: ya consumió numeración ante la DIAN, así que no se puede borrar.`
      : base;
  }

  /**
   * Anticipa el rechazo del backend: una resolución que ya consumió numeración
   * ante la DIAN es evidencia fiscal y no se puede borrar. Decirlo aquí evita
   * que el usuario confirme algo que va a fallar.
   */
  deleteMessage(row: InvoiceResolution): string {
    const consumed = (row.current_number ?? 0) >= (row.range_from ?? 0);
    const identity = `${row.prefix} · ${row.resolution_number}`;
    return consumed
      ? `${identity} ya consumió numeración ante la DIAN (va en ${row.current_number}). No se puede borrar: desactívala para retirarla del uso.`
      : `Se eliminará la resolución ${identity} (rango ${row.range_from} – ${row.range_to}). No ha numerado ningún documento, así que no hay evidencia fiscal que preservar.`;
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
