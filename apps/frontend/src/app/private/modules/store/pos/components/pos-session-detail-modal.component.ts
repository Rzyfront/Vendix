import {
  Component,
  input,
  output,
  effect,
  untracked,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  ButtonComponent,
  ModalComponent,
  IconComponent,
} from '../../../../../shared/components';
import { CurrencyPipe } from '../../../../../shared/pipes/currency';
import { markdownToHtml } from '../../../../../shared/utils/markdown.util';
import {
  PosCashRegisterService,
  CashRegisterSession,
  CashRegisterMovement,
} from '../services/pos-cash-register.service';

@Component({
  selector: 'app-pos-session-detail-modal',
  standalone: true,
  imports: [DatePipe, ButtonComponent, ModalComponent, IconComponent, CurrencyPipe],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [size]="'lg'"
      [showCloseButton]="true"
    >
      <!-- Header -->
      <div slot="header" class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
          <app-icon name="receipt" [size]="20" class="text-primary"></app-icon>
        </div>
        <div>
          <h2 class="text-lg font-semibold text-text-primary">
            {{ session()?.register?.name || 'Caja' }}
          </h2>
          <p class="text-sm text-text-secondary">
            Sesion #{{ session()?.id }}
            @if (session()?.status === 'closed') {
              · <span class="text-green-600 font-medium">Cerrada</span>
            } @else if (session()?.status === 'open') {
              · <span class="text-blue-600 font-medium">Abierta</span>
            } @else if (session()?.status === 'suspended') {
              · <span class="text-amber-600 font-medium">Suspendida</span>
            }
          </p>
        </div>
      </div>

      <!-- Body -->
      <div class="space-y-4">
        <!-- Session Info -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-sm session-header-details">
          <div>
            <span class="text-text-secondary">Cajero:</span>
            <span class="font-medium text-text-primary ml-1">{{ session()?.opened_by_user?.first_name }} {{ session()?.opened_by_user?.last_name }}</span>
          </div>
          <div>
            <span class="text-text-secondary">Apertura:</span>
            <span class="font-medium text-text-primary ml-1">{{ session()?.opened_at | date : 'short' }}</span>
          </div>
          <div>
            <span class="text-text-secondary">Cierre:</span>
            <span class="font-medium text-text-primary ml-1">{{ session()?.closed_at ? (session()?.closed_at | date : 'short') : '—' }}</span>
          </div>
          <div>
            <span class="text-text-secondary">Diferencia:</span>
            @if (session()?.difference != null) {
              <span class="font-bold ml-1" [class]="getDifferenceClass()">
                {{ getDifferencePrefix() }}{{ session()?.difference | currency:0 }}
              </span>
            } @else {
              <span class="text-text-secondary ml-1">—</span>
            }
          </div>
        </div>

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
              {{ session()?.opening_amount | currency:0 }}
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
              {{ totalSales() | currency:0 }}
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
              {{ totalRefunds() | currency:0 }}
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
              {{ movements().length }}
            </p>
          </div>
        </div>

        <!-- AI Summary -->
        <div class="ai-saved-summary">
          <div class="ai-saved-summary-header">
            <app-icon name="sparkles" [size]="16"></app-icon>
            <span class="text-sm font-medium">Resumen IA</span>
          </div>
          @if (session()?.ai_summary) {
            <div class="ai-saved-summary-content" [innerHTML]="renderedAiSummary()"></div>
          } @else {
            <div class="ai-no-summary">
              <p class="text-sm text-text-secondary">No se genero resumen IA para esta sesion</p>
            </div>
          }
        </div>

        <!-- Movements List -->
        @if (loading()) {
          <div class="flex items-center justify-center py-8 text-text-secondary">
            <app-icon name="loader" [size]="20" class="animate-spin mr-2"></app-icon>
            Cargando movimientos...
          </div>
        } @else if (movements().length === 0) {
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
              @for (mov of movements(); track mov.id) {
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
                    {{ isPositiveMovement(mov.type) ? '+' : '-' }}{{ mov.amount | currency:0 }}
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
  styles: [`
    .ai-saved-summary {
      background: linear-gradient(135deg, rgba(var(--color-primary-rgb), 0.04) 0%, rgba(var(--color-primary-rgb), 0.01) 100%);
      border: 1px solid rgba(var(--color-primary-rgb), 0.08);
      border-radius: 12px;
      overflow: hidden;
    }
    .ai-saved-summary-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      background: rgba(var(--color-primary-rgb), 0.06);
      color: rgb(var(--color-primary-rgb));
      font-size: 13px;
    }
    .ai-saved-summary-content {
      padding: 12px 16px;
      font-size: 13px;
      line-height: 1.6;
      color: var(--color-text-primary);
    }
    .ai-saved-summary-content ::ng-deep p { margin: 4px 0; }
    .ai-saved-summary-content ::ng-deep ul { margin: 4px 0; padding-left: 20px; }
    .ai-saved-summary-content ::ng-deep li { margin: 2px 0; }
    .ai-saved-summary-content ::ng-deep strong { font-weight: 600; }
    .ai-no-summary {
      padding: 16px;
      text-align: center;
    }
    .session-header-details {
      padding: 8px 12px;
      background: var(--color-bg-secondary, #f9fafb);
      border-radius: 8px;
    }
  `],
})
export class PosSessionDetailModalComponent {
  readonly isOpen = input<boolean>(false);
  readonly session = input<CashRegisterSession | null>(null);
  readonly isOpenChange = output<boolean>();

  readonly movements = signal<CashRegisterMovement[]>([]);
  readonly loading = signal(false);
  readonly renderedAiSummary = signal('');

  readonly totalSales = signal(0);
  readonly totalRefunds = signal(0);

  private cashRegisterService = inject(PosCashRegisterService);

  constructor() {
    effect(() => {
      if (this.isOpen() && this.session()) {
        untracked(() => {
          this.renderedAiSummary.set(markdownToHtml(this.session()?.ai_summary || ''));
          this.loadMovements();
        });
      }
    });
  }

  private loadMovements(): void {
    if (!this.session()) return;
    this.loading.set(true);

    this.cashRegisterService.getMovements(this.session()!.id).subscribe({
      next: (movements) => {
        this.movements.set(movements);
        this.calculateTotals();
        this.loading.set(false);
      },
      error: () => {
        this.movements.set([]);
        this.loading.set(false);
      },
    });
  }

  private calculateTotals(): void {
    const movs = this.movements();
    this.totalSales.set(movs
      .filter((m) => m.type === 'sale')
      .reduce((sum, m) => sum + Number(m.amount), 0));

    this.totalRefunds.set(movs
      .filter((m) => m.type === 'refund')
      .reduce((sum, m) => sum + Number(m.amount), 0));
  }

  getMovementIcon(type: string): string {
    const icons: Record<string, string> = {
      opening_balance: 'unlock',
      closing_balance: 'lock',
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
      closing_balance: 'bg-primary/10 text-primary',
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
      closing_balance: 'Cierre de caja',
      sale: 'Venta',
      refund: 'Reembolso',
      cash_in: 'Entrada de efectivo',
      cash_out: 'Salida de efectivo',
    };
    return labels[type] || type;
  }

  isPositiveMovement(type: string): boolean {
    return ['opening_balance', 'closing_balance', 'sale', 'cash_in'].includes(type);
  }

  getDifferenceClass(): string {
    const diff = Number(this.session()?.difference || 0);
    if (diff === 0) return 'text-green-600';
    if (diff > 0) return 'text-blue-600';
    return 'text-red-600';
  }

  getDifferencePrefix(): string {
    const diff = Number(this.session()?.difference || 0);
    if (diff > 0) return '+';
    if (diff < 0) return '';
    return '';
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }
}
