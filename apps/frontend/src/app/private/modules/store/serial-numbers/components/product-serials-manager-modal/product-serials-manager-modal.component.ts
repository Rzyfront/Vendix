import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  TextareaComponent,
  SelectorComponent,
  SelectorOption,
  InputsearchComponent,
  DateRangePickerComponent,
  ResponsiveDataViewComponent,
  PaginationComponent,
  IconComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  ToastService,
  DialogService,
} from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { DateRange } from '../../../../../../shared/components/date-range-picker/date-range-picker.component';
import { formatDateOnlyUTC, toUTCDateString } from '../../../../../../shared/utils/date.util';

import { SerialBulkLoadModalComponent } from '../serial-bulk-load-modal/serial-bulk-load-modal.component';
import {
  SerialNumber,
  SerialNumberQuery,
  SerialNumberStatus,
  SerialNumbersService,
} from '../../services/serial-numbers.service';

/**
 * Stock level slice consumed by the modal. Mirrors the shape the parent passes
 * from `product.stock_levels`; only the fields used here are typed.
 */
export interface SerialStockLevel {
  location_id: number;
  quantity_on_hand?: number | null;
  quantity_available?: number | null;
  inventory_locations?: { id: number; name: string } | null;
}

/** Estado enum → etiqueta en español (espejo de la lista de seriales). */
const STATUS_LABELS: Record<SerialNumberStatus, string> = {
  in_stock: 'En stock',
  reserved: 'Reservado',
  sold: 'Vendido',
  returned: 'Devuelto',
  damaged: 'Dañado',
  expired: 'Expirado',
  in_transit: 'En tránsito',
};

/** Mapa de color por estado (hex de 7 caracteres, exigido por badge custom). */
const STATUS_COLOR_MAP: Record<string, string> = {
  in_stock: '#22c55e',
  reserved: '#f59e0b',
  sold: '#3b82f6',
  returned: '#a855f7',
  damaged: '#ef4444',
  expired: '#6b7280',
  in_transit: '#06b6d4',
};

/** Garantía derivada → etiqueta + color (hex 7 chars para el badge custom). */
type WarrantyState = 'none' | 'valid' | 'expiring' | 'expired';
const WARRANTY_LABELS: Record<WarrantyState, string> = {
  none: 'Sin garantía',
  valid: 'Vigente',
  expiring: 'Por vencer',
  expired: 'Vencida',
};
const WARRANTY_COLOR_MAP: Record<string, string> = {
  none: '#9ca3af',
  valid: '#22c55e',
  expiring: '#f59e0b',
  expired: '#ef4444',
};

const statusBadgeTransform = (value: SerialNumberStatus | string): string =>
  STATUS_LABELS[value as SerialNumberStatus] ?? String(value ?? '-');

/** Flattened row with the derived warranty state pre-resolved. */
interface SerialRow extends SerialNumber {
  warranty_state: WarrantyState;
}

/**
 * QUI-431 — Self-contained LG modal for full serial-number management of a
 * product (or a specific variant). Lists/searches/filters the serial pool by
 * location, supports inline add/edit/delete, and wraps the existing bulk-load
 * modal for backfill. Fully zoneless + signals; the parent only declares it.
 */
@Component({
  selector: 'app-product-serials-manager-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    TextareaComponent,
    SelectorComponent,
    InputsearchComponent,
    DateRangePickerComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    IconComponent,
    SerialBulkLoadModalComponent,
  ],
  templateUrl: './product-serials-manager-modal.component.html',
})
export class ProductSerialsManagerModalComponent {
  private readonly serialNumbersService = inject(SerialNumbersService);
  private readonly toast = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  // ─── Inputs / Outputs ───────────────────────────────────────────────────
  readonly isOpen = model<boolean>(false);
  readonly productId = input<number | null>(null);
  readonly productVariantId = input<number | null>(null);
  readonly stockLevels = input<SerialStockLevel[]>([]);

  /** Emitted after any add/edit/delete/bulk-load so the parent refreshes. */
  readonly changed = output<void>();

