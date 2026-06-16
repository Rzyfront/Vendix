import {
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { Table, TableStatus } from '../../interfaces';
import { TablesService } from '../../services/tables.service';

interface TableCell {
  table: Table;
  displayStatus: TableStatus;
  statusLabel: string;
  statusColor: string;
  isOccupied: boolean;
  guestCount: number | null;
}

export interface TableMovedEvent {
  id: number;
  pos_x: number;
  pos_y: number;
}

/**
 * Floor-map view of all restaurant tables.
 *
 * Modos:
 *  - Solo-lectura (default, `editable=false`): cada celda es un botón
 *    que emite `tableClicked`. Usado en operación (página de piso).
 *  - Edición (`editable=true`): las celdas se vuelven draggables;
 *    al soltar se actualiza un signal `localPositions` y se emite
 *    `tableMoved`. Usado en la página de gestión.
 *
 * Coordenadas `pos_x` / `pos_y` se honran en ambos modos via
 * `cellPos()` que calcula `grid-column` / `grid-row`.
 */
@Component({
  selector: 'app-table-floor-map',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './table-floor-map.component.html',
  styleUrl: './table-floor-map.component.scss',
})
export class TableFloorMapComponent {
  readonly tables = input.required<Table[]>();
  readonly editable = input<boolean>(false);
  readonly tableClicked = output<Table>();
  readonly tableMoved = output<TableMovedEvent>();

  /**
   * Posiciones locales sobrescribiendo `pos_x`/`pos_y` durante un drag.
   * Limpias al iniciar el drag, se llenan con cada move event.
   */
  readonly localPositions = signal<Map<number, { x: number; y: number }>>(
    new Map(),
  );

  private draggingId: number | null = null;
  private dragOrigin: { x: number; y: number; cellX: number; cellY: number } | null = null;

  readonly groupedTables = computed<TableCell[]>(() => {
    return (this.tables() ?? []).map((t) => {
      const status = t.effective_status ?? t.status;
      return {
        table: t,
        displayStatus: status,
        statusLabel: TablesService.statusLabel(status),
        statusColor: TablesService.statusColorVar(status),
        isOccupied: status === 'occupied',
        guestCount: t.active_session?.guest_count ?? null,
      };
    });
  });

  /**
   * Devuelve grid-column / grid-row para colocar la celda según su
   * pos_x/pos_y. Si la mesa no tiene coordenadas, devuelve
   * 'auto' para que el grid la coloque naturalmente.
   */
  cellPos(t: Table): { col: string; row: string } {
    const local = this.localPositions().get(t.id);
    const x = local?.x ?? t.pos_x;
    const y = local?.y ?? t.pos_y;
    if (x == null || y == null) return { col: 'auto', row: 'auto' };
    return { col: String(x + 1), row: String(y + 1) };
  }

  onTableClick(t: Table): void {
    if (this.editable() || this.draggingId != null) return;
    this.tableClicked.emit(t);
  }

  onDragStart(ev: DragEvent, cell: TableCell): void {
    if (!this.editable()) {
      ev.preventDefault();
      return;
    }
    this.draggingId = cell.table.id;
    this.dragOrigin = {
      x: ev.clientX,
      y: ev.clientY,
      cellX: cell.table.pos_x ?? 0,
      cellY: cell.table.pos_y ?? 0,
    };
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', String(cell.table.id));
    }
  }

  onDragOver(ev: DragEvent): void {
    if (!this.editable() || this.draggingId == null) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
  }

  onDrop(ev: DragEvent, targetCell: TableCell): void {
    if (!this.editable() || this.draggingId == null) return;
    ev.preventDefault();
    if (this.dragOrigin) {
      const GRID_STEP = 80;
      const dx = Math.round((ev.clientX - this.dragOrigin.x) / GRID_STEP);
      const dy = Math.round((ev.clientY - this.dragOrigin.y) / GRID_STEP);
      const newX = Math.max(0, this.dragOrigin.cellX + dx);
      const newY = Math.max(0, this.dragOrigin.cellY + dy);
      const id = this.draggingId;
      this.localPositions.update((m) => {
        const next = new Map(m);
        next.set(id, { x: newX, y: newY });
        return next;
      });
      this.tableMoved.emit({ id, pos_x: newX, pos_y: newY });
    }
    this.draggingId = null;
    this.dragOrigin = null;
  }

  onDragEnd(): void {
    this.draggingId = null;
    this.dragOrigin = null;
  }

  trackByTableId(_i: number, cell: TableCell): number {
    return cell.table.id;
  }
}
