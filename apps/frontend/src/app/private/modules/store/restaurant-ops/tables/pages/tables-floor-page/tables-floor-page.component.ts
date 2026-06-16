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
import { Table } from '../../interfaces';
import { TablesService } from '../../services/tables.service';
import { TableFloorMapComponent } from '../../components/table-floor-map/table-floor-map.component';
import { OpenTableModalComponent } from '../../components/open-table-modal/open-table-modal.component';
import { SeatBookingModalComponent } from '../../components/seat-booking-modal/seat-booking-modal.component';

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
  ],
  templateUrl: './tables-floor-page.component.html',
  styleUrl: './tables-floor-page.component.scss',
})
export class TablesFloorPageComponent implements OnInit {
  private readonly tablesService = inject(TablesService);
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
    if (status === 'occupied' && t.active_session) {
      this.router.navigate([
        '/admin/restaurant-ops/tables/session',
        t.active_session.id,
      ]);
      return;
    }
    if (status === 'reserved' && (t.pending_bookings?.length ?? 0) > 0) {
      this.seatTable.set(t);
      this.isSeatModalOpen.set(true);
      return;
    }
    if (status === 'available') {
      this.selectedTable.set(t);
      this.isOpenModalOpen.set(true);
    } else {
      this.toastService.error(
        `La mesa ${t.name} no está disponible (${TablesService.statusLabel(status)})`,
      );
    }
  }

  closeSeatModal(): void {
    this.isSeatModalOpen.set(false);
    this.seatTable.set(null);
  }

  onBookingSeated(): void {
    this.loadFloor();
  }

  onOpenSession(dto: { table_id: number; guest_count?: number }): void {
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
