import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  /** Mensaje del último floor-map fallido; se limpia en cada apertura. */
  readonly loadError = signal<string | null>(null);
  private readonly fetchedTables = signal<Table[]>([]);
  /**
   * Memoriza que ya se intentó el GET en ESTA apertura. Es la guarda que
   * corta el bucle: sin ella, la rama de error volvía a dejar todas las
   * condiciones en verde y el modal repetía la petición sin tope.
   */
  private readonly hasFetched = signal(false);

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
    /*
     * Un ÚNICO effect que depende solo de `isOpen` y `table`, y que hace
     * todas sus escrituras dentro de `untracked`.
     *
     * Antes había dos: el segundo leía `fetchedTables` / `isLoadingTables`
     * en su guarda y las escribía en la respuesta. En la rama de error
     * (`catchError(() => of([]))`) volvía a dejar las tres condiciones en
     * verde, el effect se re-disparaba y el navegador martillaba
     * `GET floor-map` mientras el modal estuviera abierto. Leer y escribir
     * la misma señal dentro de un effect es exactamente lo que no se debe
     * hacer.
     */
    effect(() => {
      const open = this.isOpen();
      this.table();
      untracked(() => {
        // Reset de selección en cada apertura o cambio de origen (mismo
        // patrón que quick-status-modal con `selectedStatus`).
        this.selectedId.set(null);
        this.isConfirming.set(false);
        if (!open) return;
        // Cada apertura invalida la lista cacheada: el modal vive montado
        // fuera de un `@if`, así que sin esto la primera carga quedaba
        // congelada de por vida y la vista previa prometía un traslado
        // donde el backend ya iba a hacer un swap (o ofrecía mesas que
        // entretanto pasaron a `reserved` y responden 409).
        this.fetchedTables.set([]);
        this.loadError.set(null);
        this.hasFetched.set(false);
        this.loadFloorMap();
      });
    });
  }

  /**
   * Carga perezosa del floor-map: solo cuando el padre no pasó lista y
   * como MUCHO una vez por apertura. `hasFetched` se marca ANTES de
   * disparar la petición, de modo que ni el éxito ni el error pueden
   * reabrir el ciclo; para reintentar hay que cerrar y volver a abrir.
   */
  private loadFloorMap(): void {
    if (this.hasFetched() || this.isLoadingTables()) return;
    if (this.tables().length > 0) return;
    this.hasFetched.set(true);
    this.isLoadingTables.set(true);
    this.tablesService
      .getFloorMap()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.fetchedTables.set(list ?? []);
          this.isLoadingTables.set(false);
        },
        error: (err: unknown) => {
          this.isLoadingTables.set(false);
          // El error deja de disfrazarse de "lista vacía": se guarda y se
          // toastea para que el mesero sepa que falló la carga y no lea
          // "No hay mesas para elegir destino" como si el salón estuviera
          // sin mesas.
          const message =
            typeof err === 'string'
              ? err
              : 'No se pudieron cargar las mesas destino. Cierra y vuelve a abrir para reintentar.';
          this.loadError.set(message);
          this.toastService.error(message);
        },
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
