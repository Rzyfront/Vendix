import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import {
  ButtonComponent,
  CardComponent,
  DialogService,
  IconComponent,
  InputButtonOption,
  InputButtonsComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  SpinnerComponent,
  StatsComponent,
  StickyHeaderActionButton,
  StickyHeaderComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../../shared/components/index';
import { Table, TableQrResponse, TableStatus } from '../../interfaces';
import { TablesService } from '../../services/tables.service';
import { TableFloorMapComponent } from '../../components/table-floor-map/table-floor-map.component';
import { TableFormModalComponent } from '../../components/table-form-modal/table-form-modal.component';
import { TableQrModalComponent } from '../../components/table-qr-modal/table-qr-modal.component';

interface TablesStats {
  total: number;
  available: number;
  occupied: number;
  reserved: number;
  cleaning: number;
}

type ViewMode = 'table' | 'floor';

interface TableRow extends Table {
  pos: string;
}

/**
 * Página de gestión de mesas (Restaurant Suite — Fase 1 alignment).
 *
 * Reusa `TablesService` (que ya tenía CRUD sin consumidores) y permite
 * crear / editar / eliminar / reposicionar mesas. Toggle entre vista
 * tabla (lista) y vista plano (drag-to-persist).
 */
@Component({
  selector: 'app-tables-manage-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    IconComponent,
    ButtonComponent,
    InputButtonsComponent,
    SpinnerComponent,
    ResponsiveDataViewComponent,
    TableFloorMapComponent,
    TableFormModalComponent,
    TableQrModalComponent,
  ],
  templateUrl: './tables-manage-page.component.html',
  styleUrl: './tables-manage-page.component.scss',
})
export class TablesManagePageComponent implements OnInit {
  private readonly tablesService = inject(TablesService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly tables = signal<Table[]>([]);
  readonly isLoading = signal(false);
  readonly view = signal<ViewMode>('table');

  readonly viewOptions: InputButtonOption[] = [
    { value: 'table', label: 'Tabla', icon: 'list' },
    { value: 'floor', label: 'Plano', icon: 'layout-grid' },
  ];

  readonly isFormOpen = signal(false);
  readonly editingTable = signal<Table | null>(null);
  readonly isFormLoading = signal(false);

  readonly isQrOpen = signal(false);
  readonly qrTable = signal<Table | null>(null);
  readonly isPrintingAllQr = signal(false);

  readonly floorMapKey = signal(0);

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'refresh',
      label: 'Refrescar',
      variant: 'ghost',
      icon: 'refresh-cw',
    },
    {
      id: 'print-qr',
      label: 'Imprimir QR',
      variant: 'outline',
      icon: 'printer',
      loading: this.isPrintingAllQr(),
      disabled: this.tables().length === 0,
    },
  ]);

  readonly stats = computed<TablesStats>(() => {
    const list = this.tables();
    return {
      total: list.length,
      available: list.filter((t) => t.status === 'available').length,
      occupied: list.filter((t) => t.status === 'occupied').length,
      reserved: list.filter((t) => t.status === 'reserved').length,
      cleaning: list.filter((t) => t.status === 'cleaning').length,
    };
  });

  readonly columns = computed<TableColumn[]>(() => [
    { key: 'name', label: 'Nombre', sortable: true },
    { key: 'zone', label: 'Zona', sortable: true },
    {
      key: 'capacity',
      label: 'Capacidad',
      sortable: true,
      align: 'right',
    },
    { key: 'status', label: 'Estado', sortable: true },
    { key: 'pos', label: 'Plano', align: 'center' },
  ]);

  readonly actions = computed<TableAction[]>(() => [
    {
      label: 'Editar',
      icon: 'edit-2',
      variant: 'primary',
      action: (item: Table) => this.openEdit(item),
    },
    {
      label: 'QR',
      icon: 'barcode',
      variant: 'secondary',
      tooltip: 'Ver e imprimir el QR de la mesa',
      action: (item: Table) => this.openQr(item),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: Table) => this.confirmDelete(item),
    },
  ]);

  readonly cardConfig = computed<ItemListCardConfig>(() => ({
    titleKey: 'name',
    subtitleKey: 'zone',
    descriptionKey: 'status',
    badgeField: 'status',
    icon: 'table',
  }));

  readonly rows = computed<TableRow[]>(() =>
    this.tables().map((t) => ({
      ...t,
      pos:
        t.pos_x != null && t.pos_y != null
          ? `(${t.pos_x}, ${t.pos_y})`
          : '—',
    })),
  );

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.isLoading.set(true);
    this.tablesService
      .listPaginated({ page: 1, limit: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.tables.set(res.data ?? []);
          this.isLoading.set(false);
          this.floorMapKey.update((k) => k + 1);
        },
        error: (err: unknown) => {
          this.isLoading.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al cargar las mesas',
          );
        },
      });
  }

  onHeaderAction(id: string): void {
    if (id === 'refresh') this.load();
    if (id === 'print-qr') this.printAllQr();
  }

  setView(v: string): void {
    if (v !== 'table' && v !== 'floor') return;
    this.view.set(v);
    if (v === 'floor') this.floorMapKey.update((k) => k + 1);
  }

  openCreate(): void {
    this.editingTable.set(null);
    this.isFormOpen.set(true);
  }

  openEdit(t: Table): void {
    this.editingTable.set(t);
    this.isFormOpen.set(true);
  }

  closeForm(): void {
    this.isFormOpen.set(false);
    this.editingTable.set(null);
  }

  openQr(t: Table): void {
    this.qrTable.set(t);
    this.isQrOpen.set(true);
  }

  closeQr(): void {
    this.isQrOpen.set(false);
    this.qrTable.set(null);
  }

  /**
   * Imprime los QR de TODAS las mesas visibles en un solo documento.
   * Itera `getQr` por cada mesa con `forkJoin`, construye un HTML con
   * una grilla de QRs (nombre + zona + QR + URL) y dispara la impresión
   * vía un iframe oculto (patrón de `PosTicketService.printHTML`).
   */
  printAllQr(): void {
    const list = this.tables();
    if (list.length === 0) return;

    this.isPrintingAllQr.set(true);
    forkJoin(
      list.map((t) =>
        this.tablesService.getQr(t.id).pipe(takeUntilDestroyed(this.destroyRef)),
      ),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (results: TableQrResponse[]) => {
          this.isPrintingAllQr.set(false);
          this.printQrSheets(list, results);
        },
        error: (err: unknown) => {
          this.isPrintingAllQr.set(false);
          this.toastService.error(
            typeof err === 'string'
              ? err
              : 'Error al obtener los QR de las mesas',
          );
        },
      });
  }

  private printQrSheets(tables: Table[], results: TableQrResponse[]): void {
    const cards = tables
      .map((t, i) => {
        const r = results[i];
        if (!r) return '';
        const zone = t.zone
          ? `<p style="margin:0 0 8px 0;font-size:13px;color:#555;">Zona: ${this.escapeHtml(t.zone)}</p>`
          : '';
        return `
          <div style="break-inside:avoid;page-break-inside:avoid;text-align:center;border:1px solid #e5e7eb;border-radius:10px;padding:16px;background:#fff;">
            <h3 style="margin:0 0 4px 0;font-size:18px;">${this.escapeHtml(t.name)}</h3>
            ${zone}
            <img src="${r.qr_data_url}" style="width:220px;height:220px;margin:8px auto;" />
            <p style="margin:8px 0 0 0;font-size:10px;color:#666;word-break:break-all;">${this.escapeHtml(r.public_url)}</p>
          </div>
        `;
      })
      .join('');

    const html = `
      <div style="font-family:Arial,sans-serif;">
        <h2 style="text-align:center;margin:0 0 16px 0;">QR de las mesas</h2>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;">
          ${cards}
        </div>
      </div>
    `;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.opacity = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(`
        <html>
          <head>
            <title>QR Mesas</title>
            <style>
              body { margin:0; padding:24px; background:#fff; }
              @media print { body { padding:0; } }
            </style>
          </head>
          <body>${html}</body>
        </html>
      `);
      doc.close();
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }
    setTimeout(() => iframe.remove(), 1000);
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private confirmDelete(t: Table): void {
    this.dialogService
      .confirm({
        title: 'Eliminar mesa',
        message: `¿Eliminar la mesa "${t.name}"? Esta acción no se puede deshacer. Las sesiones activas impedirán la eliminación.`,
        confirmText: 'Eliminar',
        confirmVariant: 'danger',
      })
      .then((ok: boolean) => {
        if (!ok) return;
        this.tablesService
          .remove(t.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.toastService.success('Mesa eliminada');
              this.load();
            },
            error: (err: unknown) => {
              this.toastService.error(
                typeof err === 'string'
                  ? err
                  : 'No se pudo eliminar la mesa. Verifica que no tenga sesiones activas.',
              );
            },
          });
      });
  }

  onFormSaved(): void {
    this.load();
  }

  /**
   * Drag-drop persist en el plano: actualiza pos_x/pos_y con throttle
   * por mesa para no martillar el backend.
   */
  private readonly pendingMoves = new Set<number>();
  onTableMoved(ev: { id: number; pos_x: number; pos_y: number }): void {
    if (this.pendingMoves.has(ev.id)) return;
    this.pendingMoves.add(ev.id);
    this.tablesService
      .update(ev.id, { pos_x: ev.pos_x, pos_y: ev.pos_y })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.pendingMoves.delete(ev.id);
        },
        error: (err: unknown) => {
          this.pendingMoves.delete(ev.id);
          this.toastService.error(
            typeof err === 'string'
              ? err
              : 'Error al guardar la posición de la mesa',
          );
        },
      });
  }

  statusLabel(s: TableStatus): string {
    return TablesService.statusLabel(s);
  }

  trackById(_i: number, t: Table): number {
    return t.id;
  }
}
