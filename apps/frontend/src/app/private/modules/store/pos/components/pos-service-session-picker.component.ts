import { Component, input, model } from '@angular/core';
import {
  BadgeComponent,
  EmptyStateComponent,
  IconComponent,
} from '../../../../../shared/components';
import type { BadgeVariant } from '../../../../../shared/components';
import { CurrencyPipe } from '../../../../../shared/pipes/currency';
import type { PosServiceSession } from '../services/pos-service-station-integration.service';

/**
 * Selector reutilizable de atenciones activas de estaciones de servicio.
 *
 * Presentacional: recibe las filas de `GET /store/service-sessions` y expone
 * la selección como `model()` (`[(selectedId)]`). No hace HTTP, así que puede
 * reusarse fuera del POS (ej. un panel de recepción) sin arrastrar el flujo de
 * cobro. Tarjetas: estación, servicio, vehículo/placa (subject.metadata) y
 * total actual de la cuenta.
 */
@Component({
  selector: 'app-pos-service-session-picker',
  standalone: true,
  imports: [BadgeComponent, EmptyStateComponent, IconComponent, CurrencyPipe],
  template: `
    @if (loading()) {
      <div class="flex justify-center py-12">
        <div
          class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
        ></div>
      </div>
    } @else if (sessions().length === 0) {
      <app-empty-state
        size="sm"
        icon="warehouse"
        [title]="emptyTitle()"
        [description]="emptyDescription()"
        [showActionButton]="false"
      ></app-empty-state>
    } @else {
      <div class="station-grid" role="listbox" aria-label="Estaciones ocupadas">
        @for (s of sessions(); track s.id) {
          <button
            type="button"
            class="station-tile"
            role="option"
            [attr.aria-selected]="selectedId() === s.id"
            [class.selected]="selectedId() === s.id"
            (click)="selectedId.set(s.id)"
          >
            <div class="flex items-center justify-between gap-2 min-w-0">
              <span class="station-name truncate">{{ s.station_name }}</span>
              <app-badge [variant]="statusVariant(s.status)" size="xs">
                {{ statusLabel(s.status) }}
              </app-badge>
            </div>
            <div class="station-service truncate">{{ s.product_name }}</div>
            @if (subjectLine(s); as line) {
              <div class="station-subject">
                <app-icon name="tag" [size]="12"></app-icon>
                <span class="truncate">{{ line }}</span>
              </div>
            }
            <div class="station-total">
              <span class="truncate">{{
                s.order?.order_number || 'Sin cuenta aún'
              }}</span>
              <strong>{{ s.order?.grand_total ?? 0 | currency }}</strong>
            </div>
          </button>
        }
      </div>
    }
  `,
  styles: [
    `
      .station-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
        gap: 10px;
        max-height: 340px;
        overflow-y: auto;
      }
      .station-tile {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 12px;
        border-radius: 12px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        cursor: pointer;
        text-align: left;
        transition: all 0.15s ease;
        min-width: 0;
      }
      .station-tile:hover {
        border-color: var(--color-primary);
        background: rgba(var(--color-primary-rgb), 0.04);
      }
      .station-tile.selected {
        border-color: var(--color-primary);
        box-shadow: 0 0 0 2px var(--color-primary);
        background: rgba(var(--color-primary-rgb), 0.08);
      }
      .station-name {
        font-size: 14px;
        font-weight: 700;
        color: var(--color-text-primary);
      }
      .station-service,
      .station-subject {
        font-size: 12px;
        color: var(--color-text-secondary);
      }
      .station-subject {
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
      }
      .station-total {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 6px;
        font-size: 11px;
        color: var(--color-text-secondary);
        margin-top: 2px;
      }
      .station-total strong {
        font-size: 13px;
        color: var(--color-text-primary);
      }
    `,
  ],
})
export class PosServiceSessionPickerComponent {
  readonly sessions = input<PosServiceSession[]>([]);
  readonly loading = input<boolean>(false);
  readonly emptyTitle = input<string>('No hay estaciones ocupadas');
  readonly emptyDescription = input<string>(
    'Inicia una atención desde Servicios → Estaciones.',
  );
  readonly selectedId = model<number | null>(null);

  statusLabel(status: string): string {
    switch (status) {
      case 'open':
        return 'Abierta';
      case 'in_progress':
        return 'En proceso';
      case 'paused':
        return 'En pausa';
      default:
        return status;
    }
  }

  statusVariant(status: string): BadgeVariant {
    switch (status) {
      case 'in_progress':
        return 'primary';
      case 'paused':
        return 'warning';
      default:
        return 'success';
    }
  }

  /** "Vehículo · PLACA" desde subject.metadata, con el label como respaldo. */
  subjectLine(s: PosServiceSession): string | null {
    const meta = (s.subject?.metadata ?? null) as Record<string, unknown> | null;
    const vehicle = meta?.['vehicle_name'] ? String(meta['vehicle_name']) : '';
    const plate = meta?.['plate'] ? String(meta['plate']).toUpperCase() : '';
    const parts = [vehicle, plate].filter(Boolean);
    if (parts.length) return parts.join(' · ');
    return s.subject?.label?.trim() || null;
  }
}
