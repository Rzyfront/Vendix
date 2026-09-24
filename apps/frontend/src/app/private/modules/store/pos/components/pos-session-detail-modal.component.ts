import {Component, input, output, effect, untracked, inject, signal, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import {
  BadgeComponent,
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
  imports: [DatePipe, BadgeComponent, ButtonComponent, ModalComponent, IconComponent, CurrencyPipe],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [size]="'lg'"
      [showCloseButton]="true"
      [dialog]="true"
    >
      <!-- Header -->
      <div slot="header" class="sd-header">
        <div class="sd-header-icon">
          <app-icon name="receipt" [size]="20"></app-icon>
        </div>
        <div>
          <h2 class="sd-title">
            {{ session()?.register?.name || 'Caja' }}
          </h2>
          <p class="sd-subtitle">
            Sesion #{{ session()?.id }}
            @if (session()?.status === 'closed') {
              <app-badge variant="success" size="sm">Cerrada</app-badge>
            } @else if (session()?.status === 'open') {
              <app-badge variant="info" size="sm">Abierta</app-badge>
            } @else if (session()?.status === 'suspended') {
              <app-badge variant="warning" size="sm">Suspendida</app-badge>
            }
          </p>
        </div>
      </div>

      <!-- Body -->
      <div class="sd-body">
        <!-- Session Info -->
        <div class="sd-meta session-header-details">
          <div>
            <span class="sd-meta-label">Cajero:</span>
            <span class="sd-meta-value">{{ session()?.opened_by_user?.first_name }} {{ session()?.opened_by_user?.last_name }}</span>
          </div>
          <div>
            <span class="sd-meta-label">Apertura:</span>
            <span class="sd-meta-value">{{ session()?.opened_at | date : 'short' }}</span>
          </div>
          <div>
            <span class="sd-meta-label">Cierre:</span>
            <span class="sd-meta-value">{{ session()?.closed_at ? (session()?.closed_at | date : 'short') : '—' }}</span>
          </div>
          <div>
            <span class="sd-meta-label">Diferencia:</span>
            @if (session()?.difference != null) {
              <span class="sd-diff" [class]="getDifferenceClass()">
                {{ getDifferencePrefix() }}{{ session()?.difference | currency:0 }}
              </span>
            } @else {
              <span class="sd-meta-empty">—</span>
            }
          </div>
        </div>

        <!-- Summary Cards -->
        <div class="sd-cards">
          <div class="sd-card sd-card-open">
            <p class="sd-card-label">Apertura</p>
            <p class="sd-card-amount">
              {{ session()?.opening_amount | currency:0 }}
            </p>
          </div>
          <div class="sd-card sd-card-sales">
            <p class="sd-card-label">Ventas</p>
            <p class="sd-card-amount">
              {{ totalSales() | currency:0 }}
            </p>
          </div>
          <div class="sd-card sd-card-refunds">
            <p class="sd-card-label">Reembolsos</p>
            <p class="sd-card-amount">
              {{ totalRefunds() | currency:0 }}
            </p>
          </div>
          <div class="sd-card sd-card-movs">
            <p class="sd-card-label">Movimientos</p>
            <p class="sd-card-amount">
              {{ movements().length }}
            </p>
          </div>
        </div>

        <!-- AI Summary -->
        <div class="ai-saved-summary">
          <div class="ai-saved-summary-header">
            <app-icon name="sparkles" [size]="16"></app-icon>
            <span class="sd-ai-title">Resumen IA</span>
          </div>
          @if (session()?.ai_summary) {
            <div class="ai-saved-summary-content" [innerHTML]="renderedAiSummary()"></div>
          } @else {
            <div class="ai-no-summary">
              <p class="sd-ai-empty">No se genero resumen IA para esta sesion</p>
            </div>
          }
        </div>

        <!-- Movements List -->
        @if (loading()) {
          <div class="sd-loading">
            <app-icon name="loader" [size]="20" class="sd-spin"></app-icon>
            Cargando movimientos...
          </div>
        } @else if (movements().length === 0) {
          <div class="sd-empty">
            <app-icon name="inbox" [size]="32" class="sd-empty-icon"></app-icon>
            <p class="sd-empty-text">No hay movimientos registrados</p>
          </div>
        } @else {
          <div class="sd-list">
            <div class="sd-list-scroll">
              @for (mov of movements(); track mov.id) {
                <div class="sd-row">
                  <!-- Type icon -->
                  <div
                    class="sd-mov-icon"
                    [class]="getMovementIconClass(mov.type)"
                  >
                    <app-icon
                      [name]="getMovementIcon(mov.type)"
                      [size]="16"
                    ></app-icon>
                  </div>

                  <!-- Info -->
                  <div class="sd-row-main">
                    <p class="sd-row-title">
                      {{ getMovementLabel(mov.type) }}
                      @if (mov.order?.order_number) {
                        <span class="sd-row-order">
                          — {{ mov.order?.order_number }}
                        </span>
                      }
                    </p>
                    <p class="sd-row-sub">
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
                    class="sd-row-amount"
                    [class.sd-plus]="isPositiveMovement(mov.type)"
                    [class.sd-minus]="!isPositiveMovement(mov.type)"
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
      <div slot="footer" class="sd-footer">
        <app-button variant="secondary" size="md" (clicked)="onClose()">
          Cerrar
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [`
    /* Stitch paso 7 — detalle de sesión: estado con app-badge sólido,
       tarjetas de totales en tints token, movimientos con signo en 700.
       Textos informativos en neutral-600 (text-secondary falla AA). */
    .sd-header {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .sd-header-icon {
      width: 40px;
      height: 40px;
      border-radius: 999px;
      background: var(--color-info-50);
      color: var(--color-info-700);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .sd-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--color-text-primary);
      margin: 0;
    }

    .sd-subtitle {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      color: var(--color-neutral-600);
      margin: 0;
    }

    .sd-body {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .sd-meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      column-gap: 24px;
      row-gap: 8px;
      font-size: 14px;
      padding: 8px 12px;
      background: var(--color-surface-secondary);
      border-radius: 8px;
    }

    @media (min-width: 640px) {
      .sd-meta { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    }

    .sd-meta-label {
      color: var(--color-neutral-600);
    }

    .sd-meta-value {
      font-weight: 500;
      color: var(--color-text-primary);
      margin-left: 4px;
    }

    .sd-meta-empty {
      color: var(--color-neutral-600);
      margin-left: 4px;
    }

    .sd-diff {
      font-weight: 700;
      margin-left: 4px;
    }

    .sd-diff-zero { color: var(--color-success-700); }
    .sd-diff-plus { color: var(--color-info-700); }
    .sd-diff-minus { color: var(--color-error-700); }

    .sd-cards {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    @media (min-width: 640px) {
      .sd-cards { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    }

    .sd-card {
      border: 1px solid;
      border-radius: 12px;
      padding: 12px;
      text-align: center;
    }

    .sd-card-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 0 0 4px;
    }

    .sd-card-amount {
      font-size: 18px;
      font-weight: 700;
      margin: 0;
    }

    .sd-card-open {
      background: var(--color-surface-secondary);
      border-color: var(--color-border);
    }

    .sd-card-open .sd-card-label { color: var(--color-neutral-600); }
    .sd-card-open .sd-card-amount { color: var(--color-text-primary); }

    .sd-card-sales {
      background: var(--color-success-50);
      border-color: var(--color-success-200);
    }

    .sd-card-sales .sd-card-label { color: var(--color-success-700); }
    .sd-card-sales .sd-card-amount { color: var(--color-success-800); }

    .sd-card-refunds {
      background: var(--color-error-50);
      border-color: var(--color-error-200);
    }

    .sd-card-refunds .sd-card-label { color: var(--color-error-700); }
    .sd-card-refunds .sd-card-amount { color: var(--color-error-800); }

    .sd-card-movs {
      background: var(--color-info-50);
      border-color: var(--color-info-200);
    }

    .sd-card-movs .sd-card-label { color: var(--color-info-700); }
    .sd-card-movs .sd-card-amount { color: var(--color-info-800); }

    .sd-ai-title {
      font-size: 14px;
      font-weight: 500;
    }

    .sd-ai-empty {
      font-size: 14px;
      color: var(--color-neutral-600);
      margin: 0;
    }

    .sd-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 32px 0;
      color: var(--color-neutral-600);
      font-size: 14px;
    }

    .sd-spin {
      animation: sd-spin 0.8s linear infinite;
    }

    @keyframes sd-spin {
      to { transform: rotate(360deg); }
    }

    @media (prefers-reduced-motion: reduce) {
      .sd-spin { animation: none; }
    }

    .sd-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px 0;
      color: var(--color-neutral-600);
    }

    .sd-empty-icon {
      margin-bottom: 8px;
      color: var(--color-neutral-400);
    }

    .sd-empty-text {
      font-size: 14px;
      margin: 0;
    }

    .sd-list {
      border: 1px solid var(--color-border);
      border-radius: 12px;
      overflow: hidden;
    }

    .sd-list-scroll {
      max-height: 360px;
      overflow-y: auto;
    }

    .sd-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      transition: background-color 0.2s ease;
    }

    .sd-row + .sd-row {
      border-top: 1px solid var(--color-border);
    }

    .sd-row:hover {
      background: var(--color-surface-secondary);
    }

    .sd-mov-icon {
      width: 32px;
      height: 32px;
      border-radius: 999px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .sd-mov-balance {
      background: var(--color-info-50);
      color: var(--color-info-700);
    }

    .sd-mov-sale {
      background: var(--color-success-50);
      color: var(--color-success-700);
    }

    .sd-mov-refund {
      background: var(--color-error-50);
      color: var(--color-error-700);
    }

    .sd-mov-in {
      background: var(--color-info-50);
      color: var(--color-info-700);
    }

    .sd-mov-out {
      background: var(--color-warning-50);
      color: var(--color-warning-800);
    }

    .sd-mov-unknown {
      background: var(--color-neutral-100);
      color: var(--color-neutral-600);
    }

    .sd-row-main {
      flex: 1;
      min-width: 0;
    }

    .sd-row-title {
      font-size: 14px;
      font-weight: 500;
      color: var(--color-text-primary);
      margin: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sd-row-order {
      color: var(--color-neutral-600);
      font-weight: 400;
    }

    .sd-row-sub {
      font-size: 12px;
      color: var(--color-neutral-600);
      margin: 0;
    }

    .sd-row-amount {
      font-size: 14px;
      font-weight: 700;
      flex-shrink: 0;
      margin: 0;
    }

    .sd-plus { color: var(--color-success-700); }
    .sd-minus { color: var(--color-error-700); }

    .sd-footer {
      display: flex;
      justify-content: flex-end;
    }

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
  private destroyRef = inject(DestroyRef);
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

    this.cashRegisterService.getMovements(this.session()!.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
    // Stitch paso 7 — incluye la base sd-mov-icon porque [class] reemplaza
    // el atributo class estático; tonos token con AA sobre tint.
    const classes: Record<string, string> = {
      opening_balance: 'sd-mov-icon sd-mov-balance',
      closing_balance: 'sd-mov-icon sd-mov-balance',
      sale: 'sd-mov-icon sd-mov-sale',
      refund: 'sd-mov-icon sd-mov-refund',
      cash_in: 'sd-mov-icon sd-mov-in',
      cash_out: 'sd-mov-icon sd-mov-out',
    };
    return classes[type] || 'sd-mov-icon sd-mov-unknown';
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
    // Stitch paso 7 — incluye la base sd-diff porque [class] reemplaza el
    // atributo class estático; tonos 700 con AA.
    const diff = Number(this.session()?.difference || 0);
    if (diff === 0) return 'sd-diff sd-diff-zero';
    if (diff > 0) return 'sd-diff sd-diff-plus';
    return 'sd-diff sd-diff-minus';
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
