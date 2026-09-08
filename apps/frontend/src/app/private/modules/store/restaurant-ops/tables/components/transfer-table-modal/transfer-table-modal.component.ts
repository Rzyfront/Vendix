import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
  SpinnerComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { Table, TableStatus, TransferResult } from '../../interfaces';
import { TablesService } from '../../services/tables.service';

/**
 * Modal de destino para "Cambiar de mesa" (PLAN-cambio-mesa-swap · paso 6).
 *
 * Patrón de `quick-status-modal` / `seat-booking-modal`: visibilidad por
 * `isOpen` / `isOpenChange`, mesa origen en `table`, lista completa en
 * `tables`. El footer Confirmar (habilitado solo con destino válido)
 * llama `TablesService.transferSession`; al éxito emite `confirmed` con
 * el `TransferResult` y se cierra. El padre toastea y recarga en
 * `onTransferConfirmed`.
 *
 * Reglas de selección:
 *  - el origen se lista marcado con "Origen" y no es elegible;
 *  - `reserved` se lista deshabilitada con tooltip (el backend la
 *    rechaza con 409 `TABLE_INVALID_STATUS`);
 *  - el mensaje previo anticipa swap (destino ocupado) o traslado.
 */
@Component({
  selector: 'app-transfer-table-modal',
  standalone: true,
  imports: [
    CommonModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    SpinnerComponent,
  ],
  templateUrl: './transfer-table-modal.component.html',
  styleUrl: './transfer-table-modal.component.scss',
})
export class TransferTableModalComponent {
  private readonly tablesService = inject(TablesService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  readonly table = input<Table | null>(null);
  readonly tables = input<Table[]>([]);

  readonly isOpenChange = output<boolean>();
  readonly confirmed = output<TransferResult>();

  readonly selectedId = signal<number | null>(null);
  readonly isConfirming = signal(false);
  readonly isLoadingTables = signal(false);
  private readonly fetchedTables = signal<Table[]>([]);

  /**
   * La página ya trae la lista enriquecida (con `active_session` y
   * `effective_status` cruzados del floor-map en `load()`); solo si el
   * padre la pasa vacía se carga `getFloorMap()` aquí (paso 6: el modal
   * carga el floor-map).
   */
  readonly allTables = computed<Table[]>(() =>
    this.tables().length > 0 ? this.tables() : this.fetchedTables(),
  );

  readonly source = computed(() => this.table());

  readonly target = computed<Table | null>(() => {
    const id = this.selectedId();
    if (id == null) return null;
    return this.allTables().find((t) => t.id === id) ?? null;
  });

  readonly targetOccupied = computed(() => {
    const t = this.target();
    if (!t) return false;
    return t.active_session != null || this.statusOf(t) === 'occupied';
  });

  readonly isTargetValid = computed(() => {
    const s = this.source();
    const t = this.target();
    if (!s || !t) return false;
    if (t.id === s.id) return false;
    return this.statusOf(t) !== 'reserved';
  });

  readonly canConfirm = computed(
    () =>
      this.isTargetValid() && !this.isConfirming() && !this.isLoadingTables(),
  );

  readonly previewMessage = computed(() => {
    const s = this.source();
    const t = this.target();
    if (!s || !t || !this.isTargetValid()) return '';
    return this.targetOccupied()
      ? `${s.name} ↔ ${t.name} intercambian cuentas`
      : `${s.name} → ${t.name}; ${s.name} queda Disponible`;
  });

  readonly title = computed(() => {
    const s = this.source();
    return s ? `Cambiar de mesa — ${s.name}` : 'Cambiar de mesa';
  });

  constructor() {
    // Resetea la selección en cada apertura o cambio de origen (mismo
    // patrón que quick-status-modal con `selectedStatus`).
    effect(() => {
      this.table();
      this.isOpen();
      this.selectedId.set(null);
      this.isConfirming.set(false);
    });
    // Carga perezosa del floor-map solo cuando el padre no pasó lista.
    effect(() => {
      if (
        this.isOpen() &&
        this.tables().length === 0 &&
        this.fetchedTables().length === 0 &&
        !this.isLoadingTables()
      ) {
        this.isLoadingTables.set(true);
        this.tablesService
          .getFloorMap()
          .pipe(
            takeUntilDestroyed(this.destroyRef),
            catchError(() => of([] as Table[])),
          )
          .subscribe({
            next: (list) => {
              this.fetchedTables.set(list);
              this.isLoadingTables.set(false);
            },
            error: () => this.isLoadingTables.set(false),
          });
      }
    });
  }

  close(): void {
    this.isOpenChange.emit(false);
  }

  /** Estado real: `effective_status` del floor-map, si no el persistido. */
  statusOf(t: Table): TableStatus {
    return t.effective_status ?? t.status;
  }

  statusLabel(s: TableStatus): string {
    return TablesService.statusLabel(s);
  }

  statusColor(s: TableStatus): string {
    return TablesService.statusColorVar(s);
  }

  isOrigin(t: Table): boolean {
    return this.source()?.id === t.id;
  }

  isReserved(t: Table): boolean {
    return this.statusOf(t) === 'reserved';
  }

  /** Fila elegible: ni origen ni reservada. */
  isSelectable(t: Table): boolean {
    return !this.isOrigin(t) && !this.isReserved(t);
  }

  isSelected(t: Table): boolean {
    return this.selectedId() === t.id;
  }

  select(t: Table): void {
    if (!this.isSelectable(t) || this.isConfirming()) return;
    this.selectedId.set(t.id);
  }

  /**
   * Línea de cuenta abierta: nº de sesión + nº de personas; total e
   * ítems solo cuando la proyección trae la orden enriquecida ("si
   * hay" — el floor-map trae solo el resumen de sesión).
   */
  accountLine(t: Table): string | null {
    const s = t.active_session;
    if (!s) return null;
    const parts = [`Sesión #${s.id}`];
    if (s.guest_count != null) parts.push(`${s.guest_count} pers.`);
    const order = (
      s as unknown as {
        order?: {
          grand_total?: number | string;
          order_items?: unknown[];
        };
      }
    ).order;
    if (order?.grand_total != null) parts.push(`Total ${order.grand_total}`);
    if (Array.isArray(order?.order_items) && order.order_items.length > 0) {
      parts.push(`${order.order_items.length} ítems`);
    }
    return parts.join(' · ');
  }

  confirm(): void {
    const s = this.source();
    const t = this.target();
    if (!s || !t || !this.isTargetValid() || this.isConfirming()) return;
    this.isConfirming.set(true);
    this.tablesService
      .transferSession(s.id, t.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.isConfirming.set(false);
          this.confirmed.emit(result);
          this.close();
        },
        error: (err: unknown) => {
          this.isConfirming.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'No se pudo cambiar la mesa',
          );
        },
      });
  }

  trackById(_i: number, t: Table): number {
    return t.id;
  }
}