  // ─── List state ─────────────────────────────────────────────────────────
  readonly serials = signal<SerialRow[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly limit = signal(10);
  readonly isLoading = signal(false);
  /** Guards the lazy load so it only fires once per open cycle. */
  private readonly loaded = signal(false);

  // ─── Filters ────────────────────────────────────────────────────────────
  readonly selectedLocationId = signal<number | null>(null);
  readonly statusFilter = signal<'all' | SerialNumberStatus>('all');
  readonly searchTerm = signal('');
  readonly warrantyFrom = signal<string | null>(null);
  readonly warrantyTo = signal<string | null>(null);

  readonly totalPages = computed(
    () => Math.ceil(this.total() / this.limit()) || 1,
  );

  /** Location options derived from the stock levels passed by the parent. */
  readonly locationOptions = computed<SelectorOption[]>(() =>
    this.stockLevels().map((sl) => ({
      value: sl.location_id,
      label: sl.inventory_locations?.name
        ? `${sl.inventory_locations.name} (${sl.quantity_on_hand ?? 0} u.)`
        : `Ubicación ${sl.location_id}`,
    })),
  );

  /** on_hand units of the selected location → maxCount hint for backfill. */
  readonly selectedLocationStock = computed<number | null>(() => {
    const locId = this.selectedLocationId();
    if (locId == null) return null;
    const level = this.stockLevels().find((sl) => sl.location_id === locId);
    return level ? (level.quantity_on_hand ?? 0) : null;
  });

  readonly statusFilterOptions: SelectorOption[] = [
    { value: 'all', label: 'Todos los estados' },
    ...(Object.keys(STATUS_LABELS) as SerialNumberStatus[]).map((value) => ({
      value,
      label: STATUS_LABELS[value],
    })),
  ];

  /** Status options for the add/edit form (no synthetic 'all'). */
  readonly statusOptions: SelectorOption[] = (
    Object.keys(STATUS_LABELS) as SerialNumberStatus[]
  ).map((value) => ({ value, label: STATUS_LABELS[value] }));

  // ─── Table / cards ──────────────────────────────────────────────────────
  readonly tableColumns: TableColumn[] = [
    { key: 'serial_number', label: 'Serial', sortable: false, priority: 1 },
    {
      key: 'status',
      label: 'Estado',
      priority: 1,
      transform: (value: SerialNumberStatus | string) =>
        statusBadgeTransform(value),
      badge: true,
      badgeConfig: { type: 'custom', size: 'sm', colorMap: STATUS_COLOR_MAP },
    },
    {
      key: 'cost',
      label: 'Costo',
      priority: 2,
      align: 'right',
      transform: (value: string | number | null) =>
        value == null || value === ''
          ? '-'
          : this.currencyService.format(Number(value) || 0),
    },
    {
      key: 'warranty_expiry',
      label: 'Garantía',
      priority: 2,
      transform: (value: string | null) =>
        value ? formatDateOnlyUTC(value) : '-',
    },
    {
      key: 'warranty_state',
      label: 'Estado garantía',
      priority: 2,
      transform: (value: WarrantyState | string) =>
        WARRANTY_LABELS[value as WarrantyState] ?? '-',
      badge: true,
      badgeConfig: { type: 'custom', size: 'sm', colorMap: WARRANTY_COLOR_MAP },
    },
    { key: 'notes', label: 'Notas', priority: 3, defaultValue: '-' },
    {
      key: 'created_at',
      label: 'Creado',
      priority: 3,
      transform: (value: string | null) =>
        value ? formatDateOnlyUTC(value) : '-',
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'serial_number',
    avatarFallbackIcon: 'hash',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: { type: 'custom', size: 'sm', colorMap: STATUS_COLOR_MAP },
    badgeTransform: (value: SerialNumberStatus | string) =>
      statusBadgeTransform(value),
    detailKeys: [
      {
        key: 'cost',
        label: 'Costo',
        icon: 'hash',
        transform: (value: string | number | null) =>
          value == null || value === ''
            ? '-'
            : this.currencyService.format(Number(value) || 0),
      },
      {
        key: 'warranty_expiry',
        label: 'Garantía',
        icon: 'shield',
        transform: (value: string | null) =>
          value ? formatDateOnlyUTC(value) : 'Sin garantía',
      },
      { key: 'notes', label: 'Notas', icon: 'file-text' },
    ],
  };

  readonly tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      action: (item: SerialRow) => this.openEdit(item),
      variant: 'secondary',
      tooltip: 'Editar serial, costo, estado, garantía o notas',
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (item: SerialRow) => void this.onDelete(item),
      variant: 'danger',
      tooltip: 'Eliminar serial',
    },
  ];

  // ─── Bulk-load modal ────────────────────────────────────────────────────
  readonly bulkModalOpen = signal(false);

  // ─── Add/Edit form (signal-based) ───────────────────────────────────────
  readonly formOpen = signal(false);
  /** null → create mode; a serial → edit mode. */
  readonly editingSerial = signal<SerialNumber | null>(null);
  readonly formSerialNumber = signal('');
  readonly formCost = signal<number | null>(null);
  readonly formStatus = signal<SerialNumberStatus>('in_stock');
  readonly formWarranty = signal<string | null>(null);
  readonly formNotes = signal('');
  readonly formSaving = signal(false);

  readonly isEditMode = computed(() => this.editingSerial() != null);

  constructor() {
    // Lazy load on first open; reset the guard when the modal closes.
    effect(() => {
      if (this.isOpen()) {
        if (!this.loaded()) {
          this.loaded.set(true);
          this.initLocationDefault();
          this.load();
        }
      } else {
        this.loaded.set(false);
      }
    });
  }

