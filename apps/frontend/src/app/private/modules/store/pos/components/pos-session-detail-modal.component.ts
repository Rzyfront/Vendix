import {
  Component,
  EventEmitter,
  Input,
  Output,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ButtonComponent,
  ModalComponent,
  IconComponent,
} from '../../../../../shared/components';
import {
  PosCashRegisterService,
  CashRegisterSession,
  CashRegisterMovement,
} from '../services/pos-cash-register.service';

@Component({
  selector: 'app-pos-session-detail-modal',
  standalone: true,
  imports: [CommonModule, ButtonComponent, ModalComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [size]="'lg'"
      [showCloseButton]="true"
    >
      <!-- Header -->
      <div slot="header" class="flex items-center gap-3">
        <div
          class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center"
        >
          <app-icon
            name="receipt"
            [size]="20"
            class="text-primary"
          ></app-icon>
        </div>
        <div>
          <h2 class="text-lg font-semibold text-text-primary">
            Detalle de Sesión
          </h2>
          <p class="text-sm text-text-secondary">
            {{ session?.register?.name || 'Caja' }} — Abierta
            {{ session?.opened_at | date : 'shortTime' }}
          </p>
        </div>
      </div>

      <!-- Body -->
      <div class="space-y-4">
        <!-- Summary Cards -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div
            class="bg-primary/5 border border-primary/20 p-3 rounded-xl text-center"
          >
            <p
              class="text-[10px] font-medium text-text-secondary uppercase tracking-wider mb-1"
            >
              Apertura
            </p>
            <p class="text-lg font-bold text-text-primary">
              {{ '$' }}{{ session?.opening_amount | number : '1.0-0' }}
            </p>
          </div>
          <div
            class="bg-green-50 border border-green-200 p-3 rounded-xl text-center"
          >
            <p
              class="text-[10px] font-medium text-green-600 uppercase tracking-wider mb-1"
            >
              Ventas
            </p>
            <p class="text-lg font-bold text-green-700">
              {{ '$' }}{{ totalSales | number : '1.0-0' }}
            </p>
          </div>
          <div
            class="bg-red-50 border border-red-200 p-3 rounded-xl text-center"
          >
            <p
              class="text-[10px] font-medium text-red-600 uppercase tracking-wider mb-1"
            >
              Reembolsos
            </p>
            <p class="text-lg font-bold text-red-700">
              {{ '$' }}{{ totalRefunds | number : '1.0-0' }}
            </p>
          </div>
          <div
            class="bg-blue-50 border border-blue-200 p-3 rounded-xl text-center"
          >
            <p
              class="text-[10px] font-medium text-blue-600 uppercase tracking-wider mb-1"
            >
              Movimientos
            </p>
            <p class="text-lg font-bold text-blue-700">
              {{ movements.length }}
            </p>
          </div>
        </div>

        <!-- Movements List -->
        @if (loading) {
          <div class="flex items-center justify-center py-8 text-text-secondary">
            <app-icon name="loader" [size]="20" class="animate-spin mr-2"></app-icon>
            Cargando movimientos...
          </div>
        } @else if (movements.length === 0) {
          <div
            class="flex flex-col items-center justify-center py-8 text-text-secondary"
          >
            <app-icon name="inbox" [size]="32" class="mb-2 opacity-40"></app-icon>
            <p class="text-sm">No hay movimientos registrados</p>
          </div>
        } @else {
          <div class="border border-border rounded-xl overflow-hidden">
            <div
              class="max-h-[360px] overflow-y-auto divide-y divide-border"
            >
              @for (mov of movements; track mov.id) {
                <div
                  class="flex items-center gap-3 px-4 py-3 hover:bg-surface-alt/50 transition-colors"
                >
                  <!-- Type icon -->
                  <div
                    class="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                    [class]="getMovementIconClass(mov.type)"
                  >
                    <app-icon
                      [name]="getMovementIcon(mov.type)"
                      [size]="16"
                    ></app-icon>
                  </div>

                  <!-- Info -->
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-text-primary truncate">
                      {{ getMovementLabel(mov.type) }}
                      @if (mov.order?.order_number) {
                        <span class="text-text-secondary font-normal">
                          — {{ mov.order?.order_number }}
                        </span>
                      }
                    </p>
                    <p class="text-xs text-text-secondary">
                      {{ mov.created_at | date : 'shortTime' }}
                      @if (mov.payment_method && mov.type === 'sale') {
                        · {{ mov.payment_method }}
                      }
                      @if (mov.reference) {
                        · {{ mov.reference }}
                      }
                    </p>
                  </div>

                  <!-- Amount -->
                  <p
                    class="text-sm font-bold shrink-0"
                    [class]="isPositiveMovement(mov.type) ? 'text-green-600' : 'text-red-600'"
                  >
                    {{ isPositiveMovement(mov.type) ? '+' : '-' }}{{ '$' }}{{
                      mov.amount | number : '1.0-0'
                    }}
                  </p>
                </div>
              }
            </div>
          </div>
        }
      </div>

      <!-- Footer -->
      <div slot="footer" class="flex justify-end">
        <app-button variant="secondary" size="md" (clicked)="onClose()">
          Cerrar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class PosSessionDetailModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() session: CashRegisterSession | null = null;
  @Output() isOpenChange = new EventEmitter<boolean>();

  movements: CashRegisterMovement[] = [];
  loading = false;

  totalSales = 0;
  totalRefunds = 0;

  constructor(private cashRegisterService: PosCashRegisterService) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['isOpen'] && this.isOpen && this.session) {
      this.loadMovements();
    }
  }

  private loadMovements(): void {
    if (!this.session) return;
    this.loading = true;

    this.cashRegisterService.getMovements(this.session.id).subscribe({
      next: (movements) => {
        this.movements = movements;
        this.calculateTotals();
        this.loading = false;
      },
      error: () => {
        this.movements = [];
        this.loading = false;
      },
    });
  }

  private calculateTotals(): void {
    this.totalSales = this.movements
      .filter((m) => m.type === 'sale')
      .reduce((sum, m) => sum + Number(m.amount), 0);

    this.totalRefunds = this.movements
      .filter((m) => m.type === 'refund')
      .reduce((sum, m) => sum + Number(m.amount), 0);
  }

  getMovementIcon(type: string): string {
    const icons: Record<string, string> = {
      opening_balance: 'unlock',
      sale: 'shopping-cart',
      refund: 'rotate-ccw',
      cash_in: 'trending-up',
      cash_out: 'trending-down',
    };
    return icons[type] || 'circle';
  }

  getMovementIconClass(type: string): string {
    const classes: Record<string, string> = {
      opening_balance: 'bg-primary/10 text-primary',
      sale: 'bg-green-100 text-green-600',
      refund: 'bg-red-100 text-red-600',
      cash_in: 'bg-blue-100 text-blue-600',
      cash_out: 'bg-amber-100 text-amber-600',
    };
    return classes[type] || 'bg-gray-100 text-gray-600';
  }

  getMovementLabel(type: string): string {
    const labels: Record<string, string> = {
      opening_balance: 'Apertura de caja',
      sale: 'Venta',
      refund: 'Reembolso',
      cash_in: 'Entrada de efectivo',
      cash_out: 'Salida de efectivo',
    };
    return labels[type] || type;
  }

  isPositiveMovement(type: string): boolean {
    return ['opening_balance', 'sale', 'cash_in'].includes(type);
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }
}
