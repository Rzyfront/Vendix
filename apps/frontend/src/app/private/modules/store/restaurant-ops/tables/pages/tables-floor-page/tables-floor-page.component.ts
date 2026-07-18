import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CardComponent,
  SpinnerComponent,
  StatsComponent,
  StickyHeaderActionButton,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { Table, TableStatus, OpenTableSessionDto } from '../../interfaces';
import { TablesService } from '../../services/tables.service';
import {
  AdminTablesLivePayload,
  AdminTablesSseService,
} from '../../services/admin-tables-sse.service';
import { TableFloorMapComponent } from '../../components/table-floor-map/table-floor-map.component';
import { OpenTableModalComponent } from '../../components/open-table-modal/open-table-modal.component';
import { SeatBookingModalComponent } from '../../components/seat-booking-modal/seat-booking-modal.component';
import { QuickStatusModalComponent } from '../../components/quick-status-modal/quick-status-modal.component';

interface TablesStats {
  total: number;
  available: number;
  occupied: number;
  reserved: number;
  cleaning: number;
}

/**
 * Floor-map page.
 *
 * Renders the entire floor (every `tables` row) and lets the operator
 * open an available table or jump into an existing session. State is
 * pulled from the `floor-map` endpoint, which returns the live
 * `effective_status` (occupied if a session is open).
 */
@Component({
  selector: 'app-tables-floor-page',
  standalone: true,
  imports: [
    CommonModule,
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    SpinnerComponent,
    TableFloorMapComponent,
    OpenTableModalComponent,
    SeatBookingModalComponent,
    QuickStatusModalComponent,
  ],
  templateUrl: './tables-floor-page.component.html',
  styleUrl: './tables-floor-page.component.scss',
})
export class TablesFloorPageComponent implements OnInit {
  private readonly tablesService = inject(TablesService);
  private readonly adminTablesSseService = inject(AdminTablesSseService);
  private readonly router = inject(Router);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly tables = signal<Table[]>([]);
  readonly isLoading = signal(false);
  readonly selectedTable = signal<Table | null>(null);
  readonly isOpenModalOpen = signal(false);
  readonly isOpeningSession = signal(false);
  readonly isSeatModalOpen = signal(false);
  readonly seatTable = signal<Table | null>(null);
  readonly isQuickStatusOpen = signal(false);
  readonly quickStatusTable = signal<Table | null>(null);

