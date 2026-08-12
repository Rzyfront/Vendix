import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { CommonModule, DecimalPipe, DatePipe, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';

import { CardComponent } from '../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../shared/components/stats/stats.component';
import { StickyHeaderComponent, StickyHeaderActionButton } from '../../../../../shared/components/sticky-header/sticky-header.component';
import { IconComponent } from '../../../../../shared/components';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { environment } from '../../../../../../environments/environment';
import { RouterLink } from '@angular/router';

/**
 * Pantalla "Resumen diario de comisiones dueño/mecánico".
 *
 * Muestra al dueño del negocio, al cierre del día:
 *   - Total facturado en servicios con comisión
 *   - Su comisión (lo que se queda él)
 *   - Lo que se le debe a los mecánicos (total)
 *   - Detalle por mecánico: # reservas, total facturado, comisión, a pagar
 *   - Detalle por servicio: # reservas, total, comisión, a pagar
 *
 * Ruta: /store/reservations/commissions/daily-summary
 * Permiso: store:reservations:read
 *
 * Endpoint backend: GET /api/store/reservations/commissions/daily-summary
 *
 * MVP: solo lectura. La transferencia real de dinero al mecánico queda para v2.
 */
@Component({
  selector: 'app-daily-commission-summary',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DecimalPipe,
    DatePipe,
    CurrencyPipe,
    CardComponent,
    StatsComponent,
    StickyHeaderComponent,
    IconComponent,
    RouterLink,
  ],
  templateUrl: './daily-summary.component.html',
  styleUrls: ['./daily-summary.component.scss'],
})
export class DailyCommissionSummaryComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  // ─── Estado de UI ─────────────────────────────────────────────────────
  readonly selectedDate = signal<string>(this.todayLocalIso());
  readonly loading = signal(false);
  readonly summary = signal<DailySummaryResponse | null>(null);

  readonly apiUrl = environment.apiUrl || '';

  // ─── Computed ──────────────────────────────────────────────────────────
  readonly hasData = computed(() => {
    const s = this.summary();
    return !!s && s.totals.bookings_count > 0;
  });

  readonly dateLabel = computed(() => {
    const d = this.selectedDate();
    if (!d) return '';
    // Parse YYYY-MM-DD como local
    const [y, m, dd] = d.split('-').map(Number);
    const date = new Date(y, m - 1, dd);
    return date.toLocaleDateString('es-CO', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  });

  /**
   * Acciones del sticky header. Exportar CSV solo está habilitado
   * cuando hay datos para no generar archivos vacíos.
   */
  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'export-csv',
      label: 'Exportar CSV',
      icon: 'download',
      variant: 'outline',
      visible: this.hasData() && !this.loading(),
    },
  ]);

  onHeaderAction(actionId: string): void {
    if (actionId === 'export-csv') {
      this.exportToCsv();
    }
  }

  /**
   * Helper de template: porcentaje que representa la comisión del dueño
   * sobre el total facturado. Tolera null/undefined para no romper cuando
   * el summary todavía no llegó.
   */
  ownerPctLabel(s: DailySummaryResponse | null | undefined): string {
    if (!s || !s.totals.total_revenue) return 'Sin datos aún';
    const pct = (s.totals.total_owner_commission / s.totals.total_revenue) * 100;
    return `${pct.toFixed(1)}% del total`;
  }

  /**
   * Formatea un número como currency colombiano sin decimales.
   * Devuelve string SIEMPRE (no `string | null`) — el Angular template
   * compiler es estricto con el pipe `number` y rechaza `null` como
   * input de `app-stats` `[value]`.
   */
  formatAmount(value: number | null | undefined): string {
    return (value ?? 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
  }

  ngOnInit(): void {
    this.refresh();
  }

  onDateChange(date: string): void {
    this.selectedDate.set(date);
    this.refresh();
  }

  previousDay(): void {
    const d = this.parseDate(this.selectedDate());
    d.setDate(d.getDate() - 1);
    this.selectedDate.set(this.toIsoLocal(d));
    this.refresh();
  }

  nextDay(): void {
    const d = this.parseDate(this.selectedDate());
    d.setDate(d.getDate() + 1);
    this.selectedDate.set(this.toIsoLocal(d));
    this.refresh();
  }

  today(): void {
    this.selectedDate.set(this.todayLocalIso());
    this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const url = `${this.apiUrl}/store/reservations/commissions/daily-summary?date=${this.selectedDate()}`;
      const response: ApiResponse<DailySummaryResponse> = await firstValueFrom(
        this.http.get<ApiResponse<DailySummaryResponse>>(url),
      );
      this.summary.set(response.data);
    } catch (err: any) {
      this.toast.error(
        'Error al cargar el resumen',
        err?.message ?? 'Error desconocido',
      );
      this.summary.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────
  private todayLocalIso(): string {
    const d = new Date();
    return this.toIsoLocal(d);
  }

  private toIsoLocal(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  private parseDate(iso: string): Date {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  // ─── Acciones ──────────────────────────────────────────────────────────
  exportToCsv(): void {
    const s = this.summary();
    if (!s || !s.by_service.length) {
      this.toast.warning('No hay datos para exportar');
      return;
    }

    const rows: string[] = [];
    rows.push(['Fecha', 'Servicio', 'Reservas', 'Total facturado', 'Comisión dueño', 'A pagar mecánico'].join(','));
    for (const svc of s.by_service) {
      rows.push(
        [
          s.date,
          this.escapeCsv(svc.product_name),
          svc.bookings_count,
          svc.total_revenue,
          svc.owner_commission,
          svc.provider_payable,
        ].join(','),
      );
    }
    // Total
    rows.push('');
    rows.push(
      [
        s.date,
        'TOTAL',
        s.totals.bookings_count,
        s.totals.total_revenue,
        s.totals.total_owner_commission,
        s.totals.total_provider_payable,
      ].join(','),
    );

    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resumen-comisiones-${s.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}

// ─── Tipos ─────────────────────────────────────────────────────────────────
interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface DailySummaryResponse {
  date: string;
  totals: {
    total_revenue: number;
    total_owner_commission: number;
    total_provider_payable: number;
    bookings_count: number;
  };
  by_mechanic: Array<{
    employee_id: number | null;
    display_name: string;
    bookings_count: number;
    total_revenue: number;
    owner_commission: number;
    provider_payable: number;
  }>;
  by_service: Array<{
    product_id: number;
    product_name: string;
    bookings_count: number;
    total_revenue: number;
    owner_commission: number;
    provider_payable: number;
  }>;
}