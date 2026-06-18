import {
  Component,
  input,
  output,
  effect,
  untracked,
  inject,
  signal,
  DestroyRef,
  computed,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  ButtonComponent,
  ModalComponent,
  IconComponent,
  InputComponent,
} from '../../../../../shared/components';
import {
  PosRestaurantIntegrationService,
  OpenTableSessionResult,
} from '../services/pos-restaurant-integration.service';
import { PosCustomer } from '../services/pos-customer.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import type { Table } from '../../restaurant-ops/tables/interfaces';

type TableZone = string | null;

interface TableGroup {
  zone: TableZone;
  label: string;
  tables: Table[];
}

@Component({
  selector: 'app-pos-open-table-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    ModalComponent,
    InputComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onModalChange($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      [showCloseButton]="true"
      title="Abrir mesa"
      subtitle="Selecciona una mesa disponible para iniciar la cuenta"
    >
      <div
        slot="header"
        class="w-10 h-10 rounded-[var(--radius-lg)] bg-primary/10 flex items-center justify-center flex-shrink-0"
      >
        <app-icon
          name="layout-grid"
          [size]="20"
          class="text-primary"
        ></app-icon>
      </div>

      @if (loading()) {
        <div class="flex justify-center py-12">
          <div
            class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
          ></div>
        </div>
      } @else if (tables().length === 0) {
        <div
          class="text-center py-10 text-text-secondary text-sm flex flex-col items-center gap-2"
        >
          <app-icon name="info" [size]="24"></app-icon>
          <span>No hay mesas configuradas para esta tienda.</span>
          <span class="text-xs">
            Crea mesas desde el módulo Restaurant Ops → Mesas.
          </span>
        </div>
      } @else {
        <form [formGroup]="form" class="space-y-5">
          <!-- Zone filter -->
          @if (zones().length > 1) {
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="zone-chip"
                [class.active]="selectedZone() === null"
                (click)="selectedZone.set(null)"
              >
                Todas
              </button>
              @for (z of zones(); track z) {
                <button
                  type="button"
                  class="zone-chip"
                  [class.active]="selectedZone() === z"
                  (click)="selectedZone.set(z)"
                >
                  {{ z }}
                </button>
              }
            </div>
          }

          <!-- Table grid -->
          <div class="floor-grid">
            @for (t of visibleTables(); track t.id) {
              <button
                type="button"
                class="floor-tile"
                [class.occupied]="t.effective_status === 'occupied'"
                [class.reserved]="t.effective_status === 'reserved'"
                [class.cleaning]="t.effective_status === 'cleaning'"
                [class.selected]="selectedTableId() === t.id"
                [disabled]="t.effective_status === 'occupied' || t.effective_status === 'reserved'"
                (click)="onPickTable(t)"
              >
                <div class="floor-tile-name">{{ t.name }}</div>
                <div class="floor-tile-meta">
                  @if (t.capacity) {
                    <span class="capacity">
                      <app-icon name="users" [size]="12"></app-icon>
                      {{ t.capacity }}
                    </span>
                  }
                  <span class="status-pill">
                    {{ statusLabel(t.effective_status || t.status) }}
                  </span>
                </div>
              </button>
            }
          </div>

          <!-- Guest count -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <app-input
              formControlName="guest_count"
              label="Comensales"
              type="number"
              [min]="1"
              placeholder="2"
              helperText="Opcional. Útil para la cuenta dividida."
            ></app-input>
            <div class="flex flex-col justify-end">
              <div class="text-xs text-text-secondary">Mesa seleccionada</div>
              <div class="text-sm font-bold text-text-primary">
                {{ selectedTableLabel() || '—' }}
              </div>
            </div>
          </div>
        </form>
      }

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="secondary" size="md" (clicked)="onCancel()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          size="md"
          (clicked)="onConfirm()"
          [disabled]="!canConfirm() || submitting()"
        >
          <app-icon name="layout-grid" [size]="16" slot="icon"></app-icon>
          @if (submitting()) {
            Abriendo...
          } @else {
            Abrir mesa
          }
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      .zone-chip {
        padding: 6px 12px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        background: var(--color-muted);
        border: 1px solid var(--color-border);
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .zone-chip.active {
        background: var(--color-primary);
        color: white;
        border-color: var(--color-primary);
      }

      .floor-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 10px;
        max-height: 320px;
        overflow-y: auto;
      }

      .floor-tile {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
        padding: 12px;
        border-radius: 12px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        cursor: pointer;
        transition: all 0.15s ease;
        text-align: left;
      }

      .floor-tile:hover:not(:disabled) {
        border-color: var(--color-primary);
        background: rgba(var(--color-primary-rgb), 0.04);
      }

      .floor-tile.selected {
        background: var(--color-primary);
        border-color: var(--color-primary);
        color: white;
      }

      .floor-tile.occupied {
        background: rgba(239, 68, 68, 0.08);
        border-color: rgba(239, 68, 68, 0.4);
        cursor: not-allowed;
        opacity: 0.7;
      }

      .floor-tile.reserved {
        background: rgba(245, 158, 11, 0.08);
        border-color: rgba(245, 158, 11, 0.4);
        cursor: not-allowed;
        opacity: 0.7;
      }

      .floor-tile.cleaning {
        background: rgba(99, 102, 241, 0.08);
        border-color: rgba(99, 102, 241, 0.4);
        cursor: pointer;
        opacity: 0.85;
      }

      .floor-tile:disabled {
        cursor: not-allowed;
      }

      .floor-tile-name {
        font-size: 14px;
        font-weight: 700;
      }

      .floor-tile-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 11px;
        opacity: 0.85;
      }

      .floor-tile .capacity {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      .status-pill {
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.05);
        font-weight: 600;
        text-transform: capitalize;
      }

      .floor-tile.selected .status-pill {
        background: rgba(255, 255, 255, 0.2);
      }
    `,
  ],
})
export class PosOpenTableModalComponent {
  private destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);
  private integration = inject(PosRestaurantIntegrationService);
  private toastService = inject(ToastService);

  readonly isOpen = input<boolean>(false);
  readonly isOpenChange = output<boolean>();
  /**
   * Optional customer to bind to the new table session's draft order
   * (Bug 3 / Fase K). When provided, the session is opened with this
   * customer's id; otherwise the backend falls back to the opening
   * user (legacy behavior).
   */
  readonly customer = input<PosCustomer | null>(null);
  readonly sessionOpened = output<OpenTableSessionResult>();

  readonly tables = signal<Table[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly selectedTableId = signal<number | null>(null);
  readonly selectedZone = signal<TableZone>(null);

  readonly form: FormGroup = this.fb.group({
    guest_count: [null],
  });

  readonly zones = computed<string[]>(() => {
    const set = new Set<string>();
    for (const t of this.tables()) {
      if (t.zone) set.add(t.zone);
    }
    return Array.from(set).sort();
  });

  readonly visibleTables = computed<Table[]>(() => {
    const zone = this.selectedZone();
    if (!zone) return this.tables();
    return this.tables().filter((t) => t.zone === zone);
  });

  readonly selectedTableLabel = computed(() => {
    const id = this.selectedTableId();
    if (id == null) return '';
    const t = this.tables().find((x) => x.id === id);
    return t ? `${t.name}${t.zone ? ' · ' + t.zone : ''}` : '';
  });

  readonly canConfirm = computed(() => this.selectedTableId() != null);

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        untracked(() => {
          this.reset();
          this.loadTables();
        });
      }
    });
  }

  private reset(): void {
    this.tables.set([]);
    this.selectedTableId.set(null);
    this.selectedZone.set(null);
    this.form.reset({ guest_count: null });
  }

  private loadTables(): void {
    this.loading.set(true);
    this.integration
      .listTables()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tables) => {
          this.tables.set(tables ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.toastService.error(extractApiErrorMessage(err));
        },
      });
  }

  statusLabel(s: string): string {
    switch (s) {
      case 'available':
        return 'Libre';
      case 'occupied':
        return 'Ocupada';
      case 'reserved':
        return 'Reservada';
      case 'cleaning':
        return 'Limpieza';
      default:
        return s;
    }
  }

  onPickTable(t: Table): void {
    this.selectedTableId.set(t.id);
  }

  onModalChange(open: boolean): void {
    if (!open) this.isOpenChange.emit(false);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  onConfirm(): void {
    const tableId = this.selectedTableId();
    if (tableId == null) return;
    this.submitting.set(true);
    const rawGuest = this.form.value.guest_count;
    const guestCount = rawGuest == null || rawGuest === '' ? undefined : Number(rawGuest);
    // Bug 3 (Fase K): forward the optional customer so the table
    // session's draft order is linked to the picked client (or stays
    // anonymous when none was chosen).
    const customer = this.customer();
    const customerId =
      customer && Number.isFinite(Number(customer.id)) && Number(customer.id) > 0
        ? Number(customer.id)
        : undefined;
    this.integration
      .openTableSession({
        table_id: tableId,
        guest_count: guestCount,
        ...(customerId ? { customer_id: customerId } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.submitting.set(false);
          this.toastService.success('Mesa abierta correctamente');
          this.sessionOpened.emit(result);
          this.isOpenChange.emit(false);
        },
        error: (err) => {
          this.submitting.set(false);
          this.toastService.error(extractApiErrorMessage(err));
        },
      });
  }
}