  /**
   * Live counts de mesas con sesión abierta, alimentados por el SSE
   * staff. Se renderizan como badges sobre la celda correspondiente.
   * Vacío hasta que llegue el primer `snapshot` o un `item_added` con
   * `session_id` conocido.
   */
  readonly liveCounts = computed<Map<number, AdminTablesLivePayload>>(
    () => this.adminTablesSseService.tablesLive(),
  );
  readonly sseConnectionState = computed(
    () => this.adminTablesSseService.connectionState(),
  );
  readonly sseMode = computed(() => this.adminTablesSseService.mode());

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'manage',
      label: 'Gestionar mesas',
      variant: 'outline',
      icon: 'settings',
    },
    {
      id: 'refresh',
      label: 'Refrescar',
      variant: 'ghost',
      icon: 'refresh-cw',
    },
  ]);

  readonly stats = computed<TablesStats>(() => {
    const list = this.tables();
    return {
      total: list.length,
      available: list.filter((t) => (t.effective_status ?? t.status) === 'available').length,
      occupied: list.filter((t) => (t.effective_status ?? t.status) === 'occupied').length,
      reserved: list.filter((t) => (t.effective_status ?? t.status) === 'reserved').length,
      cleaning: list.filter((t) => (t.effective_status ?? t.status) === 'cleaning').length,
    };
  });

  ngOnInit(): void {
    this.loadFloor();
    // Conectar el SSE staff al entrar a la página. La desconexión
    // ocurre en `DestroyRef.onDestroy` (zoneless-safe; equivalente a
    // ngOnDestroy sin la sobrecarga del ciclo de vida Angular clásico).
    this.adminTablesSseService.connect();
    this.destroyRef.onDestroy(() => {
      this.adminTablesSseService.disconnect();
    });
  }

  loadFloor(): void {
    this.isLoading.set(true);
    this.tablesService
      .getFloorMap()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.tables.set(data);
          this.isLoading.set(false);
        },
        error: (err: unknown) => {
          this.isLoading.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al cargar el mapa de mesas',
          );
        },
      });
  }

  onHeaderAction(id: string): void {
    if (id === 'manage') {
      this.router.navigate(['/admin/restaurant-ops/tables/manage']);
    } else if (id === 'refresh') {
      this.loadFloor();
    }
  }

  onTableClick(t: Table): void {
    const status = t.effective_status ?? t.status;
    // Shortcut 1: occupied + active session → navigate (current behavior).
    if (status === 'occupied' && t.active_session) {
      this.router.navigate([
        '/admin/restaurant-ops/tables/session',
        t.active_session.id,
      ]);
      return;
    }
    // Shortcut 2: reserved with pending bookings → seat modal.
    if (status === 'reserved' && (t.pending_bookings?.length ?? 0) > 0) {
      this.seatTable.set(t);
      this.isSeatModalOpen.set(true);
      return;
    }
    // Shortcut 3: available without an active session → open-table modal
    // (preserves the original UX for the happy path).
    if (status === 'available' && !t.active_session) {
      this.selectedTable.set(t);
      this.isOpenModalOpen.set(true);
      return;
    }
    // Shortcut 4: mesa marcada como `occupied` por un escaneo de QR-mesa
    // pero sin sesión POS abierta todavía. El operador adopta la mesa
    // abriendo una sesión sobre la misma fila (backend ya lo permite
    // en `openTableSessionPublic` / `openSession`; el form del modal
    // reusa el mismo flujo POS estándar).
    if (t.status === 'occupied' && !t.active_session) {
      this.selectedTable.set(t);
      this.isOpenModalOpen.set(true);
      return;
    }
    // Everything else (cleaning, reserved without bookings, etc.) opens
    // the quick-status modal so the operator can flip the mesa to another
    // state without leaving the floor page.
    this.openQuickStatus(t);
  }

  openQuickStatus(t: Table): void {
    this.quickStatusTable.set(t);
    this.isQuickStatusOpen.set(true);
  }

  closeQuickStatus(): void {
    this.isQuickStatusOpen.set(false);
    this.quickStatusTable.set(null);
  }

  onQuickStatusChanged(_status: TableStatus): void {
    // Modal already closed itself; reload the floor map to reflect the
    // new status on every cell.
    this.closeQuickStatus();
    this.loadFloor();
  }

  closeSeatModal(): void {
    this.isSeatModalOpen.set(false);
    this.seatTable.set(null);
  }

  onBookingSeated(): void {
    this.loadFloor();
  }

  onOpenSession(dto: OpenTableSessionDto): void {
    // The modal emits the full `OpenTableSessionDto` (including the optional
    // `customer_id`); forward it verbatim so the chosen client reaches the
    // backend instead of being dropped by a narrower local type (Paso 10).
    this.isOpeningSession.set(true);
    this.tablesService
      .openSession(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (session) => {
          this.isOpeningSession.set(false);
          this.isOpenModalOpen.set(false);
          this.selectedTable.set(null);
          this.toastService.success(`Mesa abierta — sesión #${session.id}`);
          this.router.navigate([
            '/admin/restaurant-ops/tables/session',
            session.id,
          ]);
          this.loadFloor();
        },
        error: (err: unknown) => {
          this.isOpeningSession.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al abrir la mesa',
          );
        },
      });
  }

  onCloseModal(): void {
    this.isOpenModalOpen.set(false);
    this.selectedTable.set(null);
  }
}