  /** Pick the first location with stock > 0 (else the first available). */
  private initLocationDefault(): void {
    if (this.selectedLocationId() != null) return;
    const levels = this.stockLevels();
    if (levels.length === 0) return;
    const withStock = levels.find((sl) => (sl.quantity_on_hand ?? 0) > 0);
    this.selectedLocationId.set(
      withStock ? withStock.location_id : levels[0].location_id,
    );
  }

  // ─── Data loading ─────────────────────────────────────────────────────────
  load(): void {
    const productId = this.productId();
    if (productId == null) return;
    this.isLoading.set(true);

    const query: SerialNumberQuery = {
      product_id: productId,
      page: this.page(),
      limit: this.limit(),
    };
    const variantId = this.productVariantId();
    if (variantId != null) query.product_variant_id = variantId;
    const locId = this.selectedLocationId();
    if (locId != null) query.location_id = locId;
    const status = this.statusFilter();
    if (status !== 'all') query.status = status;
    const search = this.searchTerm().trim();
    if (search) query.search = search;
    const wFrom = this.warrantyFrom();
    if (wFrom) query.warranty_expiry_from = wFrom;
    const wTo = this.warrantyTo();
    if (wTo) query.warranty_expiry_to = wTo;

    this.serialNumbersService
      .listPaginated(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const rows = (response.data ?? []).map((row) => ({
            ...row,
            warranty_state: this.deriveWarrantyState(row.warranty_expiry),
          }));
          this.serials.set(rows);
          this.total.set(
            response.meta?.pagination?.total ?? rows.length,
          );
          this.isLoading.set(false);
        },
        error: (error) => {
          this.toast.error(
            typeof error === 'string'
              ? error
              : 'Error al cargar los números de serie',
          );
          this.isLoading.set(false);
        },
      });
  }

  /** Reset to page 1 and reload. Used by every filter change. */
  private reload(): void {
    this.page.set(1);
    this.load();
  }

  /**
   * Derive the warranty health bucket. `expiring` means ≤ 30 days remaining.
   * Compared in UTC to match the date-only backend values.
   */
  private deriveWarrantyState(warranty: string | null): WarrantyState {
    if (!warranty) return 'none';
    const expiry = new Date(warranty);
    if (Number.isNaN(expiry.getTime())) return 'none';
    const now = new Date();
    const today = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    const exp = Date.UTC(
      expiry.getUTCFullYear(),
      expiry.getUTCMonth(),
      expiry.getUTCDate(),
    );
    const days = Math.floor((exp - today) / 86_400_000);
    if (days < 0) return 'expired';
    if (days <= 30) return 'expiring';
    return 'valid';
  }

  // ─── Filter handlers ──────────────────────────────────────────────────────
  onLocationChange(value: string | number | null): void {
    this.selectedLocationId.set(value == null ? null : Number(value));
    this.reload();
  }

  onStatusFilterChange(value: string | number | null): void {
    const v =
      value == null || value === '' ? 'all' : (value as SerialNumberStatus);
    this.statusFilter.set(v);
    this.reload();
  }

  onSearch(term: string): void {
    this.searchTerm.set(term ?? '');
    this.reload();
  }

  onWarrantyRangeChange(range: DateRange): void {
    this.warrantyFrom.set(range.from);
    this.warrantyTo.set(range.to);
    this.reload();
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  // ─── Bulk load ──────────────────────────────────────────────────────────
  openBulkModal(): void {
    if (this.selectedLocationId() == null) {
      this.toast.warning('Selecciona una ubicación primero');
      return;
    }
    this.bulkModalOpen.set(true);
  }

  onBulkCompleted(): void {
    this.reload();
    this.changed.emit();
  }

  // ─── Add / Edit form ──────────────────────────────────────────────────────
  /** Open the form in create mode. Requires a selected location. */
  openCreate(): void {
    if (this.selectedLocationId() == null) {
      this.toast.warning('Selecciona una ubicación primero');
      return;
    }
    this.editingSerial.set(null);
    this.formSerialNumber.set('');
    this.formCost.set(null);
    this.formStatus.set('in_stock');
    this.formWarranty.set(null);
    this.formNotes.set('');
    this.formOpen.set(true);
  }

  /** Open the form in edit mode, prefilled from the row. */
  openEdit(serial: SerialNumber): void {
    this.editingSerial.set(serial);
    this.formSerialNumber.set(serial.serial_number ?? '');
    this.formCost.set(serial.cost == null ? null : Number(serial.cost));
    this.formStatus.set(serial.status);
    this.formWarranty.set(
      serial.warranty_expiry
        ? toUTCDateString(new Date(serial.warranty_expiry))
        : null,
    );
    this.formNotes.set(serial.notes ?? '');
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.editingSerial.set(null);
  }

  onFormStatusChange(value: string | number | null): void {
    if (value != null) this.formStatus.set(value as SerialNumberStatus);
  }

  onFormWarrantyChange(value: string): void {
    this.formWarranty.set(value && value.trim() ? value : null);
  }

  saveForm(): void {
    const serialNumber = this.formSerialNumber().trim();
    if (!serialNumber) {
      this.toast.error('El número de serie no puede estar vacío');
      return;
    }
    if (this.isEditMode()) {
      this.saveEdit(serialNumber);
    } else {
      this.saveCreate(serialNumber);
    }
  }

  /** Create a single serial via the bulk endpoint with one item. */
  private saveCreate(serialNumber: string): void {
    const productId = this.productId();
    const locationId = this.selectedLocationId();
    if (productId == null || locationId == null) {
      this.toast.error('Faltan producto o ubicación');
      return;
    }

    const cost = this.formCost();
    const warranty = this.formWarranty();
    const notes = this.formNotes().trim();
    const variantId = this.productVariantId();

    this.formSaving.set(true);
    this.serialNumbersService
      .bulkCreate({
        product_id: productId,
        location_id: locationId,
        ...(variantId != null ? { product_variant_id: variantId } : {}),
        items: [
          {
            serial_number: serialNumber,
            ...(cost != null ? { cost } : {}),
            ...(warranty ? { warranty_expiry: warranty } : {}),
            ...(notes ? { notes } : {}),
          },
        ],
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.formSaving.set(false);
          if (res.failed.length > 0) {
            this.toast.error(
              res.failed[0]?.reason ?? 'No se pudo crear el serial',
            );
            return;
          }
          this.toast.success('Serial agregado');
          this.closeForm();
          this.reload();
          this.changed.emit();
        },
        error: (error) => {
          this.formSaving.set(false);
          this.toast.error(
            typeof error === 'string' ? error : 'Error al agregar el serial',
          );
        },
      });
  }

  /** Persist editable fields; transition status separately if it changed. */
  private saveEdit(serialNumber: string): void {
    const serial = this.editingSerial();
    if (!serial) return;

    const dto: {
      serial_number?: string;
      notes?: string;
      cost?: number;
      warranty_expiry?: string | null;
    } = {};

    if (serialNumber !== serial.serial_number) dto.serial_number = serialNumber;

    const notes = this.formNotes().trim();
    if (notes !== (serial.notes ?? '')) dto.notes = notes;

    const cost = this.formCost();
    const oldCost = serial.cost == null ? null : Number(serial.cost);
    if (cost != null && cost !== oldCost) dto.cost = cost;

    const newWarranty = this.formWarranty();
    const oldWarranty = serial.warranty_expiry
      ? toUTCDateString(new Date(serial.warranty_expiry))
      : null;
    if (newWarranty !== oldWarranty) {
      // Empty clears the warranty (null); otherwise send the YYYY-MM-DD string.
      dto.warranty_expiry = newWarranty;
    }

    const newStatus = this.formStatus();
    const statusChanged = newStatus !== serial.status;
    const hasFieldChanges = Object.keys(dto).length > 0;

    if (!hasFieldChanges && !statusChanged) {
      this.closeForm();
      return;
    }

    this.formSaving.set(true);

    const update$ = hasFieldChanges
      ? this.serialNumbersService.update(serial.id, dto)
      : of(serial);

    update$
      .pipe(
        switchMap((updated) =>
          statusChanged
            ? this.serialNumbersService.updateStatus(serial.id, newStatus)
            : of(updated),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.formSaving.set(false);
          this.toast.success('Serial actualizado');
          this.closeForm();
          this.load();
          this.changed.emit();
        },
        error: (error) => {
          this.formSaving.set(false);
          this.toast.error(
            typeof error === 'string' ? error : 'Error al actualizar el serial',
          );
        },
      });
  }

  // ─── Delete ─────────────────────────────────────────────────────────────
  async onDelete(serial: SerialNumber): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Eliminar número de serie',
      message: `¿Eliminar el serial "${serial.serial_number}"? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.serialNumbersService
      .remove(serial.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Serial eliminado');
          // If it was the last row on the page, step back one page.
          if (this.serials().length === 1 && this.page() > 1) {
            this.page.update((p) => p - 1);
          }
          this.load();
          this.changed.emit();
        },
        error: (error) => {
          // The service surfaces the backend message (incl. 409
          // SERIAL_DELETE_BLOCKED) as a string.
          this.toast.error(
            typeof error === 'string' ? error : 'No se pudo eliminar el serial',
          );
        },
      });
  }

  /** Modal chrome close (backdrop/escape/x) keeps parent state in sync. */
  onModalOpenChange(open: boolean): void {
    this.isOpen.set(open);
  }
}
