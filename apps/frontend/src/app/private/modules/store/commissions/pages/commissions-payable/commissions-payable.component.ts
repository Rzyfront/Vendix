import { Component, inject, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  StickyHeaderComponent,
  StickyHeaderActionButton,
  CardComponent,
  IconComponent,
  EmptyStateComponent,
  ButtonComponent,
  StatsComponent,
} from '../../../../../../shared/components';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { RequestContextService } from '@common/context/request-context.service';
import { firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../../../../environments/environment';

interface EmployeePayable {
  employee_id: number;
  display_name: string;
  total_amount: number;
  commission_count: number;
  oldest_due_date: string;
}

interface PayableSummary {
  date: string;
  totals: {
    total_payable: number;
    employees_count: number;
    commissions_count: number;
  };
  by_employee: EmployeePayable[];
}

/**
 * Pantalla "Comisiones por Pagar" (QUI-678).
 *
 * Vista agrupada por mecánico con el total que se le debe. Cada fila
 * redirige al perfil del empleado donde está la tab "Comisiones" completa.
 */
@Component({
  selector: 'app-commissions-payable',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    CurrencyPipe,
    DatePipe,
    StickyHeaderComponent,
    CardComponent,
    IconComponent,
    EmptyStateComponent,
    ButtonComponent,
    StatsComponent,
  ],
  templateUrl: './commissions-payable.component.html',
  styleUrls: ['./commissions-payable.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommissionsPayableComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly apiUrl = environment.apiUrl || '';

  readonly loading = signal(false);
  readonly summary = signal<PayableSummary | null>(null);
  readonly date = signal<string>(this.today());

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    { id: 'refresh', label: 'Actualizar', icon: 'refresh', variant: 'outline' },
  ]);

  ngOnInit(): void {
    this.load();
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'refresh') this.load();
  }

  setDate(d: string): void {
    this.date.set(d);
    this.load();
  }

  today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      // Por ahora reutilizamos daily-summary agrupado, pero solo nos interesa
      // el by_employee (que es lo que muestra "por pagar" en cada mecánico).
      const url = `${this.apiUrl}/store/reservations/commissions/daily-summary?date=${this.date()}`;
      const res = await firstValueFrom(this.http.get<any>(url));
      const data = res.data ?? res;
      // daily-summary devuelve by_mechanic — lo adaptamos a este reporte
      const byEmployee: EmployeePayable[] = (data.by_mechanic ?? []).map(
        (m: any) => ({
          employee_id: m.employee_id ?? 0,
          display_name: m.display_name ?? 'Sin nombre',
          total_amount: Number(m.provider_payable ?? 0),
          commission_count: Number(m.bookings_count ?? 0),
          oldest_due_date: this.date(),
        }),
      );
      this.summary.set({
        date: data.date ?? this.date(),
        totals: {
          total_payable: Number(data.totals?.total_provider_payable ?? 0),
          employees_count: byEmployee.length,
          commissions_count: Number(data.totals?.bookings_count ?? 0),
        },
        by_employee: byEmployee,
      });
    } catch (err: any) {
      this.toast.error('Error al cargar reporte', err?.message);
    } finally {
      this.loading.set(false);
    }
  }

  formatMoney(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    return value.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
}