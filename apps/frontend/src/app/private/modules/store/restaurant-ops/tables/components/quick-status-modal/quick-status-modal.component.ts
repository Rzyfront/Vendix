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
import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
} from '../../../../../../../shared/components/index';
import { Table, TableStatus } from '../../interfaces';
import { TablesService } from '../../services/tables.service';

/**
 * Quick status change modal for a single mesa on the floor map.
 *
 * Lets the operator switch any table (cleaning, available, reserved
 * without bookings, occupied without an active session) to a new
 * status with one click — without leaving the floor map page or going
 * to `/admin/restaurant-ops/tables/manage`.
 *
 * Reuses the same `tableStatusOptions` shape that
 * `table-session-page.component.ts:722-727` exposes (the timeline +
 * selector inside the table session detail), minus the current status
 * (no-op transitions are hidden). The submit uses
 * `TablesService.update(tableId, { status })`, which the session page
 * already calls from `changeTableStatus`.
 *
 * The occupied-with-active-session case is NOT routed here: the page
 * keeps the navigate-to-session shortcut for that scenario. This modal
 * is the fallback for every other click on a floor-map cell.
 *
 * Model-based visibility (matches `app-modal` patterns).
 */
@Component({
  selector: 'app-quick-status-modal',
  standalone: true,
  imports: [
    CommonModule,
    ModalComponent,
    ButtonComponent,
    SelectorComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="close()"
      [size]="'sm'"
      [title]="title()"
      [subtitle]="subtitle()"
    >
      <div class="space-y-3">
        <div class="flex items-center gap-2 text-sm text-text-secondary">
          <app-icon name="table" [size]="18"></app-icon>
          <span class="font-medium text-text-primary">{{ table()?.name }}</span>
          @if (currentStatus(); as cs) {
            <span class="status-pill" [style.background-color]="currentPillColor()">
              {{ currentStatusLabel() }}
            </span>
          }
        </div>

        @if (availableOptions().length === 0) {
          <p class="text-sm text-text-secondary">
            La mesa ya está en todos los estados posibles — no hay
            transiciones rápidas disponibles.
          </p>
        } @else {
          <app-selector
            label="Nuevo estado"
            placeholder="Selecciona un estado"
            [options]="availableOptions()"
            (valueChange)="onStatusChange($event)"
          />
        }
      </div>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="close()">Cancelar</app-button>
        <app-button
          variant="primary"
          [loading]="loading()"
          [disabled]="!canSubmit()"
          (clicked)="onSubmit()"
        >
          <app-icon slot="icon" name="check" [size]="16"></app-icon>
          Cambiar estado
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      .status-pill {
        display: inline-flex;
        align-items: center;
        padding: 0.125rem 0.625rem;
        border-radius: 999px;
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.025em;
        color: #fff;
      }
    `,
  ],
})
export class QuickStatusModalComponent {
  private readonly tablesService = inject(TablesService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  readonly table = input<Table | null>(null);
  /** Externally controlled busy state (e.g. parent is already saving). */
  readonly loadingInput = input(false, { alias: 'loading' });
  readonly internalLoading = signal(false);
  readonly loading = computed(
    () => this.loadingInput() || this.internalLoading(),
  );

  readonly isOpenChange = output<boolean>();
  readonly changed = output<TableStatus>();

  /** Status the operator picked from the selector. */
  readonly selectedStatus = signal<TableStatus | null>(null);

  readonly currentStatus = computed<TableStatus | null>(() => {
    const t = this.table();
    if (!t) return null;
    return (t.effective_status ?? t.status) ?? null;
  });

  readonly currentStatusLabel = computed(() => {
    const s = this.currentStatus();
    return s ? TablesService.statusLabel(s) : '';
  });

  readonly currentPillColor = computed(() => {
    const s = this.currentStatus();
    return s ? TablesService.statusColorVar(s) : 'var(--color-text-muted)';
  });

  readonly title = computed(() => {
    const name = this.table()?.name;
    return name ? `Cambiar estado — ${name}` : 'Cambiar estado de mesa';
  });

  readonly subtitle = computed(
    () =>
      'Movimiento rápido desde el plano. La página se recargará para reflejar el nuevo estado.',
  );

  /** All possible statuses (mirror of table-session-page's options shape). */
  private readonly allStatusOptions: SelectorOption[] = [
    { value: 'available', label: TablesService.statusLabel('available') },
    { value: 'reserved', label: TablesService.statusLabel('reserved') },
    { value: 'occupied', label: TablesService.statusLabel('occupied') },
    { value: 'cleaning', label: TablesService.statusLabel('cleaning') },
  ];

  /** Hides the CURRENT status (no-op transition). */
  readonly availableOptions = computed<SelectorOption[]>(() => {
    const current = this.currentStatus();
    return this.allStatusOptions.filter((o) => o.value !== current);
  });

  readonly canSubmit = computed(() => {
    if (this.loading()) return false;
    const sel = this.selectedStatus();
    const current = this.currentStatus();
    return sel != null && sel !== current;
  });

  constructor() {
    // Sync the selection whenever the modal target table changes (also
    // covers open/close cycles that swap from a different table).
    effect(() => {
      this.table();
      this.selectedStatus.set(null);
    });
  }

  close(): void {
    this.isOpenChange.emit(false);
  }

  onStatusChange(value: string | number | null): void {
    if (value == null) {
      this.selectedStatus.set(null);
      return;
    }
    this.selectedStatus.set(value as TableStatus);
  }

  onSubmit(): void {
    const t = this.table();
    const next = this.selectedStatus();
    if (!t || next == null) return;
    if (next === this.currentStatus()) return;
    this.internalLoading.set(true);
    this.tablesService
      .update(t.id, { status: next })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.internalLoading.set(false);
          this.toastService.success(
            `Mesa ${t.name}: ${TablesService.statusLabel(next)}`,
          );
          this.changed.emit(next);
          this.close();
        },
        error: (err: unknown) => {
          this.internalLoading.set(false);
          this.toastService.error(
            typeof err === 'string'
              ? err
              : 'Error al cambiar el estado de la mesa',
          );
        },
      });
  }
}
