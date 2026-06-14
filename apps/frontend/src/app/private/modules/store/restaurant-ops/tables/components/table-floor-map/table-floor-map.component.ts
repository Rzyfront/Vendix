import {
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CardComponent,
  IconComponent,
  BadgeComponent,
} from '../../../../../../../shared/components/index';
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

/**
 * Floor-map view of all restaurant tables.
 *
 * Renders a CSS-grid (configured by `?zone=` filtering) where each cell
 * is a table with a status-based background color. Each cell is a
 * button (keyboard-friendly) emitting `tableClicked` so the parent
 * page can route to either the "open" flow or the session detail.
 *
 * Coordinates `pos_x` / `pos_y` are honored when present — tables
 * without layout metadata fall back to alphabetical ordering within
 * the zone.
 */
@Component({
  selector: 'app-table-floor-map',
  standalone: true,
  imports: [CommonModule, CardComponent, IconComponent, BadgeComponent],
  templateUrl: './table-floor-map.component.html',
  styleUrl: './table-floor-map.component.scss',
})
export class TableFloorMapComponent {
  readonly tables = input.required<Table[]>();
  readonly tableClicked = output<Table>();

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

  /** Max X coordinate seen — used to size the absolute-positioned grid. */
  readonly maxCols = computed(() => {
    const xs = (this.tables() ?? [])
      .map((t) => t.pos_x ?? 0)
      .filter((x) => Number.isFinite(x));
    return Math.max(1, ...xs) + 1;
  });

  onTableClick(t: Table): void {
    this.tableClicked.emit(t);
  }

  trackByTableId(_i: number, cell: TableCell): number {
    return cell.table.id;
  }
}
