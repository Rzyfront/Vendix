import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  Input,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CardComponent,
  IconComponent,
  EmptyStateComponent,
  BadgeComponent,
  ButtonComponent,
  InputsearchComponent,
  StickyHeaderComponent,
  StickyHeaderActionButton,
} from '../../../../../../../../shared/components';
import { ToastService } from '../../../../../../../../shared/components/toast/toast.service';
import {
  UserCommissionsService,
  UserCommission,
  CommissionStatus,
  EmployeeCommissionSummary,
} from '../../../../../commissions/services/user-commissions.service';

interface StatusFilter {
  label: string;
  value: CommissionStatus | 'all';
  color: string;
}

/**
 * Tab "Comisiones" del perfil del empleado (QUI-678).
 *
 * - Tabla paginada con todas las comisiones del mecánico
 * - Filtros: por estado + rango de fechas + búsqueda libre
 * - Acciones inline: "Marcar pagado" y "Declinar" (solo en estado `accrued`)
 * - Acciones sobre declined: "Reabrir"
 * - KPIs arriba: pendiente, pagado este mes, declinado
 */
@Component({
  selector: 'app-employee-commissions-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CurrencyPipe,
    DatePipe,
    CardComponent,
    IconComponent,
    EmptyStateComponent,
    BadgeComponent,
    ButtonComponent,
    InputsearchComponent,
    StickyHeaderComponent,
  ],
  templateUrl: './employee-commissions-tab.component.html',
  styleUrls: ['./employee-commissions-tab.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeeCommissionsTabComponent implements OnInit {
  @Input({ required: true }) employeeId!: number;
  @Input() employeeName = '';

  private readonly commissions = inject(UserCommissionsService);
  private readonly toast = inject(ToastService);

  // ─── Estado ───────────────────────────────────────────────────────────
  readonly loading = signal(false);
  readonly summaryLoading = signal(false);
  readonly items = signal<UserCommission[]>([]);
  readonly summary = signal<EmployeeCommissionSummary | null>(null);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly limit = signal(20);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.limit())));

  // Filtros
  readonly statusFilter = signal<CommissionStatus | 'all'>('all');
  readonly dateFrom = signal<string>('');
  readonly dateTo = signal<string>('');
  readonly search = signal<string>('');

  // Modal state
  readonly declineModalOpen = signal<{ open: boolean; accrual: UserCommission | null }>({ open: false, accrual: null });
  readonly declineReason = signal<string>('');
  readonly payModalOpen = signal<{ open: boolean; accrual: UserCommission | null }>({ open: false, accrual: null });
  readonly payReference = signal<string>('');
  readonly payNotes = signal<string>('');
  readonly actionLoading = signal(false);

  readonly statusFilters: StatusFilter[] = [
    { label: 'Todas', value: 'all', color: 'gray' },
    { label: 'Pendiente', value: 'pending', color: 'gray' },
    { label: 'Por pagar', value: 'accrued', color: 'amber' },
    { label: 'Pagado', value: 'paid', color: 'emerald' },
    { label: 'Declinado', value: 'declined', color: 'red' },
    { label: 'Reversado', value: 'reversed', color: 'gray' },
  ];

  // ─── Lifecycle ────────────────────────────────────────────────────────
  ngOnInit(): void {
    this.refresh();
    this.loadSummary();
  }

  // ─── Actions ─────────────────────────────────────────────────────────
  refresh(): void {
    this.loading.set(true);
    const status = this.statusFilter() === 'all' ? undefined : [this.statusFilter() as CommissionStatus];
    this.commissions
      .listByEmployee({
        employeeId: this.employeeId,
        status,
        dateFrom: this.dateFrom() || undefined,
        dateTo: this.dateTo() || undefined,
        page: this.page(),
        limit: this.limit(),
      })
      .subscribe({
        next: (res) => {
          this.items.set(res.data);
          this.total.set(res.meta?.total ?? 0);
          this.loading.set(false);
        },
        error: (err) => {
          this.toast.error('Error al cargar comisiones', err?.message);
          this.loading.set(false);
        },
      });
  }

  loadSummary(): void {
    this.summaryLoading.set(true);
    this.commissions.getSummary(this.employeeId).subscribe({
      next: (s) => {
        this.summary.set(s);
        this.summaryLoading.set(false);
      },
      error: () => this.summaryLoading.set(false),
    });
  }

  setStatus(status: CommissionStatus | 'all'): void {
    this.statusFilter.set(status);
    this.page.set(1);
    this.refresh();
  }

  setPage(p: number): void {
    if (p < 1 || p > this.totalPages()) return;
    this.page.set(p);
    this.refresh();
  }

  // ─── Decline flow ───────────────────────────────────────────────────
  openDeclineModal(accrual: UserCommission): void {
    this.declineModalOpen.set({ open: true, accrual });
    this.declineReason.set('');
  }

  closeDeclineModal(): void {
    this.declineModalOpen.set({ open: false, accrual: null });
  }

  confirmDecline(): void {
    const acc = this.declineModalOpen().accrual;
    if (!acc) return;
    if (this.declineReason().trim().length < 3) {
      this.toast.warning('El motivo debe tener al menos 3 caracteres');
      return;
    }
    this.actionLoading.set(true);
    this.commissions.decline(acc.id, this.declineReason().trim()).subscribe({
      next: () => {
        this.toast.success('Comisión declinada');
        this.closeDeclineModal();
        this.actionLoading.set(false);
        this.refresh();
        this.loadSummary();
      },
      error: (err) => {
        this.toast.error('Error al declinar', err?.error?.message ?? err?.message);
        this.actionLoading.set(false);
      },
    });
  }

  // ─── Mark-paid flow ─────────────────────────────────────────────────
  openPayModal(accrual: UserCommission): void {
    this.payModalOpen.set({ open: true, accrual });
    this.payReference.set('');
    this.payNotes.set('');
  }

  closePayModal(): void {
    this.payModalOpen.set({ open: false, accrual: null });
  }

  confirmMarkPaid(): void {
    const acc = this.payModalOpen().accrual;
    if (!acc) return;
    this.actionLoading.set(true);
    this.commissions
      .markPaid(acc.id, this.payReference().trim() || undefined, this.payNotes().trim() || undefined)
      .subscribe({
        next: () => {
          this.toast.success('Comisión marcada como pagada');
          this.closePayModal();
          this.actionLoading.set(false);
          this.refresh();
          this.loadSummary();
        },
        error: (err) => {
          this.toast.error('Error al marcar pagada', err?.error?.message ?? err?.message);
          this.actionLoading.set(false);
        },
      });
  }

  // ─── Reopen (revierte un decline) ──────────────────────────────────
  reopen(accrual: UserCommission): void {
    this.actionLoading.set(true);
    this.commissions.reopen(accrual.id).subscribe({
      next: () => {
        this.toast.success('Comisión re-abierta');
        this.actionLoading.set(false);
        this.refresh();
        this.loadSummary();
      },
      error: (err) => {
        this.toast.error('Error al reabrir', err?.error?.message ?? err?.message);
        this.actionLoading.set(false);
      },
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────
  statusBadge(status: CommissionStatus): { label: string; color: string } {
    const map: Record<CommissionStatus, { label: string; color: string }> = {
      pending: { label: 'Pendiente', color: '#9ca3af' },
      accrued: { label: 'Por pagar', color: '#f59e0b' },
      paid: { label: 'Pagado', color: '#10b981' },
      declined: { label: 'Declinado', color: '#ef4444' },
      reversed: { label: 'Reversado', color: '#6b7280' },
    };
    return map[status];
  }

  formatMoney(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    const n = typeof value === 'string' ? parseFloat(value) : value;
    return n.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
}